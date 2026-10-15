import { authErrorMessage } from './apiErrors.js';
import { fetchWithTimeout } from './network.js';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SESSION_KEY = 'binflow-supabase-session';

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  }
}

async function authRequest(path, body) {
  requireConfig();
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }, 20000);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(authErrorMessage(data, response.status));
    error.status = response.status;
    throw error;
  }

  return data;
}

export function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function storeSession(session) {
  if (session?.access_token) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function isSessionExpired(session, bufferSeconds = 30) {
  if (!session?.expires_at) return false;
  return Number(session.expires_at) <= Math.floor(Date.now() / 1000) + bufferSeconds;
}

export async function signUpFarm({ farmName, email, password }) {
  const data = await authRequest('signup', {
    email,
    password,
    data: { farm_name: farmName }
  });

  if (data.access_token) storeSession(data);
  return data;
}

export async function signInFarm({ email, password }, { persist = true } = {}) {
  const data = await authRequest('token?grant_type=password', { email, password });
  if (persist) storeSession(data);
  return data;
}

export async function refreshSession(refreshToken) {
  const data = await authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken });
  storeSession(data);
  return data;
}

export async function signOutFarm(accessToken, { clearLocal = true } = {}) {
  if (clearLocal) storeSession(null);
  if (SUPABASE_URL && SUPABASE_ANON_KEY && accessToken) {
    await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }, 10000).catch(() => {});
  }
}
