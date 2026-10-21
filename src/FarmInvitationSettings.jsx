import React, { useEffect, useRef, useState } from 'react';
import { cleanMessage, readErrorResponse } from './apiErrors.js';
import { readJsonWithTimeout } from './network.js';

// Uses the existing invitation API; never fabricates or persists an invite code.
export default function FarmInvitationSettings({ apiFetch, available }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (!available) setCode(''); }, [available]);
  async function load(rotate = false) {
    if (lock.current || !available) return;
    if (rotate && !window.confirm('Replace the farm invitation code? The old code will stop working immediately. Existing members keep their access.')) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await apiFetch(`/api/users/invitation${rotate ? '/rotate' : ''}`, { method: rotate ? 'POST' : 'GET', timeoutMs: 20000 });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await readJsonWithTimeout(response);
      if (!/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/.test(data.code || '')) throw new Error('Invalid response');
      if (active.current) setCode(data.code);
    } catch (error) { if (active.current) { setCode(''); setMessage(cleanMessage(error)); } }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function revoke() {
    if (lock.current || !available || !window.confirm('Revoke the farm invitation code? Pending joins will stop working. Existing members keep their farm access.')) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await apiFetch('/api/users/invitation/revoke', { method: 'POST', timeoutMs: 20000 });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      if ((await readJsonWithTimeout(response))?.revoked !== true) throw new Error('Unconfirmed revocation');
      if (active.current) { setCode(''); setMessage('Invitation revoked. Existing members keep their access.'); }
    } catch (error) { if (active.current) { setCode(''); setMessage(cleanMessage(error)); } }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <section className="farm-invitation" aria-labelledby="farm-invitation-title">
    <h3 id="farm-invitation-title">Farm invitation</h3>
    <p>Share your farm code only with people you authorize to join as Employees.</p>
    {code && <label className="field"><span>Farm invitation code</span><input readOnly value={code} onFocus={event => event.target.select()} /></label>}
    {!available && <p>Invitation codes are not enabled yet. Your existing farm memberships are unchanged.</p>}
    {available && <div className="settings-actions"><button type="button" disabled={busy} onClick={() => load()}>{busy ? 'Loading...' : code ? 'Refresh Code' : 'Show Farm Code'}</button>
      {code && <><button type="button" disabled={busy} onClick={async () => {
        try { await navigator.clipboard.writeText(code); setMessage('Code copied.'); }
        catch { setMessage('Select the code above to copy it.'); }
      }}>Copy Code</button><button type="button" disabled={busy} onClick={() => load(true)}>Replace Code</button>
      <button type="button" disabled={busy} onClick={revoke}>Revoke Code</button></>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
