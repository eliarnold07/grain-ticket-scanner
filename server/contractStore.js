import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = path.resolve('data');
const contractFile = path.join(dataDir, 'contracts.json');

async function ensureStore() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  if (!existsSync(contractFile)) {
    await writeFile(contractFile, '[]', 'utf8');
  }
}

async function readContracts() {
  await ensureStore();

  try {
    const contracts = JSON.parse(await readFile(contractFile, 'utf8'));
    return Array.isArray(contracts) ? contracts : [];
  } catch {
    return [];
  }
}

async function writeContracts(contracts) {
  await ensureStore();
  await writeFile(contractFile, JSON.stringify(contracts, null, 2), 'utf8');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function numeric(value) {
  const number = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeCrop(value) {
  const crop = clean(value);
  const lower = crop.toLowerCase();

  if (lower.includes('corn')) return 'Corn';
  if (lower.includes('bean') || lower.includes('soy')) return 'Beans';
  return crop;
}

function validate(contract, contracts, currentId = '') {
  if (!contract.contract_id) throw new Error('Contract ID is required.');
  if (!contract.buyer) throw new Error('Buyer/elevator is required.');
  if (!contract.commodity) throw new Error('Commodity is required.');
  if (contract.contracted_bushels <= 0) throw new Error('Contracted bushels must be greater than zero.');

  const duplicate = contracts.some((item) => (
    item.id !== currentId
    && clean(item.contract_id).toLowerCase() === contract.contract_id.toLowerCase()
  ));

  if (duplicate) throw new Error('That Contract ID already exists.');
}

function normalizeContract(input, existing = {}) {
  const now = new Date().toISOString();

  return {
    ...existing,
    contract_id: clean(input.contract_id),
    buyer: clean(input.buyer),
    commodity: normalizeCrop(input.commodity),
    contracted_bushels: numeric(input.contracted_bushels),
    contract_price: numeric(input.contract_price),
    delivery_window: clean(input.delivery_window),
    status: clean(input.status) || 'Open',
    notes: clean(input.notes),
    created_at: existing.created_at || now,
    updated_at: now
  };
}

function assignmentBushelsForContract(ticketLogs, contractId) {
  return ticketLogs.reduce((total, ticket) => {
    const assignments = Array.isArray(ticket.assignments) ? ticket.assignments : [];

    return total + assignments.reduce((sum, assignment) => {
      return assignment.type === 'CONTRACT' && assignment.contract_id === contractId
        ? sum + numeric(assignment.bushels)
        : sum;
    }, 0);
  }, 0);
}

function publicContract(contract, ticketLogs = []) {
  const delivered = assignmentBushelsForContract(ticketLogs, contract.id);

  return {
    ...contract,
    delivered_applied_bushels: delivered,
    remaining_bushels: Math.max(0, numeric(contract.contracted_bushels) - delivered)
  };
}

export async function listContracts(ticketLogs = []) {
  const contracts = await readContracts();
  return contracts
    .map((contract) => publicContract(contract, ticketLogs))
    .sort((a, b) => a.contract_id.localeCompare(b.contract_id));
}

export async function createContract(input, ticketLogs = []) {
  const contracts = await readContracts();
  const contract = {
    id: randomUUID(),
    ...normalizeContract(input)
  };

  validate(contract, contracts);
  contracts.push(contract);
  await writeContracts(contracts);
  return publicContract(contract, ticketLogs);
}

export async function updateContract(id, input, ticketLogs = []) {
  const contracts = await readContracts();
  const index = contracts.findIndex((contract) => contract.id === id);

  if (index === -1) throw new Error('Contract not found.');

  const contract = normalizeContract(input, contracts[index]);
  validate(contract, contracts, id);
  contracts[index] = contract;
  await writeContracts(contracts);
  return publicContract(contract, ticketLogs);
}

export async function deleteContract(id, ticketLogs = []) {
  const contracts = await readContracts();
  const contract = contracts.find((item) => item.id === id);

  if (!contract) throw new Error('Contract not found.');

  const assigned = assignmentBushelsForContract(ticketLogs, id);
  if (assigned > 0) {
    throw new Error('This contract is assigned to ticket bushels. Reassign those tickets before deleting it.');
  }

  await writeContracts(contracts.filter((item) => item.id !== id));
  return contract;
}
