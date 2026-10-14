import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isArchivedTicket } from './archivePolicy.js';
import { accountDeletionEligibility } from './accountDeletionPolicy.js';
import { clampBinBalance } from './binCapacity.js';
import { hasExplicitEstimate, resolveOpeningEstimate } from './inventoryEstimate.js';
import { requireUuid, restQuery } from './restQuery.js';

const requestContext = new AsyncLocalStorage();
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numeric(value) {
  const number = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function configReady() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

async function rawRequest(path, { token, method = 'GET', body, prefer, serviceRole = false } = {}) {
  if (!configReady()) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
  if (serviceRole && !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  }

  const apiKey = serviceRole ? supabaseServiceRoleKey : supabaseAnonKey;
  const authorization = serviceRole ? supabaseServiceRoleKey : token || supabaseAnonKey;

  const url = new URL(path, supabaseUrl);
  if (url.hash || url.origin !== new URL(supabaseUrl).origin) throw new Error('Unsafe Supabase request URL.');
  const response = await fetch(url, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.hint || `Supabase request failed (${response.status}).`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }

  return data;
}

function serviceDb(path, options = {}) {
  return rawRequest(`/rest/v1/${path}`, {
    ...options,
    serviceRole: true
  });
}

export function farmFeatureRpc(name, body) {
  return serviceDb(restQuery(`rpc/${name}`), { method: 'POST', body });
}

export async function authenticateJoinRequest(authorization) {
  const token = clean(authorization).replace(/^Bearer\s+/i, '');
  if (!token) { const error = new Error('Authentication required'); error.status = 401; throw error; }
  try { return await rawRequest('/auth/v1/user', { token }); }
  catch { const error = new Error('Invalid authentication'); error.status = 401; throw error; }
}

export function signupInvitedUser(body) {
  // Normal Supabase signup: retain the project's verification/password policies.
  return rawRequest('/auth/v1/signup', { method: 'POST', body });
}

export function isPublicInvitationRequest(req) {
  return req.method === 'POST' && ['/farm-invites/preview', '/farm-invites/register', '/farm-invites/accept'].includes(req.path);
}

async function buildContext(accessToken) {
  const user = await rawRequest('/auth/v1/user', { token: accessToken });
  const useServiceRole = Boolean(supabaseServiceRoleKey);
  const accounts = await rawRequest(
    `/rest/v1/${restQuery('farm_accounts', { select: 'farm_id,role,display_name,email', user_id: `eq.${requireUuid(user.id)}`, limit: 1 })}`,
    { token: accessToken, serviceRole: useServiceRole }
  );

  if (!accounts?.[0]?.farm_id) {
    throw new Error('No farm account is attached to this login.');
  }

  const membership = accounts[0];
  const farms = await rawRequest(
    `/rest/v1/${restQuery('farms', { select: 'id,name', id: `eq.${requireUuid(membership.farm_id)}`, limit: 1 })}`,
    { token: accessToken, serviceRole: useServiceRole }
  );
  return {
    token: accessToken,
    user,
    farmId: membership.farm_id,
    role: membership.role || 'admin',
    member: {
      user_id: user.id,
      farm_id: membership.farm_id,
      role: membership.role || 'admin',
      display_name: clean(membership.display_name) || clean(user.user_metadata?.display_name) || clean(user.email),
      email: clean(membership.email) || clean(user.email)
    },
    farm: farms?.[0] || { id: membership.farm_id, name: 'Farm' }
  };
}

export async function requireSupabaseAuth(req, res, next) {
  if (isPublicInvitationRequest(req)) return next();
  if (req.path === '/health' || req.path === '/weekly-summary/send') return next();

  const token = clean(req.get('authorization')).replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });

  try {
    const context = await buildContext(token);
    req.supabaseFarmContext = context;
    requestContext.run(context, next);
  } catch (error) {
    res.status(401).json({ error: 'Your session is invalid or expired.', detail: error.message });
  }
}

export function resumeSupabaseAuth(req, callback) {
  if (!req.supabaseFarmContext) {
    throw new Error('Missing authenticated farm context.');
  }

  return requestContext.run(req.supabaseFarmContext, callback);
}

