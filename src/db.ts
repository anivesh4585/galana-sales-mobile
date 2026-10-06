import initSqlJs from 'sql.js';
import wasm from 'sql.js/dist/sql-wasm.wasm?url';
import { q, Db } from './repo';

let sqlP: ReturnType<typeof initSqlJs> | undefined;
const SQL = () => (sqlP ??= initSqlJs({ locateFile: () => wasm }));

/** Open + validate a snapshot. Throws (and closes) if it is not safe to install. */
export async function openBytes(b: Uint8Array): Promise<Db> {
  const db = new (await SQL()).Database(b);
  try {
    if (q<{ integrity_check: string }>(db, 'PRAGMA integrity_check')[0].integrity_check !== 'ok') throw new Error('Integrity check failed');
    for (const t of ['fact_sales', 'dim_location', 'dim_product', 'dim_customer', 'app_user', 'user_scope', 'snapshot_metadata'])
      if (!q(db, 'SELECT name FROM sqlite_master WHERE name=?', [t]).length) throw new Error('Missing table ' + t);
    const m = q<{ schema_version: number }>(db, 'SELECT schema_version FROM snapshot_metadata')[0];
    if (!m || m.schema_version !== 1) throw new Error('Unsupported schema_version');
    q(db, 'SELECT COUNT(*) n FROM fact_sales'); // smoke query
    return db;
  } catch (e) { db.close(); throw e; }
}

const idb = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('galana', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
export const saveSnapshot = async (b: Uint8Array) => { const d = await idb(); await new Promise((r) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(b, 'snap'); t.oncomplete = () => r(0); }); };
export const clearSaved = async () => { const d = await idb(); await new Promise((r) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete('snap'); t.oncomplete = () => r(0); }); };
const loadSaved = async (): Promise<Uint8Array | undefined> => { const d = await idb(); return new Promise((r) => { const g = d.transaction('kv').objectStore('kv').get('snap'); g.onsuccess = () => r(g.result); }); };

export async function loadInitial(): Promise<Db> {
  try { const s = await loadSaved(); if (s) return await openBytes(s); } catch { /* fall back to bundled snapshot */ }
  const r = await fetch('/galana_snapshot.sqlite');
  if (!r.ok) throw new Error('No snapshot found. Run: npm run snapshot');
  return openBytes(new Uint8Array(await r.arrayBuffer()));
}
