// Chitra hub engine: Muapi client, persistent job store, background poller,
// storyboard pipeline. Used by both the REST API (the APK) and the MCP server (Claude).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPayload, buildPrompt, validate, DEFAULTS } from '../../shared/presets.js';
import * as S from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/catalog.json'), 'utf8'));
const BASE = process.env.MUAPI_BASE || 'https://api.muapi.ai';

export function apiKey() {
  const k = process.env.MUAPI_KEY;
  if (!k) throw new Error('MUAPI_KEY is not set on the server.');
  return k;
}

// ---------- store ----------
let jobs = [];
export async function init() { jobs = await S.loadJSON('jobs.json', []); }
function save() { S.saveJSON('jobs.json', jobs.slice(0, 2000)); }
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function touch(job) { job.updated = Date.now(); save(); for (const fn of listeners) fn(job); }

export const getJob = (id) => jobs.find(j => j.id === id);
export function listJobs({ limit = 50, status, cat, source, favorite, parent } = {}) {
  return jobs.filter(j =>
    (!status || j.status === status) && (!cat || j.cat === cat) && (!source || j.source === source) &&
    (!favorite || j.favorite) && (parent === undefined ? !j.parent : j.parent === parent)
  ).slice(0, limit);
}
export function updateJob(id, patch) {
  const j = getJob(id); if (!j) return null;
  for (const k of ['favorite', 'title', 'tags']) if (k in patch) j[k] = patch[k];
  touch(j); return j;
}
export function deleteJob(id) {
  const i = jobs.findIndex(j => j.id === id); if (i < 0) return false;
  jobs.splice(i, 1); save(); return true;
}

