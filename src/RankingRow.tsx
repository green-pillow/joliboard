import { ArrowUpRight } from 'lucide-react';
import type { Product } from './types';
import { ProductArt } from './components';
import { num } from './lib';

function RankingStat({ label, value, unit, warning = false }: { label: string; value: string; unit: string; warning?: boolean }) {
  return <span className={`rank-stat ${warning ? 'rank-stat-warning' : ''}`}><span className="rank-stat-label">{label}</span><span className="rank-stat-number"><strong>{value}</strong><span>{unit}</span></span></span>;
}
export default function RankingRow({ product: p, index, mode, totalSales, onProduct }: { product: Product; index: number; mode: 'sales' | 'risk'; totalSales: number; onProduct: (p: Product) => void }) {
  const risk = mode === 'risk';
  return <button type="button" className={`rank-entry ${risk ? 'rank-entry-risk' : ''}`} onClick={() => onProduct(p)}>
    <span className="rank-entry-heading"><span className="rank-entry-position">{String(index + 1).padStart(2, '0')}</span><ProductArt product={p} small/><span className="rank-entry-product"><strong>{p.name}</strong><small>{p.sku || 'Ohne SKU'}</small></span><ArrowUpRight size={16}/></span>
    <span className="rank-entry-metrics">{risk ? <>
      <RankingStat label="Ungedeckt" value={p.priority.atRiskUnits === null ? '–' : num(p.priority.atRiskUnits)} unit="Stk." warning/>
      <RankingStat label="Ø Bedarf / Tag" value={num(p.avg, 2)} unit="Stk."/>
      <RankingStat label="Reichweite" value={p.coverage === null ? '–' : num(p.coverage)} unit="Tage"/>
    </> : <>
      <RankingStat label="Verkauft" value={p.sold === null ? '–' : num(p.sold, 0)} unit="Stk."/>
      <RankingStat label="Ø Verkauf / Tag" value={p.salesAvg === null ? '–' : num(p.salesAvg, 2)} unit="Stk."/>
      <RankingStat label="Verkaufsanteil" value={p.sold === null ? '–' : num(p.sold / (totalSales || 1) * 100)} unit="%"/>
    </>}</span>
    {risk && <span className="rank-entry-note">{p.priority.overdueIncoming > 0 ? 'Zulauf überfällig · bitte prüfen' : p.committed > p.incoming ? 'Bestellentwurf bereits vorhanden' : p.incoming > 0 ? 'Terminierter Zulauf berücksichtigt' : p.priority.assumedLeadTime ? 'Lieferzeit vorläufig geschätzt' : 'Lieferzeit beim Lieferanten hinterlegt'}</span>}
  </button>;
}
