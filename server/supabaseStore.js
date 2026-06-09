import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requestContext = new AsyncLocalStorage();
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

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

async function rawRequest(path, { token, method = 'GET', body, prefer } = {}) {
  if (!configReady()) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.');

  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token || supabaseAnonKey}`,
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

async function buildContext(accessToken) {
  const user = await rawRequest('/auth/v1/user', { token: accessToken });
  const accounts = await rawRequest(`/rest/v1/farm_accounts?select=farm_id&user_id=eq.${user.id}&limit=1`, { token: accessToken });

  if (!accounts?.[0]?.farm_id) {
    throw new Error('No farm account is attached to this login.');
  }

  const farms = await rawRequest(`/rest/v1/farms?select=id,name&id=eq.${accounts[0].farm_id}&limit=1`, { token: accessToken });
  return {
    token: accessToken,
    user,
    farmId: accounts[0].farm_id,
    farm: farms?.[0] || { id: accounts[0].farm_id, name: 'Farm' }
  };
}

export async function requireSupabaseAuth(req, res, next) {
  if (req.path === '/health') return next();

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

function context() {
  const value = requestContext.getStore();
  if (!value) throw new Error('Missing authenticated farm context.');
  return value;
}

async function db(path, options = {}) {
  return rawRequest(`/rest/v1/${path}`, { ...options, token: context().token });
}

function publicBin(bin, transactions = []) {
  const capacity = numeric(bin.estimated_capacity_bushels);
  const current = Math.max(0, numeric(bin.current_bushels));

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
  const { farmId } = context();
  const now = new Date().toISOString();
  const rows = await db('bins', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      farm_id: farmId,
      bin_name: clean(input.bin_name),
      crop_type: clean(input.crop_type),
      estimated_capacity_bushels: numeric(input.estimated_capacity_bushels),
      current_bushels: Math.max(0, numeric(input.current_bushels)),
      notes: clean(input.notes),
      created_at: now,
      updated_at: now
    }
  });
  const bin = rows[0];

  if (numeric(bin.current_bushels) !== 0) {
    await db('inventory_transactions', {
      method: 'POST',
      body: {
        farm_id: farmId,
        bin_id: bin.id,
        transaction_type: 'MANUAL_ADJUSTMENT',
        crop_type: bin.crop_type,
        bushel_amount: numeric(bin.current_bushels),
        applied_bushel_amount: numeric(bin.current_bushels),
        previous_bin_balance: 0,
        new_bin_balance: numeric(bin.current_bushels),
        notes: 'Initial bin balance'
      }
    });
  }

  return publicBin(bin);
}

export async function updateBin(id, input) {
  const { farmId } = context();
  const rows = await db(`bins?id=eq.${id}&farm_id=eq.${farmId}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      bin_name: clean(input.bin_name),
      crop_type: clean(input.crop_type),
      estimated_capacity_bushels: numeric(input.estimated_capacity_bushels),
      notes: clean(input.notes),
      updated_at: new Date().toISOString()
    }
  });
  if (!rows[0]) throw new Error('Bin not found.');
  return publicBin(rows[0]);
}

export async function deleteBin(id) {
  const { farmId } = context();
  await db(`bins?id=eq.${id}&farm_id=eq.${farmId}`, { method: 'DELETE' });
  return { ok: true };
}

async function getBin(id) {
  const { farmId } = context();
  const rows = await db(`bins?select=*&id=eq.${id}&farm_id=eq.${farmId}&limit=1`);
  return rows[0] || null;
}

async function getBinByName(name) {
  const bins = await listBins();
  return bins.find((bin) => bin.bin_name.toLowerCase() === clean(name).toLowerCase()) || null;
}

