import { ArrowUpRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export default function StatBox({ label, value, unit, hint, icon: Icon, tone = 'neutral', onClick, compact = false }: { label: string; value: string; unit?: string; hint?: string; icon?: LucideIcon; tone?: 'neutral' | 'green' | 'amber' | 'red'; onClick?: () => void; compact?: boolean }) {
  const content = <><div className="stat-box-heading"><span>{label}</span>{Icon && <Icon size={18} aria-hidden="true"/>}</div><div className="stat-box-number"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>{hint && <p className="stat-box-hint">{hint}</p>}{onClick && <span className="stat-box-action">Artikel ansehen<ArrowUpRight size={14}/></span>}</>;
  const className = `stat-box stat-${tone}${compact ? ' stat-compact' : ''}${onClick ? ' stat-interactive' : ''}`;
  return onClick ? <button type="button" className={className} onClick={onClick}>{content}</button> : <div className={className} role="group" aria-label={label}>{content}</div>;
}
