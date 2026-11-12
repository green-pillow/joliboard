import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { emptyState } from '../server/demo.mjs';
import { createSmtpSender } from '../server/smtp.mjs';

async function fixture(t, { debug = true, quote = false, configured = true, send = async () => ({ messageId: 'test-message' }) } = {}) {
  let state = emptyState();
  state.orders = [{ id: 'o', reference: 'JB-TEST', supplierId: 's', supplierName: 'Lieferant', method: 'email', recipient: 'supplier@example.test', status: 'draft', intent: quote ? 'quote' : 'order', subject: 'Testbestellung', body: '4 Testartikel', expectedAt: '2026-11-20', items: [{ productId: 'p', name: 'Testartikel', sku: 'SKU', quantity: 4, packSize: 1, moq: 1, cost: 10 }] }];
  const store = { load: () => structuredClone(state), mutate: (_scope, fn) => { const next = structuredClone(state); const result = fn(next); state = next; return result; } };
  const calls = [];
  const runtime = createApp({ store, env: { DATA_MODE: 'demo', SYNC_INTERVAL_MINUTES: '0', EMAIL_DEBUG_RECIPIENT: debug ? 'debug@example.test' : '' }, senderFactory: () => ({ status: { configured, missing: configured ? [] : ['EMAIL_FROM'], from: 'sender@example.test', fromName: 'Test' }, verify: async () => {}, send: async m => { calls.push(m); return send(m); } }) });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.stop(); server.close(); await once(server, 'close'); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, method = 'GET', body, status = 200) {
    const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  }
  const preview = () => call('/orders/o/email-preview');
  const sendEmail = (p, extra = {}, status = 200) => call('/orders/o/send-email', 'POST', { fingerprint: p.fingerprint, recipient: 'ignored@example.test', ...extra }, status);
  return { store, calls, preview, sendEmail, call };
}

for (const debug of [true, false]) for (const quote of [true, false]) test(`direct sending uses the enforced recipient and correct workflow (debug=${debug}, quote=${quote})`, async t => {
  const f = await fixture(t, { debug, quote });
  const p = await f.preview();
  await f.sendEmail(p);
  const order = f.store.load().orders[0];
  assert.equal(f.calls[0].recipient, debug ? 'debug@example.test' : 'supplier@example.test');
  assert.equal(order.recipient, 'supplier@example.test');
  assert.equal(order.status, debug ? 'draft' : quote ? 'requested' : 'ordered');
  assert.equal(f.store.load().warehouseTickets.length, !debug && !quote ? 1 : 0);
  assert.equal(order.emailDeliveries[0].status, 'accepted');
  assert.equal((await f.sendEmail(p)).alreadySent, true);
  assert.equal(f.calls.length, 1);
});

test('parallel clicks and edits cannot duplicate an in-flight message', async t => {
  let release, started;
  const pending = new Promise(r => { release = r; });
  const sending = new Promise(r => { started = r; });
  const f = await fixture(t, { send: async () => { started(); await pending; return { messageId: 'one' }; } });
  const p = await f.preview();
  const first = f.sendEmail(p); await sending;
  await f.sendEmail(p, {}, 409);
  await f.call('/orders/o/status', 'POST', { status: 'cancelled' }, 409);
  release(); await first;
  assert.equal(f.calls.length, 1);
});

test('a definitive rejection leaves the order unchanged and can be retried', async t => {
  let attempt = 0;
  const f = await fixture(t, { send: async () => { if (++attempt === 1) throw { code: 'EENVELOPE', responseCode: 550, message: 'private detail' }; return { messageId: 'ok' }; } });
  const p = await f.preview();
  const error = await f.sendEmail(p, {}, 502);
  assert.doesNotMatch(error.error, /private detail/);
  assert.equal(f.store.load().orders[0].emailDeliveries[0].status, 'failed');
  assert.equal(f.store.load().orders[0].status, 'draft');
  await f.sendEmail(p);
  assert.equal(f.calls.length, 2);
});

test('uncertain delivery requires an explicit postbox check before another send', async t => {
  let attempt = 0;
  const f = await fixture(t, { send: async () => { if (++attempt === 1) throw { code: 'ETIMEDOUT', command: 'DATA' }; return { messageId: 'ok' }; } });
  const p = await f.preview();
  await f.sendEmail(p, {}, 502);
  assert.equal(f.store.load().orders[0].emailDeliveries[0].status, 'unknown');
  await f.sendEmail(p, {}, 409);
  assert.equal(f.calls.length, 1);
  await f.sendEmail(p, { retryConfirmed: true });
  assert.equal(f.calls.length, 2);
});

test('missing configuration and stale previews never send messages', async t => {
  const missing = await fixture(t, { configured: false });
  await missing.sendEmail(await missing.preview(), {}, 503);
  assert.equal(missing.calls.length, 0);
  const f = await fixture(t);
  const p = await f.preview();
  f.store.mutate('demo', s => { s.orders[0].body = 'Changed message'; });
  await f.sendEmail(p, {}, 409);
  assert.equal(f.calls.length, 0);
});

test('SMTP uses encrypted transport and one explicit envelope recipient', async () => {
  let settings, message;
  const sender = createSmtpSender({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', SMTP_PASSWORD: 'secret', EMAIL_FROM: 'sender@example.test' }, options => { settings = options; return { sendMail: async m => { message = m; return { accepted: ['debug@example.test'], rejected: [], messageId: 'ok' }; } }; });
  await sender.send({ recipient: 'debug@example.test', subject: 'Test', body: 'Artikel', messageId: '<test@example.test>', debug: true });
  assert.equal(settings.requireTLS, true);
  assert.equal(settings.logger, false);
  assert.deepEqual(message.envelope.to, ['debug@example.test']);
  assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined);
  assert.equal(message.disableFileAccess, true);
});
