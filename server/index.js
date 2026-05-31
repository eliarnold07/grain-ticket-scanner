import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';

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
const allowedOrigin = process.env.CORS_ORIGIN || '*';
const dropdownCacheMs = Number(process.env.DROPDOWN_CACHE_MS || 60000);

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
  destinations: ['Rock Port', 'Purdue', 'GPC', 'Newburgh', 'CO-OP', 'Bunge'],
  haulers: ['Todd', 'Denie', 'Jeremy', 'Jared', 'Zac', 'Eli'],
  bins: [
    'Joe Gray 30 ft',
    'House 42 ft',
    'House Front 24ft',
    'House Back 24ft',
    "30ft ft By Jared's",
    "18ft By Jared's",
    "42 ft By Jared's",
    "Shivers Bin by Jared's",
    "27 ft On Hill By Jared's",
    'Buchta Front 24 ft',
    'Buchta Back 24 ft',
    'Field',
    'Fall out of Bin',
    'House 48 ft'
  ]
};

const duplicateTicketNumbers = new Set();
let dropdownCache = {
  expiresAt: 0,
  data: null
};

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '2mb' }));

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

function normalizeTicketData(data) {
  const clean = blankTicket();

  for (const field of ticketFields) {
    clean[field] = cleanSpaces(data?.[field]);
  }

  clean.crop = normalizeCrop(clean.crop);
  clean.bushels = normalizeDecimal(clean.bushels);
  clean.moisture = normalizeDecimal(clean.moisture);
  clean.delivered_to = titleCase(clean.delivered_to);
  clean.hauled_by = titleCase(clean.hauled_by);
  clean.hauled_from = titleCase(clean.hauled_from);

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

function getGoogleAuth() {
  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  if (serviceAccountKeyFile) {
    return new google.auth.GoogleAuth({
      keyFile: serviceAccountKeyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE in environment.');
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

  const sheets = getSheetsClient();
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
    await appendTicketToSheet(ticket);

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
      message: 'Ticket submitted successfully',
      ticket
    });
  } catch (error) {
    logError('Google Sheets submit failed', error);
    res.status(500).json({
      error: 'Could not save ticket data to Google Sheets.',
      detail: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Grain Ticket Scanner API running on port ${port}`);
});