export function currentFarm() {
  const context = requestContext.getStore();
  return context?.farm || null;
}

export function currentAccount() {
  const value = requestContext.getStore();
  return value?.member || null;
}

function context() {
  const value = requestContext.getStore();
  if (!value) throw new Error('Missing authenticated farm context.');
  return value;
}

async function db(path, options = {}) {
  return rawRequest(`/rest/v1/${path}`, {
    ...options,
    token: context().token,
    serviceRole: Boolean(supabaseServiceRoleKey)
  });
}

export async function listFarmUsers() {
  const { farmId } = context();
  return db(restQuery('farm_accounts', { select: 'user_id,farm_id,role,display_name,email,created_at,updated_at', farm_id: `eq.${farmId}`, order: 'created_at.asc' }));
}

export async function listWeeklySummaryFarms() {
  return serviceDb(restQuery('farms', { select: 'id,name', order: 'created_at.asc' }));
}

export async function getWeeklySummaryFarmData(farmId, periodStart, periodEnd) {
  const start = new Date(periodStart).toISOString();
  const end = new Date(periodEnd).toISOString();
  const farm = requireUuid(farmId);
  const [tickets, transactions, bins, admins] = await Promise.all([
    serviceDb(restQuery('tickets', { select: '*', farm_id: `eq.${farm}`, created_at: [`gte.${start}`, `lt.${end}`], order: 'created_at.asc' })),
    serviceDb(restQuery('inventory_transactions', { select: '*', farm_id: `eq.${farm}`, created_at: [`gte.${start}`, `lt.${end}`], order: 'created_at.asc' })),
    serviceDb(restQuery('bins', { select: 'id,bin_name', farm_id: `eq.${farm}` })),
    serviceDb(restQuery('farm_accounts', { select: 'display_name,email', farm_id: `eq.${farm}`, role: 'eq.admin', order: 'created_at.asc' }))
  ]);
  return { tickets, transactions, bins, admins };
}

export async function getWeeklySummaryDelivery(farmId, periodEnd) {
  const farm = requireUuid(farmId);
  const end = new Date(periodEnd).toISOString();
  const rows = await serviceDb(
    restQuery('weekly_summary_deliveries', { select: '*', farm_id: `eq.${farm}`, period_end: `eq.${end}`, limit: 1 })
  );
  return rows[0] || null;
}

export async function recordWeeklySummaryDelivery(input) {
  const rows = await serviceDb('weekly_summary_deliveries', {
    method: 'POST',
    prefer: 'return=representation',
    body: input
  });
  return rows[0];
}

function normalizeFarmRole(value) {
  const role = clean(value).toLowerCase();
  if (!['admin', 'employee'].includes(role)) {
    throw new Error('Role must be admin or employee.');
  }
  return role;
}

async function farmHasOperationalData(farmId) {
  const tables = ['tickets', 'bins', 'contracts', 'payments', 'inventory_transactions'];
  const results = await Promise.all(
    tables.map((table) => db(restQuery(table, { select: 'id', farm_id: `eq.${farmId}`, limit: 1 })))
  );
  return results.some((rows) => rows.length > 0);
}



async function accountDeletionSnapshot() {
  const { farmId, member, farm } = context();
  const [members, hasOperationalData] = await Promise.all([
    db(restQuery('farm_accounts', { select: 'user_id,farm_id,role,display_name,email,created_at,updated_at', farm_id: `eq.${farmId}`, order: 'created_at.asc' })),
    farmHasOperationalData(farmId)
  ]);

  return {
    farm,
    account: member,
    members,
    hasOperationalData,
    eligibility: accountDeletionEligibility({
      account: member,
      farm,
      members,
      hasOperationalData
    })
  };
}

export async function getAccountDeletionPreview() {
  const snapshot = await accountDeletionSnapshot();

  return {
    farm: snapshot.farm,
    account: snapshot.account,
    eligibility: snapshot.eligibility,
    member_count: snapshot.members.length,
    admin_count: snapshot.members.filter((member) => member.role === 'admin').length,
    has_operational_data: snapshot.hasOperationalData,
    execution_available: false
  };
}

