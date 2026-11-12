export const sections = ['overview', 'products', 'suppliers', 'orders', 'warehouse', 'settings'] as const;
export type Section = typeof sections[number];
export const screens = ['product', 'supplier', 'supplier-remove', 'order', 'order-confirm', 'email', 'warehouse-ticket', 'help', 'priority'] as const;
const allowed: Record<Section, readonly string[]> = { overview: ['product', 'help', 'priority'], products: ['product', 'help'], suppliers: ['supplier', 'supplier-remove', 'help'], orders: ['order', 'order-confirm', 'email', 'help'], warehouse: ['warehouse-ticket', 'help'], settings: ['help'] };
export interface PageRoute { section: Section; screen: string; params: URLSearchParams; hash: string; }
export function readPageRoute(hash: string): PageRoute {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [base, screen = '', id = ''] = path.split('/');
  const section = sections.includes(base as Section) ? base as Section : 'overview';
  const params = new URLSearchParams(query);
  try { if (id) params.set('id', decodeURIComponent(id)); } catch { return { section, screen: '', params: new URLSearchParams(), hash: `#${section}` }; }
  const validScreen = allowed[section].includes(screen) ? screen : '';
  return { section, screen: validScreen, params, hash: `#${section}${validScreen ? `/${validScreen}${id ? `/${id}` : ''}${query ? `?${query}` : ''}` : ''}` };
}
export function pageHash(section: Section, screen = '', values: Record<string, string> = {}) {
  const { id, ...rest } = values;
  const query = new URLSearchParams(rest).toString();
  return `#${section}${screen ? `/${screen}${id ? `/${encodeURIComponent(id)}` : ''}` : ''}${query ? `?${query}` : ''}`;
}
