import { randomUUID } from 'node:crypto';
export const ticketHistory = (ticket, action, note = '') => {
  ticket.history.push({ id: randomUUID(), at: new Date().toISOString(), action, note });
  ticket.updatedAt = new Date().toISOString();
  ticket.revision++;
};
export function createWarehouseTicket(state, order) {
  state.warehouseTickets ||= [];
  const existing = state.warehouseTickets.find(t => t.orderId === order.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const ticket = { id: randomUUID(), reference: `LG-${order.reference.replace(/^JB-/, '')}`, orderId: order.id, orderReference: order.reference, supplierId: order.supplierId, supplierName: order.supplierName,
    expectedAt: order.expectedAt, status: 'open', revision: 1, createdAt: now, updatedAt: now, receiptUpdatedAt: null, reconciledAt: null, receiver: '', notes: '', returnReason: '',
    items: order.items.map(i => ({ productId: i.productId, name: i.name, sku: i.sku, supplierSku: i.supplierSku, expectedQuantity: i.quantity, receivedQuantity: 0, bookedQuantity: 0, cancelledQuantity: 0, checked: false, note: '' })),
    history: [{ id: randomUUID(), at: now, action: 'Bestellung aufgegeben – Lagerticket erstellt', note: order.reference }],
  };
  state.warehouseTickets.unshift(ticket);
  order.warehouseTicketId = ticket.id;
  return ticket;
}
export function ensureWarehouseState(state) {
  state.warehouseTickets ||= [];
  for (const order of state.orders) if (['ordered', 'issue'].includes(order.status)) createWarehouseTicket(state, order);
}
export function procurementSupply(state, asOf) {
  const reserved = new Map(), incoming = new Map(), unbooked = new Map(), arrivals = new Map();
  const add = (map, id, quantity) => map.set(id, (map.get(id) || 0) + quantity);
  const arrival = (id, quantity, expectedAt) => { if (quantity <= 0) return; if (!arrivals.has(id)) arrivals.set(id, []); arrivals.get(id).push({ quantity, expectedAt }); };
  for (const order of state.orders) {
    if (['draft', 'requested'].includes(order.status)) { for (const line of order.items) add(reserved, line.productId, line.quantity); continue; }
    if (!['ordered', 'issue', 'completed'].includes(order.status)) continue;
    const ticket = (state.warehouseTickets || []).find(t => t.orderId === order.id && t.status !== 'cancelled');
    for (const line of order.items) {
      const receipt = ticket?.items.find(i => i.productId === line.productId);
      const outstanding = receipt ? Math.max(0, line.quantity - receipt.receivedQuantity - (receipt.cancelledQuantity || 0)) : order.status === 'completed' ? 0 : line.quantity;
      const awaitingBooking = receipt ? Math.max(0, receipt.receivedQuantity - receipt.bookedQuantity) : 0;
      add(reserved, line.productId, outstanding + awaitingBooking);
      add(incoming, line.productId, outstanding);
      add(unbooked, line.productId, awaitingBooking);
      arrival(line.productId, outstanding, order.expectedAt);
      arrival(line.productId, awaitingBooking, asOf);
    }
  }
  return { reserved, incoming, unbooked, arrivals };
}
export function discrepancyEmail(order, ticket, settings) {
  const missing = ticket.items.filter(i => i.receivedQuantity < i.expectedQuantity).map(i => `- ${i.name} (${i.supplierSku || i.sku || i.productId}): bestellt ${i.expectedQuantity}, erhalten ${i.receivedQuantity}, fehlen ${i.expectedQuantity - i.receivedQuantity}.${i.note ? ` Hinweis: ${i.note}` : ''}`).join('\n');
  return { recipient: order.recipient || '', subject: `Fehlmengen zur Bestellung ${order.reference}`, body: `Guten Tag,\n\nbei unserer Bestellung ${order.reference}${order.externalReference ? ` (Ihre Referenz: ${order.externalReference})` : ''}${order.customerNumber ? `, Kundennummer ${order.customerNumber}` : ''} haben wir folgende Fehlmengen festgestellt:\n\n${missing}\n\n${ticket.returnReason}\n\nBitte prüfen Sie die Abweichung und bestätigen Sie eine Nachlieferung oder eine entsprechende Korrektur.\n\nVielen Dank und freundliche Grüße\n${settings.buyerName}` };
}
export function installWarehouseRoutes(app, { store, scope, fail, str, numeric, oneLine }) {
  const revision = (ticket, body) => { if (body.revision !== ticket.revision) fail('Das Lagerticket wurde zwischenzeitlich geändert. Bitte schließen, neu laden und erneut öffnen.', 409); };
  const find = (state, id) => { const t = state.warehouseTickets?.find(t => t.id === id); if (!t) fail('Lagerticket nicht gefunden.', 404); return t; };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  app.put('/api/warehouse/:id', (req, res) => {
    const result = store.mutate(scope, state => {
      const ticket = find(state, req.params.id); revision(ticket, req.body);
      if (!['open', 'checking'].includes(ticket.status)) fail('Nur offene Lagertickets können bearbeitet werden.', 409);
      if (!Array.isArray(req.body.items) || req.body.items.length !== ticket.items.length) fail('Bitte alle Positionen des Lagertickets übermitteln.');
      const seen = new Set(); let quantitiesChanged = false;
      for (const input of req.body.items) {
        const item = ticket.items.find(i => i.productId === input.productId);
        if (!item || seen.has(item.productId)) fail('Ungültige oder doppelte Ticketposition.');
        seen.add(item.productId);
        const quantity = numeric(input.receivedQuantity, 'Gelieferte Menge', item.bookedQuantity, 1000000, true);
        if (typeof input.checked !== 'boolean') fail('Prüfstatus fehlt.');
        quantitiesChanged ||= quantity !== item.receivedQuantity;
        item.receivedQuantity = quantity; item.checked = input.checked; item.note = str(input.note || '', 'Positionsnotiz', 2000);
      }
      ticket.notes = str(req.body.notes || '', 'Lagernotiz', 5000); ticket.receiver = oneLine(req.body.receiver || '', 'Geprüft von');
      ticket.status = 'checking';
      if (quantitiesChanged) ticket.receiptUpdatedAt = new Date().toISOString();
      ticketHistory(ticket, 'Wareneingang bearbeitet', `${ticket.items.filter(i => i.checked).length}/${ticket.items.length} Positionen geprüft`);
      return ticket;
    });
    res.json(result);
  });
  app.post('/api/warehouse/:id/action', (req, res) => {
    const result = store.mutate(scope, state => {
      const ticket = find(state, req.params.id); revision(ticket, req.body);
      const order = state.orders.find(o => o.id === ticket.orderId);
      if (!order) fail('Die zugehörige Bestellung fehlt.', 409);
      const command = req.body.command;
      if (command === 'reconcile') {
        if (ticket.status === 'cancelled' || req.body.billbeeConfirmed !== true) fail('Bitte die tatsächliche Bestandsbuchung in Billbee bestätigen.');
        if (!ticket.items.some(i => i.receivedQuantity > i.bookedQuantity)) fail('Es gibt keine neuen Mengen zum Abgleichen.');
        if (scope === 'live' && (!state.snapshot?.syncedAt || state.snapshot.complete === false || Date.parse(state.snapshot.syncedAt) <= Date.parse(ticket.receiptUpdatedAt))) fail('Erfasste Mengen zuerst in Billbee buchen und danach synchronisieren. Anschließend den Abgleich hier bestätigen.', 409);
        ticket.items.forEach(i => { i.bookedQuantity = i.receivedQuantity; });
        ticket.reconciledAt = new Date().toISOString();
        ticketHistory(ticket, 'Wareneingang mit Billbee abgeglichen', state.snapshot?.syncedAt || 'Demomodus');
        return ticket;
      }
      if (!['open', 'checking'].includes(ticket.status)) fail('Dieses Ticket ist zurzeit nicht in der Lagerprüfung.', 409);
      if (!ticket.items.every(i => i.checked)) fail('Bitte zuerst alle Positionen prüfen und abhaken.');
      if (command === 'complete') {
        if (ticket.items.some(i => i.receivedQuantity < i.expectedQuantity)) fail('Bei Fehlmengen das Ticket an den Einkauf zurückgeben.');
        if (ticket.items.some(i => i.receivedQuantity > i.expectedQuantity && !i.note) && !ticket.notes) fail('Bitte die Mehrlieferung in einer Notiz erläutern.');
        ticket.status = 'completed'; ticket.completedAt = new Date().toISOString(); order.status = 'completed';
        ticketHistory(ticket, 'Lieferung vollständig geprüft und abgeschlossen');
      } else if (command === 'return') {
        if (!ticket.items.some(i => i.receivedQuantity < i.expectedQuantity)) fail('Es gibt keine Fehlmenge zum Zurückgeben.');
        ticket.returnReason = str(req.body.reason, 'Grund der Rückgabe', 5000, true);
        ticket.status = 'returned'; order.status = 'issue';
        ticketHistory(ticket, 'Mit Fehlmengen an den Einkauf zurückgegeben', ticket.returnReason);
        order.discrepancyEmail = discrepancyEmail(order, ticket, state.settings);
      } else fail('Unbekannte Ticketaktion.');
      order.updatedAt = new Date().toISOString();
      return ticket;
    });
    res.json(result);
  });
  app.post('/api/orders/:id/resolve', (req, res) => {
    const result = store.mutate(scope, state => {
      const order = state.orders.find(o => o.id === req.params.id);
      if (!order || order.status !== 'issue') fail('Diese Bestellung wartet nicht auf eine Klärung.', 409);
      const ticket = find(state, order.warehouseTicketId); revision(ticket, req.body);
      const reason = str(req.body.reason, 'Klärungsvermerk', 5000, true);
      if (req.body.resolution === 'redeliver') {
        if (!validDate(req.body.expectedAt)) fail('Bitte ein gültiges Datum für die Nachlieferung eingeben.');
        order.expectedAt = ticket.expectedAt = req.body.expectedAt;
        order.status = 'ordered'; ticket.status = 'open';
        ticket.items.forEach(i => { i.checked = i.receivedQuantity >= i.expectedQuantity; });
        ticketHistory(ticket, 'Nachlieferung vereinbart – zurück ins Lager', reason);
      } else if (req.body.resolution === 'cancel_remaining') {
        ticket.items.forEach(i => { i.cancelledQuantity = Math.max(0, i.expectedQuantity - i.receivedQuantity); });
        order.status = 'completed'; ticket.status = 'completed'; ticket.completedAt = new Date().toISOString();
        ticketHistory(ticket, 'Restmengen storniert / Fehlmengen abschließend geklärt', reason);
      } else fail('Bitte eine Klärungsart auswählen.');
      order.updatedAt = new Date().toISOString();
      return ticket;
    });
    res.json(result);
  });
}
