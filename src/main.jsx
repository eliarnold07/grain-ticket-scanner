import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import binFlowMark from './assets/binflow-mark.png';
import AccountSettings from './AccountSettings.jsx';
import SettingsHome from './SettingsHome.jsx';
import SavedNamesSettings from './SavedNamesSettings.jsx';
import FarmInvitationSettings from './FarmInvitationSettings.jsx';
import JoinFarm from './JoinFarm.jsx';
import TicketPhotoCapture from './TicketPhotoCapture.jsx';
import useScannerData from './useScannerData.js';
import { fetchWithTimeout, readJsonWithTimeout, withDeadline } from './network.js';
import { missingTicketFields, ticketBushels as parseTicketBushels } from './ticketReview.js';
import { pendingTicketRequest, completeTicketRequest, confirmedTicketReceipt, requireAtomicTicketWrites, postTicketForActor } from './ticketRequest.js';
import { canOpenView, SETTINGS_SCREENS } from './settingsNavigation.js';
import { cleanMessage, readErrorResponse, isInvalidSessionError } from './apiErrors.js';
import { getStoredSession, isSessionExpired, refreshSession, signInFarm, signOutFarm, signUpFarm, storeSession } from './supabaseAuth.js';
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
const blankEmployeeForm = {
  display_name: '',
  email: '',
  password: '',
  role: 'employee'
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

function displayCrop(value) {
  return value === 'Beans' ? 'Soybeans' : displayValue(value);
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

function signedBushels(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : ''}${formatNumber(number)} bu`;
}

function movementLabel(type) {
  const labels = {
    ADD_GRAIN: 'Grain added',
    REMOVE_GRAIN: 'Grain removed',
    MANUAL_ADJUSTMENT: 'Balance adjusted'
  };
  return labels[type] || String(type || '').replaceAll('_', ' ');
}

function emptyDashboard() {
  return {
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
    weekly_summary: {
      period_label: '',
      activity_count: 0,
      ticket_count: 0,
      ticket_bushels: 0,
      manual_adjustment_count: 0,
      grain_added_bushels: 0,
      grain_removed_bushels: 0,
      manual_net_bushels: 0,
      by_crop: [],
      tickets: [],
      adjustments: []
    }
  };
}

function App() {
  const [session, setSession] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const sessionRef = useRef(null);
  const refreshPromiseRef = useRef(null);
  const terminalAuthFailureRef = useRef(false);
  const [farm, setFarm] = useState(null);
  const [account, setAccount] = useState(null);
  const [authMode, setAuthMode] = useState(() => {
    const requestedMode = new URLSearchParams(window.location.search).get('auth');
    return requestedMode === 'signup' ? 'signup' : 'login';
  });
  const [authForm, setAuthForm] = useState({ farmName: '', email: '', password: '' });
  const [authStatus, setAuthStatus] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [invitationsAvailable, setInvitationsAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchWithTimeout(`${API_BASE}/api/app-capabilities`, { signal: controller.signal }, 20000)
      .then(response => response.ok ? readJsonWithTimeout(response) : null)
      .then(data => { if (!controller.signal.aborted) setInvitationsAvailable(data?.farm_invitations === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const [activeView, setActiveView] = useState('dashboard');
  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeView]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [ticket, setTicket] = useState(emptyTicket);
  const [scannerAssignment, setScannerAssignment] = useState({
    status: 'Spot',
    contractId: ''
  });
  const [contractOverage, setContractOverage] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const { dropdowns, scannerContracts, isLoadingDropdowns, dropdownError,
    isLoadingScannerContracts, scannerContractsError, loadDropdowns,
    loadScannerContracts, resetScannerData } = useScannerData(apiFetch, session?.user?.id);
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
  const [requestError, setRequestError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrConsent, setOcrConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ticketSubmittingRef = useRef(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [updatingPaymentIds, setUpdatingPaymentIds] = useState([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [ticketLogs, setTicketLogs] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [showArchivedContracts, setShowArchivedContracts] = useState(false);
  const [showArchivedTickets, setShowArchivedTickets] = useState(false);
  const [farmUsers, setFarmUsers] = useState([]);
  const [employeeForm, setEmployeeForm] = useState(blankEmployeeForm);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [userStatus, setUserStatus] = useState('');
  const [changingMember, setChangingMember] = useState('');
  const [contractForm, setContractForm] = useState(blankContractForm);
  const [editingContractId, setEditingContractId] = useState('');
  const [editingTicket, setEditingTicket] = useState(null);
  const [historySort, setHistorySort] = useState({ field: 'created_at', direction: 'desc' });
  const [bins, setBins] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [isLoadingBins, setIsLoadingBins] = useState(false);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
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
  const outstandingContracts = useMemo(() => {
    const ticketCrop = String(ticket.crop || '').trim().toLowerCase();

    return scannerContracts.filter((contract) => {
      const status = String(contract.status || '').toLowerCase();
      const commodity = String(contract.commodity || '').trim().toLowerCase();
      const isOpen = Number(contract.remaining_bushels) > 0 && !['closed', 'cancelled'].includes(status);
      return isOpen && (!ticketCrop || !commodity || commodity === ticketCrop);
    });
  }, [scannerContracts, ticket.crop]);
  const [dashboard, setDashboard] = useState(emptyDashboard);

  const isAuthenticated = Boolean(session?.access_token);
  const isAdmin = account?.role === 'admin';
  const isEmployee = account?.role === 'employee';

  useEffect(() => {
    let cancelled = false;

    async function initializeAuth() {
      const storedSession = getStoredSession();

      if (!storedSession?.access_token) {
        if (!cancelled) setIsAuthReady(true);
        return;
      }

      try {
        const readySession = isSessionExpired(storedSession)
          ? await refreshSession(storedSession.refresh_token)
          : storedSession;

        if (!cancelled) {
          sessionRef.current = readySession;
          terminalAuthFailureRef.current = false;
          setSession(readySession);
        }
      } catch (error) {
        // A transport outage is not evidence that the refresh token is invalid.
        if (isInvalidSessionError(error)) storeSession(null);
        if (!cancelled) {
          sessionRef.current = null;
          setSession(null);
          setAuthStatus(cleanMessage(error));
        }
      } finally {
        if (!cancelled) setIsAuthReady(true);
      }
    }

    initializeAuth();
    return () => {
      cancelled = true;
    };
  }, [authAttempt]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) {
      return;
    }

    let cancelled = false;

    async function initializeFarmData() {
      const sessionData = await loadFarmSession();
      if (!sessionData || cancelled) return;

      if (sessionData.account?.role === 'employee') {
        setActiveView('scanner');
        await Promise.all([
          loadDropdowns({ silent: true }),
          loadScannerContracts({ silent: true })
        ]);
        return;
      }

      await Promise.all([
        loadDropdowns({ silent: true }),
        loadDashboard({ silent: true }),
        loadTicketHistory({ silent: true }),
        loadBins({ silent: true }),
        loadDrivers({ silent: true }),
        loadLocations({ silent: true }),
        loadContracts({ silent: true }),
        loadFarmUsers({ silent: true })
      ]);
    }

    initializeFarmData();
    const handleFocus = () => { loadDropdowns(); loadScannerContracts(); };
    const intervalId = window.setInterval(handleFocus, 60000);

    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isAuthReady, isAuthenticated]);

  async function apiFetch(path, options = {}, retry = true) {
    const { timeoutMs = 90000, ...requestOptions } = options;
    const activeSession = sessionRef.current;
    if (!activeSession?.access_token || terminalAuthFailureRef.current) {
      throw new Error('Please log in to continue.');
    }

    const response = await fetchWithTimeout(`${API_BASE}${path}`, {
      ...requestOptions,
      headers: {
        ...(requestOptions.headers || {}),
        Authorization: `Bearer ${activeSession.access_token}`
      }
    }, timeoutMs);

    if (terminalAuthFailureRef.current || sessionRef.current?.user?.id !== activeSession.user?.id) {
      const error = new Error('Your account session changed. Please sign in again.');
      error.code = 'AUTH_CONTEXT_CHANGED';
      throw error;
    }

    if (response.status !== 401 || !retry || !activeSession.refresh_token) {
      if (response.status === 401) endInvalidSession();
      return response;
    }

    try {
      if (!refreshPromiseRef.current) {
        refreshPromiseRef.current = refreshSession(activeSession.refresh_token)
          .then((nextSession) => {
            if (terminalAuthFailureRef.current || sessionRef.current?.access_token !== activeSession.access_token) {
              storeSession(sessionRef.current);
              const error = new Error('Your account session changed. Please sign in again.');
              error.code = 'AUTH_CONTEXT_CHANGED';
              throw error;
            }
            sessionRef.current = nextSession;
            setSession(nextSession);
            return nextSession;
          })
          .finally(() => {
            refreshPromiseRef.current = null;
          });
      }

      const nextSession = await refreshPromiseRef.current;
      const retryResponse = await fetchWithTimeout(`${API_BASE}${path}`, {
        ...requestOptions,
        headers: {
          ...(requestOptions.headers || {}),
          Authorization: `Bearer ${nextSession.access_token}`
        }
      }, timeoutMs);

      if (terminalAuthFailureRef.current || sessionRef.current?.user?.id !== nextSession.user?.id) {
        const error = new Error('Your account session changed. Please sign in again.');
        error.code = 'AUTH_CONTEXT_CHANGED';
        throw error;
      }

      if (retryResponse.status === 401) {
        endInvalidSession();
      }

      return retryResponse;
    } catch (error) {
      if (isInvalidSessionError(error)) endInvalidSession();
      throw error;
    }
  }

  function endInvalidSession() {
    if (terminalAuthFailureRef.current) return;
    clearPrivateForms();
    terminalAuthFailureRef.current = true;
    refreshPromiseRef.current = null;
    sessionRef.current = null;
    storeSession(null);
    setSession(null);
    setFarm(null);
    setAccount(null);
    setActiveView('dashboard');
    setAuthMode('login');
    setAuthStatus('Your session expired. Please log in again.');
  }

  function reportError(error) {
    const message = cleanMessage(error);
    setStatus(message);
    setRequestError(message);
  }

  async function loadFarmSession() {
    try {
      const response = await apiFetch('/api/session', { timeoutMs: 20000 });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await readJsonWithTimeout(response);
      setFarm(data.farm);
      setAccount(data.account);
      return data;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  function updateAuthField(field, value) {
    setAuthForm((current) => ({ ...current, [field]: value }));
  }

  async function submitAuth(event) {
    event.preventDefault();
    setIsAuthenticating(true);
    setAuthStatus(authMode === 'signup' ? 'Creating farm account...' : 'Signing in...');

    try {
      const data = authMode === 'signup'
        ? await signUpFarm(authForm)
        : await signInFarm(authForm);

      if (!data.access_token) {
        setAuthStatus('Account created. Check your email to confirm the account, then log in.');
        setAuthMode('login');
        return;
      }

      sessionRef.current = data;
      terminalAuthFailureRef.current = false;
      setSession(data);
      setAuthStatus('');
    } catch (error) {
      setAuthStatus(cleanMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  }

  function clearPrivateForms() {
    setRequestError('');
    setUserStatus('');
    setEmployeeForm(blankEmployeeForm);
    setEditingTicket(null);
    setEditingContractId(''); setContractForm(blankContractForm);
    setEditingBinId(''); setBinForm(blankBinForm);
    setTransactionForms({});
    setHistoryFilters({ search: '', date: '', crop: '', ticket_number: '', elevator: '', assignment_status: '', payment_status: '' });
    setShowArchivedTickets(false); setShowArchivedContracts(false);
    setAuthForm(current => ({ ...current, password: '' }));
    setLocations([]);
    setFarmUsers([]); setTicketLogs([]); setBins([]); setContracts([]); setDrivers([]);
    resetScannerData();
    setDashboard(emptyDashboard());
    resetForNextTicket();
  }

  async function logout() {
    clearPrivateForms();
    setAuthMode('login'); setAuthStatus('');
    const activeSession = sessionRef.current;
    terminalAuthFailureRef.current = true;
    refreshPromiseRef.current = null;
    sessionRef.current = null;
    signOutFarm(activeSession?.access_token);
    setSession(null);
    setFarm(null);
    setAccount(null);
    setFarmUsers([]);
    setUserStatus('');
    setTicketLogs([]);
    setBins([]);
    setContracts([]);
    setDrivers([]);
    resetScannerData();
    setDashboard(emptyDashboard());
    resetForNextTicket();
    setActiveView('dashboard');
  }

  useEffect(() => {
    if (isEmployee && !canOpenView('employee', activeView)) {
      setActiveView('scanner');
    }
  }, [activeView, isEmployee]);

  useEffect(() => {
    if (isAuthReady && isAuthenticated && account?.user_id && activeView === 'scanner') {
      loadDropdowns(); loadScannerContracts();
    }
  }, [activeView, isAuthReady, isAuthenticated, account?.user_id, loadDropdowns, loadScannerContracts]);

  useEffect(() => {
    if (isAuthReady && isAuthenticated && isAdmin && activeView === 'dashboard') {
      loadDashboard({ silent: true });
    }
  }, [activeView, isAdmin, isAuthReady, isAuthenticated]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !isAdmin || activeView !== 'history') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      loadTicketHistory({ silent: true });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [activeView, historyFilters, isAdmin, isAuthReady, isAuthenticated, showArchivedTickets]);

  async function loadDashboard(options = {}) {
    if (!options.silent) {
      setIsLoadingDashboard(true);
    }

    try {
      const response = await apiFetch('/api/dashboard');

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setDashboard(data);
    } catch (error) {
      if (!options.silent) {
        reportError(error);
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

    const archived = options.archived ?? showArchivedTickets;
    params.set('archive_view', archived ? 'archived' : 'current');

    const query = params.toString();

    try {
      const response = await apiFetch(`/api/ticket-logs${query ? `?${query}` : ''}`);

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setTicketLogs(data.logs || []);
    } catch (error) {
      if (!options.silent) {
        reportError(error);
      }
    } finally {
      if (!options.silent) {
        setIsLoadingHistory(false);
      }
    }
  }

  async function loadContracts(options = {}) {
    try {
      const archived = options.archived ?? showArchivedContracts;
      const response = await apiFetch(`/api/contracts${archived ? '?archived=true' : ''}`);
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await response.json();
      setContracts(data.contracts || []);
    } catch (error) {
      if (!options.silent) reportError(error);
    }
  }

  async function loadFarmUsers(options = {}) {
    if (!options.silent) setIsLoadingUsers(true);

    try {
      const response = await apiFetch('/api/users');
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await response.json();
      setFarmUsers(data.users || []);
    } catch (error) {
      if (!options.silent) setUserStatus(cleanMessage(error));
    } finally {
      if (!options.silent) setIsLoadingUsers(false);
    }
  }

  function updateEmployeeForm(field, value) {
    setEmployeeForm((current) => ({ ...current, [field]: value }));
  }

  async function createFarmUser(event) {
    event.preventDefault();
    if (isCreatingEmployee) return;

    setIsCreatingEmployee(true);
    const roleLabel = employeeForm.role === 'admin' ? 'administrator' : 'employee';
    setUserStatus(`Creating ${roleLabel} login...`);
    try {
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employeeForm)
      });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      setEmployeeForm(blankEmployeeForm);
      await loadFarmUsers({ silent: true });
      setUserStatus(`${roleLabel === 'administrator' ? 'Administrator' : 'Employee'} account created. They can now log in with that email and password.`);
    } catch (error) {
      setUserStatus(cleanMessage(error));
    } finally {
      setIsCreatingEmployee(false);
    }
  }

  async function changeUserRole(user, nextRole) {
    if (changingMember || user.role === nextRole) return;
    if (!window.confirm(`Make ${user.display_name || user.email} ${nextRole === 'admin' ? 'an Administrator with farm management access' : 'an Employee with ticket scanning access'}?`)) return;
    setChangingMember(user.user_id);
    setUserStatus('Updating farm access...');
    try {
      const response = await apiFetch(`/api/users/${user.user_id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole })
      });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      await loadFarmUsers({ silent: true });
      if (user.user_id === account.user_id) await loadFarmSession();
      setUserStatus('Farm access updated.');
    } catch (error) {
      setUserStatus(cleanMessage(error));
    } finally { setChangingMember(''); }
  }

  async function repairEmployee() {
    if (!employeeForm.email.trim() || !employeeForm.display_name.trim()) {
      setUserStatus('Enter the existing employee name and email first.');
      return;
    }

    setIsCreatingEmployee(true);
    setUserStatus('Repairing employee farm access...');
    try {
      const response = await apiFetch('/api/users/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: employeeForm.display_name,
          email: employeeForm.email
        })
      });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      setEmployeeForm(blankEmployeeForm);
      await loadFarmUsers({ silent: true });
      setUserStatus('Employee login repaired and attached to this farm.');
    } catch (error) {
      setUserStatus(cleanMessage(error));
    } finally {
      setIsCreatingEmployee(false);
    }
  }

  function finishAccountDeletion() {
    if (sessionRef.current?.user?.id !== account?.user_id) return;
    clearPrivateForms();
    // Clear in-memory farm data as well as the persisted session after confirmed deletion.
    terminalAuthFailureRef.current = true;
    refreshPromiseRef.current = null;
    sessionRef.current = null;
    storeSession(null);
    setSession(null);
    setFarm(null);
    setAccount(null);
    setFarmUsers([]);
    setTicketLogs([]);
    setBins([]);
    setContracts([]);
    setDrivers([]);
    setLocations([]);
    resetScannerData();
    setDashboard(emptyDashboard());
    resetForNextTicket();
    setActiveView('dashboard');
    setAuthStatus('Your account has been deleted.');
    setAuthMode('login');
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
      const response = await apiFetch(`/api/ticket-logs/${editingTicket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTicket)
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      setEditingTicket(null);
      await Promise.all([loadTicketHistory(), loadContracts({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Ticket assignment and payment details updated.');
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleTicketPayment(log) {
    if (updatingPaymentIds.includes(log.id)) return;

    const previousStatus = log.payment_status || 'Not paid';
    const paymentStatus = previousStatus === 'Paid' ? 'Not paid' : 'Paid';
    const updatedTicket = ticketEditForm({ ...log, payment_status: paymentStatus });

    setUpdatingPaymentIds((current) => [...current, log.id]);
    setTicketLogs((current) => current.map((ticketLog) => (
      ticketLog.id === log.id ? { ...ticketLog, payment_status: paymentStatus } : ticketLog
    )));

    try {
      const response = await apiFetch(`/api/ticket-logs/${log.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTicket)
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await response.json();
      setTicketLogs((current) => current.map((ticketLog) => (
        ticketLog.id === log.id ? { ...ticketLog, ...data.ticket } : ticketLog
      )));
      loadDashboard({ silent: true });
      setStatus(`Ticket ${log.ticket_number || ''} marked ${paymentStatus.toLowerCase()}.`);
    } catch (error) {
      setTicketLogs((current) => current.map((ticketLog) => (
        ticketLog.id === log.id ? { ...ticketLog, payment_status: previousStatus } : ticketLog
      )));
      reportError(error);
    } finally {
      setUpdatingPaymentIds((current) => current.filter((id) => id !== log.id));
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
      const response = await apiFetch(`/api/contracts${editing ? `/${editingContractId}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contractForm)
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      resetContractForm();
      await Promise.all([loadContracts(), loadDashboard({ silent: true })]);
      setStatus(editing ? 'Contract updated.' : 'Contract created.');
    } catch (error) {
      reportError(error);
    }
  }

  async function removeContract(id) {
    if (!window.confirm('Delete this contract?')) return;

    try {
      const response = await apiFetch(`/api/contracts/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      await Promise.all([loadContracts(), loadDashboard({ silent: true })]);
      setStatus('Contract deleted.');
    } catch (error) {
      reportError(error);
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
      const response = await apiFetch(`/api/ticket-logs/${logId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadTicketHistory(), loadBins({ silent: true }), loadContracts({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Ticket log deleted.');
    } catch (error) {
      reportError(error);
    }
  }

  async function loadBins(options = {}) {
    if (!options.silent) {
      setIsLoadingBins(true);
    }

    try {
      const response = await apiFetch('/api/bins');

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setBins(data.bins || []);
    } catch (error) {
      if (!options.silent) {
        reportError(error);
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
      const response = await apiFetch('/api/drivers');

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setDrivers(data.drivers || []);
    } catch (error) {
      if (!options.silent) {
        reportError(error);
      }
    } finally {
      if (!options.silent) {
        setIsLoadingDrivers(false);
      }
    }
  }

  async function archiveContract(contract) {
    if (String(contract.status || '').toLowerCase() !== 'closed') {
      setStatus('Only closed contracts can be archived. Mark the contract Closed first, then archive it.');
      return;
    }

    if (!window.confirm(`Archive contract ${contract.contract_id}? It will leave the active contract list but remain available in archived contracts and ticket history.`)) return;

    try {
      const response = await apiFetch(`/api/contracts/${contract.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contract, status: 'Archived' })
      });

      if (!response.ok) throw new Error(await readErrorResponse(response));
      await Promise.all([loadContracts(), loadDashboard({ silent: true })]);
      setStatus('Contract archived.');
    } catch (error) {
      reportError(error);
    }
  }

  async function loadLocations(options = {}) {
    if (!options.silent) {
      setIsLoadingLocations(true);
    }

    try {
      const response = await apiFetch('/api/locations');

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await response.json();
      setLocations(data.locations || []);
    } catch (error) {
      if (!options.silent) {
        reportError(error);
      }
    } finally {
      if (!options.silent) {
        setIsLoadingLocations(false);
      }
    }
  }

  async function createDriver(event) {
    event.preventDefault();

    try {
      const response = await apiFetch('/api/drivers', {
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
      reportError(error);
    }
  }

  async function removeDriver(driverId) {
    try {
      const response = await apiFetch(`/api/drivers/${driverId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadDrivers(), loadDropdowns({ silent: true })]);
      setStatus('Driver removed.');
    } catch (error) {
      reportError(error);
    }
  }

  async function createLocation(event) {
    event.preventDefault();

    try {
      const response = await apiFetch('/api/locations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newLocationName })
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      setNewLocationName('');
      await Promise.all([loadLocations(), loadDropdowns({ silent: true })]);
      setStatus('Location added.');
    } catch (error) {
      reportError(error);
    }
  }

  async function removeLocation(locationId) {
    try {
      const response = await apiFetch(`/api/locations/${locationId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadLocations(), loadDropdowns({ silent: true })]);
      setStatus('Location removed.');
    } catch (error) {
      reportError(error);
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
      const response = await apiFetch(`/api/bins${isEditing ? `/${editingBinId}` : ''}`, {
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
      reportError(error);
    }
  }

  async function removeBin(binId) {
    const confirmed = window.confirm('Delete this bin? Existing inventory transactions will remain in the local history file.');

    if (!confirmed) {
      return;
    }

    try {
      const response = await apiFetch(`/api/bins/${binId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadBins(), loadDropdowns({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Bin deleted.');
    } catch (error) {
      reportError(error);
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
      const response = await apiFetch('/api/inventory-transactions', {
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

      const result = await response.json();
      setTransactionForms((current) => ({
        ...current,
        [binId]: blankTransactionForm
      }));
      await Promise.all([loadBins(), loadDropdowns({ silent: true }), loadDashboard({ silent: true })]);
      setStatus(result.capacity_capped
        ? 'Inventory transaction saved. Bin balance was capped at its capacity.'
        : 'Inventory transaction saved.');
    } catch (error) {
      reportError(error);
    }
  }

  async function removeInventoryTransaction(transactionId) {
    const confirmed = window.confirm('Delete this transaction? If it came from a ticket, the linked ticket log will also be deleted.');

    if (!confirmed) {
      return;
    }

    try {
      const response = await apiFetch(`/api/inventory-transactions/${transactionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      await Promise.all([loadBins(), loadTicketHistory({ silent: true }), loadDashboard({ silent: true })]);
      setStatus('Inventory transaction deleted.');
    } catch (error) {
      reportError(error);
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
    setOcrConsent(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl('');
    setTicket(emptyTicket());
    setScannerAssignment({ status: 'Spot', contractId: '' });
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

  function setTicketPhoto(file) {
    setOcrConsent(false);
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
    if (!ocrConsent) {
      setStatus('Please confirm photo processing before scanning, or enter the ticket details manually.');
      return;
    }
    if (!selectedFile) {
      setStatus('Please choose or take a ticket photo first.');
      return;
    }

    setIsExtracting(true);
    setIsSuccess(false);
    setStatus('Preparing photo for upload...');

    const formData = new FormData();

    try {
      const uploadFile = await withDeadline(() => convertImageToJpeg(selectedFile), 20000);
      formData.append('ticketImage', uploadFile);
      setStatus('Reading ticket image...');

      const response = await apiFetch('/api/extract-ticket', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      const data = await readJsonWithTimeout(response);

      setTicket((current) => ({
        ...emptyTicket(),
        ...data.ticket,
        hauled_by: current.hauled_by,
        hauled_from: current.hauled_from
      }));
      setDuplicate(data.duplicate);
      setStatus('Extraction complete. Review every field before submitting.');
    } catch (error) {
      reportError(error);
    } finally {
      setIsExtracting(false);
    }
  }

  async function submitTicket(event) {
    event.preventDefault();

    await submitReviewedTicket();
  }

  async function submitReviewedTicket(overageResolution = null) {
    if (ticketSubmittingRef.current) {
      return;
    }
    const missing = missingTicketFields(ticket);
    if (missing.length) {
      setStatus(`Complete these ticket fields: ${missing.map(field => fieldLabels[field]).join(', ')}.`);
      return;
    }
    if (parseTicketBushels(ticket.bushels) <= 0) {
      setStatus('Enter a bushel amount greater than zero.');
      return;
    }

    if (scannerAssignment.status === 'Contract' && !scannerAssignment.contractId) {
      setStatus('Choose a contract before submitting this ticket.');
      return;
    }

    const selectedBin = bins.find((bin) => bin.bin_name.toLowerCase() === ticket.hauled_from.trim().toLowerCase());
    const exceedsEstimate = selectedBin && parseTicketBushels(ticket.bushels) > Number(selectedBin.current_bushels);
    let allowBinOverdraw = false;

    if (exceedsEstimate) {
      allowBinOverdraw = window.confirm('This ticket exceeds estimated bin inventory. Continue and set this bin to 0?');

      if (!allowBinOverdraw) {
        setStatus('Ticket was not submitted. Review the selected bin or bushel amount.');
        return;
      }
    }

    const ticketBushels = parseTicketBushels(ticket.bushels);
    const selectedContract = scannerContracts.find((contract) => contract.id === scannerAssignment.contractId);
    let assignment = {
      assignment_status: 'Spot',
      assignments: [{
        type: 'SPOT',
        contract_id: '',
        bushels: ticketBushels
      }]
    };

    if (scannerAssignment.status === 'Contract') {
      const remainingBushels = Math.max(0, Number(selectedContract?.remaining_bushels) || 0);

      if (selectedContract && ticketBushels > remainingBushels && remainingBushels > 0 && !overageResolution) {
        setContractOverage({
          contractId: selectedContract.id,
          contractLabel: selectedContract.contract_id,
          buyer: selectedContract.buyer,
          appliedBushels: remainingBushels,
          overageBushels: ticketBushels - remainingBushels,
          destination: 'Spot',
          contractIdForOverage: ''
        });
        setStatus('This load fills the selected contract. Choose where the remaining bushels should go.');
        return;
      }

      if (overageResolution) {
        const overageAssignments = overageResolution.destination === 'Contract'
          ? [{
              type: 'CONTRACT',
              contract_id: overageResolution.contractIdForOverage,
              bushels: overageResolution.overageBushels
            }]
          : [{
              type: 'SPOT',
              contract_id: '',
              bushels: overageResolution.overageBushels
            }];

        assignment = {
          assignment_status: 'Split',
          assignments: [
            {
              type: 'CONTRACT',
              contract_id: overageResolution.contractId,
              bushels: overageResolution.appliedBushels
            },
            ...overageAssignments
          ]
        };
      } else {
        assignment = {
          assignment_status: 'Contract',
          assignments: [{
            type: 'CONTRACT',
            contract_id: scannerAssignment.contractId,
            bushels: ticketBushels
          }]
        };
      }
    }

    ticketSubmittingRef.current = true;
    setIsSubmitting(true);
    setIsSuccess(false);
    setStatus('Submitting reviewed data...');

    try {
      const actor = sessionRef.current?.user?.id;
      if (!actor) throw new Error('Please log in to continue.');
      // Keep one durable intent until a confirmed save, including lost responses.
      const requestId = pendingTicketRequest(localStorage, actor);
      await requireAtomicTicketWrites(apiFetch, requestId);
      const sendTicket = (confirmedOverdraw) => postTicketForActor(apiFetch, () => sessionRef.current?.user?.id, actor, {
          request_id: requestId,
          ticket: {
            ...ticket,
            ...assignment
          },
          allow_bin_overdraw: confirmedOverdraw
      });
      let response = await sendTicket(allowBinOverdraw);

      if (response.status === 409 && !allowBinOverdraw) {
        const errorData = await readJsonWithTimeout(response.clone()).catch(() => ({}));

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

      const data = await readJsonWithTimeout(response);
      confirmedTicketReceipt(data);
      completeTicketRequest(localStorage, actor, requestId);
      if (sessionRef.current?.user?.id !== actor) return;
      setRequestError('');

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setSelectedFile(null);
      setPreviewUrl('');
      setTicket(emptyTicket());
      setScannerAssignment({ status: 'Spot', contractId: '' });
      setContractOverage(null);
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
      setStatus('Ticket submitted successfully');
      loadDropdowns({ silent: true });
      loadScannerContracts({ silent: true });
      if (isAdmin) {
        loadTicketHistory({ silent: true });
        loadContracts({ silent: true });
        loadBins({ silent: true });
        loadDashboard({ silent: true });
      }
    } catch (error) {
      reportError(error);
    } finally {
      ticketSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function checkPreviousSubmission() {
    if (ticketSubmittingRef.current) return;
    const actor = sessionRef.current?.user?.id;
    if (!actor) return;
    ticketSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const requestId = pendingTicketRequest(localStorage, actor);
      const response = await apiFetch(`/api/ticket-submissions/${requestId}`, { timeoutMs: 20000 });
      if (!response.ok) throw new Error(await readErrorResponse(response));
      const data = await readJsonWithTimeout(response);
      if (sessionRef.current?.user?.id !== actor) return;
      if (!['committed', 'deleted'].includes(data.status) || !data.ticket?.id) {
        setStatus('No saved submission was found for this attempt. Retry the original ticket; do not start a second copy.');
        return;
      }
      const saved = data.ticket;
      const description = `Ticket ${saved.ticket_number}: ${saved.bushels} bushels to ${saved.delivered_to}.`;
      if (window.confirm(`${description}\n${data.status === 'deleted' ? 'It was saved and later deleted.' : 'It is already saved.'}\nClear this review before starting a different ticket?`)) {
        completeTicketRequest(localStorage, actor, requestId);
        setTicket(emptyTicket());
        setScannerAssignment({ status: 'Spot', contractId: '' });
        setContractOverage(null);
        setSelectedFile(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl('');
        setOtherValues({ delivered_to: '', hauled_by: '', hauled_from: '' });
        setOtherSelections({ delivered_to: false, hauled_by: false, hauled_from: false });
        setDuplicate(null);
        setStatus('Previous submission confirmed. You can now review a different ticket.');
      }
    } catch (error) { reportError(error); }
    finally { ticketSubmittingRef.current = false; setIsSubmitting(false); }
  }

  function submitContractOverage() {
    if (!contractOverage) return;

    if (contractOverage.destination === 'Contract' && !contractOverage.contractIdForOverage) {
      setStatus('Choose another contract for the remaining bushels, or send them to spot.');
      return;
    }

    const overageContract = scannerContracts.find((contract) => contract.id === contractOverage.contractIdForOverage);
    if (
      contractOverage.destination === 'Contract'
      && overageContract
      && Number(overageContract.remaining_bushels) < Number(contractOverage.overageBushels)
    ) {
      setStatus('That contract does not have enough remaining bushels for this overage.');
      return;
    }

    submitReviewedTicket(contractOverage);
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
          <small className="field-help">Choose Other to enter a driver not saved by your farm.</small>
        )}
        {options.length === 0 && field === 'delivered_to' && (
          <small className="field-help">Choose Other to enter a delivery location not saved by your farm.</small>
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

  if (!isAuthReady) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading">
          <div className="brand-lockup compact">
            <img src={binFlowMark} alt="" />
            <span>BinFlow</span>
          </div>
          <h2>Loading farm account...</h2>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-brand">
          <div className="brand-lockup">
            <img src={binFlowMark} alt="" />
            <span>BinFlow</span>
          </div>
          <p className="eyebrow">Professional grain operations</p>
          <h1>Know where every bushel stands.</h1>
          <p>Scan tickets, manage corn and soybean inventory, track contracts, and keep your farm records together.</p>
        </section>

        <section className="auth-card">
          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Log In</button>
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Create Farm</button>
            {invitationsAvailable && <button type="button" className={authMode === 'join' ? 'active' : ''} onClick={() => setAuthMode('join')}>Join Farm</button>}
          </div>
          {authMode === 'join' ? <JoinFarm apiBase={API_BASE} onLogin={message => { setAuthMode('login'); setAuthStatus(message); }} onSession={data => {
            storeSession(data); sessionRef.current = data; terminalAuthFailureRef.current = false; setSession(data);
          }} /> : <form onSubmit={submitAuth}>
          <div className="form-heading">
            <h2>{authMode === 'signup' ? 'Start a farm account' : 'Welcome back'}</h2>
            <p>{authMode === 'signup' ? 'Create the administrator account for your farm.' : 'Use your farm account to continue.'}</p>
          </div>
          {authMode === 'signup' && (
            <label className="field">
              <span>Farm Name</span>
              <input value={authForm.farmName} onChange={(event) => updateAuthField('farmName', event.target.value)} required />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={authForm.email} onChange={(event) => updateAuthField('email', event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" minLength={8} value={authForm.password} onChange={(event) => updateAuthField('password', event.target.value)} required />
          </label>
          <button className="primary-button" type="submit" disabled={isAuthenticating}>
            {isAuthenticating ? 'Please wait...' : authMode === 'signup' ? 'Create Farm Account' : 'Log In'}
          </button>
          {authStatus && <div className="notice">{authStatus}</div>}
          {authStatus && getStoredSession()?.refresh_token && <button type="button" disabled={isAuthenticating} onClick={() => { setIsAuthReady(false); setAuthAttempt(value => value + 1); }}>Reconnect Session</button>}
          </form>}
          <div className="settings-links"><a href="https://getbinflow.com/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a><a href="https://getbinflow.com/support/" target="_blank" rel="noreferrer">Support</a></div>
        </section>
      </main>
    );
  }

  if (!account) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading">
          <div className="brand-lockup compact">
            <img src={binFlowMark} alt="" />
            <span>BinFlow</span>
          </div>
          <h2>Loading your farm workspace...</h2>
          {requestError && <><p role="alert">{requestError}</p><button type="button" onClick={() => { setRequestError(''); loadFarmSession(); }}>Try Again</button><button type="button" onClick={logout}>Log Out</button></>}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${isEmployee ? 'employee-shell' : ''}`}>
      <section className="header-band">
        <div className="brand-lockup">
          <img src={binFlowMark} alt="" />
          <span>BinFlow</span>
        </div>
        <div className="account-tools">
          <div>
            <strong>{farm?.name || 'Farm account'}</strong>
            <span>{account.display_name || session.user?.email}</span>
            <small className="account-role">{isAdmin ? 'Administrator' : 'Employee scanner'}</small>
          </div>
          {isEmployee && <button type="button" className="account-settings-button" aria-current={SETTINGS_SCREENS.includes(activeView) ? 'page' : undefined} onClick={() => setActiveView(activeView === 'scanner' ? 'settings' : 'scanner')}>{activeView === 'scanner' ? 'Settings' : 'Scan'}</button>}
          <button type="button" onClick={logout}>Log Out</button>
        </div>
      </section>

      {isAdmin && <nav className="view-tabs" aria-label="App views">
        <button
          className={activeView === 'dashboard' ? 'active' : ''}
          aria-current={activeView === 'dashboard' ? 'page' : undefined}
          aria-label="Dashboard"
          type="button"
          onClick={() => {
            setActiveView('dashboard');
            loadDashboard();
          }}
        >
          Home
        </button>
        <button
          className={activeView === 'scanner' ? 'active' : ''}
          aria-current={activeView === 'scanner' ? 'page' : undefined}
          type="button"
          onClick={() => setActiveView('scanner')}
        >
          Scan
        </button>
        <button
          className={activeView === 'history' ? 'active' : ''}
          aria-current={activeView === 'history' ? 'page' : undefined}
          type="button"
          onClick={() => {
            setActiveView('history');
            loadTicketHistory();
          }}
        >
          History
        </button>
        <button
          className={activeView === 'inventory' ? 'active' : ''}
          aria-current={activeView === 'inventory' ? 'page' : undefined}
          type="button"
          onClick={() => {
            setActiveView('inventory');
            loadBins();
          }}
        >
          Bins
        </button>
        <button
          className={activeView === 'contracts' ? 'active' : ''}
          aria-current={activeView === 'contracts' ? 'page' : undefined}
          type="button"
          onClick={() => {
            setActiveView('contracts');
            loadContracts();
          }}
        >
          Contracts
        </button>
        <button
          className={SETTINGS_SCREENS.includes(activeView) ? 'active' : ''}
          aria-current={SETTINGS_SCREENS.includes(activeView) ? 'page' : undefined}
          type="button"
          onClick={() => {
            setActiveView('settings');
          }}
        >
          Settings
        </button>
      </nav>}

      {!online && <p role="status" className="notice app-notice">You are offline. Reconnect before scanning or saving changes.</p>}

      {requestError && activeView !== 'scanner' && <div role="alert" className="notice app-notice">{requestError}<button type="button" aria-label="Dismiss notification" onClick={() => setRequestError('')}>Dismiss</button></div>}

      {activeView === 'settings' && <SettingsHome role={account.role} onOpen={view => {
        if (!canOpenView(account.role, view)) return;
        setActiveView(view);
        if (view === 'team') loadFarmUsers();
      }} />}
      {isAdmin && ['locations', 'drivers'].includes(activeView) && <SavedNamesSettings
        key={activeView} kind={activeView} apiFetch={apiFetch}
        onBack={() => setActiveView('settings')}
        onChanged={() => loadDropdowns({ silent: true })}
      />}
      {activeView === 'account' && <AccountSettings
        account={{ ...account, email: session.user?.email || account.email }}
        farm={farm}
        apiFetch={apiFetch}
        onDeleted={finishAccountDeletion}
        onBack={() => setActiveView('settings')}
      />}

      {isAdmin && activeView === 'dashboard' && (
        <section className="dashboard-view">
          <div className="dashboard-hero">
            <div>
              <p className="eyebrow">Good to see you, {account.display_name?.split(' ')[0] || 'there'}</p>
              <h2>{farm?.name || 'Your farm'}</h2>
            </div>
            <div className="quick-actions">
              <button className="scan-action" type="button" onClick={() => setActiveView('scanner')}>Scan New Ticket</button>
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
              <span>Total Soybean Inventory</span>
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
              <small>farm ticket records</small>
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
                      <span>{displayCrop(item.crop)}</span>
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
                      <p>{displayCrop(bin.crop_type)}</p>
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

          <section className="dashboard-card weekly-summary">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Sunday to Sunday</p>
                <h2>Weekly Grain Summary</h2>
                <p>{dashboard.weekly_summary?.period_label || 'Current Eastern Time reporting period'}</p>
              </div>
              <span className="email-schedule">Emailed Sundays at noon ET</span>
            </div>
            {dashboard.weekly_summary?.activity_count === 0 ? (
              <div className="premium-empty">
                No grain movement has been entered this week. Empty weeks are not emailed.
              </div>
            ) : (
              <>
                <div className="weekly-summary-metrics">
                  <article>
                    <span>Ticket movement</span>
                    <strong>{formatNumber(dashboard.weekly_summary?.ticket_bushels)} bu</strong>
                    <small>{formatNumber(dashboard.weekly_summary?.ticket_count)} ticket entries</small>
                  </article>
                  <article className="positive">
                    <span>Manually added</span>
                    <strong>+{formatNumber(dashboard.weekly_summary?.grain_added_bushels)} bu</strong>
                    <small>Bin additions and upward corrections</small>
                  </article>
                  <article className="negative">
                    <span>Manually removed</span>
                    <strong>-{formatNumber(dashboard.weekly_summary?.grain_removed_bushels)} bu</strong>
                    <small>Bin removals and downward corrections</small>
                  </article>
                  <article>
                    <span>Manual net change</span>
                    <strong>{signedBushels(dashboard.weekly_summary?.manual_net_bushels)}</strong>
                    <small>{formatNumber(dashboard.weekly_summary?.manual_adjustment_count)} adjustments</small>
                  </article>
                </div>

                {dashboard.weekly_summary?.by_crop?.length > 0 && (
                  <div className="weekly-crop-grid">
                    {dashboard.weekly_summary.by_crop.map((crop) => (
                      <article key={crop.crop}>
                        <strong>{displayCrop(crop.crop)}</strong>
                        <span>{formatNumber(crop.ticket_bushels)} ticket bu</span>
                        <span>{signedBushels(crop.manual_net_bushels)} manual</span>
                      </article>
                    ))}
                  </div>
                )}

                <div className="weekly-movement-grid">
                  <div>
                    <h3>Ticket History Activity</h3>
                    <div className="weekly-entry-list">
                      {dashboard.weekly_summary?.tickets?.length === 0 ? (
                        <p className="weekly-empty">No ticket entries this week.</p>
                      ) : dashboard.weekly_summary.tickets.map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>Ticket {entry.ticket_number || 'without a number'}</strong>
                            <span>{displayCrop(entry.crop)} · {entry.hauled_from || 'No source'} to {entry.delivered_to || 'No destination'}</span>
                          </div>
                          <div className="weekly-entry-value">
                            <strong>{formatNumber(entry.bushels)} bu</strong>
                            <time>{new Date(entry.created_at).toLocaleString()}</time>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3>Manual Bin Adjustments</h3>
                    <div className="weekly-entry-list">
                      {dashboard.weekly_summary?.adjustments?.length === 0 ? (
                        <p className="weekly-empty">No manual bin adjustments this week.</p>
                      ) : dashboard.weekly_summary.adjustments.map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>{movementLabel(entry.transaction_type)} · {entry.bin_name}</strong>
                            <span>{displayCrop(entry.crop_type)} · {formatNumber(entry.previous_bin_balance)} to {formatNumber(entry.new_bin_balance)} bu</span>
                          </div>
                          <div className="weekly-entry-value">
                            <strong className={entry.bushel_change < 0 ? 'negative-text' : 'positive-text'}>
                              {signedBushels(entry.bushel_change)}
                            </strong>
                            <time>{new Date(entry.created_at).toLocaleString()}</time>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </section>
      )}

      {isAdmin && activeView === 'history' && (
        <section className="history-panel">
          <div className="form-heading">
            <h2>{showArchivedTickets ? 'Archived Ticket History' : 'Ticket History'}</h2>
            <p>
              {showArchivedTickets
                ? 'Review ticket logs from previous crop years. Ticket history archives automatically after August 31 each year.'
                : 'Review saved ticket logs for the current crop year. Older tickets are kept in archived history.'}
            </p>
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
                placeholder="Corn or Soybeans"
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
            <button
              type="button"
              onClick={() => {
                const next = !showArchivedTickets;
                setShowArchivedTickets(next);
                loadTicketHistory({ archived: next });
              }}
            >
              {showArchivedTickets ? 'Show Current Ticket History' : 'Show Archived Ticket History'}
            </button>
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

          <div className="history-count">
            {ticketLogs.length} {showArchivedTickets ? 'archived' : 'current'} ticket logs
          </div>

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
                      ['delivered_to', 'Delivered To'], ['bushels', 'Bushels'], ['moisture', 'Moisture'], ['price', 'Price'],
                      ['revenue', 'Revenue'], ['hauled_by', 'Hauled By'],
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
                      <td>{displayCrop(log.crop)}</td>
                      <td>{displayValue(log.hauled_from)}</td>
                      <td>{displayValue(log.delivered_to)}</td>
                      <td>{formatNumber(log.bushels)}</td>
                      <td>{formatNumber(log.moisture)}</td>
                      <td>{formatCurrency(log.price)}</td>
                      <td>{formatCurrency(log.revenue)}</td>
                      <td>{displayValue(log.hauled_by)}</td>
                      <td><span className={`status-tag ${(log.assignment_status || 'Unassigned').toLowerCase()}`}>{log.assignment_status || 'Unassigned'}</span></td>
                      <td>
                        <button
                          className={`status-tag payment-toggle ${(log.payment_status || 'Not paid').toLowerCase().replaceAll(' ', '-')}`}
                          type="button"
                          onClick={() => toggleTicketPayment(log)}
                          disabled={updatingPaymentIds.includes(log.id)}
                          aria-label={`Mark ticket ${log.ticket_number || ''} as ${(log.payment_status || 'Not paid') === 'Paid' ? 'not paid' : 'paid'}`}
                          title="Click to toggle paid status"
                        >
                          {updatingPaymentIds.includes(log.id) ? 'Saving...' : log.payment_status || 'Not paid'}
                        </button>
                      </td>
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

      {isAdmin && activeView === 'contracts' && (
        <section className="contracts-panel">
          <div className="form-heading">
            <h2>{showArchivedContracts ? 'Archived Grain Contracts' : 'Grain Contracts'}</h2>
            <p>
              {showArchivedContracts
                ? 'Review archived closed contracts, including contracted bushels, applied bushels, remaining bushels, and price.'
                : 'Track contracted bushels and archive closed contracts once they are filled and settled.'}
            </p>
          </div>

          {!showArchivedContracts && <form className="contract-form" onSubmit={saveContract}>
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
                  <option value="Beans">Soybeans</option>
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
                  <option>Archived</option>
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
          </form>}

          <div className="history-actions">
            <button
              type="button"
              onClick={() => {
                const next = !showArchivedContracts;
                setShowArchivedContracts(next);
                loadContracts({ archived: next });
              }}
            >
              {showArchivedContracts ? 'Show Active Contracts' : 'Show Archived Contracts'}
            </button>
            <button type="button" onClick={() => loadContracts()}>
              Refresh Contracts
            </button>
          </div>

          <div className="contract-grid">
            {contracts.length === 0 ? (
              <div className="premium-empty">
                {showArchivedContracts ? 'No archived contracts yet.' : 'No contracts yet. Add the first contract above.'}
              </div>
            ) : contracts.map((contract) => {
              const progress = contract.contracted_bushels > 0
                ? Math.min(100, (contract.delivered_applied_bushels / contract.contracted_bushels) * 100)
                : 0;

              return (
                <article className="contract-card" key={contract.id}>
                  <div className="contract-head">
                    <div>
                      <span>{displayCrop(contract.commodity)} · {contract.status}</span>
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
                    {!showArchivedContracts && (
                      <button type="button" onClick={() => archiveContract(contract)}>Archive Closed Contract</button>
                    )}
                    <button type="button" onClick={() => removeContract(contract.id)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {isAdmin && activeView === 'inventory' && (
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
                  <option value="Beans">Soybeans</option>
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
                        <p>{displayCrop(bin.crop_type)} · {formatNumber(bin.current_bushels)} bu</p>
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

      {isAdmin && activeView === 'team' && (
        <section className="users-panel">
          <div className="form-heading">
            <button className="settings-back" type="button" onClick={() => setActiveView('settings')}>Back to Settings</button>
            <h2>Team Members</h2>
          </div>
          {userStatus && <div className="notice">{userStatus}</div>}

          <FarmInvitationSettings apiFetch={apiFetch} available={invitationsAvailable} />
          <div className="user-management-grid">
            {!invitationsAvailable && <details className="legacy-user-access"><summary>Add a user with a temporary password</summary>
            <form className="employee-form" onSubmit={createFarmUser}>
              <div className="form-heading compact-heading">
                <h3>Add Farm User</h3>
                <p>Administrators manage the full farm. Employees only scan and submit tickets.</p>
              </div>
              <label className="field">
                <span>Name</span>
                <input
                  value={employeeForm.display_name}
                  onChange={(event) => updateEmployeeForm('display_name', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  value={employeeForm.role}
                  onChange={(event) => updateEmployeeForm('role', event.target.value)}
                >
                  <option value="employee">Employee — ticket scanner only</option>
                  <option value="admin">Administrator — full farm access</option>
                </select>
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={employeeForm.email}
                  onChange={(event) => updateEmployeeForm('email', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Temporary Password</span>
                <input
                  type="password"
                  minLength={8}
                  value={employeeForm.password}
                  onChange={(event) => updateEmployeeForm('password', event.target.value)}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={isCreatingEmployee}>
                {isCreatingEmployee ? 'Creating User...' : `Create ${employeeForm.role === 'admin' ? 'Administrator' : 'Employee'} Login`}
              </button>
            </form></details>}

            <div className="farm-user-list">
              <div className="section-title-row">
                <div>
                  <h3>Current Users</h3>
                  <p>{farmUsers.length} account{farmUsers.length === 1 ? '' : 's'} attached to {farm?.name || 'this farm'}.</p>
                </div>
                <button type="button" onClick={() => loadFarmUsers()} disabled={isLoadingUsers}>
                  {isLoadingUsers ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              {farmUsers.length === 0 ? (
                <div className="premium-empty">No farm users found.</div>
              ) : (
                farmUsers.map((user) => (
                  <article className="farm-user-row" key={user.user_id}>
                    <div>
                      <strong>{user.display_name || user.email}</strong>
                      <span>{user.email}</span>
                    </div>
                    <div className="farm-user-role-actions">
                      <span className={`role-badge ${user.role}`}>{user.role}</span>
                      <button type="button" disabled={Boolean(changingMember) || (user.role === 'admin' && farmUsers.filter(member => member.role === 'admin').length <= 1)}
                        title={user.role === 'admin' && farmUsers.filter(member => member.role === 'admin').length <= 1 ? 'The farm must keep at least one Administrator' : undefined}
                        onClick={() => changeUserRole(user, user.role === 'admin' ? 'employee' : 'admin')}>
                        {changingMember === user.user_id ? 'Updating...' : user.role === 'employee' ? 'Promote to Admin' : 'Make Employee'}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
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
        <TicketPhotoCapture key={account.user_id} previewUrl={previewUrl} onPhoto={setTicketPhoto} disabled={isExtracting || isSubmitting} />

        {selectedFile && <div className="ocr-consent">
          <label className="confirmation-check"><input type="checkbox" checked={ocrConsent} disabled={isExtracting || isSubmitting} onChange={event => setOcrConsent(event.target.checked)} />Allow this photo to be sent to OpenAI for ticket reading.</label>
          <p>Photos may contain names and farm information. Manual entry is available. <a href="https://getbinflow.com/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a></p>
        </div>}
        <button className="primary-button" onClick={extractTicket} disabled={isExtracting || isSubmitting || !selectedFile || !ocrConsent}>
          {isExtracting ? 'Scanning Ticket...' : 'Extract Ticket Data'}
        </button>

        <p className="status-text" role="status">{status}</p>
        <button type="button" className="text-button" onClick={checkPreviousSubmission} disabled={isSubmitting || isExtracting}>Check Previous Submission</button>

        {isLoadingDropdowns && (
          <p className="scanner-data-status" role="status">Loading bins, locations, and drivers...</p>
        )}
        {dropdownError && <div className="notice" role="alert"><p>Could not refresh farm choices. {dropdownError}</p><button type="button" onClick={loadDropdowns}>Retry Farm Choices</button></div>}
        {isLoadingScannerContracts && <p className="scanner-data-status" role="status">Loading contracts...</p>}
        {scannerContractsError && <div className="notice" role="alert"><p>Could not refresh contracts. {scannerContractsError}</p><button type="button" onClick={loadScannerContracts}>Retry Contracts</button></div>}

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

          {renderDropdownField('delivered_to', dropdowns.destinations, 'Choose Delivered To')}

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

          <fieldset className="sale-assignment wide-field">
            <legend>Sale Type</legend>
            <div className="segmented-control">
              <button
                type="button"
                className={scannerAssignment.status === 'Spot' ? 'active' : ''}
                onClick={() => setScannerAssignment({ status: 'Spot', contractId: '' })}
              >
                Spot
              </button>
              <button
                type="button"
                className={scannerAssignment.status === 'Contract' ? 'active' : ''}
                onClick={() => setScannerAssignment((current) => ({ ...current, status: 'Contract' }))}
              >
                Contract
              </button>
            </div>

            {scannerAssignment.status === 'Contract' && (
              <label className="field contract-picker">
                <span>Apply to Contract</span>
                <select
                  value={scannerAssignment.contractId}
                  onChange={(event) => setScannerAssignment({
                    status: 'Contract',
                    contractId: event.target.value
                  })}
                >
                  <option value="">Choose an outstanding contract</option>
                  {outstandingContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.contract_id} · {contract.buyer} · {formatNumber(contract.remaining_bushels)} bu remaining
                    </option>
                  ))}
                </select>
                {outstandingContracts.length === 0 && (
                  <small className="field-help">No outstanding {ticket.crop || 'grain'} contracts are available.</small>
                )}
              </label>
            )}
          </fieldset>

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

      {contractOverage && (
        <div className="modal-backdrop" role="presentation">
          <section className="contract-overage-modal" role="dialog" aria-modal="true" aria-labelledby="contract-overage-title">
            <div className="form-heading">
              <h2 id="contract-overage-title">Contract Filled</h2>
              <p>
                This load fills contract {contractOverage.contractLabel}
                {contractOverage.buyer ? ` for ${contractOverage.buyer}` : ''}. Choose where the remaining bushels should go.
              </p>
            </div>

            <div className="overage-summary">
              <article>
                <span>Applied to contract</span>
                <strong>{formatNumber(contractOverage.appliedBushels)} bu</strong>
              </article>
              <article>
                <span>Remaining load</span>
                <strong>{formatNumber(contractOverage.overageBushels)} bu</strong>
              </article>
            </div>

            <fieldset className="sale-assignment">
              <legend>Remaining bushels</legend>
              <div className="segmented-control">
                <button
                  type="button"
                  className={contractOverage.destination === 'Spot' ? 'active' : ''}
                  onClick={() => setContractOverage((current) => ({
                    ...current,
                    destination: 'Spot',
                    contractIdForOverage: ''
                  }))}
                >
                  Spot
                </button>
                <button
                  type="button"
                  className={contractOverage.destination === 'Contract' ? 'active' : ''}
                  onClick={() => setContractOverage((current) => ({
                    ...current,
                    destination: 'Contract'
                  }))}
                >
                  Another Contract
                </button>
              </div>

              {contractOverage.destination === 'Contract' && (
                <label className="field contract-picker">
                  <span>Apply remaining bushels to</span>
                  <select
                    value={contractOverage.contractIdForOverage}
                    onChange={(event) => setContractOverage((current) => ({
                      ...current,
                      contractIdForOverage: event.target.value
                    }))}
                  >
                    <option value="">Choose another outstanding contract</option>
                    {outstandingContracts
                      .filter((contract) => (
                        contract.id !== contractOverage.contractId
                        && Number(contract.remaining_bushels) >= Number(contractOverage.overageBushels)
                      ))
                      .map((contract) => (
                        <option key={contract.id} value={contract.id}>
                          {contract.contract_id} · {contract.buyer} · {formatNumber(contract.remaining_bushels)} bu remaining
                        </option>
                      ))}
                  </select>
                  <small className="field-help">Only contracts with enough remaining bushels are shown.</small>
                </label>
              )}
            </fieldset>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setContractOverage(null)}>
                Review Ticket
              </button>
              <button type="button" className="primary-button" onClick={submitContractOverage} disabled={isSubmitting}>
                {isSubmitting ? 'Submitting Ticket...' : 'Submit Split Ticket'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
