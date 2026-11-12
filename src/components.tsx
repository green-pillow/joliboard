import type { ReactNode } from 'react';
import { Package, Coffee, Flame, Leaf, BookOpen, Droplets, Square, Layers, CircleHelp } from 'lucide-react';
import type { Product, Status } from './types';
import { date, num } from './lib';
export function Badge({ status }: { status: Status }) { return <span className={`badge ${status}`}><span/>{({ critical: 'Kritisch', low: 'Bald bestellen', healthy: 'Gut versorgt', unknown: 'Bestand fehlt', bundle: 'Stückliste' })[status]}</span>; }
export function ProductArt({ product, small = false }: { product: Product; small?: boolean }) {
  const icons = { cup: Coffee, candle: Flame, plant: Leaf, vase: Droplets, book: BookOpen, cushion: Square, cloth: Layers, tray: Square, watering: Droplets };
  const Icon = icons[product.illustration as keyof typeof icons] || Package;
  return <span className={`product-art ${product.color || 'sage'} ${small ? 'small' : ''}`} aria-hidden="true"><Icon strokeWidth={1.35}/></span>;
}
export function Empty({ icon = <Package size={30}/>, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) { return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><div>{children}</div></div>; }
export function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function SalesChart({ points, compact = false }: { points: { day: string; quantity: number }[]; compact?: boolean }) {
  const max = Math.max(...points.map(p => p.quantity), 1);
  const width = 700, height = compact ? 90 : 140;
  const coords = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * width},${height - 10 - (p.quantity / max) * (height - 25)}`);
  return <div className={`sales-chart ${compact ? 'compact' : ''}`}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Verkaufte Einheiten von ${date(points[0]?.day || null)} bis ${date(points.at(-1)?.day || null)}; insgesamt ${num(points.reduce((s, p) => s + p.quantity, 0), 0)} Stück`} preserveAspectRatio="none"><defs><linearGradient id={compact ? 'fill-small' : 'fill-large'} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#709e83" stopOpacity=".25"/><stop offset="100%" stopColor="#709e83" stopOpacity="0"/></linearGradient></defs>{[.25, .6, .95].map(n => <line key={n} x1="0" y1={height * n} x2={width} y2={height * n} stroke="#ebeeeb" strokeDasharray="3 5"/>)}<path d={`M0,${height} L${coords.join(' L')} L${width},${height} Z`} fill={`url(#${compact ? 'fill-small' : 'fill-large'})`}/><polyline points={coords.join(' ')} fill="none" stroke="#56866e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/></svg><div className="chart-axis"><span>{date(points[0]?.day || null)}</span><span>{date(points[Math.floor(points.length / 2)]?.day || null)}</span><span>{date(points.at(-1)?.day || null)}</span></div></div>;
}
export function Help({ children }: { children: ReactNode }) { return <div className="info-note"><CircleHelp size={17}/><div>{children}</div></div>; }