export async function createInventoryTransaction(input) {
  const { farmId } = context();
  const bin = await getBin(input.bin_id);
  if (!bin) throw new Error('Bin not found.');

  const type = clean(input.transaction_type).toUpperCase();
  const amount = numeric(input.bushel_amount);
  const previous = Math.max(0, numeric(bin.current_bushels));
  let next = previous;
  if (type === 'ADD_GRAIN') next = previous + amount;
  if (type === 'REMOVE_GRAIN' || type === 'TICKET_SALE') next = Math.max(0, previous - amount);
  if (type === 'MANUAL_ADJUSTMENT') next = Math.max(0, amount);
  const applied = ['REMOVE_GRAIN', 'TICKET_SALE'].includes(type) ? Math.min(previous, amount) : amount;

  const transactionRows = await db('inventory_transactions', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      farm_id: farmId,
      bin_id: bin.id,
      transaction_type: type,
      crop_type: bin.crop_type,
      bushel_amount: amount,
      applied_bushel_amount: applied,
      previous_bin_balance: previous,
      new_bin_balance: next,
      ticket_id: input.ticket_id || null,
      ticket_number: clean(input.ticket_number),
      notes: clean(input.notes),
      exceeded_estimated_inventory: amount > previous && ['REMOVE_GRAIN', 'TICKET_SALE'].includes(type)
    }
  });
  const binRows = await db(`bins?id=eq.${bin.id}&farm_id=eq.${farmId}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { current_bushels: next, updated_at: new Date().toISOString() }
  });
  return { bin: publicBin(binRows[0]), transaction: transactionRows[0] };
}

export async function createTicketSaleTransaction({ binName, bushels, cropType, ticketId, notes, allowOverdraw = false }) {
  const bin = await getBinByName(binName);
  if (!bin) return null;
  const amount = numeric(bushels);

  if (amount > numeric(bin.current_bushels) && !allowOverdraw) {
    const error = new Error('This ticket exceeds estimated bin inventory. Continue and set this bin to 0?');
    error.code = 'BIN_INVENTORY_OVERDRAW';
    error.binName = bin.bin_name;
    error.currentBushels = numeric(bin.current_bushels);
    error.ticketBushels = amount;
    throw error;
  }

  if (cropType && cropType !== bin.crop_type) {
    await updateBin(bin.id, { ...bin, crop_type: cropType });
  }

  return createInventoryTransaction({
    bin_id: bin.id,
    transaction_type: 'TICKET_SALE',
    bushel_amount: amount,
    ticket_number: ticketId,
    notes
  });
}

async function recalculateBin(binId) {
  const { farmId } = context();
  const transactions = await db(`inventory_transactions?select=*&farm_id=eq.${farmId}&bin_id=eq.${binId}&order=created_at.asc`);
  let balance = 0;

  for (const transaction of transactions) {
    const previous = balance;
    if (transaction.transaction_type === 'ADD_GRAIN') balance += numeric(transaction.bushel_amount);
    if (['REMOVE_GRAIN', 'TICKET_SALE'].includes(transaction.transaction_type)) {
      balance = Math.max(0, balance - numeric(transaction.applied_bushel_amount ?? transaction.bushel_amount));
    }
    if (transaction.transaction_type === 'MANUAL_ADJUSTMENT') balance = Math.max(0, numeric(transaction.bushel_amount));
    await db(`inventory_transactions?id=eq.${transaction.id}&farm_id=eq.${farmId}`, {
      method: 'PATCH',
      body: { previous_bin_balance: previous, new_bin_balance: balance }
    });
  }

  await db(`bins?id=eq.${binId}&farm_id=eq.${farmId}`, {
    method: 'PATCH',
    body: { current_bushels: balance, updated_at: new Date().toISOString() }
  });
}

export async function deleteInventoryTransaction(id) {
  const { farmId } = context();
  const rows = await db(`inventory_transactions?select=*&id=eq.${id}&farm_id=eq.${farmId}&limit=1`);
  const transaction = rows[0];
  if (!transaction) return { ok: true, deleted: false };
  await db(`inventory_transactions?id=eq.${id}&farm_id=eq.${farmId}`, { method: 'DELETE' });
  await recalculateBin(transaction.bin_id);
  return { ok: true, deleted: true };
}

export async function listInventoryTransactions(filters = {}) {
  const { farmId } = context();
  let path = `inventory_transactions?select=*&farm_id=eq.${farmId}&order=created_at.desc`;
  if (filters.bin_id) path += `&bin_id=eq.${filters.bin_id}`;
  if (filters.transaction_type) path += `&transaction_type=eq.${encodeURIComponent(filters.transaction_type)}`;
  return db(path);
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

export async function addTicketLog(ticket) {
  const { farmId } = context();
  const rows = await db('tickets', {
    method: 'POST',
    prefer: 'return=representation',
    body: { farm_id: farmId, ...normalizeTicket(ticket), created_at: new Date().toISOString() }
  });
  return rows[0];
}

export async function updateTicketLog(id, input) {
  const { farmId } = context();
  const existing = (await db(`tickets?select=*&id=eq.${id}&farm_id=eq.${farmId}&limit=1`))[0];
  if (!existing) throw new Error('Ticket not found.');
  const ticket = normalizeTicket(input, existing);
  delete ticket.id;
  delete ticket.farm_id;
  delete ticket.created_at;
  const rows = await db(`tickets?id=eq.${id}&farm_id=eq.${farmId}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: ticket
  });
  await db('payments?on_conflict=farm_id,ticket_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      farm_id: farmId,
      ticket_id: id,
      payment_status: ticket.payment_status,
      payment_date: ticket.payment_date,
      amount_received: ticket.amount_received,
      reference: ticket.payment_reference,
      notes: ticket.payment_notes,
      updated_at: new Date().toISOString()
    }
  });
  return rows[0];
}

