import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import {
  addTicketLog,
  createBin,
  createContract,
  createDriver,
  createFarmUserAccount,
  createLocation,
  createInventoryTransaction,
  createTicketSaleTransaction,
  deleteBin,
  deleteContract,
  deleteDriver,
  deleteLocation,
  deleteInventoryTransaction,
  deleteTicketLog,
  deleteTicketLogByInventoryTransactionId,
  getInventorySnapshot,
  getTicketLogSnapshot,
  listBins,
  listContracts,
  listDrivers,
  listLocations,
  listFarmUsers,
  listInventoryTransactions,
  listTicketLogs,
  repairEmployeeAccount,
  requireSupabaseAuth,
  resumeSupabaseAuth,
  currentAccount,
  currentFarm,
  updateContract,
  updateFarmUserRole,
  updateTicketLog,
  updateBin
} from './supabaseStore.js';
import {
  buildWeeklySummary,
  isWeeklySummarySendTime,
  weeklySummaryWindow,
  WEEKLY_SUMMARY_TIME_ZONE
} from './weeklySummary.js';
import {
  sendWeeklySummaries,
  startWeeklySummaryScheduler
} from './weeklySummaryScheduler.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const port = process.env.PORT || 3001;
const configuredOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  'https://getbinflow.com',
  'https://www.getbinflow.com',
  'https://eliarnold07.github.io',
  'http://localhost:5173'
]);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ticketFields = [
  'date',
  'crop',
  'ticket_number',
  'bushels',
  'gross_weight',
  'tare_weight',
  'net_weight',
  'delivered_to',
  'hauled_by',
  'moisture',
  'hauled_from',
  'price',
  'notes'
];

const defaultDropdownValues = {
  destinations: [],
  haulers: [],
  bins: ['Field']
};

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('This website is not allowed to access the BinFlow API.'));
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use('/api', requireSupabaseAuth);

const employeeRoutes = new Set([
  'GET /session',
  'GET /dropdowns',
  'GET /scanner-contracts',
  'POST /extract-ticket',
  'POST /submit-ticket'
]);

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/weekly-summary/send') return next();

  const account = currentAccount();
  if (account?.role === 'admin') return next();

  const routeKey = `${req.method} ${req.path}`;
  if (account?.role === 'employee' && employeeRoutes.has(routeKey)) return next();

  return res.status(403).json({ error: 'Admin access is required for this action.' });
});

function blankTicket() {
  return Object.fromEntries(ticketFields.map((field) => [field, '']));
}

function cleanSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function titleCase(value) {
  return cleanSpaces(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalizeCrop(value) {
  const crop = cleanSpaces(value);

  if (!crop) {
    return '';
  }

  const lowerCrop = crop.toLowerCase();

  if (lowerCrop.includes('corn')) {
    return 'Corn';
  }

  if (lowerCrop.includes('bean') || lowerCrop.includes('soy')) {
    return 'Beans';
  }

  return titleCase(crop);
}

function normalizeDecimal(value) {
  const text = cleanSpaces(value);
  if (!text) {
    return '';
  }

  const numeric = Number(text.replace(/,/g, ''));
  return Number.isFinite(numeric) ? String(numeric) : text;
}

function normalizeKnownOption(value, options) {
  const text = cleanSpaces(value);

  if (!text) {
    return '';
  }

  return options.find((option) => option.toLowerCase() === text.toLowerCase()) || text;
}

function normalizeTicketData(data) {
  const clean = blankTicket();

  for (const field of ticketFields) {
    clean[field] = cleanSpaces(data?.[field]);
  }

  clean.crop = normalizeCrop(clean.crop);
  clean.bushels = normalizeDecimal(clean.bushels);
  clean.gross_weight = normalizeDecimal(clean.gross_weight);
  clean.tare_weight = normalizeDecimal(clean.tare_weight);
  clean.net_weight = normalizeDecimal(clean.net_weight);
  clean.moisture = normalizeDecimal(clean.moisture);
  clean.price = normalizeDecimal(clean.price);
  clean.delivered_to = clean.delivered_to;
  clean.hauled_by = normalizeKnownOption(clean.hauled_by, defaultDropdownValues.haulers);
  clean.hauled_from = normalizeKnownOption(clean.hauled_from, defaultDropdownValues.bins);

  return clean;
}

function validateTicket(ticket) {
  const requiredFields = ['date', 'crop', 'ticket_number', 'bushels', 'delivered_to', 'hauled_by', 'moisture', 'hauled_from'];
  const missing = requiredFields.filter((field) => !ticket[field]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Please fill in: ${missing.join(', ')}.`
    };
  }

  return { ok: true };
}

function duplicateKey(ticketNumber) {
  return cleanSpaces(ticketNumber).toLowerCase();
}

function numberValue(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

async function validateTicketAccounting(input) {
  const statuses = new Set(['Unassigned', 'Spot', 'Contract', 'Split']);
  const paymentStatuses = new Set(['Not paid', 'Partially paid', 'Paid']);
  const assignmentStatus = cleanSpaces(input.assignment_status || 'Unassigned');
  const paymentStatus = cleanSpaces(input.payment_status || 'Not paid');
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];

  if (!statuses.has(assignmentStatus)) throw new Error('Invalid assignment status.');
  if (!paymentStatuses.has(paymentStatus)) throw new Error('Invalid payment status.');

  if (assignmentStatus === 'Unassigned' && assignments.length > 0) {
    throw new Error('Unassigned tickets cannot contain assignment rows.');
  }

  if (assignmentStatus !== 'Unassigned') {
    const assignedTotal = assignments.reduce((sum, assignment) => sum + numberValue(assignment.bushels), 0);
    if (Math.abs(assignedTotal - numberValue(input.bushels)) > 0.01) {
      throw new Error('Assigned bushels must equal the ticket bushels.');
    }
  }

  const contractAssignments = assignments.filter((assignment) => cleanSpaces(assignment.type).toUpperCase() === 'CONTRACT');
  if (contractAssignments.some((assignment) => !cleanSpaces(assignment.contract_id))) {
    throw new Error('Choose a contract for every contract assignment.');
  }

  if (contractAssignments.length > 0) {
    const ticketLogs = await getTicketLogSnapshot();
    const contracts = await listContracts(ticketLogs);
    const contractIds = new Set(contracts.map((contract) => contract.id));

    if (contractAssignments.some((assignment) => !contractIds.has(assignment.contract_id))) {
      throw new Error('One or more selected contracts no longer exist.');
    }
  }
}

function logError(label, error) {
  console.error(label, {
    message: error.message,
    status: error.status,
    code: error.code
  });
}

function scanUpload(req, res, next) {
  upload.single('ticketImage')(req, res, (error) => {
    if (!error) {
      resumeSupabaseAuth(req, next);
      return;
    }

    logError('Ticket image upload failed', error);
    res.status(400).json({
      error: 'Could not upload ticket image.',
      detail: error.code === 'LIMIT_FILE_SIZE'
        ? 'The photo is too large. Please retake it or choose a smaller image.'
        : error.message
    });
  });
}

function uniqueValues(rows) {
  const values = rows
    .flat()
    .map(cleanSpaces)
    .filter(Boolean);
  const seen = new Set();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function getDropdownData() {
  const appBins = (await listBins()).map((bin) => bin.bin_name);
  const appDrivers = (await listDrivers()).map((driver) => driver.name);
  const appLocations = (await listLocations()).map((location) => location.name);

  const payload = {
    bins: uniqueValues([...appBins, ...defaultDropdownValues.bins]),
    haulers: uniqueValues(appDrivers),
    destinations: uniqueValues(appLocations),
    missing_tabs: [],
    source: 'Supabase farm data'
  };

  return payload;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/weekly-summary/send', async (req, res) => {
  const expectedSecret = cleanSpaces(process.env.WEEKLY_SUMMARY_CRON_SECRET);
  const providedSecret = cleanSpaces(req.get('x-binflow-cron-secret'));

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid weekly summary trigger.' });
  }

  const now = new Date();
  if (!isWeeklySummarySendTime(now, WEEKLY_SUMMARY_TIME_ZONE)) {
    return res.json({ ok: true, skipped: 'outside Sunday noon Eastern' });
  }

  try {
    const results = await sendWeeklySummaries(now);
    res.json({ ok: true, results });
  } catch (error) {
    logError('Weekly summary trigger failed', error);
    res.status(500).json({
      error: 'Could not send weekly summaries.',
      detail: error.message
    });
  }
});

app.get('/api/session', (_req, res) => {
  res.json({ farm: currentFarm(), account: currentAccount() });
});

app.get('/api/dropdowns', async (_req, res) => {
  try {
    const dropdowns = await getDropdownData();
    res.json(dropdowns);
  } catch (error) {
    logError('Dropdown fetch failed', error);
    res.status(500).json({
      error: 'Could not load farm dropdown values.',
      detail: error.message
    });
  }
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const [inventory, ticketLogs] = await Promise.all([
      getInventorySnapshot(),
      getTicketLogSnapshot()
    ]);
    const contracts = await listContracts(ticketLogs);
    const bins = inventory.bins;
    const transactions = inventory.transactions;
    const cornBins = bins.filter((bin) => bin.crop_type === 'Corn');
    const beanBins = bins.filter((bin) => bin.crop_type === 'Beans');
    const totalCornInventory = cornBins.reduce((sum, bin) => sum + numberValue(bin.current_bushels), 0);
    const totalBeanInventory = beanBins.reduce((sum, bin) => sum + numberValue(bin.current_bushels), 0);
    const totalBushelsStored = bins.reduce((sum, bin) => sum + numberValue(bin.current_bushels), 0);
    const totalBushelsSold = transactions
      .filter((transaction) => transaction.transaction_type === 'TICKET_SALE')
      .reduce((sum, transaction) => sum + numberValue(transaction.bushel_amount), 0);
    const inventoryByCrop = [
      { crop: 'Corn', bushels: totalCornInventory },
      { crop: 'Beans', bushels: totalBeanInventory }
    ];
    const totalCapacity = bins.reduce((sum, bin) => sum + numberValue(bin.estimated_capacity_bushels), 0);
    const now = new Date();
    const unpaidTickets = ticketLogs.filter((log) => log.payment_status !== 'Paid');
    const unpaidDeliveredBushels = unpaidTickets.reduce((sum, log) => sum + numberValue(log.bushels), 0);
    const unpaidEstimatedDollars = unpaidTickets.reduce((sum, log) => (
      sum + Math.max(0, numberValue(log.revenue) - numberValue(log.amount_received))
    ), 0);
    const paymentsReceivedThisMonth = ticketLogs
      .filter((log) => {
        if (!log.payment_date) return false;
        const paymentDate = new Date(log.payment_date);
        return paymentDate.getFullYear() === now.getFullYear() && paymentDate.getMonth() === now.getMonth();
      })
      .reduce((sum, log) => sum + numberValue(log.amount_received), 0);
    const weeklyWindow = weeklySummaryWindow(now, WEEKLY_SUMMARY_TIME_ZONE);
    const weeklySummary = buildWeeklySummary({
      tickets: ticketLogs,
      transactions,
      bins,
      periodStart: weeklyWindow.periodStart,
      periodEnd: now,
      timeZone: WEEKLY_SUMMARY_TIME_ZONE
    });
    res.json({
      kpis: {
        total_corn_inventory: totalCornInventory,
        total_bean_inventory: totalBeanInventory,
        total_bushels_stored: totalBushelsStored,
        total_tickets_scanned: ticketLogs.length,
        total_bushels_sold: totalBushelsSold,
        active_bins: bins.length
      },
      finance: {
        unpaid_delivered_bushels: unpaidDeliveredBushels,
        unpaid_estimated_dollars: unpaidEstimatedDollars,
        payments_received_this_month: paymentsReceivedThisMonth,
        contracts_with_remaining_bushels: contracts.filter((contract) => contract.remaining_bushels > 0 && contract.status !== 'Closed').length,
        unassigned_tickets: ticketLogs.filter((log) => log.assignment_status === 'Unassigned').length
      },
      charts: {
        inventory_by_crop: inventoryByCrop,
        storage_utilization: {
          current_bushels: totalBushelsStored,
          estimated_capacity: totalCapacity,
          percent_full: totalCapacity > 0 ? (totalBushelsStored / totalCapacity) * 100 : null
        },
        recent_ticket_activity: ticketLogs.slice(0, 7).map((log) => ({
          date: log.date,
          bushels: numberValue(log.bushels),
          crop: log.crop
        }))
      },
      bin_overview: bins,
      weekly_summary: weeklySummary
    });
  } catch (error) {
    logError('Dashboard fetch failed', error);
    res.status(500).json({
      error: 'Could not load dashboard.',
      detail: error.message
    });
  }
});

app.get('/api/ticket-logs', async (req, res) => {
  try {
    const logs = await listTicketLogs({
      search: req.query.search,
      date: req.query.date,
      crop: req.query.crop,
      ticket_number: req.query.ticket_number,
      elevator: req.query.elevator,
      scanned_by: req.query.scanned_by,
      assignment_status: req.query.assignment_status,
      payment_status: req.query.payment_status
    });

    res.json({
      logs,
      count: logs.length
    });
  } catch (error) {
    logError('Ticket log fetch failed', error);
    res.status(500).json({
      error: 'Could not load ticket history.',
      detail: error.message
    });
  }
});

app.put('/api/ticket-logs/:id', async (req, res) => {
  try {
    await validateTicketAccounting(req.body || {});
    const ticket = await updateTicketLog(req.params.id, req.body || {});
    res.json({ ticket });
  } catch (error) {
    logError('Ticket log update failed', error);
    res.status(400).json({
      error: 'Could not update ticket log.',
      detail: error.message
    });
  }
});

app.delete('/api/ticket-logs/:id', async (req, res) => {
  try {
    const deletedLog = await deleteTicketLog(req.params.id);

    if (deletedLog.inventory_transaction_id) {
      await deleteInventoryTransaction(deletedLog.inventory_transaction_id);
    }

    res.json({
      ok: true,
      deleted_log: deletedLog
    });
  } catch (error) {
    logError('Ticket log delete failed', error);
    res.status(400).json({
      error: 'Could not delete ticket log.',
      detail: error.message
    });
  }
});

app.get('/api/contracts', async (_req, res) => {
  try {
    const ticketLogs = await getTicketLogSnapshot();
    res.json({ contracts: await listContracts(ticketLogs) });
  } catch (error) {
    logError('Contract fetch failed', error);
    res.status(500).json({ error: 'Could not load contracts.', detail: error.message });
  }
});

app.get('/api/scanner-contracts', async (_req, res) => {
  try {
    const ticketLogs = await getTicketLogSnapshot();
    const contracts = await listContracts(ticketLogs);
    const availableContracts = contracts
      .filter((contract) => Number(contract.remaining_bushels || 0) > 0 && String(contract.status).toLowerCase() !== 'closed')
      .map((contract) => ({
        id: contract.id,
        contract_id: contract.contract_id,
        buyer: contract.buyer,
        commodity: contract.commodity,
        remaining_bushels: contract.remaining_bushels,
        status: contract.status
      }));

    res.json({ contracts: availableContracts });
  } catch (error) {
    logError('Scanner contract fetch failed', error);
    res.status(500).json({ error: 'Could not load available contracts.', detail: error.message });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    res.json({ users: await listFarmUsers() });
  } catch (error) {
    logError('Farm user fetch failed', error);
    res.status(500).json({ error: 'Could not load farm users.', detail: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    res.status(201).json({ user: await createFarmUserAccount(req.body || {}) });
  } catch (error) {
    logError('Farm user account creation failed', error);
    res.status(400).json({ error: 'Could not create farm user account.', detail: error.message });
  }
});

app.patch('/api/users/:id/role', async (req, res) => {
  try {
    res.json({ user: await updateFarmUserRole(req.params.id, req.body?.role) });
  } catch (error) {
    logError('Farm user role update failed', error);
    res.status(400).json({ error: 'Could not update user role.', detail: error.message });
  }
});

app.post('/api/users/repair', async (req, res) => {
  try {
    res.json({ user: await repairEmployeeAccount(req.body || {}) });
  } catch (error) {
    logError('Employee account repair failed', error);
    res.status(400).json({ error: 'Could not repair employee account.', detail: error.message });
  }
});

app.post('/api/contracts', async (req, res) => {
  try {
    const ticketLogs = await getTicketLogSnapshot();
    res.status(201).json({ contract: await createContract(req.body || {}, ticketLogs) });
  } catch (error) {
    logError('Contract create failed', error);
    res.status(400).json({ error: 'Could not create contract.', detail: error.message });
  }
});

app.put('/api/contracts/:id', async (req, res) => {
  try {
    const ticketLogs = await getTicketLogSnapshot();
    res.json({ contract: await updateContract(req.params.id, req.body || {}, ticketLogs) });
  } catch (error) {
    logError('Contract update failed', error);
    res.status(400).json({ error: 'Could not update contract.', detail: error.message });
  }
});

app.delete('/api/contracts/:id', async (req, res) => {
  try {
    const ticketLogs = await getTicketLogSnapshot();
    await deleteContract(req.params.id, ticketLogs);
    res.json({ ok: true });
  } catch (error) {
    logError('Contract delete failed', error);
    res.status(400).json({ error: 'Could not delete contract.', detail: error.message });
  }
});

app.get('/api/bins', async (_req, res) => {
  try {
    const bins = await listBins();
    res.json({ bins });
  } catch (error) {
    logError('Bin fetch failed', error);
    res.status(500).json({
      error: 'Could not load grain bins.',
      detail: error.message
    });
  }
});

app.get('/api/drivers', async (_req, res) => {
  try {
    const drivers = await listDrivers();
    res.json({ drivers });
  } catch (error) {
    logError('Driver fetch failed', error);
    res.status(500).json({
      error: 'Could not load drivers.',
      detail: error.message
    });
  }
});

app.post('/api/drivers', async (req, res) => {
  try {
    const driver = await createDriver(req.body || {});
    res.status(201).json({ driver });
  } catch (error) {
    logError('Driver create failed', error);
    res.status(400).json({
      error: 'Could not create driver.',
      detail: error.message
    });
  }
});

app.delete('/api/drivers/:id', async (req, res) => {
  try {
    await deleteDriver(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    logError('Driver delete failed', error);
    res.status(400).json({
      error: 'Could not delete driver.',
      detail: error.message
    });
  }
});

app.get('/api/locations', async (_req, res) => {
  try {
    const locations = await listLocations();
    res.json({ locations });
  } catch (error) {
    logError('Location fetch failed', error);
    res.status(500).json({
      error: 'Could not load locations.',
      detail: error.message
    });
  }
});

app.post('/api/locations', async (req, res) => {
  try {
    const location = await createLocation(req.body || {});
    res.status(201).json({ location });
  } catch (error) {
    logError('Location create failed', error);
    res.status(400).json({
      error: 'Could not create location.',
      detail: error.message
    });
  }
});

app.delete('/api/locations/:id', async (req, res) => {
  try {
    await deleteLocation(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    logError('Location delete failed', error);
    res.status(400).json({
      error: 'Could not delete location.',
      detail: error.message
    });
  }
});

app.post('/api/bins', async (req, res) => {
  try {
    const bin = await createBin(req.body || {});
    res.status(201).json({ bin });
  } catch (error) {
    logError('Bin create failed', error);
    res.status(400).json({
      error: 'Could not create grain bin.',
      detail: error.message
    });
  }
});

app.put('/api/bins/:id', async (req, res) => {
  try {
    const bin = await updateBin(req.params.id, req.body || {});
    res.json({ bin });
  } catch (error) {
    logError('Bin update failed', error);
    res.status(400).json({
      error: 'Could not update grain bin.',
      detail: error.message
    });
  }
});

app.delete('/api/bins/:id', async (req, res) => {
  try {
    await deleteBin(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    logError('Bin delete failed', error);
    res.status(400).json({
      error: 'Could not delete grain bin.',
      detail: error.message
    });
  }
});

app.get('/api/inventory-transactions', async (req, res) => {
  try {
    const transactions = await listInventoryTransactions({
      bin_id: req.query.bin_id,
      transaction_type: req.query.transaction_type
    });
    res.json({ transactions });
  } catch (error) {
    logError('Inventory transaction fetch failed', error);
    res.status(500).json({
      error: 'Could not load inventory transactions.',
      detail: error.message
    });
  }
});

app.post('/api/inventory-transactions', async (req, res) => {
  try {
    const result = await createInventoryTransaction(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    logError('Inventory transaction create failed', error);
    res.status(400).json({
      error: 'Could not create inventory transaction.',
      detail: error.message
    });
  }
});

app.delete('/api/inventory-transactions/:id', async (req, res) => {
  try {
    const deletedLog = await deleteTicketLogByInventoryTransactionId(req.params.id);
    const result = await deleteInventoryTransaction(req.params.id);

    res.json({
      ...result,
      deleted_ticket_log: deletedLog
    });
  } catch (error) {
    logError('Inventory transaction delete failed', error);
    res.status(400).json({
      error: 'Could not delete inventory transaction.',
      detail: error.message
    });
  }
});

app.post('/api/extract-ticket', scanUpload, async (req, res) => {
  const scanId = randomUUID();
  const startedAt = Date.now();

  console.log('Ticket scan request received', {
    scanId,
    hasFile: Boolean(req.file),
    fileName: req.file?.originalname,
    mimeType: req.file?.mimetype,
    fileSizeBytes: req.file?.size,
    userAgent: req.get('user-agent')
  });

  if (!req.file) {
    return res.status(400).json({ error: 'Please upload a ticket image.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY in environment.' });
  }

  try {
    const dropdowns = await getDropdownData().catch(() => ({
      destinations: [],
      missing_tabs: []
    }));
    const destinationHint = dropdowns.destinations.length > 0
      ? `For delivered_to, choose one of these values when visible or strongly implied: ${dropdowns.destinations.join(', ')}. Otherwise return an empty string.`
      : 'For delivered_to, use the delivery destination visible on the ticket. Otherwise return an empty string.';
    const imageBase64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    console.log('Ticket image prepared for OpenAI', {
      scanId,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      base64Bytes: imageBase64.length
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Extract structured data from this grain elevator ticket.',
                'Return only JSON that matches the requested schema.',
                'Use empty strings for fields that are not visible or uncertain.',
                'For date, use the shipment or ticket date.',
                'For crop, return exactly Corn or Beans. Interpret yellow corn, corn, soybeans, soybean, beans, or similar wording into one of those two values.',
                'For bushels, prefer net bushels if visible; otherwise use the clearest bushel amount.',
                'Extract gross_weight, tare_weight, and net_weight in pounds when visible.',
                'Extract price only when a clear per-bushel price is printed.',
                'Put any useful ticket remarks in notes.',
                destinationHint,
                'Always leave hauled_by empty because the user will choose or fill it manually.',
                'Always leave hauled_from empty because the user will choose or fill it manually.'
              ].join(' ')
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'grain_ticket',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(
              ticketFields.map((field) => [field, { type: 'string' }])
            ),
            required: ticketFields
          },
          strict: true
        }
      }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const ticket = normalizeTicketData(parsed);
    const matchingTickets = ticket.ticket_number
      ? await listTicketLogs({ ticket_number: ticket.ticket_number })
      : [];
    const isDuplicate = matchingTickets.some((log) => duplicateKey(log.ticket_number) === duplicateKey(ticket.ticket_number));

    console.log('Ticket scan completed', {
      scanId,
      durationMs: Date.now() - startedAt,
      ticketNumber: ticket.ticket_number,
      crop: ticket.crop,
      bushels: ticket.bushels
    });

    res.json({
      ticket,
      duplicate: {
        checked: true,
        is_duplicate: isDuplicate,
        match_field: 'ticket_number',
        message: isDuplicate
          ? 'Possible duplicate ticket number found. Please review before submitting.'
          : 'No duplicate found in this local placeholder check.'
      }
    });
  } catch (error) {
    logError(`Ticket extraction failed scanId=${scanId}`, error);
    res.status(500).json({
      error: 'Could not extract ticket data from this image.',
      detail: error.message
    });
  }
});

app.post('/api/submit-ticket', async (req, res) => {
  const submittedTicket = req.body?.ticket || {};
  const ticket = {
    ...normalizeTicketData(submittedTicket),
    assignment_status: cleanSpaces(submittedTicket.assignment_status || 'Spot'),
    assignments: Array.isArray(submittedTicket.assignments) ? submittedTicket.assignments : [],
    payment_status: 'Not paid',
    payment_date: '',
    amount_received: 0,
    payment_reference: '',
    payment_notes: ''
  };
  const validation = validateTicket(ticket);

  if (!validation.ok) {
    return res.status(400).json({
      error: validation.message
    });
  }

  try {
    await validateTicketAccounting(ticket);
    let inventoryTransactionId = '';

    if (ticket.hauled_from.toLowerCase() !== 'field') {
      const inventoryResult = await createTicketSaleTransaction({
        binName: ticket.hauled_from,
        bushels: ticket.bushels,
        cropType: ticket.crop,
        ticketId: ticket.ticket_number,
        notes: `Ticket sale ${ticket.ticket_number}`,
        allowOverdraw: req.body?.allow_bin_overdraw === true
      });

      inventoryTransactionId = inventoryResult?.transaction?.id || '';
    }

    const ticketLog = await addTicketLog({
      ...ticket,
      inventory_transaction_id: inventoryTransactionId
    });

    console.log('Reviewed grain ticket submission saved', {
      ticket_number: ticket.ticket_number,
      date: ticket.date,
      bushels: ticket.bushels
    });

    res.json({
      ok: true,
      message: 'Ticket submitted successfully',
      storage_mode: 'supabase',
      ticket,
      ticket_log: ticketLog
    });
  } catch (error) {
    logError('Ticket submit failed', error);
    const isOverdraw = error.code === 'BIN_INVENTORY_OVERDRAW';
    res.status(isOverdraw ? 409 : 500).json({
      error: 'Could not save ticket data.',
      detail: error.message,
      code: error.code,
      bin_name: error.binName,
      current_bushels: error.currentBushels,
      ticket_bushels: error.ticketBushels
    });
  }
});

app.listen(port, () => {
  console.log(`Grain Ticket Scanner API running on port ${port}`);
  console.log('Ticket storage mode: Supabase');
  console.log(`Supabase privileged server access: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'missing (employee account features unavailable)'}`);
  console.log(`Weekly summary email: ${process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? 'configured' : 'missing Resend configuration'}`);
});

startWeeklySummaryScheduler();
