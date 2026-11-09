import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

export class BillingError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const terminal = new Set(['canceled', 'incomplete_expired']);
const iso = value => value ? new Date(value * 1000).toISOString() : null;
const idOf = value => typeof value === 'string' ? value : value?.id;

export function subscriptionSnapshot(s, previous = {}, now = new Date(), liveMode = false) {
  if (s.livemode !== liveMode) throw new BillingError(liveMode ? 'LIVE_MODE_REQUIRED' : 'TEST_MODE_REQUIRED', 400);
  const items = s.items?.data || [];
  const periodEnd = items.length ? Math.min(...items.map(x => x.current_period_end || s.current_period_end || 0)) : s.current_period_end;
  const invoice = s.latest_invoice;
  const paid = invoice && typeof invoice === 'object' && invoice.status === 'paid';
  return {
    subscription_id: s.id, customer_id: idOf(s.customer), status: s.status,
    price_id: items[0]?.price?.id || null, trial_start: iso(s.trial_start) || previous.trial_start || null, trial_end: iso(s.trial_end) || previous.trial_end || null,
    paid_through: s.status === 'active' && paid ? iso(periodEnd) : previous.paid_through || null,
    period_end: iso(periodEnd), cancel_at_period_end: Boolean(s.cancel_at_period_end),
    cancel_at: iso(s.cancel_at), canceled_at: iso(s.canceled_at),
    past_due_since: s.status === 'past_due' ? previous.past_due_since || now.toISOString() : null,
    verified_at: now.toISOString()
  };
}

