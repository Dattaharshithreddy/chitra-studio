// Chitra Studio — creative presets shared by the app and the hub/MCP server.
// Camera moves mirror the cinematic-control idea popularised by Higgsfield,
// written as plain prompt directives so they work with any video model.

export const CAMERA_MOVES = {
  none: '',
  dolly_in: 'slow dolly-in camera push toward the subject',
  dolly_out: 'smooth dolly-out camera pull back revealing the scene',
  crash_zoom_in: 'sudden crash zoom in onto the subject, fast and dramatic',
  crash_zoom_out: 'sudden crash zoom out away from the subject',
  dolly_zoom: 'vertigo dolly zoom, background stretches while subject stays fixed',
  orbit_360: 'camera orbits 360 degrees around the subject',
  arc_left: 'camera arcs smoothly to the left around the subject',
  arc_right: 'camera arcs smoothly to the right around the subject',
  crane_up: 'crane shot rising upward revealing the environment',
  crane_down: 'crane shot descending toward the subject',
  tilt_up: 'camera tilts up slowly',
  tilt_down: 'camera tilts down slowly',
  whip_pan: 'fast whip pan with motion blur',
  pan_left: 'steady pan to the left',
  pan_right: 'steady pan to the right',
  bullet_time: 'bullet-time frozen moment, camera sweeps around the subject',
  fpv_drone: 'FPV drone shot diving and weaving at high speed',
  aerial_flyover: 'high aerial drone flyover',
  handheld: 'handheld documentary camera with natural shake',
  snorricam: 'snorricam rig, camera locked to the subject’s body while the world moves',
  head_tracking: 'camera tracks the subject’s head closely as they move',
  tracking_follow: 'tracking shot following behind the subject',
  low_angle_hero: 'low-angle hero shot slowly pushing in',
  through_object: 'camera moves through an object into the scene',
  timelapse: 'timelapse with fast-moving clouds and light',
  static: 'locked-off static tripod shot',
};

export const STYLES = {
  none: '',
  cinematic: 'cinematic film still, anamorphic lens, shallow depth of field, rich color grade',
  anime: 'anime style, cel shaded, vibrant colors, detailed linework',
  pixar_3d: 'stylized 3D animation, soft global illumination, expressive characters',
  realistic: 'photorealistic, natural light, 85mm lens, high detail skin texture',
  noir: 'black and white film noir, hard shadows, high contrast',
  vintage_film: '35mm vintage film, grain, faded warm tones',
  cyberpunk: 'neon-lit cyberpunk, rain, reflections, teal and magenta',
  watercolor: 'soft watercolor painting, paper texture',
  tollywood_mass: 'high-energy Indian action cinema, slow-motion, dust, dramatic rim light, heroic framing',
  product_ad: 'premium product commercial, studio lighting, clean background, glossy reflections',
  ugc_selfie: 'UGC smartphone selfie video look, natural, vertical framing',
};

export const CINE_CAMERAS = {
  digital_8k: 'shot on a modular 8K digital cinema camera',
  imax_70mm: 'shot on grand format 70mm film',
  s35: 'shot on a Super 35 studio digital camera',
  film_16mm: 'shot on classic 16mm film',
  phone: 'shot on a smartphone',
};

export const LENSES = {
  none: '',
  wide_24: '24mm wide-angle lens',
  standard_50: '50mm lens',
  portrait_85: '85mm portrait lens, creamy bokeh',
  tele_135: '135mm telephoto lens, compressed background',
  macro: 'macro lens, extreme close-up detail',
  anamorphic: 'anamorphic lens with horizontal flares',
};

export function buildPrompt({ prompt = '', style, camera_move, cine_camera, lens, character } = {}) {
  const parts = [];
  if (character) parts.push(character.trim());
  parts.push(prompt.trim());
  if (camera_move && CAMERA_MOVES[camera_move]) parts.push(CAMERA_MOVES[camera_move]);
  if (style && STYLES[style]) parts.push(STYLES[style]);
  if (cine_camera && CINE_CAMERAS[cine_camera]) parts.push(CINE_CAMERAS[cine_camera]);
  if (lens && LENSES[lens]) parts.push(LENSES[lens]);
  return parts.filter(Boolean).join(', ');
}

// Default "best pick" models per task (ids from the Muapi catalog).
export const DEFAULTS = {
  image: 'nano-banana',
  edit: 'nano-banana-edit',
  video: 'seedance-lite-t2v',
  i2v: 'seedance-lite-i2v',
};

// Build a request payload from a catalog model + user params.
// params: { prompt, images:[url], video:url, audio:url, last_image:url, ...modelInputs }
export function buildPayload(model, params = {}) {
  const payload = {};
  for (const [k, spec] of Object.entries(model.inputs || {})) {
    if (spec.default !== undefined) payload[k] = spec.default;
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (k in (model.inputs || {})) payload[k] = v;
  }
  if (model.prompt && params.prompt) payload.prompt = params.prompt;
  if (params.seed !== undefined && params.seed !== -1 && params.seed !== '') payload.seed = Number(params.seed);
  const m = model.media || {};
  const imgs = [].concat(params.images || [], params.image_url || []).filter(Boolean);
  if (m.image && imgs.length) {
    payload[m.image.field] = m.image.array ? imgs.slice(0, m.image.max || imgs.length) : imgs[0];
  }
  if (m.image?.last && params.last_image) payload[m.image.last] = params.last_image;
  const vid = params.video || params.video_url;
  if (m.video && vid) payload[m.video.field] = m.video.array ? [].concat(vid) : vid;
  const aud = params.audio || params.audio_url;
  if (m.audio && aud) payload[m.audio.field] = aud;
  Object.assign(payload, model.fixed || {});
  for (const [k, spec] of Object.entries(model.inputs || {})) {
    if (spec.type === 'array' && payload[k] !== undefined && !Array.isArray(payload[k])) payload[k] = [payload[k]];
    if ((spec.type === 'int' || spec.type === 'integer' || spec.type === 'number') && typeof payload[k] === 'string' && payload[k] !== '') payload[k] = Number(payload[k]);
  }
  return payload;
}

export function validate(model, params = {}) {
  const m = model.media || {};
  const imgs = [].concat(params.images || [], params.image_url || []).filter(Boolean);
  if (model.promptRequired && !String(params.prompt || '').trim()) return 'This model needs a prompt.';
  if (m.image && !m.image.optional && ['edit', 'i2v', 'lipsync', 'motion'].includes(model.cat) && !imgs.length) return 'This model needs an input image.';
  if (m.video && ['v2v', 'motion'].includes(model.cat) && !(params.video || params.video_url)) return 'This model needs an input video.';
  if (model.cat === 'lipsync' && !(params.audio || params.audio_url)) return 'Lip sync needs an audio file.';
  return null;
}
