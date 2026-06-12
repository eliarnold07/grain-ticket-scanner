import {
  getWeeklySummaryDelivery,
  getWeeklySummaryFarmData,
  listWeeklySummaryFarms,
  recordWeeklySummaryDelivery
} from './supabaseStore.js';
import {
  buildWeeklySummary,
  isWeeklySummarySendTime,
  renderWeeklySummaryEmail,
  weeklySummaryWindow,
  WEEKLY_SUMMARY_TIME_ZONE
} from './weeklySummary.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function uniqueAdminEmails(admins) {
  return [...new Set(admins
    .map((admin) => String(admin.email || '').trim().toLowerCase())
    .filter(Boolean))];
}

async function sendWithResend({ recipients, subject, html, idempotencyKey }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: recipients,
      subject,
      html
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Resend request failed (${response.status}).`);
  }
  return data;
}

export async function sendWeeklySummaries(now = new Date()) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error('Weekly summaries require RESEND_API_KEY and RESEND_FROM_EMAIL.');
  }

  const currentWindow = weeklySummaryWindow(now, WEEKLY_SUMMARY_TIME_ZONE);
  const periodEnd = currentWindow.periodStart;
  const previousWindow = weeklySummaryWindow(new Date(periodEnd.getTime() - 1), WEEKLY_SUMMARY_TIME_ZONE);
  const periodStart = previousWindow.periodStart;
  const farms = await listWeeklySummaryFarms();
  const results = [];

  for (const farm of farms) {
    const delivered = await getWeeklySummaryDelivery(farm.id, periodEnd);
    if (delivered) {
      results.push({ farmId: farm.id, status: 'already-recorded' });
      continue;
    }

    const data = await getWeeklySummaryFarmData(farm.id, periodStart, periodEnd);
    const summary = buildWeeklySummary({
      ...data,
      periodStart,
      periodEnd,
      timeZone: WEEKLY_SUMMARY_TIME_ZONE
    });
    const recipients = uniqueAdminEmails(data.admins);

    if (summary.activity_count === 0 || recipients.length === 0) {
      await recordWeeklySummaryDelivery({
        farm_id: farm.id,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        recipients,
        status: 'skipped',
        activity_count: summary.activity_count,
        sent_at: new Date().toISOString()
      });
      results.push({ farmId: farm.id, status: 'skipped' });
      continue;
    }

    const email = await sendWithResend({
      recipients,
      subject: `${farm.name} weekly grain summary`,
      html: renderWeeklySummaryEmail({
        farmName: farm.name,
        summary,
        appUrl: process.env.BINFLOW_APP_URL || ''
      }),
      idempotencyKey: `weekly-summary/${farm.id}/${periodEnd.toISOString()}`
    });
    await recordWeeklySummaryDelivery({
      farm_id: farm.id,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      recipients,
      status: 'sent',
      activity_count: summary.activity_count,
      provider_message_id: email.id || '',
      sent_at: new Date().toISOString()
    });
    results.push({ farmId: farm.id, status: 'sent', recipients: recipients.length });
  }

  return results;
}

export function startWeeklySummaryScheduler() {
  let running = false;

  async function check() {
    if (running || !isWeeklySummarySendTime(new Date(), WEEKLY_SUMMARY_TIME_ZONE)) return;
    running = true;
    try {
      const results = await sendWeeklySummaries();
      console.log('Weekly grain summary check completed', { results });
    } catch (error) {
      console.error('Weekly grain summary check failed', { message: error.message });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref();
  check();
  return timer;
}
