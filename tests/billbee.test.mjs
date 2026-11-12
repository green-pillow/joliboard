import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillbeeClient } from '../server/billbee.mjs';
import { analyze, DEFAULT_SETTINGS } from '../server/domain.mjs';
const env = { BILLBEE_API_KEY: 'test-key', BILLBEE_USERNAME: 'test-user', BILLBEE_API_PASSWORD: 'test#password' };
const json = value => new Response(JSON.stringify(value), { status: 200 });

test('paginated import reports actual totals and publishes the catalog before fetching orders', async () => {
  const events = [];
  const details = [];
  let catalog;
  const client = createBillbeeClient({ env, wait: async () => {}, progress: (_text, detail) => details.push(structuredClone(detail)), onCatalog: value => { events.push('catalog'); catalog = value; }, fetcher: async (url, options) => {
    assert.equal(Buffer.from(options.headers.Authorization.slice(6), 'base64').toString(), 'test-user:test#password');
    const page = Number(url.searchParams.get('page'));
    if (url.pathname.endsWith('/products')) {
      events.push(`products-${page}`);
      return json({ Data: [{ Id: page, SKU: `SKU${page}`, StockCurrent: 10, Title: [{ Text: `Artikel ${page}`, LanguageCode: 'de' }] }], Paging: { Page: page, TotalPages: 2, TotalRows: 2 } });
    }
    events.push('orders');
    assert.equal(catalog.complete, false);
    assert.equal(catalog.products.length, 2);
    return json({ Data: [], Paging: { Page: 1, TotalPages: 1, TotalRows: 0 } });
  } });
  const snapshot = await client.sync();
  assert.deepEqual(events, ['products-1', 'products-2', 'catalog', 'orders']);
  assert.ok(details.some(d => d.stage === 'products' && d.page === 2 && d.totalPages === 2 && d.loaded === 2 && d.totalRows === 2));
  assert.ok(details.some(d => d.stage === 'orders' && d.totalRows === 0));
  assert.equal(snapshot.complete, true);
});

test('rate limits expose a pause and resume without losing page progress', async () => {
  let calls = 0;
  const details = [];
  const client = createBillbeeClient({ env, wait: async () => {}, progress: (_text, detail) => details.push(structuredClone(detail)), fetcher: async () => {
    if (calls++ === 0) return new Response('', { status: 429, headers: { 'Retry-After': '2' } });
    return json({ Data: [{ Id: 1 }], Paging: { TotalPages: 1, TotalRows: 1 } });
  } });
  await client.all('products');
  assert.ok(details.some(d => d.waitingUntil && d.page === 1));
  assert.equal(details.at(-1).waitingUntil, null);
  assert.equal(details.at(-1).loaded, 1);
  assert.equal(calls, 2);
});

test('a failed order import preserves the catalog callback but never returns a complete snapshot', async () => {
  let catalog;
  const client = createBillbeeClient({ env, wait: async () => {}, onCatalog: value => { catalog = value; }, fetcher: async url => url.pathname.endsWith('/products')
    ? json({ Data: [{ Id: 1, StockCurrent: 5 }], Paging: { TotalPages: 1 } })
    : new Response('', { status: 401 }) });
  await assert.rejects(client.sync(), /Anmeldung fehlgeschlagen/);
  assert.equal(catalog.complete, false);
  assert.equal(catalog.products.length, 1);
});

test('partial sales history cannot produce purchase recommendations', () => {
  const state = { snapshot: { complete: false, endDate: '2026-11-09', sales: [], products: [{ id: '1', name: 'Artikel', stock: 0, warning: 10, desired: 50, stockKnown: true, bom: [] }] }, settings: DEFAULT_SETTINGS, orders: [], suppliers: [], productConfig: {} };
  assert.equal(analyze(state).products[0].suggested, 0);
  state.snapshot.complete = true;
  assert.equal(analyze(state).products[0].suggested, 50);
});

test('a connection reset retries only the failed page and retains previously loaded records', async () => {
  const pages = []; const details = []; let failed = false;
  const client = createBillbeeClient({ env, wait: async () => {}, progress: (_text, detail) => details.push(structuredClone(detail)), fetcher: async url => {
    const page = Number(url.searchParams.get('page')); pages.push(page);
    if (page === 2 && !failed) { failed = true; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); }
    return json({ Data: [{ Id: page }], Paging: { TotalPages: 2, TotalRows: 2 } });
  } });
  assert.deepEqual((await client.all('orders')).map(r => r.Id), [1, 2]);
  assert.deepEqual(pages, [1, 2, 2]);
  assert.ok(details.some(d => d.page === 2 && d.loaded === 1 && d.retryReason === 'network' && d.retryAttempt === 2 && d.waitingUntil));
  assert.equal(details.at(-1).retryAttempt, 0);
});

test('a timeout during response body transfer retries the same request', async () => {
  let calls = 0;
  const client = createBillbeeClient({ env, wait: async () => {}, fetcher: async () => {
    if (calls++ === 0) return { status: 200, ok: true, json: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } };
    return json({ Data: [{ Id: 1 }], Paging: { TotalPages: 1, TotalRows: 1 } });
  } });
  assert.equal((await client.all('products')).length, 1); assert.equal(calls, 2);
});

test('a persistent network failure stops after four attempts and does not leak error details', async () => {
  let calls = 0;
  const client = createBillbeeClient({ env, wait: async () => {}, fetcher: async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET', message: 'PRIVATE_TOKEN' } }); } });
  await assert.rejects(client.all('products'), error => /nach 4 Versuchen/.test(error.message) && !error.message.includes('PRIVATE_TOKEN'));
  assert.equal(calls, 4);
});

test('authentication failures and malformed JSON are not retried as connection problems', async () => {
  for (const response of [() => new Response('', { status: 401 }), () => new Response('invalid JSON', { status: 200 })]) {
    let calls = 0;
    const client = createBillbeeClient({ env, wait: async () => {}, fetcher: async () => { calls++; return response(); } });
    await assert.rejects(client.all('products')); assert.equal(calls, 1);
  }
});
