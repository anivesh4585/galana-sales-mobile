import type { Database } from 'sql.js';

export type Db = Database;
export type Auth = { user: string; name: string; role: string; locationIds: string[]; regionIds: string[] };
export type Period = { from: string; to: string };
export type Row = { id: string; name: string; sales: number; qty: number };
export type Dim = 'loc' | 'prod' | 'cust' | 'day';

export const PERIODS: Record<string, Period & { label: string; prev?: string }> = {
  SEP: { label: 'Sep 2026', from: '2026-09-01', to: '2026-09-30', prev: 'AUG' },
  AUG: { label: 'Aug 2026', from: '2026-08-01', to: '2026-08-31' },
  ALL: { label: 'All', from: '2026-01-01', to: '2026-12-31' },
};

export function q<T = Record<string, any>>(db: Db, sql: string, params: unknown[] = []): T[] {
  const st = db.prepare(sql);
  st.bind(params as never);
  const out: T[] = [];
  while (st.step()) out.push(st.getAsObject() as T);
  st.free();
  return out;
}

export const pctChange = (cur: number, prev: number): number | null => (prev === 0 ? null : ((cur - prev) / prev) * 100);
const isFull = (a: Auth) => a.role === 'ADMIN' || a.role === 'EXECUTIVE';

/** The AUTHORITY-CHECK equivalent: scope is built INTO every query. */
export function scope(a: Auth, col: string): { sql: string; params: string[] } {
  if (isFull(a)) return { sql: '1=1', params: [] };
  const parts: string[] = [], params: string[] = [];
  const marks = (n: number) => Array(n).fill('?').join(',');
  if (a.locationIds.length) { parts.push(`${col} IN (${marks(a.locationIds.length)})`); params.push(...a.locationIds); }
  if (a.regionIds.length) {
    parts.push(`${col} IN (SELECT location_id FROM dim_location WHERE region_id IN (${marks(a.regionIds.length)}))`);
    params.push(...a.regionIds);
  }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : { sql: '1=0', params: [] };
}

export function summary(db: Db, a: Auth, p: Period) {
  const sc = scope(a, 's.location_id');
  return q<{ total: number; fuel: number; lube: number; fuelLitres: number }>(db,
    `SELECT COALESCE(SUM(s.net_value),0) total,
            COALESCE(SUM(CASE WHEN pr.category='FUEL' THEN s.net_value END),0) fuel,
            COALESCE(SUM(CASE WHEN pr.category='LUBRICANT' THEN s.net_value END),0) lube,
            COALESCE(SUM(CASE WHEN pr.category='FUEL' THEN s.quantity END),0) fuelLitres
     FROM fact_sales s JOIN dim_product pr ON pr.product_id=s.product_id
     WHERE s.sale_date BETWEEN ? AND ? AND ${sc.sql}`, [p.from, p.to, ...sc.params])[0];
}

const DIM: Record<Dim, [string, string, string]> = {
  loc: ['s.location_id', 'l.location_name', 'JOIN dim_location l ON l.location_id=s.location_id'],
  prod: ['pr.product_id', 'pr.product_name', ''],
  cust: ['s.customer_id', 'c.customer_name', 'JOIN dim_customer c ON c.customer_id=s.customer_id'],
  day: ['s.sale_date', 's.sale_date', ''],
};

export function byDim(db: Db, a: Auth, p: Period, k: Dim, o: { category?: string; locationId?: string } = {}): Row[] {
  const [id, nm, join] = DIM[k], sc = scope(a, 's.location_id');
  const extra = (o.category ? ' AND pr.category=?' : '') + (o.locationId ? ' AND s.location_id=?' : '');
  const params = [p.from, p.to, ...sc.params, ...(o.category ? [o.category] : []), ...(o.locationId ? [o.locationId] : [])];
  return q<Row>(db,
    `SELECT ${id} id, ${nm} name, SUM(s.net_value) sales, SUM(s.quantity) qty
     FROM fact_sales s JOIN dim_product pr ON pr.product_id=s.product_id ${join}
     WHERE s.sale_date BETWEEN ? AND ? AND ${sc.sql}${extra}
     GROUP BY ${id}, ${nm} ORDER BY ${k === 'day' ? 'id' : 'sales DESC'}`, params);
}

export function canViewLocation(db: Db, a: Auth, locationId: string): boolean {
  const sc = scope(a, 'l.location_id');
  return q(db, `SELECT 1 FROM dim_location l WHERE l.location_id=? AND ${sc.sql}`, [locationId, ...sc.params]).length > 0;
}

/** Location 360 – UI guard AND scoped SQL. Also returns the evidence an AI layer would use. */
export function locationDetail(db: Db, a: Auth, id: string, p: Period, prev?: Period) {
  if (!canViewLocation(db, a, id)) throw new Error('ACCESS DENIED');
  const sum = (r: Row[]) => r.reduce((t, x) => t + x.sales, 0);
  const products = byDim(db, a, p, 'prod', { locationId: id });
  const total = sum(products);
  const prevTotal = prev ? sum(byDim(db, a, prev, 'prod', { locationId: id })) : null;
  return {
    location: q<{ location_name: string; location_type: string; region_name: string }>(db, 'SELECT * FROM dim_location WHERE location_id=?', [id])[0],
    total, prevTotal, changePct: prevTotal == null ? null : pctChange(total, prevTotal),
    products, customers: byDim(db, a, p, 'cust', { locationId: id }), daily: byDim(db, a, p, 'day', { locationId: id }),
  };
}

export const metadata = (db: Db) => q<{ snapshot_id: string; schema_version: number; created_at: string; period_from: string; period_to: string }>(db, 'SELECT * FROM snapshot_metadata')[0];

const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function login(db: Db, username: string, password: string): Promise<Auth> {
  const u = q<any>(db, 'SELECT * FROM app_user WHERE username=?', [username.trim().toUpperCase()])[0];
  if (!u || !u.is_active || u.password_hash !== (await sha('galana|' + password))) throw new Error('Invalid username or password');
  const sc = q<{ t: string; i: string }>(db, 'SELECT scope_type t, scope_id i FROM user_scope WHERE user_id=?', [u.user_id]);
  return {
    user: u.username, name: u.display_name, role: u.role_code,
    locationIds: sc.filter((x) => x.t === 'LOCATION').map((x) => x.i),
    regionIds: sc.filter((x) => x.t === 'REGION').map((x) => x.i),
  };
}
