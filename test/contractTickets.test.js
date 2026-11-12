import assert from 'node:assert/strict';
import test from 'node:test';
import { readContractTicketCounts, readContractTickets, summarizeContractTickets } from '../server/contractTickets.js';

const farm = '00000000-0000-4000-8000-000000000001';
const contract = '00000000-0000-4000-8000-000000000002';
const otherContract = '00000000-0000-4000-8000-000000000003';
const allocation = (bushels, contract_id = contract) => ({ type: 'CONTRACT', contract_id, bushels });

test('lists current allocations newest first, including old deliveries and split rows', () => {
  const rows = [
    { id: 'old', date: '7/15/2025', assignments: [allocation('1,000.25')] },
    { id: 'new', date: '2026-11-02', bushels: 90, assignments: [
      allocation(15), allocation(20), allocation(40, otherContract), { type: 'SPOT', bushels: 15 }
    ] },
    { id: 'no-date', assignments: [allocation('unknown')] },
    { id: 'spot', assignments: [{ type: 'SPOT', contract_id: contract, bushels: 700 }] },
    { id: 'reassigned', assignments: [allocation(55, otherContract)] },
    { id: 'incomplete', assignments: null }
  ];
  const result = summarizeContractTickets(rows, contract);
  assert.deepEqual(result.tickets.map(({ ticket, applied_bushels }) => [ticket.id, applied_bushels]),
    [['new', 35], ['old', 1000.25], ['no-date', 0]]);
  assert.equal(result.total_applied_bushels, 1035.25);
  assert.deepEqual(summarizeContractTickets([], contract), { tickets: [], total_applied_bushels: 0 });
  assert.equal(summarizeContractTickets(rows.filter(row => row.id !== 'old'), contract).total_applied_bushels, 35);
});

test('verifies farm ownership before reading and scopes every ticket page', async () => {
  let requests = 0;
  const matches = Array.from({ length: 511 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    assignments: [allocation(2)]
  }));
  async function read(path) {
    requests++;
    const url = new URL(path, 'http://localhost');
    const params = url.searchParams;
    assert.equal(params.get('farm_id'), `eq.${farm}`);
    if (url.pathname === '/contracts') {
      return params.get('id') === `eq.${contract}` ? [{ id: contract }] : [];
    }
    assert.equal(url.pathname, '/tickets');
    assert.deepEqual(JSON.parse(params.get('assignments').slice(3)), [{ type: 'CONTRACT', contract_id: contract }]);
    assert.equal(params.get('order'), 'id.asc');
    const after = params.get('and')?.slice('(id.gt.'.length, -1);
    // Simulate a PostgREST row limit below the requested page size.
    return matches.filter(ticket => !after || ticket.id > after).slice(0, 100);
  }
  const result = await readContractTickets(read, farm, contract);
  assert.equal(result.tickets.length, 511);
  assert.equal(result.total_applied_bushels, 1022);
  assert.equal(requests, 8);
  assert.equal(await readContractTickets(read, farm, otherContract), null);
  assert.equal(requests, 9);
  await assert.rejects(readContractTickets(read, farm, 'invalid'), { status: 400 });
  assert.equal(requests, 9);
});

test('counts each ticket once per assigned contract across farm-scoped pages', async () => {
  const firstId = '30000000-0000-4000-8000-000000000001';
  const secondId = '30000000-0000-4000-8000-000000000002';
  const pages = [
    [{ id: firstId, assignments: [allocation(2), allocation(3), allocation(4, otherContract)] }],
    [{ id: secondId, assignments: [allocation(1), { type: 'SPOT', contract_id: otherContract }] }],
    []
  ];
  const cursors = [null, `(id.gt.${firstId})`, `(id.gt.${secondId})`];
  let page = 0;
  const counts = await readContractTicketCounts(async path => {
    const { pathname, searchParams } = new URL(path, 'http://localhost');
    assert.equal(pathname, '/tickets');
    assert.equal(searchParams.get('select'), 'id,assignments');
    assert.equal(searchParams.get('farm_id'), `eq.${farm}`);
    assert.equal(searchParams.get('assignments'), 'cs.[{"type":"CONTRACT"}]');
    assert.equal(searchParams.get('and'), cursors[page]);
    return pages[page++];
  }, farm);
  assert.equal(page, 3);
  assert.deepEqual(counts, new Map([[contract, 2], [otherContract, 1]]));
});
