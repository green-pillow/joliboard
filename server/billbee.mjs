import { setTimeout as sleep } from 'node:timers/promises';
import { dayKey, shiftDay, normalizeProducts, aggregateSales } from './domain.mjs';
export const CREDENTIAL_NAMES = ['BILLBEE_API_KEY', 'BILLBEE_USERNAME', 'BILLBEE_API_PASSWORD'];
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
function temporaryConnectionError(error) {
  return ['TimeoutError', 'AbortError'].includes(error?.name) || NETWORK_CODES.has(error?.code) || NETWORK_CODES.has(error?.cause?.code) || (error?.name === 'TypeError' && error?.message === 'fetch failed');
}
export function connectionConfig(env = process.env) {
  const missing = CREDENTIAL_NAMES.filter(key => !env[key]?.trim());
  if (!['auto', 'demo', 'live'].includes(env.DATA_MODE || 'auto')) throw new Error('DATA_MODE muss auto, demo oder live sein.');
  const mode = env.DATA_MODE === 'demo' ? 'demo' : env.DATA_MODE === 'live' || missing.length < 3 ? 'live' : 'demo';
  return { mode, configured: missing.length === 0, missing };
}
export function createBillbeeClient({ env = process.env, fetcher = fetch, wait = sleep, progress = () => {}, onCatalog = () => {} } = {}) {
  let lastCall = 0;
  let pageProgress = {};
  const report = (text, detail = {}) => {
    pageProgress = { ...pageProgress, ...detail, updatedAt: new Date().toISOString() };
    progress(text, pageProgress);
  };
  async function retryPage(endpoint, attempt, waitMs, retryReason) {
    const label = endpoint === 'products' ? 'Artikel' : 'Bestellungen';
    const page = pageProgress.page == null ? '' : ` · Seite ${pageProgress.page}`;
    const message = retryReason === 'network' ? 'Verbindung unterbrochen' : retryReason === 'rate-limit' ? 'Billbee begrenzt die Anfragen' : 'Billbee ist vorübergehend ausgelastet';
    const detail = { retryAttempt: attempt + 2, retryMax: 4, retryReason, waitingUntil: new Date(Date.now() + waitMs).toISOString() };
    report(`${message}${page}. Neuer Versuch ${attempt + 2} von 4.`, detail);
    await wait(waitMs);
    report(`${label}${page} · Versuch ${attempt + 2} von 4`, { waitingUntil: null });
  }
  async function request(endpoint, params = {}) {
    if (!connectionConfig(env).configured) throw new Error('Billbee-Zugangsdaten in der .env sind unvollständig.');
    const url = new URL(`https://api.billbee.io/api/v1/${endpoint}`);
    for (const [key, val] of Object.entries(params)) url.searchParams.set(key, String(val));
    for (let attempt = 0; attempt < 4; attempt++) {
      await wait(Math.max(0, 550 - (Date.now() - lastCall)));
      lastCall = Date.now();
      let response;
      try {
        response = await fetcher(url, { headers: { 'X-Billbee-Api-Key': env.BILLBEE_API_KEY.trim(), Authorization: `Basic ${Buffer.from(`${env.BILLBEE_USERNAME.trim()}:${env.BILLBEE_API_PASSWORD}`).toString('base64')}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
      } catch (error) {
        if (temporaryConnectionError(error) && attempt < 3) { await retryPage(endpoint, attempt, 1000 * 2 ** attempt, 'network'); continue; }
        throw new Error(temporaryConnectionError(error) ? 'Die Verbindung zu Billbee ist auch nach 4 Versuchen unterbrochen. Bitte den Abgleich später erneut starten.' : 'Die Billbee-Verbindung konnte nicht hergestellt werden. Bitte die Verbindungseinstellungen prüfen.');
      }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => {});
        if (attempt === 3) throw new Error(`Billbee ist vorübergehend ausgelastet (HTTP ${response.status}). Bitte später erneut versuchen.`);
        const retry = response.headers.get('retry-after');
        const delay = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 1000 * 2 ** attempt;
        if (delay > 60000) throw new Error('Billbee fordert eine längere Wartezeit an. Bitte später synchronisieren.');
        const waitMs = Math.max(1000, Number.isFinite(delay) ? delay : 1000);
        await retryPage(endpoint, attempt, waitMs, response.status === 429 ? 'rate-limit' : 'server');
        continue;
      }
      if (response.status === 401) throw new Error('Billbee-Anmeldung fehlgeschlagen. Benutzername und API-Passwort in der .env prüfen.');
      if (response.status === 403) throw new Error('Billbee verweigert den Zugriff. API-Aktivierung und API-Key prüfen.');
      if (!response.ok) throw new Error(`Billbee-Anfrage fehlgeschlagen (HTTP ${response.status}).`);
      let data;
      try { data = await response.json(); } catch (error) {
        if (temporaryConnectionError(error) && attempt < 3) { await retryPage(endpoint, attempt, 1000 * 2 ** attempt, 'network'); continue; }
        if (temporaryConnectionError(error)) throw new Error('Die Übertragung von Billbee wurde auch nach 4 Versuchen unterbrochen. Bitte den Abgleich später erneut starten.');
        throw new Error('Billbee hat keine gültige JSON-Antwort geliefert.');
      }
      if (data.ErrorCode) throw new Error(`Billbee meldet API-Fehler ${data.ErrorCode}. Bitte die Verbindung prüfen.`);
      if (pageProgress.retryAttempt) report(`${endpoint === 'products' ? 'Artikel' : 'Bestellungen'} · Verbindung wiederhergestellt`, { retryAttempt: 0, retryReason: null, waitingUntil: null });
      return data;
    }
  }
  async function all(endpoint, params) {
    const result = [];
    pageProgress = { stage: endpoint, page: 1, completedPages: 0, totalPages: null, loaded: 0, totalRows: null, waitingUntil: null };
    for (let page = 1; page <= 10000; page++) {
      const label = endpoint === 'products' ? 'Artikel' : 'Bestellungen';
      report(`${label} · Seite ${page}${pageProgress.totalPages == null ? '' : ` von ${pageProgress.totalPages}`}`, { page });
      const data = await request(endpoint, { ...params, page, pageSize: 250 });
      if (!Array.isArray(data.Data)) throw new Error('Unerwartetes Billbee-Datenformat. Bisherige Daten bleiben erhalten.');
      result.push(...data.Data);
      const totalPages = data.Paging?.TotalPages;
      if (totalPages != null && (!Number.isInteger(Number(totalPages)) || Number(totalPages) < 0)) throw new Error('Ungültige Billbee-Seitenangabe.');
      report(`${label} · ${result.length.toLocaleString('de-DE')}${data.Paging?.TotalRows == null ? '' : ` von ${Number(data.Paging.TotalRows).toLocaleString('de-DE')}`} geladen`, {
        page, completedPages: page, loaded: result.length, totalPages: totalPages == null ? null : Number(totalPages), totalRows: data.Paging?.TotalRows == null ? null : Number(data.Paging.TotalRows),
      });
      if (totalPages != null ? page >= Number(totalPages) : data.Data.length < 250) return result;
      if (data.Data.length === 0) throw new Error('Billbee-Synchronisierung unvollständig: leere Zwischenseite.');
    }
    throw new Error('Billbee-Synchronisierung überschreitet das Seitenlimit.');
  }
  return { request, all, async sync() {
    const endDate = dayKey();
    const products = normalizeProducts(await all('products'));
    await onCatalog({ products, sales: [], endDate, syncedAt: null, catalogSyncedAt: new Date().toISOString(), orderCount: 0, source: 'billbee', complete: false });
    // Fetch two extra days to cover both CET/CEST offsets; domain filtering defines the exact window.
    const orders = await all('orders', { minOrderDate: `${shiftDay(endDate, -92)}T00:00:00Z`, maxOrderDate: `${endDate}T23:59:59Z` });
    report('Verkaufsdaten werden ausgewertet', { stage: 'analysis', waitingUntil: null });
    return { products, sales: aggregateSales(orders, products, endDate), directSales: aggregateSales(orders, products, endDate, { explodeBundles: false }), endDate, syncedAt: new Date().toISOString(), orderCount: orders.length, source: 'billbee', complete: true };
  } };
}
