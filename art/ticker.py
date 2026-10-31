# HypeEdge ticker image, wordmark style: a black field, the lowercase "hypeedge" wordmark in a heavy rounded face,
# and halftone dot rings sweeping round it in Hyperliquid mint and white, with a soft glow on the bright arcs.
# python art/ticker.py out.png [size] [seed]
import sys, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

out = sys.argv[1]; S = int(sys.argv[2]) if len(sys.argv) > 2 else 1000; random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
K = 2; W = S * K
MINT, WHITE = (94, 240, 207), (235, 255, 250)
img = Image.new("RGB", (W, W), (0, 0, 0))
dots = Image.new("RGB", (W, W), (0, 0, 0)); d = ImageDraw.Draw(dots)
cx, cy = W * 0.5, W * 0.5

# rings: tilted ellipses drawn as halftone lanes (dots at an even step along each lane), the dots swelling on one
# bright arc per ring and fading round the rest of it
rings = [  # rx, ry, tilt, lanes, lane gap, arc centre, arc spread, colour (0 mint .. 1 white), step (deg)
    (0.500, 0.300, -12, 9, 0.0120, 205, 64, 0.0, 0.50),
    (0.470, 0.272, -9, 5, 0.0085, 25, 52, 1.0, 0.55),
    (0.570, 0.370, -16, 12, 0.0140, 150, 58, 0.0, 0.45),
    (0.545, 0.350, -15, 4, 0.0095, 330, 46, 1.0, 0.55),
    (0.660, 0.450, -20, 8, 0.0200, 60, 40, 0.0, 0.40),
    (0.640, 0.430, -18, 3, 0.0110, 250, 36, 1.0, 0.45),
]
for rx, ry, tilt, lanes, gap, arc, spread, white, step in rings:
    t = math.radians(tilt); ct, st = math.cos(t), math.sin(t)
    for L in range(lanes):
        u = (L - (lanes - 1) / 2) * gap
        a = random.uniform(0, step)
        while a < 360:
            dist = min(abs(a - arc), 360 - abs(a - arc)); env = math.exp(-(dist / spread) ** 2)
            lane = math.exp(-((L - (lanes - 1) / 2) / (lanes / 2.2)) ** 2)       # middle lanes carry the biggest dots
            rad = W * (0.0006 + 0.0034 * env * lane)
            if rad > W * 0.0007:
                x, y = (rx + u) * math.cos(math.radians(a)) * W, (ry + u * 0.62) * math.sin(math.radians(a)) * W
                X, Y = cx + x * ct - y * st, cy + x * st + y * ct
                c = WHITE if (white > 0.5) != (random.random() < 0.08) else MINT
                k = 0.30 + 0.70 * env
                d.ellipse((X - rad, Y - rad, X + rad, Y + rad), fill=tuple(int(v * k) for v in c))
            a += step * (1.0 + 0.6 * (1 - env))
    pts = []
    for j in range(300):
        a = arc - spread * 1.8 + j * spread * 3.6 / 300
        x, y = rx * math.cos(math.radians(a)) * W, ry * math.sin(math.radians(a)) * W
        pts.append((cx + x * ct - y * st, cy + x * st + y * ct))
    d.line(pts, fill=WHITE if white > 0.5 else MINT, width=max(1, int(W * 0.0014)))

# an outer halftone sweep: a grid of dots between two wide tilted ellipses, growing toward the frame's edge
t = math.radians(-14); ct, st = math.cos(t), math.sin(t)
g = W * 0.016
for gy in range(-2, int(W / g) + 3):
    for gx in range(-2, int(W / g) + 3):
        X, Y = gx * g + (g / 2 if gy % 2 else 0), gy * g
        x, y = (X - cx) * ct + (Y - cy) * st, -(X - cx) * st + (Y - cy) * ct
        e = math.hypot(x / (0.60 * W), y / (0.40 * W))              # 1 on the sweep's inner edge
        if e < 1.0 or e > 1.55: continue
        ang = math.degrees(math.atan2(y / 0.40, x / 0.60)) % 360
        side = math.exp(-((min(abs(ang - 35), 360 - abs(ang - 35))) / 55) ** 2) + math.exp(-((min(abs(ang - 215), 360 - abs(ang - 215))) / 55) ** 2)
        k = side * math.sin(min(1, (e - 1.0) / 0.55) * math.pi)
        rad = g * 0.42 * k
        if rad < W * 0.0009: continue
        c = WHITE if (ang % 360) > 180 and random.random() < 0.35 else MINT
        d.ellipse((X - rad, Y - rad, X + rad, Y + rad), fill=tuple(int(v * (0.35 + 0.65 * k)) for v in c))

glow = dots.filter(ImageFilter.GaussianBlur(W * 0.008))
img = ImageChops.add(img, glow); img = ImageChops.add(img, dots)
# keep the middle clear for the word
mask = Image.new("L", (W, W), 0); ImageDraw.Draw(mask).ellipse((W * 0.14, W * 0.38, W * 0.86, W * 0.62), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(W * 0.05))
img = Image.composite(Image.new("RGB", (W, W), (0, 0, 0)), img, mask)

# the wordmark
font = ImageFont.truetype("D:/cooks/hyperlist/assets/fonts/Fredoka.ttf", int(W * 0.15))
font.set_variation_by_axes([700, 100])                              # weight, width
word = "hypeedge"
dw = ImageDraw.Draw(img)
bb = dw.textbbox((0, 0), word, font=font)
tx, ty = cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1] - W * 0.01
dw.text((tx, ty), word, font=font, fill=(255, 255, 255))
img.resize((S, S), Image.LANCZOS).save(out)
print("wrote", out)
