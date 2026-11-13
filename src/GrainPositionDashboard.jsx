import React from 'react';
import { contractName } from './contractNames.js';
import './grainDashboard.css';

export function DashboardFeedback({ loading, failed, retry }) {
  if (failed) return <p role="alert">Could not refresh the dashboard. <button type="button" onClick={retry}>Try again</button></p>;
  return loading ? <p role="status">Loading dashboard…</p> : null;
}

function PanelHeading({ title, action, onClick }) {
  return <div className="grain-panel-heading">
    <h3>{title}</h3>
    {action && <button className="grain-link" type="button" onClick={onClick}>{action}</button>}
  </div>;
}

function ActivityRows({ recent, bushels }) {
  if (!recent.length) return <p className="grain-empty">No deliveries or bin changes recorded in the past 7 days.</p>;
  return <ul className="grain-list grain-timeline">
    {recent.map(item => <li key={`${item.kind}-${item.id}`}>
      <div>
        <strong>{item.kind} <span>·</span> {item.label}</strong>
        <small>{item.crop} · <time dateTime={item.recorded_at}>{new Date(item.recorded_at).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        })}</time></small>
      </div>
      <strong className="grain-row-value">{item.kind !== 'Delivery recorded' && item.bushels > 0 ? '+' : ''}{bushels(item.bushels)}</strong>
    </li>)}
  </ul>;
}

function formatPercent(value) {
  const options = value > 100 ? { maximumSignificantDigits: 9 } : { maximumFractionDigits: 1 };
  return new Intl.NumberFormat('en-US', options).format(value) + '%';
}

function StorageProgress({ storage, bushels }) {
  if (!storage) return null;
  const { covered, bins, percent, stored, capacity, aboveRecordedCapacity, balanceDiscrepancies } = storage;
  return <div className="grain-storage">
    <div><strong>{percent !== null && covered < bins ? 'Storage utilization · partial coverage' : 'Storage utilization'}</strong>
      <small>{percent === null ? (bins ? 'Confirmed capacity needed' : 'No bins recorded')
        : <>{bushels(stored)} in bins of {bushels(capacity)} confirmed capacity
          {covered < bins && <> · {covered} of {bins} bins</>}</>}</small>
    </div>
    {percent === null ? <span>Unavailable</span> : <div className="grain-storage-value">
      <strong>{formatPercent(percent)}</strong>
      <span className="grain-progress-track" aria-hidden="true"><span style={{ width: `${Math.min(percent, 100)}%` }} /></span>
    </div>}
    {aboveRecordedCapacity > 0 && <small className="grain-progress-issue">{aboveRecordedCapacity} {aboveRecordedCapacity === 1 ? 'bin exceeds its' : 'bins exceed their'} recorded capacity.</small>}
    {balanceDiscrepancies > 0 && <small className="grain-progress-issue">Crop totals use the balances shown in Bins. Review recorded balance and capacity for {balanceDiscrepancies} {balanceDiscrepancies === 1 ? 'bin' : 'bins'}.</small>}
  </div>;
}

function ContractProgressRows({ deliveries, bushels, formatNumber }) {
  if (!deliveries.length) return <p className="grain-empty">No remaining deliveries on open contracts.</p>;
  return <ul className="grain-list grain-progress-list">
    {deliveries.slice(0, 5).map(contract => <li key={contract.id}>
      <div>
        <strong>{contractName(contract)}</strong>
        <small>{[contract.buyer, contract.crop].filter(Boolean).join(' · ')}</small>
        {contract.display_name && <small>{contract.contract_id}</small>}
      </div>
      <div className="grain-fulfillment">
        {contract.percent == null ? <small>Fulfillment unavailable</small> : <>
          <strong>{formatPercent(contract.percent)} delivered</strong>
          <small>{formatNumber(contract.delivered)} of {bushels(contract.contracted)}</small>
          <span className="grain-progress-track" aria-hidden="true"><span style={{ width: `${Math.min(contract.percent, 100)}%` }} /></span>
        </>}
        {contract.issue && <small className="grain-progress-issue">{contract.issue}</small>}
      </div>
      <div className="grain-row-value">
        <strong>{contract.percent == null ? 'Check remaining balance' : `${bushels(contract.remaining)} remaining`}</strong>
        {contract.delivery_end_date && <small>Due <time dateTime={contract.delivery_end_date}>{new Intl.DateTimeFormat('en-US', {
          timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'
        }).format(new Date(contract.delivery_end_date))}</time></small>}
        {!contract.delivery_end_date && <small>{contract.delivery_window?.trim() ? `Delivery window: ${contract.delivery_window}` : 'No delivery date recorded'}</small>}
        {contract.deadline_status && <small className={contract.deadline_status === 'Overdue' ? 'grain-overdue' : undefined}>{contract.deadline_status}</small>}
      </div>
    </li>)}
  </ul>;
}

