import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type R = Record<string, string>;

const SCHEMA = `
CREATE TABLE dim_location (location_id TEXT PRIMARY KEY, location_name TEXT NOT NULL, location_type TEXT NOT NULL, region_id TEXT, region_name TEXT);
CREATE TABLE dim_product (product_id TEXT PRIMARY KEY, product_name TEXT NOT NULL, category TEXT NOT NULL, uom TEXT NOT NULL);
CREATE TABLE dim_customer (customer_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, customer_type TEXT);
CREATE TABLE fact_sales (
  sale_id TEXT PRIMARY KEY, sale_date TEXT NOT NULL, location_id TEXT NOT NULL, customer_id TEXT, product_id TEXT NOT NULL,
  quantity REAL NOT NULL, uom TEXT NOT NULL, gross_value REAL, discount_value REAL, net_value REAL NOT NULL, currency TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  FOREIGN KEY(location_id) REFERENCES dim_location(location_id),
  FOREIGN KEY(product_id) REFERENCES dim_product(product_id));
CREATE INDEX ix_sales_date ON fact_sales(sale_date);
CREATE INDEX ix_sales_loc_date ON fact_sales(location_id, sale_date);
CREATE TABLE app_user (user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role_code TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE user_scope (user_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, PRIMARY KEY(user_id, scope_type, scope_id));
CREATE TABLE snapshot_metadata (snapshot_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, period_from TEXT, period_to TEXT, source_note TEXT);
`;

function readCsv(file: string, dir: string): R[] {
  const [h, ...lines] = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cols = h.split(',');
  return lines.map((l, i) => {
    const v = l.split(',');
    if (v.length !== cols.length) throw new Error(`${file} line ${i + 2}: expected ${cols.length} columns, found ${v.length}`);
    return Object.fromEntries(cols.map((c, j) => [c.trim(), v[j].trim()]));
  });
}
const num = (v: string, f: string, line: number, name: string) => {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) throw new Error(`${f} line ${line}: invalid ${name} "${v}"`);
  return n;
};
const need = (v: string | undefined, f: string, line: number, name: string) => {
  if (!v) throw new Error(`${f} line ${line}: ${name} is required`);
  return v;
};
export const hashPw = (pw: string) => crypto.createHash('sha256').update('galana|' + pw).digest('hex');

export async function buildDb(dir: string, snapshotId: string) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(SCHEMA);
  const ins = (sql: string, rows: unknown[][]) => {
    const st = db.prepare(sql);
    rows.forEach((r) => st.run(r as never));
    st.free();
  };

  const loc = readCsv('locations.csv', dir), prod = readCsv('products.csv', dir), cust = readCsv('customers.csv', dir);
  ins('INSERT INTO dim_location VALUES (?,?,?,?,?)', loc.map((r) => [r.location_id, r.location_name, r.location_type, r.region_id, r.region_name]));
  ins('INSERT INTO dim_product VALUES (?,?,?,?)', prod.map((r) => [r.product_id, r.product_name, r.category, r.uom]));
  ins('INSERT INTO dim_customer VALUES (?,?,?)', cust.map((r) => [r.customer_id, r.customer_name, r.customer_type]));

  const L = new Set(loc.map((r) => r.location_id)), P = new Set(prod.map((r) => r.product_id)), C = new Set(cust.map((r) => r.customer_id));
  const sales = readCsv('sales.csv', dir), seen = new Set<string>();
  let csvTotal = 0;
  const rows = sales.map((r, i) => {
    const ln = i + 2, f = 'sales.csv';
    const id = need(r.sale_id, f, ln, 'sale_id');
    if (seen.has(id)) throw new Error(`${f} line ${ln}: duplicate sale_id ${id}`);
    seen.add(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.sale_date)) throw new Error(`${f} line ${ln}: invalid sale_date "${r.sale_date}"`);
    if (!L.has(r.location_id)) throw new Error(`${f} line ${ln}: unknown location_id ${r.location_id}`);
    if (!P.has(r.product_id)) throw new Error(`${f} line ${ln}: unknown product_id ${r.product_id}`);
    if (r.customer_id && !C.has(r.customer_id)) throw new Error(`${f} line ${ln}: unknown customer_id ${r.customer_id}`);
    const net = num(r.net_value, f, ln, 'net_value');
    csvTotal += net;
    return [id, r.sale_date, r.location_id, r.customer_id || null, r.product_id, num(r.quantity, f, ln, 'quantity'), r.uom,
      num(r.gross_value, f, ln, 'gross_value'), num(r.discount_value, f, ln, 'discount_value'), net, r.currency, snapshotId];
  });
  ins('INSERT INTO fact_sales VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', rows);

  ins('INSERT INTO app_user VALUES (?,?,?,?,?,?)', readCsv('users.csv', dir).map((r) => [r.username, r.username.toUpperCase(), hashPw(r.password), r.display_name, r.role_code, Number(r.active)]));
  ins('INSERT INTO user_scope VALUES (?,?,?)', readCsv('user_scopes.csv', dir).map((r) => [r.username, r.scope_type, r.scope_id]));

  const dates = rows.map((r) => r[1] as string).sort();
  ins('INSERT INTO snapshot_metadata VALUES (?,?,?,?,?,?)', [[snapshotId, 1, new Date().toISOString(), dates[0], dates[dates.length - 1], 'Built from CSV extracts']]);

  const dbTotal = db.exec('SELECT SUM(net_value) FROM fact_sales')[0].values[0][0] as number;
  if (Math.abs(dbTotal - csvTotal) > 0.005) throw new Error(`Reconciliation failed: CSV ${csvTotal} vs SQLite ${dbTotal}`);
  return { db, csvTotal, dbTotal, count: rows.length };
}

const entry = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (entry.endsWith('scripts/build-snapshot.ts')) {
  (async () => {
    const id = process.argv[2] ?? 'GALANA-2026-09-10-001';
    const r = await buildDb('sample-data', id);
    const buf = Buffer.from(r.db.export());
    fs.mkdirSync('public', { recursive: true });
    fs.writeFileSync('public/galana_snapshot.sqlite', buf);
    fs.writeFileSync('public/manifest.json', JSON.stringify({
      snapshot_id: id, schema_version: 1, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length, fact_sales_rows: r.count, csv_total_net: r.csvTotal, sqlite_total_net: r.dbTotal }, null, 2));
    console.log(`OK  ${id}  rows=${r.count}  CSV total=${r.csvTotal}  SQLite total=${r.dbTotal}`);
  })().catch((e) => { console.error('BUILD FAILED:', e.message); process.exit(1); });
}
