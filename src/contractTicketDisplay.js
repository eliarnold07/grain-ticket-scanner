const RECENT_TICKET_LIMIT = 5;

export function contractTicketDisplay(tickets, showAll) {
  const count = tickets.length;
  return {
    count,
    rows: showAll ? tickets : tickets.slice(0, RECENT_TICKET_LIMIT),
    toggleLabel: count > RECENT_TICKET_LIMIT
      ? (showAll ? 'Show Fewer' : `Show All Tickets (${count})`)
      : null
  };
}

export function contractTicketButtonLabel(open, count) {
  if (open) return 'Hide Tickets';
  return Number.isInteger(count) ? `View Tickets (${count})` : 'View Tickets';
}
