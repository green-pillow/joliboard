import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { emptyState } from '../server/demo.mjs';
import { dayKey, shiftDay } from '../server/domain.mjs';
import { procurementSupply } from '../server/warehouse.mjs';
async function fixture(t, { quote = false, scope = 'demo', debugRecipient = '' } = {}) {
  let state = emptyState();
  const today = dayKey();
  const routes = [
    { id: 'direct', label: 'Direkt bestellen', method: 'email', email: 'orders@example.test', contact: 'Kontakt', portalUrl: '', requiresQuote: false, instructions: 'Direkter Einkauf' },
    { id: 'quote', label: 'Angebot', method: 'email', email: 'quotes@example.test', contact: 'Angebote', portalUrl: '', requiresQuote: true, instructions: 'Angebot einholen' },
  ];
  state.suppliers = [{ id: 'supplier', name: 'Testlieferant', method: 'email', email: 'orders@example.test', leadDays: 7, customerNumber: 'KD-100', routes, defaultRouteId: 'direct' }];
  state.productConfig.p = { supplierId: 'supplier', orderRouteId: quote ? 'quote' : 'direct', moq: 1, packSize: 1 };
  state.snapshot = { products: [{ id: 'p', name: 'Testartikel', sku: 'SKU1', stock: 0, stockKnown: true, warning: 0, desired: 0, cost: 10, bom: [] }], sales: [{ productId: 'p', day: shiftDay(today, -1), quantity: 30 }], endDate: today, syncedAt: new Date().toISOString(), complete: true };
  const store = { load: () => structuredClone(state), mutate: (_scope, fn) => { const copy = structuredClone(state); const result = fn(copy); state = copy; return result; } };
  const runtime = createApp({ store, env: { DATA_MODE: scope, SYNC_INTERVAL_MINUTES: '0', EMAIL_DEBUG_RECIPIENT: debugRecipient } });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.stop(); server.close(); await once(server, 'close'); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, method = 'GET', body, status = 200) {
    const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  const [order] = await call('/orders', 'POST', { productIds: ['p'], requestId: 'fixture' }, 201);
  const dashboard = () => call('/dashboard');
  async function place() { await call(`/orders/${order.id}/status`, 'POST', { status: 'ordered', externalReference: 'SUP-123' }); return (await dashboard()).warehouseTickets[0]; }
  async function receive(ticket, quantity) { return call(`/warehouse/${ticket.id}`, 'PUT', { ...ticket, receiver: 'Lager', items: ticket.items.map(i => ({ ...i, receivedQuantity: quantity, checked: true, note: quantity < i.expectedQuantity ? 'Teilmenge erhalten' : '' })) }); }
  return { call, dashboard, order, place, receive, store, today, base };
}

