import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = path.resolve('data');
const logFile = path.join(dataDir, 'ticket-logs.json');

async function ensureStore() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  if (!existsSync(logFile)) {
    await writeFile(logFile, '[]', 'utf8');
  }
}

async function readLogs() {
  await ensureStore();
  const raw = await readFile(logFile, 'utf8');

  try {
    const logs = JSON.parse(raw);
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

async function writeLogs(logs) {
  await ensureStore();
  await writeFile(logFile, JSON.stringify(logs, null, 2), 'utf8');
}

function clean(value) {
  return String(value || '').trim();
}

function numeric(value) {
  const number = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeAssignments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((assignment) => ({
      type: clean(assignment?.type).toUpperCase() === 'CONTRACT' ? 'CONTRACT' : 'SPOT',
      contract_id: clean(assignment?.contract_id),
      bushels: numeric(assignment?.bushels)
    }))
    .filter((assignment) => assignment.bushels > 0)
    .map((assignment) => (
      assignment.type === 'SPOT'
        ? { ...assignment, contract_id: '' }
        : assignment
    ));
}

function normalizeLog(ticket, existing = {}) {
  const now = new Date().toISOString();
  const price = numeric(ticket.price ?? existing.price);
  const bushels = numeric(ticket.bushels ?? existing.bushels);
  const assignmentStatus = clean(ticket.assignment_status ?? existing.assignment_status) || 'Unassigned';
  const paymentStatus = clean(ticket.payment_status ?? existing.payment_status) || 'Not paid';

  return {
    ...existing,
    created_at: existing.created_at || now,
    updated_at: ticket === existing ? (existing.updated_at || now) : now,
    date: clean(ticket.date ?? existing.date),
    crop: clean(ticket.crop ?? existing.crop),
    ticket_number: clean(ticket.ticket_number ?? existing.ticket_number),
    elevator: clean(ticket.delivered_to ?? ticket.elevator ?? existing.delivered_to ?? existing.elevator),
    delivered_to: clean(ticket.delivered_to ?? ticket.elevator ?? existing.delivered_to ?? existing.elevator),
    hauled_by: clean(ticket.hauled_by ?? existing.hauled_by),
    hauled_from: clean(ticket.hauled_from ?? ticket.field_or_bin ?? existing.hauled_from ?? existing.field_or_bin),
    field_or_bin: clean(ticket.hauled_from ?? ticket.field_or_bin ?? existing.hauled_from ?? existing.field_or_bin),
    bushels: clean(ticket.bushels ?? existing.bushels),
    gross_weight: clean(ticket.gross_weight ?? existing.gross_weight),
    tare_weight: clean(ticket.tare_weight ?? existing.tare_weight),
    net_weight: clean(ticket.net_weight ?? existing.net_weight),
    moisture: clean(ticket.moisture ?? existing.moisture),
    price,
    revenue: price * bushels,
    notes: clean(ticket.notes ?? existing.notes),
    assignment_status: assignmentStatus,
    assignments: normalizeAssignments(ticket.assignments ?? existing.assignments),
    payment_status: paymentStatus,
    payment_date: clean(ticket.payment_date ?? existing.payment_date),
    amount_received: numeric(ticket.amount_received ?? existing.amount_received),
    payment_reference: clean(ticket.payment_reference ?? existing.payment_reference),
    payment_notes: clean(ticket.payment_notes ?? existing.payment_notes),
    inventory_transaction_id: clean(ticket.inventory_transaction_id ?? existing.inventory_transaction_id)
  };
}

export async function addTicketLog(ticket) {
  const logs = await readLogs();
  const log = {
    id: randomUUID(),
    ...normalizeLog(ticket)
  };

  logs.push(log);
  await writeLogs(logs);
  return log;
}

export async function listTicketLogs(filters = {}) {
  const logs = (await readLogs()).map((log) => normalizeLog(log, log));
  const search = clean(filters.search).toLowerCase();
  const crop = clean(filters.crop).toLowerCase();
  const date = clean(filters.date).toLowerCase();
  const ticketNumber = clean(filters.ticket_number).toLowerCase();
  const elevator = clean(filters.elevator).toLowerCase();
  const assignmentStatus = clean(filters.assignment_status).toLowerCase();
  const paymentStatus = clean(filters.payment_status).toLowerCase();

  return logs
    .filter((log) => {
      if (crop && clean(log.crop).toLowerCase() !== crop) {
        return false;
      }

      if (date && !clean(log.date).toLowerCase().includes(date)) {
        return false;
      }

      if (ticketNumber && !clean(log.ticket_number).toLowerCase().includes(ticketNumber)) {
        return false;
      }

      if (elevator && !clean(log.elevator).toLowerCase().includes(elevator)) {
        return false;
      }

      if (assignmentStatus && clean(log.assignment_status).toLowerCase() !== assignmentStatus) {
        return false;
      }

      if (paymentStatus && clean(log.payment_status).toLowerCase() !== paymentStatus) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        log.date,
        log.crop,
        log.ticket_number,
        log.elevator,
        log.delivered_to,
        log.hauled_by,
        log.hauled_from,
        log.bushels,
        log.moisture,
        log.assignment_status,
        log.payment_status,
        log.notes
      ].some((value) => clean(value).toLowerCase().includes(search));
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getTicketLogSnapshot() {
  const logs = (await readLogs()).map((log) => normalizeLog(log, log));
  return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function updateTicketLog(ticketLogId, input) {
  const logs = await readLogs();
  const index = logs.findIndex((item) => item.id === ticketLogId);

  if (index === -1) {
    throw new Error('Ticket log not found.');
  }

  const updated = normalizeLog(input, logs[index]);
  logs[index] = updated;
  await writeLogs(logs);
  return updated;
}

export async function deleteTicketLog(ticketLogId) {
  const logs = await readLogs();
  const log = logs.find((item) => item.id === ticketLogId);

  if (!log) {
    throw new Error('Ticket log not found.');
  }

  await writeLogs(logs.filter((item) => item.id !== ticketLogId));
  return log;
}

export async function deleteTicketLogByInventoryTransactionId(transactionId) {
  const logs = await readLogs();
  const log = logs.find((item) => item.inventory_transaction_id === transactionId);

  if (!log) {
    return null;
  }

  await writeLogs(logs.filter((item) => item.id !== log.id));
  return log;
}
