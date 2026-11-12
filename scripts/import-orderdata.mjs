import { createStore } from '../server/store.mjs';
import { connectionConfig } from '../server/billbee.mjs';
import { loadOrderdata, buildSupplierImport, applySupplierImport } from '../server/orderdata.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const source = loadOrderdata();
const plan = buildSupplierImport(source);
const store = createStore();
try {
  const scope = connectionConfig().mode;
  const report = process.argv.includes('--apply') ? store.mutate(scope, state => {
    mkdirSync('data', { recursive: true });
    writeFileSync(`data/before-orderdata-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(state));
    return applySupplierImport(state, plan);
  }) : applySupplierImport(structuredClone(store.load(scope)), plan);
  console.log(JSON.stringify({ scope, ...Object.fromEntries(Object.entries(report).filter(([key]) => !['results', 'ignored'].includes(key))), ignoredRecords: report.ignored.length }));
  if (process.argv.includes('--apply')) {
    mkdirSync('data', { recursive: true });
    const names = new Map(store.load(scope).suppliers.map(s => [s.id, s.name]));
    const review = report.results.filter(r => ['ambiguous', 'unmatched'].includes(r.status));
    writeFileSync('data/orderdata-match-report.md', `# Lieferantenabgleich\n\nStand: ${report.importedAt}\n\n${report.sourceRecords} benannte Quelldatensätze, ${report.supplierCount} Lieferanten, ${report.assigned} neue Zuordnungen, ${report.preserved} bestehende Zuordnungen beibehalten, ${report.ambiguous} mehrdeutig, ${report.unmatched} ohne Treffer.\n\nLogin-Daten und Passwortfelder wurden nicht importiert. Die numerische/ungenannten Quellen wurden nicht als Lieferanten oder Kundennummern zugeordnet.\n\n## Zu prüfen\n\n| SKU | Produkt | Status | Mögliche Lieferanten |\n|---|---|---|---|\n${review.map(r => `| ${r.sku.replaceAll('|', '/')} | ${r.name.replaceAll('|', '/')} | ${r.status} | ${[...new Set(r.candidates.map(c => names.get(c.supplierId)))].join(', ')} |`).join('\n')}\n`);
  }
} finally { store.close(); }
