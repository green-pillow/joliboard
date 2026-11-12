import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { pageHash, readPageRoute } from './page-routes';
import './pages.css';

const changed = 'joliboard:navigate';
const currentHash = () => window.location.hash || '#overview';
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback); window.addEventListener('popstate', callback); window.addEventListener(changed, callback);
  return () => { window.removeEventListener('hashchange', callback); window.removeEventListener('popstate', callback); window.removeEventListener(changed, callback); };
}
export function usePageRoute() {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '#overview');
  return readPageRoute(hash);
}
export function navigatePage(hash: string, replace = false) {
  if (currentHash() === hash) return;
  history.replaceState({ ...history.state, joliScroll: window.scrollY }, '', window.location.href);
  const state = { joliParent: currentHash(), joliScroll: 0 };
  if (replace) history.replaceState(state, '', hash); else history.pushState(state, '', hash);
  window.dispatchEvent(new Event(changed));
}
function returnFromPage() {
  const parent = history.state?.joliParent;
  if (typeof parent === 'string' && parent.startsWith('#') && parent !== currentHash()) history.back();
  else navigatePage(pageHash(readPageRoute(currentHash()).section), true);
}

interface PageStateOptions<T> { screen: string; resolve: (params: URLSearchParams) => T | null; encode?: (value: T) => Record<string, string>; resources?: unknown; }
export function usePageState<T>(options: PageStateOptions<T>): [T | null, Dispatch<SetStateAction<T | null>>] {
  const route = usePageRoute();
  const [value, setLocal] = useState<T | null>(null);
  const valueRef = useRef(value);
  const settings = useRef(options); settings.current = options;
  const suppressed = useRef('');
  const identity = (v: T) => JSON.stringify(settings.current.encode?.(v) || {});
  const resolve = useCallback(() => {
    const next = readPageRoute(currentHash());
    if (suppressed.current && suppressed.current !== next.hash) suppressed.current = '';
    if (next.screen !== settings.current.screen) { valueRef.current = null; setLocal(null); return; }
    if (suppressed.current === next.hash) return;
    const resolved = settings.current.resolve(next.params);
    if (resolved !== null && (valueRef.current === null || identity(valueRef.current) !== identity(resolved))) { valueRef.current = resolved; setLocal(resolved); }
  }, []);
  useLayoutEffect(resolve, [route.hash, options.resources, resolve]);
  const setValue: Dispatch<SetStateAction<T | null>> = useCallback(update => {
    const next = typeof update === 'function' ? (update as (prev: T | null) => T | null)(valueRef.current) : update;
    valueRef.current = next; setLocal(next);
    const active = readPageRoute(currentHash());
    if (next !== null) {
      suppressed.current = '';
      navigatePage(pageHash(active.section, settings.current.screen, settings.current.encode?.(next) || {}));
    } else if (active.screen === settings.current.screen) {
      suppressed.current = active.hash;
      returnFromPage();
    }
  }, []);
  return [route.screen === options.screen ? value : null, setValue];
}
export function usePageFlag(screen: string): [boolean, (open: boolean) => void] {
  const [value, setValue] = usePageState({ screen, resolve: () => true });
  return [value === true, open => setValue(open ? true : null)];
}

const PageOutlet = createContext<{outlet: HTMLElement | null; setOutlet: (node: HTMLElement | null) => void}>({ outlet: null, setOutlet: () => {} });
export function PageProvider({ children }: { children: ReactNode }) {
  const [outlet, setOutlet] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    let frame = 0;
    const saveScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => history.replaceState({ ...history.state, joliScroll: window.scrollY }, '', window.location.href)); };
    window.addEventListener('scroll', saveScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', saveScroll); history.scrollRestoration = previous; };
  }, []);
  return <PageOutlet.Provider value={{ outlet, setOutlet }}>{children}</PageOutlet.Provider>;
}
export function WorkspacePages({ children }: { children: ReactNode }) {
  const route = usePageRoute();
  const { setOutlet } = useContext(PageOutlet);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => window.scrollTo({ top: Number(history.state?.joliScroll || 0), behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [route.hash]);
  return <><div className={`workspace-view ${!route.screen ? 'is-current' : ''}`} key={route.section} hidden={Boolean(route.screen)}>{children}</div><div className="page-outlet" ref={setOutlet} hidden={!route.screen}><div className="page-loading" role="status">Ansicht wird geladen …</div></div></>;
}
export function DetailPage({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const { outlet } = useContext(PageOutlet);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); const previous = document.title; document.title = `${title} · Joliboard`; return () => { document.title = previous; }; }, [title]);
  const content = <article className={`detail-page ${wide ? 'wide-page' : ''}`}>
    <button type="button" className="text-button detail-back" onClick={onClose}><ArrowLeft size={17}/>Zurück</button>
    <header className="detail-page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1 ref={heading} tabIndex={-1}>{title}</h1></div></header>
    <div className="detail-card card">{children}</div>
  </article>;
  return outlet ? createPortal(content, outlet) : content;
}
