import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, buildSupplierImport, applySupplierImport } from '../server/orderdata.mjs';
import { emptyState } from '../server/demo.mjs';
test('CSV parsing handles quoted multiline fields and discards login and password columns', () => {
  const [row] = parseCsv('\uFEFFHersteller,Produkte,Passwort,Benutzername,Login-E-Mail\r\nFirma,"Artikel, A\nArtikel B",SECRET,USER,LOGIN\r\n');
  assert.equal(row.Hersteller, 'Firma'); assert.equal(row.Produkte, 'Artikel, A\nArtikel B');
  assert.equal(row.Passwort, undefined); assert.equal(row.Benutzername, undefined); assert.equal(row['Login-E-Mail'], undefined);
  assert.ok(!JSON.stringify(row).includes('SECRET'));
});
test('supplier import preserves real order methods, avoids generic matches and leaves conflicting sources for review', () => {
  const source = { ignored: ['Unbenannt.md'], records: [
    { title: 'IBSA', Bestellmethode: 'Online-Shop', Webseite: 'https://shop.example.test/', Produkte: 'Profhilo, Aliaxin', sourceFiles: ['ibsa.md'] },
    { title: 'Galderma', Bestellmethode: 'E-Mail', Kontaktdaten: 'orders@example.test', Produkte: 'Restylane', sourceFiles: ['galderma.md'] },
    { title: 'Moryskin', Bestellmethode: 'Partner Shops', Kontaktdaten: 'quote@example.test', Produkte: 'Angebot einholen', sourceFiles: ['moryskin.md'] },
    { title: 'Monalisa', Bestellmethode: 'E-Mail', Kontaktdaten: 'one@example.test oder two@example.test', sourceFiles: ['monalisa.md'] },
    { title: 'Pharma Medical Germany', Bestellmethode: 'Partner Shops', Kontaktdaten: 'one@example.test', sourceFiles: ['pharma.md'] },
    { title: 'Auderm', Bestellmethode: 'Partner Shops', Kontaktdaten: 'two@example.test', sourceFiles: ['auderm.md'] },
  ] };
  const plan = buildSupplierImport(source); const state = emptyState();
  state.snapshot = { products: [{ id: '1', name: 'Profhilo 2 ml', sku: 'P1' }, { id: '2', name: 'Monalisa Soft', sku: 'M1' }, { id: '3', name: 'Unbekannter Artikel', sku: 'X1' }] };
  const report = applySupplierImport(state, plan);
  assert.equal(report.assigned, 1); assert.equal(report.ambiguous, 1); assert.equal(report.unmatched, 1);
  const assigned = state.suppliers.find(s => s.id === state.productConfig['1'].supplierId);
  assert.equal(assigned.name, 'IBSA'); assert.equal(assigned.method, 'portal');
  assert.equal(state.suppliers.find(s => s.name === 'Moryskin').routes[0].requiresQuote, true);
  assert.ok(!state.productConfig['2'].supplierId);
  const before = state.suppliers.length;
  state.productConfig['1'].matching = { status: 'manual', reason: 'Vom Einkauf gewählt' };
  applySupplierImport(state, plan);
  assert.equal(state.suppliers.length, before); assert.equal(state.productConfig['1'].matching.status, 'manual');
});
