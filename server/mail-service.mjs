import { createHash, randomUUID } from 'node:crypto';
import { createWarehouseTicket } from './warehouse.mjs';

export function assertNoEmailInFlight(order) {
  if (order.emailDeliveries?.some(d => d.status === 'sending')) throw Object.assign(new Error('Diese Bestellung wird gerade per E-Mail versendet. Bitte den Versand abwarten.'), { status: 409 });
}
function uncertain(error) {
  if (error.responseCode >= 400 || ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONFIG'].includes(error.code)) return false;
  return !['CONN', 'AUTH', 'EHLO', 'STARTTLS', 'MAIL FROM', 'RCPT TO'].includes(error.command);
}
export function installMailRoutes(app, { store, scope, emailDelivery, sender, fail, pending }) {
  // An interrupted send is never retried automatically after a restart.
  store.mutate(scope, state => { for (const order of state.orders) for (const job of order.emailDeliveries || []) if (job.status === 'sending') { job.status = 'unknown'; job.error = 'Versand wurde unterbrochen. Bitte zuerst den Postausgang prüfen.'; } });
  function preview(order, kind) {
    if (!order) fail('Bestellung nicht gefunden.', 404);
    if (!['order', 'discrepancy'].includes(kind)) fail('Unbekannter E-Mail-Typ.');
    if (kind === 'order' && (order.method !== 'email' || order.status !== 'draft')) fail('Nur ein E-Mail-Bestellentwurf kann direkt versendet werden.', 409);
    if (kind === 'discrepancy' && (order.status !== 'issue' || !order.discrepancyEmail)) fail('Für diese Bestellung liegt keine offene Fehlmengen-Nachricht vor.', 409);
    const message = kind === 'order' ? order : order.discrepancyEmail;
    const recipient = emailDelivery.debugRecipient || message.recipient || '';
    if (!/^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(recipient)) fail('Bitte zuerst eine gültige Empfängeradresse hinterlegen.', 409);
    if (!message.subject?.trim() || !message.body?.trim()) fail('Betreff und Nachricht dürfen nicht leer sein.');
    const debug = Boolean(emailDelivery.debugRecipient);
    const fingerprint = createHash('sha256').update(JSON.stringify([kind, order.intent, sender.status.from, recipient, debug, message.subject, message.body, order.items, order.expectedAt])).digest('hex');
    const previous = (order.emailDeliveries || []).findLast(d => d.fingerprint === fingerprint && ['sending', 'accepted', 'unknown'].includes(d.status));
    return { kind, recipient, originalRecipient: message.recipient || '', from: sender.status.from, subject: message.subject, body: message.body, debug, fingerprint, previous: previous || null, intent: order.intent || 'order' };
  }
  app.post('/api/email/verify', async (_req, res) => {
    try { await sender.verify(); res.json({ ok: true }); }
    catch (e) { fail(e.status === 503 ? e.message : 'SMTP-Verbindung fehlgeschlagen. Bitte Server, Port und Zugangsdaten in .env prüfen.', e.status === 503 ? 503 : 502); }
  });
  app.get('/api/orders/:id/email-preview', (req, res) => res.json(preview(store.load(scope).orders.find(o => o.id === req.params.id), req.query.kind || 'order')));
  app.post('/api/orders/:id/send-email', async (req, res) => {
    if (!sender.status.configured) fail('Direktversand noch nicht eingerichtet. Bitte SMTP-Daten in .env hinterlegen und den Server neu starten.', 503);
    const kind = req.body.kind || 'order';
    const started = store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order) fail('Bestellung nicht gefunden.', 404);
      const accepted = order.emailDeliveries?.find(d => d.kind === kind && d.fingerprint === req.body.fingerprint && d.status === 'accepted');
      if (accepted) return { job: accepted, alreadySent: true };
      const message = preview(order, kind);
      if (message.fingerprint !== req.body.fingerprint) fail('Nachricht oder Empfänger wurden geändert. Bitte die Versandvorschau erneut öffnen.', 409);
      if (message.previous?.status === 'accepted') return { message, job: message.previous, alreadySent: true };
      assertNoEmailInFlight(order);
      if (message.previous?.status === 'unknown' && req.body.retryConfirmed !== true) fail('Versandstatus unklar. Bitte den Postausgang prüfen, bevor du erneut sendest.', 409);
      const id = randomUUID();
      const job = { id, kind, fingerprint: message.fingerprint, status: 'sending', recipient: message.recipient, originalRecipient: message.originalRecipient, from: message.from, debug: message.debug, subject: message.subject, startedAt: new Date().toISOString(), messageId: `<${id}@${sender.status.from.split('@')[1]}>` };
      (order.emailDeliveries ||= []).push(job);
      return { message, job };
    });
    if (started.alreadySent) return res.json({ delivery: started.job, alreadySent: true });
    let accepted = false;
    const task = (async () => {
      try {
        const info = await sender.send({ ...started.message, messageId: started.job.messageId });
        accepted = true;
        return store.mutate(scope, state => {
          const order = state.orders.find(o => o.id === req.params.id);
          const job = order.emailDeliveries.find(d => d.id === started.job.id);
          job.status = 'accepted'; job.sentAt = new Date().toISOString(); job.messageId = info.messageId;
          if (!job.debug && kind === 'order') {
            order.status = order.intent === 'quote' ? 'requested' : 'ordered'; order.updatedAt = job.sentAt;
            if (order.status === 'ordered') { order.orderedAt = job.sentAt; createWarehouseTicket(state, order); }
          }
          return job;
        });
      } catch (error) {
        const unknown = accepted || uncertain(error);
        store.mutate(scope, state => {
          const job = state.orders.find(o => o.id === req.params.id).emailDeliveries.find(d => d.id === started.job.id);
          job.status = unknown ? 'unknown' : 'failed'; job.error = unknown ? 'Versandstatus unklar. Bitte zuerst den Postausgang prüfen.' : 'Mailserver hat den Versand nicht angenommen. Bitte SMTP-Einstellungen und Empfänger prüfen.';
        });
        fail(unknown ? 'Versandstatus unklar. Bitte den Postausgang prüfen, bevor du erneut sendest.' : 'E-Mail konnte nicht gesendet werden. Bitte SMTP-Einstellungen und Empfänger prüfen.', 502);
      }
    })();
    pending.add(task);
    try { res.json({ delivery: await task }); } finally { pending.delete(task); }
  });
}
