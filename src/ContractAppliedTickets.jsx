import React, { useEffect, useId, useRef, useState } from 'react';
import { readJsonWithTimeout } from './network.js';
import { contractTicketButtonLabel, contractTicketDisplay } from './contractTicketDisplay.js';

export default function ContractAppliedTickets({ contract, apiFetch, formatNumber, onOpenTicket }) {
  const panelId = useId();
  const request = useRef(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const display = result && contractTicketDisplay(result.data.tickets, showAll);
  const count = result?.contract === contract ? display.count : contract.applied_ticket_count;

  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setFailed(false);
    setResult(null);
    setShowAll(false);
    try {
      const response = await apiFetch(`/api/contracts/${encodeURIComponent(contract.id)}/tickets`, { signal: controller.signal });
      if (!response.ok) throw new Error('Applied tickets unavailable');
      const data = await readJsonWithTimeout(response);
      if (!controller.signal.aborted) setResult({ data, contract });
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    }
  }

  function toggle() {
    if (open) request.current?.abort();
    else void load();
    setOpen(!open);
  }

  return (
    <div className="contract-applied-tickets">
      <button type="button" className="secondary-button applied-tickets-toggle" aria-expanded={open}
        aria-controls={panelId} onClick={toggle}>
        {contractTicketButtonLabel(open, count)}
      </button>
      <div id={panelId} hidden={!open}>
        {open && (failed ? (
          <div className="applied-ticket-state">
            <p role="alert">Could not load applied tickets.</p>
            <button type="button" className="secondary-button" onClick={load}>Try again</button>
          </div>
        ) : !result ? <p className="applied-ticket-state" role="status">Loading applied tickets…</p>
          : (
              <>
                <p className="applied-ticket-total">
                  <span>{display.count} {display.count === 1 ? 'ticket' : 'tickets'}</span>
                  <strong>{formatNumber(result.data.total_applied_bushels)} bu applied</strong>
                </p>
                {display.count === 0 ? (
                  <p className="applied-ticket-state">No tickets have been applied to this contract.</p>
                ) : (
                  <ul id={`${panelId}-list`} className="applied-ticket-list">
                    {display.rows.map(({ ticket, applied_bushels }) => (
                      <li key={ticket.id}>
                        <div>
                          <strong>{ticket.ticket_number?.trim() || 'Ticket number unavailable'}</strong>
                          <span>{ticket.date?.trim() || 'Delivery date unavailable'}</span>
                          {ticket.delivered_to?.trim() && <span>{ticket.delivered_to}</span>}
                        </div>
                        <div className="applied-ticket-actions">
                          <strong>{formatNumber(applied_bushels)} bu</strong>
                          <button type="button" className="secondary-button" onClick={() => onOpenTicket(ticket)}
                            aria-label={ticket.ticket_number ? `View ticket ${ticket.ticket_number}` : 'View ticket details'}>View ticket</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {display.toggleLabel && (
                  <button type="button" className="secondary-button applied-tickets-more"
                    aria-expanded={showAll} aria-controls={`${panelId}-list`}
                    onClick={() => setShowAll(current => !current)}>{display.toggleLabel}</button>
                )}
              </>
            ))}
      </div>
    </div>
  );
}