export async function getTicketLogSnapshot() {
  const { farmId } = context();
  return db(`tickets?select=*&farm_id=eq.${farmId}&order=created_at.desc`);
}

export async function listTicketLogs(filters = {}) {
  const logs = await getTicketLogSnapshot();
  const search = clean(filters.search).toLowerCase();
  return logs.filter((log) => {
    if (filters.crop && clean(log.crop).toLowerCase() !== clean(filters.crop).toLowerCase()) return false;
    if (filters.date && !clean(log.date).toLowerCase().includes(clean(filters.date).toLowerCase())) return false;
    if (filters.ticket_number && !clean(log.ticket_number).toLowerCase().includes(clean(filters.ticket_number).toLowerCase())) return false;
    if (filters.elevator && !clean(log.delivered_to).toLowerCase().includes(clean(filters.elevator).toLowerCase())) return false;
    if (filters.assignment_status && log.assignment_status !== filters.assignment_status) return false;
    if (filters.payment_status && log.payment_status !== filters.payment_status) return false;
    return !search || Object.values(log).some((value) => clean(value).toLowerCase().includes(search));
  });
}

export async function deleteTicketLog(id) {
  const { farmId } = context();
  const rows = await db(`tickets?select=*&id=eq.${id}&farm_id=eq.${farmId}&limit=1`);
  if (!rows[0]) throw new Error('Ticket not found.');
  await db(`tickets?id=eq.${id}&farm_id=eq.${farmId}`, { method: 'DELETE' });
  return rows[0];
}

export async function deleteTicketLogByInventoryTransactionId(transactionId) {
  const { farmId } = context();
  const rows = await db(`tickets?select=*&inventory_transaction_id=eq.${transactionId}&farm_id=eq.${farmId}&limit=1`);
  if (!rows[0]) return null;
  await db(`tickets?id=eq.${rows[0].id}&farm_id=eq.${farmId}`, { method: 'DELETE' });
  return rows[0];
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

export async function listContracts(ticketLogs = null) {
  const { farmId } = context();
  const [contracts, tickets] = await Promise.all([
    db(`contracts?select=*&farm_id=eq.${farmId}&order=contract_id.asc`),
    ticketLogs ? Promise.resolve(ticketLogs) : getTicketLogSnapshot()
  ]);
  return contracts.map((contract) => contractWithBalances(contract, tickets));
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
  return (row?.drivers || []).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createDriver(input) {
  const { farmId } = context();
  const row = await settings();
  const name = clean(input.name);
  if (!name) throw new Error('Driver name is required.');
  const drivers = row?.drivers || [];
  const existing = drivers.find((driver) => driver.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const driver = { id: randomUUID(), name, created_at: new Date().toISOString() };
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
    body: { drivers: (row?.drivers || []).filter((driver) => driver.id !== id), updated_at: new Date().toISOString() }
  });
  return { ok: true };
}
