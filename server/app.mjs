import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { analyze, DEFAULT_TEMPLATE, dayKey, shiftDay, renderEmail } from './domain.mjs';
import { connectionConfig, createBillbeeClient } from './billbee.mjs';
import { createWarehouseTicket, ensureWarehouseState, installWarehouseRoutes, ticketHistory } from './warehouse.mjs';
import { createEmailDelivery } from './email.mjs';
import { createSmtpSender } from './smtp.mjs';
import { installMailRoutes, assertNoEmailInFlight } from './mail-service.mjs';

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function str(value, label, max = 300, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label}: bitte einen gültigen Text eingeben.`);
  return value.trim();
}
function numeric(value, label, min = 0, max = 1000000, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${label}: gültiger Bereich ${min}–${max}${integer ? ' (ganze Zahlen)' : ''}.`);
  return value;
}
function oneLine(value, label, required = false) { const s = str(value, label, 300, required); if (/[\r\n]/.test(s)) fail(`${label} darf keine Zeilenumbrüche enthalten.`); return s; }
function supplierInput(body) {
  const value = {
    name: oneLine(body.name, 'Name', true), contact: str(body.contact || '', 'Kontakt'), email: oneLine(body.email || '', 'E-Mail'),
    method: body.method, leadDays: numeric(body.leadDays, 'Lieferzeit', 0, 365, true), minValue: numeric(body.minValue, 'Mindestbestellwert'),
    portalUrl: str(body.portalUrl || '', 'Portal-URL', 2000), customerNumber: oneLine(body.customerNumber || '', 'Kundennummer'),
    emailTemplate: str(body.emailTemplate || '', 'E-Mail-Vorlage', 12000), subjectTemplate: oneLine(body.subjectTemplate || '', 'Betreff'), color: 'sage',
  };
  if (!['email', 'portal', 'manual'].includes(value.method)) fail('Ungültiger Bestellweg.');
  if (value.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)) fail('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (value.method === 'email' && !value.email) fail('Für E-Mail-Bestellungen ist eine Empfängeradresse erforderlich.');
  if (value.portalUrl) { try { if (new URL(value.portalUrl).protocol !== 'https:') fail('Portal-URL muss mit https:// beginnen.'); } catch { fail('Bitte eine gültige HTTPS-Portal-URL eingeben.'); } }
  value.notes = str(body.notes || '', 'Lieferantenhinweise', 6000);
  value.phone = oneLine(body.phone || '', 'Telefon');
  value.requiresQuote = body.requiresQuote === true;
  value.leadTimeEstimated = body.leadTimeEstimated === true;
  if (body.routes !== undefined) {
    if (!Array.isArray(body.routes) || body.routes.length > 50) fail('Ungültige Bestellwege.');
    const ids = new Set();
    value.routes = body.routes.map(r => {
      const id = oneLine(r.id, 'Bestellweg-ID', true); if (ids.has(id)) fail('Doppelter Bestellweg.'); ids.add(id);
      const method = r.method; if (!['email', 'portal', 'manual'].includes(method)) fail('Ungültiger Bestellweg.');
      const email = oneLine(r.email || '', 'Empfänger');
      if (method === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail('Ein E-Mail-Bestellweg benötigt eine gültige Empfängeradresse.');
      const portalUrl = str(r.portalUrl || '', 'Portal-URL', 2000);
      if (portalUrl) { try { if (new URL(portalUrl).protocol !== 'https:') fail('Portal-URL muss HTTPS verwenden.'); } catch { fail('Ungültige Portal-URL.'); } }
      return { id, label: oneLine(r.label, 'Bezeichnung', true), method, email, portalUrl, contact: oneLine(r.contact || '', 'Kontakt'), phone: oneLine(r.phone || '', 'Telefon'), requiresQuote: r.requiresQuote === true, instructions: str(r.instructions || '', 'Bestellhinweise', 6000) };
    });
    value.defaultRouteId = oneLine(body.defaultRouteId || '', 'Standard-Bestellweg');
    const primary = value.routes.find(r => r.id === value.defaultRouteId);
    if (value.routes.length && !primary) fail('Bitte einen gültigen Standard-Bestellweg auswählen.');
    if (primary) Object.assign(primary, { method: value.method, email: value.email, portalUrl: value.portalUrl, contact: value.contact, requiresQuote: value.requiresQuote });
  }
  return value;
}
function routeFor(supplier, routeId) {
  const route = supplier.routes?.find(r => r.id === routeId) || supplier.routes?.find(r => r.id === supplier.defaultRouteId);
  return route ? { ...supplier, ...route, supplierId: supplier.id, routeId: route.id } : { ...supplier, routeId: '' };
}
export function createApp({ store, env = process.env, clientFactory = createBillbeeClient, senderFactory = createSmtpSender }) {
  const app = express();
  const emailDelivery = createEmailDelivery(env);
  const sender = senderFactory(env);
  const pendingEmails = new Set();
  app.disable('x-powered-by');
  const config = connectionConfig(env);
  if (Boolean(env.APP_USERNAME) !== Boolean(env.APP_PASSWORD)) throw new Error('APP_USERNAME und APP_PASSWORD müssen gemeinsam gesetzt werden.');
  const status = { running: false, progress: '', progressData: null, error: null, startedAt: null };
  const scope = config.mode;
  store.mutate(scope, state => ensureWarehouseState(state));
  let stopped = false;
  let syncTask = Promise.resolve();
  async function synchronize() {
    if (stopped || status.running) return syncTask;
    if (scope !== 'live') return;
    status.running = true; status.error = null; status.progressData = null; status.progress = 'Verbindung wird hergestellt'; status.startedAt = new Date().toISOString();
    syncTask = (async () => {
      try {
        const client = clientFactory({ env, progress: (text, detail) => { status.progress = text; status.progressData = detail || null; }, onCatalog: catalog => {
          store.mutate(scope, state => {
            // A complete snapshot stays visible during refresh. On the first import,
            // the catalog can be shown before the sales history is available.
            if (!state.snapshot || state.snapshot.complete === false) state.snapshot = catalog;
          });
        } });
        const snapshot = await client.sync();
        store.mutate(scope, state => { state.snapshot = snapshot; });
        status.progress = 'Synchronisierung abgeschlossen';
      } catch (error) { status.error = error.message; status.progress = ''; }
      finally { status.running = false; }
    })();
    return syncTask;
  }
  app.use((req, res, next) => {
    const hosts = new Set(['localhost', '127.0.0.1', '[::1]', env.HOST].filter(h => h && !['0.0.0.0', '::'].includes(h)));
    if (env.APP_ORIGIN) hosts.add(new URL(env.APP_ORIGIN).hostname);
    if (!hosts.has(req.hostname)) return res.status(403).send('Host nicht freigegeben. APP_ORIGIN in der .env setzen.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (env.APP_USERNAME && env.APP_PASSWORD) {
      const expected = Buffer.from(`${env.APP_USERNAME}:${env.APP_PASSWORD}`);
      const provided = /^Basic /i.test(req.headers.authorization || '') ? Buffer.from(req.headers.authorization.slice(6), 'base64') : Buffer.alloc(0);
      if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) return res.setHeader('WWW-Authenticate', 'Basic realm="Joliboard", charset="UTF-8"').status(401).send('Anmeldung erforderlich.');
    }
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Anfrage von einer anderen Website abgelehnt.' });
    const origin = req.headers.origin;
    const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`, env.APP_ORIGIN].filter(Boolean));
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'Ungültiger Ursprung.' });
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  const period = req => { const d = Number(req.query.days || 30); if (![7, 30, 90].includes(d)) fail('Zeitraum muss 7, 30 oder 90 Tage betragen.'); return d; };
  app.get('/api/dashboard', (req, res) => {
    const state = store.load(scope);
    const data = analyze(state, period(req));
    const syncedAt = state.snapshot?.syncedAt || null;
    const { results: _results, ...importSummary } = state.supplierImport || {};
    res.json({ ...data, suppliers: state.suppliers, orders: state.orders.map(emailDelivery.order), emailRouting: { debugRecipient: emailDelivery.debugRecipient, ...sender.status }, warehouseTickets: state.warehouseTickets || [], supplierImport: state.supplierImport ? importSummary : null, settings: state.settings, defaultTemplate: DEFAULT_TEMPLATE,
      connection: { ...config, ...status, dataReady: Boolean(state.snapshot && state.snapshot.complete !== false), catalogReady: Boolean(state.snapshot), syncedAt, stale: syncedAt ? Date.now() - Date.parse(syncedAt) > 86400000 : false, orderCount: state.snapshot?.orderCount || 0, snapshotEndDate: state.snapshot?.endDate || null } });
  });
  app.post('/api/sync', (_req, res) => {
    if (scope === 'demo') return res.json({ message: 'Demomodus: Beispieldaten sind aktiv.' });
    if (!config.configured) fail('Bitte zuerst die fehlenden Billbee-Zugangsdaten in .env ergänzen und den Server neu starten.');
    void synchronize();
    res.status(202).json({ message: 'Synchronisierung gestartet.', running: true });
  });
  app.put('/api/settings', (req, res) => {
    const settings = { safetyDays: numeric(req.body.safetyDays, 'Sicherheitspuffer', 0, 180, true), targetDays: numeric(req.body.targetDays, 'Zielreichweite', 1, 365, true), buyerName: oneLine(req.body.buyerName, 'Absender', true), note: str(req.body.note || '', 'Bestellhinweis', 3000) };
    store.mutate(scope, state => { state.settings = settings; });
    res.json(settings);
  });
  app.post('/api/suppliers', (req, res) => {
    const supplier = { ...supplierInput(req.body), id: randomUUID() };
    store.mutate(scope, state => { state.suppliers.push(supplier); });
    res.status(201).json(supplier);
  });
  app.put('/api/suppliers/:id', (req, res) => {
    const supplier = supplierInput(req.body);
    store.mutate(scope, state => {
      const i = state.suppliers.findIndex(s => s.id === req.params.id); if (i < 0) fail('Lieferant nicht gefunden.', 404);
      if (supplier.routes) {
        const routeIds = new Set(supplier.routes.map(r => r.id));
        if (Object.values(state.productConfig).some(c => c.supplierId === req.params.id && c.orderRouteId && !routeIds.has(c.orderRouteId))) fail('Ein Bestellweg wird noch von Produkten verwendet. Zuerst die Produktzuordnung ändern.');
        supplier.routes = supplier.routes.map(r => ({ ...state.suppliers[i].routes?.find(old => old.id === r.id), ...r }));
      }
      state.suppliers[i] = { ...state.suppliers[i], ...supplier, id: req.params.id };
    });
    res.json({ ...supplier, id: req.params.id });
  });
  app.delete('/api/suppliers/:id', (req, res) => {
    store.mutate(scope, state => {
      if (Object.values(state.productConfig).some(c => c.supplierId === req.params.id) || state.orders.some(o => o.supplierId === req.params.id)) fail('Lieferant wird von Produkten oder Bestellungen verwendet. Bitte zuerst die Zuordnungen entfernen.');
      if (!state.suppliers.some(s => s.id === req.params.id)) fail('Lieferant nicht gefunden.', 404);
      state.suppliers = state.suppliers.filter(s => s.id !== req.params.id);
    });
    res.json({ ok: true });
  });
  app.put('/api/products/:id', (req, res) => {
    const b = req.body;
    const value = { supplierId: str(b.supplierId || '', 'Lieferant'), supplierSku: oneLine(b.supplierSku || '', 'Lieferantenartikelnummer'), minStock: numeric(b.minStock, 'Mindestbestand'), moq: numeric(b.moq, 'Mindestmenge', 1, 1000000, true), packSize: numeric(b.packSize, 'Verpackungseinheit', 1, 1000000, true), cost: b.cost === null ? null : numeric(b.cost, 'Einkaufspreis') };
    store.mutate(scope, state => {
      if (!state.snapshot?.products.some(p => p.id === req.params.id)) fail('Produkt nicht gefunden.', 404);
      if (value.supplierId && !state.suppliers.some(s => s.id === value.supplierId)) fail('Lieferant nicht gefunden.');
      const supplier = state.suppliers.find(s => s.id === value.supplierId);
      const orderRouteId = str(b.orderRouteId || '', 'Bestellweg');
      if (orderRouteId && !supplier?.routes?.some(r => r.id === orderRouteId)) fail('Dieser Bestellweg gehört nicht zum gewählten Lieferanten.');
      state.productConfig[req.params.id] = { ...state.productConfig[req.params.id], ...value, orderRouteId, matching: { status: 'manual', reason: 'Manuell im Produkt ausgewählt.' } };
    });
    res.json(value);
  });
  app.post('/api/orders', (req, res) => {
    const days = period(req);
    const requestId = str(req.body.requestId, 'Anfrage-ID', 100, true);
    if (!Array.isArray(req.body.productIds) || !req.body.productIds.length || req.body.productIds.length > 5000 || req.body.productIds.some(x => typeof x !== 'string')) fail('Bitte mindestens ein Produkt auswählen (maximal 5.000).');
    const created = store.mutate(scope, state => {
      if (!state.snapshot || state.snapshot.complete === false) fail('Die Verkaufsdaten werden noch geladen. Bestellvorschläge sind nach dem vollständigen Import verfügbar.', 409);
      const existing = state.orders.filter(o => o.requestId === requestId);
      if (existing.length) return existing;
      const analysis = analyze(state, days);
      const products = [...new Set(req.body.productIds)].map(id => analysis.products.find(p => p.id === id));
      if (products.some(p => !p)) fail('Ein ausgewählter Artikel ist nicht mehr verfügbar. Bitte die Ansicht aktualisieren.', 409);
      if (products.some(p => !p.supplierId)) fail('Bitte zuerst jedem ausgewählten Artikel einen Lieferanten zuordnen.', 409);
      if (products.some(p => p.suggested <= 0)) fail('Für mindestens einen ausgewählten Artikel besteht aktuell kein zusätzlicher Bestellbedarf. Bereits vorhandene Entwürfe und offene Bestellungen sind berücksichtigt. Prüfe diese unter „Bestellungen“ oder passe die Artikelplanung an.', 409);
      const groups = new Map();
      for (const p of products) { const key = `${p.supplierId}|${p.orderRouteId}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
      const orders = [];
      for (const list of groups.values()) {
        const supplierId = list[0].supplierId;
        const supplier = state.suppliers.find(s => s.id === supplierId);
        const route = routeFor(supplier, list[0].orderRouteId);
        const serial = state.orders.length + orders.length + 1;
        const order = { id: randomUUID(), reference: `JB-${dayKey().replaceAll('-', '')}-${String(serial).padStart(3, '0')}`, requestId, supplierId, supplierName: supplier.name, orderRouteId: route.routeId, recipient: route.email, method: route.method, portalUrl: route.portalUrl, customerNumber: supplier.customerNumber, intent: route.requiresQuote ? 'quote' : 'order', instructions: route.instructions || supplier.notes || '', routeLabel: route.label || '', phone: route.phone || supplier.phone || '', contact: route.contact || '', status: 'draft', createdAt: new Date().toISOString(), expectedAt: shiftDay(dayKey(), supplier.leadDays),
          items: list.map(p => ({ productId: p.id, name: p.name, sku: p.sku, supplierSku: p.supplierSku || '', quantity: p.suggested, cost: p.cost, packSize: p.packSize, moq: p.moq })),
        };
        Object.assign(order, renderEmail(route, order, state.settings));
        orders.push(order);
      }
      state.orders.unshift(...orders);
      return orders;
    });
    res.status(201).json(created.map(emailDelivery.order));
  });
  app.put('/api/orders/:id', (req, res) => {
    const result = store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order) fail('Bestellung nicht gefunden.', 404);
      assertNoEmailInFlight(order);
      if (order.status !== 'draft') fail('Nur Entwürfe können bearbeitet werden.', 409);
      order.subject = oneLine(req.body.subject, 'Betreff', true);
      order.body = str(req.body.body, 'Nachricht', 30000, true);
      order.externalReference = oneLine(req.body.externalReference || '', 'Lieferanten-Bestellnummer');
      const supplier = state.suppliers.find(s => s.id === order.supplierId);
      if (req.body.orderRouteId !== undefined) {
        const routeId = str(req.body.orderRouteId || '', 'Bestellweg');
        if (routeId && !supplier.routes?.some(r => r.id === routeId)) fail('Bestellweg nicht gefunden.');
        const route = routeFor(supplier, routeId);
        Object.assign(order, { orderRouteId: route.routeId, method: route.method, recipient: route.email, portalUrl: route.portalUrl, instructions: route.instructions || '', phone: route.phone || '', routeLabel: route.label || '', intent: route.requiresQuote && !order.quoteAccepted ? 'quote' : 'order' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.expectedAt || '') || !Number.isFinite(Date.parse(req.body.expectedAt)) || new Date(req.body.expectedAt).toISOString().slice(0, 10) !== req.body.expectedAt) fail('Ungültiges Lieferdatum.');
      order.expectedAt = req.body.expectedAt;
      if (req.body.items !== undefined) {
        if (!Array.isArray(req.body.items) || req.body.items.length !== order.items.length) fail('Ungültige Bestellpositionen.');
        const seen = new Set();
        for (const item of req.body.items) {
          const line = order.items.find(i => i.productId === item.productId);
          if (!line || seen.has(item.productId)) fail('Ungültige oder doppelte Position.');
          seen.add(item.productId);
          const q = numeric(item.quantity, 'Bestellmenge', line.moq, 1000000, true);
          if (q % line.packSize !== 0) fail(`Die Menge für ${line.name} muss ein Vielfaches von ${line.packSize} sein.`);
          line.quantity = q;
          if (item.cost !== undefined) line.cost = item.cost === null ? null : numeric(item.cost, 'Einkaufspreis');
        }
      }
      if (req.body.regenerate === true) Object.assign(order, renderEmail(routeFor(supplier, order.orderRouteId), order, state.settings));
      return order;
    });
    res.json(emailDelivery.order(result));
  });
  app.post('/api/orders/:id/status', (req, res) => {
    store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order) fail('Bestellung nicht gefunden.', 404);
      assertNoEmailInFlight(order);
      if (order.status === 'ordered' && req.body.status === 'ordered') { createWarehouseTicket(state, order); return; }
      const allowed = { draft: ['ordered', 'requested', 'cancelled'], requested: ['cancelled'], ordered: ['cancelled'], issue: [], completed: [], cancelled: [] };
      if (!allowed[order.status]?.includes(req.body.status)) fail('Dieser Statuswechsel ist nicht möglich.', 409);
      if (req.body.status === 'ordered' && order.intent === 'quote') fail('Dies ist eine Angebotsanfrage. Zuerst das Angebot übernehmen und eine Bestellung vorbereiten.', 409);
      if (req.body.status === 'requested' && order.intent !== 'quote') fail('Nur Angebotsanfragen können als angefragt markiert werden.');
      const ticket = state.warehouseTickets?.find(t => t.orderId === order.id);
      if (req.body.status === 'cancelled' && ticket?.items.some(i => i.receivedQuantity > 0)) fail('Es wurden bereits Mengen geliefert. Bitte Fehlmengen im Lager an den Einkauf zurückgeben und dort die Restmengen klären.', 409);
      if (req.body.status === 'cancelled' && ticket) { ticket.status = 'cancelled'; ticketHistory(ticket, 'Bestellung storniert'); }
      order.status = req.body.status;
      if (order.status === 'ordered') { order.orderedAt = new Date().toISOString(); order.externalReference = oneLine(req.body.externalReference || order.externalReference || '', 'Lieferanten-Bestellnummer'); createWarehouseTicket(state, order); }
      order.updatedAt = new Date().toISOString();
    });
    res.json({ ok: true });
  });
  app.post('/api/orders/:id/prepare-order', (req, res) => {
    const result = store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order || order.status !== 'requested') fail('Diese Angebotsanfrage kann nicht in eine Bestellung umgewandelt werden.', 409);
      assertNoEmailInFlight(order);
      order.status = 'draft'; order.intent = 'order'; order.quoteAccepted = true;
      Object.assign(order, renderEmail(routeFor(state.suppliers.find(s => s.id === order.supplierId), order.orderRouteId), order, state.settings));
      return order;
    });
    res.json(emailDelivery.order(result));
  });
  app.put('/api/orders/:id/discrepancy-email', (req, res) => {
    const result = store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order || order.status !== 'issue' || !order.discrepancyEmail) fail('Für diese Bestellung liegt keine Fehlmengen-Nachricht vor.', 409);
      assertNoEmailInFlight(order);
      order.discrepancyEmail.subject = oneLine(req.body.subject, 'Betreff', true);
      order.discrepancyEmail.body = str(req.body.body, 'Nachricht', 30000, true);
      return order;
    });
    res.json(emailDelivery.order(result));
  });
  app.get('/api/orders/:id/email', (req, res) => {
    const order = store.load(scope).orders.find(o => o.id === req.params.id);
    if (!order) fail('Bestellung nicht gefunden.', 404);
    const kind = req.query.kind || 'order';
    if (!['order', 'discrepancy'].includes(kind)) fail('Unbekannter E-Mail-Typ.');
    if (kind === 'order' && order.method !== 'email') fail('Dieser Bestellweg sieht keine Bestell-E-Mail vor.', 409);
    const message = kind === 'discrepancy' ? order.discrepancyEmail : order;
    if (!message) fail('Für diese Bestellung liegt keine Fehlmengen-Nachricht vor.', 404);
    const filename = `${order.reference}${kind === 'discrepancy' ? '-fehlmenge' : ''}.eml`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    res.attachment(filename).set('Content-Type', 'message/rfc822').send(emailDelivery.draft(message));
  });
  installMailRoutes(app, { store, scope, emailDelivery, sender, fail, pending: pendingEmails });
  installWarehouseRoutes(app, { store, scope, fail, str, numeric, oneLine });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-Endpunkt nicht gefunden.' }));
  app.use((err, _req, res, _next) => {
    const code = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (code >= 500) console.error('Serverfehler:', err.name);
    res.status(code).json({ error: code >= 500 ? 'Ein Serverfehler ist aufgetreten. Bitte erneut versuchen.' : err.message });
  });
  let timer;
  const interval = Number(env.SYNC_INTERVAL_MINUTES ?? 60);
  if (!Number.isFinite(interval) || interval < 0 || interval > 1440) throw new Error('SYNC_INTERVAL_MINUTES muss zwischen 0 und 1440 liegen.');
  if (scope === 'live' && config.configured) {
    if (interval > 0) timer = setInterval(() => { void synchronize(); }, Math.max(1, interval) * 60000);
    // First sync only after server setup, and only when no recent cache exists.
    const snap = store.load(scope).snapshot;
    const needsDirectSales = snap?.products.some(p => p.bom?.length) && !Array.isArray(snap.directSales);
    if (!snap || snap.complete === false || needsDirectSales || Date.now() - Date.parse(snap.syncedAt) > 3600000) setImmediate(() => { if (!stopped) void synchronize(); });
  }
  return { app, status, synchronize, async stop() { stopped = true; clearInterval(timer); await syncTask; await Promise.allSettled([...pendingEmails]); } };
}
