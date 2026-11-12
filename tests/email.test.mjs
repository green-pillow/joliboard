import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDelivery } from '../server/email.mjs';

test('debug drafts replace every recipient and keep original message data unchanged', () => {
  const delivery = createEmailDelivery({ EMAIL_DEBUG_RECIPIENT: 'debug@example.test' });
  const order = { recipient: 'supplier@example.test', subject: 'Bestellung', body: 'Artikel', discrepancyEmail: { recipient: 'support@example.test', subject: 'Fehlmenge', body: 'Bitte nachliefern' } };
  const presented = delivery.order(order);
  assert.equal(presented.recipient, 'debug@example.test');
  assert.equal(presented.originalRecipient, 'supplier@example.test');
  assert.equal(presented.discrepancyEmail.recipient, 'debug@example.test');
  assert.equal(presented.discrepancyEmail.originalRecipient, 'support@example.test');
  assert.equal(order.recipient, 'supplier@example.test');
  assert.equal(order.discrepancyEmail.recipient, 'support@example.test');
  assert.match(delivery.draft({ recipient: '', subject: 'Test', body: 'Artikel' }), /^To: debug@example.test\r\n/);
});

test('disabling debug restores original recipients and rejects header injection', () => {
  const delivery = createEmailDelivery({});
  const order = { recipient: 'supplier@example.test', subject: 'Bestellung', body: 'Artikel' };
  assert.equal(delivery.order(order).recipient, 'supplier@example.test');
  assert.match(delivery.draft(order), /^To: supplier@example.test\r\n/);
  assert.throws(() => delivery.draft({ ...order, recipient: '' }), { status: 409 });
  for (const value of ['invalid', 'a@example.test\r\nBcc: other@example.test', 'a@example.test,b@example.test', 'a,b@example.test']) {
    assert.throws(() => createEmailDelivery({ EMAIL_DEBUG_RECIPIENT: value }), /EMAIL_DEBUG_RECIPIENT/);
  }
});
