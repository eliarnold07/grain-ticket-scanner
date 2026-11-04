import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import BillingSettings from '../src/BillingSettings.jsx';
import '../src/styles.css';
function Preview(){
  const [platform,setPlatform]=useState('web');const [role,setRole]=useState('admin');const [status,setStatus]=useState('none');const [notice,setNotice]=useState('');
  const access=['trialing','active'].includes(status);
  const entitlement={status,enforcement_mode:'enforced',has_access:access,reason:access?'paid':'expired',valid_until:access?new Date(Date.now()+86400000).toISOString():null};
  async function apiFetch(path){
    if(path.endsWith('/status')) return Response.json({entitlement,can_checkout:['none','canceled'].includes(status),can_portal:status!=='none',trial_eligible:status==='none',next_billing_at:access?new Date(Date.now()+30*86400000).toISOString():null});
    if(path.endsWith('/price')) return Response.json({amount:2999,currency:'usd',trial_days:30,annual:{amount:29999,currency:'usd',interval:'year'}});
    setNotice('Local visual preview only. No Stripe, account or farm service was contacted.');
    return Response.json({code:'PREVIEW_ONLY',error:'This preview cannot change subscriptions.'},{status:503});
  }
  return <main className="app-shell"><section className="billing-view"><h1>Local billing preview</h1><p>Fictional UI states only. Excluded from production build.</p>
    <label>Platform <select value={platform} onChange={e=>setPlatform(e.target.value)}><option>web</option><option>ios</option><option>android</option></select></label>{' '}
    <label>Role <select value={role} onChange={e=>setRole(e.target.value)}><option>admin</option><option>employee</option></select></label>{' '}
    <label>Status <select value={status} onChange={e=>setStatus(e.target.value)}>{['none','trialing','active','past_due','unpaid','incomplete','paused','canceled'].map(s=><option key={s}>{s}</option>)}</select></label>
    {notice&&<p role="status">{notice}</p>}</section>
    <BillingSettings key={platform+role+status} platform={platform} account={{role}} entitlement={entitlement} apiFetch={apiFetch} onRefresh={async()=>{}} onAccount={()=>setNotice('My Account remains accessible in the full app.')} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
