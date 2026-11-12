import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { emptyState } from '../server/demo.mjs';
const partial = { products: [{ id: 'new', name: 'Neuer Artikel', sku: 'NEW', stock: 10, stockKnown: true, cost: 2, warning: 5, desired: 50, bom: [] }], sales: [], endDate: '2026-11-09', syncedAt: null, source: 'billbee', complete: false, orderCount: 0 };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function memoryStore(snapshot = null) {
  let state = { ...emptyState(), snapshot };
  return { load: () => structuredClone(state), mutate: (_scope, fn) => { const copy = structuredClone(state); const result = fn(copy); state = copy; return result; } };
}
async function fixture(t, initialSnapshot = null) {
  const published = deferred(), finish = deferred();
  const store = memoryStore(initialSnapshot);
  const runtime = createApp({ store, env: { DATA_MODE: 'live', SYNC_INTERVAL_MINUTES: '0' }, clientFactory: ({ onCatalog, progress }) => ({ async sync() {
    onCatalog(partial);
    progress('Bestellungen werden geladen', { stage: 'orders', page: 1, totalPages: 3, loaded: 0, totalRows: 600 });
    published.resolve();
    await finish.promise;
    return { ...partial, complete: true, syncedAt: new Date().toISOString() };
  } }) });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { finish.resolve(); await runtime.stop(); server.close(); await once(server, 'close'); });
  const task = runtime.synchronize();
  await published.promise;
  return { base, finish, task };
}
test('first import exposes its catalog and progress while blocking incomplete purchasing', async t => {
  const { base, finish, task } = await fixture(t);
  const during = await (await fetch(`${base}/dashboard`)).json();
  assert.equal(during.products.length, 1);
  assert.equal(during.connection.catalogReady, true);
  assert.equal(during.connection.dataReady, false);
  assert.equal(during.connection.running, true);
  assert.equal(during.connection.progressData.totalRows, 600);
  assert.equal(during.products[0].suggested, 0);
  const order = await fetch(`${base}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'test', productIds: ['new'] }) });
  assert.equal(order.status, 409);
  finish.resolve(); await task;
  const after = await (await fetch(`${base}/dashboard`)).json();
  assert.equal(after.connection.dataReady, true);
  assert.equal(after.connection.running, false);
  assert.equal(after.connection.error, null);
});
test('refresh preserves the last complete snapshot until the new import is complete', async t => {
  const old = { ...partial, complete: true, syncedAt: '2026-11-08T12:00:00Z', products: [{ ...partial.products[0], id: 'old', name: 'Vorheriger Artikel' }] };
  const { base, finish, task } = await fixture(t, old);
  const during = await (await fetch(`${base}/dashboard`)).json();
  assert.equal(during.products[0].id, 'old');
  assert.equal(during.connection.dataReady, true);
  finish.resolve(); await task;
  const after = await (await fetch(`${base}/dashboard`)).json();
  assert.equal(after.products[0].id, 'new');
});
test('a failed refresh retains the complete dataset and supplier state while exposing its error', async t => {
  const old = { ...partial, complete: true, syncedAt: '2026-11-09T10:00:00Z', products: [{ ...partial.products[0], id: 'retained' }] };
  const store = memoryStore(old);
  store.mutate('live', state => { state.suppliers.push({ id: 'supplier', name: 'Bestehender Lieferant' }); });
  const runtime = createApp({ store, env: { DATA_MODE: 'live', SYNC_INTERVAL_MINUTES: '0' }, clientFactory: ({ onCatalog, progress }) => ({ async sync() {
    onCatalog(partial);
    progress('Bestellungen · Seite 21', { stage: 'orders', page: 21, completedPages: 20, loaded: 5000 });
    throw new Error('Die Verbindung zu Billbee ist auch nach 4 Versuchen unterbrochen.');
  } }) });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.stop(); server.close(); await once(server, 'close'); });
  await runtime.synchronize();
  const data = await (await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard`)).json();
  assert.equal(data.connection.running, false); assert.match(data.connection.error, /4 Versuchen/);
  assert.equal(data.connection.dataReady, true); assert.equal(data.connection.syncedAt, old.syncedAt);
  assert.equal(data.products[0].id, 'retained'); assert.equal(data.suppliers[0].id, 'supplier');
});
