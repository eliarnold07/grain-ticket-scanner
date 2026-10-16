import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isArchivedTicket } from './archivePolicy.js';
import { AccountDeletionError, performAccountDeletion } from './accountDeletionService.js';
import { clampBinBalance } from './binCapacity.js';
import { canonicalRestPath, requireUuid, restQuery } from './restQuery.js';

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

  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
      ...(serviceRole && requestContext.getStore()?.user?.id ? { 'X-BinFlow-Actor': requestContext.getStore().user.id } : {}),
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
  return rawRequest(`/rest/v1/${canonicalRestPath(path)}`, {
    ...options,
    serviceRole: true
  });
}

export function farmFeatureRpc(name, body) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid command.');
  return serviceDb(`rpc/${name}`, { method: 'POST', body });
}

export async function authenticateJoinRequest(authorization) {
  const token = clean(authorization).replace(/^Bearer\s+/i, '');
  if (!token) { const error = new Error('Authentication required'); error.status = 401; throw error; }
  try { return await rawRequest('/auth/v1/user', { token }); }
  catch { const error = new Error('Invalid authentication'); error.status = 401; throw error; }
}

export function signupInvitedUser(body) {
  return rawRequest('/auth/v1/signup', { method: 'POST', body });
}

export function isPublicInvitationRequest(req) {
  if (req.method === 'GET' && req.path === '/app-capabilities') return true;
  return req.method === 'POST' && ['/farm-invites/preview', '/farm-invites/register', '/farm-invites/accept'].includes(req.path);
}

