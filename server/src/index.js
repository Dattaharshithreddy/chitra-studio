// Chitra Hub — REST API for the Android app + MCP endpoint for Claude.
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as E from './engine.js';
import { CAMERA_MOVES, STYLES, LENSES, CINE_CAMERAS } from '../../shared/presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const TOKEN = process.env.STUDIO_TOKEN || (() => {
  const t = crypto.randomBytes(16).toString('hex');
  console.warn(`STUDIO_TOKEN not set — generated one for this run: ${t}`);
  return t;
})();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, mcp-protocol-version');
  res.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || req.params.token || '';
  if (!safeEq(String(t), TOKEN)) return res.status(401).json({ error: 'Bad or missing token' });
  next();
}
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(400).json({ error: e.message }); }
};

// ---------- REST (used by the APK) ----------
app.get('/health', (req, res) => res.json({ ok: true, name: 'chitra-hub', models: E.CATALOG.length }));
app.get('/api/ping', auth, (req, res) => res.json({ ok: true, hasKey: !!process.env.MUAPI_KEY }));
app.get('/api/models', auth, wrap(req => E.searchModels({ category: req.query.category, search: req.query.q, limit: 1000 })));
app.get('/api/jobs', auth, wrap(req => E.listJobs({ limit: Number(req.query.limit) || 100, status: req.query.status,
  cat: req.query.cat, source: req.query.source, favorite: req.query.favorite === '1', parent: req.query.parent }).map(E.summarize)));
app.get('/api/jobs/:id', auth, wrap(async req => E.summarize(await E.waitFor(req.params.id, Math.min(Number(req.query.wait) || 0, 50)))));
app.patch('/api/jobs/:id', auth, wrap(req => E.summarize(E.updateJob(req.params.id, req.body))));
app.delete('/api/jobs/:id', auth, wrap(req => ({ ok: E.deleteJob(req.params.id) })));
app.post('/api/generate', auth, wrap(async req => E.summarize(await E.createJob({ ...req.body, source: req.body.source || 'app' }))));
app.post('/api/variations', auth, wrap(async req => (await E.createVariations({ ...req.body, source: 'app' })).map(E.summarize)));
app.post('/api/storyboard', auth, wrap(async req => E.summarize(await E.createStoryboard({ ...req.body, source: 'app' }))));
app.post('/api/upload', auth, express.raw({ type: '*/*', limit: '200mb' }), wrap(async req =>
  ({ url: await E.uploadBuffer(req.body, req.query.name || 'upload', req.headers['content-type']) })));
