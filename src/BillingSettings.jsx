import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { billingRestricted, billingPresentation, billingError } from './billingPresentation.js';
import './billing.css';
export { billingRestricted } from './billingPresentation.js';
const date = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}) : 'Not scheduled';
export default function BillingSettings({ apiFetch, account, entitlement, onRefresh, onAccount, onBack, onActivated, returnState, platform=Capacitor.getPlatform() }) {
  const [price,setPrice]=useState(null), [details,setDetails]=useState(null), [busy,setBusy]=useState(''), [message,setMessage]=useState(''), [error,setError]=useState(''), [waiting,setWaiting]=useState(returnState==='returned');
  const [interval, setInterval] = useState('month');
  const lock=useRef(false), callbacks=useRef({apiFetch,onRefresh,onActivated});
  callbacks.current={apiFetch,onRefresh,onActivated};
  const native=platform!=='web', admin=account.role==='admin', disabled=entitlement?.status==='not_configured', restricted=billingRestricted(entitlement);
  const state=billingPresentation(entitlement || {});
  async function loadDetails() {
    const r=await callbacks.current.apiFetch('/api/billing/status');
    if(!r.ok) throw new Error('We couldn’t load billing details. Please try again.');
    const d=await r.json();setDetails(d);return d;
  }
  useEffect(()=>{
    let alive=true;if(disabled) return;
    (async()=>{try {
      const r=await callbacks.current.apiFetch('/api/billing/status');if(!r.ok) throw new Error();const d=await r.json();if(alive)setDetails(d);
      if(admin&&!native){const p=await callbacks.current.apiFetch('/api/billing/price');if(!p.ok)throw new Error();const v=await p.json();if(alive)setPrice(v);}
    } catch {if(alive)setError('We couldn’t load billing details. Try again in a moment.');}})();
    return()=>{alive=false;};
  },[account.farm_id,admin,native,disabled]);
  useEffect(()=>{
    if(returnState!=='returned' && returnState!=='managed')return;
    let stopped=false,timer;const started=Date.now();
    async function check(){
      try {
        const r=await callbacks.current.apiFetch('/api/billing/status');if(!r.ok)throw new Error();const d=await r.json();
        if(stopped)return;setDetails(d);
        if(d.entitlement?.has_access===true && !billingRestricted(d.entitlement)){
          const session=await callbacks.current.onRefresh();
          if(!stopped && session && !billingRestricted(session.entitlement)){setWaiting(false);callbacks.current.onActivated?.(returnState);return;}
        }
      }catch { /* Bounded retry; never trust the redirect as proof of payment. */ }
      if(stopped)return;
      if(Date.now()-started<45000)timer=setTimeout(check,2500);
      else {setWaiting(false);setMessage('Confirmation is taking longer than usual. Check status again shortly; there’s no need to start another Checkout.');}
    }
    check();return()=>{stopped=true;clearTimeout(timer);};
  },[returnState,account.farm_id]);
  async function action(kind){
    if(lock.current)return;lock.current=true;setBusy(kind);setError('');setMessage('');
    try{
      let data;
      for(let attempt=0;attempt<2;attempt++){
        const r=await apiFetch(`/api/billing/${kind}`,{method:kind==='export'?'GET':'POST',headers:{'X-BinFlow-Platform':platform, ...(kind==='checkout' ? {'Content-Type':'application/json'} : {})}, ...(kind==='checkout' ? {body:JSON.stringify({interval})} : {})});data=await r.json();
        if(!r.ok)throw new Error(billingError(data.code));if(!data.retry)break;
      }
      if(data.retry)throw new Error('Checkout is not ready yet. Please try again shortly.');
      if(kind==='export'){
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='binflow-farm-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Your farm export is ready. Check your downloads.');
      }else if(data.url&&!native){
        const url=new URL(data.url);if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw new Error('Unable to open secure billing. Please contact support.');window.location.assign(url.href);return;
      }else{
        const fresh=await onRefresh();if(!fresh)throw new Error('We couldn’t refresh your farm status. Please try again.');await loadDetails();
        if(!native&&admin&&!price){const r=await apiFetch('/api/billing/price');if(r.ok)setPrice(await r.json());}
        if(fresh.entitlement?.has_access&&!billingRestricted(fresh.entitlement))onActivated?.(returnState);
        setMessage('Your subscription status is up to date.');
      }
    }catch(e){setError(e.message || billingError());}finally{lock.current=false;setBusy('');}
  }
  const amount=price?new Intl.NumberFormat(undefined,{style:'currency',currency:price.currency}).format(price.amount/100):null;
  const offer=admin&&!native&&details?.can_checkout&&!waiting&&returnState!=='returned';
  const trial=details?.trial_eligible;
  const annualSelected = interval === 'year';
  const actualAnnual = details?.plan_interval === 'year';
  const annualAvailable = Boolean(price?.annual);
  const planKnown = actualAnnual || details?.plan_interval === 'month';
  return <section className="billing-view" aria-labelledby="billing-title">
    {onBack&&<button className="settings-back billing-back" onClick={onBack}>← Back to Settings</button>}
    <header className="billing-heading"><p className="billing-eyebrow">FARM SUBSCRIPTION</p><span className={`billing-badge billing-${waiting?'neutral':state.tone}`}>{waiting?'Confirming access':state.label}</span>
      <h2 id="billing-title">{waiting?'Activating your farm…':native&&restricted?'Your farm subscription':state.title}</h2>
      <p>{waiting?'We’re confirming your subscription securely. This usually takes a few seconds. You’ll enter your farm automatically when access is ready.':native&&restricted?'This app recognizes your farm’s existing subscription. Check your status or contact your farm administrator for help.':state.detail}</p>
    </header>
    {returnState==='canceled'&&<p className="billing-notice" role="status">You returned without completing Checkout. You can continue when you’re ready; farm access starts only after confirmation.</p>}
    {waiting&&<div className="billing-progress" role="status">Confirming subscription · Preparing your workspace</div>}
    <div className={offer ? "billing-grid billing-grid-offer" : "billing-grid"}>
      <div className="billing-plan">
        <p className="billing-eyebrow">ONE PLAN. YOUR WHOLE FARM.</p><h3>BinFlow Farm Subscription</h3>
        {admin&&!native&&!offer&&planKnown&&<div className="billing-price">
          <strong>{actualAnnual ? '$299.99/year' : amount ? `${amount}/month` : 'Monthly'}</strong>
          {actualAnnual&&<span>Equivalent to $25/month · billed annually</span>}
        </div>}
        <ul className="billing-benefits"><li>Grain tickets, inventory, and contracts together</li><li>All authorized farm members included</li><li>Shared farm access across supported devices</li></ul>
        {offer&&<>
          <fieldset className="billing-plan-picker" disabled={Boolean(busy)}>
            <legend>Choose your billing plan</legend>
            <label className="billing-choice">
              <input type="radio" name="billing-interval" value="month" checked={!annualSelected} onChange={()=>setInterval('month')} />
              <span className="billing-choice-name">BinFlow Monthly</span>
              <strong>{amount ? `${amount}/month` : 'Loading price…'}</strong>
              <span>{trial ? 'Billed monthly after your 30-day free trial.' : 'Billed monthly, starting today.'} Renews monthly unless canceled.</span>
            </label>
            <label className="billing-choice">
              <input type="radio" name="billing-interval" value="year" checked={annualSelected} onChange={()=>setInterval('year')} disabled={!annualAvailable} />
              <span className="billing-choice-name">BinFlow Annual <span className="billing-badge billing-success">Save 17%</span></span>
              <strong>$25.00/month</strong>
              <b>$299.99 billed annually</b>
              <span>{trial ? 'Pay $299.99 upfront after your 30-day free trial, then once per year unless canceled. Equivalent to $25/month — not a monthly payment.' : 'Pay $299.99 upfront, then once per year unless canceled.'}</span>
              <span>Save $59.89/year compared with monthly billing.</span>
              {!annualAvailable&&<small>Annual Checkout is currently unavailable.</small>}
            </label>
          </fieldset>
          <button className="billing-primary" disabled={Boolean(busy)||!price||(annualSelected&&!annualAvailable)} onClick={()=>action('checkout')}>
            {busy==='checkout'?'Opening secure Checkout…':trial?`Start ${price?.trial_days||30}-Day Free Trial`:'Start farm subscription'}
          </button>
          <p className="billing-fine">Selected plan: {annualSelected ? 'Annual' : 'Monthly'}. Payment method required. Stripe confirms the dates and total before you agree.</p>
        </>}
        {admin&&!native&&details?.can_portal&&!waiting&&<button className={offer?'billing-secondary':'billing-primary'} disabled={!!busy} onClick={()=>action('portal')}>{busy==='portal'?'Opening secure billing…':'Manage billing'}</button>}
        {!admin&&<p className="billing-note">{restricted ? 'A farm administrator needs to activate or restore the subscription. Your farm records are safe.' : 'Your farm administrator manages the subscription. You don’t need a separate plan.'}</p>}
        {native&&admin&&<p className="billing-note">Existing farm access is shared with this app. Purchasing and payment changes are not available in this version.</p>}
        {admin&&!native&&!disabled&&<p className="billing-secure">Payments managed securely by Stripe.</p>}
      </div>
      <aside className="billing-summary" aria-label="Subscription details"><h3>Your subscription</h3><dl>
        <div><dt>Status</dt><dd>{state.label}</dd></div>
        {planKnown&&<div><dt>Billing frequency</dt><dd>{actualAnnual ? 'Annual' : 'Monthly'}</dd></div>}
        {entitlement?.trial_end&&<div><dt>Trial end date</dt><dd>{date(entitlement.trial_end)}</dd></div>}
        {details?.next_billing_at&&<div><dt>Next expected billing date</dt><dd>{date(details.next_billing_at)}</dd></div>}
        {details?.cancellation_at&&<div><dt>Scheduled access end</dt><dd>{date(details.cancellation_at)}</dd></div>}
        {entitlement?.status==='past_due'&&entitlement?.valid_until&&<div><dt>Temporary access until</dt><dd>{date(entitlement.valid_until)}</dd></div>}
        <div><dt>Members</dt><dd>All authorized farm members</dd></div>
      </dl>{!disabled&&<button className="billing-secondary" disabled={!!busy||waiting} onClick={()=>action('reconcile')}>{busy==='reconcile'?'Checking status…':'Check subscription status'}</button>}</aside>
    </div>
    {error&&<p className="billing-notice billing-error" role="alert">{error} <a href="https://getbinflow.com/support/" target="_blank" rel="noreferrer">Contact support</a></p>}
    {message&&<p className="billing-notice" role="status">{message}</p>}
    <footer className="billing-recovery"><div><h3>Your records stay yours.</h3><p>Subscription changes never delete your tickets or inventory. Account management and deletion remain available.</p></div><div className="billing-actions"><button className="billing-secondary" onClick={onAccount}>My Account</button>{admin&&<button className="billing-secondary" disabled={!!busy} onClick={()=>action('export')}>{busy==='export'?'Preparing export…':'Export farm data'}</button>}</div></footer>
  </section>;
}
