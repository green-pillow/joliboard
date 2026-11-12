import type { Product } from './types';
export type ProductSort = 'sales' | 'priority' | 'coverage' | 'stock' | 'name';
export const SORT_LABELS: Record<ProductSort, string> = { sales: 'Bestseller zuerst', priority: 'Nachschubpriorität', coverage: 'Kürzeste Reichweite', stock: 'Niedrigster Bestand', name: 'Produktname A–Z' };
export function sortProducts(products: Product[], sort: ProductSort) {
  return [...products].sort((a, b) => {
    let difference = 0;
    if (sort === 'sales') difference = (b.sold ?? -1) - (a.sold ?? -1);
    if (sort === 'priority') difference = (b.priority.atRiskUnits ?? -1) - (a.priority.atRiskUnits ?? -1) || b.avg - a.avg;
    if (sort === 'coverage') difference = (a.coverage ?? Infinity) - (b.coverage ?? Infinity);
    if (sort === 'stock') difference = (a.stockKnown ? a.stock : Infinity) - (b.stockKnown ? b.stock : Infinity);
    return difference || a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
  });
}
