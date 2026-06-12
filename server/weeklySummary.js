const WEEKLY_SUMMARY_TIME_ZONE = 'America/New_York';
const MANUAL_TRANSACTION_TYPES = new Set(['ADD_GRAIN', 'REMOVE_GRAIN', 'MANUAL_ADJUSTMENT']);

function numeric(value) {
  const number = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function localDateParts(date, timeZone = WEEKLY_SUMMARY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    weekday: 'short'
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function timeZoneOffsetMinutes(date, timeZone) {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset'
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
  const match = value.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(utcGuess - timeZoneOffsetMinutes(new Date(utcGuess), timeZone) * 60_000);
  result = new Date(utcGuess - timeZoneOffsetMinutes(result, timeZone) * 60_000);
  return result;
}

function shiftCalendarDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

export function weeklySummaryWindow(now = new Date(), timeZone = WEEKLY_SUMMARY_TIME_ZONE) {
  const parts = localDateParts(now, timeZone);
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  let startDate = shiftCalendarDate({
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  }, -weekdayIndex);
  let start = zonedDateTimeToUtc({ ...startDate, hour: 12 }, timeZone);

  if (now < start) {
    startDate = shiftCalendarDate(startDate, -7);
    start = zonedDateTimeToUtc({ ...startDate, hour: 12 }, timeZone);
  }

  const endDate = shiftCalendarDate(startDate, 7);
  const periodEnd = zonedDateTimeToUtc({ ...endDate, hour: 12 }, timeZone);

  return {
    timeZone,
    periodStart: start,
    periodEnd
  };
}

export function isWeeklySummarySendTime(now = new Date(), timeZone = WEEKLY_SUMMARY_TIME_ZONE) {
  const parts = localDateParts(now, timeZone);
  return parts.weekday === 'Sun' && Number(parts.hour) === 12;
}

function manualDelta(transaction) {
  const type = clean(transaction.transaction_type).toUpperCase();
  if (type === 'ADD_GRAIN') return numeric(transaction.bushel_amount);
  if (type === 'REMOVE_GRAIN') return -numeric(transaction.applied_bushel_amount ?? transaction.bushel_amount);
  if (type === 'MANUAL_ADJUSTMENT') {
    return numeric(transaction.new_bin_balance) - numeric(transaction.previous_bin_balance);
  }
  return 0;
}

function formatPeriodDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function buildWeeklySummary({
  tickets = [],
  transactions = [],
  bins = [],
  periodStart,
  periodEnd = new Date(),
  timeZone = WEEKLY_SUMMARY_TIME_ZONE
}) {
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const inPeriod = (row) => {
    const timestamp = new Date(row.created_at).getTime();
    return Number.isFinite(timestamp) && timestamp >= startMs && timestamp < endMs;
  };
  const weeklyTickets = tickets.filter(inPeriod);
  const weeklyAdjustments = transactions
    .filter(inPeriod)
    .filter((transaction) => MANUAL_TRANSACTION_TYPES.has(clean(transaction.transaction_type).toUpperCase()));
  const binNames = new Map(bins.map((bin) => [bin.id, bin.bin_name]));
  const cropTotals = new Map();

  for (const ticket of weeklyTickets) {
    const crop = clean(ticket.crop) || 'Unspecified';
    const current = cropTotals.get(crop) || { crop, ticket_bushels: 0, manual_net_bushels: 0 };
    current.ticket_bushels += numeric(ticket.bushels);
    cropTotals.set(crop, current);
  }

  for (const transaction of weeklyAdjustments) {
    const crop = clean(transaction.crop_type) || 'Unspecified';
    const current = cropTotals.get(crop) || { crop, ticket_bushels: 0, manual_net_bushels: 0 };
    current.manual_net_bushels += manualDelta(transaction);
    cropTotals.set(crop, current);
  }

  const grainAdded = weeklyAdjustments
    .filter((transaction) => manualDelta(transaction) > 0)
    .reduce((sum, transaction) => sum + manualDelta(transaction), 0);
  const grainRemoved = weeklyAdjustments
    .filter((transaction) => manualDelta(transaction) < 0)
    .reduce((sum, transaction) => sum + Math.abs(manualDelta(transaction)), 0);

  return {
    time_zone: timeZone,
    period_start: new Date(periodStart).toISOString(),
    period_end: new Date(periodEnd).toISOString(),
    period_label: `${formatPeriodDate(new Date(periodStart), timeZone)} to ${formatPeriodDate(new Date(periodEnd), timeZone)}`,
    activity_count: weeklyTickets.length + weeklyAdjustments.length,
    ticket_count: weeklyTickets.length,
    ticket_bushels: weeklyTickets.reduce((sum, ticket) => sum + numeric(ticket.bushels), 0),
    manual_adjustment_count: weeklyAdjustments.length,
    grain_added_bushels: grainAdded,
    grain_removed_bushels: grainRemoved,
    manual_net_bushels: grainAdded - grainRemoved,
    by_crop: [...cropTotals.values()].sort((a, b) => a.crop.localeCompare(b.crop)),
    tickets: weeklyTickets.map((ticket) => ({
      id: ticket.id,
      ticket_number: clean(ticket.ticket_number),
      crop: clean(ticket.crop),
      bushels: numeric(ticket.bushels),
      hauled_from: clean(ticket.hauled_from),
      delivered_to: clean(ticket.delivered_to),
      hauled_by: clean(ticket.hauled_by),
      scanned_by_name: clean(ticket.scanned_by_name),
      created_at: ticket.created_at
    })),
    adjustments: weeklyAdjustments.map((transaction) => ({
      id: transaction.id,
      transaction_type: clean(transaction.transaction_type).toUpperCase(),
      crop_type: clean(transaction.crop_type),
      bin_name: clean(binNames.get(transaction.bin_id)) || 'Deleted bin',
      bushel_change: manualDelta(transaction),
      previous_bin_balance: numeric(transaction.previous_bin_balance),
      new_bin_balance: numeric(transaction.new_bin_balance),
      notes: clean(transaction.notes),
      created_at: transaction.created_at
    }))
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  return numeric(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function emailTime(value, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export function renderWeeklySummaryEmail({ farmName, summary, appUrl = '' }) {
  const ticketRows = summary.tickets.map((ticket) => `
    <tr>
      <td>${escapeHtml(ticket.ticket_number || 'No number')}</td>
      <td>${escapeHtml(ticket.crop || 'Unspecified')}</td>
      <td>${formatNumber(ticket.bushels)} bu</td>
      <td>${escapeHtml(ticket.hauled_from || '-')} to ${escapeHtml(ticket.delivered_to || '-')}</td>
      <td>${escapeHtml(ticket.hauled_by || '-')}</td>
      <td>${escapeHtml(emailTime(ticket.created_at, summary.time_zone))}</td>
    </tr>`).join('');
  const adjustmentRows = summary.adjustments.map((adjustment) => `
    <tr>
      <td>${escapeHtml(adjustment.transaction_type.replaceAll('_', ' '))}</td>
      <td>${escapeHtml(adjustment.bin_name)}</td>
      <td>${escapeHtml(adjustment.crop_type || 'Unspecified')}</td>
      <td>${adjustment.bushel_change >= 0 ? '+' : ''}${formatNumber(adjustment.bushel_change)} bu</td>
      <td>${formatNumber(adjustment.previous_bin_balance)} to ${formatNumber(adjustment.new_bin_balance)} bu</td>
      <td>${escapeHtml(emailTime(adjustment.created_at, summary.time_zone))}</td>
    </tr>`).join('');

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f4f1e8;color:#263229;font-family:Arial,sans-serif;">
      <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
        <div style="background:#265d3a;color:#fff;padding:24px;border-radius:10px 10px 0 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">BinFlow Weekly Grain Summary</p>
          <h1 style="margin:0;font-size:26px;">${escapeHtml(farmName)}</h1>
          <p style="margin:8px 0 0;color:#e4efe6;">${escapeHtml(summary.period_label)} Eastern</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #ddd7c8;border-top:0;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:12px;background:#f7faf5;"><strong>${formatNumber(summary.ticket_bushels)}</strong><br><span style="color:#647065;">ticket bushels</span></td>
              <td style="padding:12px;background:#f7faf5;"><strong>${summary.ticket_count}</strong><br><span style="color:#647065;">tickets</span></td>
              <td style="padding:12px;background:#f7faf5;"><strong>+${formatNumber(summary.grain_added_bushels)}</strong><br><span style="color:#647065;">manually added</span></td>
              <td style="padding:12px;background:#f7faf5;"><strong>-${formatNumber(summary.grain_removed_bushels)}</strong><br><span style="color:#647065;">manually removed</span></td>
            </tr>
          </table>
          ${summary.tickets.length ? `
            <h2 style="font-size:18px;">Ticket History Activity</h2>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead><tr><th align="left">Ticket</th><th align="left">Crop</th><th align="left">Bushels</th><th align="left">Movement</th><th align="left">Driver</th><th align="left">Entered</th></tr></thead>
              <tbody>${ticketRows}</tbody>
            </table>` : ''}
          ${summary.adjustments.length ? `
            <h2 style="margin-top:26px;font-size:18px;">Manual Bin Adjustments</h2>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead><tr><th align="left">Type</th><th align="left">Bin</th><th align="left">Crop</th><th align="left">Change</th><th align="left">Balance</th><th align="left">Entered</th></tr></thead>
              <tbody>${adjustmentRows}</tbody>
            </table>` : ''}
          ${appUrl ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:11px 16px;border-radius:7px;background:#265d3a;color:#fff;text-decoration:none;font-weight:700;">Open BinFlow</a></p>` : ''}
        </div>
      </div>
    </body>
  </html>`;
}

export { WEEKLY_SUMMARY_TIME_ZONE };
