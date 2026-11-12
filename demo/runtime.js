// All demo data and requests stay in memory. There is deliberately no fetch fallback.
export { readJsonWithTimeout, withDeadline } from '../src/network.js';
import { applyBinTransaction, clampBinBalance } from '../server/binCapacity.js';
import { countContractTickets, summarizeContractTickets } from '../server/contractTickets.js';
const session = { access_token: 'fictional-demo-session', user: { id: 'demo-owner', email: 'alex@example.com' } };
export const getStoredSession = () => session;
export const isSessionExpired = () => false;
export const storeSession = () => {};
export const refreshSession = async () => session;
export const signInFarm = async () => session;
export const signUpFarm = async () => { throw new Error('Exit the demo to create a real farm account.'); };
export const signOutFarm = async () => { window.location.assign('/'); };
const memory = new Map();
let invitationVersion = 0;
export const demoStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
const sum = (rows, field) => rows.reduce((n, row) => n + Number(row[field] || 0), 0);
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = message => reply({ error: message }, 400);
const now = () => new Date().toISOString();
const date = days => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const bins = [
  { id: 'bin-corn-1', bin_name: 'North Bin', crop_type: 'Corn', estimated_capacity_bushels: 25000, current_bushels: 13800, notes: 'Sample corn storage' },
  { id: 'bin-corn-2', bin_name: 'West Bin', crop_type: 'Corn', estimated_capacity_bushels: 20000, current_bushels: 8000, notes: '' },
  { id: 'bin-soy', bin_name: 'Soybean Bin', crop_type: 'Beans', estimated_capacity_bushels: 15000, current_bushels: 7400, notes: '' }
].map(b => ({ ...b, recent_transactions: [] }));
const contracts = [
  { id: 'contract-corn', contract_id: 'C-2026-01', buyer: 'Riverbend Grain', commodity: 'Corn', contracted_bushels: 10000, contract_price: 4.8, delivery_window: 'Fall 2026', status: 'Open', notes: 'Fictional delivery contract' },
  { id: 'contract-soy', contract_id: 'S-2026-01', buyer: 'Meadowbrook Processing', commodity: 'Beans', contracted_bushels: 5000, contract_price: 12, delivery_window: 'Fall 2026', status: 'Open', notes: '' }
];
const tickets = [1000, 1200, 800, 1000, 700, 600, 500, 450, 550, 625, 725, 800].map((bushels, i) => {
  const soy = i >= 4 && i <= 6, paid = i === 0 || i === 3 || i === 6, partial = i === 4;
  const delivered = date(i < 7 ? 7 - i : i + 1);
  const price = soy ? 12 : 4.8;
  return { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ticket_number: `SAMPLE-${1001 + i}`, date: delivered, created_at: `${delivered}T15:00:00Z`, crop: soy ? 'Beans' : 'Corn', bushels,
    hauled_from: soy ? 'Soybean Bin' : i % 2 ? 'West Bin' : 'North Bin', delivered_to: soy ? 'Meadowbrook Processing' : 'Riverbend Grain', hauled_by: i % 2 ? 'Jordan Lee' : 'Alex Morgan', moisture: soy ? 12.4 : 15.2,
    net_weight: bushels * (soy ? 60 : 56), gross_weight: bushels * (soy ? 60 : 56) + 28000, tare_weight: 28000, price, revenue: bushels * price,
    assignment_status: i === 5 ? 'Spot' : 'Contract', assignments: [{ type: i === 5 ? 'SPOT' : 'CONTRACT', contract_id: soy ? 'contract-soy' : 'contract-corn', bushels }],
    payment_status: paid ? 'Paid' : partial ? 'Partially paid' : 'Not paid', amount_received: paid ? bushels * price : partial ? 2000 : 0,
    payment_date: paid || partial ? date(0) : '', payment_reference: paid || partial ? 'SAMPLE-CHECK' : '', notes: 'Fictional demo ticket', payment_notes: '', archived: false };
});
const users = [{ user_id: 'demo-owner', display_name: 'Alex Morgan', email: 'alex@example.com', role: 'admin' }, { user_id: 'demo-employee', display_name: 'Jordan Lee', email: 'jordan@example.com', role: 'employee' }];
const names = { drivers: ['Alex Morgan', 'Jordan Lee'], locations: ['Riverbend Grain', 'Meadowbrook Processing'] };
for (const key of Object.keys(names)) names[key] = names[key].map((name, i) => ({ id: `${key}-${i}`, name }));
function contractRows() { return contracts.map(c => { const delivered = tickets.reduce((n, t) => n + t.assignments.filter(a => a.type === 'CONTRACT' && a.contract_id === c.id).reduce((s, a) => s + Number(a.bushels), 0), 0); return { ...c, delivered_applied_bushels: delivered, remaining_bushels: Math.max(0, c.contracted_bushels - delivered) }; }); }
function dashboard() {
  const corn = sum(bins.filter(b => b.crop_type === 'Corn'), 'current_bushels'), soy = sum(bins.filter(b => b.crop_type === 'Beans'), 'current_bushels'), capacity = sum(bins, 'estimated_capacity_bushels');
  const unpaid = tickets.filter(t => t.payment_status !== 'Paid');
  const adjustments = bins.flatMap(b => b.recent_transactions.map(t => ({ ...t, bin_name: b.bin_name, crop_type: b.crop_type, bushel_change: t.new_bin_balance - t.previous_bin_balance })));
  const added = adjustments.reduce((n, t) => n + Math.max(0, t.bushel_change), 0), removed = adjustments.reduce((n, t) => n + Math.max(0, -t.bushel_change), 0);
  return {
    kpis: { total_corn_inventory: corn, total_bean_inventory: soy, total_bushels_stored: corn + soy, total_tickets_scanned: tickets.length, total_bushels_sold: sum(tickets, 'bushels'), active_bins: bins.length },
    finance: { unpaid_delivered_bushels: sum(unpaid, 'bushels'), unpaid_estimated_dollars: unpaid.reduce((n, t) => n + Math.max(0, t.revenue - t.amount_received), 0), contracts_with_remaining_bushels: contractRows().filter(c => c.remaining_bushels > 0 && c.status !== 'Closed').length, unassigned_tickets: tickets.filter(t => t.assignment_status === 'Unassigned').length },
    charts: { inventory_by_crop: [{ crop: 'Corn', bushels: corn }, { crop: 'Beans', bushels: soy }], storage_utilization: { current_bushels: corn + soy, estimated_capacity: capacity, percent_full: capacity ? (corn + soy) / capacity * 100 : null }, recent_ticket_activity: [] },
    bin_overview: bins.map(b => ({ ...b, percent_full: b.estimated_capacity_bushels ? b.current_bushels / b.estimated_capacity_bushels * 100 : null })),
    weekly_summary: { period_label: 'Sample activity · No demo emails are sent', activity_count: tickets.length + adjustments.length, ticket_count: tickets.length, ticket_bushels: sum(tickets, 'bushels'), grain_added_bushels: added, grain_removed_bushels: removed, manual_net_bushels: added - removed, manual_adjustment_count: adjustments.length, by_crop: [], tickets, adjustments }
  };
}
export async function fetchWithTimeout(input, options = {}) {
  const url = new URL(input, 'https://demo.invalid');
  if (url.origin !== 'https://demo.invalid') return fail('External requests are disabled in the demo.');
  const path = url.pathname, method = options.method || 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  if (path === '/api/app-capabilities') return reply({ farm_invitations: true });
  if (path === '/api/session') return reply({ farm: { id: 'demo-farm', name: 'Prairie Ridge Farms' }, account: users[0] });
  if (path === '/api/dashboard') return reply(dashboard());
  if (path === '/api/dropdowns') return reply({ bins: bins.map(b => b.bin_name), haulers: names.drivers.map(n => n.name), destinations: names.locations.map(n => n.name), missing_tabs: [] });
  if (path === '/api/scanner-contracts') return reply({ contracts: contractRows().filter(c => c.remaining_bushels > 0) });
  if (path === '/api/account-deletion') return reply({ version: 2, deletion_available: false, eligibility: { allowed: false, transfer_required: false }, transfer_candidates: [] });
  if (path === '/api/users/invitation/revoke') return reply({ revoked: true });
  if (path.startsWith('/api/users/invitation')) {
    if (path.endsWith('/rotate')) invitationVersion++;
    return reply({ code: `DEMO-DEMO-DEMO-DEMO-${invitationVersion % 2 ? 'TEST' : 'DEMO'}` });
  }
  if (path === '/api/users' && method === 'GET') return reply({ users });
  if (path.match(/^\/api\/users\/[^/]+\/role$/)) { const user = users.find(u => u.user_id === path.split('/')[3]); if (!user || user === users[0]) return fail('Keep the sample farm Administrator.'); user.role = body.role; return reply({ user }); }
  for (const kind of ['drivers', 'locations']) {
    if (!path.startsWith(`/api/${kind}`)) continue;
    if (method === 'GET') return reply({ [kind]: names[kind] });
    const id = path.split('/')[3], item = names[kind].find(n => n.id === id);
    if (method === 'DELETE') names[kind] = names[kind].filter(n => n.id !== id);
    else if (!body.name?.trim()) return fail('Enter a name.');
    else if (item) item.name = body.name.trim();
    else names[kind].push({ id: crypto.randomUUID(), name: body.name.trim() });
    return reply({ ok: true });
  }
  if (path === '/api/ticket-logs' && method === 'GET') {
    const filters = Object.fromEntries(url.searchParams);
    const logs = tickets.filter(t => Boolean(t.archived) === (filters.archive_view === 'archived')).filter(t => Object.entries(filters).every(([k, v]) => {
      if (!v || k === 'archive_view') return true;
      if (k === 'search') return Object.values(t).join(' ').toLowerCase().includes(v.toLowerCase());
      const field = k === 'elevator' ? 'delivered_to' : k;
      if (['assignment_status', 'payment_status', 'crop'].includes(k)) return String(t[field] ?? '').toLowerCase() === v.toLowerCase();
      return String(t[field] ?? '').toLowerCase().includes(v.toLowerCase());
    }));
    return reply({ logs });
  }
  if (path.startsWith('/api/ticket-logs/')) {
    const index = tickets.findIndex(t => t.id === path.split('/')[3]);
    if (index < 0) return fail('Sample ticket not found.');
    if (method === 'DELETE') return fail('Deleting linked grain records is not simulated. You can review and edit sample payment records.');
    const old = tickets[index];
    if (['bushels', 'hauled_from', 'crop'].some(k => body[k] !== undefined && String(body[k]) !== String(old[k]))) return fail('Linked grain changes are not simulated. Review fields or edit sample payment details instead.');
    Object.assign(old, body); old.amount_received = Number(old.amount_received); old.revenue = Number(old.bushels) * Number(old.price);
    return reply({ ok: true, ticket: old });
  }
  const appliedTickets = path.match(/^\/api\/contracts\/([^/]+)\/tickets$/);
  if (appliedTickets && method === 'GET') {
    const contract = contracts.find(item => item.id === appliedTickets[1]);
    return contract ? reply(summarizeContractTickets(tickets, contract.id)) : reply({ error: 'Contract not found.' }, 404);
  }
  if (path.startsWith('/api/contracts')) {
    if (method === 'GET') {
      const rows = contractRows().filter(c => Boolean(c.archived) === (url.searchParams.get('archived') === 'true'));
      const counts = url.searchParams.get('ticket_counts') === 'true' ? countContractTickets(tickets) : null;
      return reply({ contracts: counts ? rows.map(c => ({ ...c, applied_ticket_count: counts.get(c.id) ?? 0 })) : rows });
    }
    const id = path.split('/')[3], index = contracts.findIndex(c => c.id === id);
    if (method === 'DELETE') { if (tickets.some(t => t.assignments.some(a => a.contract_id === id))) return fail('This sample contract has linked tickets.'); if (index >= 0) contracts.splice(index, 1); }
    else { const value = { ...(contracts[index] || {}), ...body }; if (!value.contract_id || !value.buyer || !(Number(value.contracted_bushels) > 0)) return fail('Enter a contract number, buyer, and positive bushels.'); value.contracted_bushels = Number(value.contracted_bushels); value.contract_price = Number(value.contract_price); if (index >= 0) contracts[index] = value; else contracts.push({ ...value, id: crypto.randomUUID() }); }
    return reply({ ok: true });
  }
  if (path.startsWith('/api/bins')) {
    if (method === 'GET') return reply({ bins });
    const id = path.split('/')[3], index = bins.findIndex(b => b.id === id);
    if (method === 'DELETE') return fail('Bin deletion is not simulated. You can create or edit a sample bin and record grain adjustments.');
    const value = { ...(bins[index] || { recent_transactions: [] }), ...body };
    if (!value.bin_name || !value.crop_type || !Number.isFinite(Number(value.current_bushels)) || Number(value.current_bushels) < 0) return fail('Enter a bin name, crop, and nonnegative balance.');
    value.current_bushels = Number(value.current_bushels); value.estimated_capacity_bushels = Number(value.estimated_capacity_bushels);
    if (!Number.isFinite(value.estimated_capacity_bushels) || value.estimated_capacity_bushels <= 0) return fail('Enter a positive bin capacity.');
    value.current_bushels = clampBinBalance(value.current_bushels, value.estimated_capacity_bushels);
    if (index >= 0) bins[index] = value; else bins.push({ ...value, id: crypto.randomUUID() });
    return reply({ ok: true });
  }
  if (path === '/api/inventory-transactions' && method === 'POST') {
    const bin = bins.find(b => b.id === body.bin_id), amount = Number(body.bushel_amount);
    if (!bin || !Number.isFinite(amount) || amount < 0) return fail('Enter a valid nonnegative quantity.');
    if (!['ADD_GRAIN', 'REMOVE_GRAIN', 'MANUAL_ADJUSTMENT'].includes(body.transaction_type)) return fail('Choose a transaction type.');
    const result = applyBinTransaction({ previousBalance: bin.current_bushels, capacity: bin.estimated_capacity_bushels, type: body.transaction_type, amount });
    const balance = result.next;
    bin.recent_transactions.unshift({ id: crypto.randomUUID(), transaction_type: body.transaction_type, previous_bin_balance: bin.current_bushels, new_bin_balance: balance, created_at: now(), notes: body.notes });
    bin.current_bushels = balance;
    return reply({ ok: true, capacity_capped: result.capacityCapped });
  }
  if (path === '/api/extract-ticket') return reply({ ticket: { ticket_number: 'SAMPLE-NEW', date: date(0), crop: 'Corn', bushels: '500', gross_weight: '56000', tare_weight: '28000', net_weight: '28000', delivered_to: 'Riverbend Grain', moisture: '15.2', price: '4.80', notes: 'Simulated extraction: this data does not come from your photo.' }, duplicate: null });
  if (path.startsWith('/api/ticket-submissions/')) return reply({ protocol_revision: 2, status: 'unknown' });
  if (path === '/api/submit-ticket') {
    const t = body.ticket, amount = Number(t?.bushels), bin = bins.find(b => b.bin_name === t?.hauled_from);
    if (!bin || !(amount > 0) || !Number.isFinite(amount)) return fail('Choose a sample bin and a positive bushel amount.');
    if (tickets.some(old => old.ticket_number === t.ticket_number)) return fail('This sample ticket number is already saved.');
    if (amount > bin.current_bushels && !body.allow_bin_overdraw) return reply({ code: 'BIN_INVENTORY_OVERDRAW' }, 409);
    const log = { ...t, id: crypto.randomUUID(), created_at: now(), bushels: amount, revenue: amount * Number(t.price || 0), assignments: t.assignments || [], payment_status: 'Not paid', amount_received: 0, archived: false };
    bin.current_bushels = Math.max(0, bin.current_bushels - amount); tickets.push(log);
    return reply({ ok: true, ticket_log: log });
  }
  return fail('This action is not simulated in the public demo. No real records were changed.');
}
