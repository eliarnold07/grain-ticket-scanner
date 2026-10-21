import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { fetchWithTimeout, withDeadline } from './network.js';

export default function TicketPhotoCapture({ previewUrl, onPhoto, disabled }) {
  const native = Capacitor.isNativePlatform();
  const input = useRef(null), lock = useRef(false), active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [notice, setNotice] = useState(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function choose(source) {
    if (disabled || lock.current) return;
    if (!native) { input.current?.click(); return; }
    lock.current = true; setBusy(true); setNotice(null);
    setPhase(source === CameraSource.Camera ? 'Opening camera...' : 'Opening photo library...');
    try {
      if (!Capacitor.isPluginAvailable('Camera')) throw { code: 'UNIMPLEMENTED' };
      const photo = await Camera.getPhoto({ source, resultType: CameraResultType.Uri,
        quality: 85, allowEditing: false, saveToGallery: false });
      if (!photo?.webPath) throw new Error('Missing photo');
      if (active.current) setPhase('Preparing photo...');
      const response = await fetchWithTimeout(photo.webPath, {}, 20000);
      if (!response.ok) throw new Error('Unreadable photo');
      const blob = await withDeadline(() => response.blob(), 20000);
      const extension = photo.format || 'jpg';
      if (active.current) onPhoto(new File([blob], `grain-ticket.${extension}`, {
        type: blob.type || `image/${extension}`, lastModified: Date.now()
      }));
    } catch (error) {
      if (!active.current) return;
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('cancel')) setNotice({ message: 'No photo selected.', error: false });
      else if (/denied|permission|restricted/.test(message)) setNotice({
        message: `${source === CameraSource.Camera ? 'Camera' : 'Photo'} access is off. Allow access in iPhone Settings, then try again.`, error: true, settings: true
      });
      else setNotice({ message: error?.code === 'UNIMPLEMENTED' || /info.plist|usageDescription/i.test(message)
        ? 'The photo tool is unavailable in this app build. Please contact BinFlow support.'
        : 'Could not open that photo. Please try again.', error: true });
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }

  return <div className="ticket-photo-capture" aria-busy={busy}>
    {previewUrl ? <div className="upload-target photo-preview"><img src={previewUrl} alt="Selected grain ticket preview" /></div>
      : <button type="button" className="upload-target photo-target" disabled={disabled || busy}
        onClick={() => choose(CameraSource.Camera)} aria-label={native ? 'Take a ticket photo' : 'Choose a ticket photo'}>
        {busy ? phase : native ? 'Tap to take a ticket photo' : 'Tap to choose a ticket photo'}
      </button>}
    {busy && <p className="photo-feedback" role="status">{phase}</p>}
    {notice && <p className="photo-feedback" role={notice.error ? 'alert' : 'status'}>
      {notice.message} {notice.settings && Capacitor.getPlatform() === 'ios' && <a href="app-settings:">Open Settings</a>}
    </p>}
    {native ? <div className="capture-actions">
      <button type="button" disabled={disabled || busy} onClick={() => choose(CameraSource.Camera)}>{previewUrl ? 'Retake Photo' : 'Take Photo'}</button>
      <button type="button" disabled={disabled || busy} onClick={() => choose(CameraSource.Photos)}>Choose Photo</button>
    </div> : <>
      <input ref={input} className="photo-file-input" type="file" accept="image/*" capture="environment" disabled={disabled}
        aria-label="Choose or take a ticket photo" onChange={event => {
          const file = event.target.files?.[0]; if (file) { setNotice(null); onPhoto(file); } event.target.value = '';
        }} />
      <button type="button" className="file-picker-button" disabled={disabled} onClick={() => input.current?.click()}>Choose or Take Photo</button>
    </>}
    {previewUrl && <button type="button" className="text-button remove-photo" disabled={disabled || busy}
      onClick={() => { setNotice(null); onPhoto(null); }}>Remove Photo</button>}
  </div>;
}
