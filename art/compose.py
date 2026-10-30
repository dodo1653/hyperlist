# HypeEdge's coin image, part 2: the rendered coin on a deep green field with Hyperliquid's mint grid tunnel
# (the look of pump.fun x Hyperliquid's launch film), a soft glow behind the coin and its shadow.
# python art/compose.py art/out/coin_raw.png art/out/hypeedge_coin.png [size]
import sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

src, out = sys.argv[1], sys.argv[2]
S = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
SS = S * 2                                              # draw at 2x, scale down at the end (clean lines)
def hexc(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# the field: a radial from deep teal in the middle to near-black green at the corners
bg = Image.new('RGB', (SS, SS)); px = bg.load()
c0, c1 = hexc('#0f4a3f'), hexc('#03100d')
for y in range(SS):
    for x in range(0, SS):
        d = min(1, math.hypot(x - SS / 2, y - SS * 0.47) / (SS * 0.72)); d = d ** 1.15
        px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * d) for i in range(3))

# the grid tunnel: rings of a square tunnel receding to the centre + rays to its corners and along its walls
grid = Image.new('L', (SS, SS), 0); g = ImageDraw.Draw(grid)
cx, cy = SS / 2, SS * 0.47
for k in range(1, 14):
    z = 0.5 ** (k * 0.42)                               # depth -> size
    w = SS * 1.45 * z
    a = int(150 * min(1, z * 2.2))
    g.rectangle((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), outline=a, width=max(2, int(4 * z + 1)))
for i in range(-6, 7):
    for side in range(4):
        t = i / 6
        far = (cx + t * SS * 0.03, cy) ; ex = SS * 0.8
        if side == 0: p = (cx + t * ex, cy - ex)
        elif side == 1: p = (cx + t * ex, cy + ex)
        elif side == 2: p = (cx - ex, cy + t * ex)
        else: p = (cx + ex, cy + t * ex)
        g.line((cx + (p[0] - cx) * 0.06, cy + (p[1] - cy) * 0.06, p[0], p[1]), fill=110, width=3)
grid = grid.filter(ImageFilter.GaussianBlur(1.2))
# the grid fades toward the middle (the coin sits there) and toward the edges
mask = Image.new('L', (SS, SS), 0); mp = mask.load()
for y in range(0, SS, 2):
    for x in range(0, SS, 2):
        d = math.hypot(x - cx, y - cy) / (SS * 0.5)
        v = int(255 * max(0, min(1, (d - 0.42) / 0.35)) * max(0, min(1, (1.25 - d) / 0.5)) * 0.55)
        mp[x, y] = v; mp[x + 1 if x + 1 < SS else x, y] = v; mp[x, y + 1 if y + 1 < SS else y] = v; mp[x + 1 if x + 1 < SS else x, y + 1 if y + 1 < SS else y] = v
grid = ImageChops.multiply(grid, mask)
mint = Image.new('RGB', (SS, SS), hexc('#97fce4'))
bg = Image.composite(mint, bg, grid)

# glow behind the coin
glow = Image.new('L', (SS, SS), 0); ImageDraw.Draw(glow).ellipse((SS * 0.2, SS * 0.17, SS * 0.8, SS * 0.77), fill=120)
glow = glow.filter(ImageFilter.GaussianBlur(SS * 0.09))
bg = Image.composite(Image.new('RGB', (SS, SS), hexc('#5ef0cf')), bg, glow)

# the coin, its soft shadow below
coin = Image.open(src).convert('RGBA'); cs = int(SS * 0.92); coin = coin.resize((cs, cs), Image.LANCZOS)
ox, oy = (SS - cs) // 2, int(SS * 0.035)
sh = Image.new('L', (SS, SS), 0); ImageDraw.Draw(sh).ellipse((SS * 0.27, SS * 0.86, SS * 0.73, SS * 0.93), fill=150)
sh = sh.filter(ImageFilter.GaussianBlur(SS * 0.03))
bg = Image.composite(Image.new('RGB', (SS, SS), hexc('#010806')), bg, sh)
bg = bg.convert('RGBA'); bg.alpha_composite(coin, (ox, oy))

# a few specks of light in the tunnel
d = ImageDraw.Draw(bg)
for (x, y, r) in [(0.13, 0.2, 5), (0.88, 0.16, 4), (0.9, 0.7, 6), (0.08, 0.78, 4), (0.75, 0.9, 3)]:
    d.ellipse((x * SS - r, y * SS - r, x * SS + r, y * SS + r), fill=(200, 255, 240, 230))
bg.convert('RGB').resize((S, S), Image.LANCZOS).save(out, quality=95)
print('wrote', out)
