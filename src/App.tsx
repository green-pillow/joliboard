import { DetailPage, usePageState, usePageFlag, navigatePage, usePageRoute, WorkspacePages } from './page-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Command, LayoutDashboard, Leaf, LoaderCircle, Mail, Menu, Package, Plus, RefreshCw, Search, Settings2, ShoppingBag, Sparkles, Store, TrendingUp, Truck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Dashboard, Product, PurchaseOrder, View } from './types';
import type { Action } from './ProductEditor';
import { api, csv, date, download, methodLabel, money, num } from './lib';
import { Badge, Empty, ProductArt, SalesChart } from './components';
import ProductEditor from './ProductEditor';
import Suppliers from './Suppliers';
import Orders from './OrderManagement';
import Warehouse from './Warehouse';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import Settings from './Settings';
import SyncProgress from './SyncProgress';
import SalesOverview from './SalesOverview';
import InventoryTable from './InventoryTable';
import { sortProducts } from './product-sort';
import type { ProductSort } from './product-sort';
import DashboardMetrics from './DashboardMetrics';
import Onboarding from './Onboarding';

const navigation: { key: View; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'Übersicht', icon: LayoutDashboard }, { key: 'products', label: 'Produkte', icon: Boxes }, { key: 'suppliers', label: 'Lieferanten', icon: Store }, { key: 'orders', label: 'Bestellungen', icon: ShoppingBag },
  { key: 'warehouse', label: 'Lager', icon: WarehouseIcon },
];
export default function App() {
  const route = usePageRoute();
  const view: View = route.section;
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<ProductSort>('sales');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = usePageState<Product>({ screen: 'product', resources: data?.products, encode: p => ({ id: p.id }), resolve: params => data?.products.find(p => p.id === params.get('id')) || null });
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [help, setHelp] = usePageFlag('help');
  const [warehouseFocus, setWarehouseFocus] = useState<string | null>(null);
  const [orderFocus, setOrderFocus] = useState<string | null>(null);
  const [tourRequest, setTourRequest] = useState(0);
  const tourFilters = useRef<{search: string; filter: string; sort: ProductSort; supplierFilter: string} | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    try { const result = await api<Dashboard>(`/dashboard?days=${days}`); if (id === generation.current) { setData(result); setError(''); } }
    catch (e) { if (id === generation.current) setError((e as Error).message); }
  }, [days]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { const timer = setInterval(() => void load(), data?.connection.running ? 1500 : 60000); return () => clearInterval(timer); }, [load, data?.connection.running]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('keydown', shortcut); };
  }, []);
  const navigate = (next: View) => { navigatePage(`#${next}`); setMobileNav(false); };
  const goProducts = (supplier = '', nextFilter = 'all', nextSort?: ProductSort) => { setSearch(''); setSupplierFilter(supplier); setFilter(nextFilter); if (nextSort) setSort(nextSort); navigate('products'); };
  const action: Action = async (fn, success) => {
    try { await fn(); await load(); setToast({ text: success }); return true; }
    catch (e) { setToast({ text: (e as Error).message, error: true }); return false; }
  };
  const sync = async () => { await action(() => api('/sync', 'POST'), 'Synchronisierung gestartet.'); };
  const products = data?.products || [];
  const matching = products.filter(p => (!search || `${p.name} ${p.sku} ${p.supplierName}`.toLowerCase().includes(search.toLowerCase())) && (!supplierFilter || p.supplierId === supplierFilter));
  const visible = sortProducts(matching.filter(p => filter === 'all' || (filter === 'reorder' ? p.suggested > 0 : filter === 'risk' ? (p.priority.atRiskUnits || 0) > 0 : filter === 'unassigned' ? !p.supplierId : p.status === filter)), sort);
  const displayed = view === 'overview' ? visible.slice(0, 7) : visible;
  const selected = products.filter(p => selection.has(p.id) && p.suggested > 0 && p.supplierId);
  const prepareOrders = async (productIds: string[]) => {
    if (!productIds.length) return false;
    setBusy(true);
    let created: PurchaseOrder[] = [];
    const ok = await action(async () => { created = await api<PurchaseOrder[]>(`/orders?days=${days}`, 'POST', { productIds, requestId: crypto.randomUUID() }); }, 'Bestellentwurf erstellt. Prüfe jetzt Mengen und Bestellweg.');
    setBusy(false);
    if (ok) { setSelection(new Set()); if (created.length === 1) setOrderFocus(created[0].id); navigate('orders'); }
    return ok;
  };
  const purchase = () => prepareOrders(selected.map(p => p.id));
  const exportProducts = () => {
    download('joliboard-einkaufsplanung.csv', csv([['Produkt', 'SKU', 'Lieferant', 'Verkauft', 'Bestand', 'Durchschnittlicher Bedarf pro Tag', 'Reichweite Tage', 'Ungedeckter Bedarf', 'Nachbestellen', 'EK netto EUR', 'Zulauf'], ...visible.map(p => [p.name, p.sku, p.supplierName, p.sold ?? '', p.stockKnown ? p.stock : '', data?.connection.dataReady ? String(p.avg).replace('.', ',') : '', p.coverage == null ? '' : String(p.coverage).replace('.', ','), p.priority.atRiskUnits == null ? '' : String(p.priority.atRiskUnits).replace('.', ','), p.suggested, p.cost == null ? '' : String(p.cost).replace('.', ','), p.incoming])]), 'text/csv;charset=utf-8');
    setToast({ text: 'Einkaufsplanung als CSV exportiert.' });
  };
  const outstanding = data?.orders.filter(o => ['draft', 'requested', 'ordered', 'issue'].includes(o.status)).length || 0;
  const warehouseOpen = data?.warehouseTickets?.filter(t => ['open', 'checking', 'returned'].includes(t.status)).length || 0;
  const needs = data?.stats.reorder || 0;
  const c = data?.connection;
  const planningReady = c?.dataReady ?? false;
  const pageId = route.params.get('id');
  const unavailablePage = data && route.screen && (
    (route.screen === 'product' && !data.products.some(p => p.id === pageId)) ||
    (['supplier', 'supplier-remove'].includes(route.screen) && !(route.screen === 'supplier' && pageId === 'new') && !data.suppliers.some(s => s.id === pageId)) ||
    (['order', 'order-confirm', 'email'].includes(route.screen) && !data.orders.some(o => o.id === pageId)) ||
    (route.screen === 'warehouse-ticket' && !data.warehouseTickets.some(t => t.id === pageId)) ||
    (route.screen === 'order-confirm' && !['ordered', 'requested', 'cancelled'].includes(route.params.get('status') || '')) ||
    (route.screen === 'email' && !['order', 'discrepancy'].includes(route.params.get('kind') || ''))
  );
  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Menü schließen"/>}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}><a href="#overview" className="brand" onClick={() => navigate('overview')}><img className="brand-logo" src="/jolifill-logo.svg" alt="Jolifill" width="224" height="68"/></a><div className="workspace"><span className="workspace-icon"><Leaf size={18}/></span><div><strong>Mein Geschäft</strong><span>Einkaufsplanung</span></div><span className="workspace-dot"/></div><span className="nav-label">WORKSPACE</span><nav aria-label="Hauptnavigation" data-tour="navigation">{navigation.map(({ key, label, icon: Icon }) => <a key={key} href={`#${key}`} onClick={() => { if (key === 'products') { setFilter('all'); setSupplierFilter(''); } navigate(key); }} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined}><Icon size={19}/>{label}{key === 'orders' && outstanding > 0 && <span className="nav-count">{outstanding}</span>}{key === 'warehouse' && warehouseOpen > 0 && <span className="nav-count">{warehouseOpen}</span>}</a>)}</nav><div className="sidebar-bottom"><div className="side-tip"><span className="tip-spark"><Sparkles size={19}/></span><strong>Ein Schritt voraus.</strong><p>Die richtigen Produkte.<br/>Zur richtigen Zeit.</p><button onClick={() => setHelp(true)}>So funktioniert’s<ArrowUpRight size={14}/></button></div><nav><a href="#settings" onClick={() => navigate('settings')} className={view === 'settings' ? 'active' : ''}><Settings2 size={18}/>Einstellungen</a><button onClick={() => setTourRequest(value => value + 1)}><Sparkles size={18}/>Geführte Einführung</button><button onClick={() => setHelp(true)}><CircleHelp size={18}/>Hilfe & Berechnung</button></nav><div className="sidebar-user"><span>ME</span><div><strong>Mein Einkauf</strong><small>Jolifill Einkauf</small></div><span className="online-dot"/></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" data-tour="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Menü öffnen"><Menu size={22}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{view === 'settings' ? 'Einstellungen' : navigation.find(n => n.key === view)?.label}</strong></div><div className="topbar-right"><label className="global-search"><Search size={16}/><input ref={searchRef} aria-label="Produkte suchen" placeholder="Produkte suchen …" value={search} onChange={e => { setSearch(e.target.value); if (route.screen || (view !== 'overview' && view !== 'products')) navigate('products'); setFilter('all'); setSupplierFilter(''); }}/><kbd><Command size={10}/> K</kbd></label><button className={`icon-button notification ${data?.stats.critical ? 'has-notification' : ''}`} onClick={() => goProducts('', 'critical')} aria-label={`${data?.stats.critical || 0} kritische Produkte ansehen`}><Bell size={19}/></button><span className="top-avatar" aria-label="Mein Einkauf">ME</span></div></header>
    <main><WorkspacePages>
      <div className="page-heading" data-tour="page-heading"><div><span className="eyebrow">{view === 'overview' ? 'WENIGER BAUCHGEFÜHL. MEHR ÜBERBLICK.' : 'DEIN SMARTER EINKAUF'}</span><h1>{({ overview: 'Einkauf mit Weitblick.', products: 'Dein Sortiment. Im Blick.', suppliers: 'Deine Lieferanten.', orders: 'Deine Bestellungen.', warehouse: 'Dein Lager. Im Fluss.', settings: 'Alles richtig eingestellt.' })[view]}</h1><p>{view === 'overview' ? <>Was knapp wird. Was sich verkauft. Was als Nächstes dran ist.</> : view === 'products' ? 'Bestände verstehen und rechtzeitig die richtigen Produkte nachbestellen.' : 'Alles an einem Ort. Damit dein Einkauf im Fluss bleibt.'}</p></div><div className="page-actions">{['overview', 'products'].includes(view) ? <><label className="period-select" data-tour="period"><CalendarDays size={16}/><select aria-label="Auswertungszeitraum" value={days} onChange={e => { setDays(Number(e.target.value)); setSelection(new Set()); }}><option value={7}>Letzte 7 Tage</option><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select></label><button className="button icon-only" onClick={exportProducts} disabled={!data} title="Produkte als CSV exportieren" aria-label="Produkte als CSV exportieren"><ArrowDownToLine size={17}/></button></> : <span className="today"><CalendarDays size={15}/>{new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date())}</span>}</div></div>
      {c && <div data-tour="connection" className={`connection-bar ${c.mode === 'demo' ? 'demo-bar' : ''}`}><span><span className={`connection-dot ${c.mode === 'demo' ? 'demo-dot' : c.error || c.stale ? 'warning-dot' : ''}`}/><strong>{c.mode === 'demo' ? 'Demodaten' : 'Billbee'}</strong><span className="connection-separator"/>{c.mode === 'demo' ? 'Entdecke deinen Einkauf mit Beispieldaten.' : c.running ? c.progress : c.syncedAt ? `Aktualisiert am ${date(c.syncedAt)} · ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(c.syncedAt))} Uhr` : 'Noch keine Daten synchronisiert.'}</span><button className="text-button" onClick={c.mode === 'demo' || !c.configured ? () => navigate('settings') : () => void sync()} disabled={c.running}>{c.mode === 'demo' || !c.configured ? <>Billbee verbinden<ArrowRight size={14}/></> : <><RefreshCw size={13} className={c.running ? 'spin' : ''}/>{c.running ? 'Synchronisiert …' : 'Aktualisieren'}</>}</button></div>}
      {(error || c?.error || c?.stale) && <div className={`notice ${!error && c?.dataReady ? 'amber' : 'error'}`} role="alert"><div>{error || c?.error || 'Die Billbee-Daten sind älter als 24 Stunden. Vor einer Bestellung bitte aktualisieren.'}{!error && c?.error && c.dataReady && <p>Die gespeicherte Auswertung vom {date(c.syncedAt, true)} bleibt verfügbar.</p>}</div><button className="text-button" disabled={c?.running} onClick={() => { if (error) void load(); else void sync(); }}>{error ? 'Erneut laden' : 'Abgleich erneut starten'}</button></div>}
      {data?.emailRouting?.debugRecipient && <div className="notice amber" role="status"><Mail size={19}/><div><strong>E-Mail-Debug aktiv: {data.emailRouting.debugRecipient}</strong><p>Alle Bestell-, Angebots- und Fehlmengen-Mails verwenden diese Testadresse. Ein direkter Testversand gibt keine echte Bestellung auf.</p></div></div>}
      {c?.running && <SyncProgress connection={c} productCount={products.length}/>}
      {c?.catalogReady && !c.dataReady && !c.running && <div className="notice amber">Die Artikel sind geladen. Für Verkaufsdurchschnitt und Bestellvorschläge muss der Import der Bestellungen noch abgeschlossen werden.</div>}
      {!data ? <div className="card loading"><LoaderCircle className="spin" size={28}/><h3>{error ? 'Verbindung zum Server fehlt' : 'Dein Einkauf wird vorbereitet …'}</h3>{error && <button className="button" onClick={() => void load()}>Erneut versuchen</button>}</div> : <>
      {view === 'overview' && <>
        <DashboardMetrics data={data} days={days} onBrowse={(nextFilter, priority) => goProducts('', nextFilter, priority ? 'priority' : undefined)}/>
        <SalesOverview data={data} days={days} onProduct={setEditing} onShowAll={(nextSort, nextFilter) => goProducts('', nextFilter, nextSort)}/><div className="recommendation"><div className="recommendation-icon"><Sparkles size={22}/></div><div><h3>{needs > 0 ? `${needs} Produkte brauchen bald Nachschub.` : !planningReady ? 'Deine Auswertung wird vorbereitet.' : products.length ? 'Dein Einkauf ist auf Kurs.' : 'Bereit für deinen ersten Überblick.'}</h3><p>{needs > 0 ? <>Prüfe die Bestellvorschläge und bündele deinen Einkauf nach Lieferant. Bereits geplante Mengen sind berücksichtigt.</> : !planningReady ? 'Artikel und Verkaufsdaten werden aus Billbee geladen. Danach erscheinen hier deine Bestellvorschl\u00e4ge.' : products.length ? 'Aktuell ist keine zusätzliche Bestellung nötig. Offene Einkaufslisten sind bereits berücksichtigt.' : 'Verbinde Billbee, um deine Bestände und Bestellvorschläge zu sehen.'}</p></div><button className="button" onClick={() => { setFilter('reorder'); document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Einkauf planen<ArrowRight size={16}/></button></div>
      </>}
      {['overview', 'products'].includes(view) && <InventoryTable data={data} overview={view === 'overview'} matching={matching} visible={visible} displayed={displayed} filter={filter} onFilter={next => { setFilter(next); if (next === 'risk') setSort('priority'); }} sort={sort} onSort={setSort} supplierFilter={supplierFilter} onSupplier={setSupplierFilter} selection={selection} setSelection={setSelection} selectedCount={selected.length} busy={busy} onProduct={setEditing} onPurchase={() => void purchase()} onExport={exportProducts} onAll={() => navigate('products')} onReset={() => { if (products.length) { setFilter('all'); setSupplierFilter(''); setSearch(''); } else navigate('settings'); }}/>}
      {view === 'overview' && <div className="bottom-grid"><section className="card trend-card"><div className="card-heading"><div><span className="eyebrow">DAS BEWEGT DEIN SORTIMENT</span><h2>Dein Verkaufsverlauf</h2></div><span className="chart-legend"><span/>Verkaufte Stück</span></div><div className="trend-number"><strong>{data.salesReady ? num(data.trend.reduce((s, p) => s + p.quantity, 0), 0) : "\u2013"}</strong><span>Stück in {days} Tagen</span><BarChart3 size={21}/></div>{data.salesReady && data.trend.length ? <SalesChart points={data.trend}/> : <p className="muted">Verkaufsdaten erscheinen nach der Synchronisierung.</p>}</section><section className="card supplier-preview"><div className="card-heading"><div><span className="eyebrow">GEMEINSAM GUT VERSORGT</span><h2>Deine Lieferanten</h2></div><button className="icon-button" onClick={() => navigate('suppliers')} aria-label="Alle Lieferanten ansehen"><ArrowUpRight size={19}/></button></div>{data.suppliers.slice(0, 3).map(s => { const needed = products.filter(p => p.supplierId === s.id && p.suggested > 0); return <button className="supplier-preview-row" key={s.id} onClick={() => goProducts(s.id, 'reorder')}><span className={`supplier-monogram small ${s.color}`}>{s.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><span><strong>{s.name}</strong><small>{s.leadDays} Tage Lieferzeit · {methodLabel[s.method]}</small></span><span className={needed.length ? 'needed-count' : 'supplier-check'}>{needed.length ? `${needed.length} Artikel` : <Check size={15}/>}</span><ChevronRight size={15}/></button>; })}{!data.suppliers.length && <p className="muted supplier-empty">Lege Lieferanten an, um Einkaufslisten zu bündeln.</p>}<button className="text-button all-suppliers" onClick={() => navigate('suppliers')}>Lieferanten verwalten<ArrowRight size={14}/></button></section></div>}
      {view === 'suppliers' && <Suppliers data={data} action={action} onProducts={id => goProducts(id)} onReview={() => goProducts('', 'unassigned')}/>}
      {view === 'orders' && <Orders data={data} action={action} onPlan={() => goProducts('', 'reorder')} onWarehouse={id => { setWarehouseFocus(id); navigate('warehouse'); }} focusId={orderFocus} onFocusConsumed={() => setOrderFocus(null)}/>}
      {view === 'warehouse' && <Warehouse data={data} action={action} sync={() => void sync()} onOrder={id => { setOrderFocus(id); navigate('orders'); }} focusId={warehouseFocus} onFocusConsumed={() => setWarehouseFocus(null)}/>}
      {view === 'settings' && <Settings data={data} action={action} sync={() => void sync()}/>}
      <footer className="page-footer"><span><span className="footer-mark">j.</span>Gute Entscheidungen beginnen mit guten Daten.</span><span>{c?.mode === 'demo' ? 'Beispieldaten · lokal gespeichert' : 'Mit Billbee verbunden'}<span className="footer-dot"/>Joliboard</span></footer>
      </>}
    </WorkspacePages></main></div>
    {toast && <div className={`toast ${toast.error ? 'error-toast' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button aria-label="Meldung schließen" onClick={() => setToast(null)}><X size={16}/></button></div>}
    <Onboarding data={data} request={tourRequest} onStart={() => { tourFilters.current = { search, filter, sort, supplierFilter }; setSearch(''); setFilter('all'); setSupplierFilter(''); setMobileNav(false); }} onEnd={() => { const saved = tourFilters.current; if (saved) { setSearch(saved.search); setFilter(saved.filter); setSort(saved.sort); setSupplierFilter(saved.supplierFilter); } tourFilters.current = null; }}/>
    {editing && data && <ProductEditor product={editing} data={data} action={action} onClose={() => setEditing(null)} onPrepare={id => prepareOrders([id])}/>}
    {(unavailablePage || (route.screen && !data && error)) && <DetailPage title={error && !data ? 'Ansicht konnte nicht geladen werden' : 'Diese Ansicht ist nicht verfügbar'} onClose={() => navigate(view)}><p>{error && !data ? error : 'Der angefragte Artikel, Lieferant oder Vorgang wurde nicht gefunden. Kehre zur Übersicht zurück und wähle ihn erneut aus.'}</p><footer className="detail-actions"><button className="button primary" onClick={() => navigate(view)}>Zur Übersicht</button>{!data && <button className="button" onClick={() => void load()}>Erneut laden</button>}</footer></DetailPage>}
    {help && <DetailPage title="Ein Schritt voraus einkaufen." eyebrow="SO FUNKTIONIERT JOLIBOARD" onClose={() => setHelp(false)}><div className="help-steps"><div><span>01</span><section><h3>Verbinden & verstehen</h3><p>Billbee liefert deine Bestände und die letzten 90 Tage Bestellungen. Du wählst 7, 30 oder 90 vollständige Tage für den durchschnittlichen Tagesabsatz.</p></section></div><div><span>02</span><section><h3>Lieferanten & Bedarf planen</h3><p>Ordne jedem Produkt einen Lieferanten zu. Lieferzeit, Sicherheitspuffer, Mindestmenge und Verpackungseinheit bestimmen den Vorschlag.</p></section></div><div><span>03</span><section><h3>Gebündelt bestellen</h3><p>Wähle Produkte aus und erstelle je Lieferant einen Entwurf. Prüfe die Mengen, lade die E-Mail oder CSV herunter und gib die Bestellung auf.</p></section></div><div><span>04</span><section><h3>Den Kreis schließen</h3><p>Eine aufgegebene Bestellung erzeugt ein Lagerticket. Im Lager prüfst du die Mengen und gibst Fehlmengen an den Einkauf zurück. Nach einer Nachlieferung wird dasselbe Ticket fortgesetzt. Bestände anschließend mit Billbee abgleichen.</p></section></div></div><footer className="detail-actions"><button className="button primary" onClick={() => { setHelp(false); navigate('settings'); }}>Zu den Einstellungen<ArrowRight size={16}/></button></footer></DetailPage>}
  </div>;
}
