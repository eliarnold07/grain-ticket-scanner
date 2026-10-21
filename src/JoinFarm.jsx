import React, { useEffect, useRef, useState } from 'react';
import { signInFarm, signOutFarm } from './supabaseAuth.js';
import { cleanMessage, readErrorResponse } from './apiErrors.js';
import { fetchWithTimeout, readJsonWithTimeout } from './network.js';

export default function JoinFarm({ apiBase, onSession, onLogin }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState(null);
  const [existing, setExisting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    let session;
    try {
      if (preview && existing) session = await signInFarm({ email, password }, { persist: false });
      const response = await fetchWithTimeout(`${apiBase}/api/farm-invites/${preview ? existing ? 'accept' : 'register' : 'preview'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify(preview ? { join_token: preview.join_token, email, password } : { code })
      }, 20000);
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await readJsonWithTimeout(response);
      if (!active.current) {
        if (session || data.access_token) await signOutFarm((session || data).access_token, { clearLocal: false });
        return;
      }
      if (!preview) {
        if (!/^[a-f0-9-]{36}$/i.test(data.join_token || '') || !data.farm_name) throw new Error('Invalid invitation response');
        setPreview(data); return;
      }
      const result = session || data;
      if (result.access_token) onSession(result);
      else { setPreview(null); onLogin('Check your email to confirm your account, then log in.'); }
    } catch (error) {
      if (session) await signOutFarm(session.access_token, { clearLocal: false });
      if (active.current) { setMessage(cleanMessage(error)); setPreview(null); }
    } finally { if (active.current) { setPassword(''); setBusy(false); } lock.current = false; }
  }
  return <form onSubmit={submit} aria-busy={busy}>
    <h2>{preview ? `Join ${preview.farm_name}` : 'Join your farm'}</h2>
    {preview ? <>
      <p>New farm members join as Employees. Existing memberships are not changed.</p>
      <label className="confirmation-check"><input type="checkbox" checked={existing} disabled={busy} onChange={event => setExisting(event.target.checked)} />I already have a BinFlow login</label>
      <label className="field"><span>Email</span><input type="email" autoComplete="email" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete={existing ? 'current-password' : 'new-password'} minLength={8} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      <button type="button" disabled={busy} onClick={() => setPreview(null)}>Use a different code</button>
    </> : <label className="field"><span>Farm invitation code</span><input required value={code} disabled={busy} maxLength={40} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={event => setCode(event.target.value)} /></label>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait...' : preview ? existing ? 'Log In and Join Farm' : 'Create Login and Join Farm' : 'Find Farm'}</button>
    {message && <p role="alert">{message}</p>}
  </form>;
}
