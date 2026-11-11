#!/usr/bin/env python3
"""Chitra rig-kit: turn one cartoon character drawing into a bone-rigged Rive (.riv) animation.

usage:  python3 rig.py config.json            -> writes <out>/<name>_*.png parts, <out>/<name>_seg.png, <out>/<name>.args.json
        node client.mjs riv_create @<out>/<name>.args.json   -> builds <out>/<name>.riv

Method (see README): background removed by flood fill; arms separated from the shirt BY COLOUR (skin vs cloth);
fingers merged by proximity to the hand; anti-alias rim travels with the arm; head cut at the neck;
arms are meshes skinned to 2 bones (shoulder->elbow->hand) so elbows bend smoothly; eyelid shapes for blinks.
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage


def remove_background(rgb, thresh=226):
    white = rgb.min(axis=2) > thresh
    lab, _ = ndimage.label(white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.where(np.isin(lab, list(border)), 0, 255).astype(np.uint8)


def clean_white(A, boxes=()):
    """remove enclosed pure-white background pockets (e.g. between raised arms and the neck) inside given boxes"""
    rgb = A[:, :, :3].astype(int); white = (rgb.min(axis=2) > 238) & (A[:, :, 3] > 0)
    lab, n = ndimage.label(white)
    for i in range(1, n + 1):
        m = lab == i; ys, xs = np.where(m)
        if m.sum() > 40 and any(x0 <= xs.mean() < x1 and y0 <= ys.mean() < y1 for x0, y0, x1, y1 in boxes):
            A[m, 3] = 0
    return A


def segment(A, cfg, out, name):
    A = clean_white(A, cfg.get('pockets', [])); al = A[:, :, 3] > 0
    rgb = A[:, :, :3].astype(int); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    sk = cfg.get('skin_rule', {'r_min': 150, 'r_minus_g': 28, 'r_minus_b': 55})
    skin = al & (R > sk['r_min']) & (R - G > sk['r_minus_g']) & (R - B > sk['r_minus_b'])
    dark = al & (rgb.max(axis=2) < 110)
    pale = (rgb.min(axis=2) > 60) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 70)
    H, W = al.shape; yy, xx = np.mgrid[0:H, 0:W]
    parts, used = {}, np.zeros_like(al)
    for arm, a in cfg['arms'].items():
        x0, y0, x1, y1 = a['region']
        reg = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        if 'cut' in a:   # diagonal boundary separating arm from ear/face: [[x,y], slope, "left"|"right"]
            (cx0, cy0), slope, side = a['cut']
            lim = cx0 + (yy - cy0) * slope
            reg &= ~((yy > cy0) & ((xx >= lim) if side == 'left' else (xx <= lim)))
        lab, _ = ndimage.label(skin & reg)
        sx, sy = a['seed']; win = lab[sy - 15:sy + 16, sx - 15:sx + 16]
        ids, cnt = np.unique(win[win > 0], return_counts=True)
        if not len(ids): sys.exit(f'no skin near seed for arm "{arm}" — move the seed onto the arm')
        core = lab == ids[np.argmax(cnt)]
        hx, hy = a['hand']; near = ndimage.binary_dilation(core, iterations=40)
        for i in np.unique(lab[near & (lab > 0)]):            # fingers split off by outlines
            ys, xs = np.where(lab == i)
            if math.hypot(xs.mean() - hx, ys.mean() - hy) < 95: core |= lab == i
        core = ndimage.binary_closing(core, iterations=2) & al
        m = core | (ndimage.binary_dilation(core, iterations=6) & reg & (dark | skin))   # own outline
        m = ndimage.binary_fill_holes(m) & al
        m |= ndimage.binary_dilation(m, iterations=7) & al & pale & reg                 # anti-alias rim
        parts[arm] = m; used |= m
    hx0, hy0, hx1, hy1 = cfg['head_box']; neck_y = cfg['neck'][1] + 4
    head = al & ~used & (yy < neck_y) & (xx >= hx0) & (xx < hx1)
    head &= ~(((G > 140) & (B < 130) & ((R - G) < 60)) & (yy > neck_y - 50))           # no shirt on the head
    lab, n = ndimage.label(head); sizes = ndimage.sum(head, lab, range(1, n + 1)); head = lab == (np.argmax(sizes) + 1)
    parts['head'] = head
    parts['body'] = al & ~used & ~(head & (yy < neck_y - 8))
    boxes = {}
    for pn, m in parts.items():
        ys, xs = np.where(m); bx = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        P = A.copy(); P[~m, 3] = 0
        Image.fromarray(P[bx[1]:bx[3], bx[0]:bx[2]]).save(os.path.join(out, f'{name}_{pn}.png')); boxes[pn] = bx
    vis = np.zeros((H, W, 3), np.uint8)
    for (pn, m), c in zip(parts.items(), [(220, 60, 60), (60, 200, 80), (60, 160, 230), (200, 120, 220), (230, 200, 40), (80, 80, 200)]):
        vis[m] = c
    Image.fromarray(vis).save(os.path.join(out, f'{name}_seg.png'))   # CHECK THIS IMAGE before animating
    return boxes, A


def osc(n_cycles, dur, amp, phase=0):
    """seamless loop: keyframes at quarter periods (0, +amp, 0, -amp ...)"""
    period = dur / n_cycles
    return [[round(i * period / 4), [0, 1, 0, -1][(i + phase) % 4] * amp] for i in range(n_cycles * 4 + 1)]


def build(cfg, boxes, A, out, name):
    S = cfg.get('scale', 0.7); FEET = cfg['feet']; AB = cfg.get('artboard', [560, 760])
    ROOT = (AB[0] / 2, AB[1] - 25)
    L = lambda px, py: ((px - FEET[0]) * S, (py - FEET[1]) * S)
    ctr = lambda n: ((boxes[n][0] + boxes[n][2]) / 2, (boxes[n][1] + boxes[n][3]) / 2)
    ang = lambda a, b: math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    dist = lambda a, b: math.hypot(b[0] - a[0], b[1] - a[1]) * S
    nx, ny = L(*cfg['neck'])
    px, py = cfg['skin_px']; sk = A[py - 3:py + 3, px - 3:px + 3, :3].reshape(-1, 3).mean(0).astype(int)
    SKIN = cfg.get('skin_color', '#%02x%02x%02x' % tuple(sk))
    absp = lambda f: os.path.abspath(os.path.join(out, f))
    groups = [{'id': 'root', 'x': ROOT[0], 'y': ROOT[1]}, {'id': 'headG', 'parent': 'root', 'x': nx, 'y': ny}]
    bones, images, shapes, rest = [], [], [], {}
    for k, j in cfg['arms'].items():
        sx, sy = L(*j['sh']); groups.append({'id': f'sh_{k}', 'parent': 'root', 'x': sx, 'y': sy})
        up = ang(j['sh'], j['el']); lo = ang(j['el'], j['hand']) - up; rest[k] = (up, lo)
        bones += [{'id': f'up_{k}', 'parent': f'sh_{k}', 'x': 0, 'y': 0, 'rotation': up, 'length': dist(j['sh'], j['el'])},
                  {'id': f'lo_{k}', 'parent': f'up_{k}', 'rotation': lo, 'length': dist(j['el'], j['hand'])}]
        cx, cy = L(*ctr(k))
        images.append({'id': k, 'pngPath': absp(f'{name}_{k}.png'), 'x': cx, 'y': cy, 'scale': S, 'parent': 'root',
                       'mesh': {'columns': 6, 'rows': 16, 'bones': [f'up_{k}', f'lo_{k}']}, 'z': 900})
    bx, by = L(*ctr('body'))
    images.append({'id': 'body', 'pngPath': absp(f'{name}_body.png'), 'x': bx, 'y': by, 'scale': S, 'parent': 'root', 'z': 1000})
    hx, hy = L(*ctr('head'))
    images.append({'id': 'head', 'pngPath': absp(f'{name}_head.png'), 'x': hx - nx, 'y': hy - ny, 'scale': S, 'parent': 'headG', 'z': 1100})
    for i, (ex0, ey0, ex1, ey1) in enumerate(cfg.get('eyes', [])):
        c = L((ex0 + ex1) / 2, (ey0 + ey1) / 2); w, h = (ex1 - ex0) * S * 1.12, (ey1 - ey0) * S * 1.15
        shapes += [{'id': f'lid{i}', 'type': 'ellipse', 'parent': 'headG', 'x': c[0] - nx, 'y': c[1] - ny, 'width': w, 'height': h, 'opacity': 0, 'fill': {'color': SKIN}, 'z': 1200},
                   {'id': f'lash{i}', 'type': 'rect', 'parent': 'headG', 'x': c[0] - nx, 'y': c[1] - ny + h * 0.2, 'width': w * 0.9, 'height': 2.6, 'cornerRadius': 1.3, 'opacity': 0, 'fill': {'color': '#1c120c'}, 'z': 1201}]
    kf = lambda keys: [{'frame': k[0], 'value': k[1], **({'easing': k[2] if len(k) > 2 else 'ease-in-out'} if k[0] else {})} for k in keys]
    lids = [t for i in range(len(cfg.get('eyes', []))) for t in (f'lid{i}', f'lash{i}')]
    anims = []
    for a in cfg['anims']:
        tracks = []
        for tgt, keys in a['channels'].items():
            if isinstance(keys, dict): keys = osc(keys['cycles'], a['dur'], keys['amp'], keys.get('phase', 0))
            # channel names: root (squash, scaleY offset), head (degrees), up_<arm> / lo_<arm> (degrees offset from rest)
            if tgt == 'root': t, prop, base = 'root', 'scaleY', 1
            elif tgt == 'head': t, prop, base = 'headG', 'rotation', 0
            else:
                t, prop = tgt, 'rotation'; seg, arm = tgt.split('_', 1)
                base = rest[arm][0] if seg == 'up' else rest[arm][1]
            tracks.append({'target': t, 'property': prop, 'keyframes': kf([[k[0], base + k[1], *k[2:]] for k in keys])})
        ks = [{'frame': 0, 'value': 0, 'easing': 'hold'}]
        for f in a.get('blinks', []): ks += [{'frame': f, 'value': 1, 'easing': 'hold'}, {'frame': f + 6, 'value': 0, 'easing': 'hold'}]
        ks.append({'frame': a['dur'], 'value': 0})
        tracks += [{'target': t, 'property': 'opacity', 'keyframes': ks} for t in lids]
        anims.append({'name': a['name'], 'fps': 60, 'duration': a['dur'], 'loop': a.get('loop', 'loop'), 'tracks': tracks})
    spec = {'artboard': {'name': name, 'width': AB[0], 'height': AB[1]}, 'groups': groups, 'bones': bones, 'shapes': shapes, 'images': images, 'animations': anims}
    args = os.path.join(out, f'{name}.args.json')
    json.dump({'outPath': absp(f'{name}.riv'), 'scene': spec}, open(args, 'w'))
    return args


if __name__ == '__main__':
    cfg_path = sys.argv[1]; cfg = json.load(open(cfg_path)); base = os.path.dirname(os.path.abspath(cfg_path))
    name = cfg['name']; out = os.path.join(base, cfg.get('out', 'out')); os.makedirs(out, exist_ok=True)
    rgb = np.array(Image.open(os.path.join(base, cfg['image'])).convert('RGB'))
    if 'crop_x' in cfg: rgb = rgb[:, cfg['crop_x'][0]:cfg['crop_x'][1]]       # one figure from a multi-pose sheet
    A = np.dstack([rgb, remove_background(rgb, cfg.get('bg_thresh', 226))])
    boxes, A = segment(A, cfg, out, name)
    print('parts:', json.dumps(boxes))
    print('next: check', os.path.join(out, f'{name}_seg.png'), 'then run: node client.mjs riv_create @' + build(cfg, boxes, A, out, name))
