import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDemo, emptyState } from './demo.mjs';
export function createStore(directory = path.resolve('data')) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'joliboard.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS state (scope TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const read = db.prepare('SELECT value FROM state WHERE scope = ?');
  const write = db.prepare('INSERT INTO state (scope,value) VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET value=excluded.value');
  return {
    load(scope) {
      const row = read.get(scope);
      if (row) return JSON.parse(row.value);
      const state = scope === 'demo' ? createDemo() : emptyState();
      write.run(scope, JSON.stringify(state));
      return state;
    },
    mutate(scope, fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = this.load(scope);
        const result = fn(state);
        write.run(scope, JSON.stringify(state));
        db.exec('COMMIT');
        return result;
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
    close() { db.close(); },
  };
}
