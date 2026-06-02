import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { addTicketLog, deleteTicketLog, deleteTicketLogByInventoryTransactionId, getTicketLogSnapshot, listTicketLogs } from './ticketLogStore.js';
import {
  createBin,
  createInventoryTransaction,
  createTicketSaleTransaction,
  deleteBin,
  deleteInventoryTransaction,
  getInventorySnapshot,
  listBins,
  listInventoryTransactions,
  updateBin
} from './inventoryStore.js';
import { createDriver, deleteDriver, listDrivers } from './driverStore.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const port = process.env.PORT || 3001;
const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetTab = process.env.GOOGLE_SHEET_TAB || 'Form Responses 1';
const serviceAccountKeyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY;
const allowedOrigin = process.env.CORS_ORIGIN || '*';
const dropdownCacheMs = Number(process.env.DROPDOWN_CACHE_MS || 60000);
const ticketStorageMode = process.env.TICKET_STORAGE_MODE || 'sheets';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ticketFields = [
  'date',
  'crop',
  'ticket_number',
  'bushels',
  'delivered_to',
  'hauled_by',
  'moisture',
  'hauled_from'
];

const dropdownTabs = {
  bins: 'Bins',
  haulers: 'Haulers',
  destinations: 'Destinations'
};

const defaultDropdownValues = {
  destinations: [],
  haulers: [],
  bins: ['Field']
};

const duplicateTicketNumbers = new Set();
let dropdownCache = {
  expiresAt: 0,
  data: null
};

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '2mb' }));

function isLocalTicketStorage() {
  return ticketStorageMode.toLowerCase() === 'local';
}

function isSheetsTicketStorage() {
  return ticketStorageMode.toLowerCase() === 'sheets';
}

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
  clean.moisture = normalizeDecimal(clean.moisture);
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

function sheetText(value) {
  const text = cleanSpaces(value);
  return text ? `'${text}` : '';
}