test('debug routing covers persisted orders, all order responses, quotes and discrepancy downloads without changing supplier addresses', async t => {
  const f = await fixture(t, { quote: true, debugRecipient: 'debug@example.test' });
  assert.equal(f.order.recipient, 'debug@example.test');
  assert.equal(f.order.originalRecipient, 'quotes@example.test');
  assert.equal(f.store.load().orders[0].recipient, 'quotes@example.test');
  assert.equal((await f.dashboard()).emailRouting.debugRecipient, 'debug@example.test');
  async function checkDownload(kind = 'order') {
    const response = await fetch(`${f.base}/orders/${f.order.id}/email?kind=${kind}&recipient=ignored@example.test`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /message\/rfc822/);
    const mime = await response.text();
    const headers = mime.split('\r\n\r\n')[0];
    assert.match(headers, /^To: debug@example\.test\r\n/);
    assert.doesNotMatch(headers, /^(?:Cc|Bcc):/im);
    assert.doesNotMatch(headers, /quotes@example\.test|orders@example\.test|ignored@example\.test/);
  }
  await checkDownload();
  let updated = await f.call(`/orders/${f.order.id}`, 'PUT', { ...f.order, orderRouteId: 'direct', recipient: 'ignored@example.test', regenerate: true });
  assert.equal(updated.recipient, 'debug@example.test');
  assert.equal(updated.originalRecipient, 'orders@example.test');
  updated = await f.call(`/orders/${f.order.id}`, 'PUT', { ...updated, orderRouteId: 'quote', regenerate: true });
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'requested' });
  updated = await f.call(`/orders/${f.order.id}/prepare-order`, 'POST');
  assert.equal(updated.recipient, 'debug@example.test');
  await checkDownload();
  let ticket = await f.place();
  ticket = await f.receive(ticket, 0);
  await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'return', reason: 'Keine Lieferung erhalten.' });
  const issue = (await f.dashboard()).orders[0];
  assert.equal(issue.discrepancyEmail.recipient, 'debug@example.test');
  assert.equal(issue.discrepancyEmail.originalRecipient, 'quotes@example.test');
  updated = await f.call(`/orders/${f.order.id}/discrepancy-email`, 'PUT', { ...issue.discrepancyEmail, recipient: 'ignored@example.test', body: 'Nachricht aktualisiert' });
  assert.equal(updated.discrepancyEmail.recipient, 'debug@example.test');
  await checkDownload('discrepancy');
  assert.equal(f.store.load().orders[0].discrepancyEmail.recipient, 'quotes@example.test');
  assert.equal(f.store.load().suppliers[0].email, 'orders@example.test');
});
test('saving article planning, preparing an order and placing it are separate steps', async t => {
  const f = await fixture(t);
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'cancelled' });
  await f.call('/products/p', 'PUT', { supplierId: 'supplier', orderRouteId: 'direct', supplierSku: 'SUP-ARTICLE', minStock: 5, moq: 2, packSize: 2, cost: 12 });
  let d = await f.dashboard();
  assert.equal(d.orders.filter(o => o.status !== 'cancelled').length, 0);
  assert.equal(d.warehouseTickets.length, 0);
  const [draft] = await f.call('/orders', 'POST', { productIds: ['p'], requestId: 'saved-article-order' }, 201);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.items[0].supplierSku, 'SUP-ARTICLE');
  assert.equal(draft.items[0].cost, 12);
  assert.equal(draft.items[0].quantity % 2, 0);
  d = await f.dashboard();
  assert.equal(d.warehouseTickets.length, 0);
  await f.call(`/orders/${draft.id}/status`, 'POST', { status: 'ordered' });
  d = await f.dashboard();
  assert.equal(d.warehouseTickets.length, 1);
  assert.equal(d.warehouseTickets[0].orderId, draft.id);
});

