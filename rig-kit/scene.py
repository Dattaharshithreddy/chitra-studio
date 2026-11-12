#!/usr/bin/env python3
"""Chitra rig-kit scene builder: rigged characters + background + props + camera + sound -> 9:16 MP4.

usage: python3 scene.py scene.json
Each actor clip is rendered from its .riv to transparent frames (cached), then composited per frame.
Times are seconds. Keyframe lists: [[t, value, easing?], ...]  easing: linear | in | out | inout (default) | hold
"""
import json, math, os, subprocess, sys, wave
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EASE = {'linear': lambda t: t, 'in': lambda t: t ** 3, 'out': lambda t: 1 - (1 - t) ** 3,
        'inout': lambda t: 3 * t * t - 2 * t ** 3, 'hold': lambda t: 0.0}

def ev(keys, t, default=0.0):
    if keys is None: return default
    if not isinstance(keys, list): return keys
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0, *_), (t1, v1, *e) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1
            return v0 + (v1 - v0) * EASE[e[0] if e else 'inout'](u)
    return keys[-1][1]

def render_clip(riv, anim, seconds, fps, width, cache):
    """render one looping animation to transparent frames via rive-mcp APNG export (cached)"""
    key = f"{os.path.splitext(os.path.basename(riv))[0]}_{anim}_{fps}_{width}"
    apng = os.path.join(cache, key + '.apng')
    if not os.path.exists(apng):
        args = {'path': riv, 'animation': anim, 'duration': seconds, 'fps': fps, 'width': width, 'transparent': True, 'out': apng}
        env = {**os.environ, 'PLAYWRIGHT_BROWSERS_PATH': os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')}
        r = subprocess.run(['node', os.path.join(HERE, 'client.mjs'), 'riv_render_apng', json.dumps(args)], env=env, capture_output=True, text=True)
        if not os.path.exists(apng): sys.exit(f'clip render failed for {riv}:{anim}\n{r.stdout[-500:]}{r.stderr[-500:]}')
    im = Image.open(apng); frames = []
    for i in range(im.n_frames):
        im.seek(i); frames.append(im.convert('RGBA').copy())
    return frames

def synth_sfx(kind, sr=44100):
    t = lambda d: np.linspace(0, d, int(sr * d), False)
    if kind == 'thump':
        x = t(0.25); return np.sin(2 * np.pi * (95 - 50 * x) * x) * np.exp(-x * 18) * 0.9 + np.random.randn(len(x)) * np.exp(-x * 40) * 0.15
    if kind == 'boing':
        x = t(0.5); f = 260 + 380 * (1 - np.exp(-x * 9)); ph = 2 * np.pi * np.cumsum(f * (1 + 0.06 * np.sin(2 * np.pi * 18 * x))) / sr
        return np.sin(ph) * np.exp(-x * 5) * 0.55
    if kind == 'pop':
        x = t(0.12); return np.sin(2 * np.pi * (700 - 2400 * x) * x) * np.exp(-x * 35) * 0.6
    if kind == 'whoosh':
        x = t(0.35); n = np.random.randn(len(x)); n = np.convolve(n, np.ones(30) / 30, 'same'); return n * np.sin(np.pi * x / 0.35) * 0.9
    if kind == 'chirp':
        x = t(0.09); return np.sin(2 * np.pi * (3200 + 1800 * x / 0.09) * x) * np.sin(np.pi * x / 0.09) * 0.18
    raise ValueError(kind)

def make_audio(sc, path, sr=44100):
    dur = sc['duration']; mix = np.zeros(int(sr * dur) + sr)
    rng = np.random.default_rng(3)
    if sc.get('ambience') == 'birds':
        for tt in np.sort(rng.uniform(0.3, dur - 0.5, int(dur * 0.9))):
            for k in range(rng.integers(2, 4)):
                s = synth_sfx('chirp'); i = int((tt + k * 0.13) * sr); mix[i:i + len(s)] += s * 0.6
    for ev_ in sc.get('sfx', []):
        s = synth_sfx(ev_['kind']) if 'kind' in ev_ else None
        if s is None: continue
        i = int(ev_['t'] * sr); mix[i:i + len(s)] += s * ev_.get('gain', 1.0)
    mix = mix[:int(sr * dur)]; mix /= max(1.0, np.abs(mix).max() / 0.9)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((mix * 32767).astype(np.int16).tobytes())

def main(path):
    sc = json.load(open(path)); base = os.path.dirname(os.path.abspath(path))
    rel = lambda p: p if os.path.isabs(p) else os.path.join(base, p)
    W, H = sc.get('size', [1080, 1920]); fps = sc.get('fps', 24); dur = sc['duration']
    out = rel(sc.get('out', 'scene.mp4')); cache = rel(sc.get('cache', '.cache')); os.makedirs(cache, exist_ok=True)
    bg = Image.open(rel(sc['background'])).convert('RGBA').resize((W, H))
    clips = {}
    for a in sc['actors']:
        for seg in a['segments']:
            k = (seg['riv'], seg['anim'])
            if k not in clips: clips[k] = render_clip(rel(seg['riv']), seg['anim'], seg['seconds'], fps, a.get('render_width', 640), cache)
    props = {p['id']: Image.open(rel(p['image'])).convert('RGBA') for p in sc.get('props', [])}
    frames_dir = os.path.join(cache, 'frames'); os.makedirs(frames_dir, exist_ok=True)
    for f in os.listdir(frames_dir): os.remove(os.path.join(frames_dir, f))
    n = int(round(dur * fps))
    for i in range(n):
        t = i / fps; world = bg.copy()
        layers = []
        for p in sc.get('props', []):
            if not (p.get('from', 0) <= t < p.get('to', 1e9)): continue
            img = props[p['id']]; s = ev(p.get('scale'), t, 1.0); rot = ev(p.get('rot'), t, 0.0)
            im2 = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS).rotate(rot, expand=True, resample=Image.BICUBIC)
            layers.append((ev(p.get('z'), t, 0), 'prop', im2, ev(p['x'], t), ev(p['y'], t), 'center'))
        for a in sc['actors']:
            seg = next((s for s in a['segments'] if s['from'] <= t < s['to']), None)
            if seg is None: continue
            fr = clips[(seg['riv'], seg['anim'])]; idx = int((t - seg['from']) * fps) % len(fr)
            img = fr[idx]; s = ev(a.get('scale'), t, 1.0); sq = ev(a.get('squash'), t, 0.0)   # squash: -0.1 = 10% shorter, wider
            w2, h2 = int(img.width * s * (1 - sq * 0.5)), int(img.height * s * (1 + sq))
            img = img.resize((max(1, w2), max(1, h2)), Image.LANCZOS)
            if a.get('flip'): img = img.transpose(Image.FLIP_LEFT_RIGHT)
            rot = ev(a.get('rot'), t, 0.0)
            if abs(rot) > 0.01: img = img.rotate(rot, expand=True, resample=Image.BICUBIC)
            x, y = ev(a['x'], t), ev(a['y'], t); lift = ev(a.get('lift'), t, 0.0)
            # soft ground shadow (shrinks while airborne)
            sw = int(img.width * 0.55 * (1 - min(lift, 200) / 400)); sh = max(6, sw // 6)
            shadow = Image.new('RGBA', (sw, sh), (0, 0, 0, 0)); from PIL import ImageDraw as _D
            _D.Draw(shadow).ellipse((0, 0, sw - 1, sh - 1), fill=(0, 0, 0, 60)); layers.append((ev(a.get('z'), t, 10) - 0.5, 'shadow', shadow, x, y, 'center'))
            layers.append((ev(a.get('z'), t, 10), 'actor', img, x, y - lift + img.height * seg.get('feet_from_bottom', a.get('feet_from_bottom', 0.033)), 'feet'))
        for z, kind, img, x, y, anchor in sorted(layers, key=lambda l: l[0]):
            px = int(x - img.width / 2); py = int(y - (img.height if anchor == 'feet' else img.height / 2))
            world.alpha_composite(img, (px, py)) if 0 <= px and 0 <= py and px + img.width <= W and py + img.height <= H else _paste(world, img, px, py)
        z = ev(sc.get('camera', {}).get('zoom'), t, 1.0)
        cx, cy = ev(sc.get('camera', {}).get('x'), t, W / 2), ev(sc.get('camera', {}).get('y'), t, H / 2)
        sh = ev(sc.get('camera', {}).get('shake'), t, 0.0)
        if sh > 0.1: rs = np.random.default_rng(i); cx += rs.uniform(-sh, sh); cy += rs.uniform(-sh, sh)
        cw, ch = W / z, H / z; cx = min(max(cx, cw / 2), W - cw / 2); cy = min(max(cy, ch / 2), H - ch / 2)
        frame = world.crop((int(cx - cw / 2), int(cy - ch / 2), int(cx + cw / 2), int(cy + ch / 2))).resize((W, H), Image.LANCZOS)
        frame.convert('RGB').save(os.path.join(frames_dir, f'{i:05d}.png'))
    wav = os.path.join(cache, 'audio.wav'); make_audio(sc, wav)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(frames_dir, '%05d.png'), '-i', wav,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest',
                    '-movflags', '+faststart', out], check=True)
    print('wrote', out)

def _paste(world, img, px, py):
    layer = Image.new('RGBA', world.size, (0, 0, 0, 0)); layer.paste(img, (px, py), img); world.alpha_composite(layer)

if __name__ == '__main__':
    main(sys.argv[1])
