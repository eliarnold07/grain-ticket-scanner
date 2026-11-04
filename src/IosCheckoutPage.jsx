import React, { useRef, useState } from 'react';
import './billing.css';

export function IosCheckoutPage({ state, code, apiBase }) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const submitted = useRef(false);
  const selecting = state === 'ios-handoff' && /^[A-Za-z0-9_-]{43}$/.test(code);
  async function submit(event) {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    try {
      const interval = new FormData(event.currentTarget).get('interval');
      const res = await fetch(apiBase + '/api/billing/ios-handoff/redeem', {
        method:'POST', credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:code,interval}),
        signal:AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error();
      const {url} = await res.json();
      const destination = new URL(url);
      if (destination.origin !== 'https://checkout.stripe.com' || destination.username || destination.password) throw new Error();
      window.location.replace(destination.href);
    } catch {
      setError('Checkout could not be opened. Return to BinFlow and request a new link.');
      setBusy(false);
    }
  }
  return <main className="billing-view" aria-labelledby="ios-checkout-title">
    <header className="billing-heading"><p className="billing-eyebrow">BINFLOW FARM SUBSCRIPTION</p>
      <h1 id="ios-checkout-title">{selecting ? 'Choose your farm plan' : 'Return to BinFlow'}</h1>
    </header>
    {selecting ? <form className="billing-plan" onSubmit={submit}>
      <fieldset className="billing-plan-picker" disabled={busy || Boolean(error)}>
        <legend>Both plans include your whole farm</legend>
        <label className="billing-choice"><input type="radio" name="interval" value="month" defaultChecked /> Monthly · $29.99/month</label>
        <label className="billing-choice"><input type="radio" name="interval" value="year" /> Annual · $299.99 billed once per year</label>
      </fieldset>
      <p>Eligible farms receive a 30-day free trial. Stripe confirms the price, first payment date and renewal terms before you subscribe.</p>
      <button className="billing-primary" disabled={busy || Boolean(error)}>{busy ? 'Opening Stripe…' : 'Continue to Stripe'}</button>
      {error && <p role="alert">{error}</p>}
    </form> : <p role="status">{state === 'ios-returned'
      ? 'Switch back to the BinFlow app. It will check your farm’s subscription status.'
      : state === 'ios-canceled'
      ? 'Checkout was interrupted. Switch back to BinFlow to check your status or try again.'
      : 'This Checkout link is unavailable. Open BinFlow to request a new link.'}</p>}
  </main>;
}
