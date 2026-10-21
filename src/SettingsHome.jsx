import React, { useEffect, useRef } from 'react';
import { SETTINGS_GROUPS } from './settingsNavigation.js';

export default function SettingsHome({ role, onOpen }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="settings-view settings-home" aria-labelledby="settings-title">
    <h2 id="settings-title" ref={heading} tabIndex={-1}>Settings</h2>
    {SETTINGS_GROUPS.filter(group => !group.adminOnly || role === 'admin').map(group => <section className="settings-group" key={group.title}>
      <h3>{group.title}</h3>
      <div className="settings-menu">{group.items.map(item => <button key={item.view} type="button" onClick={() => onOpen(item.view)}>
        <span><strong>{item.label}</strong><small>{item.detail}</small></span><span aria-hidden="true">&#8250;</span>
      </button>)}</div>
    </section>)}
    <div className="settings-links"><a href="https://getbinflow.com/support/" target="_blank" rel="noreferrer">Support</a><a href="https://getbinflow.com/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a></div>
  </section>;
}
