import { DetailPage } from './page-navigation';
import { useState } from 'react';
import { Save, ShoppingBag } from 'lucide-react';
import type { Dashboard, Product } from './types';
import { Field, Help, ProductArt, Badge } from './components';
import { api } from './lib';
import ProductMetrics from './ProductMetrics';
export type Action = (fn: () => Promise<unknown>, success: string) => Promise<boolean>;
export default function ProductEditor({ product: p, data, action, onClose, onPrepare }: { product: Product; data: Dashboard; action: Action; onClose: () => void; onPrepare: (productId: string) => Promise<boolean> }) {
  const [form, setForm] = useState({ supplierId: p.supplierId, orderRouteId: p.orderRouteId || '', supplierSku: p.supplierSku || '', minStock: p.minStock, moq: p.moq, packSize: p.packSize, cost: p.cost === null ? '' : String(p.cost) });
  const [busy, setBusy] = useState(false);
  const change = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));
  return <DetailPage title="Artikel planen" eyebrow={p.sku || 'Billbee-Artikel'} onClose={onClose}><form onSubmit={async e => {
    e.preventDefault();
    const prepare = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'order';
    setBusy(true);
    const saved = await action(() => api(`/products/${encodeURIComponent(p.id)}`, 'PUT', { ...form, cost: form.cost === '' ? null : Number(form.cost) }), prepare ? 'Planung gespeichert. Bestellentwurf wird vorbereitet.' : 'Planung gespeichert. Eine Bestellung kannst du über die Artikelauswahl vorbereiten.');
    const ok = saved && (!prepare || await onPrepare(p.id));
    setBusy(false);
    if (ok) onClose();
  }}>
    <div className="product-heading"><ProductArt product={p}/><div><h3>{p.name}</h3><Badge status={p.status}/></div></div>
    <ProductMetrics product={p} data={data}/>
    <section className="editor-section" data-tour="article-rules"><header><h2>Lieferant & Bestellregeln</h2><p>Bezugsquelle, Preise und Mengen für die Einkaufsplanung festlegen.</p></header>
    <div className="form-grid">
      {p.matching && <div className="matching-note wide"><strong>{p.matching.status === 'ambiguous' ? 'Mehrere Bezugsquellen gefunden' : p.matching.status === 'unmatched' ? 'Zuordnung noch offen' : 'Lieferantenzuordnung'}</strong><p>{p.matching.reason}</p>{(p.supplierCandidates?.length || 0) > 0 && <div className="matching-candidates">{p.supplierCandidates!.map(c => { const s = data.suppliers.find(s => s.id === c.supplierId); const r = s?.routes?.find(r => r.id === c.orderRouteId); return <button type="button" className={form.supplierId === c.supplierId && form.orderRouteId === c.orderRouteId ? 'chosen' : ''} key={`${c.supplierId}-${c.orderRouteId}`} onClick={() => setForm(f => ({ ...f, supplierId: c.supplierId, orderRouteId: c.orderRouteId }))}><strong>{s?.name}</strong><small>{r?.label}</small><span>{c.reason}</span></button>; })}</div>}</div>}
      <Field label="Lieferant" wide><select value={form.supplierId} onChange={e => { const s = data.suppliers.find(s => s.id === e.target.value); setForm(f => ({ ...f, supplierId: e.target.value, orderRouteId: s?.defaultRouteId || '' })); }}><option value="">Noch nicht zugeordnet</option>{data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.leadDays} Tage Lieferzeit</option>)}</select></Field>
      {(data.suppliers.find(s => s.id === form.supplierId)?.routes?.length || 0) > 0 && <Field label="Bestellweg" wide><select value={form.orderRouteId} onChange={e => change('orderRouteId', e.target.value)}>{data.suppliers.find(s => s.id === form.supplierId)!.routes!.map(r => <option key={r.id} value={r.id}>{r.label}{r.requiresQuote ? ' · Angebot erforderlich' : ''}</option>)}</select></Field>}
      <Field label="Lieferanten-Artikelnummer"><input value={form.supplierSku} onChange={e => change('supplierSku', e.target.value)} placeholder={p.sku}/></Field>
      <Field label="Einkaufspreis netto (€)" hint="Leer = unbekannt / Billbee-Preis"><input type="number" min="0" max="1000000" step="0.01" value={form.cost} onChange={e => change('cost', e.target.value)}/></Field>
      <Field label="Mindestbestand (Stück)"><input type="number" required min="0" step="0.01" value={form.minStock} onChange={e => change('minStock', Number(e.target.value))}/></Field>
      <Field label="Mindestbestellmenge (Stück)"><input type="number" required min="1" step="1" value={form.moq} onChange={e => change('moq', Number(e.target.value))}/></Field>
      <Field label="Verpackungseinheit (Stück)" hint="Bestellmengen werden auf volle Einheiten aufgerundet."><input type="number" required min="1" step="1" value={form.packSize} onChange={e => change('packSize', Number(e.target.value))}/></Field>
    </div>
    </section>
    <Help>Bestellpunkt: der höhere Wert aus Mindestbestand und Absatz × (Lieferzeit + Sicherheitspuffer). Zielbestand: zusätzlich {data.settings.targetDays} Tage Absatz. Bereits geplante Mengen werden abgezogen.</Help>
    <section className="product-order-next" data-tour="article-next"><h3>Aus der Planung eine Bestellung machen</h3><p>„Planung speichern“ übernimmt die Artikeleinstellungen. „Bestellung vorbereiten“ speichert sie und öffnet einen Bestellentwurf mit dem neu berechneten Bedarf. Dort prüfst du die Menge und den Bestellweg. Ein Lagerticket entsteht, sobald du die tatsächlich aufgegebene Bestellung bestätigst.</p>{!form.supplierId && <p className="red-text">Wähle zuerst einen Lieferanten aus.</p>}{!data.connection.dataReady && <p>Der vollständige Billbee-Abgleich ist für Bestellvorschläge erforderlich.</p>}{p.status === 'bundle' && <p>Bei Sets werden die enthaltenen Komponenten nachbestellt.</p>}</section>
    <footer className="detail-actions"><button type="submit" value="planning" className="button" disabled={busy}><Save size={16}/>Planung speichern</button><button type="submit" value="order" className="button primary" disabled={busy || !form.supplierId || !data.connection.dataReady || p.status === 'bundle'}><ShoppingBag size={16}/>{busy ? 'Wird gespeichert …' : 'Bestellung vorbereiten'}</button></footer>
  </form></DetailPage>;
}
