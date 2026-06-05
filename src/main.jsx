import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const OTHER_VALUE = '__other__';
const MAX_IMAGE_DIMENSION = 1800;
const JPEG_QUALITY = 0.82;

const fieldLabels = {
  date: 'Date',
  crop: 'Commodity',
  ticket_number: 'Ticket number',
  bushels: 'Bushels',
  gross_weight: 'Gross Weight',
  tare_weight: 'Tare Weight',
  net_weight: 'Net Weight',
  delivered_to: 'Delivered To',
  hauled_by: 'Hauled By',
  moisture: 'Moisture',
  hauled_from: 'Hauled From',
  price: 'Price per Bushel',
  notes: 'Notes'
};

const fields = Object.keys(fieldLabels);
const scannerFields = [
  'ticket_number',
  'date',
  'crop',
  'hauled_from',
  'delivered_to',
  'bushels',
  'price',
  'hauled_by',
  'notes',
  'moisture'
];
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
const blankContractForm = {
  contract_id: '',
  buyer: '',
  commodity: '',
  contracted_bushels: '',
  contract_price: '',
  delivery_window: '',
  status: 'Open',
  notes: ''
};

function ticketEditForm(log = {}) {
  return {
    ...log,
    assignment_status: log.assignment_status || 'Unassigned',
    assignments: Array.isArray(log.assignments) ? log.assignments : [],
    payment_status: log.payment_status || 'Not paid',
    payment_date: log.payment_date || '',
    amount_received: log.amount_received || '',
    payment_reference: log.payment_reference || '',
    payment_notes: log.payment_notes || ''
  };
}

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