// ---------- muapi ----------
async function muapi(pathname, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method, body,
    headers: { 'x-api-key': apiKey(), ...(body && typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Muapi ${res.status}: ${(data.detail || data.message || text).toString().slice(0, 200)}`);
  return data;
}

export async function uploadBuffer(buf, filename, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime || 'application/octet-stream' }), filename || 'upload.bin');
  const data = await muapi('/api/v1/upload_file', { method: 'POST', body: fd });
  const url = data.url || data.file_url || data.data?.url;
  if (!url) throw new Error('Upload returned no URL');
  return url;
}

export function findModel(idOrCat) {
  return CATALOG.find(m => m.id === idOrCat) || CATALOG.find(m => m.id === DEFAULTS[idOrCat]);
}

export function searchModels({ category, search, limit = 40 } = {}) {
  const q = (search || '').toLowerCase();
  return CATALOG.filter(m => (!category || m.cat === category) &&
    (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)))
    .slice(0, limit);
}

function extractOutputs(r) {
  const out = [];
  const push = (v) => { if (typeof v === 'string' && /^https?:/.test(v)) out.push(v); else if (v?.url) out.push(v.url); };
  for (const v of [].concat(r.outputs || [])) push(v);
  if (!out.length) { push(r.url); push(r.output?.url); for (const v of [].concat(r.images || r.output?.images || [])) push(v); push(r.video?.url); }
  return [...new Set(out)];
}

// ---------- jobs ----------
/**
 * Create and submit a generation job.
 * opts: { model, category, prompt, images, video, audio, last_image, style, camera_move, cine_camera, lens,
 *         character, options, source, parent, title }
 */
export async function createJob(opts) {
  const model = findModel(opts.model || opts.category || 'image');
  if (!model) throw new Error(`Unknown model "${opts.model || opts.category}". Use list_models.`);
  const finalPrompt = buildPrompt(opts);
  const params = { ...(opts.options || {}), prompt: finalPrompt, images: opts.images, video: opts.video,
    audio: opts.audio, last_image: opts.last_image, seed: opts.seed };
  const err = validate(model, params);
  if (err) throw new Error(`${model.name}: ${err}`);
  const payload = buildPayload(model, params);
  const job = {
    id: 'j_' + crypto.randomBytes(6).toString('hex'), model: model.id, modelName: model.name, cat: model.cat,
    prompt: opts.prompt || '', finalPrompt, payload, status: 'submitting', outputs: [], source: opts.source || 'app',
    parent: opts.parent, title: opts.title, created: Date.now(), updated: Date.now(),
    kind: ['video', 'i2v', 'v2v', 'lipsync', 'motion'].includes(model.cat) ? 'video' : 'image',
  };
  jobs.unshift(job); touch(job);
  try {
    const sub = await muapi(`/api/v1/${model.endpoint}`, { method: 'POST', body: JSON.stringify(payload) });
    job.request_id = sub.request_id || sub.id;
    const direct = extractOutputs(sub);
    if (!job.request_id && direct.length) { job.outputs = direct; job.status = 'done'; }
    else job.status = 'running';
  } catch (e) { job.status = 'failed'; job.error = e.message; }
  touch(job);
  return job;
}

const SUCCESS = new Set(['completed', 'succeeded', 'success']);
const FAIL = new Set(['failed', 'error', 'cancelled', 'canceled']);
async function pollOnce(job) {
  try {
    const r = await muapi(`/api/v1/predictions/${job.request_id}/result`);
    const st = String(r.status || '').toLowerCase();
    if (SUCCESS.has(st)) { job.outputs = extractOutputs(r); job.status = job.outputs.length ? 'done' : 'failed'; if (!job.outputs.length) job.error = 'No output returned'; touch(job); }
    else if (FAIL.has(st)) { job.status = 'failed'; job.error = r.error?.message || r.error || r.message || 'Generation failed'; touch(job); }
    else if (Date.now() - job.created > 45 * 60_000) { job.status = 'failed'; job.error = 'Timed out'; touch(job); }
  } catch (e) {
    if (/Muapi 4\d\d/.test(e.message) && !/429/.test(e.message)) { job.status = 'failed'; job.error = e.message; touch(job); }
  }
}
let polling = false;
setInterval(async () => {
  if (polling) return; polling = true;
  try { await Promise.all(jobs.filter(j => j.status === 'running' && j.request_id).slice(0, 25).map(pollOnce)); }
  finally { polling = false; }
}, 3000);

export function waitFor(id, seconds = 0) {
  const j = getJob(id);
  if (!j || seconds <= 0 || ['done', 'failed'].includes(j.status)) return Promise.resolve(j);
  return new Promise(resolve => {
    const t = setTimeout(() => { off(); resolve(getJob(id)); }, seconds * 1000);
    const off = onChange(x => { if (x.id === id && ['done', 'failed'].includes(x.status)) { clearTimeout(t); off(); resolve(x); } });
  });
}

// ---------- storyboard pipeline (beyond Higgsfield: one call → consistent multi-shot film) ----------
/**
 * shots: [{ prompt, camera_move, duration }]
 * Each shot: keyframe image (edit model with character reference if given, else t2i) → animated with i2v + camera move.
 */
export async function createStoryboard({ title, character, character_image, shots, style, aspect_ratio = '16:9',
  image_model, edit_model, video_model, source = 'app' }) {
  if (!shots?.length) throw new Error('Storyboard needs at least one shot.');
  const board = {
    id: 'sb_' + crypto.randomBytes(6).toString('hex'), cat: 'storyboard', kind: 'storyboard', title: title || 'Untitled storyboard',
    prompt: character || '', status: 'running', outputs: [], shots: [], source, created: Date.now(), updated: Date.now(),
    config: { character, character_image, style, aspect_ratio, image_model, edit_model, video_model },
  };
  jobs.unshift(board); touch(board);
  (async () => {
    for (const [i, shot] of shots.entries()) {
      const entry = { index: i, prompt: shot.prompt, camera_move: shot.camera_move, status: 'keyframe' };
      board.shots.push(entry); touch(board);
      try {
        const kf = character_image
          ? await createJob({ model: edit_model || DEFAULTS.edit, prompt: shot.prompt, character, style, images: [character_image],
              options: { aspect_ratio }, source, parent: board.id, title: `Shot ${i + 1} keyframe` })
          : await createJob({ model: image_model || DEFAULTS.image, prompt: shot.prompt, character, style,
              options: { aspect_ratio }, source, parent: board.id, title: `Shot ${i + 1} keyframe` });
        entry.keyframe_job = kf.id;
        const kfDone = await waitFor(kf.id, 600);
        if (kfDone.status !== 'done') throw new Error(kfDone.error || 'Keyframe failed');
        entry.keyframe = kfDone.outputs[0]; entry.status = 'animating'; touch(board);
        const vj = await createJob({ model: video_model || DEFAULTS.i2v, prompt: shot.prompt, camera_move: shot.camera_move, style,
          images: [entry.keyframe], options: { aspect_ratio, ...(shot.duration ? { duration: shot.duration } : {}) },
          source, parent: board.id, title: `Shot ${i + 1}` });
        entry.video_job = vj.id;
        const vDone = await waitFor(vj.id, 1800);
        if (vDone.status !== 'done') throw new Error(vDone.error || 'Animation failed');
        entry.video = vDone.outputs[0]; entry.status = 'done';
        board.outputs.push(entry.video);
      } catch (e) { entry.status = 'failed'; entry.error = e.message; }
      touch(board);
    }
    board.status = board.shots.some(s => s.status === 'done') ? 'done' : 'failed';
    touch(board);
  })();
  return board;
}

// Variations: same prompt across several models or seeds in parallel.
export async function createVariations({ models, count = 1, ...opts }) {
  const list = models?.length ? models : Array(Math.min(count, 6)).fill(opts.model || opts.category || 'image');
  return Promise.all(list.map((m, i) => createJob({ ...opts, model: m, seed: models?.length ? opts.seed : Math.floor(Math.random() * 1e9) + i })));
}

export function summarize(j) {
  if (!j) return null;
  const { payload, ...rest } = j;
  return rest;
}

// ---------- generic multi-step tasks (character pipelines) ----------
export function createTaskJob({ title, kind = 'task', cat = 'task', prompt = '', source = 'app', character }) {
  const job = { id: 't_' + crypto.randomBytes(6).toString('hex'), title, kind, cat, prompt, status: 'running', outputs: [], source, character,
    created: Date.now(), updated: Date.now() };
  jobs.unshift(job); touch(job); return job;
}
export function finishTask(id, patch) { const j = getJob(id); if (!j) return; Object.assign(j, patch); touch(j); }

export const setPublicBase = S.setPublicBase;
export const publicBase = S.getPublicBase;
