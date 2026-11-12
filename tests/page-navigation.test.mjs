import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { createDemo } from '../server/demo.mjs';
import { analyze } from '../server/domain.mjs';
import { createWarehouseTicket } from '../server/warehouse.mjs';

test('detail pages support direct links, history, retained list state and in-place form updates', async t => {
  const window = new Window({ url: 'http://localhost:3000/#products' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, history: window.history, Event: window.Event, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const vite = await createServer({ server: { middlewareMode: true, hmr: { port: 24697 } }, optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom' });
  const rootElement = window.document.createElement('div'); window.document.body.append(rootElement);
  const root = createRoot(rootElement);
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); await window.happyDOM.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const nav = await vite.ssrLoadModule('/src/page-navigation.tsx');
  const routes = await vite.ssrLoadModule('/src/page-routes.ts');
  assert.equal(routes.readPageRoute('#orders/order/123').screen, 'order');
  assert.equal(routes.readPageRoute('#orders/order-confirm/123?status=ordered').params.get('status'), 'ordered');
  assert.equal(routes.readPageRoute('#products/order/123').screen, '');
  assert.equal(routes.readPageRoute('#products/product/%bad').screen, '');
  const id = 'article/a b?#';
  assert.equal(routes.readPageRoute(routes.pageHash('products', 'product', { id })).params.get('id'), id);
  let open, close, update, listRenders = 0;
  const resources = [{ id: 'p', name: 'Original' }];
  function Demo() {
    const [record, setRecord] = nav.usePageState({ screen: 'product', resources, encode: p => ({ id: p.id }), resolve: p => resources.find(v => v.id === p.get('id')) || null });
    const [selection, setSelection] = React.useState(0);
    listRenders++;
    open = () => { setSelection(7); setRecord({ id: 'p', name: 'Original' }); };
    close = () => setRecord(null);
    update = () => setRecord(p => ({ ...p, name: 'Edited' }));
    return React.createElement(React.Fragment, null,
      React.createElement(nav.WorkspacePages, null, React.createElement('div', { id: 'selection' }, String(selection))),
      record && React.createElement(nav.DetailPage, { title: record.name, onClose: close }, React.createElement('input', { id: 'record', value: record.name, readOnly: true })));
  }
  await act(async () => root.render(React.createElement(nav.PageProvider, null, React.createElement(Demo))));
  assert.equal(rootElement.querySelector('.workspace-view').hidden, false);
  window.scrollTo(0, 420);
  const entries = window.history.length;
  await act(async () => open());
  assert.equal(window.location.hash, '#products/product/p');
  assert.equal(window.history.length, entries + 1);
  assert.equal(rootElement.querySelector('.workspace-view').hidden, true);
  assert.ok(rootElement.querySelector('.page-outlet .detail-page'));
  assert.equal(rootElement.querySelector('[role="dialog"]'), null);
  await act(async () => update());
  assert.equal(rootElement.querySelector('#record').value, 'Edited');
  assert.equal(window.history.length, entries + 1, 'Typing does not create new history entries');
  await act(async () => { close(); await window.happyDOM.whenAsyncComplete(); });
  assert.equal(window.location.hash, '#products');
  assert.equal(rootElement.querySelector('.workspace-view').hidden, false);
  assert.equal(rootElement.querySelector('#selection').textContent, '7');
  assert.equal(window.history.state.joliScroll, 420);
  assert.equal(window.scrollY, 420);
  await act(async () => { window.history.forward(); await window.happyDOM.whenAsyncComplete(); });
  assert.equal(window.location.hash, '#products/product/p');
  assert.equal(rootElement.querySelector('#record').value, 'Original');
  await act(async () => { nav.navigatePage('#products'); });
  await act(async () => { nav.navigatePage('#products/product/p'); });
  assert.ok(rootElement.querySelector('.detail-page'), 'A direct URL resolves the record without an opener click');
  assert.ok(listRenders > 1);

  // Exercise the real workspace components, without issuing any write requests.
  const state = createDemo();
  const draft = { id: 'o1', reference: 'JB-TEST', supplierId: 's1', supplierName: 'Nordlicht Living', recipient: 'orders@example.test', method: 'email', customerNumber: 'KD-TEST', status: 'draft', intent: 'order', expectedAt: '2026-11-20', subject: 'Testbestellung', body: 'Artikel bestellen', createdAt: new Date().toISOString(), items: [{ productId: 'demo-1', name: 'Keramikbecher Sand', sku: 'NL-101', quantity: 6, cost: 6.9, moq: 6, packSize: 6 }] };
  const placed = { ...draft, id: 'o2', reference: 'JB-PLACED', status: 'ordered' };
  state.orders = [draft, placed];
  const ticket = createWarehouseTicket(state, placed);
  const dashboard = { ...analyze(state, 30), suppliers: state.suppliers, orders: state.orders, warehouseTickets: state.warehouseTickets, settings: state.settings, defaultTemplate: '', emailRouting: { debugRecipient: 'debug@example.test', configured: false, missing: [], from: '', fromName: '' }, connection: { mode: 'demo', configured: false, missing: [], dataReady: true, running: false, syncedAt: state.snapshot.syncedAt } };
  const originalFetch = globalThis.fetch;
  let dashboardRequests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method || 'GET', 'GET', 'Navigation must not write or send anything');
    assert.match(String(url), /^\/api\/dashboard/);
    dashboardRequests++;
    return { ok: true, json: async () => structuredClone(dashboard) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
  await act(async () => { nav.navigatePage('#products/product/demo-1'); root.render(React.createElement(nav.PageProvider, null, React.createElement(App))); });
  assert.equal(rootElement.querySelector('main .detail-page h1').textContent, 'Artikel planen');
  assert.equal(rootElement.querySelector('[aria-modal]'), null);
  await act(async () => nav.navigatePage('#products'));
  const table = rootElement.querySelector('.inventory-table');
  const checkbox = table.querySelector('input[type="checkbox"]:not(:disabled)');
  await act(async () => checkbox.click());
  assert.equal(checkbox.checked, true);
  await act(async () => table.querySelector('.product-name').click());
  assert.ok(rootElement.querySelector('main .detail-page'));
  assert.equal(rootElement.querySelector('.inventory-table'), table, 'The list stays mounted behind its detail page');
  await act(async () => { rootElement.querySelector('.detail-back').click(); await window.happyDOM.whenAsyncComplete(); });
  assert.equal(rootElement.querySelector('.inventory-table'), table);
  assert.equal(checkbox.checked, true, 'Product selection survives detail navigation');
  await act(async () => nav.navigatePage('#suppliers/supplier/s1'));
  assert.ok(rootElement.querySelector('.detail-page input[value="Nordlicht Living"]'));
  await act(async () => nav.navigatePage('#suppliers/supplier/new'));
  assert.equal(rootElement.querySelector('.detail-page h1').textContent, 'Neuer Lieferant');
  await act(async () => nav.navigatePage('#orders/order/o1'));
  assert.ok(rootElement.querySelector('.detail-page .quantity input'));
  await act(async () => nav.navigatePage('#orders/order-confirm/o1?status=ordered'));
  assert.equal(rootElement.querySelector('.detail-page h1').textContent, 'Bestellung aufgegeben?');
  await act(async () => nav.navigatePage(`#warehouse/warehouse-ticket/${ticket.id}`));
  assert.ok(rootElement.querySelector('.detail-page .receipt-lines'));
  await act(async () => nav.navigatePage('#products/product/missing'));
  assert.match(rootElement.querySelector('.detail-page h1').textContent, /nicht verf/);
  assert.equal(dashboardRequests, 1, 'Switching pages reuses the loaded dataset');
});
