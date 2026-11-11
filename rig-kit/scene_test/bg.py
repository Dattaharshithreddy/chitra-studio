# Procedural flat-cartoon background (village compound with a mango tree) at 1080x1920, drawn 2x then downsampled.
import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7)
W, H, K = 1080, 1920, 2
im = Image.new('RGB', (W * K, H * K)); d = ImageDraw.Draw(im)
def P(*v): return [int(x * K) for x in v]
# sky
for y in range(0, 1100 * K):
    t = y / (1100 * K); c = tuple(int(a + (b - a) * t) for a, b in zip((112, 190, 240), (196, 232, 250)))
    d.line([(0, y), (W * K, y)], fill=c)
# clouds
for cx, cy, s in [(180, 260, 1.0), (760, 170, 1.2), (930, 420, 0.8), (430, 520, 0.7)]:
    for dx, dy, r in [(-60, 10, 48), (0, -10, 62), (60, 8, 50), (110, 18, 38), (-105, 22, 34)]:
        d.ellipse(P(cx + dx * s - r * s, cy + dy * s - r * s, cx + dx * s + r * s, cy + dy * s + r * s), fill=(255, 255, 255))
# distant palms behind the wall
def palm(x, base, h, lean):
    top = (x + lean, base - h)
    d.line(P(x, base, *top), fill=(120, 96, 70), width=14 * K)
    for a in range(0, 360, 45):
        ex, ey = top[0] + math.cos(math.radians(a)) * 95, top[1] + math.sin(math.radians(a)) * 38 + 20
        d.polygon(P(top[0], top[1], ex, ey - 12, ex + 6, ey + 10), fill=(58, 140, 70))
palm(880, 1080, 330, 25); palm(1010, 1080, 260, -15); palm(90, 1080, 280, 10)
# compound wall
WY0, WY1 = 1050, 1360
d.rectangle(P(0, WY0, W, WY1), fill=(240, 228, 205))
d.rectangle(P(0, WY0 - 26, W, WY0 + 6), fill=(186, 92, 60))
for i in range(60):   # soft stone blotches
    x, y = random.uniform(0, W), random.uniform(WY0 + 30, WY1 - 20); r = random.uniform(14, 34)
    d.ellipse(P(x - r * 1.6, y - r, x + r * 1.6, y + r), fill=(230, 215, 188))
font = ImageFont.truetype('telugu.woff', 54 * K); small = ImageFont.truetype('telugu.woff', 34 * K)
d.text(P(392, 1090), 'ఇక్కడ పండ్లు', font=font, fill=(196, 40, 40), anchor='la')
d.text(P(408, 1165), 'కోయరాదు', font=font, fill=(196, 40, 40), anchor='la')
d.line(P(440, 1272, 466, 1272), fill=(196, 40, 40), width=4 * K)          # dash drawn (font has no hyphen)
d.text(P(474, 1250), 'అమ్మమ్మ', font=small, fill=(196, 40, 40), anchor='la')
# ground
for y in range(WY1 * K, H * K):
    t = (y - WY1 * K) / ((H - WY1) * K); c = tuple(int(a + (b - a) * t) for a, b in zip((128, 196, 82), (92, 160, 58)))
    d.line([(0, y), (W * K, y)], fill=c)
d.ellipse(P(80, 1640, 640, 1790), fill=(150, 140, 92))     # dirt patch under the tree
for i in range(140):   # grass tufts
    x, y = random.uniform(0, W), random.uniform(WY1 + 30, H - 20)
    for j in (-1, 0, 1):
        d.line(P(x, y, x + j * 9, y - random.uniform(16, 30)), fill=(70, 140, 50), width=3 * K)
# mango tree
TX = 330
d.polygon(P(TX - 55, 1720, TX - 30, 1200, TX - 20, 820, TX + 25, 820, TX + 40, 1200, TX + 60, 1720), fill=(124, 82, 52))
for (x0, y0, x1, y1, w) in [(TX, 1000, TX + 230, 900, 26), (TX, 960, TX - 170, 860, 22), (TX + 10, 1060, TX + 300, 1010, 18)]:
    d.line(P(x0, y0, x1, y1), fill=(124, 82, 52), width=w * K)
for (x, y) in [(TX - 10, 1300), (TX + 5, 1450), (TX - 15, 1150)]:   # bark marks
    d.line(P(x - 12, y, x, y + 14, x + 12, y), fill=(98, 62, 38), width=4 * K, joint='curve')
blobs = [(TX - 250, 700, 190), (TX - 60, 600, 230), (TX + 170, 660, 210), (TX + 330, 800, 160), (TX - 330, 860, 150),
         (TX - 140, 860, 200), (TX + 90, 860, 210), (TX + 260, 930, 140)]
for x, y, r in blobs: d.ellipse(P(x - r, y - r, x + r, y + r), fill=(46, 125, 50))
for x, y, r in blobs: d.ellipse(P(x - r * 0.8, y - r * 0.85, x + r * 0.7, y + r * 0.45), fill=(67, 160, 71))
for i in range(150):   # leaf strokes
    x, y = random.uniform(TX - 520, TX + 470), random.uniform(450, 1030)
    if any((x - bx) ** 2 + (y - by) ** 2 < (br * 0.9) ** 2 for bx, by, br in blobs):
        a = random.uniform(0, math.pi)
        d.line(P(x, y, x + math.cos(a) * 26, y + math.sin(a) * 12), fill=random.choice([(38, 105, 42), (94, 180, 90)]), width=6 * K)
d.line(P(TX + 150, 960, TX + 150, 980), fill=(90, 70, 40), width=3 * K)   # stalk of the mango that will fall
for (mx, my) in [(TX - 120, 960), (TX - 260, 900)]:   # hanging mangoes (decor)
    d.line(P(mx, my - 40, mx, my - 18), fill=(90, 70, 40), width=3 * K)
    d.ellipse(P(mx - 20, my - 22, mx + 20, my + 24), fill=(252, 176, 38)); d.ellipse(P(mx - 9, my - 14, mx + 2, my - 4), fill=(255, 220, 120))
im.resize((W, H), Image.LANCZOS).save('bg.png')
# falling mango prop
m = Image.new('RGBA', (120, 140), (0, 0, 0, 0)); md = ImageDraw.Draw(m)
md.ellipse((14, 26, 106, 132), fill=(252, 176, 38, 255), outline=(150, 90, 20, 255), width=4)
md.ellipse((34, 44, 58, 70), fill=(255, 222, 130, 255))
md.polygon([(60, 28), (90, 4), (100, 16), (66, 32)], fill=(70, 150, 60, 255))
m.resize((84, 98), Image.LANCZOS).save('mango.png')
print('ok')
