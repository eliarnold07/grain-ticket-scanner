function parseTicketDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const [, month, day, rawYear] = us;
    const year = rawYear.length === 2 ? Number(`20${rawYear}`) : Number(rawYear);
    return new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? null
    : new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

export function currentTicketArchiveCutoff(now = new Date()) {
  const month = now.getMonth();
  const year = now.getFullYear();
  const cutoffYear = month >= 8 ? year : year - 1;
  return new Date(Date.UTC(cutoffYear, 7, 31));
}

export function isArchivedTicket(ticket, now = new Date()) {
  const ticketDate = parseTicketDate(ticket?.date || ticket?.created_at);
  if (!ticketDate) return false;
  return ticketDate.getTime() <= currentTicketArchiveCutoff(now).getTime();
}

export function ticketArchiveCutoffLabel(now = new Date()) {
  const cutoff = currentTicketArchiveCutoff(now);
  return cutoff.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}