async function buildContext(accessToken) {
  const user = await rawRequest('/auth/v1/user', { token: accessToken });
  const useServiceRole = Boolean(supabaseServiceRoleKey);
  const accounts = await rawRequest(
    `/rest/v1/farm_accounts?select=farm_id,role,display_name,email&user_id=eq.${user.id}&limit=1`,
    { token: accessToken, serviceRole: useServiceRole }
  );

  if (!accounts?.[0]?.farm_id) {
    throw new Error('No farm account is attached to this login.');
  }

  const membership = accounts[0];
  if (!['admin', 'employee'].includes(membership.role)) throw new Error('Invalid farm role.');
  const farms = await rawRequest(
    `/rest/v1/farms?select=id,name&id=eq.${membership.farm_id}&limit=1`,
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
  return rawRequest(`/rest/v1/${canonicalRestPath(path, context().farmId)}`, {
    ...options,
    token: context().token,
    serviceRole: Boolean(supabaseServiceRoleKey)
  });
}

export async function listFarmUsers() {
  const { farmId } = context();
  return db(`farm_accounts?select=user_id,farm_id,role,display_name,email,created_at,updated_at&farm_id=eq.${farmId}&order=created_at.asc`);
}

export async function listWeeklySummaryFarms() {
  return serviceDb('farms?select=id,name&order=created_at.asc');
}

export async function getWeeklySummaryFarmData(farmId, periodStart, periodEnd) {
  const start = encodeURIComponent(new Date(periodStart).toISOString());
  const end = encodeURIComponent(new Date(periodEnd).toISOString());
  const farm = encodeURIComponent(farmId);
  const [tickets, transactions, bins, admins] = await Promise.all([
    serviceDb(`tickets?select=*&farm_id=eq.${farm}&created_at=gte.${start}&created_at=lt.${end}&order=created_at.asc`),
    serviceDb(`inventory_transactions?select=*&farm_id=eq.${farm}&created_at=gte.${start}&created_at=lt.${end}&order=created_at.asc`),
    serviceDb(`bins?select=id,bin_name&farm_id=eq.${farm}`),
    serviceDb(`farm_accounts?select=display_name,email&farm_id=eq.${farm}&role=eq.admin&order=created_at.asc`)
  ]);
  return { tickets, transactions, bins, admins };
}

export async function getWeeklySummaryDelivery(farmId, periodEnd) {
  const farm = encodeURIComponent(farmId);
  const end = encodeURIComponent(new Date(periodEnd).toISOString());
  const rows = await serviceDb(
    `weekly_summary_deliveries?select=*&farm_id=eq.${farm}&period_end=eq.${end}&limit=1`
  );
  return rows[0] || null;
}

export async function recordWeeklySummaryDelivery(input) {
  try {
    return await serviceDb('rpc/binflow_record_summary', { method: 'POST', body: { p_input: input } });
  } catch (error) {
    // Only the pre-migration missing-function response permits legacy recording.
    if (error.code !== 'PGRST202') throw error;
  }
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

async function attachUserToFarm(user, { farmId, displayName, email, role }) {
  return serviceDb('rpc/binflow_attach_member', {
    method: 'POST',
    body: {
      p_actor: context().user.id, p_target: user.id, p_farm: farmId,
      p_name: displayName, p_email: email, p_role: normalizeFarmRole(role)
    }
  });
}

async function findAuthUserByEmail(email) {
  const data = await rawRequest('/auth/v1/admin/users?page=1&per_page=1000', {
    serviceRole: true
  });

  return (data?.users || []).find((user) => clean(user.email).toLowerCase() === email);
}

async function farmHasOperationalData(farmId) {
  const tables = ['tickets', 'bins', 'contracts', 'payments', 'inventory_transactions'];
  const results = await Promise.all(
    tables.map((table) => db(`${table}?select=id&farm_id=eq.${farmId}&limit=1`))
  );
  return results.some((rows) => rows.length > 0);
}

async function deletionAvailability() {
  if (String(process.env.ACCOUNT_DELETION_ENABLED || '').toLowerCase() !== 'true' || !supabaseServiceRoleKey) return false;
  try {
    // A flag alone must never reactivate the unsafe multi-request implementation.
    const capability = await serviceDb('rpc/binflow_account_deletion_capability', { method: 'POST', body: {} });
    return capability?.version === 2 && capability?.revision === 2;
  } catch {
    return false;
  }
}

export async function getAccountDeletionPreview() {
  if (!await deletionAvailability()) throw new AccountDeletionError('DELETION_UNAVAILABLE', 503);
  const { farmId, user } = context();
  try {
    const preview = await serviceDb('rpc/binflow_preview_account_deletion', {
      method: 'POST', body: { p_actor: user.id, p_farm: farmId }
    });
    if (preview?.version !== 2) throw new Error('Unsupported deletion protocol.');
    return { ...preview, deletion_available: true };
  } catch { throw new AccountDeletionError('DELETION_UNAVAILABLE', 503); }
}

export async function deleteCurrentAccount(input = {}) {
  const { farmId, user } = context();
  return performAccountDeletion({
    input,
    authenticatedUser: user,
    farmId,
    available: await deletionAvailability(),
    reauthenticate: async (email, password) => {
      let verified;
      try {
        verified = await rawRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
        return verified?.user;
      } catch {
        throw new AccountDeletionError('REAUTHENTICATION_FAILED', 403);
      } finally {
        if (verified?.access_token) {
          await rawRequest('/auth/v1/logout?scope=local', { token: verified.access_token, method: 'POST' }).catch(() => {});
        }
      }
    },
    executeAtomic: async ({ userId, farmId: targetFarm, confirmEmail, successorId }) => {
      try {
        return await serviceDb('rpc/binflow_delete_account', {
          method: 'POST',
          body: { p_user_id: userId, p_farm_id: targetFarm, p_confirm_email: confirmEmail, p_successor: successorId }
        });
      } catch (error) {
        const codes = ['OWNERSHIP_TRANSFER_REQUIRED', 'INVALID_SUCCESSOR', 'STORAGE_CLEANUP_REQUIRED', 'DELETION_SCHEMA_REVIEW_REQUIRED', 'FARM_MEMBERSHIP_CHANGED', 'LAST_ADMIN_REQUIRED'];
        const code = codes.includes(error.message) ? error.message : 'DELETION_FAILED';
        throw new AccountDeletionError(code, code === 'DELETION_FAILED' ? 503 : 409);
      }
    }
  });
}

export async function createFarmUserAccount(input) {
  const { farmId, role } = context();
  if (role !== 'admin') throw new Error('Only farm admins can create user accounts.');
  if (!supabaseServiceRoleKey) throw new Error('User creation requires SUPABASE_SERVICE_ROLE_KEY.');

  const email = clean(input.email).toLowerCase();
  const password = String(input.password || '');
  const displayName = clean(input.display_name);
  const farmRole = normalizeFarmRole(input.role || 'employee');

  if (!email) throw new Error('User email is required.');
  if (!displayName) throw new Error('User name is required.');
  if (password.length < 8) throw new Error('User password must be at least 8 characters.');

  const created = await rawRequest('/auth/v1/admin/users', {
    method: 'POST',
    serviceRole: true,
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName
      },
      app_metadata: {
        farm_id: farmId,
        binflow_provisioner_id: context().user.id,
        farm_role: 'employee'
      }
    }
  });

  return attachUserToFarm(created, {
    farmId,
    displayName,
    email,
    role: farmRole
  });
}

export async function updateFarmUserRole(userId, requestedRole) {
  const { farmId, role } = context();
  if (role !== 'admin') throw new Error('Only farm admins can change user roles.');
  if (!supabaseServiceRoleKey) throw new Error('Role changes require SUPABASE_SERVICE_ROLE_KEY.');

  return serviceDb('rpc/binflow_change_member', {
    method: 'POST',
    body: { p_actor: context().user.id, p_target: userId, p_role: normalizeFarmRole(requestedRole) }
  });
}

