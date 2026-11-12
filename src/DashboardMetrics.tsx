import { Boxes, Coins, Package, ShoppingBag, TrendingUp } from 'lucide-react';
import type { Dashboard } from './types';
import { num } from './lib';
import StatBox from './StatBox';

export default function DashboardMetrics({ data, days, onBrowse }: { data: Dashboard; days: number; onBrowse: (filter: string, priority?: boolean) => void }) {
  const ready = data.connection.dataReady;
  return <div className="dashboard-kpis">
    <section className="dashboard-kpi-group" aria-labelledby="purchasing-metrics-title" data-tour="purchasing-metrics"><header><h2 id="purchasing-metrics-title">Einkauf & Nachschub</h2><span>Was du als Nächstes planen solltest</span></header><div className="stat-grid stat-grid-three">
      <StatBox label="Jetzt nachbestellen" value={ready ? num(data.stats.reorder, 0) : '–'} unit="Artikel" hint={ready ? 'Artikel mit zusätzlichem Bestellvorschlag' : 'Bestellbedarf nach dem vollständigen Import'} icon={ShoppingBag} tone={data.stats.reorder > 0 ? 'green' : 'neutral'} onClick={() => onBrowse('reorder')}/>
      <StatBox label="Mit Nachschubrisiko" value={ready ? num(data.stats.priorityProducts, 0) : '–'} unit="Artikel" hint="Prognostizierter Bedarf ist nicht vollständig gedeckt" icon={Boxes} tone={data.stats.priorityProducts > 0 ? 'amber' : 'neutral'} onClick={() => onBrowse('risk', true)}/>
      <StatBox label="Geplanter Einkaufswert" value={ready ? num(data.stats.purchaseValue, 2) : '–'} unit="€ netto" hint={data.stats.unknownCost > 0 ? `Ohne Versand · ${data.stats.unknownCost} Artikel mit offenem Einkaufspreis` : 'Bestellvorschläge zu hinterlegten Einkaufspreisen · ohne Versand'} icon={Coins} onClick={() => onBrowse('reorder')}/>
    </div></section>
    <section className="dashboard-kpi-group" aria-labelledby="sales-metrics-title" data-tour="sales-metrics"><header><h2 id="sales-metrics-title">Verkäufe & Sortiment</h2><span>Auswertung der letzten {days} vollständigen Tage</span></header><div className="stat-grid stat-grid-three">
      <StatBox label="Verkauft im Zeitraum" value={data.salesReady ? num(data.stats.unitsSold, 0) : '–'} unit="Stück" hint={`Direkte Verkäufe in ${days} Kalendertagen`} icon={Package}/>
      <StatBox label="Ø Verkauf pro Tag" value={data.salesReady ? num(data.stats.dailySales, 2) : '–'} unit="Stück / Tag" hint="Kalendertage inklusive Tage ohne Verkauf" icon={TrendingUp}/>
      <StatBox label="Artikel im Sortiment" value={num(data.stats.products, 0)} unit="Artikel" hint="Artikel aus dem aktuellen Billbee-Abgleich" icon={Boxes}/>
    </div></section>
  </div>;
}
