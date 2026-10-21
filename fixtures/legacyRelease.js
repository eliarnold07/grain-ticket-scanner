import { randomUUID } from 'node:crypto';

export const applicationTables=['farms','farm_accounts','farm_settings','bins','contracts','tickets','payments','inventory_transactions','weekly_summary_deliveries'];

// Invented shapes only. No production IDs, quantities, names, or exported rows.
export function buildLegacyReleaseFixture(farmId,actor) {
  const time='2026-10-01T12:00:00.000Z',binId=randomUUID();
  const base=()=>({id:randomUUID(),farm_id:farmId,created_at:time,updated_at:time});
  const contracts=[8,20].map((amount,i)=>({...base(),contract_id:`FICTIONAL-LEGACY-${i}`,buyer:'Fictional Buyer',commodity:'Corn',contracted_bushels:amount,contract_price:5,status:'Open',notes:'Fictional legacy compatibility'}));
  const tickets=Array.from({length:55},(_,i)=>{
    const bushels=i===0?10:i===1?25:1;
    return {...base(),date:'2026-10-01',crop:'Corn',ticket_number:`FICTIONAL-LEGACY-${i}`,delivered_to:'Fictional Elevator',hauled_by:'Fictional Driver',hauled_from:i===0?'Fictional Legacy Bin':'Field',bushels,price:5,revenue:bushels*5,gross_weight:30000+bushels*56,tare_weight:30000,net_weight:bushels*56,moisture:15,notes:'Fictional historical ticket without a payment row',assignment_status:i<2?'Contract':'Spot',assignments:[i<2?{type:'CONTRACT',contract_id:contracts[i].id,bushels}:{type:'SPOT',bushels}],payment_status:'Not paid',amount_received:0,scanned_by_user_id:actor,scanned_by_name:'Fictional Legacy Admin'};
  });
  const transactions=[
    {id:randomUUID(),farm_id:farmId,bin_id:binId,transaction_type:'MANUAL_ADJUSTMENT',bushel_amount:100,applied_bushel_amount:100,previous_bin_balance:0,new_bin_balance:100,created_at:'2026-10-01T11:00:00.000Z'},
    {id:randomUUID(),farm_id:farmId,bin_id:binId,transaction_type:'TICKET_SALE',bushel_amount:10,applied_bushel_amount:10,previous_bin_balance:100,new_bin_balance:90,ticket_id:tickets[0].id,created_at:time}
  ];
  return {bins:[{...base(),id:binId,bin_name:'Fictional Legacy Bin',crop_type:'Corn',estimated_capacity_bushels:1000,current_bushels:90}],contracts,tickets,
    payments:[{...base(),ticket_id:null,payment_status:'Partially paid',amount_received:22.5,notes:'Fictional standalone historical payment'}],
    inventory_transactions:transactions,ticketLinks:[{id:tickets[0].id,transactionId:transactions[1].id}]};
}

export async function insertFixture(db,fixture) {
  for(const table of ['bins','contracts','tickets','payments','inventory_transactions']) {
    for(const row of fixture[table]) {
      const fields=Object.keys(row);
      await db.query(`insert into public.${table}(${fields.join(',')}) values(${fields.map((_,i)=>`$${i+1}`).join(',')})`,fields.map(key=>row[key]!==null&&typeof row[key]==='object'?JSON.stringify(row[key]):row[key]));
    }
  }
  for(const link of fixture.ticketLinks) await db.query('update public.tickets set inventory_transaction_id=$1 where id=$2',[link.transactionId,link.id]);
}

export async function farmSnapshot(db,farm) {
  const result={};
  for(const table of applicationTables) result[table]=(await db.query(`select to_jsonb(t)${table==='farms'?"-'account_access_state'-'account_archived_at'":''} value from public.${table} t where ${table==='farms'?'id':'farm_id'}=$1 order by ${table==='farm_accounts'?'user_id':'id'}`,[farm])).rows.map(row=>row.value);
  return result;
}

export async function assertLegacyShape(db,farm,assert) {
  const r=(await db.query(`select
    (select count(*) from public.tickets t where t.farm_id=$1 and not exists(select 1 from public.payments p where p.farm_id=t.farm_id and p.ticket_id=t.id)) sparse,
    (select count(*) from public.payments where farm_id=$1 and ticket_id is null) standalone,
    (select count(*) from public.contracts c where c.farm_id=$1 and c.contracted_bushels<(select coalesce(sum((x->>'bushels')::numeric),0) from public.tickets t cross join lateral jsonb_array_elements(t.assignments)x where t.farm_id=$1 and x->>'contract_id'=c.id::text)) overfilled`,[farm])).rows[0];
  assert.equal(Number(r.sparse),55);assert.equal(Number(r.standalone),1);assert.equal(Number(r.overfilled),2);
}

export function legacyGrantSql() {
  return `grant all on ${applicationTables.map(t=>`public.${t}`).join(',')} to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`;
}

export async function assertReleasePrivileges(db,assert) {
  for(const role of ['anon','authenticated','service_role']) {
    for(const table of applicationTables) {
      const r=(await db.query("select has_table_privilege($1,$2,'TRUNCATE') trunc,has_table_privilege($1,$2,'TRIGGER') trigger,has_table_privilege($1,$2,'REFERENCES') ref,has_table_privilege($1,$2,'SELECT') read",[role,`public.${table}`])).rows[0];
      assert.equal(r.trunc,false,`${role}/${table} TRUNCATE`);assert.equal(r.trigger,false);assert.equal(r.ref,false);
      assert.equal(r.read,role!=='anon');
    }
    for(const table of ['bins','tickets','payments','inventory_transactions','farm_accounts']) {
      for(const operation of ['INSERT','UPDATE','DELETE']) assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,`public.${table}`,operation])).rows[0].allowed,false);
    }
    for(const fn of ['farm_ticket_command(uuid,text,uuid,jsonb,uuid)','farm_inventory_command(uuid,text,jsonb)','binflow_delete_account(uuid,uuid,text,uuid)','binflow_prepare_user_provision(uuid,text)','binflow_manage_saved_name(uuid,text,uuid,text,text)']) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${fn}`])).rows[0].allowed,role==='service_role');
    }
  }
}
