import { CAMERA_MOVES, STYLES, LENSES, CINE_CAMERAS, DEFAULTS, buildPrompt, buildPayload, validate } from './presets.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('chitra.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('chitra.' + k, JSON.stringify(v)); } catch {} },
};
const Cap = window.Capacitor;
const Plugins = Cap?.Plugins || {};
const toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); };

let CATALOG = [];
const settings = Object.assign({ mode: 'hub', hubUrl: '', token: '', muapiKey: '' }, store.get('settings', {}));

// ================= Backends =================
const VIDEO_CATS = ['video', 'i2v', 'v2v', 'lipsync', 'motion'];
const Hub = {
  base: () => settings.hubUrl.replace(/\/+$/, ''),
  async req(path, opts = {}) {
    const r = await fetch(this.base() + path, { ...opts, headers: { Authorization: 'Bearer ' + settings.token, ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  },
  ping() { return this.req('/api/ping'); },
  generate(body) { return this.req('/api/generate', { method: 'POST', body: JSON.stringify(body) }); },
  variations(body) { return this.req('/api/variations', { method: 'POST', body: JSON.stringify(body) }); },
  storyboard(body) { return this.req('/api/storyboard', { method: 'POST', body: JSON.stringify(body) }); },
  jobs() { return this.req('/api/jobs?limit=200'); },
  patch(id, p) { return this.req('/api/jobs/' + id, { method: 'PATCH', body: JSON.stringify(p) }); },
  del(id) { return this.req('/api/jobs/' + id, { method: 'DELETE' }); },
  async upload(file) {
    const r = await fetch(`${this.base()}/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': file.type || 'application/octet-stream' } });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d.url;
  },
  listen(cb) {
    if (this.es) this.es.close();
    try {
      this.es = new EventSource(`${this.base()}/api/events?token=${encodeURIComponent(settings.token)}`);
      this.es.onmessage = (e) => cb(JSON.parse(e.data));
    } catch {}
  },
};

// Direct mode: talk to Muapi from the phone, keep history locally.
const Direct = {
  BASE: 'https://api.muapi.ai',
  jobsList: store.get('directJobs', []),
  save() { store.set('directJobs', this.jobsList.slice(0, 300)); },
  // On the phone use the native HTTP plugin (no CORS); in a browser fall back to fetch.
  async mu(path, opts = {}) {
    const headers = { 'x-api-key': settings.muapiKey, ...(typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}) };
    let status, d;
    if (Plugins.CapacitorHttp && Cap?.isNativePlatform?.()) {
      const r = await Plugins.CapacitorHttp.request({ url: this.BASE + path, method: opts.method || 'GET', headers: { ...headers, ...(opts.headers || {}) },
        data: opts.formData || (opts.body ? JSON.parse(opts.body) : undefined), ...(opts.formData ? { dataType: 'formData' } : {}), connectTimeout: 60000, readTimeout: 300000 });
      status = r.status; d = typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return { raw: r.data }; } })() : r.data;
    } else {
      let body = opts.body;
      if (opts.file) { body = new FormData(); body.append('file', opts.file, opts.file.name); }
      const r = await fetch(this.BASE + path, { method: opts.method || 'GET', body, headers });
      status = r.status; const t = await r.text(); try { d = JSON.parse(t); } catch { d = { raw: t }; }
    }
    if (status < 200 || status >= 300) throw new Error(`Muapi ${status}: ${String(d?.detail || d?.message || d?.raw || '').slice(0, 160)}`);
    return d;
  },
  async ping() { if (!settings.muapiKey) throw new Error('Add your Muapi key'); return { ok: true, hasKey: true }; },
  async generate(o) {
    const model = CATALOG.find(m => m.id === o.model) || CATALOG.find(m => m.id === DEFAULTS[o.category]);
    const finalPrompt = buildPrompt(o);
    const params = { ...(o.options || {}), prompt: finalPrompt, images: o.images, video: o.video, audio: o.audio, last_image: o.last_image, seed: o.seed };
    const err = validate(model, params); if (err) throw new Error(err);
    const job = { id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), model: model.id, modelName: model.name, cat: model.cat,
      kind: VIDEO_CATS.includes(model.cat) ? 'video' : 'image', prompt: o.prompt || '', finalPrompt, status: 'running', outputs: [], source: 'app',
      parent: o.parent, title: o.title, created: Date.now() };
    try {
      const sub = await this.mu('/api/v1/' + model.endpoint, { method: 'POST', body: JSON.stringify(buildPayload(model, params)) });
      job.request_id = sub.request_id || sub.id;
      if (!job.request_id) { job.outputs = [].concat(sub.outputs || sub.url || []); job.status = 'done'; }
    } catch (e) { job.status = 'failed'; job.error = e.message; }
    this.jobsList.unshift(job); this.save(); return job;
  },
  async variations(o) { const n = Number(o.count) || 1; const out = []; for (let i = 0; i < n; i++) out.push(await this.generate({ ...o, seed: Math.floor(Math.random() * 1e9) })); return out; },
  async storyboard(o) {
    const board = { id: 'sb_' + Date.now().toString(36), kind: 'storyboard', cat: 'storyboard', title: o.title || 'Storyboard', prompt: o.character || '', status: 'running', outputs: [], shots: [], source: 'app', created: Date.now() };
    this.jobsList.unshift(board); this.save();
    (async () => {
      for (const [i, s] of o.shots.entries()) {
        const e = { index: i, prompt: s.prompt, camera_move: s.camera_move, status: 'keyframe' }; board.shots.push(e); this.save(); emit(board);
        try {
          const kf = await this.generate({ model: o.character_image ? DEFAULTS.edit : DEFAULTS.image, prompt: s.prompt, character: o.character, style: o.style, images: o.character_image ? [o.character_image] : undefined, options: { aspect_ratio: o.aspect_ratio }, parent: board.id, title: `Shot ${i + 1} keyframe` });
          const k = await this.waitDone(kf.id); e.keyframe = k.outputs[0]; e.status = 'animating'; emit(board);
          const vj = await this.generate({ model: DEFAULTS.i2v, prompt: s.prompt, camera_move: s.camera_move, style: o.style, images: [e.keyframe], options: { aspect_ratio: o.aspect_ratio }, parent: board.id, title: `Shot ${i + 1}` });
          const v = await this.waitDone(vj.id); e.video = v.outputs[0]; e.status = 'done'; board.outputs.push(e.video);
        } catch (err) { e.status = 'failed'; e.error = err.message; }
        this.save(); emit(board);
      }
      board.status = board.shots.some(s => s.status === 'done') ? 'done' : 'failed'; this.save(); emit(board);
    })();
    return board;
  },
  waitDone(id) {
    return new Promise((res, rej) => { const t = setInterval(() => { const j = this.jobsList.find(x => x.id === id); if (!j) return; if (j.status === 'done') { clearInterval(t); res(j); } if (j.status === 'failed') { clearInterval(t); rej(new Error(j.error)); } }, 1500); });
  },
  async jobs() { return this.jobsList.filter(j => !j.parent); },
  async patch(id, p) { const j = this.jobsList.find(x => x.id === id); Object.assign(j, p); this.save(); return j; },
  async del(id) { this.jobsList = this.jobsList.filter(x => x.id !== id); this.save(); },
  async upload(file) {
    let opts = { method: 'POST', file };
    if (Plugins.CapacitorHttp && Cap?.isNativePlatform?.()) {
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });
      opts = { method: 'POST', formData: [{ key: 'file', value: b64, type: 'base64File', contentType: file.type || 'application/octet-stream', fileName: file.name || 'upload' }] };
    }
    const d = await this.mu('/api/v1/upload_file', opts);
    const url = d.url || d.file_url || d.data?.url; if (!url) throw new Error('No URL from upload'); return url;
  },
  listen() {
    clearInterval(this.timer);
    this.timer = setInterval(async () => {
      for (const j of this.jobsList.filter(x => x.status === 'running' && x.request_id)) {
        try {
          const r = await this.mu(`/api/v1/predictions/${j.request_id}/result`);
          const st = String(r.status || '').toLowerCase();
          if (['completed', 'succeeded', 'success'].includes(st)) { j.outputs = [].concat(r.outputs || r.url || r.output?.url || []).map(x => x.url || x); j.status = 'done'; }
          else if (['failed', 'error', 'cancelled', 'canceled'].includes(st)) { j.status = 'failed'; j.error = r.error?.message || r.error || 'Failed'; }
          else continue;
          this.save(); emit(j);
        } catch {}
      }
    }, 3000);
  },
};
const B = () => settings.mode === 'hub' ? Hub : Direct;

// ================= Navigation =================
function go(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  if (view === 'gallery') refreshGallery();
  if (view === 'chars') { CH.current ? openChar(CH.current.id) : loadChars(); }
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

function chips(el, items, selected, onPick, { multi = false } = {}) {
  el.innerHTML = '';
  for (const [val, label] of items) {
    const b = document.createElement('button'); b.className = 'chip' + (val === selected ? ' on' : ''); b.textContent = label;
    b.onclick = () => { [...el.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); onPick(val); };
    el.appendChild(b);
  }
}
const pretty = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const CAM_ICONS = { none: '∅', dolly_in: '⇥', dolly_out: '⇤', crash_zoom_in: '💥', crash_zoom_out: '🔭', dolly_zoom: '🌀', orbit_360: '⟳', arc_left: '↶', arc_right: '↷', crane_up: '⤴', crane_down: '⤵', tilt_up: '⇡', tilt_down: '⇣', whip_pan: '💨', pan_left: '←', pan_right: '→', bullet_time: '⏱', fpv_drone: '🛸', aerial_flyover: '🦅', handheld: '✋', snorricam: '🎯', head_tracking: '👤', tracking_follow: '🏃', low_angle_hero: '🦸', through_object: '🕳', timelapse: '⏩', static: '▣' };

// ================= Media picking =================
function pickFile(accept) {
  return new Promise(res => { const f = $('#filePick'); f.accept = accept; f.value = ''; f.onchange = () => res(f.files[0]); f.click(); });
}
async function fillSlot(slot, accept, onUrl) {
  const file = await pickFile(accept); if (!file) return;
  const local = URL.createObjectURL(file);
  slot.classList.add('busy', 'filled'); setSlotPreview(slot, local, file.type);
  try { const url = await B().upload(file); onUrl(url); toast('Uploaded'); }
  catch (e) { toast('Upload failed: ' + e.message); clearSlot(slot); onUrl(null); }
  finally { slot.classList.remove('busy'); }
}
function setSlotPreview(slot, url, type = '') {
  slot.querySelector('video')?.remove(); slot.querySelector('.x')?.remove();
  slot.classList.add('filled');
  if (type.startsWith('video') || /\.(mp4|webm|mov)(\?|$)/i.test(url)) { const v = document.createElement('video'); v.src = url; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; slot.appendChild(v); slot.style.backgroundImage = ''; }
  else if (type.startsWith('audio') || /\.(mp3|wav|m4a)(\?|$)/i.test(url)) { slot.style.backgroundImage = ''; slot.dataset.label = slot.querySelector('span').textContent; slot.querySelector('span').textContent = '🎵 audio'; slot.classList.remove('filled'); slot.style.borderColor = 'var(--acc2)'; }
  else slot.style.backgroundImage = `url("${url}")`;
  const x = document.createElement('div'); x.className = 'x'; x.textContent = '✕'; x.onclick = (e) => { e.stopPropagation(); clearSlot(slot); slot.dispatchEvent(new Event('cleared')); }; slot.appendChild(x);
}
function clearSlot(slot) { slot.classList.remove('filled'); slot.style.backgroundImage = ''; slot.style.borderColor = ''; slot.querySelector('video')?.remove(); slot.querySelector('.x')?.remove(); if (slot.dataset.label) slot.querySelector('span').textContent = slot.dataset.label; }

// ================= CREATE =================
const MODES = [['image', '🖼 Image'], ['video', '🎬 Video'], ['i2v', '✨ Animate'], ['edit', '✎ Edit'], ['v2v', '🎞 Restyle video'], ['lipsync', '🗣 Lip sync'], ['motion', '🕺 Motion']];
const C = { mode: store.get('mode', 'image'), model: null, style: 'none', camera: 'none', media: {}, options: {} };

function setMode(mode, keepMedia = false) {
  C.mode = mode; store.set('mode', mode);
  const remembered = store.get('model.' + mode);
  C.model = CATALOG.find(m => m.id === remembered && m.cat === mode) || CATALOG.find(m => m.id === DEFAULTS[mode]) || CATALOG.find(m => m.cat === mode);
  if (!keepMedia) C.media = {};
  C.options = {};
  chips($('#modeChips'), MODES, mode, (m) => setMode(m));
  $('#cameraBlock').hidden = !VIDEO_CATS.includes(mode);
  renderModel();
}
function renderModel() {
  const m = C.model; if (!m) return;
  $('#modelName').textContent = m.name;
  $('#modelMeta').textContent = m.provider ? ' · ' + m.provider : '';
  $('#prompt').parentElement.hidden = !m.prompt;
  // media slots
  const slots = $('#mediaSlots'); slots.innerHTML = '';
  const add = (key, label, accept) => {
    const s = document.createElement('div'); s.className = 'slot'; s.innerHTML = `<span>＋ ${label}</span>`;
    s.onclick = () => fillSlot(s, accept, (u) => { if (u) C.media[key] = u; else delete C.media[key]; });
    s.addEventListener('cleared', () => delete C.media[key]);
    if (C.media[key]) setSlotPreview(s, C.media[key], accept);
    slots.appendChild(s);
  };
  const md = m.media || {};
  if (md.image) { const n = Math.min(md.image.max || 1, 4); for (let i = 0; i < n; i++) add('image' + i, i === 0 ? (md.image.optional ? 'Image (optional)' : 'Image') : 'Ref ' + (i + 1), 'image/*'); if (md.image.last) add('last_image', 'End frame', 'image/*'); }
  if (md.video) add('video', 'Video', 'video/*');
  if (md.audio) add('audio', 'Audio', 'audio/*');
  // options
  const box = $('#modelOptions'); box.innerHTML = '';
  for (const [k, spec] of Object.entries(m.inputs || {})) {
    if (k === 'prompt' || (m.fixed && k in m.fixed)) continue;
    const wrap = document.createElement('div'); wrap.className = 'opt';
    wrap.innerHTML = `<small>${pretty(k)}</small>`;
    let input;
    if (spec.enum) { input = document.createElement('select'); input.innerHTML = spec.enum.map(v => `<option ${v === spec.default ? 'selected' : ''}>${v}</option>`).join(''); }
    else if (spec.type === 'boolean') { input = document.createElement('select'); input.innerHTML = `<option value="true" ${spec.default ? 'selected' : ''}>On</option><option value="false" ${!spec.default ? 'selected' : ''}>Off</option>`; }
    else if (['int', 'integer', 'number', 'float'].includes(spec.type)) { input = document.createElement('input'); input.type = 'number'; if (spec.default !== undefined) input.value = spec.default; if (spec.min !== undefined) input.min = spec.min; if (spec.max !== undefined) input.max = spec.max; }
    else if (spec.type === 'string') { input = document.createElement('input'); input.value = spec.default ?? ''; wrap.classList.add('wide'); }
    else continue;
    input.onchange = () => { let v = input.value; if (spec.type === 'boolean') v = v === 'true'; C.options[k] = v; };
    wrap.appendChild(input); box.appendChild(wrap);
  }
  $('#createHint').textContent = m.desc || '';
}
function collectMedia() {
  const images = Object.keys(C.media).filter(k => /^image\d$/.test(k)).sort().map(k => C.media[k]);
  return { images: images.length ? images : undefined, last_image: C.media.last_image, video: C.media.video, audio: C.media.audio };
}

async function openModelSheet(cats, current, onPick) {
  const sheet = $('#modelSheet'); sheet.hidden = false; const search = $('#modelSearch'); search.value = '';
  const render = () => {
    const q = search.value.toLowerCase();
    const list = CATALOG.filter(m => cats.includes(m.cat) && (!q || (m.name + m.id + m.provider).toLowerCase().includes(q)));
    const groups = {}; for (const m of list) (groups[m.provider || 'Other'] ||= []).push(m);
    $('#modelList').innerHTML = Object.entries(groups).sort().map(([g, ms]) => `<div class="mgroup">${g} · ${ms.length}</div>` +
      ms.map(m => `<div class="mrow ${m.id === current ? 'on' : ''}" data-id="${m.id}"><span>${m.name}</span><small>${m.cat}</small></div>`).join('')).join('') || '<p class="hint">No models match.</p>';
  };
  search.oninput = render; render();
  $('#modelList').onclick = (e) => { const r = e.target.closest('.mrow'); if (!r) return; sheet.hidden = true; onPick(CATALOG.find(m => m.id === r.dataset.id)); };
}
$('#modelSheet').addEventListener('click', (e) => { if (e.target.id === 'modelSheet' || e.target.closest('[data-close]')) $('#modelSheet').hidden = true; });
$('#modelPick').onclick = () => openModelSheet([C.mode], C.model?.id, (m) => { C.model = m; C.options = {}; store.set('model.' + C.mode, m.id); renderModel(); });

const IDEAS = ['A lone astronaut sipping chai on a Martian balcony at dusk', 'A tiger walking through a neon-lit Hyderabad street in the rain', 'Macro shot of a dewdrop holding a tiny galaxy', 'A temple elephant parading under fireworks during a festival', 'A vintage Ambassador car drifting on a mountain road in fog', 'A street food vendor flipping dosas in slow motion, sparks of light', 'A paper boat sailing through a flooded city of books'];
$('#randomBtn').onclick = () => { $('#prompt').value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; };
$('#enhanceBtn').onclick = () => {
  const p = $('#prompt').value.trim(); if (!p) return toast('Write a prompt first');
  const extra = VIDEO_CATS.includes(C.mode) ? 'cinematic motion, natural physics, detailed textures, volumetric light, smooth 24fps' : 'highly detailed, dramatic lighting, sharp focus, rich color, professional composition';
  if (!p.includes('highly detailed') && !p.includes('cinematic motion')) $('#prompt').value = `${p}, ${extra}`;
};

$('#generateBtn').onclick = async () => {
  const btn = $('#generateBtn'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const body = { model: C.model.id, prompt: $('#prompt').value.trim(), style: C.style, camera_move: VIDEO_CATS.includes(C.mode) ? C.camera : undefined, options: C.options, ...collectMedia() };
    const n = Number($('#varCount').value);
    if (n > 1) await B().variations({ ...body, count: n }); else await B().generate(body);
    toast('Generating… check the Gallery'); bumpRunning();
  } catch (e) { toast(e.message, 4000); }
  finally { btn.disabled = false; btn.textContent = 'Generate'; }
};

// ================= CINEMA =================
const CIN = { cam: 'dolly_in', body: 'digital_8k', lens: 'anamorphic', style: 'cinematic', aspect: '16:9', image: null, model: null };
function initCinema() {
  const g = $('#camGrid'); g.innerHTML = '';
  for (const k of Object.keys(CAMERA_MOVES).filter(k => k !== 'none')) {
    const b = document.createElement('button'); b.className = 'cam' + (k === CIN.cam ? ' on' : ''); b.innerHTML = `<b>${CAM_ICONS[k] || '•'}</b>${pretty(k)}`;
    b.onclick = () => { $$('.cam').forEach(c => c.classList.remove('on')); b.classList.add('on'); CIN.cam = k; }; g.appendChild(b);
  }
  chips($('#cineCamChips'), Object.keys(CINE_CAMERAS).map(k => [k, pretty(k)]), CIN.body, v => CIN.body = v);
  chips($('#lensChips'), Object.keys(LENSES).map(k => [k, k === 'none' ? 'Auto' : pretty(k)]), CIN.lens, v => CIN.lens = v);
  chips($('#cinemaStyleChips'), Object.keys(STYLES).map(k => [k, k === 'none' ? 'Natural' : pretty(k)]), CIN.style, v => CIN.style = v);
  chips($('#cinemaAspect'), ['16:9', '9:16', '1:1', '21:9'].map(a => [a, a]), CIN.aspect, v => CIN.aspect = v);
  const slot = $('#cinemaSlot');
  slot.onclick = () => fillSlot(slot, 'image/*', u => { CIN.image = u; updCinemaModel(); });
  slot.addEventListener('cleared', () => { CIN.image = null; updCinemaModel(); });
  $('#cinemaModelPick').onclick = () => openModelSheet([CIN.image ? 'i2v' : 'video'], CIN.model?.id, m => { CIN.model = m; updCinemaModel(true); });
}
function updCinemaModel(keep) {
  const cat = CIN.image ? 'i2v' : 'video';
  if (!keep || CIN.model?.cat !== cat) CIN.model = CATALOG.find(m => m.id === DEFAULTS[cat]);
  $('#cinemaModelName').textContent = CIN.model.name + (CIN.image ? ' · image→video' : ' · text→video');
}
$('#cinemaGo').onclick = async () => {
  const p = $('#cinemaPrompt').value.trim(); if (!p) return toast('Describe the scene');
  try {
    await B().generate({ model: CIN.model.id, prompt: p, camera_move: CIN.cam, cine_camera: CIN.body, lens: CIN.lens, style: CIN.style, images: CIN.image ? [CIN.image] : undefined, options: { aspect_ratio: CIN.aspect }, title: '🎥 ' + pretty(CIN.cam) });
    toast('Rolling… check the Gallery'); bumpRunning();
  } catch (e) { toast(e.message, 4000); }
};

// ================= STORY =================
const SB = { style: 'cinematic', aspect: '16:9', charImage: null, shots: [{ prompt: '', camera_move: 'dolly_in' }, { prompt: '', camera_move: 'tracking_follow' }, { prompt: '', camera_move: 'crane_up' }] };
function renderShots() {
  const box = $('#shots'); box.innerHTML = '';
  SB.shots.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'shot';
    d.innerHTML = `<div class="shot-head"><span>Shot ${i + 1}</span>${SB.shots.length > 1 ? '<button class="ghost sm">Remove</button>' : ''}</div>
      <textarea rows="2" placeholder="What happens in this shot?">${s.prompt}</textarea>
      <select>${Object.keys(CAMERA_MOVES).map(k => `<option value="${k}" ${k === s.camera_move ? 'selected' : ''}>${CAM_ICONS[k] || ''} ${pretty(k)}</option>`).join('')}</select>`;
    d.querySelector('textarea').oninput = (e) => s.prompt = e.target.value;
    d.querySelector('select').onchange = (e) => s.camera_move = e.target.value;
    d.querySelector('button')?.addEventListener('click', () => { SB.shots.splice(i, 1); renderShots(); });
    box.appendChild(d);
  });
}
function initStory() {
  chips($('#sbStyleChips'), Object.keys(STYLES).map(k => [k, k === 'none' ? 'Natural' : pretty(k)]), SB.style, v => SB.style = v);
  chips($('#sbAspect'), ['16:9', '9:16', '1:1'].map(a => [a, a]), SB.aspect, v => SB.aspect = v);
  const slot = $('#sbCharSlot'); slot.onclick = () => fillSlot(slot, 'image/*', u => SB.charImage = u);
  slot.addEventListener('cleared', () => SB.charImage = null);
  $('#addShot').onclick = () => { if (SB.shots.length >= 12) return toast('Max 12 shots'); SB.shots.push({ prompt: '', camera_move: 'static' }); renderShots(); };
  renderShots();
}
$('#sbGo').onclick = async () => {
  const shots = SB.shots.filter(s => s.prompt.trim()); if (!shots.length) return toast('Write at least one shot');
  try {
    await B().storyboard({ title: $('#sbTitle').value.trim(), character: $('#sbChar').value.trim(), character_image: SB.charImage || undefined, style: SB.style, aspect_ratio: SB.aspect, shots });
    toast(`Storyboard started — ${shots.length} shots`); go('gallery');
  } catch (e) { toast(e.message, 4000); }
};

// ================= GALLERY =================
let JOBS = []; let FILTER = 'all';
const FILTERS = [['all', 'All'], ['image', 'Images'], ['video', 'Videos'], ['storyboard', 'Stories'], ['fav', '★ Favorites'], ['claude', '🤖 From Claude'], ['running', '⏳ Running']];
function emit(job) {
  if (job.parent) return;
  const i = JOBS.findIndex(j => j.id === job.id);
  if (i >= 0) JOBS[i] = job; else JOBS.unshift(job);
  if ($('#view-gallery').classList.contains('active')) renderGallery();
  bumpRunning();
  if (job.status === 'done' && job.source === 'claude') toast('🤖 Claude made something new');
  if (job.kind === 'character' && job.status !== 'running' && CH.current && job.character === CH.current.id) openChar(CH.current.id);
}
async function refreshGallery() {
  try { JOBS = await B().jobs(); renderGallery(); bumpRunning(); } catch (e) { $('#galEmpty').textContent = 'Can’t reach the studio: ' + e.message; $('#galEmpty').hidden = false; }
}
function bumpRunning() { const n = JOBS.filter(j => j.status === 'running' || j.status === 'submitting').length; const b = $('#runBadge'); b.hidden = !n; b.textContent = n; }
const isVid = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
function renderGallery() {
  const list = JOBS.filter(j => FILTER === 'all' || (FILTER === 'fav' ? j.favorite : FILTER === 'claude' ? j.source === 'claude' : FILTER === 'running' ? j.status === 'running' : j.kind === FILTER));
  $('#galEmpty').hidden = !!list.length; $('#galEmpty').textContent = 'Nothing here yet.';
  $('#gallery').innerHTML = list.map(j => {
    const out = j.outputs?.[0] || j.shots?.find(s => s.keyframe)?.keyframe;
    const src = j.source === 'claude' ? '<span class="src">Claude</span>' : '';
    const badge = `<span class="badge">${j.kind === 'storyboard' ? `🎞 ${j.shots?.filter(s => s.status === 'done').length || 0}/${j.shots?.length || 0}` : j.kind === 'video' ? '▶' : '◻'} ${j.modelName || j.title || ''}</span>`;
    if (j.status === 'failed') return `<div class="tile fail" data-id="${j.id}">${badge}⚠ ${(j.error || 'Failed').slice(0, 90)}</div>`;
    if (!out) return `<div class="tile run" data-id="${j.id}">${badge}${src}<span>Generating…<br><small>${(j.prompt || '').slice(0, 50)}</small></span></div>`;
    const media = isVid(out) ? `<video src="${out}" muted loop playsinline autoplay preload="metadata"></video>` : `<img src="${out}" loading="lazy" />`;
    return `<div class="tile" data-id="${j.id}">${media}${badge}${src}${j.favorite ? '<span class="fav">★</span>' : ''}<div class="cap">${j.title || j.prompt || ''}</div></div>`;
  }).join('');
}
$('#gallery').onclick = (e) => { const t = e.target.closest('.tile'); if (t) openViewer(JOBS.find(j => j.id === t.dataset.id)); };

// ================= VIEWER =================
let V = null;
function openViewer(job) {
  if (!job) return; V = job; $('#viewer').hidden = false;
  $('#vStatus').textContent = job.status; $('#vFav').textContent = job.favorite ? '★' : '☆';
  const m = $('#vMedia');
  if (job.kind === 'storyboard') {
    m.innerHTML = `<div class="storyshots">${(job.shots || []).map(s => `<div class="shot"><div class="shot-head"><span>Shot ${s.index + 1} · ${pretty(s.camera_move || 'none')}</span><span>${s.status}</span></div>
      ${s.video ? `<video src="${s.video}" controls playsinline style="width:100%;border-radius:10px"></video>` : s.keyframe ? `<img src="${s.keyframe}" style="width:100%;border-radius:10px">` : ''}
      <p class="hint">${s.prompt}${s.error ? ' — ⚠ ' + s.error : ''}</p></div>`).join('')}</div>`;
  } else {
    m.innerHTML = (job.outputs || []).map(u => isVid(u) ? `<video src="${u}" controls autoplay loop playsinline></video>` : `<img src="${u}">`).join('') || `<p class="empty">${job.error || 'Still generating…'}</p>`;
  }
  $('#vPrompt').textContent = job.prompt || job.title || '';
  $('#vMeta').textContent = `${job.modelName || job.kind} · ${new Date(job.created).toLocaleString()}${job.source === 'claude' ? ' · made by Claude' : ''}`;
  const hasImg = (job.outputs || []).some(u => !isVid(u));
  $('#vAnimate').disabled = !hasImg; $('#vEdit').disabled = !hasImg;
}
$('#viewer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { $('#viewer').hidden = true; $('#vMedia').innerHTML = ''; } });
const currentUrl = () => { const m = $('#vMedia'); const idx = Math.round(m.scrollLeft / (m.clientWidth || 1)); return (V.outputs || [])[idx] || V.outputs?.[0]; };
$('#vFav').onclick = async () => { V.favorite = !V.favorite; $('#vFav').textContent = V.favorite ? '★' : '☆'; await B().patch(V.id, { favorite: V.favorite }).catch(() => {}); renderGallery(); };
$('#vDelete').onclick = async () => { await B().del(V.id).catch(() => {}); JOBS = JOBS.filter(j => j.id !== V.id); $('#viewer').hidden = true; renderGallery(); };
$('#vReuse').onclick = () => { $('#viewer').hidden = true; setMode(V.cat in DEFAULTS || CATALOG.some(m => m.cat === V.cat) ? V.cat : 'image'); $('#prompt').value = V.prompt || ''; go('create'); };
const useAsInput = (mode) => { const u = (V.outputs || []).find(x => !isVid(x)); $('#viewer').hidden = true; setMode(mode); C.media.image0 = u; renderModel(); $('#prompt').value = mode === 'i2v' ? (V.prompt || '') : ''; go('create'); };
$('#vAnimate').onclick = () => useAsInput('i2v');
$('#vEdit').onclick = () => useAsInput('edit');
$('#vShare').onclick = async () => {
  const url = currentUrl(); if (!url) return;
  try { if (Plugins.Share) await Plugins.Share.share({ title: 'Chitra Studio', text: V.prompt || '', url }); else if (navigator.share) await navigator.share({ url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch {}
};
$('#vSave').onclick = async () => {
  const url = currentUrl(); if (!url) return;
  const ext = (url.split('?')[0].match(/\.(\w{3,4})$/) || [, isVid(url) ? 'mp4' : 'png'])[1];
  const name = `chitra_${Date.now()}.${ext}`;
  try {
    if (Plugins.Filesystem?.downloadFile) {
      await Plugins.Filesystem.downloadFile({ url, path: 'Chitra/' + name, directory: 'DOCUMENTS', recursive: true });
      toast('Saved to Documents/Chitra');
    } else { const a = document.createElement('a'); a.href = url; a.download = name; a.target = '_blank'; a.click(); }
  } catch (e) { toast('Save failed — try Share. ' + (e.message || '')); }
};

// ================= CHARACTERS =================
const CH = { refs: {}, current: null, motion: null, actions: {} };
async function loadChars() {
  if (settings.mode !== 'hub') { $('#charGrid').innerHTML = '<p class="hint">Characters need Hub mode (Settings).</p>'; return; }
  try {
    const list = await Hub.req('/api/characters');
    $('#charGrid').innerHTML = list.map(c => `<div class="tile char" data-cid="${c.id}">${c.main ? `<img src="${c.main}">` : ''}<span class="badge">${c.status}</span><div class="cap">${c.name} · ${c.assets} assets</div></div>`).join('') || '<p class="hint">No characters yet.</p>';
    if (!Object.keys(CH.actions).length) {
      CH.actions = await Hub.req('/api/character-actions');
      $('#cdAction').innerHTML = Object.keys(CH.actions).map(a => `<option value="${a}">${pretty(a)}</option>`).join('');
    }
  } catch (e) { $('#charGrid').innerHTML = `<p class="hint">${e.message}</p>`; }
}
$('#charGrid').onclick = (e) => { const t = e.target.closest('[data-cid]'); if (t) openChar(t.dataset.cid); };
$('#charBack').onclick = () => { $('#charDetail').hidden = true; $('#charList').hidden = false; CH.current = null; loadChars(); };
async function openChar(id) {
  const c = await Hub.req('/api/characters/' + id); CH.current = c;
  $('#charList').hidden = true; $('#charDetail').hidden = false;
  $('#cdName').textContent = c.name; $('#cdDesc').textContent = c.description;
  $('#cdSheets').innerHTML = [c.main, ...Object.values(c.sheets || {})].filter(Boolean).map(u => `<img src="${u}">`).join('') || '<p class="hint">Designing… (pull back in a minute)</p>';
  $('#cdAssets').innerHTML = (c.assets || []).filter(a => a.type !== 'sheet').map(a => {
    const thumb = a.gif_url || a.url || a.start || (a.parts || [])[0];
    const links = [a.video && `<a href="${a.video}" target="_blank">video</a>`, a.sheet_url && `<a href="${a.sheet_url}" target="_blank">sprite sheet</a>`,
      a.frames_zip_url && `<a href="${a.frames_zip_url}" target="_blank">frames.zip</a>`, a.url && a.type !== 'parts' && `<a href="${a.url}" target="_blank">png</a>`,
      ...(a.parts || []).map((p, i) => `<a href="${p}" target="_blank">layer ${i + 1}</a>`)].filter(Boolean).join('');
    return `<div class="asset">${thumb ? `<img src="${thumb}">` : ''}<div><b>${a.type}</b> · ${a.label}${a.loop ? ' · loop' : ''}<br>${links}</div></div>`;
  }).join('') || '<p class="hint">No poses or animations yet.</p>';
}
const ncRefSlots = () => { const box = $('#ncRefs'); box.innerHTML = ''; for (let i = 0; i < 3; i++) { const s = document.createElement('div'); s.className = 'slot'; s.innerHTML = `<span>＋ ${i ? 'Extra ref' : 'Approved design (optional)'}</span>`;
  s.onclick = () => fillSlot(s, 'image/*', u => { if (u) CH.refs[i] = u; else delete CH.refs[i]; }); s.addEventListener('cleared', () => delete CH.refs[i]); box.appendChild(s); } };
$('#ncGo').onclick = async () => {
  try {
    const r = await Hub.req('/api/characters', { method: 'POST', body: JSON.stringify({ name: $('#ncName').value.trim(), description: $('#ncDesc').value.trim(),
      style: $('#ncStyle').value.trim() || undefined, reference_images: Object.values(CH.refs) }) });
    toast('Designing — sheets arrive in a minute or two'); CH.refs = {}; ncRefSlots(); $('#newChar').open = false; loadChars(); openChar(r.character);
  } catch (e) { toast(e.message, 4000); }
};
const charTask = async (path, body, msg) => { try { await Hub.req(`/api/characters/${CH.current.id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(msg); bumpRunning(); } catch (e) { toast(e.message, 4000); } };
$('#cdPoseGo').onclick = () => { const pose = $('#cdPose').value.trim(); if (!pose) return toast('Describe the pose'); charTask('pose', { pose, background: $('#cdPoseBg').value }, 'Posing…'); };
$('#cdAnimGo').onclick = () => charTask('animate', { action: $('#cdAction').value, custom_motion: $('#cdCustom').value.trim() || undefined, motion_video: CH.motion || undefined, background: $('#cdAnimBg').value }, 'Animating — a few minutes');
$('#cdParts').onclick = () => charTask('parts', {}, 'Splitting into layers…');
{ const s = $('#cdMotionSlot'); s.onclick = () => fillSlot(s, 'video/*', u => CH.motion = u); s.addEventListener('cleared', () => CH.motion = null); }

// ================= SETTINGS =================
function renderSettings() {
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));
  $('#hubFields').hidden = settings.mode !== 'hub'; $('#directFields').hidden = settings.mode !== 'direct';
  $('#hubUrl').value = settings.hubUrl; $('#hubToken').value = settings.token; $('#muapiKey').value = settings.muapiKey;
  const mcp = settings.hubUrl && settings.token ? `${settings.hubUrl.replace(/\/+$/, '')}/mcp/${settings.token}` : '';
  $('#mcpUrlCard').hidden = !mcp; $('#mcpUrl').textContent = mcp;
}
$('#modeSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; settings.mode = b.dataset.mode; renderSettings(); };
$('#copyMcp').onclick = async () => { try { await navigator.clipboard.writeText($('#mcpUrl').textContent); toast('Copied — paste it into Claude → Settings → Connectors'); } catch { toast('Long-press to copy'); } };
$('#saveSettings').onclick = async () => {
  settings.hubUrl = $('#hubUrl').value.trim(); settings.token = $('#hubToken').value.trim(); settings.muapiKey = $('#muapiKey').value.trim();
  store.set('settings', settings); renderSettings(); await connect(true);
};
async function connect(verbose) {
  const badge = $('#connBadge');
  try {
    const r = await B().ping();
    badge.textContent = settings.mode === 'hub' ? '● hub' : '● direct'; badge.classList.add('ok');
    if (settings.mode === 'hub' && !r.hasKey) throw new Error('Hub is up but MUAPI_KEY is not set on it');
    $('#settingsMsg').textContent = '✓ Connected' + (r.storage === 'local' ? ' — ⚠ server storage is temporary (add Supabase to keep characters)' : r.storage ? ' · storage: ' + r.storage : '');
    B().listen(emit); refreshGallery();
    if (verbose) toast('Connected');
    return true;
  } catch (e) {
    badge.textContent = 'offline'; badge.classList.remove('ok');
    $('#settingsMsg').textContent = '✗ ' + e.message;
    if (verbose) toast(e.message, 4000);
    return false;
  }
}

// ================= Boot =================
(async function boot() {
  try { if (Plugins.StatusBar) { Plugins.StatusBar.setOverlaysWebView({ overlay: true }); Plugins.StatusBar.setStyle({ style: 'DARK' }); } } catch {}
  CATALOG = await (await fetch('catalog.json')).json();
  chips($('#styleChips'), Object.keys(STYLES).map(k => [k, k === 'none' ? 'None' : pretty(k)]), 'none', v => C.style = v);
  chips($('#createCamChips'), Object.keys(CAMERA_MOVES).map(k => [k, `${CAM_ICONS[k] || ''} ${k === 'none' ? 'Auto' : pretty(k)}`]), 'none', v => C.camera = v);
  chips($('#galFilters'), FILTERS, 'all', v => { FILTER = v; renderGallery(); });
  setMode(C.mode); ncRefSlots(); initCinema(); updCinemaModel(); initStory(); renderSettings();
  const ok = (settings.mode === 'hub' ? settings.hubUrl && settings.token : settings.muapiKey) && await connect(false);
  if (!ok) go('settings');
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#connBadge').classList.contains('ok')) { B().listen(emit); refreshGallery(); } });
})();
