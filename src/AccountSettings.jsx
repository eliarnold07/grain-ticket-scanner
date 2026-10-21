import React, { useEffect, useRef, useState } from 'react';
import { canConfirmDeletion, deletionErrorMessage, readDeletionResponse } from './accountDeletionClient.js';

export default function AccountSettings({ account, farm, apiFetch, onDeleted, onBack }) {
  const [screen, setScreen] = useState('account');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [successorId, setSuccessorId] = useState('');
  const busy = useRef(false);
  const request = useRef(0);
  const heading = useRef(null);

  useEffect(() => {
    heading.current?.focus();
  }, [screen]);
  useEffect(() => () => { request.current += 1; }, []);

  function resetConfirmation() {
    setEmail('');
    setPassword('');
    setAcknowledged(false);
    setSuccessorId('');
  }

  async function reviewDeletion() {
    if (busy.current) return;
    setScreen('deletion');
    setPreview(null);
    setMessage('');
    resetConfirmation();
    setLoading(true);
    const id = ++request.current;
    try {
      const data = await readDeletionResponse(await apiFetch('/api/account-deletion'), { preview: true });
      if (id === request.current) setPreview(data);
    } catch (error) {
      if (id === request.current) setMessage(deletionErrorMessage(error));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  async function submitDeletion(event) {
    event.preventDefault();
    if (busy.current || !canConfirmDeletion({ preview, email, accountEmail: account.email, password, acknowledged, successorId })) return;
    busy.current = true;
    setDeleting(true);
    setMessage('');
    try {
      await readDeletionResponse(await apiFetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: email, password, acknowledged, successorId })
      }, false));
      onDeleted();
    } catch (error) {
      setMessage(deletionErrorMessage(error));
      setPreview(null);
    } finally {
      setPassword('');
      setDeleting(false);
      busy.current = false;
    }
  }

  return (
    <section className="settings-view" aria-labelledby="account-settings-title" aria-busy={loading || deleting}>
      <button className="settings-back" type="button" disabled={deleting} onClick={() => {
        if (screen === 'deletion') {
          request.current += 1;
          resetConfirmation();
          setScreen('account');
        } else onBack();
      }}>{screen === 'deletion' ? 'Back to Account' : 'Back to Settings'}</button>
      <p className="eyebrow">Settings / Account</p>
      <h2 id="account-settings-title" ref={heading} tabIndex={-1}>{screen === 'deletion' ? 'Delete account' : 'Account Settings'}</h2>
      {screen === 'account' ? <>
        <dl className="account-details">
          <div><dt>Name</dt><dd>{account.display_name || 'Not provided'}</dd></div>
          <div><dt>Email</dt><dd>{account.email}</dd></div>
          <div><dt>Farm</dt><dd>{farm?.name || 'Your farm'}</dd></div>
          <div><dt>Role</dt><dd>{account.role === 'admin' ? 'Administrator' : 'Employee'}</dd></div>
        </dl>
        <div className="settings-support">
          <h3>Need help?</h3>
          <a href="mailto:eli@getbinflow.com">eli@getbinflow.com</a>
        </div>
        <div className="account-delete-option">
          <h3>Account access</h3>
          <p>Permanently remove your personal BinFlow account.</p>
          <button type="button" className="delete-account-link" onClick={reviewDeletion}>Delete account</button>
        </div>
      </> : <>
        <p className="settings-intro">Review what happens before permanently deleting your account. This cannot be undone.</p>
        {loading && <p role="status">Checking your account...</p>}
        {preview && <>
          <ul className="deletion-consequences">
            <li>Your login, personal account profile, and farm membership will be deleted.</li>
            <li>You will lose access to {farm?.name || 'this farm'} on every device.</li>
            <li>Farm tickets, bins, balances, contracts, payments, and other members are not deleted. Your ticket-scanning name and account reference will be removed.</li>
            {preview.eligibility.archives_farm && <li>As the only member, your farm will be archived without deleting its business history. Farm closure and record-retention requests are separate from deleting your login.</li>}
          </ul>
          {!preview.eligibility.allowed && <p className="settings-status" role="status">{preview.eligibility.transfer_required
            ? 'You are the only Administrator. Make another member an Administrator before deleting your account.'
            : 'We could not confirm that this account can be deleted safely. Contact BinFlow support for the next steps.'}</p>}
          {!preview.deletion_available && <p className="settings-status" role="status">Account deletion is not available right now. Please try again later or contact <a href="mailto:eli@getbinflow.com">BinFlow support</a>.</p>}
          {preview.deletion_available && preview.eligibility.allowed && <form className="delete-account-form" onSubmit={submitDeletion}>
            <label className="field"><span>Type your account email to confirm</span><input type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} disabled={deleting} required /></label>
            <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={deleting} required /></label>
            <label className="confirmation-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={deleting} />I understand that my account and farm access will be permanently removed.</label>
            {preview.eligibility.transfer_required && <label className="field"><span>New farm Administrator</span>
              <select value={successorId} onChange={event => setSuccessorId(event.target.value)} disabled={deleting} required>
                <option value="">Choose a farm member</option>
                {(preview.transfer_candidates || []).map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || 'Farm member'}</option>)}
              </select><small>This member becomes Administrator when your account is deleted. Their existing login and farm records are preserved.</small>
            </label>}
            <div className="settings-actions">
              <button type="button" className="secondary-button" disabled={deleting} onClick={() => { resetConfirmation(); setScreen('account'); }}>Keep Account</button>
              <button type="submit" className="danger-button" disabled={deleting || !canConfirmDeletion({ preview, email, accountEmail: account.email, password, acknowledged, successorId })}>{deleting ? 'Deleting...' : 'Permanently Delete Account'}</button>
            </div>
          </form>}
        </>}
        {message && <p className="settings-status" role="alert">{message}</p>}
        {!preview && !loading && <button type="button" className="secondary-button" disabled={deleting} onClick={reviewDeletion}>Try Again</button>}
      </>}
    </section>
  );
}