function formatCurrency(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : '$0.00';
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
  const [contracts, setContracts] = useState([]);
  const [contractForm, setContractForm] = useState(blankContractForm);
  const [editingContractId, setEditingContractId] = useState('');
  const [editingTicket, setEditingTicket] = useState(null);
  const [historySort, setHistorySort] = useState({ field: 'created_at', direction: 'desc' });
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
    elevator: '',
    assignment_status: '',
    payment_status: ''
  });
  const sortedTicketLogs = useMemo(() => {
    const direction = historySort.direction === 'asc' ? 1 : -1;

    return [...ticketLogs].sort((a, b) => {
      const left = historySort.field === 'created_at'
        ? new Date(a.created_at).getTime()
        : String(a[historySort.field] ?? '').toLowerCase();
      const right = historySort.field === 'created_at'
        ? new Date(b.created_at).getTime()
        : String(b[historySort.field] ?? '').toLowerCase();

      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [ticketLogs, historySort]);
  const [dashboard, setDashboard] = useState({
    kpis: {
      total_corn_inventory: 0,
      total_bean_inventory: 0,
      total_bushels_stored: 0,
      total_tickets_scanned: 0,
      total_bushels_sold: 0,
      active_bins: 0
    },
    finance: {
      unpaid_delivered_bushels: 0,
      unpaid_estimated_dollars: 0,
      payments_received_this_month: 0,
      contracts_with_remaining_bushels: 0,
      unassigned_tickets: 0
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
    () => scannerFields.filter((field) => ticket[field]?.trim()).length,
    [ticket]
  );

  useEffect(() => {
    loadDropdowns();
    loadDashboard({ silent: true });
    loadTicketHistory({ silent: true });
    loadBins({ silent: true });
    loadDrivers({ silent: true });
    loadContracts({ silent: true });
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

  async function loadContracts(options = {}) {
    try {
      const response = await fetch(`${API_BASE}/api/contracts`);
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await response.json();
      setContracts(data.contracts || []);
    } catch (error) {
      if (!options.silent) setStatus(cleanMessage(error));
    }
  }

  function startEditingTicket(log) {
    setEditingTicket(ticketEditForm(log));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateEditingTicket(field, value) {
    setEditingTicket((current) => ({ ...current, [field]: value }));
  }

  function setAssignmentStatus(value) {
    setEditingTicket((current) => {
      const bushels = Number(current.bushels) || 0;
      let assignments = [];

      if (value === 'Spot') assignments = [{ type: 'SPOT', contract_id: '', bushels }];
      if (value === 'Contract') assignments = [{ type: 'CONTRACT', contract_id: '', bushels }];
      if (value === 'Split') assignments = [
        { type: 'CONTRACT', contract_id: '', bushels: '' },
        { type: 'SPOT', contract_id: '', bushels: '' }
      ];

      return { ...current, assignment_status: value, assignments };
    });
  }

  function updateAssignment(index, field, value) {
    setEditingTicket((current) => ({
      ...current,
      assignments: current.assignments.map((assignment, assignmentIndex) => (
        assignmentIndex === index
          ? {
              ...assignment,
              [field]: value,
              ...(field === 'type' && value === 'SPOT' ? { contract_id: '' } : {})
            }
          : assignment
      ))
    }));
  }

  function addAssignmentRow() {
    setEditingTicket((current) => ({
      ...current,
      assignments: [...current.assignments, { type: 'CONTRACT', contract_id: '', bushels: '' }]
    }));
  }

  function removeAssignmentRow(index) {
    setEditingTicket((current) => ({
      ...current,
      assignments: current.assignments.filter((_, assignmentIndex) => assignmentIndex !== index)
    }));
  }

  async function saveTicketChanges(event) {
    event.preventDefault();

    const assignedBushels = editingTicket.assignments.reduce((sum, assignment) => sum + (Number(assignment.bushels) || 0), 0);
    if (['Contract', 'Split'].includes(editingTicket.assignment_status) && Math.abs(assignedBushels - Number(editingTicket.bushels || 0)) > 0.01) {
      setStatus(`Assignments must total ${editingTicket.bushels || 0} bushels.`);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ticket-logs/${editingTicket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTicket)
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      setEditingTicket(null);
      await Promise.all([loadTicketHistory(), loadContracts({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Ticket assignment and payment details updated.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  function updateContractForm(field, value) {
    setContractForm((current) => ({ ...current, [field]: value }));
  }

  function resetContractForm() {
    setContractForm(blankContractForm);
    setEditingContractId('');
  }

  function startEditingContract(contract) {
    setEditingContractId(contract.id);
    setContractForm({
      contract_id: contract.contract_id,
      buyer: contract.buyer,
      commodity: contract.commodity,
      contracted_bushels: contract.contracted_bushels,
      contract_price: contract.contract_price,
      delivery_window: contract.delivery_window,
      status: contract.status,
      notes: contract.notes
    });
  }

  async function saveContract(event) {
    event.preventDefault();
    const editing = Boolean(editingContractId);

    try {
      const response = await fetch(`${API_BASE}/api/contracts${editing ? `/${editingContractId}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contractForm)
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      resetContractForm();
      await Promise.all([loadContracts(), loadDashboard({ silent: true })]);
      setStatus(editing ? 'Contract updated.' : 'Contract created.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  async function removeContract(id) {
    if (!window.confirm('Delete this contract?')) return;

    try {
      const response = await fetch(`${API_BASE}/api/contracts/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      await Promise.all([loadContracts(), loadDashboard({ silent: true })]);
      setStatus('Contract deleted.');
    } catch (error) {
      setStatus(cleanMessage(error));
    }
  }

  function toggleHistorySort(field) {
    setHistorySort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function exportTicketCsv() {
    const columns = [
      ['Ticket Number', 'ticket_number'], ['Date', 'date'], ['Crop', 'crop'], ['Hauled From', 'hauled_from'],
      ['Delivered To', 'delivered_to'], ['Gross Weight', 'gross_weight'], ['Tare Weight', 'tare_weight'],
      ['Net Weight', 'net_weight'], ['Bushels', 'bushels'], ['Moisture', 'moisture'], ['Price', 'price'],
      ['Revenue', 'revenue'], ['Hauled By', 'hauled_by'], ['Notes', 'notes'], ['Assignment Status', 'assignment_status'],
      ['Payment Status', 'payment_status'], ['Payment Date', 'payment_date'], ['Amount Received', 'amount_received'],
      ['Payment Reference', 'payment_reference'], ['Payment Notes', 'payment_notes']
    ];
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      columns.map(([label]) => escape(label)).join(','),
      ...sortedTicketLogs.map((log) => columns.map(([, key]) => escape(log[key])).join(','))
    ].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `binflow-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
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

      await Promise.all([loadTicketHistory(), loadBins({ silent: true }), loadContracts({ silent: true }), loadDashboard({ silent: true })]);
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
      elevator: '',
      assignment_status: '',
      payment_status: ''
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

    const selectedBin = bins.find((bin) => bin.bin_name.toLowerCase() === ticket.hauled_from.trim().toLowerCase());
    const exceedsEstimate = selectedBin && Number(ticket.bushels) > Number(selectedBin.current_bushels);
    let allowBinOverdraw = false;

    if (exceedsEstimate) {
      allowBinOverdraw = window.confirm('This ticket exceeds estimated bin inventory. Continue and set this bin to 0?');

      if (!allowBinOverdraw) {
        setStatus('Ticket was not submitted. Review the selected bin or bushel amount.');
        return;
      }
    }

    setIsSubmitting(true);
    setIsSuccess(false);
    setStatus('Submitting reviewed data...');

    try {
      const sendTicket = (confirmedOverdraw) => fetch(`${API_BASE}/api/submit-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket,
          allow_bin_overdraw: confirmedOverdraw
        })
      });
      let response = await sendTicket(allowBinOverdraw);

      if (response.status === 409 && !allowBinOverdraw) {
        const errorData = await response.json();

        if (errorData.code === 'BIN_INVENTORY_OVERDRAW') {
          allowBinOverdraw = window.confirm('This ticket exceeds estimated bin inventory. Continue and set this bin to 0?');

          if (!allowBinOverdraw) {
            setStatus('Ticket was not submitted. Review the selected bin or bushel amount.');
            return;
          }

          response = await sendTicket(true);
        }
      }

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
      loadContracts({ silent: true });
      loadBins({ silent: true });
      loadDropdowns({ silent: true });
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
        <div className="status-pill">{filledCount}/{scannerFields.length} fields</div>
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
        <button
          className={activeView === 'contracts' ? 'active' : ''}
          type="button"
          onClick={() => {
            setActiveView('contracts');
            loadContracts();
          }}
        >
          Contracts
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
              <button type="button" onClick={() => setActiveView('contracts')}>Manage Contracts</button>
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

          <section className="dashboard-card">
            <div className="section-title-row">
              <div>
                <h2>Sales and Payments</h2>
                <p>Delivered grain that still needs assignment or reconciliation.</p>
              </div>
              <button type="button" onClick={() => setActiveView('history')}>Review Tickets</button>
            </div>
            <div className="finance-grid">
              <article><span>Unpaid Delivered</span><strong>{formatNumber(dashboard.finance?.unpaid_delivered_bushels)} bu</strong></article>
              <article><span>Unpaid Estimated</span><strong>{formatCurrency(dashboard.finance?.unpaid_estimated_dollars)}</strong></article>
              <article><span>Received This Month</span><strong>{formatCurrency(dashboard.finance?.payments_received_this_month)}</strong></article>
              <article><span>Open Contract Balances</span><strong>{formatNumber(dashboard.finance?.contracts_with_remaining_bushels)}</strong></article>
              <article><span>Unassigned Tickets</span><strong>{formatNumber(dashboard.finance?.unassigned_tickets)}</strong></article>
            </div>
          </section>

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

          <section className="dashboard-card farm-brief">
            <div className="section-title-row">
              <div>
                <h2>Farm Brief</h2>
                <p>Small seasonal reminders for the operation.</p>
              </div>
            </div>
            <div className="brief-grid">
              <article>
                <span>Harvest Prep</span>
                <h3>Confirm storage headroom</h3>
                <p>Review current bin balances and leave room for wet grain before the next field starts.</p>
                <time>Updated June 5, 2026</time>
              </article>
              <article>
                <span>Grain Quality</span>
                <h3>Watch moisture trends</h3>
                <p>Compare recent ticket moisture readings before changing dryer or harvest settings.</p>
                <time>Updated June 5, 2026</time>
              </article>
              <article>
                <span>Reconciliation</span>
                <h3>Match payments weekly</h3>
                <p>Assign delivered tickets and record checks or ACH payments before statements pile up.</p>
                <time>Updated June 5, 2026</time>
              </article>
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
            <label className="field">
              <span>Assignment</span>
              <select value={historyFilters.assignment_status} onChange={(event) => updateHistoryFilter('assignment_status', event.target.value)}>
                <option value="">All assignments</option>
                <option>Unassigned</option>
                <option>Spot</option>
                <option>Contract</option>
                <option>Split</option>
              </select>
            </label>
            <label className="field">
              <span>Payment</span>
              <select value={historyFilters.payment_status} onChange={(event) => updateHistoryFilter('payment_status', event.target.value)}>
                <option value="">All payments</option>
                <option>Not paid</option>
                <option>Partially paid</option>
                <option>Paid</option>
              </select>
            </label>
          </div>

          <div className="history-actions">
            <button type="button" onClick={() => loadTicketHistory()} disabled={isLoadingHistory}>
              {isLoadingHistory ? 'Loading...' : 'Refresh History'}
            </button>
            <button type="button" onClick={clearHistoryFilters}>
              Clear Filters
            </button>
            <button type="button" onClick={exportTicketCsv}>
              Export CSV
            </button>
          </div>

          <div className="history-count">{ticketLogs.length} ticket logs</div>

          {editingTicket && (
            <form className="ticket-editor" onSubmit={saveTicketChanges}>
              <div className="section-title-row">
                <div>
                  <h2>Edit Ticket {editingTicket.ticket_number}</h2>
                  <p>Correct ticket details, assignment, and payment reconciliation.</p>
                </div>
                <button type="button" onClick={() => setEditingTicket(null)}>Close</button>
              </div>

              <div className="editor-grid">
                {[
                  ['ticket_number', 'Ticket Number'], ['date', 'Date'], ['crop', 'Crop'], ['hauled_from', 'Hauled From'],
                  ['delivered_to', 'Delivered To'], ['gross_weight', 'Gross Weight'], ['tare_weight', 'Tare Weight'],
                  ['net_weight', 'Net Weight'], ['bushels', 'Bushels'], ['moisture', 'Moisture'], ['price', 'Price per Bushel'],
                  ['hauled_by', 'Hauled By']
                ].map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input value={editingTicket[key] ?? ''} onChange={(event) => updateEditingTicket(key, event.target.value)} />
                  </label>
                ))}
                <label className="field wide-field">
                  <span>Notes</span>
                  <textarea rows={2} value={editingTicket.notes || ''} onChange={(event) => updateEditingTicket('notes', event.target.value)} />
                </label>
              </div>

              <div className="editor-section">
                <h3>Grain Assignment</h3>
                <label className="field">
                  <span>Assignment Status</span>
                  <select value={editingTicket.assignment_status} onChange={(event) => setAssignmentStatus(event.target.value)}>
                    <option>Unassigned</option>
                    <option>Spot</option>
                    <option>Contract</option>
                    <option>Split</option>
                  </select>
                </label>

                {editingTicket.assignments.map((assignment, index) => (
                  <div className="assignment-row" key={`${index}-${assignment.type}`}>
                    <select value={assignment.type} onChange={(event) => updateAssignment(index, 'type', event.target.value)}>
                      <option value="CONTRACT">Contract</option>
                      <option value="SPOT">Spot</option>
                    </select>
                    {assignment.type === 'CONTRACT' ? (
                      <select value={assignment.contract_id} onChange={(event) => updateAssignment(index, 'contract_id', event.target.value)}>
                        <option value="">Choose contract</option>
                        {contracts.map((contract) => (
                          <option key={contract.id} value={contract.id}>{contract.contract_id} · {contract.buyer}</option>
                        ))}
                      </select>
                    ) : <span className="spot-label">Spot grain</span>}
                    <input
                      inputMode="decimal"
                      value={assignment.bushels}
                      onChange={(event) => updateAssignment(index, 'bushels', event.target.value)}
                      placeholder="Bushels"
                    />
                    {editingTicket.assignment_status === 'Split' && (
                      <button type="button" onClick={() => removeAssignmentRow(index)}>Remove</button>
                    )}
                  </div>
                ))}
                {editingTicket.assignment_status === 'Split' && (
                  <button className="secondary-button" type="button" onClick={addAssignmentRow}>Add Split Row</button>
                )}
              </div>

              <div className="editor-section">
                <h3>Payment Tracking</h3>
                <div className="editor-grid">
                  <label className="field">
                    <span>Payment Status</span>
                    <select value={editingTicket.payment_status} onChange={(event) => updateEditingTicket('payment_status', event.target.value)}>
                      <option>Not paid</option>
                      <option>Partially paid</option>
                      <option>Paid</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Payment Date</span>
                    <input type="date" value={editingTicket.payment_date} onChange={(event) => updateEditingTicket('payment_date', event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Amount Received</span>
                    <input inputMode="decimal" value={editingTicket.amount_received} onChange={(event) => updateEditingTicket('amount_received', event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Check / ACH Reference</span>
                    <input value={editingTicket.payment_reference} onChange={(event) => updateEditingTicket('payment_reference', event.target.value)} />
                  </label>
                  <label className="field wide-field">
                    <span>Payment Notes</span>
                    <textarea rows={2} value={editingTicket.payment_notes} onChange={(event) => updateEditingTicket('payment_notes', event.target.value)} />
                  </label>
                </div>
              </div>

              <button className="primary-button" type="submit">Save Ticket Changes</button>
            </form>
          )}

          <div className="ticket-table-wrap">
            {ticketLogs.length === 0 ? (
              <div className="empty-history">No ticket logs found.</div>
            ) : (
              <table className="ticket-table">
                <thead>
                  <tr>
                    {[
                      ['ticket_number', 'Ticket'], ['date', 'Date'], ['crop', 'Crop'], ['hauled_from', 'Hauled From'],
                      ['delivered_to', 'Delivered To'], ['gross_weight', 'Gross'], ['tare_weight', 'Tare'],
                      ['net_weight', 'Net'], ['bushels', 'Bushels'], ['moisture', 'Moisture'], ['price', 'Price'],
                      ['revenue', 'Revenue'], ['hauled_by', 'Hauled By'], ['notes', 'Notes'],
                      ['assignment_status', 'Assignment'], ['payment_status', 'Payment']
                    ].map(([key, label]) => (
                      <th key={key}><button type="button" onClick={() => toggleHistorySort(key)}>{label}</button></th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTicketLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="primary-cell">{displayValue(log.ticket_number)}</td>
                      <td>{displayValue(log.date)}</td>
                      <td>{displayValue(log.crop)}</td>
                      <td>{displayValue(log.hauled_from)}</td>
                      <td>{displayValue(log.delivered_to)}</td>
                      <td>{formatNumber(log.gross_weight)}</td>
                      <td>{formatNumber(log.tare_weight)}</td>
                      <td>{formatNumber(log.net_weight)}</td>
                      <td>{formatNumber(log.bushels)}</td>
                      <td>{formatNumber(log.moisture)}</td>
                      <td>{formatCurrency(log.price)}</td>
                      <td>{formatCurrency(log.revenue)}</td>
                      <td>{displayValue(log.hauled_by)}</td>
                      <td className="notes-cell">{displayValue(log.notes)}</td>
                      <td><span className={`status-tag ${(log.assignment_status || 'Unassigned').toLowerCase()}`}>{log.assignment_status || 'Unassigned'}</span></td>
                      <td><span className={`status-tag ${(log.payment_status || 'Not paid').toLowerCase().replaceAll(' ', '-')}`}>{log.payment_status || 'Not paid'}</span></td>
                      <td>
                        <div className="table-actions">
                          <button type="button" onClick={() => startEditingTicket(log)}>Edit</button>
                          <button className="danger-button" type="button" onClick={() => removeTicketLog(log.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {activeView === 'contracts' && (
        <section className="contracts-panel">
          <div className="form-heading">
            <h2>Grain Contracts</h2>
            <p>Track contracted bushels and manually apply delivered tickets as elevator settlements are confirmed.</p>
          </div>

          <form className="contract-form" onSubmit={saveContract}>
            <div className="field-grid">
              <label className="field">
                <span>Contract ID</span>
                <input value={contractForm.contract_id} onChange={(event) => updateContractForm('contract_id', event.target.value)} />
              </label>
              <label className="field">
                <span>Buyer / Elevator</span>
                <input value={contractForm.buyer} onChange={(event) => updateContractForm('buyer', event.target.value)} />
              </label>
              <label className="field">
                <span>Commodity</span>
                <select value={contractForm.commodity} onChange={(event) => updateContractForm('commodity', event.target.value)}>
                  <option value="">Choose crop</option>
                  <option>Corn</option>
                  <option>Beans</option>
                </select>
              </label>
              <label className="field">
                <span>Contracted Bushels</span>
                <input inputMode="decimal" value={contractForm.contracted_bushels} onChange={(event) => updateContractForm('contracted_bushels', event.target.value)} />
              </label>
              <label className="field">
                <span>Contract Price</span>
                <input inputMode="decimal" value={contractForm.contract_price} onChange={(event) => updateContractForm('contract_price', event.target.value)} />
              </label>
              <label className="field">
                <span>Delivery Window / Month</span>
                <input value={contractForm.delivery_window} onChange={(event) => updateContractForm('delivery_window', event.target.value)} placeholder="October 2026" />
              </label>
              <label className="field">
                <span>Status</span>
                <select value={contractForm.status} onChange={(event) => updateContractForm('status', event.target.value)}>
                  <option>Open</option>
                  <option>Filled</option>
                  <option>Closed</option>
                  <option>Cancelled</option>
                </select>
              </label>
              <label className="field wide-field">
                <span>Notes</span>
                <textarea rows={2} value={contractForm.notes} onChange={(event) => updateContractForm('notes', event.target.value)} />
              </label>
            </div>
            <div className="inventory-actions">
              <button type="submit">{editingContractId ? 'Update Contract' : 'Add Contract'}</button>
              {editingContractId && <button type="button" onClick={resetContractForm}>Cancel Edit</button>}
            </div>
          </form>

          <div className="contract-grid">
            {contracts.length === 0 ? (
              <div className="premium-empty">No contracts yet. Add the first contract above.</div>
            ) : contracts.map((contract) => {
              const progress = contract.contracted_bushels > 0
                ? Math.min(100, (contract.delivered_applied_bushels / contract.contracted_bushels) * 100)
                : 0;

              return (
                <article className="contract-card" key={contract.id}>
                  <div className="contract-head">
                    <div>
                      <span>{contract.commodity} · {contract.status}</span>
                      <h3>{contract.contract_id}</h3>
                      <p>{contract.buyer}</p>
                    </div>
                    <strong>{formatCurrency(contract.contract_price)} / bu</strong>
                  </div>
                  <div className="contract-metrics">
                    <div><span>Contracted</span><strong>{formatNumber(contract.contracted_bushels)} bu</strong></div>
                    <div><span>Applied</span><strong>{formatNumber(contract.delivered_applied_bushels)} bu</strong></div>
                    <div><span>Remaining</span><strong>{formatNumber(contract.remaining_bushels)} bu</strong></div>
                  </div>
                  <div className="capacity-bar"><span style={{ width: `${progress}%` }} /></div>
                  <p className="contract-window">{displayValue(contract.delivery_window)} · {displayValue(contract.notes)}</p>
                  <div className="inventory-actions">
                    <button type="button" onClick={() => startEditingContract(contract)}>Edit</button>
                    <button type="button" onClick={() => removeContract(contract.id)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeView === 'inventory' && (
        <section className="inventory-panel">
          <div className="form-heading">
            <h2>Grain Bins</h2>
            <p>Create bins, monitor balances, and review every inventory adjustment.</p>
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
                              <strong>{formatNumber(transaction.previous_bin_balance)} {'->'} {formatNumber(transaction.new_bin_balance)} bu</strong>
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
          <p className="success-kicker">Saved to BinFlow</p>
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
          <div className="notice">Loading shared bins and drivers...</div>
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
            <span>{fieldLabels.ticket_number}</span>
            <input type="text" value={ticket.ticket_number} onChange={(event) => updateField('ticket_number', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.date}</span>
            <input type="text" value={ticket.date} onChange={(event) => updateField('date', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.crop}</span>
            <input type="text" value={ticket.crop} onChange={(event) => updateField('crop', event.target.value)} />
          </label>

          {renderDropdownField('hauled_from', dropdowns.bins, 'Choose Hauled From')}

          <label className="field">
            <span>{fieldLabels.delivered_to}</span>
            <input type="text" value={ticket.delivered_to} onChange={(event) => updateField('delivered_to', event.target.value)} placeholder="Read from ticket or type manually" />
          </label>

          <label className="field">
            <span>{fieldLabels.bushels}</span>
            <input type="text" inputMode="decimal" value={ticket.bushels} onChange={(event) => updateField('bushels', event.target.value)} />
          </label>

          <label className="field">
            <span>{fieldLabels.price} <small>(optional)</small></span>
            <input type="text" inputMode="decimal" value={ticket.price} onChange={(event) => updateField('price', event.target.value)} />
          </label>

          {renderDropdownField('hauled_by', dropdowns.haulers, 'Choose Hauled By')}

          <label className="field">
            <span>{fieldLabels.moisture}</span>
            <input type="text" inputMode="decimal" value={ticket.moisture} onChange={(event) => updateField('moisture', event.target.value)} />
          </label>

          <label className="field wide-field">
            <span>{fieldLabels.notes}</span>
            <textarea rows={2} value={ticket.notes} onChange={(event) => updateField('notes', event.target.value)} />
          </label>
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
