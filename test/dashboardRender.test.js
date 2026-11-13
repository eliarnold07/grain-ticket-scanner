import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { buildGrainPosition } from '../server/grainPosition.js';

test('the app dashboard renders loading, error, empty and incomplete-data states', async () => {
  const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
  try {
    const { default: Dashboard, DashboardFeedback } = await vite.ssrLoadModule('/src/GrainPositionDashboard.jsx');
    const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
    assert.match(render(DashboardFeedback, { loading: true }), /role="status">Loading dashboard/);
    const failure = render(DashboardFeedback, { loading: true, failed: true });
    assert.match(failure, /role="alert"/);
    assert.match(failure, /Try again/);
    assert.doesNotMatch(failure, /Loading dashboard/);

    const empty = buildGrainPosition({ bins: [], contracts: [], tickets: [], transactions: [] });
    const emptyMarkup = render(Dashboard, { position: empty, formatNumber: String });
    for (const message of ['No bins recorded', 'No remaining deliveries', 'No tickets need payment review', 'No deliveries or bin changes']) {
      assert.ok(emptyMarkup.includes(message), message);
    }

    const incomplete = buildGrainPosition({ bins: [{ crop_type: 'Corn', current_bushels: 100, estimated_capacity_bushels: 200 }],
      contracts: [{ id: 'a', contract_id: 'A', commodity: 'Corn', status: 'Open', contracted_bushels: 22000, delivery_window: 'January 2027' }],
      tickets: [], transactions: [] });
    const markup = render(Dashboard, { position: incomplete, formatNumber: String });
    assert.match(markup, /Confirmed capacity needed/);
    assert.match(markup, /Delivery window: January 2027/);
    assert.match(markup, /0% delivered/);
    assert.match(markup, /22000 bu remaining/);
    assert.doesNotMatch(markup, /No deadline recorded|Overdue|Estimated outstanding/);
  } finally {
    await vite.close();
  }
});
