import assert from 'node:assert/strict';
import test from 'node:test';
import { clickRowScopedView } from './readOnlySmokeGuard.mjs';

function fakeTab({ rows = 1, views = 1, safe = true } = {}) {
  let clicks = 0;
  let rowQuery;
  let actionQuery;
  const view = {
    count: async () => views,
    evaluate: async () => safe,
    click: async () => { clicks += 1; },
  };
  const row = {
    count: async () => rows,
    getByRole: (role, options) => { actionQuery = { role, options }; return view; },
  };
  return {
    playwright: { getByRole: (role, options) => { rowQuery = { role, options }; return row; } },
    clicks: () => clicks,
    queries: () => ({ rowQuery, actionQuery }),
  };
}

test('permits exactly one identity-scoped View target', async () => {
  const tab = fakeTab();
  await clickRowScopedView(tab, 'FC-260630-002');
  assert.equal(tab.clicks(), 1);
  assert.equal(tab.queries().rowQuery.role, 'row');
  assert.match('FC-260630-002 supplier', tab.queries().rowQuery.options.name);
  assert.equal(tab.queries().actionQuery.role, 'button');
  assert.deepEqual(tab.queries().actionQuery.options, { name: 'View', exact: true });
});

test('fails closed on ambiguous rows or buttons, unsafe hit tests, and mutations', async () => {
  for (const options of [{ rows: 0 }, { rows: 2 }, { views: 0 }, { views: 2 }, { safe: false }]) {
    const tab = fakeTab(options);
    await assert.rejects(clickRowScopedView(tab, 'FC-260630-002'));
    assert.equal(tab.clicks(), 0);
  }
  const tab = fakeTab();
  for (const action of ['Mark Confirmed', 'Edit', 'Delete', 'Approve']) {
    await assert.rejects(clickRowScopedView(tab, 'FC-260630-002', action));
  }
  await assert.rejects(clickRowScopedView(tab, ''));
  await assert.rejects(clickRowScopedView(tab, '   '));
  assert.equal(tab.clicks(), 0);
});
