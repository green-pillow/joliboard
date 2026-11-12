export const money = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value);
export const num = (value: number, digits = 1) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value);
export const date = (value: string | null, full = false) => value ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', ...(full ? { year: 'numeric' as const } : {}), timeZone: 'Europe/Berlin' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : 'Noch nicht synchronisiert';
export const methodLabel = { email: 'E-Mail', portal: 'Händlerportal', manual: 'Manuell' };
export const orderLabel = { draft: 'Entwurf', ordered: 'Bestellt', completed: 'Abgeschlossen', requested: 'Angebot angefragt', issue: 'Klärung', cancelled: 'Storniert' };
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) { const result = await res.json().catch(() => ({})); throw new Error(result.error || `Anfrage fehlgeschlagen (${res.status}).`); }
  return res.json();
}
export function download(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows: unknown[][]) { return '\uFEFF' + rows.map(row => row.map(cell => { let v = String(cell ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replaceAll('"', '""')}"`; }).join(';')).join('\r\n'); }
export async function downloadOrderEmail(orderId: string, kind: 'order' | 'discrepancy' = 'order') {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/email?kind=${kind}`);
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'E-Mail-Entwurf konnte nicht geladen werden.'); }
  const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'bestellung.eml';
  download(filename, await response.text(), 'message/rfc822');
}
