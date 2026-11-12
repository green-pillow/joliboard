import { dayKey, shiftDay, DEFAULT_SETTINGS } from './domain.mjs';
export function emptyState() { return { snapshot: null, suppliers: [], productConfig: {}, orders: [], warehouseTickets: [], settings: { ...DEFAULT_SETTINGS } }; }
export function createDemo() {
  const state = emptyState();
  const endDate = dayKey();
  state.suppliers = [
    { id: 's1', name: 'Nordlicht Living', contact: 'Lena Petersen', email: 'einkauf@nordlicht.example', method: 'email', leadDays: 5, minValue: 250, portalUrl: '', customerNumber: 'KD-2048', color: 'peach', emailTemplate: '', subjectTemplate: '' },
    { id: 's2', name: 'Form & Faden', contact: 'Martin Weber', email: 'handel@formfaden.example', method: 'portal', leadDays: 8, minValue: 150, portalUrl: '', customerNumber: 'FF-1032', color: 'lilac', emailTemplate: '', subjectTemplate: '' },
    { id: 's3', name: 'Grünwerk Großhandel', contact: 'Sarah Berg', email: 'bestellung@gruenwerk.example', method: 'email', leadDays: 4, minValue: 100, portalUrl: '', customerNumber: '', color: 'sage', emailTemplate: '', subjectTemplate: '' },
    { id: 's4', name: 'Studio Objects', contact: 'Jonas Hoffmann', email: '', method: 'manual', leadDays: 12, minValue: 0, portalUrl: '', customerNumber: '', color: 'sand', emailTemplate: '', subjectTemplate: '' },
  ];
  const rows = [
    ['Keramikbecher Sand', 'NL-101', 8, 3.6, 6.9, 's1', 'Wohnen', 'cup', 'sand'],
    ['Duftkerze Feige & Zeder', 'NL-204', 12, 2.7, 8.5, 's1', 'Wohnen', 'candle', 'peach'],
    ['Leinenkissen Natur', 'FF-310', 4, 1.4, 14.9, 's2', 'Textilien', 'cushion', 'lilac'],
    ['Pflanztopf Salbei · M', 'GW-120', 0, 1.8, 7.2, 's3', 'Garten', 'plant', 'sage'],
    ['Glasvase Amber', 'SO-402', 18, 1.2, 11.5, 's4', 'Wohnen', 'vase', 'peach'],
    ['Geschirrtuch Streifen', 'FF-122', 28, 2.1, 4.8, 's2', 'Textilien', 'cloth', 'blue'],
    ['Holztablett Eiche', 'NL-330', 34, 1.6, 12.4, 's1', 'Wohnen', 'tray', 'sand'],
    ['Gießkanne Mini', 'GW-244', 16, 0.8, 9.9, 's3', 'Garten', 'watering', 'sage'],
    ['Wolldecke Kiesel', 'FF-410', 82, 1.1, 29.0, 's2', 'Textilien', 'cushion', 'lilac'],
    ['Notizbuch Leinen', 'SO-112', 130, 2.0, 5.6, 's4', 'Papeterie', 'book', 'blue'],
    ['Seifenschale Stein', 'NL-118', 98, 1.7, 4.3, 's1', 'Wohnen', 'tray', 'sand'],
    ['Ü bertopf Terrakotta'.replace('Ü ', 'Ü'), 'GW-108', 145, 2.2, 5.8, 's3', 'Garten', 'plant', 'peach'],
  ];
  const products = rows.map((r, i) => ({ id: `demo-${i + 1}`, name: r[0], sku: r[1], stock: r[2], stockKnown: true, cost: r[4], warning: 5, desired: 0, category: r[6], illustration: r[7], color: r[8], bom: [] }));
  const sales = [];
  rows.forEach((r, i) => {
    state.productConfig[`demo-${i + 1}`] = { supplierId: r[5], supplierSku: r[1], minStock: 5, moq: 6, packSize: 6 };
    for (let n = 90; n >= 1; n--) {
      const quantity = Math.max(0, Math.round(r[3] * (0.6 + ((n * 7 + i * 3) % 13) / 12) * (n < 15 ? 1.15 : 1)));
      sales.push({ productId: `demo-${i + 1}`, day: shiftDay(endDate, -n), quantity });
    }
  });
  state.snapshot = { products, sales, endDate, syncedAt: new Date().toISOString(), orderCount: 724, source: 'demo' };
  return state;
}
