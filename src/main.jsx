import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const OTHER_VALUE = '__other__';

const fieldLabels = {
  date: 'Date?',
  crop: 'Crop?',
  ticket_number: 'Ticket number',
  bushels: 'Bushels',
  delivered_to: 'Delivered To',
  hauled_by: 'Hauled By',
  moisture: 'Moisture',
  hauled_from: 'Hauled From'
};

const fields = Object.keys(fieldLabels);

function emptyTicket() {
  return Object.fromEntries(fields.map((field) => [field, '']));
}

function cleanMessage(error) {
  if (error?.message?.includes('Failed to fetch')) {
    return 'Network connection failed. Check that the backend is running and try again.';
  }

  return error.message || 'Something went wrong. Please try again.';
}

function uniqueOptions(values = []) {
  const seen = new Set();

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [ticket, setTicket] = useState(emptyTicket);
  const [duplicate, setDuplicate] = useState(null);
  const [dropdowns, setDropdowns] = useState({
    bins: [],
    haulers: [],
    destinations: [],
    missing_tabs: []
  });
  const [otherValues, setOtherValues] = useState({
    delivered_to: '',
    hauled_by: '',
    hauled_from: ''
  });
  const [otherSelections, setOtherSelections] = useState({
    delivered_to: false,
    hauled_by: false,
    hauled_from: false
  });
  const [status, setStatus] = useState('Choose or take a photo to begin.');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingDropdowns, setIsLoadingDropdowns] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);

  const filledCount = useMemo(
    () => fields.filter((field) => ticket[field]?.trim()).length,
    [ticket]
  );

  useEffect(() => {
    loadDropdowns();
    const intervalId = window.setInterval(() => loadDropdowns({ silent: true }), 60000);
    const handleFocus = () => loadDropdowns({ silent: true });

    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  async function loadDropdowns(options = {}) {
    if (!options.silent) {
      setIsLoadingDropdowns(true);
    }

    try {
      const response = await fetch(`${API_BASE}/api/dropdowns`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ? `${data.error} ${data.detail}` : data.error || 'Could not load dropdowns.');
      }

      setDropdowns({
        bins: uniqueOptions(data.bins),
        haulers: uniqueOptions(data.haulers),
        destinations: uniqueOptions(data.destinations),
        missing_tabs: data.missing_tabs || []
      });

      if (data.missing_tabs?.length) {
        setStatus(`Dropdowns loaded, but missing sheet tabs: ${data.missing_tabs.join(', ')}.`);
      }
    } catch (error) {
      if (!options.silent) {
        setStatus(cleanMessage(error));
      }
    } finally {
      if (!options.silent) {
        setIsLoadingDropdowns(false);
      }
    }
  }

  function resetForNextTicket() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl('');
    setTicket(emptyTicket());
    setOtherValues({
      delivered_to: '',
      hauled_by: '',
      hauled_from: ''
    });
    setOtherSelections({
      delivered_to: false,
      hauled_by: false,
      hauled_from: false
    });
    setDuplicate(null);
    setIsSuccess(false);
    setStatus('Choose or take a photo to begin.');
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    setSelectedFile(file || null);
    setDuplicate(null);
    setIsSuccess(false);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
      setStatus('Photo ready. Run extraction when the ticket is clear in the frame.');
    } else {
      setPreviewUrl('');
      setStatus('Choose or take a photo to begin.');
    }
  }

  function updateField(field, value) {
    setTicket((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleDropdownChange(field, value) {
    if (value === OTHER_VALUE) {
      setOtherSelections((current) => ({
        ...current,
        [field]: true
      }));
      setOtherValues((current) => ({
        ...current,
        [field]: ticket[field]
      }));
      updateField(field, otherValues[field] || '');
      return;
    }

    updateField(field, value);
    setOtherSelections((current) => ({
      ...current,
      [field]: false
    }));
    setOtherValues((current) => ({
      ...current,
      [field]: ''
    }));
  }

  function handleOtherChange(field, value) {
    setOtherValues((current) => ({
      ...current,
      [field]: value
    }));
    setOtherSelections((current) => ({
      ...current,
      [field]: true
    }));
    updateField(field, value);
  }

  function dropdownValue(field, options) {
    if (otherSelections[field]) {
      return OTHER_VALUE;
    }

    if (!ticket[field]) {
      return '';
    }

    return options.some((option) => option.toLowerCase() === ticket[field].toLowerCase())
      ? options.find((option) => option.toLowerCase() === ticket[field].toLowerCase())
      : OTHER_VALUE;
  }

  async function extractTicket() {
    if (!selectedFile) {
      setStatus('Please choose or take a ticket photo first.');
      return;
    }

    setIsExtracting(true);
    setIsSuccess(false);
    setStatus('Reading ticket image...');

    const formData = new FormData();
    formData.append('ticketImage', selectedFile);

    try {
      const response = await fetch(`${API_BASE}/api/extract-ticket`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ? `${data.error} ${data.detail}` : data.error || 'OCR failed.');
      }

      setTicket((current) => ({
        ...emptyTicket(),
        ...data.ticket,
        hauled_by: current.hauled_by,
        hauled_from: current.hauled_from
      }));
      setDuplicate(data.duplicate);
      setStatus('Extraction complete. Review every field before submitting.');
    } catch (error) {
      setStatus(cleanMessage(error));
    } finally {
      setIsExtracting(false);
    }
  }

  async function submitTicket(event) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setIsSuccess(false);
    setStatus('Submitting reviewed data...');

    try {
      const response = await fetch(`${API_BASE}/api/submit-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ticket })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ? `${data.error} ${data.detail}` : data.error || 'Submit failed.');
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setSelectedFile(null);
      setPreviewUrl('');
      setTicket(emptyTicket());
      setOtherValues({
        delivered_to: '',
        hauled_by: '',
        hauled_from: ''
      });
      setOtherSelections({
        delivered_to: false,
        hauled_by: false,
        hauled_from: false
      });
      setDuplicate(null);
      setIsSuccess(true);
      setStatus(data.message || 'Ticket submitted successfully');
    } catch (error) {
      setStatus(cleanMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderDropdownField(field, options, placeholder) {
    const value = dropdownValue(field, options);
    const isOther = value === OTHER_VALUE;

    return (
      <label className="field">
        <span>{fieldLabels[field]}</span>
        <select value={value} onChange={(event) => handleDropdownChange(field, event.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={OTHER_VALUE}>Other</option>
        </select>
        {isOther && (
          <input
            className="other-input"
            type="text"
            value={ticket[field]}
            onChange={(event) => handleOtherChange(field, event.target.value)}
            placeholder={`Enter ${fieldLabels[field]}`}
          />
        )}
      </label>
    );
  }

  return (
    <main className="app-shell">
      <section className="header-band">
        <div>
          <p className="eyebrow">Mobile field capture</p>
          <h1>Grain Ticket Scanner</h1>
        </div>
        <div className="status-pill">{filledCount}/{fields.length} fields</div>
      </section>

      {isSuccess && (
        <section className="success-panel" aria-live="polite">
          <p className="success-kicker">Saved to Google Sheets</p>
          <h2>Ticket submitted successfully</h2>
          <button className="primary-button" type="button" onClick={resetForNextTicket}>
            Scan Another Ticket
          </button>
        </section>
      )}

      <section className="capture-panel">
        <label className="upload-target">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={isExtracting || isSubmitting}
          />
          {previewUrl ? (
            <img src={previewUrl} alt="Selected grain ticket preview" />
          ) : (
            <span>Tap to take or upload a ticket photo</span>
          )}
        </label>

        <button className="primary-button" onClick={extractTicket} disabled={isExtracting || isSubmitting || !selectedFile}>
          {isExtracting ? 'Scanning Ticket...' : 'Extract Ticket Data'}
        </button>

        <p className="status-text">{status}</p>

        {isLoadingDropdowns && (
          <div className="notice">Loading shared dropdowns from Google Sheets...</div>
        )}

        {dropdowns.missing_tabs.length > 0 && (
          <div className="notice warning">
            Missing dropdown tabs: {dropdowns.missing_tabs.join(', ')}. Other entries still work.
          </div>
        )}

        {duplicate && (
          <div className={duplicate.is_duplicate ? 'notice warning' : 'notice'}>
            {duplicate.message}
          </div>
        )}
      </section>

      <form className="review-form" onSubmit={submitTicket}>
        <div className="form-heading">
          <h2>Review Ticket Data</h2>
          <p>Edit anything that does not look right before submitting.</p>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>{fieldLabels.date}</span>
            <input type="text" value={ticket.date} onChange={(event) => updateField('date', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.crop}</span>
            <input type="text" value={ticket.crop} onChange={(event) => updateField('crop', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.ticket_number}</span>
            <input type="text" value={ticket.ticket_number} onChange={(event) => updateField('ticket_number', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.bushels}</span>
            <input type="text" inputMode="decimal" value={ticket.bushels} onChange={(event) => updateField('bushels', event.target.value)} />
          </label>

          {renderDropdownField('delivered_to', dropdowns.destinations, 'Choose Delivered To')}
          {renderDropdownField('hauled_by', dropdowns.haulers, 'Choose Hauled By')}

          <label className="field">
            <span>{fieldLabels.moisture}</span>
            <input type="text" inputMode="decimal" value={ticket.moisture} onChange={(event) => updateField('moisture', event.target.value)} />
          </label>

          {renderDropdownField('hauled_from', dropdowns.bins, 'Choose Hauled From')}
        </div>

        <button className="submit-button" type="submit" disabled={isSubmitting || isExtracting}>
          {isSubmitting ? 'Submitting Ticket...' : 'Submit Reviewed Ticket'}
        </button>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
