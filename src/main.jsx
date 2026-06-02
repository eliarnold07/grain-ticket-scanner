import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const OTHER_VALUE = '__other__';
const MAX_IMAGE_DIMENSION = 1800;
const JPEG_QUALITY = 0.82;

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
const blankBinForm = {
  bin_name: '',
  crop_type: '',
  estimated_capacity_bushels: '',
  current_bushels: '',
  notes: ''
};
const blankTransactionForm = {
  transaction_type: 'ADD_GRAIN',
  bushel_amount: '',
  notes: ''
};

function emptyTicket() {
  return Object.fromEntries(fields.map((field) => [field, '']));
}

function cleanMessage(error) {
  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('Load failed')) {
    return `Network request failed: ${error.message}. Check that the backend URL and CORS settings are correct.`;
  }

  return error.message || 'Something went wrong. Please try again.';
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this photo. Please retake it or choose a different image.'));
    };
    image.src = url;
  });
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not prepare this photo for upload.'));
        }
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

async function convertImageToJpeg(file) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not prepare this photo for upload.');
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToJpegBlob(canvas);

  return new File([blob], 'grain-ticket.jpg', {
    type: 'image/jpeg',
    lastModified: Date.now()
  });
}

async function readErrorResponse(response) {
  const text = await response.text();

  if (!text) {
    return response.statusText || `Request failed with status ${response.status}`;
  }

  try {
    const data = JSON.parse(text);
    return data.detail ? `${data.error} ${data.detail}` : data.error || text;
  } catch {
    return text;
  }
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

function displayValue(value) {
  return String(value || '').trim() || '-';
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : displayValue(value);
}

function percentLabel(value) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function App() {
  const [activeView, setActiveView] = useState('dashboard');
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
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isLoadingDropdowns, setIsLoadingDropdowns] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [ticketLogs, setTicketLogs] = useState([]);
  const [bins, setBins] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [isLoadingBins, setIsLoadingBins] = useState(false);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [binForm, setBinForm] = useState(blankBinForm);
  const [editingBinId, setEditingBinId] = useState('');
  const [transactionForms, setTransactionForms] = useState({});
  const [historyFilters, setHistoryFilters] = useState({
    search: '',
    date: '',
    crop: '',
    ticket_number: '',
    elevator: ''
  });
  const [dashboard, setDashboard] = useState({
    kpis: {
      total_corn_inventory: 0,
      total_bean_inventory: 0,
      total_bushels_stored: 0,
      total_tickets_scanned: 0,
      total_bushels_sold: 0,
      active_bins: 0
    },
    charts: {
      inventory_by_crop: [
        { crop: 'Corn', bushels: 0 },
        { crop: 'Beans', bushels: 0 }
      ],
      storage_utilization: {
        current_bushels: 0,
        estimated_capacity: 0,
        percent_full: null
      },
      recent_ticket_activity: []
    },
    bin_overview: [],
    recent_activity: []
  });

  const filledCount = useMemo(
    () => fields.filter((field) => ticket[field]?.trim()).length,
    [ticket]
  );

  useEffect(() => {
    loadDropdowns();
    loadDashboard({ silent: true });
    loadTicketHistory({ silent: true });
    loadBins({ silent: true });
    loadDrivers({ silent: true });
    const intervalId = window.setInterval(() => loadDropdowns({ silent: true }), 60000);
    const handleFocus = () => loadDropdowns({ silent: true });

    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (activeView === 'dashboard') {
      loadDashboard({ silent: true });
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView !== 'history') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      loadTicketHistory({ silent: true });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [activeView, historyFilters]);

  async function loadDropdowns(options = {}) {
    if (!options.silent) {
      setIsLoadingDropdowns(true);
    }

    try {
      const response = await fetch(`${API_BASE}/api/dropdowns`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();

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

  async function loadDashboard(options = {}) {
    if (!options.silent) {
      setIsLoadingDashboard(true);
    }

    try {
      const response = await fetch(`${API_BASE}/api/dashboard`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setDashboard(data);
    } catch (error) {
      if (!options.silent) {
        setStatus(cleanMessage(error));
      }
    } finally {
      if (!options.silent) {
        setIsLoadingDashboard(false);
      }
    }
  }

  async function loadTicketHistory(options = {}) {
    if (!options.silent) {
      setIsLoadingHistory(true);
    }

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(historyFilters)) {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    }

    const query = params.toString();

    try {
      const response = await fetch(`${API_BASE}/api/ticket-logs${query ? `?${query}` : ''}`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setTicketLogs(data.logs || []);
    } catch (error) {
      if (!options.silent) {
        setStatus(cleanMessage(error));
      }
    } finally {
      if (!options.silent) {
        setIsLoadingHistory(false);
      }
    }
  }

  async function removeTicketLog(logId) {
    const confirmed = window.confirm('Delete this ticket log? If it changed bin inventory, that linked transaction will be removed too.');

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ticket-logs/${logId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadTicketHistory(), loadBins({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Ticket log deleted.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  async function loadBins(options = {}) {
    if (!options.silent) {
      setIsLoadingBins(true);
    }

    try {
      const response = await fetch(`${API_BASE}/api/bins`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setBins(data.bins || []);
    } catch (error) {
      if (!options.silent) {
        setStatus(cleanMessage(error));
      }
    } finally {
      if (!options.silent) {
        setIsLoadingBins(false);
      }
    }
  }

  async function loadDrivers(options = {}) {
    if (!options.silent) {
      setIsLoadingDrivers(true);
    }

    try {
      const response = await fetch(`${API_BASE}/api/drivers`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setDrivers(data.drivers || []);
    } catch (error) {
      if (!options.silent) {
        setStatus(cleanMessage(error));
      }
    } finally {
      if (!options.silent) {
        setIsLoadingDrivers(false);
      }
    }
  }

  async function createDriver(event) {
    event.preventDefault();

    try {
      const response = await fetch(`${API_BASE}/api/drivers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newDriverName })
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      setNewDriverName('');
      await Promise.all([loadDrivers(), loadDropdowns({ silent: true })]);
      setStatus('Driver added.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  async function removeDriver(driverId) {
    try {
      const response = await fetch(`${API_BASE}/api/drivers/${driverId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadDrivers(), loadDropdowns({ silent: true })]);
      setStatus('Driver removed.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  function updateBinForm(field, value) {
    setBinForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function resetBinForm() {
    setBinForm(blankBinForm);
    setEditingBinId('');
  }

  function startEditingBin(bin) {
    setEditingBinId(bin.id);
    setBinForm({
      bin_name: bin.bin_name || '',
      crop_type: bin.crop_type || '',
      estimated_capacity_bushels: String(bin.estimated_capacity_bushels || ''),
      current_bushels: String(bin.current_bushels || ''),
      notes: bin.notes || ''
    });
    setActiveView('inventory');
  }

  async function saveBin(event) {
    event.preventDefault();
    const isEditing = Boolean(editingBinId);

    try {
      const response = await fetch(`${API_BASE}/api/bins${isEditing ? `/${editingBinId}` : ''}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(binForm)
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      resetBinForm();
      await Promise.all([loadBins(), loadDropdowns({ silent: true }), loadDashboard({ silent: true })]);
      setStatus(isEditing ? 'Bin updated.' : 'Bin created.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  async function removeBin(binId) {
    const confirmed = window.confirm('Delete this bin? Existing inventory transactions will remain in the local history file.');

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/bins/${binId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadBins(), loadDropdowns({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Bin deleted.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  function transactionFormFor(binId) {
    return transactionForms[binId] || blankTransactionForm;
  }

  function updateTransactionForm(binId, field, value) {
    setTransactionForms((current) => ({
      ...current,
      [binId]: {
        ...transactionFormFor(binId),
        [field]: value
      }
    }));
  }

  async function saveInventoryTransaction(binId, event) {
    event.preventDefault();
    const form = transactionFormFor(binId);

    try {
      const response = await fetch(`${API_BASE}/api/inventory-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bin_id: binId,
          ...form
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      setTransactionForms((current) => ({
        ...current,
        [binId]: blankTransactionForm
      }));
      await Promise.all([loadBins(), loadDropdowns({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Inventory transaction saved.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  async function removeInventoryTransaction(transactionId) {
    const confirmed = window.confirm('Delete this transaction? If it came from a ticket, the linked ticket log will also be deleted.');

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/inventory-transactions/${transactionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadBins(), loadTicketHistory({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Inventory transaction deleted.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  function updateHistoryFilter(field, value) {
    setHistoryFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function clearHistoryFilters() {
    setHistoryFilters({
      search: '',
      date: '',
      crop: '',
      ticket_number: '',
      elevator: ''
    });
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
    setStatus('Preparing photo for upload...');

    const formData = new FormData();

    try {
      const uploadFile = await convertImageToJpeg(selectedFile);
      formData.append('ticketImage', uploadFile);
      setStatus('Reading ticket image...');

      const response = await fetch(`${API_BASE}/api/extract-ticket`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();

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

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();

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
      loadTicketHistory({ silent: true });
      loadDashboard({ silent: true });
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
        {options.length === 0 && field === 'hauled_by' && (
          <small className="field-help">Add drivers below to fill this dropdown.</small>
        )}
        {options.length === 0 && field === 'hauled_from' && (
          <small className="field-help">Create bins in Grain Bins to fill this dropdown.</small>
        )}
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
          <p className="eyebrow">Grain operations platform</p>
          <h1>BinFlow</h1>
        </div>
        <div className="status-pill">{filledCount}/{fields.length} fields</div>
      </section>

      <nav className="view-tabs" aria-label="App views">
        <button
          className={activeView === 'dashboard' ? 'active' : ''}
          type="button"
          onClick={() => {
            setActiveView('dashboard');
            loadDashboard();
          }}
        >
          Dashboard
        </button>
        <button
          className={activeView === 'scanner' ? 'active' : ''}
          type="button"
          onClick={() => setActiveView('scanner')}
        >
          Scanner
        </button>
        <button
          className={activeView === 'history' ? 'active' : ''}
          type="button"
          onClick={() => {
            setActiveView('history');
            loadTicketHistory();
          }}
        >
          Ticket History
        </button>
        <button
          className={activeView === 'inventory' ? 'active' : ''}
          type="button"
          onClick={() => {
            setActiveView('inventory');
            loadBins();
          }}
        >
          Grain Bins
        </button>
      </nav>

      {activeView === 'dashboard' && (
        <section className="dashboard-view">
          <div className="dashboard-hero">
            <div>
              <p className="eyebrow">Current inventory snapshot</p>
              <h2>Harvest operations at a glance</h2>
              <p>Track stored grain, scanned tickets, and recent inventory movement from one operational dashboard.</p>
            </div>
            <div className="quick-actions">
              <button type="button" onClick={() => setActiveView('scanner')}>Scan Ticket</button>
              <button type="button" onClick={() => setActiveView('inventory')}>Manage Bins</button>
              <button type="button" onClick={() => setActiveView('history')}>View Logs</button>
            </div>
          </div>

          <div className="kpi-grid">
            <article className="kpi-card corn">
              <span>Total Corn Inventory</span>
              <strong>{formatNumber(dashboard.kpis.total_corn_inventory)}</strong>
              <small>bushels</small>
            </article>
            <article className="kpi-card beans">
              <span>Total Bean Inventory</span>
              <strong>{formatNumber(dashboard.kpis.total_bean_inventory)}</strong>
              <small>bushels</small>
            </article>
            <article className="kpi-card">
              <span>Total Bushels Stored</span>
              <strong>{formatNumber(dashboard.kpis.total_bushels_stored)}</strong>
              <small>across all bins</small>
            </article>
            <article className="kpi-card">
              <span>Total Tickets Scanned</span>
              <strong>{formatNumber(dashboard.kpis.total_tickets_scanned)}</strong>
              <small>local ticket logs</small>
            </article>
            <article className="kpi-card">
              <span>Total Bushels Sold</span>
              <strong>{formatNumber(dashboard.kpis.total_bushels_sold)}</strong>
              <small>ticket sale transactions</small>
            </article>
            <article className="kpi-card">
              <span>Number of Active Bins</span>
              <strong>{formatNumber(dashboard.kpis.active_bins)}</strong>
              <small>managed storage</small>
            </article>
          </div>

          <div className="dashboard-grid">
            <section className="dashboard-card">
              <div className="section-title-row">
                <div>
                  <h2>Inventory by Crop</h2>
                  <p>Current bushels by commodity.</p>
                </div>
              </div>
              <div className="mini-chart">
                {dashboard.charts.inventory_by_crop.map((item) => {
                  const max = Math.max(...dashboard.charts.inventory_by_crop.map((chartItem) => Number(chartItem.bushels) || 0), 1);
                  const width = ((Number(item.bushels) || 0) / max) * 100;
                  return (
                    <div className="chart-row" key={item.crop}>
                      <span>{item.crop}</span>
                      <div><i style={{ width: `${width}%` }} /></div>
                      <strong>{formatNumber(item.bushels)}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dashboard-card">
              <div className="section-title-row">
                <div>
                  <h2>Storage Utilization</h2>
                  <p>Estimated capacity used across active bins.</p>
                </div>
              </div>
              <div className="utilization-ring">
                <strong>{percentLabel(dashboard.charts.storage_utilization.percent_full)}</strong>
                <span>{formatNumber(dashboard.charts.storage_utilization.current_bushels)} of {formatNumber(dashboard.charts.storage_utilization.estimated_capacity)} bu</span>
              </div>
              <div className="capacity-bar large">
                <span style={{ width: `${Math.min(100, Math.max(0, dashboard.charts.storage_utilization.percent_full || 0))}%` }} />
              </div>
            </section>
          </div>

          <section className="dashboard-card">
            <div className="section-title-row">
              <div>
                <h2>Bin Overview</h2>
                <p>Current balances and storage risk by bin.</p>
              </div>
              <button type="button" onClick={() => setActiveView('inventory')}>Open Bins</button>
            </div>
            <div className="dashboard-bin-grid">
              {dashboard.bin_overview.length === 0 ? (
                <div className="premium-empty">No bins created yet. Add bins to start building inventory analytics.</div>
              ) : dashboard.bin_overview.map((bin) => {
                const percent = bin.percent_full === null ? 0 : Math.round(bin.percent_full);
                const statusClass = percent >= 90 ? 'near-full' : percent <= 10 ? 'low' : '';
                return (
                  <article className={`dashboard-bin-card ${statusClass}`} key={bin.id}>
                    <div>
                      <h3>{bin.bin_name}</h3>
                      <p>{displayValue(bin.crop_type)}</p>
                    </div>
                    <strong>{formatNumber(bin.current_bushels)} bu</strong>
                    <div className="capacity-bar">
                      <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                    </div>
                    <small>{percentLabel(bin.percent_full)} full · {formatNumber(bin.estimated_capacity_bushels)} bu capacity</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="dashboard-card">
            <div className="section-title-row">
              <div>
                <h2>Recent Activity</h2>
                <p>Ticket scans, inventory changes, manual adjustments, and reversals.</p>
              </div>
              <button type="button" onClick={() => loadDashboard()} disabled={isLoadingDashboard}>
                {isLoadingDashboard ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="activity-list">
              {dashboard.recent_activity.length === 0 ? (
                <div className="premium-empty">No activity yet. Scanned tickets and inventory changes will appear here.</div>
              ) : dashboard.recent_activity.map((activity) => (
                <article className="activity-item" key={activity.id}>
                  <span className={`activity-badge ${activity.type.toLowerCase().replaceAll('_', '-')}`}>{activity.type.replaceAll('_', ' ')}</span>
                  <div>
                    <h3>{activity.label}</h3>
                    <p>{activity.detail}</p>
                  </div>
                  <time>{new Date(activity.timestamp).toLocaleString()}</time>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}

      {activeView === 'history' && (
        <section className="history-panel">
          <div className="form-heading">
            <h2>Ticket History</h2>
            <p>Review saved ticket logs from this development app database.</p>
          </div>

          <div className="history-filters">
            <label className="field">
              <span>Search</span>
              <input
                type="text"
                value={historyFilters.search}
                onChange={(event) => updateHistoryFilter('search', event.target.value)}
                placeholder="Ticket, bin, hauler, notes"
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input
                type="text"
                value={historyFilters.date}
                onChange={(event) => updateHistoryFilter('date', event.target.value)}
                placeholder="5/29/2026"
              />
            </label>
            <label className="field">
              <span>Crop</span>
              <input
                type="text"
                value={historyFilters.crop}
                onChange={(event) => updateHistoryFilter('crop', event.target.value)}
                placeholder="Corn or Beans"
              />
            </label>
            <label className="field">
              <span>Ticket number</span>
              <input
                type="text"
                value={historyFilters.ticket_number}
                onChange={(event) => updateHistoryFilter('ticket_number', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Elevator</span>
              <input
                type="text"
                value={historyFilters.elevator}
                onChange={(event) => updateHistoryFilter('elevator', event.target.value)}
                placeholder="Rock Port"
              />
            </label>
          </div>

          <div className="history-actions">
            <button type="button" onClick={() => loadTicketHistory()} disabled={isLoadingHistory}>
              {isLoadingHistory ? 'Loading...' : 'Refresh History'}
            </button>
            <button type="button" onClick={clearHistoryFilters}>
              Clear Filters
            </button>
          </div>

          <div className="history-count">{ticketLogs.length} ticket logs</div>

          <div className="ticket-log-list">
            {ticketLogs.length === 0 ? (
              <div className="empty-history">No ticket logs found.</div>
            ) : (
              ticketLogs.map((log) => (
                <article className="ticket-log-card" key={log.id}>
                  <div className="ticket-log-head">
                    <div>
                      <h3>{displayValue(log.ticket_number)}</h3>
                      <p>{displayValue(log.date)} · {displayValue(log.crop)}</p>
                    </div>
                    <div className="ticket-log-actions">
                      <strong>{displayValue(log.bushels)} bu</strong>
                      <button type="button" onClick={() => removeTicketLog(log.id)} aria-label={`Delete ticket ${displayValue(log.ticket_number)}`}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <dl className="ticket-log-details">
                    <div>
                      <dt>Elevator/Grainery</dt>
                      <dd>{displayValue(log.elevator)}</dd>
                    </div>
                    <div>
                      <dt>Gross Weight</dt>
                      <dd>{displayValue(log.gross_weight)}</dd>
                    </div>
                    <div>
                      <dt>Tare Weight</dt>
                      <dd>{displayValue(log.tare_weight)}</dd>
                    </div>
                    <div>
                      <dt>Net Weight</dt>
                      <dd>{displayValue(log.net_weight)}</dd>
                    </div>
                    <div>
                      <dt>Moisture</dt>
                      <dd>{displayValue(log.moisture)}</dd>
                    </div>
                    <div>
                      <dt>Field/Bin</dt>
                      <dd>{displayValue(log.field_or_bin)}</dd>
                    </div>
                    <div>
                      <dt>Hauled By</dt>
                      <dd>{displayValue(log.hauled_by)}</dd>
                    </div>
                    <div>
                      <dt>Notes</dt>
                      <dd>{displayValue(log.notes)}</dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {activeView === 'inventory' && (
        <section className="inventory-panel">
          <div className="form-heading">
            <h2>Grain Bins</h2>
            <p>Create bins and track inventory changes before ticket-based inventory starts in Step 3.</p>
          </div>

          <form className="bin-form" onSubmit={saveBin}>
            <div className="field-grid">
              <label className="field">
                <span>Bin Name</span>
                <input value={binForm.bin_name} onChange={(event) => updateBinForm('bin_name', event.target.value)} />
              </label>
              <label className="field">
                <span>Crop Type</span>
                <select value={binForm.crop_type} onChange={(event) => updateBinForm('crop_type', event.target.value)}>
                  <option value="">Choose crop</option>
                  <option value="Corn">Corn</option>
                  <option value="Beans">Beans</option>
                </select>
              </label>
              <label className="field">
                <span>Estimated Capacity</span>
                <input inputMode="decimal" value={binForm.estimated_capacity_bushels} onChange={(event) => updateBinForm('estimated_capacity_bushels', event.target.value)} />
              </label>
              <label className="field">
                <span>Current Bushels</span>
                <input inputMode="decimal" value={binForm.current_bushels} onChange={(event) => updateBinForm('current_bushels', event.target.value)} disabled={Boolean(editingBinId)} />
              </label>
              <label className="field wide-field">
                <span>Notes / Description</span>
                <textarea rows={2} value={binForm.notes} onChange={(event) => updateBinForm('notes', event.target.value)} />
              </label>
            </div>
            <div className="inventory-actions">
              <button type="submit">{editingBinId ? 'Update Bin' : 'Create Bin'}</button>
              {editingBinId && (
                <button type="button" onClick={resetBinForm}>Cancel Edit</button>
              )}
            </div>
          </form>

          <div className="history-actions">
            <button type="button" onClick={() => loadBins()} disabled={isLoadingBins}>
              {isLoadingBins ? 'Loading...' : 'Refresh Bins'}
            </button>
          </div>

          <div className="bin-card-list">
            {bins.length === 0 ? (
              <div className="empty-history">No grain bins created yet.</div>
            ) : (
              bins.map((bin) => {
                const form = transactionFormFor(bin.id);
                const percent = bin.percent_full === null ? null : Math.round(bin.percent_full);

                return (
                  <article className="bin-card" key={bin.id}>
                    <div className="bin-card-head">
                      <div>
                        <h3>{bin.bin_name}</h3>
                        <p>{displayValue(bin.crop_type)} · {formatNumber(bin.current_bushels)} bu</p>
                      </div>
                      <strong>{percent === null ? '-' : `${percent}% full`}</strong>
                    </div>

                    <div className="capacity-bar" aria-label="Percent full">
                      <span style={{ width: `${percent === null ? 0 : Math.min(100, percent)}%` }} />
                    </div>

                    <dl className="ticket-log-details compact-details">
                      <div>
                        <dt>Capacity</dt>
                        <dd>{formatNumber(bin.estimated_capacity_bushels)} bu</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{new Date(bin.updated_at).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Notes</dt>
                        <dd>{displayValue(bin.notes)}</dd>
                      </div>
                    </dl>

                    <div className="inventory-actions">
                      <button type="button" onClick={() => startEditingBin(bin)}>Edit</button>
                      <button type="button" onClick={() => removeBin(bin.id)}>Delete</button>
                    </div>

                    <form className="transaction-form" onSubmit={(event) => saveInventoryTransaction(bin.id, event)}>
                      <label className="field">
                        <span>Transaction Type</span>
                        <select value={form.transaction_type} onChange={(event) => updateTransactionForm(bin.id, 'transaction_type', event.target.value)}>
                          <option value="ADD_GRAIN">Add Grain</option>
                          <option value="REMOVE_GRAIN">Remove Grain</option>
                          <option value="MANUAL_ADJUSTMENT">Manual Adjustment</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{form.transaction_type === 'MANUAL_ADJUSTMENT' ? 'New Balance' : 'Bushel Amount'}</span>
                        <input inputMode="decimal" value={form.bushel_amount} onChange={(event) => updateTransactionForm(bin.id, 'bushel_amount', event.target.value)} />
                      </label>
                      <label className="field wide-field">
                        <span>Transaction Notes</span>
                        <input value={form.notes} onChange={(event) => updateTransactionForm(bin.id, 'notes', event.target.value)} />
                      </label>
                      <button type="submit">Save Transaction</button>
                    </form>

                    <div className="recent-transactions">
                      <h4>Recent Transactions</h4>
                      {bin.recent_transactions.length === 0 ? (
                        <p>No transactions yet.</p>
                      ) : (
                        bin.recent_transactions.map((transaction) => (
                          <div className="transaction-row" key={transaction.id}>
                            <div>
                              <span>{transaction.transaction_type}</span>
                              <strong>{formatNumber(transaction.previous_bin_balance)} -> {formatNumber(transaction.new_bin_balance)} bu</strong>
                              <small>{new Date(transaction.created_at).toLocaleString()}</small>
                            </div>
                            <button type="button" onClick={() => removeInventoryTransaction(transaction.id)}>Delete</button>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {activeView === 'scanner' && (
        <>
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

      <section className="driver-panel">
        <div className="form-heading compact-heading">
          <h2>Drivers</h2>
          <p>Add driver names here for the Hauled By dropdown.</p>
        </div>
        <form className="quick-add-form" onSubmit={createDriver}>
          <input
            type="text"
            value={newDriverName}
            onChange={(event) => setNewDriverName(event.target.value)}
            placeholder="Driver name"
          />
          <button type="submit">Add Driver</button>
        </form>
        {isLoadingDrivers && <div className="notice">Loading drivers...</div>}
        {drivers.length > 0 && (
          <div className="chip-list">
            {drivers.map((driver) => (
              <div className="data-chip" key={driver.id}>
                <span>{driver.name}</span>
                <button type="button" onClick={() => removeDriver(driver.id)}>Remove</button>
              </div>
            ))}
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

          <label className="field">
            <span>{fieldLabels.delivered_to}</span>
            <input type="text" value={ticket.delivered_to} onChange={(event) => updateField('delivered_to', event.target.value)} placeholder="Read from ticket or type manually" />
          </label>
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
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