// Live updates for the app gallery (Server-Sent Events).
app.get('/api/events', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const off = E.onChange(j => res.write(`data: ${JSON.stringify(E.summarize(j))}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { off(); clearInterval(ping); });
});

// ---------- MCP (used by Claude) ----------
const fmt = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const jobView = (j) => j && ({ id: j.id, status: j.status, model: j.modelName || j.model, kind: j.kind, title: j.title,
  prompt: j.prompt, outputs: j.outputs, error: j.error, shots: j.shots, created: new Date(j.created).toISOString() });
const mediaShape = {
  images: z.array(z.string().url()).optional().describe('Input image URLs (for edit, image-to-video, lipsync, motion)'),
  video: z.string().url().optional().describe('Input video URL (video-to-video, lipsync, motion control)'),
  audio: z.string().url().optional().describe('Audio URL (lipsync)'),
  last_image: z.string().url().optional().describe('End frame URL for first/last-frame video models'),
};
const lookShape = {
  style: z.enum(Object.keys(STYLES)).optional(),
  camera_move: z.enum(Object.keys(CAMERA_MOVES)).optional().describe('Cinematic camera move (video only)'),
  cine_camera: z.enum(Object.keys(CINE_CAMERAS)).optional(),
  lens: z.enum(Object.keys(LENSES)).optional(),
  character: z.string().optional().describe('Recurring character description prepended to the prompt for consistency'),
};

function buildMcp() {
  const s = new McpServer({ name: 'chitra-studio', version: '1.0.0' });

  s.registerTool('list_models', {
    title: 'List generation models',
    description: 'Search the 598-model catalog. Categories: image (text-to-image), edit (image-to-image/tools), video (text-to-video), i2v (image-to-video), v2v (video-to-video), lipsync, motion.',
    inputSchema: { category: z.enum(['image', 'edit', 'video', 'i2v', 'v2v', 'lipsync', 'motion']).optional(), search: z.string().optional(), limit: z.number().int().max(200).optional() },
  }, async (a) => fmt(E.searchModels(a).map(m => ({ id: m.id, name: m.name, category: m.cat, provider: m.provider,
    options: Object.fromEntries(Object.entries(m.inputs).filter(([k]) => k !== 'prompt').map(([k, v]) => [k, v.enum || v.type])),
    media: m.media }))));

  s.registerTool('get_presets', {
    title: 'List creative presets', description: 'Camera moves, styles, lenses and cinema cameras usable in generate/storyboard.', inputSchema: {},
  }, async () => fmt({ camera_moves: CAMERA_MOVES, styles: STYLES, lenses: LENSES, cine_cameras: CINE_CAMERAS }));

  s.registerTool('generate', {
    title: 'Generate image or video',
    description: 'Start a generation in Chitra Studio. It appears in the phone app gallery. Pass model id (from list_models) or just a category to use the default. Set wait_seconds (max 50) to wait for the result; otherwise poll with get_job.',
    inputSchema: {
      prompt: z.string().optional(), model: z.string().optional(),
      category: z.enum(['image', 'edit', 'video', 'i2v', 'v2v', 'lipsync', 'motion']).optional(),
      ...mediaShape, ...lookShape,
      options: z.record(z.any()).optional().describe('Model-specific options e.g. {"aspect_ratio":"9:16","duration":5,"resolution":"1080p"}'),
      seed: z.number().int().optional(), title: z.string().optional(), wait_seconds: z.number().int().max(50).optional(),
    },
  }, async (a) => {
    const job = await E.createJob({ ...a, source: 'claude' });
    return fmt(jobView(await E.waitFor(job.id, a.wait_seconds || 0)));
  });

  s.registerTool('generate_variations', {
    title: 'Generate variations / compare models',
    description: 'Run one prompt across several models side by side (models list) or N random seeds of one model (count ≤ 6).',
    inputSchema: { prompt: z.string(), models: z.array(z.string()).optional(), model: z.string().optional(), count: z.number().int().max(6).optional(),
      category: z.enum(['image', 'edit', 'video', 'i2v']).optional(), ...mediaShape, ...lookShape, options: z.record(z.any()).optional() },
  }, async (a) => fmt((await E.createVariations({ ...a, source: 'claude' })).map(jobView)));

  s.registerTool('create_storyboard', {
    title: 'Create a multi-shot storyboard film',
    description: 'Builds a consistent multi-shot sequence: each shot gets a keyframe (using character_image as reference when given) and is animated with its camera move. Runs in the background; poll with get_job using the returned id.',
    inputSchema: {
      title: z.string().optional(), character: z.string().optional(), character_image: z.string().url().optional(),
      style: z.enum(Object.keys(STYLES)).optional(), aspect_ratio: z.string().optional(),
      shots: z.array(z.object({ prompt: z.string(), camera_move: z.enum(Object.keys(CAMERA_MOVES)).optional(), duration: z.number().int().optional() })).min(1).max(12),
      image_model: z.string().optional(), edit_model: z.string().optional(), video_model: z.string().optional(),
    },
  }, async (a) => fmt(jobView(await E.createStoryboard({ ...a, source: 'claude' }))));

  s.registerTool('get_job', {
    title: 'Get job status', description: 'Status and output URLs of a job or storyboard. wait_seconds (max 50) waits for completion.',
    inputSchema: { id: z.string(), wait_seconds: z.number().int().max(50).optional() },
  }, async ({ id, wait_seconds }) => fmt(jobView(await E.waitFor(id, wait_seconds || 0)) || { error: 'not found' }));

  s.registerTool('list_jobs', {
    title: 'List recent generations', description: 'Recent jobs from the app and from Claude, newest first.',
    inputSchema: { limit: z.number().int().max(100).optional(), status: z.enum(['running', 'done', 'failed']).optional(),
      favorites_only: z.boolean().optional(), source: z.enum(['app', 'claude']).optional() },
  }, async (a) => fmt(E.listJobs({ limit: a.limit || 20, status: a.status, favorite: a.favorites_only, source: a.source }).map(jobView)));

  s.registerTool('upload_from_url', {
    title: 'Re-host a media URL', description: 'Fetch a public image/video/audio URL and upload it to the generation provider so models can use it.',
    inputSchema: { url: z.string().url() },
  }, async ({ url }) => {
    const r = await fetch(url); if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return fmt({ url: await E.uploadBuffer(buf, url.split('/').pop().split('?')[0] || 'file', r.headers.get('content-type')) });
  });

  s.registerTool('favorite_job', {
    title: 'Favorite a generation', description: 'Star/unstar a job so it shows under Favorites in the app.',
    inputSchema: { id: z.string(), favorite: z.boolean() },
  }, async ({ id, favorite }) => fmt(jobView(E.updateJob(id, { favorite }))));

  return s;
}

// Stateless streamable HTTP: a fresh server+transport per request.
async function handleMcp(req, res) {
  const server = buildMcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
const mcpMethodNotAllowed = (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
app.post('/mcp/:token', auth, handleMcp);
app.post('/mcp', auth, handleMcp);
app.get(['/mcp', '/mcp/:token'], mcpMethodNotAllowed);
app.delete(['/mcp', '/mcp/:token'], mcpMethodNotAllowed);

// The same studio UI, served in a browser (handy on desktop).
app.get(['/presets.js', '/catalog.json'], (req, res) => res.sendFile(path.join(__dirname, '../../shared', req.path)));
app.use(express.static(path.join(__dirname, '../../app/www')));

app.listen(PORT, () => console.log(`Chitra Hub on :${PORT}  •  MCP: /mcp/<STUDIO_TOKEN>`));