export async function deleteCurrentAccount() {
  // Auth deletion needs a separate atomic, farm-locked workflow before activation.
  const error = new Error('Account deletion is unavailable until its atomic farm and Auth workflow is approved. Contact support.');
  error.status = 503;
  throw error;
}

export async function updateFarmUserRole(userId, requestedRole) {
  const { member, role } = context();
  if (role !== 'admin') throw new Error('Only farm admins can change user roles.');
  if (!supabaseServiceRoleKey) throw new Error('Role changes require SUPABASE_SERVICE_ROLE_KEY.');

  if (process.env.FARM_INVITATIONS_ENABLED !== 'true') throw new Error('Farm membership management is not enabled yet.');
  return farmFeatureRpc('change_farm_member', { p_actor: member.user_id, p_target: requireUuid(userId), p_role: normalizeFarmRole(requestedRole), p_remove: false });
}

export function removeFarmMember(userId) {
  const { member, role } = context();
  if (role !== 'admin' || process.env.FARM_INVITATIONS_ENABLED !== 'true') throw new Error('Farm membership management is not available.');
  return farmFeatureRpc('change_farm_member', { p_actor: member.user_id, p_target: requireUuid(userId), p_role: null, p_remove: true });
}

function publicBin(bin, transactions = []) {
  const capacity = numeric(bin.estimated_capacity_bushels);
  const current = clampBinBalance(bin.current_bushels, capacity);

  return {
    ...bin,
    inventory_is_estimated: Boolean(bin.inventory_is_estimated) || hasExplicitEstimate(transactions.filter((transaction) => transaction.bin_id === bin.id)),
    estimated_capacity_bushels: capacity,
    current_bushels: current,
    percent_full: capacity > 0 ? Math.min(100, Math.max(0, current / capacity * 100)) : null,
    recent_transactions: transactions
      .filter((item) => item.bin_id === bin.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
  };
}

export async function getInventorySnapshot() {
  const { farmId } = context();
  const [bins, transactions] = await Promise.all([
    db(restQuery('bins', { select: '*', farm_id: `eq.${farmId}` })),
    db(restQuery('inventory_transactions', { select: '*', farm_id: `eq.${farmId}`, order: 'created_at.desc' }))
  ]);
  return { bins: bins.map((bin) => publicBin(bin, transactions)), transactions };
}

export async function listBins() {
  const snapshot = await getInventorySnapshot();
  return snapshot.bins
    .map((bin) => publicBin(bin, snapshot.transactions))
    .sort((a, b) => a.bin_name.localeCompare(b.bin_name));
}

export async function createBin(input) {
  const mode = input.opening_mode || (Number(input.current_bushels) ? 'bushels' : 'empty');
  if (mode !== 'empty' && process.env.INVENTORY_ESTIMATES_ENABLED !== 'true') throw new Error('Initial inventory estimates are not enabled yet.');
  resolveOpeningEstimate({ mode, capacity: input.estimated_capacity_bushels, bushels: input.current_bushels, fillPercentage: input.fill_percentage });
  const result = await inventoryCommand('create_bin', { ...input, opening_mode: mode });
  return publicBin(result.bin);
}

export async function updateBin(id, input) {
  const result = await inventoryCommand('update_bin', { ...input, bin_id: requireUuid(id) });
  return publicBin(result.bin);
}

export function deleteBin(id) {
  return inventoryCommand('delete_bin', { bin_id: requireUuid(id) });
}

export async function createInventoryTransaction(input) {
  const type = clean(input.transaction_type).toUpperCase();
  if (!['ADD_GRAIN', 'REMOVE_GRAIN', 'MANUAL_ADJUSTMENT', 'ESTIMATE_CORRECTION'].includes(type)) throw new Error('Use ticket submission for a ticket sale, or a supported inventory adjustment.');
  if (type === 'ESTIMATE_CORRECTION' && process.env.INVENTORY_ESTIMATES_ENABLED !== 'true') throw new Error('Inventory estimate corrections are not enabled yet.');
  const result = await inventoryCommand('transaction', { ...input, bin_id: requireUuid(input.bin_id), transaction_type: type });
  return { ...result, bin: publicBin(result.bin) };
}

export function deleteInventoryTransaction(id) {
  return inventoryCommand('delete_transaction', { id: requireUuid(id) });
}

function inventoryCommand(action, input) {
  return farmFeatureRpc('farm_inventory_command', { p_actor: context().member.user_id, p_action: action, p_input: input });
}

export function listInventoryTransactions(filters = {}) {
  return db(restQuery('inventory_transactions', {
    select: '*', farm_id: `eq.${context().farmId}`, order: 'created_at.desc',
    bin_id: filters.bin_id ? `eq.${requireUuid(filters.bin_id)}` : undefined,
    transaction_type: filters.transaction_type ? `eq.${filters.transaction_type}` : undefined
  }));
}

function normalizeTicket(ticket, existing = {}) {
  const price = numeric(ticket.price ?? existing.price);
  const bushels = numeric(ticket.bushels ?? existing.bushels);
  return {
    ...existing,
    date: clean(ticket.date ?? existing.date),
    crop: clean(ticket.crop ?? existing.crop),
    ticket_number: clean(ticket.ticket_number ?? existing.ticket_number),
    delivered_to: clean(ticket.delivered_to ?? ticket.elevator ?? existing.delivered_to),
    hauled_by: clean(ticket.hauled_by ?? existing.hauled_by),
    hauled_from: clean(ticket.hauled_from ?? ticket.field_or_bin ?? existing.hauled_from),
    bushels,
    gross_weight: numeric(ticket.gross_weight ?? existing.gross_weight),
    tare_weight: numeric(ticket.tare_weight ?? existing.tare_weight),
    net_weight: numeric(ticket.net_weight ?? existing.net_weight),
    moisture: numeric(ticket.moisture ?? existing.moisture),
    price,
    revenue: price * bushels,
    notes: clean(ticket.notes ?? existing.notes),
    assignment_status: clean(ticket.assignment_status ?? existing.assignment_status) || 'Unassigned',
    assignments: Array.isArray(ticket.assignments ?? existing.assignments) ? (ticket.assignments ?? existing.assignments) : [],
    payment_status: clean(ticket.payment_status ?? existing.payment_status) || 'Not paid',
    payment_date: clean(ticket.payment_date ?? existing.payment_date) || null,
    amount_received: numeric(ticket.amount_received ?? existing.amount_received),
    payment_reference: clean(ticket.payment_reference ?? existing.payment_reference),
    payment_notes: clean(ticket.payment_notes ?? existing.payment_notes),
    inventory_transaction_id: ticket.inventory_transaction_id || existing.inventory_transaction_id || null,
    updated_at: new Date().toISOString()
  };
}

export async function submitTicketAtomically(ticket, requestId, allowOverdraw = false) {
  try {
    const { updated_at, ...stableTicket } = normalizeTicket(ticket);
    const result = await farmFeatureRpc('farm_ticket_command', {
      p_actor: context().member.user_id, p_action: 'submit', p_id: null,
      p_input: { ...stableTicket, allow_overdraw: allowOverdraw }, p_request: requireUuid(requestId)
    });
    return result.ticket;
  } catch (error) {
    if (error.message.includes('BIN_INVENTORY_OVERDRAW')) error.code = 'BIN_INVENTORY_OVERDRAW';
    throw error;
  }
}

export function ticketRequestStatus(requestId) {
  return farmFeatureRpc('ticket_request_status', { p_actor: context().member.user_id, p_request: requireUuid(requestId) });
}

export async function updateTicketLog(id, input) {
  const { farmId } = context();
  const existing = (await db(restQuery('tickets', { select: '*', id: `eq.${requireUuid(id)}`, farm_id: `eq.${farmId}`, limit: 1 })))[0];
  if (!existing) throw new Error('Ticket not found.');
  const result = await farmFeatureRpc('farm_ticket_command', {
    p_actor: context().member.user_id, p_action: 'update', p_id: requireUuid(id),
    p_input: normalizeTicket(input, existing), p_request: null
  });
  return result.ticket;
}

export async function getTicketLogSnapshot() {
  const { farmId } = context();
  const [tickets, users] = await Promise.all([
    db(restQuery('tickets', { select: '*', farm_id: `eq.${farmId}`, order: 'created_at.desc' })),
    db(restQuery('farm_accounts', { select: 'user_id,display_name,email', farm_id: `eq.${farmId}` }))
  ]);
  const userNames = new Map(users.map((user) => [
    user.user_id,
    clean(user.display_name) || clean(user.email) || 'Farm user'
  ]));

  return tickets.map((ticket) => ({
    ...ticket,
    scanned_by_name: userNames.get(ticket.scanned_by_user_id) || clean(ticket.scanned_by_name) || 'Farm user'
  }));
}

export async function listTicketLogs(filters = {}) {
  const logs = await getTicketLogSnapshot();
  const search = clean(filters.search).toLowerCase();
  return logs.filter((log) => {
    const archived = isArchivedTicket(log);
    if (filters.archive_view === 'archived' && !archived) return false;
    if (filters.archive_view !== 'archived' && archived) return false;
    if (filters.crop && clean(log.crop).toLowerCase() !== clean(filters.crop).toLowerCase()) return false;
    if (filters.date && !clean(log.date).toLowerCase().includes(clean(filters.date).toLowerCase())) return false;
    if (filters.ticket_number && !clean(log.ticket_number).toLowerCase().includes(clean(filters.ticket_number).toLowerCase())) return false;
    if (filters.elevator && !clean(log.delivered_to).toLowerCase().includes(clean(filters.elevator).toLowerCase())) return false;
    if (filters.scanned_by && !clean(log.scanned_by_name).toLowerCase().includes(clean(filters.scanned_by).toLowerCase())) return false;
    if (filters.assignment_status && log.assignment_status !== filters.assignment_status) return false;
    if (filters.payment_status && log.payment_status !== filters.payment_status) return false;
    return !search || Object.values(log).some((value) => clean(value).toLowerCase().includes(search));
  });
}

export async function deleteTicketLog(id) {
  const result = await farmFeatureRpc('farm_ticket_command', {
    p_actor: context().member.user_id, p_action: 'delete', p_id: requireUuid(id), p_input: {}, p_request: null
  });
  return result.deleted_ticket_log;
}

function contractWithBalances(contract, tickets) {
  const delivered = tickets.reduce((total, ticket) => total + (ticket.assignments || []).reduce((sum, assignment) => (
    assignment.type === 'CONTRACT' && assignment.contract_id === contract.id ? sum + numeric(assignment.bushels) : sum
  ), 0), 0);
  return {
    ...contract,
    delivered_applied_bushels: delivered,
    remaining_bushels: Math.max(0, numeric(contract.contracted_bushels) - delivered)
  };
}

export async function listContracts(ticketLogs = null, options = {}) {
  const { farmId } = context();
  const [contracts, tickets] = await Promise.all([
    db(restQuery('contracts', { select: '*', farm_id: `eq.${farmId}`, order: 'contract_id.asc' })),
    ticketLogs ? Promise.resolve(ticketLogs) : getTicketLogSnapshot()
  ]);
  return contracts
    .map((contract) => contractWithBalances(contract, tickets))
    .filter((contract) => {
      if (options.includeAll) return true;
      const archived = clean(contract.status).toLowerCase() === 'archived';
      return options.includeArchived ? archived : !archived;
    });
}

export async function createContract(input, ticketLogs = []) {
  const { farmId } = context();
  const rows = await db('contracts', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      farm_id: farmId,
      contract_id: clean(input.contract_id),
      buyer: clean(input.buyer),
      commodity: clean(input.commodity),
      contracted_bushels: numeric(input.contracted_bushels),
      contract_price: numeric(input.contract_price),
      delivery_window: clean(input.delivery_window),
      status: clean(input.status) || 'Open',
      notes: clean(input.notes)
    }
  });
  return contractWithBalances(rows[0], ticketLogs);
}

