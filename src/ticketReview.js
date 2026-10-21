export const requiredTicketFields = Object.freeze(['date','crop','ticket_number','bushels','delivered_to','hauled_by','moisture','hauled_from']);
export function ticketBushels(value) {
  const result=Number(String(value ?? '').replace(/,/g,''));
  return Number.isFinite(result) ? result : 0;
}
export function missingTicketFields(ticket) {
  return requiredTicketFields.filter(field=>!String(ticket[field] ?? '').trim());
}
