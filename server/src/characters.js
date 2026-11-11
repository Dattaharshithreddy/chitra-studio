// Character Kit: persistent, on-model 2D characters that Claude (via MCP) and the app can
// design, pose, animate (incl. seamless loops & motion transfer) and export for a 2D engine
// (transparent PNG sequences, sprite sheets, layered body parts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as E from './engine.js';

const run = promisify(execFile);
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '../data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
const CHAR_FILE = path.join(DATA_DIR, 'characters.json');
fs.mkdirSync(FILES_DIR, { recursive: true });

export const MODELS = {
  design: process.env.CHAR_DESIGN_MODEL || 'nano-banana-pro',
  edit: process.env.CHAR_EDIT_MODEL || 'nano-banana-pro-edit',
  animate: process.env.CHAR_ANIMATE_MODEL || 'seedance-v1.5-pro-i2v',
  motion: process.env.CHAR_MOTION_MODEL || 'seedance-2.5-motion-control',
  cutout: 'ai-background-remover',
  layers: 'bytedance-seedream-5.0-pro-layer',
};

const BG = {
  white: 'plain pure white background, no shadows, no scenery',
  green: 'perfectly flat solid chroma-key green (#00FF00) background filling the whole frame, no shadows, no gradients, no scenery, no green on the character',
  magenta: 'perfectly flat solid magenta (#FF00FF) background filling the whole frame, no shadows, no scenery',
};
const KEY = { green: '0x00FF00', magenta: '0xFF00FF' };

// Action library: start pose + motion. "In place" keeps cycles usable in an engine.
export const ACTIONS = {
  idle: { pose: 'standing relaxed, weight on both feet, arms loose', motion: 'subtle idle breathing, gentle body bob and a slow blink, stays in place' },
  walk_cycle: { pose: 'side view, mid-stride walking pose', motion: 'walk cycle in place on the spot, side view, like on a treadmill, natural arm and leg swing, body bob, no forward travel' },
  run_cycle: { pose: 'side view, leaning forward mid-run', motion: 'run cycle in place on the spot, side view, fast arm pumps and leg strides, no forward travel' },
  jump: { pose: 'crouched, ready to jump', motion: 'anticipation squat, jumps straight up, stretches at the top, lands with a squash and settles back to the start pose' },
  wave: { pose: 'standing, facing camera, one hand raised', motion: 'friendly wave with the raised hand, slight head tilt and smile' },
  talk: { pose: 'standing facing camera, mouth closed', motion: 'talking expressively, mouth moving, small hand gestures, eyebrows moving' },
  laugh: { pose: 'standing, starting to smile', motion: 'bursts out laughing, shoulders shaking, eyes squeezing shut, holds belly' },
  cry: { pose: 'standing, sad face', motion: 'starts crying, lip trembling, tears, wipes eyes with hand' },
  angry: { pose: 'standing, frowning, fists clenched', motion: 'gets angry, stomps a foot, shakes fists, steam-like huff' },
  surprised: { pose: 'standing neutral', motion: 'sudden surprise: eyes widen, jumps back slightly with arms up, then freezes' },
  scared: { pose: 'hunched, looking over shoulder', motion: 'trembling and shivering in fear, knees knocking, eyes darting' },
  sneak: { pose: 'side view, tiptoeing, hunched', motion: 'sneaking tiptoe cycle in place, exaggerated careful steps, looking around' },
  sit_down: { pose: 'standing beside an invisible seat', motion: 'sits down on the ground comfortably and settles' },
  pick_up: { pose: 'standing, looking at the ground', motion: 'bends down, picks up a small object from the ground with both hands and looks at it' },
  throw: { pose: 'side view, arm pulled back holding a ball', motion: 'throws the ball forward with full body follow-through, the ball clearly leaves the hand' },
  eat: { pose: 'sitting, holding food with both hands', motion: 'takes a big bite, chews happily with cheeks puffing' },
  drink: { pose: 'sitting, holding a cup with both hands', motion: 'lifts the cup with both hands, drinks, lowers it and sighs happily' },
  sleep: { pose: 'lying curled up, eyes closed', motion: 'sleeping, slow breathing, slight snore movement' },
  dance: { pose: 'standing, ready to dance', motion: 'happy cartoon dance, bouncing, swinging arms and hips' },
  fall: { pose: 'standing off balance', motion: 'slips and falls on the bottom with a bounce, dazed' },
  push: { pose: 'side view, both hands on an invisible heavy object', motion: 'pushes hard with straining legs, slowly leaning forward' },
  think: { pose: 'standing, hand on chin', motion: 'thinking, taps chin, looks up, then gets an idea and raises a finger' },
};

