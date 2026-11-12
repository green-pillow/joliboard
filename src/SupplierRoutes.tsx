import { Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { OrderRoute, Supplier } from './types';
import { Field } from './components';
import { methodLabel } from './lib';
export default function SupplierRoutes({ supplier: s, setSupplier }: { supplier: Supplier; setSupplier: Dispatch<SetStateAction<Supplier | null>> }) {
  const updateRoute = (id: string, values: Partial<OrderRoute>) => setSupplier(current => {
    if (!current) return current;
    const routes = current.routes?.map(r => r.id === id ? { ...r, ...values } : r) || [];
    const primary = routes.find(r => r.id === current.defaultRouteId);
    return { ...current, routes, ...(primary ? { method: primary.method, email: primary.email, portalUrl: primary.portalUrl, contact: primary.contact, requiresQuote: primary.requiresQuote } : {}) };
  });
  return <div className="supplier-routes wide" data-tour="supplier-routes"><div className="form-divider"><h3>Bestellwege & Quellen</h3></div>{(s.routes?.length || 0) > 0 && <Field label="Standard-Bestellweg"><select value={s.defaultRouteId || ''} onChange={e => setSupplier(current => { const r = current?.routes?.find(r => r.id === e.target.value); return current && r ? { ...current, defaultRouteId: r.id, method: r.method, email: r.email, portalUrl: r.portalUrl, contact: r.contact, requiresQuote: r.requiresQuote } : current; })}>{s.routes!.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>}
    {(s.routes || []).map(r => <details key={r.id} className="supplier-route-detail"><summary><strong>{r.label}</strong><span>{methodLabel[r.method]}{r.requiresQuote ? ' · Angebot zuerst' : ''}</span></summary><div className="form-grid"><Field label="Bezeichnung" wide><input value={r.label} onChange={e => updateRoute(r.id, { label: e.target.value })}/></Field><Field label="Bestellweg"><select value={r.method} onChange={e => updateRoute(r.id, { method: e.target.value as OrderRoute['method'] })}><option value="email">E-Mail</option><option value="portal">Händlerportal</option><option value="manual">Persönlicher Kontakt / manuell</option></select></Field><Field label="Empfänger-E-Mail"><input type="email" required={r.method === 'email'} value={r.email} onChange={e => updateRoute(r.id, { email: e.target.value })}/></Field><Field label="Kontakt"><input value={r.contact} onChange={e => updateRoute(r.id, { contact: e.target.value })}/></Field><Field label="Telefon"><input value={r.phone || ''} onChange={e => updateRoute(r.id, { phone: e.target.value })}/></Field><Field label="Shop / Webseite (HTTPS)" wide><input type="url" value={r.portalUrl} onChange={e => updateRoute(r.id, { portalUrl: e.target.value })}/></Field><label className="checkbox-field wide"><input type="checkbox" checked={r.requiresQuote} onChange={e => updateRoute(r.id, { requiresQuote: e.target.checked })}/>Vor der Bestellung ein Angebot einholen</label><Field label="Bestellhinweise" wide><textarea rows={3} value={r.instructions} onChange={e => updateRoute(r.id, { instructions: e.target.value })}/></Field>{r.sourceFiles && <div className="source-references wide">Quelle: {r.sourceFiles.map(f => f.replace(/^orderdata\//, '').replace(/ [a-f0-9]{32}(?=\.)/, '')).join(', ')}</div>}</div></details>)}
    <button className="button small-button" type="button" onClick={() => setSupplier(current => {
      if (!current) return current;
      const route: OrderRoute = { id: `route-${crypto.randomUUID()}`, label: 'Weiterer Bestellweg', method: 'manual', email: '', portalUrl: '', contact: '', phone: '', requiresQuote: false, instructions: '' };
      return { ...current, routes: [...(current.routes || []), route], ...(!current.defaultRouteId ? { defaultRouteId: route.id, method: route.method, email: route.email, portalUrl: route.portalUrl, requiresQuote: false } : {}) };
    })}><Plus size={14}/>Bestellweg ergänzen</button>
  </div>;
}