function numberValue(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
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
      next();
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

function googleCredentialSource() {
  if (googleClientEmail && googlePrivateKey) {
    return 'environment variables';
  }

  if (serviceAccountJson) {
    return 'GOOGLE_SERVICE_ACCOUNT_JSON';
  }

  if (serviceAccountKeyFile && existsSync(serviceAccountKeyFile)) {
    return 'local JSON file';
  }

  return 'missing';
}

function getGoogleAuth() {
  if (googleClientEmail && googlePrivateKey) {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    return new google.auth.GoogleAuth({
      credentials: {
        client_email: googleClientEmail,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  if (serviceAccountKeyFile && existsSync(serviceAccountKeyFile)) {
    return new google.auth.GoogleAuth({
      keyFile: serviceAccountKeyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  throw new Error('Missing Google credentials. Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in production, or GOOGLE_SERVICE_ACCOUNT_KEY_FILE locally.');
}

function getSheetsClient() {
  if (!sheetId) {
    throw new Error('Missing GOOGLE_SHEET_ID in environment.');
  }

  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
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

async function readDropdownTab(sheets, tabName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A2:A`
    });

    return {
      values: uniqueValues(response.data.values || []),
      missing: false
    };
  } catch (error) {
    if (error.code === 400 || error.code === 404) {
      return {
        values: [],
        missing: true
      };
    }

    throw error;
  }
}

async function getDropdownData() {
  if (dropdownCache.data && Date.now() < dropdownCache.expiresAt) {
    return dropdownCache.data;
  }

  const appBins = (await listBins()).map((bin) => bin.bin_name);
  const appDrivers = (await listDrivers()).map((driver) => driver.name);

  if (isLocalTicketStorage()) {
    const payload = {
      bins: uniqueValues([...appBins, ...defaultDropdownValues.bins]),
      haulers: uniqueValues(appDrivers),
      destinations: defaultDropdownValues.destinations,
      missing_tabs: [],
      source: 'local app data'
    };

    dropdownCache = {
      expiresAt: Date.now() + dropdownCacheMs,
      data: payload
    };

    return payload;
  }

  let sheets = null;
  try {
    sheets = getSheetsClient();
  } catch (error) {
    if (!isLocalTicketStorage()) {
      throw error;
    }

    const payload = {
      bins: uniqueValues(appBins),
      haulers: uniqueValues(appDrivers),
      destinations: defaultDropdownValues.destinations,
      missing_tabs: [],
      source: 'local defaults'
    };

    dropdownCache = {
      expiresAt: Date.now() + dropdownCacheMs,
      data: payload
    };

    return payload;
  }

  const entries = await Promise.all(
    Object.entries(dropdownTabs).map(async ([key, tabName]) => {
      const result = await readDropdownTab(sheets, tabName);
      return [key, result];
    })
  );

  const missingTabs = [];
  const data = Object.fromEntries(
    entries.map(([key, result]) => {
      if (result.missing) {
        missingTabs.push(dropdownTabs[key]);
      }

      if (key === 'bins') {
        return [key, uniqueValues([...appBins, ...defaultDropdownValues.bins, ...result.values])];
      }

      if (key === 'haulers') {
        return [key, uniqueValues([...appDrivers, ...result.values])];
      }

      return [key, uniqueValues([...(defaultDropdownValues[key] || []), ...result.values])];
    })
  );

  const payload = {
    ...data,
    missing_tabs: missingTabs
  };

  dropdownCache = {
    expiresAt: Date.now() + dropdownCacheMs,
    data: payload
  };

  return payload;
}

async function appendTicketToSheet(ticket) {
  const sheets = getSheetsClient();
  const row = [
    new Date().toLocaleString('en-US', { timeZone: 'America/Indianapolis' }),
    '',
    ticket.date,
    ticket.crop,
    sheetText(ticket.ticket_number),
    ticket.bushels,
    ticket.delivered_to,
    ticket.hauled_by,
    ticket.moisture,
    ticket.hauled_from
  ];

  const existingRows = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${sheetTab}'!A:J`
  });
  const values = existingRows.data.values || [];
  const lastTicketRowIndex = values.reduce((lastIndex, sheetRow, index) => {
    return sheetRow.some((cell) => cleanSpaces(cell)) ? index : lastIndex;
  }, 0);
  const nextRowNumber = lastTicketRowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${sheetTab}'!A${nextRowNumber}:J${nextRowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row]
    }
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/dropdowns', async (_req, res) => {
  try {
    const dropdowns = await getDropdownData();
    res.json(dropdowns);
  } catch (error) {
    logError('Dropdown fetch failed', error);
    res.status(500).json({
      error: 'Could not load dropdown values from Google Sheets.',
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
    const recentActivities = [
      ...ticketLogs.slice(0, 12).map((log) => ({
        id: `ticket-${log.id}`,
        type: 'TICKET_SCAN',
        label: `Ticket ${log.ticket_number || 'logged'}`,
        detail: `${log.crop || 'Unknown crop'} · ${log.bushels || 0} bu · ${log.hauled_from || 'No source'}`,
        timestamp: log.created_at
      })),
      ...transactions.slice(0, 12).map((transaction) => ({
        id: `transaction-${transaction.id}`,
        type: transaction.transaction_type,
        label: transaction.transaction_type.replaceAll('_', ' '),
        detail: `${transaction.bushel_amount} bu · ${transaction.previous_bin_balance} to ${transaction.new_bin_balance}`,
        timestamp: transaction.created_at
      }))
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    res.json({
      kpis: {
        total_corn_inventory: totalCornInventory,
        total_bean_inventory: totalBeanInventory,
        total_bushels_stored: totalBushelsStored,
        total_tickets_scanned: ticketLogs.length,
        total_bushels_sold: totalBushelsSold,
        active_bins: bins.length
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
      recent_activity: recentActivities
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
      elevator: req.query.elevator
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
    dropdownCache = { expiresAt: 0, data: null };
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
    dropdownCache = { expiresAt: 0, data: null };
    res.json({ ok: true });
  } catch (error) {
    logError('Driver delete failed', error);
    res.status(400).json({
      error: 'Could not delete driver.',
      detail: error.message
    });
  }
});

app.post('/api/bins', async (req, res) => {
  try {
    const bin = await createBin(req.body || {});
    dropdownCache = { expiresAt: 0, data: null };
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
    dropdownCache = { expiresAt: 0, data: null };
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
    dropdownCache = { expiresAt: 0, data: null };
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
    const result = await deleteInventoryTransaction(req.params.id);
    const deletedLog = await deleteTicketLogByInventoryTransactionId(req.params.id);

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
    const ticketKey = duplicateKey(ticket.ticket_number);
    const isDuplicate = Boolean(ticketKey && duplicateTicketNumbers.has(ticketKey));

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
  const ticket = normalizeTicketData(req.body?.ticket);
  const validation = validateTicket(ticket);

  if (!validation.ok) {
    return res.status(400).json({
      error: validation.message
    });
  }

  const ticketKey = duplicateKey(ticket.ticket_number);

  try {
    let ticketLog = null;

    if (isSheetsTicketStorage()) {
      await appendTicketToSheet(ticket);

      try {
        ticketLog = await addTicketLog(ticket);
      } catch (logErrorDetails) {
        logError('Ticket log save failed after Google Sheets submit', logErrorDetails);
      }
    } else if (isLocalTicketStorage()) {
      let inventoryTransactionId = '';

      if (ticket.hauled_from.toLowerCase() !== 'field') {
        const inventoryResult = await createTicketSaleTransaction({
          binName: ticket.hauled_from,
          bushels: ticket.bushels,
          cropType: ticket.crop,
          ticketId: ticket.ticket_number,
          notes: `Ticket sale ${ticket.ticket_number}`
        });

        inventoryTransactionId = inventoryResult?.transaction?.id || '';
      }

      ticketLog = await addTicketLog({
        ...ticket,
        inventory_transaction_id: inventoryTransactionId
      });
    } else {
      return res.status(500).json({
        error: 'Invalid ticket storage mode.',
        detail: 'Use TICKET_STORAGE_MODE=sheets or TICKET_STORAGE_MODE=local.'
      });
    }

    if (ticketKey) {
      duplicateTicketNumbers.add(ticketKey);
    }

    console.log('Reviewed grain ticket submission saved', {
      ticket_number: ticket.ticket_number,
      date: ticket.date,
      bushels: ticket.bushels
    });

    res.json({
      ok: true,
      message: isLocalTicketStorage() ? 'Ticket saved locally' : 'Ticket submitted successfully',
      storage_mode: ticketStorageMode,
      ticket,
      ticket_log: ticketLog
    });
  } catch (error) {
    logError('Ticket submit failed', error);
    res.status(500).json({
      error: isLocalTicketStorage()
        ? 'Could not save ticket data locally.'
        : 'Could not save ticket data to Google Sheets.',
      detail: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Grain Ticket Scanner API running on port ${port}`);
  console.log(`Ticket storage mode: ${ticketStorageMode}`);
  console.log(`Google Sheets credentials source: ${googleCredentialSource()}`);
});