export async function repairEmployeeAccount(input) {
  const { farmId, role } = context();
  if (role !== 'admin') throw new Error('Only farm admins can repair employee accounts.');
  if (!supabaseServiceRoleKey) throw new Error('Employee repair requires SUPABASE_SERVICE_ROLE_KEY.');

  const email = clean(input.email).toLowerCase();
  const displayName = clean(input.display_name);
  if (!email) throw new Error('Employee email is required.');
  if (!displayName) throw new Error('Employee name is required.');

  const user = await findAuthUserByEmail(email);
  if (!user) throw new Error('No existing login was found for that email.');

  const memberships = await db(
    `farm_accounts?select=user_id,farm_id,role&user_id=eq.${user.id}&limit=1`
  );
  const membership = memberships[0];

  if (membership?.farm_id && membership.farm_id !== farmId) {
    const otherMembers = await db(
      `farm_accounts?select=user_id&farm_id=eq.${membership.farm_id}&user_id=neq.${user.id}&limit=1`
    );
    const hasData = await farmHasOperationalData(membership.farm_id);

    if (otherMembers.length > 0 || hasData) {
      throw new Error('That login belongs to an active farm and cannot be reassigned.');
    }
  }

  return attachUserToFarm(user, {
    farmId,
    displayName,
    email,
    role: 'employee'
  });
}

function publicBin(bin, transactions = []) {
  const capacity = numeric(bin.estimated_capacity_bushels);
  const current = clampBinBalance(bin.current_bushels, capacity);

  return {
    ...bin,
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
    db(`bins?select=*&farm_id=eq.${farmId}`),
    db(`inventory_transactions?select=*&farm_id=eq.${farmId}&order=created_at.desc`)
  ]);
  return { bins: bins.map((bin) => publicBin(bin)), transactions };
}

export async function listBins() {
  const snapshot = await getInventorySnapshot();
  return snapshot.bins
    .map((bin) => publicBin(bin, snapshot.transactions))
    .sort((a, b) => a.bin_name.localeCompare(b.bin_name));
}

export async function createBin(input) {
  const mode = numeric(input.current_bushels) > 0 ? 'bushels' : 'empty';
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
  if (!['ADD_GRAIN', 'REMOVE_GRAIN', 'MANUAL_ADJUSTMENT'].includes(type)) throw new Error('Use ticket submission for a ticket sale, or a supported inventory adjustment.');
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
    for (const code of ['BIN_INVENTORY_OVERDRAW','IDEMPOTENCY_CONFLICT','TICKET_ALREADY_EXISTS','CONTRACT_CAPACITY_EXCEEDED','CONTRACT_UNAVAILABLE','CONTRACT_CROP_MISMATCH','LEDGER_RECONCILIATION_REQUIRED','BIN_SELECTION_UNAVAILABLE','TICKET_DELETED']) {
      if (error.message.includes(code)) error.code = code;
    }
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
  try {
    const result = await farmFeatureRpc('farm_ticket_command', {
      p_actor: context().member.user_id, p_action: 'update', p_id: requireUuid(id),
      p_input: normalizeTicket(input, existing), p_request: null
    });
    return result.ticket;
  } catch(error) {
    for(const code of ['INVENTORY_EDIT_REQUIRES_REENTRY','CONTRACT_CAPACITY_EXCEEDED','CONTRACT_UNAVAILABLE','CONTRACT_CROP_MISMATCH']) if(error.message.includes(code)) error.code=code;
    throw error;
  }
}

export async function getTicketLogSnapshot() {
  const { farmId } = context();
  const [tickets, users] = await Promise.all([
    db(`tickets?select=*&farm_id=eq.${farmId}&order=created_at.desc`),
    db(`farm_accounts?select=user_id,display_name,email&farm_id=eq.${farmId}`)
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
    db(`contracts?select=*&farm_id=eq.${farmId}&order=contract_id.asc`),
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
  const rows = await db(`contracts?id=eq.${id}&farm_id=eq.${farmId}`, {
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
  await db(`contracts?id=eq.${id}&farm_id=eq.${farmId}`, { method: 'DELETE' });
  return { ok: true };
}

async function settings() {
  const { farmId } = context();
  const rows = await db(`farm_settings?select=*&farm_id=eq.${farmId}&limit=1`);
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
  await db(`farm_settings?farm_id=eq.${farmId}`, {
    method: 'PATCH',
    body: { drivers: [...drivers, driver], updated_at: new Date().toISOString() }
  });
  return driver;
}

export async function deleteDriver(id) {
  const { farmId } = context();
  const row = await settings();
  await db(`farm_settings?farm_id=eq.${farmId}`, {
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
  await db(`farm_settings?farm_id=eq.${farmId}`, {
    method: 'PATCH',
    body: { drivers: [...drivers, location], updated_at: new Date().toISOString() }
  });
  return location;
}

export async function deleteLocation(id) {
  const { farmId } = context();
  const row = await settings();
  await db(`farm_settings?farm_id=eq.${farmId}`, {
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
