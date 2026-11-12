import json, math, os
B = json.load(open('boxes.json')); HERE = os.path.abspath('.')
S = 1.0
def osc(n, dur, amp, phase=0, base=0):
    per = dur / n
    return [[round(i * per / 4), base + [0, 1, 0, -1][(i + phase) % 4] * amp] for i in range(n * 4 + 1)]
def kf(keys):
    return [{'frame': k[0], 'value': k[1], **({'easing': k[2] if len(k) > 2 else 'ease-in-out'} if k[0] else {})} for k in keys]
ang = lambda a, b: math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
dist = lambda a, b: math.hypot(b[0] - a[0], b[1] - a[1]) * S

def rig(pose, AB, ROOTPX, neck, limbs, anims):
    L = lambda x, y: ((x - ROOTPX[0]) * S, (y - ROOTPX[1]) * S)
    ctr = lambda n: ((B[pose][n][0] + B[pose][n][2]) / 2, (B[pose][n][1] + B[pose][n][3]) / 2)
    groups = [{'id': 'root', 'x': AB[0] / 2, 'y': AB[1] - 30}]
    nx, ny = L(*neck); groups.append({'id': 'headG', 'parent': 'root', 'x': nx, 'y': ny})
    bones, images, rest = [], [], {}
    for name, l in limbs.items():
        px, py = L(*l['pivot']); g = f'g_{name}'
        groups.append({'id': g, 'parent': 'root', 'x': px, 'y': py})
        cx, cy = L(*ctr(name))
        if 'el' in l:     # 2-bone skinned mesh (arms)
            up = ang(l['pivot'], l['el']); lo = ang(l['el'], l['hand']) - up; rest[name] = (up, lo)
            bones += [{'id': f'up_{name}', 'parent': g, 'x': 0, 'y': 0, 'rotation': up, 'length': dist(l['pivot'], l['el'])},
                      {'id': f'lo_{name}', 'parent': f'up_{name}', 'rotation': lo, 'length': dist(l['el'], l['hand'])}]
            images.append({'id': name, 'pngPath': f'{HERE}/{pose}_{name}.png', 'x': cx, 'y': cy, 'scale': S, 'parent': 'root',
                           'mesh': {'columns': 6, 'rows': 14, 'bones': [f'up_{name}', f'lo_{name}']}, 'z': l.get('z', 900)})
        else:             # rigid limb rotating at its hidden pivot (legs under the dhoti)
            rest[name] = (0, 0)
            images.append({'id': name, 'pngPath': f'{HERE}/{pose}_{name}.png', 'x': cx - (l['pivot'][0] - ROOTPX[0]) * S - 0, 'y': cy - (l['pivot'][1] - ROOTPX[1]) * S,
                           'scale': S, 'parent': g, 'z': l.get('z', 900)})
    bx, by = L(*ctr('body')); hx, hy = L(*ctr('head'))
    images.append({'id': 'body', 'pngPath': f'{HERE}/{pose}_body.png', 'x': bx, 'y': by, 'scale': S, 'parent': 'root', 'z': 1000})
    images.append({'id': 'head', 'pngPath': f'{HERE}/{pose}_head.png', 'x': hx - nx, 'y': hy - ny, 'scale': S, 'parent': 'headG', 'z': 1100})
    out = []
    for a in anims:
        tracks = []
        for tgt, keys in a['ch'].items():
            if isinstance(keys, dict): keys = osc(keys['n'], a['dur'], keys['amp'], keys.get('ph', 0))
            if tgt == 'bob': tracks.append({'target': 'root', 'property': 'y', 'keyframes': kf([[k[0], AB[1] - 30 + k[1], *k[2:]] for k in keys])}); continue
            if tgt == 'lean': tracks.append({'target': 'root', 'property': 'rotation', 'keyframes': kf(keys)}); continue
            if tgt == 'head': tracks.append({'target': 'headG', 'property': 'rotation', 'keyframes': kf(keys)}); continue
            part, limb = tgt.split(':')          # up:armBack / lo:armBack / rot:legBack
            if part == 'rot': tracks.append({'target': f'g_{limb}', 'property': 'rotation', 'keyframes': kf(keys)})
            else:
                base = rest[limb][0] if part == 'up' else rest[limb][1]
                tracks.append({'target': f'{part}_{limb}', 'property': 'rotation', 'keyframes': kf([[k[0], base + k[1], *k[2:]] for k in keys])})
        out.append({'name': a['name'], 'fps': 60, 'duration': a['dur'], 'loop': 'loop', 'tracks': tracks})
    spec = {'artboard': {'name': pose, 'width': AB[0], 'height': AB[1]}, 'groups': groups, 'bones': bones, 'images': images, 'animations': out}
    json.dump({'outPath': f'{HERE}/{pose}.riv', 'scene': spec}, open(f'{pose}.args.json', 'w'))

# RUN: 24 frames @60fps = 0.4 s per cycle (two steps)
D = 24
rig('run', (480, 560), (190, 445), (226, 172),
    {'armBack':  {'pivot': (182, 170), 'el': (120, 182), 'hand': (72, 222), 'z': 880},
     'armFront': {'pivot': (236, 212), 'el': (263, 252), 'hand': (318, 182), 'z': 950},
     'legBack':  {'pivot': (172, 292), 'z': 870},
     'legFront': {'pivot': (212, 352), 'z': 890}},
    [{'name': 'run', 'dur': D, 'ch': {
        'rot:legBack':  [[0, 0], [12, 44, 'inout'], [24, 0, 'inout']],
        'rot:legFront': [[0, 0], [12, -48, 'inout'], [24, 0, 'inout']],
        'up:armBack':   [[0, 0], [12, -38], [24, 0]], 'lo:armBack': [[0, 0], [12, -20], [24, 0]],
        'up:armFront':  [[0, 0], [12, 34], [24, 0]],  'lo:armFront': [[0, 0], [12, 18], [24, 0]],
        'bob': [[0, 0], [6, -16, 'out'], [12, 0, 'in'], [18, -16, 'out'], [24, 0, 'in']],
        'head': [[0, 0], [6, -2], [12, 1], [18, -2], [24, 0]],
        'lean': [[0, 0], [12, 1.5], [24, 0]]}}])
# FALL: flail 0.5 s, dazed 1.2 s
rig('fall', (520, 520), (215, 420), (175, 205),
    {'armLeft':  {'pivot': (142, 240), 'el': (95, 226), 'hand': (28, 205), 'z': 880},
     'armRight': {'pivot': (224, 226), 'el': (260, 176), 'hand': (302, 118), 'z': 950}},
    [{'name': 'flail', 'dur': 30, 'ch': {
        'up:armLeft': {'n': 2, 'amp': 14}, 'lo:armLeft': {'n': 2, 'amp': 18, 'ph': 1},
        'up:armRight': {'n': 2, 'amp': 14, 'ph': 2}, 'lo:armRight': {'n': 2, 'amp': 18, 'ph': 3},
        'head': {'n': 2, 'amp': 5}}},
     {'name': 'dazed', 'dur': 72, 'ch': {
        'head': {'n': 1, 'amp': 6}, 'up:armLeft': {'n': 1, 'amp': 4, 'ph': 1}, 'up:armRight': {'n': 1, 'amp': 4, 'ph': 3},
        'lo:armRight': {'n': 1, 'amp': 8}}}])
print('ok')
