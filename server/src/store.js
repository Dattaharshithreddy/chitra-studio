// Persistence: Supabase Storage when SUPABASE_URL + SUPABASE_SECRET_KEY are set (survives
// Render free-tier restarts), otherwise local disk. No SQL/tables needed — just two buckets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
export const remote = !!(SB && KEY);
const STATE = 'chitra-state', FILES = 'chitra-files';
// New sb_secret_ keys go in `apikey`; Authorization is allowed only if identical — works for legacy JWT keys too.
const H = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}` });

let publicBase = process.env.PUBLIC_URL || '';
export function setPublicBase(u) { if (!process.env.PUBLIC_URL && u) publicBase = u.replace(/\/+$/, ''); }
export const getPublicBase = () => publicBase;

export async function init() {
  if (!remote) { console.log('Storage: local disk at', DATA_DIR, '(set SUPABASE_URL + SUPABASE_SECRET_KEY to persist on free hosting)'); return; }
  for (const [id, pub] of [[STATE, false], [FILES, true]]) {
    const r = await fetch(`${SB}/storage/v1/bucket`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id, public: pub }) });
    if (!r.ok) {
      const t = await r.text();
      if (!/exist|duplicate/i.test(t)) throw new Error(`Supabase bucket ${id}: ${r.status} ${t.slice(0, 200)}`);
    }
  }
  console.log('Storage: Supabase', SB);
}

export async function loadJSON(name, fallback) {
  if (remote) {
    const r = await fetch(`${SB}/storage/v1/object/${STATE}/${name}`, { headers: H() });
    if (r.ok) return r.json();
    if (r.status !== 400 && r.status !== 404) throw new Error(`Supabase load ${name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return fallback;
  }
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return fallback; }
}

const timers = {}, pending = {};
export function saveJSON(name, data, delay = 800) {
  pending[name] = data;
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => flush(name).catch(e => console.error('save failed', name, e.message)), delay);
}
async function flush(name) {
  const body = JSON.stringify(pending[name]);
  fs.writeFileSync(path.join(DATA_DIR, name + '.tmp'), body); fs.renameSync(path.join(DATA_DIR, name + '.tmp'), path.join(DATA_DIR, name));
  if (remote) {
    const r = await fetch(`${SB}/storage/v1/object/${STATE}/${name}`, { method: 'POST', body,
      headers: { ...H(), 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}
export async function flushAll() { await Promise.all(Object.keys(pending).map(n => { clearTimeout(timers[n]); return flush(n); })); }

// Store a file and return a permanent public URL.
export async function putFile(rel, buf, type = 'application/octet-stream') {
  if (remote) {
    const r = await fetch(`${SB}/storage/v1/object/${FILES}/${rel}`, { method: 'POST', body: buf, headers: { ...H(), 'Content-Type': type, 'x-upsert': 'true' } });
    if (!r.ok) throw new Error(`Supabase upload ${rel}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return `${SB}/storage/v1/object/public/${FILES}/${rel}`;
  }
  const p = path.join(FILES_DIR, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf);
  return `${publicBase}/files/${rel}`;
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip', json: 'application/json' };
export const typeOf = (f) => TYPES[(f.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// Copy a provider URL (which may expire) into permanent storage. Only when Supabase is configured.
export async function persistUrl(url, prefix) {
  if (!remote || !url || url.startsWith(SB)) return url;
  try {
    const r = await fetch(url); if (!r.ok) return url;
    const ext = (url.split('?')[0].match(/\.(\w{2,4})$/) || [, (r.headers.get('content-type') || '').includes('video') ? 'mp4' : 'png'])[1];
    const name = `${prefix}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    return await putFile(name, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || typeOf(name));
  } catch { return url; }
}
