import React, { useEffect, useRef, useState } from 'react';
import { cleanMessage, readErrorResponse } from './apiErrors.js';

export default function SavedNamesSettings({ kind, apiFetch, onBack, onChanged }) {
  const title = kind === 'locations' ? 'Locations' : 'Drivers';
  const singular = kind === 'locations' ? 'location' : 'driver';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const heading = useRef(null);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    heading.current?.focus();
    load();
    return () => { generation.current++; };
  }, []);

  async function load() {
    const request = ++generation.current;
    setLoading(true); setFailed(false);
    try {
      const response = await apiFetch(`/api/${kind}`);
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await response.json();
      if (request === generation.current) { setItems(data[kind] || []); setMessage(''); }
    } catch (error) {
      if (request === generation.current) { setFailed(true); setMessage(cleanMessage(error)); }
    } finally { if (request === generation.current) setLoading(false); }
  }

  async function mutate(method, id, value) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    const request = generation.current;
    try {
      const response = await apiFetch(`/api/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify({ name: value.trim() }) })
      });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      if (request !== generation.current) return;
      setName(''); setEditing(null);
      await load();
      onChanged();
    } catch (error) { if (request === generation.current) setMessage(cleanMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="settings-view" aria-busy={loading || busy}>
    <button className="settings-back" type="button" onClick={onBack} disabled={busy}>Back to Settings</button>
    <h2 ref={heading} tabIndex={-1}>{title}</h2>
    <form className="saved-name-form" onSubmit={event => { event.preventDefault(); mutate(editing ? 'PUT' : 'POST', editing, name); }}>
      <label className="field"><span>{editing ? 'Edit' : 'New'} {singular} name</span><input value={name} maxLength={100} autoComplete="off" required onChange={event => setName(event.target.value)} disabled={busy} /></label>
      <div className="settings-actions"><button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving...' : editing ? 'Save Changes' : `Add ${singular === 'location' ? 'Location' : 'Driver'}`}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setName(''); }} disabled={busy}>Cancel</button>}</div>
    </form>
    {message && <p role="alert" className="settings-status">{message}</p>}
    {loading ? <p role="status">Loading {kind}...</p> : failed ? <button type="button" onClick={load}>Try Again</button> : items.length === 0 ? <p className="settings-empty">No saved {kind} yet.</p> : <ul className="saved-names-list">{items.map(item => <li key={item.id}>
      <span>{item.name}</span><div><button type="button" disabled={busy} onClick={() => { setEditing(item.id); setName(item.name); heading.current?.scrollIntoView({ block: 'start' }); }}>Edit<span className="sr-only"> {item.name}</span></button>
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Remove ${item.name} from saved ${kind}? Existing tickets are not changed.`)) mutate('DELETE', item.id);
        }}>Remove<span className="sr-only"> {item.name}</span></button></div>
    </li>)}</ul>}
  </section>;
}
