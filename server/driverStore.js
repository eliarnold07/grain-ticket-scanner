import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = path.resolve('data');
const driverFile = path.join(dataDir, 'drivers.json');

async function ensureStore() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  if (!existsSync(driverFile)) {
    await writeFile(driverFile, '[]', 'utf8');
  }
}

async function readDrivers() {
  await ensureStore();
  const raw = await readFile(driverFile, 'utf8');

  try {
    const drivers = JSON.parse(raw);
    return Array.isArray(drivers) ? drivers : [];
  } catch {
    return [];
  }
}

async function writeDrivers(drivers) {
  await ensureStore();
  await writeFile(driverFile, JSON.stringify(drivers, null, 2), 'utf8');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function listDrivers() {
  const drivers = await readDrivers();
  return drivers.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createDriver(input) {
  const drivers = await readDrivers();
  const name = clean(input.name);

  if (!name) {
    throw new Error('Driver name is required.');
  }

  const existing = drivers.find((driver) => driver.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const driver = {
    id: randomUUID(),
    name,
    created_at: now,
    updated_at: now
  };

  drivers.push(driver);
  await writeDrivers(drivers);
  return driver;
}

export async function deleteDriver(driverId) {
  const drivers = await readDrivers();
  const nextDrivers = drivers.filter((driver) => driver.id !== driverId);

  if (nextDrivers.length === drivers.length) {
    throw new Error('Driver not found.');
  }

  await writeDrivers(nextDrivers);
  return { ok: true };
}