function RefinedInventory({ crops, formatNumber, bushels, openBins, storage }) {
  const scale = Math.max(0, ...crops.filter(crop => crop.remaining != null).flatMap(crop => [crop.stored, crop.remaining]));
  return <section className="grain-panel grain-inventory" aria-label="Grain in bins">
    <PanelHeading title="Grain in bins" action="Open Bins" onClick={openBins} />
    {crops.length ? <>
      <div className="grain-crops">
        {crops.map(crop => <article className="grain-crop" key={crop.crop}>
          <h4>{crop.crop}</h4>
          <p className="grain-quantity">{formatNumber(crop.stored)} <small>bu</small></p>
          <p className="grain-owed">{crop.remaining == null ? 'Open deliveries need review' : <><strong>{bushels(crop.remaining)}</strong> left to deliver</>}</p>
          {scale > 0 && crop.remaining != null && <div className="grain-comparison" aria-hidden="true">
            <span style={{ width: `${100 * crop.stored / scale}%` }} />
            <span style={{ width: `${100 * crop.remaining / scale}%` }} />
          </div>}
          {crop.coverage != null && <p className="grain-difference">{crop.coverage === 0 ? 'In bins equals open deliveries' : <>
            <strong>{bushels(Math.abs(crop.coverage))}</strong> {crop.coverage < 0 ? 'less' : 'more'} in bins
          </>}</p>}
        </article>)}
      </div>
      <div className="grain-inventory-note">
        <p className="grain-note">The difference compares recorded bin balances with open deliveries.</p>
        {scale > 0 && <p className="grain-key" aria-hidden="true">
          <span className="grain-key-stored">In bins</span><span className="grain-key-delivery">Left to deliver</span>
          <span>0–{formatNumber(scale)} bu</span>
        </p>}
      </div>
    </> : <p className="grain-empty">Add a bin or an open contract to see your grain position.</p>}
    <StorageProgress storage={storage} bushels={bushels} />
  </section>;
}

export default function GrainPositionDashboard({ position, formatNumber, openView, openPaymentReview, farmName }) {
  const { crops, obligations, payments, recent, storage } = position;
  const bushels = value => `${formatNumber(value)} bu`;
  return <div className="grain-dashboard">
    <div className="grain-header">
      <h2>{farmName}</h2>
      <div className="grain-actions">
        <button type="button" onClick={() => openView('scanner')}>Scan New Ticket</button>
        <button type="button" className="grain-secondary" onClick={() => openView('contracts')}>Contracts</button>
      </div>
    </div>
    <div className="grain-grid">
      <RefinedInventory crops={crops} formatNumber={formatNumber} bushels={bushels} openBins={() => openView('inventory')} storage={storage} />
      <section className="grain-panel grain-deliveries" aria-label="Open deliveries">
        <PanelHeading title="Open deliveries" action="Open Contracts" onClick={() => openView('contracts')} />
        <ContractProgressRows deliveries={obligations} bushels={bushels} formatNumber={formatNumber} />
        {obligations.length > 5 && <p className="grain-note">Showing 5 of {obligations.length} open contracts with deliveries or quantities to review.</p>}
        {obligations.slice(5).some(contract => contract.issue) && <p className="grain-progress-issue">Additional open contracts need a quantity review. Open Contracts to see them.</p>}
      </section>
      <section className="grain-panel grain-payments" aria-label="Payments to review">
        <PanelHeading title="Payments to review" action="Open History" onClick={openPaymentReview} />
        <dl className="grain-payment-count"><div><dt>Tickets to review</dt><dd>{formatNumber(payments.ticket_count)}</dd></div></dl>
        <p className="grain-note">{payments.ticket_count ? 'Marked Not paid or Partially paid.' : 'No tickets need payment review.'}</p>
      </section>
      <section className="grain-panel grain-activity" aria-label="Recent grain activity">
        <PanelHeading title="Recent grain activity" />
        <p className="grain-period">Last 7 days by record time</p>
        <ActivityRows recent={recent} bushels={bushels} />
      </section>
    </div>
  </div>;
}
