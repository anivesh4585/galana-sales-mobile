import { ReactNode, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Auth, Db, Row, PERIODS, summary, byDim, locationDetail, login, pctChange, metadata } from './repo';
import { loadInitial, openBytes, saveSnapshot, clearSaved } from './db';

/* ---------- helpers ---------- */
const kes = (n: number) => 'KES ' + Math.round(n).toLocaleString('en-US');
const kesC = (n: number) => 'KES ' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : Math.round(n));
const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hue = (s: string) => ['#1A25AB', '#EA1C26', '#0E7C86', '#6A3FD1', '#E08A00'][[...s].reduce((t, c) => t + c.charCodeAt(0), 0) % 5];

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  pin: <><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h8" /></>,
  db: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pie: <><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
};
const Icon = ({ n, s = 22 }: { n: string; s?: number }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[n]}</svg>
);

const Pct = ({ v, dark }: { v: number | null; dark?: boolean }) =>
  v == null ? <span className="pill na">N/A</span>
    : <span className={'pill ' + (v >= 0 ? 'up' : 'dn')}>{v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%{dark ? '' : ''}</span>;

function Seg<T extends string>({ opts, cur, on }: { opts: [T, string][]; cur: T; on: (k: T) => void }) {
  return <div className="seg">{opts.map(([k, l]) => <button key={k} className={k === cur ? 'on' : ''} onClick={() => on(k)}>{l}</button>)}</div>;
}

function Donut({ a, b }: { a: number; b: number }) {
  const t = a + b || 1, C = 2 * Math.PI * 40;
  return <svg viewBox="0 0 100 100" width="112" height="112">
    <circle cx="50" cy="50" r="40" fill="none" stroke="#1A25AB" strokeWidth="14" />
    <circle cx="50" cy="50" r="40" fill="none" stroke="#EA1C26" strokeWidth="14" strokeDasharray={`${(a / t) * C} ${C}`} transform="rotate(-90 50 50)" />
    <text x="50" y="47" textAnchor="middle" fontSize="8.5" fill="#6b7190">Fuel share</text>
    <text x="50" y="62" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0E1240">{Math.round((a / t) * 100)}%</text>
  </svg>;
}

function Trend({ rows }: { rows: Row[] }) {
  if (!rows.length) return <div className="k">No data for this period.</div>;
  const w = 400, h = 140, pad = 10, m = Math.max(1, ...rows.map((r) => r.sales));
  const P = rows.map((r, i) => [rows.length === 1 ? w / 2 : pad + (i / (rows.length - 1)) * (w - 2 * pad), h - 24 - (r.sales / m) * (h - 44)]);
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${P[P.length - 1][0]},${h - 24} L${P[0][0]},${h - 24} Z`;
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1A25AB" stopOpacity=".3" /><stop offset="1" stopColor="#1A25AB" stopOpacity="0" /></linearGradient></defs>
    <path d={area} fill="url(#ag)" />
    <path d={line} fill="none" stroke="#1A25AB" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    {P.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4.5" fill="#fff" stroke="#EA1C26" strokeWidth="2.5"><title>{rows[i].id}: {kes(rows[i].sales)}</title></circle>)}
    <text x={P[0][0]} y={h - 6} fontSize="10" fill="#6b7190">{rows[0].id.slice(5)}</text>
    <text x={P[P.length - 1][0]} y={h - 6} fontSize="10" fill="#6b7190" textAnchor="end">{rows[rows.length - 1].id.slice(5)}</text>
  </svg>;
}

function List({ rows, kind, onPick }: { rows: Row[]; kind: 'loc' | 'prod' | 'cust'; onPick?: (id: string) => void }) {
  const tot = rows.reduce((t, r) => t + r.sales, 0) || 1, mx = Math.max(1, ...rows.map((r) => r.sales));
  if (!rows.length) return <div className="k">No authorized data.</div>;
  return <>{rows.map((r, i) => (
    <div className={'li' + (onPick ? ' link' : '')} key={r.id} onClick={() => onPick?.(r.id)}>
      {kind === 'cust' ? <div className="av" style={{ background: hue(r.name) }}>{initials(r.name)}</div> : <div className={'rk' + (i === 0 ? ' top1' : '')}>{i + 1}</div>}
      <div className="mid">
        <div className="nm">{r.name}{onPick ? ' ›' : ''}</div>
        <div className="k">{kind === 'prod' ? `${r.qty.toLocaleString()} L · ` : ''}{((r.sales / tot) * 100).toFixed(1)}% of total</div>
        <div className="track"><div className={'bar' + (i === 0 ? ' hot' : '')} style={{ width: `${(r.sales / mx) * 100}%` }} /></div>
      </div>
      <div className="amt"><b>{kesC(r.sales)}</b></div>
    </div>))}</>;
}

const REPORTS = [
  { id: 'sales-date', title: 'Sales by Date', icon: 'cal', dim: 'day' as const },
  { id: 'sales-loc', title: 'Sales by Location', icon: 'pin', dim: 'loc' as const },
  { id: 'prod-perf', title: 'Product Performance', icon: 'drop', dim: 'prod' as const },
  { id: 'cust-sales', title: 'Customer Sales', icon: 'users', dim: 'cust' as const },
];

async function download(name: string, rows: Row[]) {
  const t = 'name,qty,net_sales\n' + rows.map((r) => `"${r.name}",${r.qty},${r.sales}`).join('\n');
  if (Capacitor.isNativePlatform()) {
    const f = await Filesystem.writeFile({ path: name, data: t, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: f.uri });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; a.click();
}

const DEMO: [string, string, string, string][] = [
  ['EXEC01', 'exec123', 'Executive', 'All locations'], ['MBA01', 'mba123', 'Depot Manager', 'Mombasa only'],
  ['NBO01', 'nbo123', 'Regional Mgr', 'Nairobi region'], ['OLD01', 'old123', 'Inactive user', 'Access denied'],
];

/* ---------- app ---------- */
export default function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [err, setErr] = useState('');
  const [a, setA] = useState<Auth | null>(null);
  const [tab, setTab] = useState('home'), [pk, setPk] = useState('SEP'), [det, setDet] = useState<string | null>(null);
  const [cat, setCat] = useState(''), [search, setSearch] = useState(''), [rep, setRep] = useState('sales-date');
  const [msg, setMsg] = useState('');
  const [u, setU] = useState(''), [pw, setPw] = useState('');

  useEffect(() => { loadInitial().then(setDb).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="c"><b className="fail">{err}</b></div>;
  if (!db) return <div className="c">Loading snapshot…</div>;
  const meta = metadata(db);

  if (!a) return (<>
    <div className="hero">
      <svg className="hex" width="260" height="260" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="1.5"><polygon points="50,4 90,27 90,73 50,96 10,73 10,27" /><polygon points="50,20 76,35 76,65 50,80 24,65 24,35" /><polygon points="50,36 62,43 62,57 50,64 38,57 38,43" /></svg>
      <div className="logoCard"><img src="/galana-logo.png" alt="Galana Energies" /></div>
      <h1>Sales Intelligence</h1>
      <p>Fuel &amp; lubricant sales reporting that works even without a network.</p>
    </div>
    <div className="sheet">
      <h3 style={{ marginBottom: 12 }}>Sign in to continue</h3>
      <div className="field"><Icon n="user" s={18} /><input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} /></div>
      <div className="field"><Icon n="lock" s={18} /><input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (document.getElementById('go') as HTMLButtonElement)?.click()} /></div>
      <div className="err">{msg}</div>
      <button id="go" className="cta" onClick={async () => { try { setA(await login(db, u, pw)); setMsg(''); } catch (e: any) { setMsg(e.message); } }}>Sign in</button>
      <div className="k" style={{ marginTop: 16 }}>DEMO USERS · tap to fill</div>
      <div className="demo">{DEMO.map(([un, p, role, scope]) => <button key={un} onClick={() => { setU(un); setPw(p); setMsg(''); }}><b>{un}</b><small>{role} · {scope}</small></button>)}</div>
    </div>
    <div className="foot">Offline-ready · Snapshot {meta.snapshot_id}</div>
  </>);

  const P = PERIODS[pk], prevP = P.prev ? PERIODS[P.prev] : undefined;
  const Per = () => <Seg opts={Object.entries(PERIODS).map(([k, v]) => [k, v.label] as [string, string])} cur={pk} on={setPk} />;
  const first = a.name.split(' ')[0];

  let body: ReactNode;
  if (tab === 'home') {
    const s = summary(db, a, P), ps = prevP ? summary(db, a, prevP).total : 0, locs = byDim(db, a, P, 'loc');
    body = <>
      <Per />
      <div className="big"><div className="lbl">Hello {first} · Total net sales · {P.label}</div><div className="num">{kes(s.total)}</div>
        <Pct v={pctChange(s.total, ps)} /> <span className="k" style={{ color: '#fff', opacity: .8 }}>{prevP ? `vs ${prevP.label}` : 'no comparison period'}</span></div>
      <div className="grid3">
        <div className="mini red"><div className="k">Fuel</div><div className="v">{kesC(s.fuel)}</div></div>
        <div className="mini"><div className="k">Lubricants</div><div className="v">{kesC(s.lube)}</div></div>
        <div className="mini red"><div className="k">Fuel volume</div><div className="v">{(s.fuelLitres / 1000).toFixed(1)}K L</div></div>
      </div>
      <div className="c"><h3>Fuel vs Lubricants <span>by net sales</span></h3>
        <div className="split"><Donut a={s.fuel} b={s.lube} />
          <div className="legend"><div><i style={{ background: '#EA1C26' }} />Fuel <b>{kes(s.fuel)}</b></div><div><i style={{ background: '#1A25AB' }} />Lubricants <b>{kes(s.lube)}</b></div></div></div></div>
      <div className="c"><h3>Daily sales trend <span>{P.label}</span></h3><Trend rows={byDim(db, a, P, 'day')} /></div>
      <div className="c"><h3>Top locations <span>tap to open</span></h3><List rows={locs.slice(0, 3)} kind="loc" onPick={(id) => { setTab('loc'); setDet(id); }} /></div>
    </>;
  } else if (tab === 'loc') {
    if (det) {
      try {
        const d = locationDetail(db, a, det, P, prevP);
        body = <>
          <div className="big"><button className="back" onClick={() => setDet(null)}>← All locations</button>
            <div className="lbl">{d.location.location_name} <span className="tag">{d.location.location_type}</span> · {d.location.region_name}</div>
            <div className="num">{kes(d.total)}</div><Pct v={d.changePct} /> <span className="k" style={{ color: '#fff', opacity: .8 }}>{prevP ? `vs ${prevP.label}` : ''}</span></div>
          <div className="c"><h3>Top products</h3><List rows={d.products} kind="prod" /></div>
          <div className="c"><h3>Top customers</h3><List rows={d.customers} kind="cust" /></div>
          <div className="c"><h3>Daily trend</h3><Trend rows={d.daily} /></div>
          <div className="c"><details><summary className="k">AI evidence (deterministic JSON)</summary><pre>{JSON.stringify({ snapshot: meta.snapshot_id, total: d.total, previous: d.prevTotal, changePct: d.changePct, products: d.products, customers: d.customers }, null, 1)}</pre></details></div></>;
      } catch (e: any) {
        body = <div className="c"><h3 className="fail">{e.message}</h3><p>You are not authorized for this location.</p><button className="back" onClick={() => setDet(null)}>Back</button></div>;
      }
    } else body = <><Per /><div className="c"><h3>Sales by location <span>{P.label}</span></h3><List rows={byDim(db, a, P, 'loc')} kind="loc" onPick={setDet} /></div></>;
  } else if (tab === 'prod') {
    body = <><Per /><Seg opts={[['', 'All'], ['FUEL', 'Fuel'], ['LUBRICANT', 'Lubricants']]} cur={cat} on={setCat} />
      <div className="c"><h3>Product performance <span>{P.label}</span></h3><List rows={byDim(db, a, P, 'prod', { category: cat || undefined })} kind="prod" /></div></>;
  } else if (tab === 'cust') {
    body = <><Per /><div className="c"><div className="search"><Icon n="search" s={18} /><input placeholder="Search customer…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <h3 style={{ marginTop: 10 }}>Key customers <span>{P.label}</span></h3><List rows={byDim(db, a, P, 'cust').filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))} kind="cust" /></div></>;
  } else if (tab === 'rep') {
    const def = REPORTS.find((r) => r.id === rep)!, rows = byDim(db, a, P, def.dim);
    const tn = rows.reduce((t, r) => t + r.sales, 0), tq = rows.reduce((t, r) => t + r.qty, 0), ok = Math.round(tn) === Math.round(summary(db, a, P).total);
    body = <><Per /><div className="tiles">{REPORTS.map((r) => <button key={r.id} className={'tile' + (r.id === rep ? ' on' : '')} onClick={() => setRep(r.id)}><Icon n={r.icon} /><b>{r.title}</b></button>)}</div>
      <div className="c"><h3>{def.title} <span>{P.label}</span></h3>
        <table><thead><tr><th>Name</th><th>Qty</th><th>Net sales</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.qty.toLocaleString()}</td><td>{Math.round(r.sales).toLocaleString()}</td></tr>)}</tbody>
          <tfoot><tr><th>TOTAL</th><th>{tq.toLocaleString()}</th><th>{Math.round(tn).toLocaleString()}</th></tr></tfoot></table>
        <p className="k">Reconciles to Home total: <span className={ok ? 'ok' : 'fail'}>{ok ? '✔ PASS' : '✘ FAIL'}</span></p>
        <button className="ghost" onClick={() => download(`${def.id}_${pk}.csv`, rows)}>⬇ Export CSV</button></div></>;
  } else {
    body = <div className="c"><h3>Data &amp; snapshot</h3>
      <p style={{ margin: '0 0 8px' }}>Snapshot <b>{meta.snapshot_id}</b><br /><span className="k">Data as of {meta.period_to} · schema v{meta.schema_version} · built {meta.created_at}</span></p>
      <p className="k">Import a newer .sqlite snapshot. It is validated first (integrity, tables, schema version); on failure the current data stays active.</p>
      <input type="file" accept=".sqlite" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { const bytes = new Uint8Array(await f.arrayBuffer()); const nd = await openBytes(bytes); await saveSnapshot(bytes); setDb(nd); setA(null); }
        catch (x: any) { setMsg('IMPORT REJECTED: ' + x.message + ' — previous snapshot still active.'); }
      }} />
      <div className={msg.startsWith('IMPORT') ? 'err' : ''}>{msg}</div>
      <button className="ghost" style={{ marginTop: 8 }} onClick={async () => { await clearSaved(); location.reload(); }}>Reset to bundled snapshot</button></div>;
  }

  const tabs: [string, string, string][] = [['home', 'Home', 'home'], ['loc', 'Locations', 'pin'], ['prod', 'Products', 'drop'], ['cust', 'Customers', 'users'], ['rep', 'Reports', 'doc'], ['data', 'Data', 'db']];
  return <>
    <header className="top"><img src="/galana-logo.png" alt="Galana Energies" />
      <div className="who"><div><b>{a.name}</b><small>{a.role.replace('_', ' ')}</small><button onClick={() => { setA(null); setTab('home'); setDet(null); setPw(''); }}>Log out</button></div>
        <div className="av" style={{ background: hue(a.user) }}>{initials(a.name)}</div></div></header>
    <div className="fresh"><i />Data as of {meta.period_to} · {meta.snapshot_id} · works offline</div>
    {body}
    <nav>{tabs.map(([k, l, ic]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setDet(null); setMsg(''); }}><Icon n={ic} s={21} />{l}</button>)}</nav>
  </>;
}
