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

export async function addTicketLog(ticket) {
  const logs = await readLogs();
  const now = new Date().toISOString();
  const log = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    date: clean(ticket.date),
    crop: clean(ticket.crop),
    ticket_number: clean(ticket.ticket_number),
    elevator: clean(ticket.delivered_to),
    delivered_to: clean(ticket.delivered_to),
    hauled_by: clean(ticket.hauled_by),
    hauled_from: clean(ticket.hauled_from),
    field_or_bin: clean(ticket.hauled_from),
    bushels: clean(ticket.bushels),
    gross_weight: clean(ticket.gross_weight),
    tare_weight: clean(ticket.tare_weight),
    net_weight: clean(ticket.net_weight),
    moisture: clean(ticket.moisture),
    notes: clean(ticket.notes),
    inventory_transaction_id: clean(ticket.inventory_transaction_id)
  };

  logs.push(log);
  await writeLogs(logs);
  return log;
}

export async function listTicketLogs(filters = {}) {
  const logs = await readLogs();
  const search = clean(filters.search).toLowerCase();
  const crop = clean(filters.crop).toLowerCase();
  const date = clean(filters.date).toLowerCase();
  const ticketNumber = clean(filters.ticket_number).toLowerCase();
  const elevator = clean(filters.elevator).toLowerCase();

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
        log.notes
      ].some((value) => clean(value).toLowerCase().includes(search));
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getTicketLogSnapshot() {
  const logs = await readLogs();
  return [...logs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