const SHEETS = {
  turnaround: { aspect: '16:9', prompt: 'character turnaround model sheet: front view, three-quarter view, side profile, back view, full body, all four the same size standing on one baseline, evenly spaced' },
  expressions: { aspect: '16:9', prompt: 'expression sheet of the head: neutral, happy, laughing, sad, angry, surprised, scared, thinking — 8 head close-ups in a clean 4 by 2 grid' },
  hands: { aspect: '16:9', prompt: 'hand / paw sheet: relaxed, open palm, fist, pointing, gripping a cup handle, holding a ball, waving — close-ups with the correct number of fingers or toes' },
  action_poses: { aspect: '16:9', prompt: 'action pose sheet, full body: walking, running, jumping, sitting, reaching up, pushing — six poses in a row' },
};

// ---------- store ----------
let chars = [];
try { chars = JSON.parse(fs.readFileSync(CHAR_FILE, 'utf8')); } catch { chars = []; }
const save = () => { fs.writeFileSync(CHAR_FILE + '.tmp', JSON.stringify(chars, null, 1)); fs.renameSync(CHAR_FILE + '.tmp', CHAR_FILE); };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const listCharacters = () => chars.map(c => ({ id: c.id, name: c.name, status: c.status, main: c.main, assets: c.assets.length, updated: c.updated }));
export function getCharacter(idOrName) {
  const k = slug(idOrName || '');
  const c = chars.find(c => c.id === idOrName || c.id === k || slug(c.name) === k);
  if (!c) throw new Error(`No character "${idOrName}". Use list_characters or create_character.`);
  return c;
}
function addAsset(c, a) { c.assets.unshift({ id: 'a_' + crypto.randomBytes(4).toString('hex'), created: Date.now(), ...a }); c.updated = Date.now(); save(); }
export function deleteCharacter(id) { const c = getCharacter(id); chars = chars.filter(x => x !== c); save(); return true; }

const lock = (c) => `The exact same character as in the reference images: ${c.name}, ${c.description}. Keep identical face, head shape, colors, markings, proportions, outfit and line style. ${c.style}.`;
const refs = (c, extra = []) => [c.main, c.sheets?.turnaround, ...(c.refs || []), ...extra].filter(Boolean).slice(0, 6);

async function done(job, secs = 900) {
  const j = await E.waitFor(job.id, secs);
  if (j.status !== 'done' || !j.outputs?.length) throw new Error(j.error || `${j.modelName} returned nothing`);
  return j.outputs;
}

// Runs a multi-step task as one trackable job in the gallery/MCP.
function task(title, c, source, fn) {
  const job = E.createTaskJob({ title, kind: 'character', cat: 'character', prompt: c.name, source, character: c.id });
  (async () => {
    try { const out = await fn(job); E.finishTask(job.id, { status: 'done', outputs: out.outputs || [], result: out }); }
    catch (e) { E.finishTask(job.id, { status: 'failed', error: e.message }); }
  })();
  return job;
}

