import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = path.resolve('data');
const inventoryFile = path.join(dataDir, 'inventory.json');

const transactionTypes = new Set([
  'ADD_GRAIN',
  'REMOVE_GRAIN',
  'MANUAL_ADJUSTMENT',
  'TICKET_SALE'
]);

async function ensureStore() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  if (!existsSync(inventoryFile)) {
    await writeFile(inventoryFile, JSON.stringify({ bins: [], transactions: [] }, null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();
  const raw = await readFile(inventoryFile, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    return {
      bins: Array.isArray(parsed.bins) ? parsed.bins : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
    };
  } catch {
    return { bins: [], transactions: [] };
  }
}

async function writeStore(store) {
  await ensureStore();
  await writeFile(inventoryFile, JSON.stringify(store, null, 2), 'utf8');
}

function clean(value) {
  return String(value || '').trim();
}

function numeric(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeCrop(value) {
  const crop = clean(value);

  if (!crop) {
    return '';
  }

  const lower = crop.toLowerCase();

  if (lower.includes('corn')) {
    return 'Corn';
  }

  if (lower.includes('bean') || lower.includes('soy')) {
    return 'Beans';
  }

  return crop;
}

function publicBin(bin) {
  const capacity = numeric(bin.estimated_capacity_bushels);
  const current = Math.max(0, numeric(bin.current_bushels));

  return {
    ...bin,
    estimated_capacity_bushels: capacity,
    current_bushels: current,
    percent_full: capacity > 0 ? Math.min(100, Math.max(0, (current / capacity) * 100)) : null
  };
}

function buildTransaction({ bin, type, amount, appliedAmount = amount, previousBalance, newBalance, ticketId = '', notes = '', exceededEstimate = false }) {
  return {
    id: randomUUID(),
    bin_id: bin.id,
    transaction_type: type,
    crop_type: bin.crop_type,
    bushel_amount: numeric(amount),
    applied_bushel_amount: numeric(appliedAmount),
    previous_bin_balance: numeric(previousBalance),
    new_bin_balance: numeric(newBalance),
    exceeded_estimated_inventory: Boolean(exceededEstimate),
    ticket_id: clean(ticketId),
    notes: clean(notes),
    created_at: new Date().toISOString()
  };
}

function findBin(store, binId) {
  return store.bins.find((bin) => bin.id === binId);
}

export async function listBins() {
  const store = await readStore();
  const transactionsByBin = new Map();

  for (const transaction of store.transactions) {
    const current = transactionsByBin.get(transaction.bin_id) || [];
    current.push(transaction);
    transactionsByBin.set(transaction.bin_id, current);
  }

  return store.bins
    .map(publicBin)
    .map((bin) => ({
      ...bin,
      recent_transactions: (transactionsByBin.get(bin.id) || [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
    }))
    .sort((a, b) => a.bin_name.localeCompare(b.bin_name));
}

export async function createBin(input) {
  const store = await readStore();
  const now = new Date().toISOString();
  const bin = {
    id: randomUUID(),
    bin_name: clean(input.bin_name),
    crop_type: normalizeCrop(input.crop_type),
    estimated_capacity_bushels: numeric(input.estimated_capacity_bushels),
    current_bushels: numeric(input.current_bushels),
    notes: clean(input.notes),
    created_at: now,
    updated_at: now
  };

  if (!bin.bin_name) {
    throw new Error('Bin name is required.');
  }

  store.bins.push(bin);

  if (bin.current_bushels !== 0) {
    store.transactions.push(buildTransaction({
      bin,
      type: 'MANUAL_ADJUSTMENT',
      amount: bin.current_bushels,
      previousBalance: 0,
      newBalance: bin.current_bushels,
      notes: 'Initial bin balance'
    }));
  }

  await writeStore(store);
  return publicBin(bin);
}

export async function updateBin(binId, input) {
  const store = await readStore();
  const bin = findBin(store, binId);

  if (!bin) {
    throw new Error('Bin not found.');
  }

  bin.bin_name = clean(input.bin_name);
  bin.crop_type = normalizeCrop(input.crop_type);
  bin.estimated_capacity_bushels = numeric(input.estimated_capacity_bushels);
  bin.notes = clean(input.notes);
  bin.updated_at = new Date().toISOString();

  if (!bin.bin_name) {
    throw new Error('Bin name is required.');
  }

  await writeStore(store);
  return publicBin(bin);
}

export async function deleteBin(binId) {
  const store = await readStore();
  const originalLength = store.bins.length;
  store.bins = store.bins.filter((bin) => bin.id !== binId);

  if (store.bins.length === originalLength) {
    throw new Error('Bin not found.');
  }

  await writeStore(store);
  return { ok: true };
}

export async function createInventoryTransaction(input) {
  const store = await readStore();
  const bin = findBin(store, input.bin_id);

  if (!bin) {
    throw new Error('Bin not found.');
  }

  const type = clean(input.transaction_type).toUpperCase();

  if (!transactionTypes.has(type)) {
    throw new Error('Invalid transaction type.');
  }

  const previousBalance = numeric(bin.current_bushels);
  const amount = numeric(input.bushel_amount);
  let newBalance = previousBalance;

  if (type === 'ADD_GRAIN') {
    newBalance = previousBalance + amount;
  } else if (type === 'REMOVE_GRAIN' || type === 'TICKET_SALE') {
    newBalance = Math.max(0, previousBalance - amount);
  } else if (type === 'MANUAL_ADJUSTMENT') {
    newBalance = amount;
  }

  const transaction = buildTransaction({
    bin,
    type,
    amount,
    appliedAmount: type === 'REMOVE_GRAIN' || type === 'TICKET_SALE'
      ? Math.min(previousBalance, amount)
      : amount,
    previousBalance,
    newBalance,
    ticketId: input.ticket_id,
    notes: input.notes
  });

  bin.current_bushels = newBalance;
  bin.updated_at = new Date().toISOString();
  store.transactions.push(transaction);

  await writeStore(store);

  return {
    bin: publicBin(bin),
    transaction
  };
}

export async function createTicketSaleTransaction({ binName, bushels, cropType, ticketId, notes, allowOverdraw = false }) {
  const store = await readStore();
  const cleanBinName = clean(binName);
  const bin = store.bins.find((candidate) => candidate.bin_name.toLowerCase() === cleanBinName.toLowerCase());

  if (!bin) {
    return null;
  }

  if (cropType) {
    bin.crop_type = normalizeCrop(cropType);
  }

  const previousBalance = Math.max(0, numeric(bin.current_bushels));
  const amount = numeric(bushels);
  const exceedsEstimate = amount > previousBalance;

  if (exceedsEstimate && !allowOverdraw) {
    const error = new Error('This ticket exceeds estimated bin inventory. Continue and set this bin to 0?');
    error.code = 'BIN_INVENTORY_OVERDRAW';
    error.binName = bin.bin_name;
    error.currentBushels = previousBalance;
    error.ticketBushels = amount;
    throw error;
  }

  const appliedAmount = Math.min(previousBalance, amount);
  const newBalance = Math.max(0, previousBalance - amount);
  const transaction = buildTransaction({
    bin,
    type: 'TICKET_SALE',
    amount,
    appliedAmount,
    previousBalance,
    newBalance,
    ticketId,
    notes,
    exceededEstimate: exceedsEstimate
  });

  bin.current_bushels = newBalance;
  bin.updated_at = new Date().toISOString();
  store.transactions.push(transaction);

  await writeStore(store);

  return {
    bin: publicBin(bin),
    transaction
  };
}

export async function deleteInventoryTransaction(transactionId) {
  const store = await readStore();
  const transaction = store.transactions.find((item) => item.id === transactionId);

  if (!transaction) {
    return { ok: true, deleted: false };
  }

  store.transactions = store.transactions.filter((item) => item.id !== transactionId);

  const bin = findBin(store, transaction.bin_id);
  if (bin) {
    const remaining = store.transactions
      .filter((item) => item.bin_id === bin.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    let balance = 0;

    for (const item of remaining) {
      item.previous_bin_balance = balance;

      if (item.transaction_type === 'ADD_GRAIN') {
        balance += numeric(item.bushel_amount);
      } else if (item.transaction_type === 'REMOVE_GRAIN' || item.transaction_type === 'TICKET_SALE') {
        const appliedAmount = item.applied_bushel_amount === undefined
          ? Math.min(balance, numeric(item.bushel_amount))
          : numeric(item.applied_bushel_amount);
        balance = Math.max(0, balance - appliedAmount);
      } else if (item.transaction_type === 'MANUAL_ADJUSTMENT') {
        balance = numeric(item.bushel_amount);
      }

      item.new_bin_balance = balance;
    }

    bin.current_bushels = balance;
    bin.updated_at = new Date().toISOString();
  }

  await writeStore(store);
  return { ok: true, deleted: true };
}

export async function listInventoryTransactions(filters = {}) {
  const store = await readStore();
  const binId = clean(filters.bin_id);
  const type = clean(filters.transaction_type).toUpperCase();

  return store.transactions
    .filter((transaction) => {
      if (binId && transaction.bin_id !== binId) {
        return false;
      }

      if (type && transaction.transaction_type !== type) {
        return false;
      }

      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getInventorySnapshot() {
  const store = await readStore();
  return {
    bins: store.bins.map(publicBin),
    transactions: [...store.transactions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  };
}
