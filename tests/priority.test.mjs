import test from 'node:test';
import assert from 'node:assert/strict';
import { replenishmentRisk } from '../server/priority.mjs';
import { aggregateSales, analyze, DEFAULT_SETTINGS } from '../server/domain.mjs';
import { sortProducts } from '../src/product-sort.ts';
const base = { stock: 8, avg: 4, leadDays: 7, safetyDays: 7, asOf: '2026-11-09' };

test('priority measures uncovered demand and ranks a fast seller above an equally empty slow seller', () => {
  assert.equal(replenishmentRisk(base).atRiskUnits, 48);
  const fast = replenishmentRisk({ ...base, stock: 0, avg: 10 }).atRiskUnits;
  const slow = replenishmentRisk({ ...base, stock: 0, avg: .1 }).atRiskUnits;
  assert.ok(fast > slow);
  assert.equal(replenishmentRisk({ ...base, stock: 1000 }).atRiskUnits, 0);
  assert.equal(replenishmentRisk({ ...base, stock: 0, avg: 0 }).atRiskUnits, 0);
});
test('an arrival cannot erase an earlier stockout, but an on-time arrival can prevent it', () => {
  const late = replenishmentRisk({ ...base, arrivals: [{ expectedAt: '2026-11-16', quantity: 100 }] });
  assert.equal(late.atRiskUnits, 20);
  const onTime = replenishmentRisk({ ...base, arrivals: [{ expectedAt: '2026-11-11', quantity: 100 }] });
  assert.equal(onTime.atRiskUnits, 0);
});
test('overdue and post-horizon arrivals do not hide shortages', () => {
  const risk = replenishmentRisk({ ...base, arrivals: [{ expectedAt: '2026-11-08', quantity: 100 }, { expectedAt: '2026-11-23', quantity: 100 }] });
  assert.equal(risk.atRiskUnits, 48);
  assert.equal(risk.overdueIncoming, 100);
});
test('unknown stock, partial imports and bundles have no computed priority; negative stock is counted', () => {
  for (const options of [{ stockKnown: false }, { complete: false }, { bundle: true }]) assert.equal(replenishmentRisk({ ...base, ...options }).atRiskUnits, null);
  assert.equal(replenishmentRisk({ ...base, stock: -5, avg: 0 }).atRiskUnits, 5);
});
test('bestsellers count a set sale once while procurement expands its components', () => {
  const products = [{ id: 'set', sku: 'SET', name: 'Set', bom: [{ id: 'component', amount: 3 }], stock: 100, stockKnown: true, warning: 0 }, { id: 'component', sku: 'C', name: 'Komponente', bom: [], stock: 10, stockKnown: true, warning: 0 }];
  const orders = [
    { BillBeeOrderId: 1, State: 4, CreatedAt: '2026-11-08T12:00:00Z', OrderItems: [{ Product: { BillbeeId: 'set' }, Quantity: 10 }, { Product: { BillbeeId: 'component' }, Quantity: 2 }] },
    { BillBeeOrderId: 2, State: 8, CreatedAt: '2026-11-08T12:00:00Z', OrderItems: [{ Product: { BillbeeId: 'set' }, Quantity: 1000 }] },
  ];
  const directSales = aggregateSales(orders, products, '2026-11-09', { explodeBundles: false });
  const sales = aggregateSales(orders, products, '2026-11-09');
  assert.equal(directSales.find(s => s.productId === 'set').quantity, 10);
  assert.equal(directSales.find(s => s.productId === 'component').quantity, 2);
  assert.equal(sales.find(s => s.productId === 'component').quantity, 32);
  const state = { snapshot: { products, sales, directSales, endDate: '2026-11-09', complete: true }, settings: DEFAULT_SETTINGS, orders: [], suppliers: [], productConfig: {} };
  const result = analyze(state, 7);
  assert.equal(result.stats.unitsSold, 12);
  assert.equal(result.stats.dailySales, 12 / 7);
  assert.equal(result.salesReady, true);
  assert.equal(result.products.find(p => p.id === 'component').avg, 32 / 7);
  assert.equal(sortProducts(result.products, 'sales')[0].id, 'set');
  assert.equal(result.products.find(p => p.id === 'set').priority.atRiskUnits, null);
  const longerWindow = analyze(state, 30);
  assert.equal(longerWindow.products.find(p => p.id === 'set').sold, 10);
  assert.equal(longerWindow.products.find(p => p.id === 'set').salesAvg, 10 / 30);
  delete state.snapshot.directSales;
  const legacy = analyze(state);
  assert.equal(legacy.salesReady, false);
  assert.equal(legacy.products[0].sold, null);
});
test('drafts reserve procurement quantities but do not masquerade as confirmed inbound supply', () => {
  const snapshot = { endDate: '2026-11-09', products: [{ id: '1', name: 'Artikel', stock: 0, stockKnown: true, warning: 0, bom: [] }], sales: [{ productId: '1', day: '2026-11-08', quantity: 70 }], complete: true };
  const state = { snapshot, settings: DEFAULT_SETTINGS, suppliers: [], productConfig: {}, orders: [{ status: 'draft', expectedAt: '2026-11-09', items: [{ productId: '1', quantity: 1000 }] }] };
  let result = analyze(state, 7).products[0];
  assert.equal(result.suggested, 0);
  assert.equal(result.priority.atRiskUnits, 140);
  state.orders[0].status = 'ordered';
  result = analyze(state, 7).products[0];
  assert.equal(result.priority.atRiskUnits, 0);
});
test('sorting uses real totals, puts missing values last and does not mutate the input', () => {
  const products = [
    { id: 'a', name: 'A', sold: 0, avg: 0, coverage: null, stock: 0, stockKnown: false, priority: { atRiskUnits: null } },
    { id: 'b', name: 'B', sold: 120, avg: 4, coverage: 10, stock: 40, stockKnown: true, priority: { atRiskUnits: 16 } },
    { id: 'c', name: 'C', sold: 90, avg: 3, coverage: 0, stock: 0, stockKnown: true, priority: { atRiskUnits: 42 } },
  ];
  assert.deepEqual(sortProducts(products, 'sales').map(p => p.id), ['b', 'c', 'a']);
  assert.deepEqual(sortProducts(products, 'priority').map(p => p.id), ['c', 'b', 'a']);
  assert.deepEqual(sortProducts(products, 'coverage').map(p => p.id), ['c', 'b', 'a']);
  assert.deepEqual(sortProducts(products, 'stock').map(p => p.id), ['c', 'b', 'a']);
  assert.deepEqual(products.map(p => p.id), ['a', 'b', 'c']);
});