export function createBillingService({ db, stripe, config, now = () => new Date() }) {
  const liveMode = config.mode === 'production';
  async function locked(tx, farmId, actor, admin = true) {
    const hosted = ['staging','production'].includes(config.mode);
    const lockSql = hosted
      ? 'select * from private.billing_stage_lock_farm($1)'
      : 'select id,account_access_state from public.farms where id=$1 for update';
    const farm = (await tx.query(lockSql, [farmId])).rows[0];
    if (!farm) throw new BillingError('FARM_NOT_FOUND', 404);
    if (actor) {
      const memberSql = hosted
        ? 'select * from private.billing_stage_member($1,$2)'
        : 'select a.role,u.email,u.email_confirmed_at from public.farm_accounts a join auth.users u on u.id=a.user_id where a.user_id=$1 and a.farm_id=$2';
      const member = (await tx.query(memberSql, [actor, farmId])).rows[0];
      if (!member || (admin && member.role !== 'admin')) throw new BillingError('BILLING_ADMIN_REQUIRED', 403);
      if (farm.account_access_state !== 'active') throw new BillingError('FARM_ARCHIVED', 403);
      return member;
    }
    return farm;
  }
  async function row(tx, farmId) {
    await tx.query('insert into private.farm_subscriptions(farm_id) values($1) on conflict do nothing', [farmId]);
    return (await tx.query('select * from private.farm_subscriptions where farm_id=$1', [farmId])).rows[0];
  }
  async function saveSnapshot(tx, farmId, sub, previous) {
    if (idOf(sub.customer) !== previous.customer_id) throw new BillingError('CUSTOMER_MISMATCH');
    const snapshot = subscriptionSnapshot(sub, previous, now(), liveMode);
    // Fixed column list from our own normalized object, never event/body keys.
    const columns = Object.keys(snapshot);
    await tx.query(`update private.farm_subscriptions set ${columns.map((c,i) => `${c}=$${i+2}`).join(',')},updated_at=now() where farm_id=$1`, [farmId, ...Object.values(snapshot)]);
    return snapshot;
  }
  async function reconcileLocked(tx, farmId, previous) {
    if (!previous.customer_id) return previous;
    const customer = await stripe.customers.retrieve(previous.customer_id);
    if (customer.deleted || customer.livemode !== liveMode) throw new BillingError(liveMode ? 'LIVE_CUSTOMER_REQUIRED' : 'TEST_CUSTOMER_REQUIRED');
    const list = await stripe.subscriptions.list({ customer: previous.customer_id, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
    if (list.has_more) throw new BillingError('SUBSCRIPTION_REVIEW_REQUIRED');
    const live = list.data.filter(s => !terminal.has(s.status));
    if (live.length > 1) throw new BillingError('MULTIPLE_SUBSCRIPTIONS_REVIEW_REQUIRED');
    const sub = live[0] || list.data.find(s => s.id === previous.subscription_id);
    if (!sub) return previous;
    return { ...previous, ...await saveSnapshot(tx, farmId, sub, previous) };
  }
  async function entitlement(farmId) {
    return (await db.query('select private.billing_entitlement($1) as entitlement', [farmId])).rows[0].entitlement;
  }
  async function refreshEntitlement(farmId, actor) {
    return db.transaction(async tx => {
      await locked(tx, farmId, actor, false);
      const s = (await tx.query('select * from private.farm_subscriptions where farm_id=$1',[farmId])).rows[0];
      // Row locking coalesces simultaneous foreground refreshes. Six hours leaves
      // ample headroom before the database's 48-hour verification cutoff.
      const current = (await tx.query('select private.billing_entitlement($1) as entitlement',[farmId])).rows[0].entitlement;
      const boundary = ['verification_required','expired'].includes(current.reason) && ['active','trialing','past_due'].includes(s?.status);
      if (s?.customer_id && (boundary || !s.verified_at || +now() - +new Date(s.verified_at) >= 6*3600000)) {
        await reconcileLocked(tx, farmId, s);
        return (await tx.query('select private.billing_entitlement($1) as entitlement',[farmId])).rows[0].entitlement;
      }
      return current;
    });
  }
  async function details(farmId, actor) {
    return db.transaction(async tx => {
      const member = await locked(tx, farmId, actor, false);
      const s = (await tx.query('select * from private.farm_subscriptions where farm_id=$1', [farmId])).rows[0] || {};
      const hash = createHmac('sha256', config.identitySecret).update(member.email.trim().toLowerCase()).digest('hex');
      const claim = (await tx.query('select farm_id from private.billing_trial_claims where identity_hash=$1', [hash])).rows[0];
      return { plan_interval: s.price_id ? (s.price_id === config.annualPriceId ? 'year' : s.price_id === config.priceId ? 'month' : null) : null,
        can_checkout: member.role === 'admin' && (!s.subscription_id || terminal.has(s.status)),
        can_portal: member.role === 'admin' && Boolean(s.customer_id),
        trial_eligible: !s.trial_start && !s.subscription_id && (!claim || claim.farm_id === farmId),
        next_billing_at: s.cancel_at_period_end || s.cancel_at || terminal.has(s.status) ? null : s.status === 'trialing' ? s.trial_end : s.period_end,
        cancellation_at: s.cancel_at || (s.cancel_at_period_end ? s.period_end : null) };
    });
  }
  async function plan(interval) {
    const id = interval === 'year' ? config.annualPriceId : config.priceId;
    if (!id) throw new BillingError('PLAN_UNAVAILABLE', 409);
    const p = await stripe.prices.retrieve(id);
    if (p.livemode !== liveMode || !p.active || p.type !== 'recurring' ||
        p.recurring?.interval !== interval || p.recurring?.interval_count !== 1 ||
        !Number.isInteger(p.unit_amount) ||
        (p.currency !== 'usd' || p.unit_amount !== (interval === 'year' ? 29999 : 2999))) {
      throw new BillingError('PLAN_UNAVAILABLE', 409);
    }
    return { amount: p.unit_amount, currency: p.currency, interval, trial_days: config.trialDays, product: idOf(p.product) };
  }
  async function price() {
    const monthly = await plan('month');
    const annual = config.annualPriceId ? await plan('year').catch(() => null) : null;
    if (liveMode && (!annual || !monthly.product || monthly.product !== annual.product)) throw new BillingError('PLAN_UNAVAILABLE');
    return { ...monthly, annual };
  }
  const handoffHash = token => createHash('sha256').update(token).digest('hex');
  async function iosPrice() {
    const quote = await price();
    if (quote.currency !== 'usd' || quote.amount !== 2999 || quote.trial_days !== 30 || quote.annual?.amount !== 29999) {
      throw new BillingError('PLAN_UNAVAILABLE', 409);
    }
    return quote;
  }
  async function issueIosHandoff(farmId, actor) {
    await iosPrice();
    const token = randomBytes(32).toString('base64url');
    await db.transaction(async tx => {
      const member = await locked(tx, farmId, actor);
      if (!member.email_confirmed_at) throw new BillingError('CONFIRMED_EMAIL_REQUIRED', 403);
      const existing = (await tx.query('select subscription_id,status from private.farm_subscriptions where farm_id=$1', [farmId])).rows[0];
      if (existing?.subscription_id && !terminal.has(existing.status)) throw new BillingError('USE_BILLING_PORTAL');
      await tx.query(`insert into private.billing_ios_handoffs(farm_id, actor_id, token_hash, expires_at)
        values ($1,$2,$3,statement_timestamp()+interval '5 minutes')
        on conflict (farm_id,actor_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at`,
      [farmId, actor, handoffHash(token)]);
    });
    return { url: `${config.appUrl}?billing=ios-handoff#${token}` };
  }
  async function redeemIosHandoff(token, interval) {
    if (!['month', 'year'].includes(interval)) throw new BillingError('INVALID_PLAN', 400);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BillingError('HANDOFF_INVALID', 410);
    const handoff = (await db.query(`delete from private.billing_ios_handoffs
      where token_hash=$1 and expires_at>statement_timestamp() returning farm_id,actor_id`, [handoffHash(token)])).rows[0];
    if (!handoff) throw new BillingError('HANDOFF_INVALID', 410);
    // Checkout rechecks current membership, confirmation and farm state. Only the
    // token row identifies the actor and farm, even if Safari has another login.
    await iosPrice();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await checkout(handoff.farm_id, handoff.actor_id, interval, true);
      if (!result.retry) return result;
    }
    throw new BillingError('CHECKOUT_CHANGED');
  }
  async function checkout(farmId, actor, interval = 'month', iosHandoff = false) {
    if (!['month', 'year'].includes(interval)) throw new BillingError('INVALID_PLAN', 400);
    const successUrl = `${config.appUrl}?billing=${iosHandoff ? 'ios-returned' : 'returned'}`;
    const cancelUrl = `${config.appUrl}?billing=${iosHandoff ? 'ios-canceled' : 'canceled'}`;
    // Validate before reserving so an unavailable price cannot strand an attempt.
    await plan(interval);
    // Persist the reservation before external calls. Retries use the same key even
    // if Stripe succeeded and the process died before storing its response.
    const reservation = await db.transaction(async tx => {
      const member = await locked(tx, farmId, actor);
      if (!member.email_confirmed_at) throw new BillingError('CONFIRMED_EMAIL_REQUIRED', 403);
      let s = await row(tx, farmId);
      if (s.checkout_attempt && !s.checkout_session_id && now() - new Date(s.checkout_started) > 23 * 3600000) throw new BillingError('CHECKOUT_RECONCILIATION_REQUIRED');
      if (!s.checkout_attempt) {
        const hash = createHmac('sha256', config.identitySecret).update(member.email.trim().toLowerCase()).digest('hex');
        const existing = (await tx.query('select * from private.billing_trial_claims where identity_hash=$1', [hash])).rows[0];
        // Claim once per farm and normalized confirmed identity. A fresh account
        // with the same email cannot get a new trial after deleting the old one.
        const farmClaim = (await tx.query('select 1 from private.billing_trial_claims where farm_id=$1', [farmId])).rows.length > 0;
        if (!s.trial_start && !s.subscription_id && !existing && !farmClaim) {
          const start = now(); const end = new Date(+start + config.trialDays * 86400000);
          await tx.query('insert into private.billing_trial_claims(identity_hash,farm_id,trial_start,trial_end) values($1,$2,$3,$4) on conflict do nothing', [hash, farmId, start, end]);
          // Reserve eligibility only. Stripe sets the actual trial dates on subscription creation.
        }
        await tx.query('update private.farm_subscriptions set checkout_attempt=$2,checkout_started=$3,checkout_interval=$4 where farm_id=$1', [farmId,randomUUID(),now(),interval]);
      }
      return { member, ...(await row(tx, farmId)) };
    });
    // Commit customer binding before creating Checkout, so an immediate webhook
    // can resolve the farm even while session creation still holds its row lock.
    await db.transaction(async tx => {
      await locked(tx, farmId, actor);
      const s = await row(tx, farmId);
      if (s.checkout_attempt !== reservation.checkout_attempt) throw new BillingError('CHECKOUT_CHANGED');
      if (!s.customer_id) {
        const c = await stripe.customers.create({ metadata: { binflow_farm_id: farmId } }, { idempotencyKey: `farm-customer:${s.checkout_attempt}` });
        if (c.livemode !== liveMode) throw new BillingError(liveMode ? 'LIVE_MODE_REQUIRED' : 'TEST_MODE_REQUIRED');
        await tx.query('update private.farm_subscriptions set customer_id=$2 where farm_id=$1', [farmId,c.id]);
      }
    });
    return db.transaction(async tx => {
      await locked(tx, farmId, actor);
      let s = await row(tx, farmId);
      if (s.checkout_attempt !== reservation.checkout_attempt) throw new BillingError('CHECKOUT_CHANGED');
      s = await reconcileLocked(tx, farmId, s);
      if (s.subscription_id && !terminal.has(s.status)) throw new BillingError('USE_BILLING_PORTAL');
      const reservedInterval = s.checkout_interval || 'month';
      if (!s.checkout_session_id && reservedInterval !== interval) {
        throw new BillingError('CHECKOUT_PLAN_PENDING', 409);
      }
      if (s.checkout_session_id) {
        const session = await stripe.checkout.sessions.retrieve(s.checkout_session_id);
        if (session.status === 'open') {
          if (reservedInterval === interval && (session.success_url === successUrl || (!iosHandoff && !session.success_url))) return { url: session.url };
          // Expiration must succeed before releasing the reservation. If Stripe
          // completed the old session concurrently, no replacement can start.
          await stripe.checkout.sessions.expire(session.id);
        }
        if (session.status === 'complete' && !terminal.has(s.status)) throw new BillingError('PAYMENT_PROCESSING');
        await tx.query('update private.farm_subscriptions set checkout_attempt=null,checkout_interval=null,checkout_session_id=null,checkout_url=null where farm_id=$1', [farmId]);
        return { retry: true };
      }
      const trialEnd = Math.floor(new Date(s.trial_end).getTime()/1000);
      const reserved = (await tx.query('select 1 from private.billing_trial_claims where farm_id=$1', [farmId])).rows.length > 0;
      const freshTrial = reserved && !s.trial_start && !s.subscription_id;
      const trial = freshTrial || (!s.subscription_id && trialEnd > Math.floor(+now()/1000) + 48*3600);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer: s.customer_id, client_reference_id: farmId,
        line_items: [{ price: interval === 'year' ? config.annualPriceId : config.priceId, quantity: 1 }], payment_method_collection: 'always',
        subscription_data: { metadata: { binflow_farm_id: farmId }, ...(trial ? { ...(freshTrial ? { trial_period_days: config.trialDays } : { trial_end: trialEnd }), trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}) },
        success_url: successUrl, cancel_url: cancelUrl,
        custom_text: { submit: { message: trial ? 'Your saved payment method will be charged automatically when the trial ends. Cancel before that date to avoid the first charge. One subscription covers this farm.' : `This subscription renews ${interval === 'year' ? 'annually' : 'monthly'} until canceled. One subscription covers this farm.` } },
        expires_at: Math.floor(+new Date(s.checkout_started)/1000)+3600
      }, { idempotencyKey: `farm-checkout:${s.checkout_attempt}` });
      if (session.livemode !== liveMode) throw new BillingError(liveMode ? 'LIVE_MODE_REQUIRED' : 'TEST_MODE_REQUIRED');
      await tx.query('update private.farm_subscriptions set checkout_session_id=$2,checkout_url=$3,checkout_expires=$4 where farm_id=$1', [farmId,session.id,session.url,iso(session.expires_at)]);
      await tx.query("insert into private.billing_audit(farm_id,action) values($1,'checkout_created')", [farmId]);
      return { url: session.url };
    });
  }
  async function portal(farmId, actor) {
    return db.transaction(async tx => {
      await locked(tx,farmId,actor);
      const s=await row(tx,farmId);
      if (!s.customer_id) throw new BillingError('NO_BILLING_CUSTOMER');
      const c=await stripe.customers.retrieve(s.customer_id);
      if (c.livemode !== liveMode || c.deleted) throw new BillingError(liveMode ? 'LIVE_CUSTOMER_REQUIRED' : 'TEST_CUSTOMER_REQUIRED');
      const session=await stripe.billingPortal.sessions.create({ customer: s.customer_id, ...(config.portalConfiguration ? {configuration:config.portalConfiguration} : {}), return_url: `${config.appUrl}?billing=managed` });
      return { url: session.url };
    });
  }
  async function reconcile(farmId, actor) {
    return db.transaction(async tx => {
      const farm=await locked(tx,farmId,actor, false);
      let s=await row(tx,farmId);
      s=await reconcileLocked(tx,farmId,s);
      if (!actor && farm.account_access_state==='archived') {
        if (s.checkout_session_id) {
          const session=await stripe.checkout.sessions.retrieve(s.checkout_session_id);
          if (session.status==='open') await stripe.checkout.sessions.expire(session.id);
        }
        if (s.subscription_id && !terminal.has(s.status)) {
          const canceled=await stripe.subscriptions.cancel(s.subscription_id);
          await saveSnapshot(tx,farmId,canceled,s);
        }
        await tx.query('update private.billing_cancellation_outbox set completed_at=now() where farm_id=$1',[farmId]);
      }
      return (await tx.query('select private.billing_entitlement($1) as entitlement',[farmId])).rows[0].entitlement;
    });
  }
  async function webhook(event) {
    if (event.livemode !== liveMode) throw new BillingError(liveMode ? 'LIVE_MODE_REQUIRED' : 'TEST_MODE_REQUIRED',400);
    const supported=/^(customer\.subscription\.|invoice\.|checkout\.session\.)/.test(event.type);
    if (!supported) return { ignored: true };
    const customer=idOf(event.data.object.customer);
    const s=(await db.query('select farm_id from private.farm_subscriptions where customer_id=$1',[customer])).rows[0];
    if (!s) return { ignored: true }; // No metadata-based farm assignment.
    return db.transaction(async tx => {
      await locked(tx,s.farm_id);
      const seen=await tx.query('select 1 from private.billing_events where event_id=$1',[event.id]);
      if (seen.rows.length) return { duplicate: true };
      await reconcileLocked(tx,s.farm_id,await row(tx,s.farm_id));
      await tx.query('insert into private.billing_events(event_id,farm_id,event_type) values($1,$2,$3)',[event.id,s.farm_id,event.type]);
      return { received: true };
    });
  }
  async function exportFarm(farmId,actor) {
    return db.transaction(async tx => {
      await locked(tx,farmId,actor);
      const output={ exported_at: now().toISOString(), farm_id: farmId };
      for (const table of ['tickets','bins','contracts','payments','inventory_transactions','farm_settings']) {
        output[table]=(await tx.query(`select * from public.${table} where farm_id=$1 order by id`,[farmId])).rows;
      }
      return output;
    });
  }
  return { refreshEntitlement, issueIosHandoff, redeemIosHandoff, entitlement,details,price,checkout,portal,reconcile,webhook,exportFarm,
    async reconcileAll() {
      const farms=(await db.query('select farm_id from private.farm_subscriptions union select farm_id from private.billing_cancellation_outbox where completed_at is null')).rows;
      const results=[];
      for (const {farm_id} of farms) {
        try { await reconcile(farm_id); results.push({farm_id,ok:true}); }
        catch { results.push({farm_id,ok:false}); }
      }
      return results;
    }
  };
}