test('placing an order creates exactly one warehouse ticket, even when retried', async t => {
  const f = await fixture(t); const ticket = await f.place();
  assert.equal(ticket.orderId, f.order.id); assert.equal(ticket.items[0].expectedQuantity, f.order.items[0].quantity);
  await f.place(); const d = await f.dashboard();
  assert.equal(d.warehouseTickets.length, 1); assert.equal(d.orders[0].externalReference, 'SUP-123');
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'completed' }, 409);
});
test('short delivery returns to purchasing, retains quantities, and reopens the same ticket for redelivery', async t => {
  const f = await fixture(t); let ticket = await f.place(); const expected = ticket.items[0].expectedQuantity;
  ticket = await f.receive(ticket, expected - 2);
  await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'complete' }, 400);
  ticket = await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'return', reason: 'Zwei Stück fehlen. Nachlieferung klären.' });
  let d = await f.dashboard();
  assert.equal(ticket.status, 'returned'); assert.equal(d.orders[0].status, 'issue');
  assert.match(d.orders[0].discrepancyEmail.body, /fehlen 2/); assert.match(d.orders[0].discrepancyEmail.body, /SUP-123/);
  const supply = procurementSupply(f.store.load(), f.today);
  assert.equal(supply.incoming.get('p'), 2); assert.equal(supply.unbooked.get('p'), expected - 2); assert.equal(supply.reserved.get('p'), expected);
  const oldRevision = ticket.revision;
  ticket = await f.call(`/orders/${f.order.id}/resolve`, 'POST', { revision: ticket.revision, resolution: 'redeliver', expectedAt: shiftDay(f.today, 3), reason: 'Lieferant schickt die fehlenden zwei Stück.' });
  assert.equal(ticket.items[0].receivedQuantity, expected - 2); assert.equal(ticket.items[0].checked, false); assert.equal(ticket.status, 'open');
  await f.call(`/warehouse/${ticket.id}`, 'PUT', { ...ticket, revision: oldRevision }, 409);
  ticket = await f.receive(ticket, expected);
  ticket = await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'complete' });
  d = await f.dashboard(); assert.equal(d.orders[0].status, 'completed'); assert.equal(d.warehouseTickets.length, 1);
  assert.equal(procurementSupply(f.store.load(), f.today).incoming.get('p'), 0);
  assert.equal(procurementSupply(f.store.load(), f.today).unbooked.get('p'), expected);
  await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'reconcile', billbeeConfirmed: true });
  assert.equal(procurementSupply(f.store.load(), f.today).reserved.get('p'), 0);
});
test('stock reconciliation requires a fresh Billbee sync and explicit confirmation in live mode', async t => {
  const f = await fixture(t, { scope: 'live' }); let ticket = await f.place(); ticket = await f.receive(ticket, 5);
  await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'reconcile', billbeeConfirmed: true }, 409);
  f.store.mutate('live', state => { state.snapshot.syncedAt = new Date(Date.now() + 1000).toISOString(); state.snapshot.products[0].stock = 5; });
  await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'reconcile', billbeeConfirmed: false }, 400);
  ticket = await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'reconcile', billbeeConfirmed: true });
  assert.equal(ticket.items[0].bookedQuantity, 5);
  await f.call(`/warehouse/${ticket.id}`, 'PUT', { ...ticket, items: ticket.items.map(i => ({ ...i, receivedQuantity: 4 })) }, 400);
});
test('cancelling a shortage frees the remaining units without losing the received quantity', async t => {
  const f = await fixture(t); let ticket = await f.place(); ticket = await f.receive(ticket, 3);
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'cancelled' }, 409);
  ticket = await f.call(`/warehouse/${ticket.id}/action`, 'POST', { revision: ticket.revision, command: 'return', reason: 'Nur drei Stück geliefert.' });
  ticket = await f.call(`/orders/${f.order.id}/resolve`, 'POST', { revision: ticket.revision, resolution: 'cancel_remaining', reason: 'Lieferant stellt eine Gutschrift aus.' });
  assert.equal(ticket.status, 'completed'); assert.equal(ticket.items[0].receivedQuantity, 3);
  assert.equal(ticket.items[0].cancelledQuantity, f.order.items[0].quantity - 3);
  assert.equal(procurementSupply(f.store.load(), f.today).incoming.get('p'), 0);
  assert.equal(procurementSupply(f.store.load(), f.today).reserved.get('p'), 3);
});
test('an offer inquiry cannot create a warehouse ticket before it becomes a real order', async t => {
  const f = await fixture(t, { quote: true });
  assert.equal(f.order.recipient, 'quotes@example.test'); assert.equal(f.order.intent, 'quote'); assert.match(f.order.subject, /Angebotsanfrage/);
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'ordered' }, 409);
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'requested' });
  assert.equal((await f.dashboard()).warehouseTickets.length, 0);
  const prepared = await f.call(`/orders/${f.order.id}/prepare-order`, 'POST');
  assert.equal(prepared.intent, 'order'); assert.match(prepared.subject, /^Bestellung/);
  await f.place(); assert.equal((await f.dashboard()).warehouseTickets.length, 1);
});
test('products using different order channels at the same supplier produce separate drafts', async t => {
  const f = await fixture(t);
  await f.call(`/orders/${f.order.id}/status`, 'POST', { status: 'cancelled' });
  f.store.mutate('demo', state => {
    state.snapshot.products.push({ ...state.snapshot.products[0], id: 'q', sku: 'SKU2' });
    state.snapshot.sales.push({ ...state.snapshot.sales[0], productId: 'q' });
    state.productConfig.q = { supplierId: 'supplier', orderRouteId: 'quote', moq: 1, packSize: 1 };
  });
  const orders = await f.call('/orders', 'POST', { productIds: ['p', 'q'], requestId: 'two-routes' }, 201);
  assert.equal(orders.length, 2);
  assert.equal(orders.find(o => o.intent === 'order').recipient, 'orders@example.test');
  assert.equal(orders.find(o => o.intent === 'quote').recipient, 'quotes@example.test');
  const retry = await f.call('/orders', 'POST', { productIds: ['p', 'q'], requestId: 'two-routes' }, 201);
  assert.deepEqual(retry.map(o => o.id), orders.map(o => o.id));
});
test('used supplier routes cannot be deleted and source metadata survives supplier editing', async t => {
  const f = await fixture(t);
  f.store.mutate('demo', state => { state.suppliers[0].routes[0].sourceFiles = ['orderdata/example.md']; });
  const input = { ...f.store.load().suppliers[0], contact: 'Kontakt', minValue: 0, portalUrl: '', emailTemplate: '', subjectTemplate: '' };
  await f.call('/suppliers/supplier', 'PUT', { ...input, routes: input.routes.filter(r => r.id !== 'direct'), defaultRouteId: 'quote' }, 400);
  await f.call('/suppliers/supplier', 'PUT', input);
  assert.deepEqual(f.store.load().suppliers[0].routes[0].sourceFiles, ['orderdata/example.md']);
  assert.equal(f.store.load().suppliers[0].routes[1].requiresQuote, true);
});
