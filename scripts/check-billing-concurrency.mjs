import assert from 'node:assert/strict';
import { withLocalPostgres } from './local-postgres.mjs';
import { billingFixture,admin } from '../test/billingFixture.js';
import { createBillingService } from '../server/billing/service.js';

await withLocalPostgres(async([a,b,observer])=>{
  const wrap=client=>({query:(...args)=>client.query(...args),exec:text=>client.query(text),async transaction(fn){
    await client.query('begin');try {const result=await fn(this);await client.query('commit');return result;}
    catch(error){await client.query('rollback');throw error;}
  }});
  const {farm}=await billingFixture(wrap(observer));
  await observer.query("update private.billing_policy set mode='enforced',enforce_at=statement_timestamp()");
  let creates=0;let session;let subscriptions=[];
  const stripe={customers:{create:async()=>({id:'cus_race',livemode:false}),retrieve:async()=>({id:'cus_race',livemode:false})},
    prices:{retrieve:async()=>({livemode:false,active:true,type:'recurring',unit_amount:2999,currency:'usd',recurring:{interval:'month',interval_count:1}})},
    subscriptions:{list:async()=>({data:subscriptions,has_more:false})},
    checkout:{sessions:{create:async()=>{creates++;await new Promise(r=>setTimeout(r,100));session={id:'cs_race',livemode:false,status:'open',url:'https://checkout.stripe.com/test',expires_at:Math.floor(Date.now()/1000)+3600};return session;},retrieve:async()=>session}}
  };
  const config={identitySecret:'x'.repeat(32),priceId:'price_race',trialDays:30,appUrl:'http://localhost:5173/app/'};
  const one=createBillingService({db:wrap(a),stripe,config});const two=createBillingService({db:wrap(b),stripe,config});
  const results=await Promise.all([one.checkout(farm,admin),two.checkout(farm,admin)]);
  assert.equal(creates,1);assert.deepEqual(results[0],results[1]);
  assert.equal((await observer.query('select * from private.billing_trial_claims')).rows.length,1);
  subscriptions=[{id:'sub_race',customer:'cus_race',livemode:false,status:'active',latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_race'},current_period_end:Math.floor(Date.now()/1000)+86400}]}}];
  const event={id:'evt_race',livemode:false,type:'invoice.paid',data:{object:{customer:'cus_race'}}};
  const events=await Promise.all([one.webhook(event),two.webhook(event)]);
  assert.equal(events.filter(x=>x.duplicate).length,1);
  assert.equal((await observer.query('select * from private.billing_events')).rows.length,1);
  assert.equal((await one.entitlement(farm)).has_access,true);
  // Stripe success followed by SQL rollback must leave the event retryable.
  await observer.query("create function private.fixture_event_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$; create trigger fixture_failure before insert on private.billing_events for each row execute function private.fixture_event_failure()");
  subscriptions[0].status='canceled';
  await assert.rejects(one.webhook({...event,id:'evt_retry'}),/fixture failure/);
  assert.equal((await one.entitlement(farm)).has_access,true,'snapshot rollback');
  await observer.query('drop trigger fixture_failure on private.billing_events');
  await two.webhook({...event,id:'evt_retry'});
  assert.equal((await one.entitlement(farm)).has_access,false);
  console.log('PASS: separate PostgreSQL connections serialize checkout, trial reservation and duplicate webhooks; failed transactions remain retryable.');
});
