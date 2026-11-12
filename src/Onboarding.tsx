import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, List, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import type { Dashboard } from './types';
import { navigatePage, usePageRoute } from './page-navigation';
import { ONBOARDING_KEY, onboardingSteps, readTourProgress, tourExamples } from './onboarding-steps';
import type { TourExamples, TourStatus } from './onboarding-steps';
import './onboarding.css';

interface Rect { top: number; left: number; width: number; height: number; }
function visibleTarget(targets: string[]) {
  for (const name of targets) for (const node of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const rect = node.getBoundingClientRect();
    if (!node.closest('[hidden]') && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth && getComputedStyle(node).visibility !== 'hidden') return node;
  }
  return null;
}
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

export default function Onboarding({ data, onStart, onEnd, request = 0 }: { data: Dashboard | null; onStart: () => void; onEnd: () => void; request?: number }) {
  const [initial] = useState(() => { try { return readTourProgress(window.localStorage); } catch { return null; } });
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(initial?.index || 0);
  const [status, setStatus] = useState<TourStatus>(initial?.status || 'paused');
  const [examples, setExamples] = useState<TourExamples>({});
  const [contents, setContents] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [geometry, setGeometry] = useState({ width: window.innerWidth, height: window.innerHeight, cardHeight: 440, cardWidth: 420 });
  const card = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const original = useRef<{hash: string; scroll: number; state: unknown} | null>(null);
  const callbacks = useRef({ onStart, onEnd }); callbacks.current = { onStart, onEnd };
  const triedAutomatic = useRef(false);
  const lastRequest = useRef(0);
  const expectedRoute = useRef('');
  const visitedStep = useRef('');
  const scrolledStep = useRef('');
  const route = usePageRoute();
  const steps = useMemo(() => data ? onboardingSteps(data, examples) : [], [data, examples]);
  const step = steps[index];
  const persist = useCallback((nextIndex: number, nextStatus: TourStatus) => {
    try { window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ index: nextIndex, status: nextStatus })); } catch { /* The tour also works when browser storage is unavailable. */ }
  }, []);
  const start = useCallback((fromStart = false) => {
    if (!data) return;
    original.current = { hash: window.location.hash || '#overview', scroll: window.scrollY, state: history.state };
    callbacks.current.onStart();
    setExamples(tourExamples(data));
    const next = fromStart || ['completed', 'skipped'].includes(status) ? 0 : index;
    setIndex(next); setStatus('active'); setContents(false); setActive(true);
    visitedStep.current = ''; expectedRoute.current = ''; scrolledStep.current = '';
    persist(next, 'active');
  }, [data, status, index, persist]);
  const stop = useCallback((nextStatus: TourStatus, restore = true) => {
    setActive(false); setContents(false); setStatus(nextStatus); persist(index, nextStatus);
    if (restore && original.current) {
      const saved = original.current;
      navigatePage(saved.hash, true);
      history.replaceState({ ...(saved.state as object || {}), joliScroll: saved.scroll }, '', saved.hash);
      requestAnimationFrame(() => window.scrollTo({ top: saved.scroll, behavior: 'instant' }));
    }
    callbacks.current.onEnd();
    original.current = null;
    requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
  }, [index, persist]);
  useEffect(() => {
    if (triedAutomatic.current || !data) return;
    triedAutomatic.current = true;
    if (!initial && !route.screen && request === 0) start(true);
  }, [data, route.screen, start, request]);
  useEffect(() => { if (request > lastRequest.current && data) { lastRequest.current = request; start(true); } }, [request, data, start]);

  useEffect(() => {
    if (!active || !step) return;
    if (visitedStep.current !== step.id || expectedRoute.current !== (step.route || '')) {
      visitedStep.current = step.id; scrolledStep.current = ''; setRect(null);
      expectedRoute.current = step.route || '';
      if (step.route) navigatePage(step.route, true);
      persist(index, 'active');
      return;
    }
    if (expectedRoute.current && route.hash !== expectedRoute.current) stop('paused', false);
  }, [active, index, step, route.hash, persist, stop]);

  useEffect(() => {
    if (!active) return;
    const root = document.getElementById('root') || document.querySelector<HTMLElement>('.app-shell');
    const priorInert = root?.inert;
    const priorHidden = root?.getAttribute('aria-hidden');
    const priorOverflow = document.body.style.overflow;
    card.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    if (root) { root.inert = true; root.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = 'hidden';
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); stop('paused'); }
      if (e.key === 'Tab') {
        const buttons = Array.from(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') || []);
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && (document.activeElement === first || !card.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !card.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => { if (root) { root.inert = priorInert || false; if (priorHidden === null || priorHidden === undefined) root.removeAttribute('aria-hidden'); else root.setAttribute('aria-hidden', priorHidden); } document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', keys, true); };
  }, [active, stop]);

  useLayoutEffect(() => { if (active) { const body = card.current?.querySelector<HTMLElement>('.tour-card-body, .tour-contents'); if (body) body.scrollTop = 0; title.current?.focus({ preventScroll: true }); } }, [active, index, contents]);
  useEffect(() => {
    if (!active || !step) return;
    let frame = 0;
    const measure = () => {
      const width = window.innerWidth, height = window.innerHeight;
      const box = card.current?.getBoundingClientRect();
      const cardHeight = box?.height || Math.min(500, height * .65), cardWidth = box?.width || Math.min(420, width - 24);
      setGeometry(prev => prev.width === width && prev.height === height && Math.abs(prev.cardHeight - cardHeight) < 1 && Math.abs(prev.cardWidth - cardWidth) < 1 ? prev : { width, height, cardHeight, cardWidth });
      const target = visibleTarget(step.targets);
      if (target) {
        const box = target.getBoundingClientRect();
        if (scrolledStep.current !== step.id) {
          scrolledStep.current = step.id;
          if (box.top < 16 || box.bottom > height - (width < 760 ? cardHeight + 28 : 24)) window.scrollTo({ top: Math.max(0, window.scrollY + box.top - 24), behavior: 'instant' });
        }
        const updated = target.getBoundingClientRect();
        const left = Math.max(8, updated.left - 8), top = Math.max(8, updated.top - 8);
        const right = Math.min(width - 8, updated.right + 8), bottom = Math.min(height - (width < 760 ? cardHeight + 28 : 8), updated.bottom + 8);
        const next = right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
        setRect(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      } else setRect(null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule(); const settled = window.setTimeout(schedule, 240);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (card.current) observer?.observe(card.current);
    const mutation = new MutationObserver(schedule);
    const root = document.querySelector('.app-shell');
    if (root) mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(frame); clearTimeout(settled); observer?.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [active, step?.id, route.hash, contents]);

  if (!data || !step) return null;
  if (!active) return createPortal(<button ref={launcher} type="button" className="tour-launcher" onClick={() => start()} aria-label={status === 'paused' && index > 0 ? 'Einführung fortsetzen' : 'Einführung starten'}><span><Sparkles size={21}/></span><span><strong>Einkaufsassistent</strong><small>{status === 'paused' && index > 0 ? `Fortsetzen · Schritt ${index + 1} von ${steps.length}` : 'System Schritt für Schritt verstehen'}</small></span><Play size={15}/></button>, document.body);
  const { width, height, cardHeight, cardWidth } = geometry;
  const candidates = [
    { left: Math.max(12, width - cardWidth - 20), top: Math.max(12, height - cardHeight - 20), width: cardWidth, height: cardHeight },
    { left: 20, top: Math.max(12, height - cardHeight - 20), width: cardWidth, height: cardHeight },
    { left: Math.max(12, width - cardWidth - 20), top: 20, width: cardWidth, height: cardHeight },
    { left: 20, top: 20, width: cardWidth, height: cardHeight },
  ];
  const position = width < 760 ? { left: 12, top: Math.max(12, height - cardHeight - 12) } : rect ? candidates.reduce((best, next) => overlap(next, rect) < overlap(best, rect) ? next : best, candidates[0]) : candidates[0];
  const panels = rect ? [
    { left: 0, top: 0, width, height: rect.top },
    { left: 0, top: rect.top, width: rect.left, height: rect.height },
    { left: rect.left + rect.width, top: rect.top, width: Math.max(0, width - rect.left - rect.width), height: rect.height },
    { left: 0, top: rect.top + rect.height, width, height: Math.max(0, height - rect.top - rect.height) },
  ] : [{ left: 0, top: 0, width, height }];
  return createPortal(<div className="tour-layer">
    <div className="tour-shield" aria-hidden="true">{panels.map((panel, i) => <div className="tour-dim" key={i} style={panel}/>)}{rect && <div className="tour-spotlight" style={rect}>{rect.width > 160 && <span>{step.area}</span>}</div>}</div>
    <aside ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description" style={{ left: position.left, top: position.top }}>
      <header className="tour-card-header"><span className="tour-avatar"><Sparkles size={23}/></span><div><strong>Dein Einkaufsassistent</strong><span>{step.chapter}</span></div><button className="tour-icon-button" onClick={() => stop('paused')} aria-label="Einführung pausieren"><Pause size={17}/></button></header>
      <div className="tour-progress"><span>Schritt {index + 1} von {steps.length}</span><button onClick={() => setContents(!contents)} aria-expanded={contents}><List size={14}/>Inhalt</button><div role="progressbar" aria-label="Fortschritt der Einführung" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / steps.length * 100}%` }}/></div></div>
      {contents ? <div className="tour-contents"><div><h2 id="tour-title" ref={title} tabIndex={-1}>Worüber möchtest du mehr erfahren?</h2><button className="tour-icon-button" onClick={() => setContents(false)} aria-label="Inhaltsübersicht schließen"><X size={16}/></button></div><p id="tour-description" className="sr-only">Wähle ein Thema der Einführung. Dabei werden keine Daten verändert.</p><ol>{steps.map((entry, i) => <li key={entry.id}><button aria-current={i === index ? 'step' : undefined} onClick={() => { setIndex(i); setContents(false); }}><span>{String(i + 1).padStart(2, '0')}</span><span><small>{entry.chapter}</small><strong>{entry.title}</strong></span>{i < index && <Check size={14}/>}</button></li>)}</ol><button className="text-button" onClick={() => { setIndex(0); setContents(false); }}><RotateCcw size={14}/>Von vorn beginnen</button></div> : <div className="tour-card-body">
        <span className="tour-area">{step.targets.length ? `Im Fokus: ${step.area}` : step.area}</span><h2 id="tour-title" ref={title} tabIndex={-1}>{step.title}</h2>
        <div id="tour-description">{step.paragraphs.map(p => <p key={p}>{p}</p>)}</div>
        {index === 0 && route.screen && <p className="tour-context-note">Speichere offene Eingaben vor dem Start. Die Führung wechselt zwischen den Ansichten.</p>}
        {step.points && <ul className="tour-points">{step.points.map(p => <li key={p}><Check size={15}/><span>{p}</span></li>)}</ul>}
        <div className="tour-takeaway"><Sparkles size={16}/><p>{step.takeaway}</p></div>
        {!rect && step.targets.length > 0 && <p className="tour-empty-note">Falls der Bereich noch leer ist: Die Erklärung gilt, sobald die zugehörigen Artikel oder Vorgänge vorhanden sind. Du kannst trotzdem weitergehen.</p>}
      </div>}
      <footer className="tour-card-footer"><div><button className="button" disabled={index === 0} onClick={() => { setIndex(index - 1); setContents(false); }}><ArrowLeft size={15}/>Zurück</button><button className="button primary" onClick={() => { if (index === steps.length - 1) stop('completed'); else { setIndex(index + 1); setContents(false); } }}>{index === 0 ? 'Führung starten' : index === steps.length - 1 ? 'Loslegen' : 'Weiter'}{index === steps.length - 1 ? <Check size={16}/> : <ArrowRight size={16}/>}</button></div><div><button onClick={() => stop('skipped')}>Einführung überspringen</button><span>Esc pausiert</span></div></footer>
    </aside>
  </div>, document.body);
}
