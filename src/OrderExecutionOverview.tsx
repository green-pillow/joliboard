import { ArrowRight, ArrowUpRight, Download, Globe, Hand, Mail, Warehouse } from 'lucide-react';
import type { PurchaseOrder } from './types';
import { date, money, num } from './lib';
import './order-execution.css';

function portal(order: PurchaseOrder) {
  try { const url = new URL(order.portalUrl); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}
function emailReady(order: PurchaseOrder) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(order.recipient || '');
}
function missingRoute(order: PurchaseOrder) {
  if (order.method === 'email' && !emailReady(order)) return 'Die Empfängeradresse fehlt oder ist ungültig. Bitte den Bestellweg im Entwurf prüfen.';
  if (order.method === 'portal' && !portal(order)) return 'Der Portallink fehlt. Bitte den Zugang beim Lieferanten klären und im Bestellweg hinterlegen.';
  if (order.method === 'manual' && !order.contact && !order.phone && !order.instructions) return 'Der manuelle Bestellweg ist noch offen. Bitte Kontakt und Vorgehen beim Lieferanten klären.';
  return '';
}

export function OrderExecutionDetails({ order, compact = false, directSend = false }: { order: PurchaseOrder; compact?: boolean; directSend?: boolean }) {
  const quote = order.intent === 'quote';
  const warning = missingRoute(order);
  const manualSteps = [
    order.method === 'email'
      ? { title: 'E-Mail-Entwurf öffnen', detail: `Empfänger, ${quote ? 'Anfrage' : 'Bestellung'} und Mengen im Mailprogramm prüfen und selbst senden.` }
      : order.method === 'portal'
        ? { title: 'Im Händlerportal ausführen', detail: `Artikel und Mengen im Portal eintragen und ${quote ? 'das Angebot anfragen' : 'die Bestellung dort abschicken'}.` }
        : { title: 'Lieferanten kontaktieren', detail: `${quote ? 'Angebot' : 'Bestellung'} telefonisch oder über den vereinbarten Weg mit dem Lieferanten klären.` },
    quote
      ? { title: '„Anfrage verschickt“ bestätigen', detail: 'Die Anfrage steht danach auf „Angefragt“. Es entsteht noch kein Lagerticket.' }
      : { title: '„Bestellung aufgegeben“ bestätigen', detail: 'Erst bestätigen, wenn die Bestellung tatsächlich beim Lieferanten platziert ist.' },
    quote
      ? { title: 'Angebot übernehmen & bestellen', detail: 'Nach dem Angebot Preise prüfen, die tatsächliche Bestellung aufgeben und bestätigen. Dann entsteht das Lagerticket.' }
      : { title: 'Lagerticket entsteht automatisch', detail: 'Die bestätigten Artikel und Mengen stehen unter „Lager“ für die Wareneingangsprüfung bereit.' },
  ];
  const steps = directSend && order.method === 'email' ? order.debugRecipient ? [
    { title: 'Testmail prüfen', detail: `Empfänger ist ${order.recipient}. Die Lieferantenadresse wird für den Test ersetzt.` },
    { title: 'Testmail direkt senden', detail: 'Nach Einrichtung des SMTP-Absenders versendet Joliboard die Nachricht über den Mailserver.' },
    { title: 'Testergebnis prüfen', detail: 'Der Versand wird protokolliert. Die Bestellung bleibt ein Entwurf und es entsteht kein Lagerticket.' },
  ] : [
    { title: 'Versandvorschau prüfen', detail: 'Prüfe Empfänger, Artikel, Mengen und Nachricht vor dem verbindlichen Versand.' },
    { title: quote ? 'Anfrage direkt senden' : 'Bestellung direkt senden', detail: 'Joliboard übergibt die Nachricht an den eingerichteten Mailserver und protokolliert das Ergebnis.' },
    { title: quote ? 'Angebot abwarten' : 'Lagerticket entsteht', detail: quote ? 'Nach Annahme durch den Mailserver steht die Anfrage auf „Angefragt“. Erst die spätere Bestellung erzeugt ein Lagerticket.' : 'Nach Annahme durch den Mailserver steht die Bestellung auf „Bestellt“ und das Lagerticket ist unter „Lager“ verfügbar.' },
  ] : manualSteps;
  return <div className="execution-details">
    {compact && <p className="execution-send-note">Diese Bestätigung versendet keine E-Mail und löst keine Bestellung beim Lieferanten aus. Sie dokumentiert den bereits ausgeführten Schritt.</p>}
    <dl className="execution-destination">
      {order.method === 'email' && order.debugRecipient && <div><dt>Ursprünglicher Lieferanten-Empfänger (Debug aktiv)</dt><dd>{order.originalRecipient || 'Nicht hinterlegt'}</dd></div>}
      <div><dt>{order.method === 'email' ? 'E-Mail geht nach deinem Versand an' : order.method === 'portal' ? 'Bestellung / Anfrage erfolgt hier' : 'Bestellung / Anfrage erfolgt über'}</dt><dd>{order.method === 'email' ? order.recipient || 'Empfänger noch offen' : order.method === 'portal' ? portal(order) ? <a href={portal(order)} target="_blank" rel="noreferrer">{order.portalUrl}<ArrowUpRight size={14}/></a> : 'Portallink noch offen' : [order.contact, order.phone].filter(Boolean).join(' · ') || 'Vereinbarten Kontaktweg'}</dd></div>
      <div><dt>{order.method === 'email' ? 'Betreff der vorbereiteten E-Mail' : 'E-Mail-Versand für diesen Bestellweg'}</dt><dd>{order.method === 'email' ? order.subject || 'Betreff noch offen' : 'Keine E-Mail vorgesehen'}</dd></div>
      {!compact && <><div><dt>Kundennummer</dt><dd>{order.customerNumber || 'Nicht hinterlegt'}</dd></div><div><dt>Gewünschter Liefertermin</dt><dd>{date(order.expectedAt)}</dd></div></>}
    </dl>
    {warning && <p className="execution-warning" role="status">{warning}</p>}
    {order.instructions && <div className="execution-instructions"><strong>So bestellt dieser Lieferant</strong><p>{order.instructions}</p>{order.method !== 'manual' && (order.contact || order.phone) && <p>Kontakt: {[order.contact, order.phone].filter(Boolean).join(' · ')}</p>}</div>}
    <ol className="execution-steps">{steps.map((step, index) => <li key={step.title}><span aria-hidden="true">{index + 1}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol>
    {!compact && order.method === 'email' && <details className="execution-message"><summary>E-Mail-Inhalt vor dem Versand ansehen</summary><div><strong>{order.subject}</strong><p>{order.body || 'Noch kein Nachrichtentext vorhanden.'}</p></div></details>}
  </div>;
}

export default function OrderExecutionOverview({ orders, onOpen, onDownload, onSend, configured }: { orders: PurchaseOrder[]; onOpen: (order: PurchaseOrder) => void; onDownload: (id: string) => Promise<unknown>; onSend: (id: string) => void; configured: boolean }) {
  const drafts = orders.filter(o => o.status === 'draft');
  if (!drafts.length) return null;
  const emails = drafts.filter(o => o.method === 'email');
  const portals = drafts.filter(o => o.method === 'portal');
  const manual = drafts.filter(o => o.method === 'manual');
  const quotes = drafts.filter(o => o.intent === 'quote');
  return <section className="execution-overview" data-tour="execution-plan" aria-labelledby="execution-overview-title">
    <div className="section-heading"><div><span className="eyebrow">VOR DER AUSFÜHRUNG</span><h2 id="execution-overview-title">Was passiert mit deinen geplanten Bestellungen?</h2><p>{drafts.length} {drafts.length === 1 ? 'Entwurf' : 'Entwürfe'} · Je Lieferant und Bestellweg siehst du Empfänger, Artikel und nächste Schritte.</p></div></div>
    <div className="execution-summary card"><div className="execution-summary-note"><Mail size={21}/><div><strong>Du behältst den Versand in der Hand.</strong><p>E-Mails kannst du nach der Empfänger- und Inhaltsprüfung direkt über Joliboard senden. Beim echten Versand bestätigt der Mailserver die Annahme; Bestellstatus und Lagerticket werden anschließend automatisch angelegt. Im Debugmodus bleibt es beim Testversand. Portal- und manuelle Bestellungen führst du weiterhin beim Lieferanten aus.</p>{!configured && <p className="execution-warning">Direktversand noch nicht eingerichtet. Bitte SMTP-Absender und Zugangsdaten in .env hinterlegen. E-Mail-Downloads bleiben verfügbar.</p>}</div></div><dl className="execution-counts"><div><dt>E-Mail-Entwürfe</dt><dd>{emails.length}</dd></div><div><dt>Im Händlerportal</dt><dd>{portals.length}</dd></div><div><dt>Manuell</dt><dd>{manual.length}</dd></div><div><dt>Davon Angebotsanfragen</dt><dd>{quotes.length}</dd></div></dl></div>
    <div className="execution-order-list">{drafts.map(order => {
      const Icon = order.method === 'email' ? Mail : order.method === 'portal' ? Globe : Hand;
      const quote = order.intent === 'quote';
      const value = order.items.reduce((sum, item) => sum + item.quantity * (item.cost || 0), 0);
      return <article className="card execution-order" key={order.id}>
        <header><span className="execution-method-icon"><Icon size={21}/></span><div className="execution-order-title"><span className="eyebrow">{order.reference}</span><h3>{order.supplierName}</h3><p>{order.routeLabel || (order.method === 'email' ? 'Bestellung per E-Mail' : order.method === 'portal' ? 'Bestellung im Händlerportal' : 'Manuelle Bestellung')}</p></div><span className={`badge ${quote ? 'requested' : 'draft'}`}>{quote ? 'Zuerst Angebot anfragen' : 'Bestellung vorbereiten'}</span></header>
        <div className="execution-articles"><div className="execution-articles-heading"><strong>{order.items.length} {order.items.length === 1 ? 'Artikelposition' : 'Artikelpositionen'} · {num(order.items.reduce((sum, item) => sum + item.quantity, 0))} Stück</strong><span>{money(value)} netto{order.items.some(i => i.cost == null) ? ' + offene Preise' : ''} · ohne Versand</span></div><ul>{order.items.map(item => <li key={item.productId}><span><strong>{item.name}</strong><small>{item.supplierSku || item.sku || 'Artikelnummer noch offen'}</small></span><strong>{num(item.quantity)} Stk.</strong></li>)}</ul></div>
        <OrderExecutionDetails order={order} directSend/>
        <footer><span><Warehouse size={16}/>{quote ? 'Lagerticket erst nach der tatsächlichen Bestellung.' : 'Lagerticket nach „Bestellung aufgegeben“.'}</span><div>{order.method === 'email' && <button className="button primary" onClick={() => onSend(order.id)}><Mail size={15}/>{order.debugRecipient ? 'Testmail direkt senden' : 'E-Mail direkt senden'}</button>}{order.method === 'email' && <button className="button" disabled={!emailReady(order) || !order.subject || !order.body} onClick={() => void onDownload(order.id)}><Download size={15}/>E-Mail-Entwurf herunterladen</button>}{order.method === 'portal' && portal(order) && <a className="button" href={portal(order)} target="_blank" rel="noreferrer">Händlerportal öffnen<ArrowUpRight size={15}/></a>}<button className="button primary" onClick={() => onOpen(order)}>Entwurf prüfen & weiter<ArrowRight size={15}/></button></div></footer>
      </article>;
    })}</div>
  </section>;
}
