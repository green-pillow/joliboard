import { Boxes, CalendarDays, Clock3, PackageCheck, ShoppingBag, TrendingUp, Truck } from 'lucide-react';
import type { Dashboard, Product } from './types';
import { date, num } from './lib';
import StatBox from './StatBox';

export default function ProductMetrics({ product: p, data }: { product: Product; data: Dashboard }) {
  const ready = data.connection.dataReady;
  const risk = p.priority.atRiskUnits;
  const coverage = ready && p.stockKnown && p.coverage !== null ? num(p.coverage) : '–';
  return <div className="product-metric-sections">
    <section className="metric-section" aria-labelledby="product-stock-heading" data-tour="article-stock"><header><div><h2 id="product-stock-heading">Bestand & Bestellbedarf</h2><p>Die wichtigsten Werte für deine nächste Einkaufsentscheidung.</p></div></header><div className="stat-grid stat-grid-four">
      <StatBox label="Aktueller Bestand" value={p.stockKnown ? num(p.stock) : '–'} unit="Stück" hint={p.stockKnown ? 'Lagerbestand aus Billbee' : 'Kein verlässlicher Bestand vorhanden'} icon={Boxes} tone={p.stockKnown && p.stock <= 0 ? 'red' : 'neutral'}/>
      <StatBox label="Ø Bedarf pro Tag" value={ready ? num(p.avg, 2) : '–'} unit="Stück / Tag" hint="Inklusive Komponenten verkaufter Sets" icon={TrendingUp}/>
      <StatBox label="Reichweite" value={coverage} unit="Tage" hint={!ready ? 'Verkaufsdaten werden noch geladen' : !p.stockKnown ? 'Ohne verlässlichen Bestand nicht berechenbar' : p.coverage === null ? 'Ohne laufenden Bedarf nicht berechenbar' : 'So lange reicht der aktuelle Bestand'} icon={Clock3} tone={p.status === 'critical' ? 'red' : p.status === 'low' ? 'amber' : 'neutral'}/>
      <StatBox label="Jetzt nachbestellen" value={ready ? num(p.suggested, 0) : '–'} unit="Stück" hint={p.committed > 0 ? 'Bereits geplante Mengen sind abgezogen' : 'Vorschlag inklusive Mindestmenge und Verpackung'} icon={ShoppingBag} tone={p.suggested > 0 ? 'green' : 'neutral'}/>
    </div></section>

    <section className="metric-section risk-metric-section" aria-labelledby="product-risk-heading"><header><div><h2 id="product-risk-heading">Nachschubrisiko</h2><p>Erwarteter Fehlbestand innerhalb von Lieferzeit und Sicherheitspuffer.</p></div><span className={`metric-state ${risk === null ? 'state-neutral' : risk > 0 ? 'state-amber' : 'state-green'}`}>{risk === null ? 'Noch nicht berechenbar' : risk > 0 ? 'Nachschub priorisieren' : 'Bedarf gedeckt'}</span></header><div className="stat-grid stat-grid-four">
      <StatBox label="Voraussichtlich ungedeckt" value={risk === null ? '–' : num(risk)} unit="Stück" hint="Prognostizierte Fehlmenge im Planungshorizont" tone={risk !== null && risk > 0 ? 'amber' : 'neutral'}/>
      <StatBox label="Lieferzeit" value={num(p.leadDays, 0)} unit="Tage" hint={p.priority.assumedLeadTime ? 'Vorläufig geschätzt · bitte prüfen' : 'Beim Lieferanten hinterlegt'} icon={Truck} tone={p.priority.assumedLeadTime ? 'amber' : 'neutral'}/>
      <StatBox label="Sicherheitspuffer" value={num(data.settings.safetyDays, 0)} unit="Tage" hint="Zusätzliche Absicherung bei Verzögerungen" icon={PackageCheck}/>
      <StatBox label="Planungshorizont" value={ready ? num(p.priority.horizonDays, 0) : '–'} unit="Tage" hint="Lieferzeit plus Sicherheitspuffer" icon={CalendarDays}/>
    </div>
      {p.priority.overdueIncoming > 0 && <div className="metric-alert"><strong>Zulauf überfällig</strong><p>{num(p.priority.overdueIncoming)} Stück sind verspätet. Der prognostizierte Engpass wird dadurch nicht als gedeckt gewertet.</p></div>}
      <details className="metric-explainer"><summary>Berechnung und Hinweise ansehen</summary><div><p>Die Auswertung nutzt {num(p.avg, 2)} Stück Bedarf pro Tag. Bestätigter Zulauf wird ab dem geplanten Lieferdatum berücksichtigt; eine spätere Lieferung beseitigt keinen vorherigen Engpass.</p>{p.priority.assumedLeadTime && <p>Die Lieferzeit ist vorläufig. Prüfe sie in den Lieferanteneinstellungen.</p>}{p.committed > p.incoming && <p>Bereits geplante Mengen reduzieren den Bestellvorschlag. Bestellentwürfe gelten noch nicht als bestätigte Lieferung.</p>}</div></details>
    </section>

    <section className="metric-section" aria-labelledby="product-sales-heading"><header><div><h2 id="product-sales-heading">Verkäufe & geplante Mengen</h2><p>{data.from && data.until ? `Verkaufszeitraum: ${date(data.from)} bis ${date(data.until)}.` : 'Verkaufsdaten nach dem vollständigen Billbee-Abgleich.'}</p></div></header><div className="stat-grid stat-grid-four">
      <StatBox compact label="Direkt verkauft" value={p.sold === null ? '–' : num(p.sold, 0)} unit="Stück" hint="Verkaufte Artikel im ausgewählten Zeitraum"/>
      <StatBox compact label="Ø Verkauf pro Tag" value={p.salesAvg === null ? '–' : num(p.salesAvg, 2)} unit="Stück / Tag" hint="Direkte Verkäufe · Sets zählen als Set"/>
      <StatBox compact label="Im Zulauf" value={num(p.incoming)} unit="Stück" hint="Noch ausstehende bestätigte Lieferungen"/>
      <StatBox compact label="Bereits eingeplant" value={num(p.committed)} unit="Stück" hint="Entwürfe, Bestellungen und noch abzugleichende Ware"/>
    </div></section>
  </div>;
}
