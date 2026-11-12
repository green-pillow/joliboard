import { replenishmentRisk } from './priority.mjs';
import { procurementSupply } from './warehouse.mjs';
export const DEFAULT_SETTINGS = { safetyDays: 7, targetDays: 30, buyerName: 'Unser Einkaufsteam', note: '' };
export const DEFAULT_TEMPLATE = 'Guten Tag {{supplierName}},\n\nwir möchten folgende Artikel bei Ihnen bestellen:\n\n{{items}}\n\nVoraussichtlicher Warenwert: {{total}} netto (zzgl. Versand).\nGewünschter Liefertermin: {{deliveryDate}}\nUnsere Referenz: {{reference}}\n\nBitte bestätigen Sie die Verfügbarkeit, den Liefertermin und den Gesamtpreis.\n{{note}}\nVielen Dank und freundliche Grüße\n{{buyerName}}';
export const number = (v, fallback = 0) => v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function shiftDay(day, amount) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function normalizeProducts(articles) {
  return articles.filter(a => !a.IsDigital && !a.IsDeactivated).map(a => ({
    id: String(a.Id), sku: a.SKU || '',
    name: (a.Title?.find(t => t.LanguageCode === 'de') || a.Title?.[0])?.Text || a.SKU || `Artikel ${a.Id}`,
    stock: Array.isArray(a.Stocks) && a.Stocks.length ? a.Stocks.reduce((s, x) => s + number(x.StockCurrent), 0) : number(a.StockCurrent),
    stockKnown: Array.isArray(a.Stocks) && a.Stocks.length ? a.Stocks.every(x => x.StockCurrent != null && Number.isFinite(Number(x.StockCurrent))) : a.StockCurrent != null && Number.isFinite(Number(a.StockCurrent)),
    warning: Math.max(0, number(a.StockWarning)), desired: Math.max(0, number(a.StockDesired)),
    cost: a.CostPriceNet != null ? Math.max(0, number(a.CostPriceNet)) : null,
    category: a.Category1?.Name || 'Sortiment',
    bom: (a.BillOfMaterial || []).map(x => ({ id: String(x.ArticleId), amount: number(x.Amount) })),
  }));
}
// Orders are reduced to product/day quantities; customer data is never persisted.
export function aggregateSales(orders, products, endDate, { explodeBundles = true } = {}) {
  const start = shiftDay(endDate, -90);
  const byId = new Map(products.map(p => [p.id, p]));
  const skuIds = new Map();
  for (const p of products) if (p.sku) skuIds.set(p.sku, skuIds.has(p.sku) ? null : p.id);
  const quantities = new Map();
  const seen = new Set();
  const add = (id, day, quantity, parents = new Set()) => {
    if (!id || !byId.has(id) || parents.has(id)) return;
    const p = byId.get(id);
    if (explodeBundles && p.bom?.length) {
      const next = new Set([...parents, id]);
      for (const part of p.bom) add(part.id, day, quantity * part.amount, next);
      return;
    }
    const key = `${id}|${day}`;
    quantities.set(key, (quantities.get(key) || 0) + quantity);
  };
  for (const o of orders) {
    const orderId = o.BillBeeOrderId ?? o.Id;
    if (orderId != null && seen.has(String(orderId))) continue;
    if (orderId != null) seen.add(String(orderId));
    // Billbee: 8 = cancelled; 17 = returned. Cancellation documents are excluded.
    if ([6, 8, 14, 17].includes(number(o.State)) || o.IsCancelationFor) continue;
    // Billbee dates without an offset are treated as German local wall-clock dates.
    const day = o.CreatedAt && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(o.CreatedAt)
      ? o.CreatedAt.slice(0, 10) : dayKey(o.CreatedAt);
    if (!day || day < start || day >= endDate) continue;
    for (const item of o.OrderItems || []) {
      if (item.IsCoupon || item.Product?.IsDigital || number(item.Quantity) <= 0) continue;
      const rawId = item.Product?.BillbeeId;
      const id = rawId != null && byId.has(String(rawId)) ? String(rawId) : skuIds.get(item.Product?.SKU);
      add(id, day, number(item.Quantity));
    }
  }
  return [...quantities].map(([key, quantity]) => { const [productId, day] = key.split('|'); return { productId, day, quantity }; });
}
export function analyze(state, days = 30) {
  const snapshot = state.snapshot;
  if (!snapshot) return { products: [], trend: [], salesReady: false, stats: { products: 0, critical: 0, reorder: 0, dailySales: 0, unitsSold: 0, priorityProducts: 0, atRiskUnits: 0, purchaseValue: 0, unknownCost: 0 }, from: null, until: null };
  const end = snapshot.endDate;
  const start = shiftDay(end, -days);
  const totals = new Map();
  const directSales = snapshot.directSales ?? (snapshot.products.some(p => p.bom?.length) ? null : snapshot.sales);
  const salesReady = snapshot.complete !== false && directSales !== null;
  const soldTotals = new Map();
  const daily = new Map(Array.from({ length: days }, (_, i) => [shiftDay(start, i), 0]));
  for (const sale of snapshot.sales) if (sale.day >= start && sale.day < end) {
    totals.set(sale.productId, (totals.get(sale.productId) || 0) + sale.quantity);
  }
  for (const sale of directSales || []) if (sale.day >= start && sale.day < end) {
    soldTotals.set(sale.productId, (soldTotals.get(sale.productId) || 0) + sale.quantity);
    daily.set(sale.day, (daily.get(sale.day) || 0) + sale.quantity);
  }
  const { reserved: committed, incoming, arrivals, unbooked } = procurementSupply(state, end);
  const products = snapshot.products.map(p => {
    const config = state.productConfig[p.id] || {};
    const supplier = state.suppliers.find(s => s.id === config.supplierId);
    const leadDays = supplier?.leadDays ?? 7;
    const avg = (totals.get(p.id) || 0) / days;
    const coverage = avg > 0 ? Math.max(0, p.stock) / avg : null;
    const threshold = Math.max(config.minStock ?? p.warning, avg * (leadDays + state.settings.safetyDays));
    const target = Math.max(p.desired || 0, threshold, avg * (leadDays + state.settings.safetyDays + state.settings.targetDays));
    const pending = committed.get(p.id) || 0;
    const netStock = p.stock + pending;
    const need = snapshot.complete !== false && p.stockKnown !== false && !p.bom?.length && netStock <= threshold && target > netStock;
    const raw = need ? Math.max(0, target - netStock) : 0;
    const packSize = config.packSize || 1;
    const suggested = raw > 0 ? Math.ceil(Math.max(raw, config.moq || 1) / packSize) * packSize : 0;
    const status = p.stockKnown === false ? 'unknown' : p.bom?.length ? 'bundle' : p.stock <= 0 || (coverage != null && coverage <= leadDays) ? 'critical' : p.stock <= threshold ? 'low' : 'healthy';
    const priority = { ...replenishmentRisk({ stock: p.stock, stockKnown: p.stockKnown !== false, avg, leadDays, safetyDays: state.settings.safetyDays, arrivals: arrivals.get(p.id) || [], asOf: end, complete: snapshot.complete !== false, bundle: Boolean(p.bom?.length) }), assumedLeadTime: !supplier || supplier.leadTimeEstimated === true };
    const route = supplier?.routes?.find(r => r.id === config.orderRouteId) || supplier?.routes?.find(r => r.id === supplier.defaultRouteId);
    return { ...p, ...config, supplierId: supplier?.id || '', supplierName: supplier?.name || 'Nicht zugeordnet', orderRouteId: route?.id || '', orderIntent: route?.requiresQuote ? 'quote' : 'order', leadDays, avg, sold: salesReady ? soldTotals.get(p.id) || 0 : null, salesAvg: salesReady ? (soldTotals.get(p.id) || 0) / days : null, priority, coverage, threshold, target, incoming: incoming.get(p.id) || 0, receivedUnbooked: unbooked.get(p.id) || 0, committed: pending, suggested, status, cost: config.cost ?? p.cost, packSize, moq: config.moq || 1, minStock: config.minStock ?? p.warning };
  });
  products.sort((a, b) => ({ critical: 0, low: 1, unknown: 2, healthy: 3, bundle: 4 }[a.status] - { critical: 0, low: 1, unknown: 2, healthy: 3, bundle: 4 }[b.status]) || (a.coverage ?? Infinity) - (b.coverage ?? Infinity) || a.name.localeCompare(b.name, 'de'));
  const unitsSold = [...soldTotals.values()].reduce((a, b) => a + b, 0);
  return { products, salesReady, trend: salesReady ? [...daily].map(([day, quantity]) => ({ day, quantity })) : [], from: start, until: shiftDay(end, -1), stats: {
    products: products.length, critical: products.filter(p => p.status === 'critical').length,
    reorder: products.filter(p => p.suggested > 0).length, dailySales: unitsSold / days, unitsSold,
    priorityProducts: products.filter(p => p.priority.atRiskUnits > 0).length, atRiskUnits: products.reduce((sum, p) => sum + (p.priority.atRiskUnits || 0), 0),
    purchaseValue: products.reduce((sum, p) => sum + p.suggested * (p.cost || 0), 0), unknownCost: products.filter(p => p.suggested && p.cost == null).length,
  } };
}
export function renderEmail(supplier, order, settings) {
  const money = v => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
  const values = {
    supplierName: supplier.name, reference: order.reference, buyerName: settings.buyerName, customerNumber: order.customerNumber || 'nicht hinterlegt',
    deliveryDate: new Intl.DateTimeFormat('de-DE').format(new Date(`${order.expectedAt}T12:00:00Z`)), note: settings.note,
    total: order.items.some(i => i.cost == null) ? 'Preisbestätigung erbeten' : money(order.items.reduce((s, i) => s + i.quantity * i.cost, 0)),
    items: order.items.map(i => `• ${i.quantity} × ${i.name}\n  Artikelnummer: ${i.supplierSku || i.sku || 'bitte zuordnen'}${i.cost == null ? ' · Preis bitte bestätigen' : ` · ${money(i.cost)} netto/Stück`}`).join('\n'),
  };
  const fill = template => template.replace(/\{\{(\w+)\}\}/g, (match, key) => values[key] ?? match);
  if (order.intent === 'quote') return { subject: fill('Angebotsanfrage {{reference}} · {{buyerName}}'), body: fill('Guten Tag {{supplierName}},\n\nbitte erstellen Sie uns ein Angebot für folgende Artikel:\n\n{{items}}\n\nGewünschter Liefertermin: {{deliveryDate}}\nUnsere Referenz: {{reference}}\nKundennummer: {{customerNumber}}\n\nBitte nennen Sie Einkaufspreise, verfügbare Mengen, Lieferzeit, Versandkosten und eventuelle Mindestbestellmengen. Dies ist eine unverbindliche Angebotsanfrage.\n{{note}}\nVielen Dank und freundliche Grüße\n{{buyerName}}') };
  return { subject: fill(supplier.subjectTemplate || 'Bestellung {{reference}} · {{buyerName}}'), body: fill(supplier.emailTemplate || DEFAULT_TEMPLATE.replace('Unsere Referenz: {{reference}}', 'Unsere Referenz: {{reference}}\nKundennummer: {{customerNumber}}')) };
}