export async function updateContract(id, input, ticketLogs = []) {
  const { farmId } = context();
  const rows = await db(restQuery('contracts', { id: `eq.${requireUuid(id)}`, farm_id: `eq.${farmId}` }), {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      contract_id: clean(input.contract_id),
      buyer: clean(input.buyer),
      commodity: clean(input.commodity),
      contracted_bushels: numeric(input.contracted_bushels),
      contract_price: numeric(input.contract_price),
      delivery_window: clean(input.delivery_window),
      status: clean(input.status) || 'Open',
      notes: clean(input.notes),
      updated_at: new Date().toISOString()
    }
  });
  if (!rows[0]) throw new Error('Contract not found.');
  return contractWithBalances(rows[0], ticketLogs);
}

export async function deleteContract(id, ticketLogs = []) {
  const { farmId } = context();
  const used = ticketLogs.some((ticket) => (ticket.assignments || []).some((assignment) => assignment.contract_id === id));
  if (used) throw new Error('This contract is assigned to ticket bushels. Reassign those tickets before deleting it.');
  await db(restQuery('contracts', { id: `eq.${requireUuid(id)}`, farm_id: `eq.${farmId}` }), { method: 'DELETE' });
  return { ok: true };
}

async function settings() {
  const { farmId } = context();
  const rows = await db(restQuery('farm_settings', { select: '*', farm_id: `eq.${farmId}`, limit: 1 }));
  if (rows[0]) return rows[0];

  const created = await db('farm_settings', {
    method: 'POST',
    prefer: 'return=representation',
    body: { farm_id: farmId }
  });
  return created[0];
}

