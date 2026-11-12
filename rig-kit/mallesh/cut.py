# Cut Mallesh's run / fall poses into rig parts. Limbs get a hidden skin "capsule" extension toward their pivot
# (it sits behind the sleeve / dhoti) so rotating them never opens a gap.
import json, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

def load(name):
    A = np.array(Image.open(f'{name}_raw.png'))
    cfg = json.load(open('parts.json'))[name]
    rgb = A[:, :, :3].astype(int); white = (rgb.min(axis=2) > 236) & (A[:, :, 3] > 0)
    lab0, n0 = ndimage.label(white)
    for i in range(1, n0 + 1):
        ys, xs = np.where(lab0 == i)
        if any(x0 <= xs.mean() < x1 and y0 <= ys.mean() < y1 for x0, y0, x1, y1 in cfg.get('pockets', [])): A[lab0 == i, 3] = 0
    al = A[:, :, 3] > 0
    lab, n = ndimage.label(al); sizes = ndimage.sum(al, lab, range(1, n + 1))
    main = lab == (np.argmax(sizes) + 1)                    # drop speed lines, dust, burst, sweat marks
    fx = al & ~main
    return A, main, fx

def colours(A):
    rgb = A[:, :, :3].astype(int); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    skin = (R > 150) & (R - G > 28) & (R - B > 55)
    brown = (R > 70) & (R < 200) & (R - B > 35) & (R - G > 18) & (G - B > 5)       # sandals
    dhoti = (rgb.min(axis=2) > 196) | ((R > 200) & (G > 170) & (B < 140) & (R - G < 60))
    shirt = (G > 120) & (B < 140) & ((R - G) < 50) & ~dhoti
    dark = rgb.max(axis=2) < 110
    return skin, brown, dhoti, shirt, dark

def limb(A, main, region, seed, kinds, extra_dil=6, exclude=()):
    skin, brown, dhoti, shirt, dark = colours(A)
    H, W = main.shape; yy, xx = np.mgrid[0:H, 0:W]
    x0, y0, x1, y1 = region; reg = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1) & main
    for ex0, ey0, ex1, ey1 in exclude: reg &= ~((xx >= ex0) & (xx < ex1) & (yy >= ey0) & (yy < ey1))
    body = skin | (brown if 'sandal' in kinds else False)
    lab, _ = ndimage.label(body & reg)
    win = lab[seed[1] - 12:seed[1] + 13, seed[0] - 12:seed[0] + 13]; ids, cnt = np.unique(win[win > 0], return_counts=True)
    core = lab == ids[np.argmax(cnt)]
    near = ndimage.binary_dilation(core, iterations=30)
    for i in np.unique(lab[near & (lab > 0)]):              # fingers / sandal straps split by outlines
        comp = lab == i
        if comp.sum() < 4000: core |= comp
    core = ndimage.binary_closing(core, iterations=2) & main
    m = core | (ndimage.binary_dilation(core, iterations=extra_dil) & reg & dark)
    m = ndimage.binary_fill_holes(m) & main
    rgb = A[:, :, :3].astype(int)
    pale = (rgb.min(axis=2) > 60) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 70) & ~dhoti
    m |= ndimage.binary_dilation(m, iterations=7) & pale & reg & ~ndimage.binary_erosion(main, iterations=3)   # outer rim only
    return m

def save_part(A, m, name, capsule=None, skin_col=None):
    """capsule: (from_xy, to_xy, width) painted in skin colour *under* the part, toward the hidden pivot"""
    P = A.copy(); P[~m, 3] = 0
    img = Image.fromarray(P, 'RGBA')
    if capsule:
        (ax, ay), (bx, by), w = capsule
        cap = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(cap)
        d.line([(ax, ay), (bx, by)], fill=skin_col + (255,), width=w); d.ellipse((bx - w / 2, by - w / 2, bx + w / 2, by + w / 2), fill=skin_col + (255,))
        cap.alpha_composite(img); img = cap
    bb = img.getbbox(); img.crop(bb).save(f'{name}.png')
    return list(bb)

def rest_body(A, main, parts):
    used = np.zeros_like(main)
    for m in parts: used |= m
    return main & ~used

out = {}
for pose, cfg in json.load(open('parts.json')).items():
    A, main, fx = load(pose)
    skin_col = tuple(int(v) for v in A[cfg['skin_px'][1], cfg['skin_px'][0], :3])
    masks = {}
    for part, p in cfg['limbs'].items():
        masks[part] = limb(A, main, p['region'], p['seed'], p.get('kinds', []), exclude=p.get('exclude', []))
    H, W = main.shape; yy, xx = np.mgrid[0:H, 0:W]
    hx0, hy0, hx1, hy1 = cfg['head_box']
    _, _, dhoti, shirt, _ = colours(A)
    head = main & (yy < cfg['neck'][1] + 6) & (xx >= hx0) & (xx < hx1) & ~shirt
    for m in masks.values(): head &= ~m
    for ex0, ey0, ex1, ey1 in cfg.get('head_exclude', []): head &= ~((xx >= ex0) & (xx < ex1) & (yy >= ey0) & (yy < ey1))
    lab, n = ndimage.label(head); sizes = ndimage.sum(head, lab, range(1, n + 1)); head = lab == (np.argmax(sizes) + 1)
    masks['head'] = head
    body = rest_body(A, main, masks.values()) | (head & (yy >= cfg['neck'][1] - 6))
    boxes = {}
    for part, m in masks.items():
        cap = cfg['limbs'].get(part, {}).get('capsule')
        boxes[part] = save_part(A, m, f'{pose}_{part}', cap, skin_col)
    boxes['body'] = save_part(A, body, f'{pose}_body')
    if fx.any(): boxes['fx'] = save_part(A, fx, f'{pose}_fx')
    out[pose] = boxes
    vis = np.zeros((H, W, 3), np.uint8)
    pal = [(220, 60, 60), (60, 200, 80), (60, 160, 230), (200, 120, 220), (240, 150, 40), (230, 200, 40)]
    vis[body] = (80, 80, 200)
    for (part, m), c in zip(masks.items(), pal): vis[m] = c
    vis[fx] = (120, 120, 120)
    Image.fromarray(vis).save(f'{pose}_seg.png')
json.dump(out, open('boxes.json', 'w'), indent=1); print(json.dumps(out))