// ---------- create ----------
export async function createCharacter({ name, description, style = 'clean 2D cartoon style, bold clean outlines, flat cel colors, soft simple shading', reference_images = [], sheets = Object.keys(SHEETS), source = 'app' }) {
  if (!name || !description) throw new Error('name and description are required');
  const id = slug(name);
  if (chars.some(c => c.id === id)) throw new Error(`Character "${name}" already exists — use pose_character / animate_character, or pick another name.`);
  const c = { id, name, description, style, refs: reference_images, main: reference_images[0] || null, sheets: {}, assets: [], status: 'designing', created: Date.now(), updated: Date.now() };
  chars.unshift(c); save();
  const job = task(`Design ${name}`, c, source, async () => {
    if (!c.main) {
      const [main] = await done(await E.createJob({ model: MODELS.design, source, title: `${name} — main design`,
        prompt: `Character design of ${name}: ${description}. ${style}. Full body, front view, neutral standing A-pose, whole character in frame, ${BG.white}, no text.`,
        options: { aspect_ratio: '3:4' } }));
      c.main = main; save();
    }
    const results = await Promise.allSettled(sheets.filter(s => SHEETS[s]).map(async (s) => {
      const [url] = await done(await E.createJob({ model: MODELS.edit, source, images: [c.main, ...(c.refs || []).slice(1)], title: `${name} — ${s}`,
        prompt: `${lock(c)} ${SHEETS[s].prompt}. ${BG.white}, no text, no labels.`, options: { aspect_ratio: SHEETS[s].aspect } }));
      c.sheets[s] = url; addAsset(c, { type: 'sheet', label: s, url });
    }));
    c.status = 'ready'; c.updated = Date.now(); save();
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
    return { outputs: [c.main, ...Object.values(c.sheets)], character: c.id, failed_sheets: failed };
  });
  return { character: c.id, job: job.id };
}

// ---------- pose ----------
export async function poseCharacter({ character, pose, expression, background = 'transparent', aspect_ratio = '3:4', props, source = 'app' }) {
  const c = getCharacter(character);
  const bgKey = background === 'transparent' ? 'white' : background;
  const bg = BG[bgKey] || `background: ${background}`;
  const job = task(`${c.name} — ${pose}`, c, source, async () => {
    const [img] = await done(await E.createJob({ model: MODELS.edit, source, images: refs(c), title: `${c.name} pose`,
      prompt: `${lock(c)} New pose: ${pose}.${expression ? ` Expression: ${expression}.` : ''}${props ? ` Holding/using: ${props}, gripped naturally by the hands/paws.` : ''} Full body in frame, ${bg}, no text.`,
      options: { aspect_ratio } }));
    let url = img;
    if (background === 'transparent') [url] = await done(await E.createJob({ model: MODELS.cutout, source, images: [img], title: `${c.name} cutout` }));
    addAsset(c, { type: 'pose', label: pose, url, background });
    return { outputs: [url], url };
  });
  return { job: job.id };
}

// ---------- animate ----------
export async function animateCharacter({ character, action = 'idle', custom_motion, start_image, loop, background = 'green', aspect_ratio = '1:1',
  duration, motion_video, model, export_fps = 12, source = 'app' }) {
  const c = getCharacter(character);
  const preset = ACTIONS[action] || { pose: 'standing', motion: custom_motion || action };
  const motionText = custom_motion || preset.motion;
  const shouldLoop = loop ?? /cycle|idle|sneak|sleep|dance|scared|talk/.test(action);
  const bg = BG[background] || `background: ${background}`;
  const job = task(`${c.name} — ${action}`, c, source, async () => {
    let start = start_image;
    if (!start) {
      [start] = await done(await E.createJob({ model: MODELS.edit, source, images: refs(c), title: `${c.name} ${action} start`,
        prompt: `${lock(c)} Pose: ${preset.pose}. Full body in frame with space around it, centered, ${bg}, no text.`, options: { aspect_ratio } }));
    }
    let video;
    if (motion_video) {
      [video] = await done(await E.createJob({ model: MODELS.motion, source, images: [start], video: motion_video, title: `${c.name} ${action} (motion transfer)`,
        prompt: `${lock(c)} Copy the movement from the reference video. ${bg}.` }), 1800);
    } else {
      [video] = await done(await E.createJob({ model: model || MODELS.animate, source, images: [start], last_image: shouldLoop ? start : undefined,
        title: `${c.name} ${action}`,
        prompt: `${lock(c)} 2D cartoon animation: ${motionText}. Locked-off static camera, no zoom, no camera movement, character stays fully in frame, ${bg} stays unchanged the whole time, smooth hand-drawn animation timing with anticipation, squash and stretch and follow-through, hands/paws keep the correct number of fingers.${shouldLoop ? ' Ends in exactly the starting pose for a seamless loop.' : ''}`,
        options: { aspect_ratio, camera_fixed: true, generate_audio: false, ...(duration ? { duration } : {}) } }), 1800);
    }
    const asset = { type: 'animation', label: action, video, start, loop: shouldLoop, background };
    if (KEY[background]) {
      try { Object.assign(asset, await exportFrames({ video_url: video, fps: export_fps, chroma: background })); }
      catch (e) { asset.export_error = e.message; }
    }
    addAsset(c, asset);
    return { outputs: [video, asset.sheet_url].filter(Boolean), ...asset };
  });
  return { job: job.id };
}

