import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stableId = (kind, text) => `${kind}-${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
const fields = ['Hersteller', 'Ansprechpartner', 'Bestellmethode', 'Handynummer', 'Kontaktdaten', 'Kundennummer', 'Produkte', 'Telefonnummer', 'Webseite'];
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(field.replace(/\r$/, '')); field = ''; if (c === '\n') { rows.push(row); row = []; } }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = (rows.shift() || []).map(s => s.replace(/^\uFEFF/, '').trim());
  // Credentials and login identities are intentionally not imported.
  return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] || '']).filter(([key]) => fields.includes(key))));
}
const aliases = { juvederm: 'Pharma Medical Germany', stylage: 'Dermatic', 'female luer lock connector': 'Aesthetic Group', 'juvelook lenisna': 'Dr.Rosefid' };
const rules = {
  merz: ['belotero', 'radiesse'], 'teoxane teosyal': ['teoxane', 'teosyal'], ibsa: ['profhilo', 'aliaxin', 'viscoderm'], mesoram: ['mesoram'], juvederm: ['juvederm'], auderm: ['e p t q', 'eptq'],
  croma: ['saypha', 'polyphil', 'poly phil', 'croma', 'farewell', 'tsk'], galderma: ['restylane', 'sculptra'], intermexdexp: ['dsd', 'mdceuticals', 'md ceuticals', 'mdceuticels', 'jalupro', 'art lift'],
  neauvia: ['neauvia'], luventas: ['dermastabilon', 'rrs', 'prx'], stylage: ['stylage'], monalisa: ['monalisa', 'mona lisa'], revolax: ['revolax'], miraj: ['exomide'],
  youlavie: ['vitaran', 'neuramis', 'exoxe', 'ultracol', 'ultrav', 'ultra v', 'pbserum', 'pb serum'], mesotech: ['mesotech', 'globalmeso', 'needleroll', 'tricocure', 'botophase'],
  opera: ['opera iv'], karisma: ['karisma'], 'clinisept clinisoothe': ['clinisept', 'clinisoothe', 'clinisoothe plus'], sonewa: ['mesoestetic', 'softfil', 'preime'],
  'dermatrade pl': ['nucleofill'], 'neomeso gmbh': ['pluryal meso'], promoitalia: ['skinfill', 'liquid beauty', 'sticol', 'perfect line', 'pink intimate'],
  'ibor medical': ['l eclat', 'leclat'], hyalual: ['hyalual'], 'aesthetic group': ['baxter adapter'], 'menke med': ['me line', 'meline', 'inno', 'regenyal'],
  'dsddeluxe de': ['dsd'], 'velet cosmetics': ['velet'], 'suisse medicare': ['l kanule', 'prx'], 'medyglobal medical': ['deneb'], 'novvia de': ['fillmed'],
  dermaqual: ['goldfill', 'dermaqual'], 'nosy gmbh': ['remedium', 're medium'], linerase: ['linerase'], 'k esthetic pl': ['cincelar'],
  sinclair: ['perfectha', 'perfechta', 'lanluma', 'ellanse'], 'md skin solution': ['pluryal'], cellbooster: ['cellbooster'], 'juvelook lenisna': ['juvelook', 'lenisna'],
  aesthefill: ['aesthefill'], sunekos: ['sunekos'], 'female luer lock connector': ['female luer lock', 'luer lock female'],
  'gda medical': ['plinest', 'jalupro'], phshop: ['plinest'], 'venus distribution malta': ['dr cyj', 'drcyj', 'ejal40', 'ejal 40', 'jalupro'],
};
function portal(value) {
  if (!value || /\s/.test(value) || !value.includes('.')) return '';
  try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) ? url.href.replace(/^http:/, 'https:') : ''; } catch { return ''; }
}
const emails = value => [...new Set((value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
export function loadOrderdata(directory = path.resolve('orderdata')) {
  const files = readdirSync(directory);
  const csvFiles = files.filter(f => f.endsWith('.csv'));
  const csv = csvFiles.flatMap(file => parseCsv(readFileSync(path.join(directory, file), 'utf8')).map(row => ({ ...row, file })));
  const ignored = [];
  const records = files.filter(f => f.endsWith('.md')).flatMap(file => {
    const text = readFileSync(path.join(directory, file), 'utf8');
    const title = text.match(/^#\s+(.+)/)?.[1]?.trim() || '';
    if (!title || /^unbenannt$/i.test(title) || /^\d+$/.test(title)) { ignored.push(file); return []; }
    const value = { title, sourceFiles: [`orderdata/${file}`] };
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match && fields.includes(match[1])) value[match[1]] = match[2].trim();
    }
    const other = csv.find(r => normalize(r.Hersteller) === normalize(title) && (!r.Bestellmethode || r.Bestellmethode === value.Bestellmethode));
    if (other) { for (const key of fields) if (!value[key] && other[key]) value[key] = other[key].trim(); value.sourceFiles.push(`orderdata/${other.file}`); }
    // Some supplier email addresses were put in the username field. Only use
    // this for email suppliers, never an online-shop login identity.
    const username = text.match(/^Benutzername:\s*(.+)$/m)?.[1]?.trim() || '';
    value.fallbackSupplierEmail = value.Bestellmethode === 'E-Mail' ? emails(username).find(e => !/@jolifill\.de$/i.test(e)) || '' : '';
    return [value];
  });
  return { records, ignored, files: files.length };
}
export function buildSupplierImport(source) {
  const suppliers = new Map(), matchRules = [];
  const byName = new Map(source.records.map(r => [normalize(r.title), r]));
  for (const original of source.records) {
    const key = normalize(original.title);
    const targets = key === 'monalisa' ? ['Pharma Medical Germany', 'Auderm'] : key === 'revolax' ? ['Moryskin', 'Dr.Rosefid'] : [aliases[key] || original.title];
    for (const canonical of targets) {
      const parent = byName.get(normalize(canonical));
      const specific = ['monalisa', 'revolax'].includes(key);
      const addresses = emails(original.Kontaktdaten);
      const parentEmail = emails(parent?.Kontaktdaten)[0] || '';
      let email = specific ? parentEmail : addresses[0] || emails(original.Ansprechpartner)[0] || original.fallbackSupplierEmail || emails(original.Produkte)[0] || '';
      if (/@jolifill\.de$/i.test(email)) email = '';
      const sourceMethod = original.Bestellmethode || 'Nicht angegeben';
      const requiresQuote = sourceMethod === 'Partner Shops' || /angebot|anfrage/i.test(original.Produkte || '') || key === 'revolax';
      const portalUrl = portal(original.Webseite) || portal(parent?.Webseite);
      const method = sourceMethod === 'Online-Shop' && portalUrl ? 'portal' : email ? 'email' : 'manual';
      const routeId = stableId('route', `${key}|${canonical}|${sourceMethod}`);
      const instructions = [original.Produkte ? `Sortiment / Hinweis: ${original.Produkte}` : '', original.Kontaktdaten && !emails(original.Kontaktdaten).length ? `Kontakt laut Unterlagen: ${original.Kontaktdaten}` : '', sourceMethod === 'Personal Shopper' ? 'Persönliche Beschaffung über den angegebenen Kontakt.' : '', original.Webseite && !portal(original.Webseite) ? `Hinweis zum Anbieter: ${original.Webseite}` : '', !email && sourceMethod === 'E-Mail' ? 'E-Mail-Adresse fehlt: Kontakt vor einer Bestellung klären.' : ''].filter(Boolean).join('\n');
      const route = { id: routeId, label: `${original.title} · ${requiresQuote ? 'Angebot anfragen' : sourceMethod}`, method, email: method === 'portal' ? '' : email, portalUrl, contact: original.Ansprechpartner || (!email ? original.Kontaktdaten : '') || parent?.Ansprechpartner || '', phone: original.Handynummer || original.Telefonnummer || parent?.Handynummer || '', requiresQuote, instructions, needsReview: method === 'manual' && sourceMethod === 'E-Mail', sourceFiles: original.sourceFiles };
      const supplierKey = normalize(canonical);
      if (!suppliers.has(supplierKey)) suppliers.set(supplierKey, { id: stableId('supplier', supplierKey), importKey: `orderdata:${supplierKey}`, name: canonical, contact: '', email: '', method: 'manual', leadDays: 7, leadTimeEstimated: true, minValue: 0, portalUrl: '', customerNumber: '', color: ['sage', 'peach', 'lilac', 'sand'][suppliers.size % 4], emailTemplate: '', subjectTemplate: '', notes: '', routes: [], sourceFiles: [] });
      const supplier = suppliers.get(supplierKey);
      supplier.routes.push(route);
      supplier.sourceFiles = [...new Set([...supplier.sourceFiles, ...original.sourceFiles])];
      if (original.Kundennummer) supplier.customerNumber = original.Kundennummer;
      if (original.Handynummer) supplier.phone = original.Handynummer;
      const primary = supplier.routes.find(r => r.method === 'portal') || supplier.routes.find(r => normalize(r.label.split(' · ')[0]) === supplierKey) || supplier.routes[0];
      Object.assign(supplier, { defaultRouteId: primary.id, method: primary.method, email: primary.email, portalUrl: primary.portalUrl, contact: primary.contact, notes: primary.instructions });
      for (const token of rules[key] || []) matchRules.push({ supplierId: supplier.id, orderRouteId: route.id, token: normalize(token), sourceTitle: original.title, sourceFiles: original.sourceFiles, score: 80 + Math.min(20, normalize(token).length) });
      if (key === 'nordic') matchRules.push({ supplierId: supplier.id, orderRouteId: route.id, skuPrefix: 'A', sourceTitle: original.title, sourceFiles: original.sourceFiles, score: 120 });
      if (key === 'intermexdexp') matchRules.push({ supplierId: supplier.id, orderRouteId: route.id, skuPrefix: 'MDCEU', sourceTitle: original.title, sourceFiles: original.sourceFiles, score: 110, inferred: true });
    }
  }
  return { suppliers: [...suppliers.values()], rules: matchRules, ignored: source.ignored, sourceRecords: source.records.length };
}
export function matchingCandidates(product, rules, supplierIds = new Map()) {
  const name = ` ${normalize(product.name)} `;
  const results = new Map();
  for (const rule of rules) {
    const matches = rule.skuPrefix ? String(product.sku || '').toUpperCase().startsWith(rule.skuPrefix) : name.includes(` ${rule.token} `);
    if (!matches) continue;
    const supplierId = supplierIds.get(rule.supplierId) || rule.supplierId;
    const evidence = rule.skuPrefix ? `SKU beginnt mit ${rule.skuPrefix}${rule.inferred ? ' (aus Artikelfamilie abgeleitet)' : ' (laut Kundenunterlagen)'}` : `Produktname enthält „${rule.token}“`;
    const candidate = { supplierId, orderRouteId: rule.orderRouteId, score: rule.score, reason: evidence, sourceFiles: rule.sourceFiles };
    const key = `${supplierId}|${rule.orderRouteId}`;
    if (!results.has(key) || results.get(key).score < rule.score) results.set(key, candidate);
  }
  return [...results.values()].sort((a, b) => b.score - a.score || a.supplierId.localeCompare(b.supplierId));
}
export function applySupplierImport(state, plan) {
  const supplierIds = new Map(); let created = 0, assigned = 0, ambiguous = 0, unmatched = 0, preserved = 0;
  for (const imported of plan.suppliers) {
    let existing = state.suppliers.find(s => s.importKey === imported.importKey || normalize(s.name) === normalize(imported.name));
    if (!existing) { existing = structuredClone(imported); state.suppliers.push(existing); created++; }
    else {
      existing.routes ||= [];
      for (const route of imported.routes) if (!existing.routes.some(r => r.id === route.id)) existing.routes.push(structuredClone(route));
      existing.importKey ||= imported.importKey;
      existing.sourceFiles = [...new Set([...(existing.sourceFiles || []), ...imported.sourceFiles])];
    }
    supplierIds.set(imported.id, existing.id);
  }
  const results = [];
  for (const product of state.snapshot?.products || []) {
    const candidates = matchingCandidates(product, plan.rules, supplierIds);
    const config = state.productConfig[product.id] || {};
    const differentSupplier = candidates.find(c => c.supplierId !== candidates[0]?.supplierId);
    const differentRoute = candidates.find(c => c.orderRouteId !== candidates[0]?.orderRouteId && c.score === candidates[0]?.score);
    const definite = candidates.length > 0 && !differentRoute && (!differentSupplier || candidates[0].score - differentSupplier.score >= 15);
    let status;
    if (config.supplierId) { preserved++; status = config.matching?.status || 'manual'; }
    else if (definite) { config.supplierId = candidates[0].supplierId; config.orderRouteId = candidates[0].orderRouteId; config.matching = { status: 'matched', reason: candidates[0].reason }; assigned++; status = 'matched'; }
    else if (candidates.length) { ambiguous++; status = 'ambiguous'; config.matching = { status, reason: 'Mehrere mögliche Bestellwege oder Lieferanten. Bitte auswählen.' }; }
    else { unmatched++; status = 'unmatched'; config.matching = { status, reason: 'Keine belastbare Produktzuordnung in den Unterlagen.' }; }
    config.supplierCandidates = candidates;
    state.productConfig[product.id] = config;
    results.push({ productId: product.id, name: product.name, sku: product.sku, status, supplierId: config.supplierId || '', candidates });
  }
  const report = { importedAt: new Date().toISOString(), sourceRecords: plan.sourceRecords, suppliersCreated: created, supplierCount: plan.suppliers.length, assigned, ambiguous, unmatched, preserved, ignored: plan.ignored, results };
  state.supplierImport = report;
  return report;
}