export async function listDrivers() {
  const row = await settings();
  return (row?.drivers || [])
    .filter((item) => !item.kind || item.kind === 'driver')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createDriver(input) {
  const { farmId } = context();
  const row = await settings();
  const name = clean(input.name);
  if (!name) throw new Error('Driver name is required.');
  const drivers = row?.drivers || [];
  const existing = drivers.find((driver) => (
    (!driver.kind || driver.kind === 'driver') && driver.name.toLowerCase() === name.toLowerCase()
  ));
  if (existing) return existing;
  const driver = { id: randomUUID(), name, kind: 'driver', created_at: new Date().toISOString() };
  await db(restQuery('farm_settings', { farm_id: `eq.${farmId}` }), {
    method: 'PATCH',
    body: { drivers: [...drivers, driver], updated_at: new Date().toISOString() }
  });
  return driver;
}

export async function deleteDriver(id) {
  const { farmId } = context();
  const row = await settings();
  await db(restQuery('farm_settings', { farm_id: `eq.${farmId}` }), {
    method: 'PATCH',
    body: {
      drivers: (row?.drivers || []).filter((driver) => (
        driver.id !== id || (driver.kind && driver.kind !== 'driver')
      )),
      updated_at: new Date().toISOString()
    }
  });
  return { ok: true };
}

export async function listLocations() {
  const row = await settings();
  return (row?.drivers || [])
    .filter((item) => item.kind === 'location')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createLocation(input) {
  const { farmId } = context();
  const row = await settings();
  const name = clean(input.name);
  if (!name) throw new Error('Location name is required.');
  const drivers = row?.drivers || [];
  const existing = drivers.find((location) => (
    location.kind === 'location' && location.name.toLowerCase() === name.toLowerCase()
  ));
  if (existing) return existing;
  const location = { id: randomUUID(), name, kind: 'location', created_at: new Date().toISOString() };
  await db(restQuery('farm_settings', { farm_id: `eq.${farmId}` }), {
    method: 'PATCH',
    body: { drivers: [...drivers, location], updated_at: new Date().toISOString() }
  });
  return location;
}

export async function deleteLocation(id) {
  const { farmId } = context();
  const row = await settings();
  await db(restQuery('farm_settings', { farm_id: `eq.${farmId}` }), {
    method: 'PATCH',
    body: {
      drivers: (row?.drivers || []).filter((location) => (
        location.id !== id || location.kind !== 'location'
      )),
      updated_at: new Date().toISOString()
    }
  });
  return { ok: true };
}
