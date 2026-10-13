import { getStore } from '@netlify/blobs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'nesha'; // SET ADMIN_PASSWORD in Netlify!
const SECRET = process.env.SESSION_SECRET || 's:' + ADMIN_PASS;
const COLS = ['players', 'teams', 'umpires', 'matches'];
const SH = ['Day', 'Morning'], TY = ['Batsman', 'Baller', 'All-Rounder'], JZ = ['M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL'];

const load = async () => {
  const d = (await getStore('dzscpl').get('db', { type: 'json' })) || {};
  for (const c of COLS) d[c] ??= {};
  d.cfg ??= {};
  return d;
};
const save = d => getStore('dzscpl').setJSON('db', d);
const mac = b => createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + mac(b); };
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && timingSafeEqual(a, b); };
const verify = t => {
  try { const [b, s] = t.split('.'); if (!eq(s, mac(b))) return null; const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; }
  catch { return null; }
};
const J = o => Response.json(o);
const E = (m, s = 400) => Response.json({ error: m }, { status: s });
const str = (v, n = 60) => String(v ?? '').trim().slice(0, n);
const arr = o => Object.entries(o).map(([id, v]) => ({ id, ...v }));
const cleanPlayer = x => {
  const name = str(x.name);
  if (!name || !SH.includes(x.shift) || !TY.includes(x.type) || !JZ.includes(x.jersey) || !['Yes', 'No'].includes(x.captain)) return null;
  return { name, shift: x.shift, type: x.type, jersey: x.jersey, captain: x.captain, base: Math.max(0, +x.base || 20), status: 'avail', team: '', price: 0 };
};

export default async req => {
  if (req.method !== 'POST') return E('POST only', 405);
  let b; try { b = await req.json(); } catch { return E('Bad request'); }
  const tok = (req.headers.get('authorization') || '').slice(7);
  const u = tok ? verify(tok) : null;
  if (tok && !u && b.op !== 'login') return E('Session expired', 401);
  const role = u?.role, admin = role === 'admin', ump = admin || role === 'umpire';
  const d = await load();

  if (b.op === 'login') {
    const { role: r, id, pass } = b; let p = null;
    if (r === 'Admin' && eq(id, ADMIN_ID) && eq(pass, ADMIN_PASS)) p = { role: 'admin', name: 'Admin' };
    if (r === 'Umpire') { const e = Object.entries(d.umpires).find(([, x]) => x.uid === id && eq(x.pass, pass)); if (e) p = { role: 'umpire', id: e[0], name: e[1].name || e[1].uid }; }
    if (r === 'Team') { const e = Object.entries(d.teams).find(([, x]) => x.name.toLowerCase() === String(id).trim().toLowerCase() && eq(x.pin, pass)); if (e) p = { role: 'team', id: e[0], name: e[1].name }; }
    if (!p) return E('Wrong credentials', 401);
    return J({ user: p, token: sign({ ...p, exp: Date.now() + 12 * 3600e3 }) });
  }

  if (b.op === 'state') {
    return J({
      players: arr(d.players),
      teams: arr(d.teams).map(t => { if (admin) return t; const { pin, ...r } = t; return r; }),
      umpires: admin ? arr(d.umpires) : [],
      matches: arr(d.matches),
      auction: d.cfg.auction || null, awards: d.cfg.awards || {}, reg: d.cfg.reg || {},
    });
  }

  if (b.op === 'bid') {
    if (role !== 'team' && !admin) return E('Only team captains can bid', 403);
    const a = d.cfg.auction, tid = admin ? b.tid : u.id, t = d.teams[tid];
    if (!a || a.status !== 'live' || !t) return E('No live auction');
    if (a.tid === tid) return E('Your team already leads');
    const nb = a.tid ? a.bid + a.step : a.bid;
    const spent = Object.values(d.players).filter(p => p.team === tid && p.status === 'sold').reduce((s, p) => s + (+p.price || 0), 0);
    if (nb > (+t.purse || 0) - spent) return E('Not enough purse for ' + t.name);
    a.bid = nb; a.tid = tid; await save(d);
    return J({ ok: 1 });
  }

  if (b.op === 'write') {
    const { o, path, data = {} } = b;
    if (o === 'add') {
      if (path === 'players') {
        if (!admin && d.cfg.reg?.closed) return E('Registration for players is closed.', 403);
        const p = cleanPlayer(data); if (!p) return E('Invalid player details');
        d.players[randomUUID()] = p;
      } else if (path === 'teams') {
        const name = str(data.name, 40), pin = str(data.pin, 20);
        if (!name || pin.length < 3) return E('Team name and a PIN (3+ chars) are required');
        if (Object.values(d.teams).some(t => t.name.toLowerCase() === name.toLowerCase())) return E('Team name already taken');
        d.teams[randomUUID()] = { name, captain: str(data.captain), pin, purse: admin ? Math.max(0, +data.purse || 1000) : 1000 };
      } else if (!admin) return E('Not allowed', 403);
      else if (path === 'umpires') {
        const uid = str(data.uid, 30), pass = str(data.pass, 40);
        if (!uid || !pass) return E('ID and password required');
        if (Object.values(d.umpires).some(x => x.uid === uid)) return E('Umpire ID exists');
        d.umpires[randomUUID()] = { uid, pass, name: str(data.name, 40) };
      } else if (path === 'matches') {
        if (!d.teams[data.a] || !d.teams[data.b] || data.a === data.b) return E('Pick two different teams');
        d.matches[randomUUID()] = { a: data.a, b: data.b, label: str(data.label), overs: Math.max(1, +data.overs || 6), status: 'upcoming', bat: 'a', ra: 0, wa: 0, ba: 0, rb: 0, wb: 0, bb: 0, win: '', mvp: '' };
      } else return E('Bad path');
    } else if (['set', 'update', 'del'].includes(o)) {
      const [c, id] = String(path).split('/');
      if (c === 'cfg') {
        if (!(admin || (ump && id === 'awards')) || !['auction', 'awards', 'reg'].includes(id)) return E('Not allowed', 403);
        if (o === 'del') delete d.cfg[id]; else d.cfg[id] = o === 'set' ? data : { ...d.cfg[id], ...data };
      } else if (c === 'matches' && ump && o === 'update' && d.matches[id]) {
        const m = d.matches[id];
        for (const [k, v] of Object.entries(data)) {
          if (['ra', 'wa', 'ba', 'rb', 'wb', 'bb'].includes(k)) m[k] = Math.max(0, +v || 0);
          else if (k === 'bat' && ['a', 'b'].includes(v)) m.bat = v;
          else if (k === 'status' && ['upcoming', 'live', 'done'].includes(v)) m.status = v;
          else if (k === 'win' && ['', 'a', 'b', 'tie'].includes(v)) m.win = v;
          else if (k === 'mvp') m.mvp = str(v, 60);
        }
      } else if (!admin) return E('Not allowed', 403);
      else if (COLS.includes(c) && (o === 'del' || d[c][id])) {
        if (o === 'del') delete d[c][id]; else Object.assign(d[c][id], data);
      } else return E('Bad path');
    } else return E('Bad op');
    await save(d);
    return J({ ok: 1 });
  }
  return E('Unknown op');
};