// ---------- body parts for rigging ----------
export async function exportParts({ character, image_url, source = 'app' }) {
  const c = getCharacter(character);
  const job = task(`${c.name} — rig parts`, c, source, async () => {
    let img = image_url;
    if (!img) [img] = await done(await E.createJob({ model: MODELS.edit, source, images: refs(c), title: `${c.name} rig pose`,
      prompt: `${lock(c)} Rigging pose: front view, standing, arms slightly away from the body, legs slightly apart, nothing overlapping, ${BG.white}.`, options: { aspect_ratio: '3:4' } }));
    const outs = await done(await E.createJob({ model: MODELS.layers, source, images: [img], title: `${c.name} layers`,
      prompt: 'Separate the character into individual transparent layers: head, torso, left upper arm, left forearm and hand, right upper arm, right forearm and hand, left leg, right leg, tail or trunk if present, accessories. Background as its own layer.',
      options: { output_format: 'png' } }), 900);
    addAsset(c, { type: 'parts', label: 'rig parts', url: img, parts: outs });
    return { outputs: outs, source_image: img, parts: outs };
  });
  return { job: job.id };
}

// ---------- frames / sprite sheet (ffmpeg) ----------
export async function exportFrames({ video_url, fps = 12, width = 512, chroma = 'none', columns = 6 }) {
  const id = 'x_' + crypto.randomBytes(5).toString('hex');
  const dir = path.join(FILES_DIR, id); fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  const src = path.join(dir, 'source.mp4');
  const r = await fetch(video_url); if (!r.ok) throw new Error(`Could not download video (${r.status})`);
  fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  const key = KEY[chroma] ? `,colorkey=${KEY[chroma]}:0.32:0.12,despill=type=${chroma === 'magenta' ? 'blue' : 'green'}` : '';
  const vf = `fps=${fps},scale=${width}:-2:flags=lanczos${key},format=rgba`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', vf, path.join(dir, 'frames', 'frame_%03d.png')]);
  const frames = fs.readdirSync(path.join(dir, 'frames')).filter(f => f.endsWith('.png')).sort();
  if (!frames.length) throw new Error('No frames extracted');
  const cols = Math.min(columns, frames.length), rows = Math.ceil(frames.length / cols);
  await run('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, 'frames', 'frame_%03d.png'),
    '-vf', `tile=${cols}x${rows}:padding=0:color=0x00000000`, '-frames:v', '1', path.join(dir, 'sheet.png')]);
  await run('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, 'frames', 'frame_%03d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse', '-loop', '0', path.join(dir, 'preview.gif')]);
  await run('zip', ['-qj', path.join(dir, 'frames.zip'), ...frames.map(f => path.join(dir, 'frames', f))]);
  const meta = { fps, frame_count: frames.length, frame_width: width, columns: cols, rows, transparent: !!KEY[chroma] };
  fs.writeFileSync(path.join(dir, 'sheet.json'), JSON.stringify(meta, null, 2));
  fs.rmSync(src);
  const base = `${E.publicBase()}/files/${id}`;
  return { sheet_url: `${base}/sheet.png`, frames_zip_url: `${base}/frames.zip`, gif_url: `${base}/preview.gif`, sheet_meta_url: `${base}/sheet.json`, ...meta };
}
