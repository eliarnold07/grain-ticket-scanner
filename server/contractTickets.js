import { requireUuid, restQuery } from './restQuery.js';

function deliveryTime(ticket) {
  const time = Date.parse(ticket.date || '');
  return Number.isFinite(time) ? time : -Infinity;
}

export function summarizeContractTickets(tickets, contractId) {
  const rows = [];
  for (const ticket of tickets) {
    if (!Array.isArray(ticket.assignments)) continue;
    let appliedBushels = 0;
    let matches = false;
    for (const assignment of ticket.assignments) {
      if (assignment?.type !== 'CONTRACT' || assignment.contract_id !== contractId) continue;
      matches = true;
      const amount = Number(String(assignment.bushels ?? '').replace(/[$,]/g, ''));
      if (Number.isFinite(amount)) appliedBushels += amount;
    }
    if (matches) rows.push({ ticket, applied_bushels: appliedBushels });
  }
  rows.sort((a, b) => deliveryTime(b.ticket) - deliveryTime(a.ticket)
    || String(b.ticket.created_at || '').localeCompare(String(a.ticket.created_at || ''))
    || a.ticket.id.localeCompare(b.ticket.id));
  return { tickets: rows, total_applied_bushels: rows.reduce((total, row) => total + row.applied_bushels, 0) };
}

async function* readTicketPages(read, farm, select, allocation) {
  let afterId;
  while (true) {
    const page = await read(restQuery('tickets', {
      select,
      farm_id: farm,
      assignments: `cs.${JSON.stringify([allocation])}`,
      order: 'id.asc',
      limit: 250,
      and: afterId ? `(id.gt.${afterId})` : undefined
    }));
    if (page.length === 0) break;
    yield page;
    afterId = requireUuid(page.at(-1).id, 'Ticket ID');
  }
}

export function countContractTickets(tickets, counts = new Map()) {
  for (const ticket of tickets) {
    if (!Array.isArray(ticket.assignments)) continue;
    const assignedContracts = new Set();
    for (const assignment of ticket.assignments) {
      if (assignment?.type === 'CONTRACT' && assignment.contract_id) assignedContracts.add(assignment.contract_id);
    }
    for (const id of assignedContracts) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function readContractTicketCounts(read, farmId) {
  const farm = `eq.${requireUuid(farmId, 'Farm ID')}`;
  const counts = new Map();
  for await (const page of readTicketPages(read, farm, 'id,assignments', { type: 'CONTRACT' })) {
    countContractTickets(page, counts);
  }
  return counts;
}

export async function readContractTickets(read, farmId, id) {
  const contractId = requireUuid(id, 'Contract ID');
  const farm = `eq.${requireUuid(farmId, 'Farm ID')}`;
  const [contract] = await read(restQuery('contracts', {
    select: 'id', id: `eq.${contractId}`, farm_id: farm, limit: 1
  }));
  if (!contract) return null;

  const tickets = [];
  for await (const page of readTicketPages(read, farm, '*', { type: 'CONTRACT', contract_id: contractId })) {
    tickets.push(...page);
  }
  return summarizeContractTickets(tickets, contractId);
}
