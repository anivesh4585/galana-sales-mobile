import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDb } from '../scripts/build-snapshot';
import { Auth, Db, summary, byDim, locationDetail, login, pctChange, PERIODS } from './repo';

let db: Db;
beforeAll(async () => { db = (await buildDb('sample-data', 'TEST-001')).db; });

const EXEC: Auth = { user: 'E', name: 'E', role: 'EXECUTIVE', locationIds: [], regionIds: [] };
const MBA: Auth = { user: 'M', name: 'M', role: 'DEPOT_MANAGER', locationIds: ['MBA_DEPOT'], regionIds: [] };
const NBO: Auth = { user: 'N', name: 'N', role: 'REGIONAL_MANAGER', locationIds: [], regionIds: ['NAIROBI'] };
const NONE: Auth = { user: 'X', name: 'X', role: 'VIEWER', locationIds: [], regionIds: [] };
const GOLD = { from: '2026-09-01', to: '2026-09-02' }, SEP = PERIODS.SEP;
const sum = (r: { sales: number }[]) => r.reduce((t, x) => t + x.sales, 0);

describe('golden data (workbook sample)', () => {
  it('all users = 4,095,000', () => expect(summary(db, EXEC, GOLD).total).toBe(4095000));
  it('Mombasa = 3,935,000', () => expect(summary(db, MBA, GOLD).total).toBe(3935000));
  it('fuel 3,935,000 / lubricants 160,000', () => {
    const s = summary(db, EXEC, GOLD);
    expect(s.fuel).toBe(3935000); expect(s.lube).toBe(160000);
  });
  it('Sep totals: all 7,013,000, Mombasa 4,022,000', () => {
    expect(summary(db, EXEC, SEP).total).toBe(7013000);
    expect(summary(db, MBA, SEP).total).toBe(4022000);
  });
});

describe('authorization', () => {
  it('MBA01 only sees Mombasa', () => expect(byDim(db, MBA, SEP, 'loc').map((r) => r.id)).toEqual(['MBA_DEPOT']));
  it('region manager sees only Nairobi locations', () => expect(byDim(db, NBO, SEP, 'loc').map((r) => r.id).sort()).toEqual(['NBO_EAST', 'NBO_WEST']));
  it('MBA01 deep link to Nairobi West is denied', () => expect(() => locationDetail(db, MBA, 'NBO_WEST', SEP)).toThrow('ACCESS DENIED'));
  it('executive can open Mombasa and Nairobi', () => {
    expect(() => locationDetail(db, EXEC, 'MBA_DEPOT', SEP)).not.toThrow();
    expect(() => locationDetail(db, EXEC, 'NBO_WEST', SEP)).not.toThrow();
  });
  it('user with no scope gets zero, not everything', () => expect(summary(db, NONE, SEP).total).toBe(0));
});

describe('reconciliation', () => {
  for (const [n, a] of [['EXEC', EXEC], ['MBA', MBA], ['NBO', NBO]] as [string, Auth][])
    it(`KPI = location = product = customer = day roll-ups (${n})`, () => {
      const t = summary(db, a, SEP).total;
      for (const k of ['loc', 'prod', 'cust', 'day'] as const) expect(sum(byDim(db, a, SEP, k))).toBe(t);
    });
  it('fuel + lubricant = total', () => { const s = summary(db, EXEC, SEP); expect(s.fuel + s.lube).toBe(s.total); });
  it('pctChange returns null for zero comparator', () => { expect(pctChange(10, 0)).toBeNull(); expect(pctChange(120, 100)).toBe(20); });
});

describe('login', () => {
  it('wrong password rejected', async () => { await expect(login(db, 'MBA01', 'bad')).rejects.toThrow('Invalid username or password'); });
  it('inactive user rejected', async () => { await expect(login(db, 'OLD01', 'old123')).rejects.toThrow('Invalid username or password'); });
  it('valid login carries role and scope', async () => {
    const a = await login(db, 'mba01', 'mba123');
    expect(a.role).toBe('DEPOT_MANAGER'); expect(a.locationIds).toEqual(['MBA_DEPOT']);
  });
  it('region scope loaded for NBO01', async () => expect((await login(db, 'NBO01', 'nbo123')).regionIds).toEqual(['NAIROBI']));
});

describe('snapshot validation', () => {
  it('bad quantity fails with the line number', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-'));
    fs.cpSync('sample-data', tmp, { recursive: true });
    const f = path.join(tmp, 'sales.csv');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('S000005,2026-09-03,NBO_EAST,BAMBURI,DIESEL,7000', 'S000005,2026-09-03,NBO_EAST,BAMBURI,DIESEL,ABC'));
    await expect(buildDb(tmp, 'BAD')).rejects.toThrow(/line 11: invalid quantity/);
  });
});
