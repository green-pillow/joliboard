import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';
const store = createStore();
const { app, stop } = createApp({ store });
const production = process.argv.includes('--production');
let vite;
if (production) {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`\n  Joliboard ist bereit: http://${host}:${port}\n`));
async function close() { await stop(); await vite?.close(); server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
