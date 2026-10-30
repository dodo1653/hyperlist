# HypeEdge's ticker image: the mint field with the dark mark (a solid disc and a ring, a coin and its twin),
# now with an edge: the solid disc is cut by one clean diagonal slice. Drawn at 4x and scaled down.
# python art/icon.py out.png [variant] [size] [tilt_deg] [scale]      variant: mirror (default: ring left, sliced disc right, tilted 14 deg) | slice
import sys, math
from PIL import Image, ImageDraw

out = sys.argv[1]; variant = sys.argv[2] if len(sys.argv) > 2 else "mirror"; S = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
TILT = float(sys.argv[4]) if len(sys.argv) > 4 else 14.0; SCALE = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
K = 4; W = S * K
MINT, INK = (151, 252, 228), (6, 32, 29)
im = Image.new('RGB', (W, W), MINT); d = ImageDraw.Draw(im)

R = 0.228 * W                      # both shapes' outer radius (as before)
ring_in = 0.122 * W                # the ring's hole
cy = 0.5 * W
left, right = 0.268 * W, 0.732 * W
disc_x, ring_x = (right, left) if variant == 'mirror' else (left, right)

def circle(x, y, r, fill): d.ellipse((x - r, y - r, x + r, y + r), fill=fill)

# the ring (the twin)
circle(ring_x, cy, R, INK); circle(ring_x, cy, ring_in, MINT)

# the disc (the coin), sliced: a mint band at 52 degrees through it, the lower half nudged along the cut
disc = Image.new('L', (W, W), 0); circle_d = ImageDraw.Draw(disc)
circle_d.ellipse((disc_x - R, cy - R, disc_x + R, cy + R), fill=255)
ang = math.radians(52); ux, uy = math.cos(ang), -math.sin(ang)      # the cut's direction (up and to the right)
nx, ny = -uy, ux                                                     # its normal
gap = 0.034 * W; shift = 0.022 * W
upper = Image.new('L', (W, W), 0); lower = Image.new('L', (W, W), 0)
far = W * 2
def half(img, sign):
    # the half-plane on one side of the cut line through the disc's centre, past half the gap
    o = (disc_x + nx * sign * gap / 2, cy + ny * sign * gap / 2)
    pts = [(o[0] - ux * far, o[1] - uy * far), (o[0] + ux * far, o[1] + uy * far),
           (o[0] + ux * far + nx * sign * far, o[1] + uy * far + ny * sign * far), (o[0] - ux * far + nx * sign * far, o[1] - uy * far + ny * sign * far)]
    ImageDraw.Draw(img).polygon(pts, fill=255)
half(upper, -1); half(lower, 1)
from PIL import ImageChops
a = ImageChops.multiply(disc, upper)
b = ImageChops.multiply(disc, lower).transform((W, W), Image.AFFINE, (1, 0, -ux * shift, 0, 1, -uy * shift), resample=Image.BICUBIC)
im.paste(INK, (0, 0), a); im.paste(INK, (0, 0), b)
if TILT or SCALE != 1.0:
    # tilt / scale the whole mark about the centre, keeping the field mint
    a = math.radians(TILT); c, sn = math.cos(a) / SCALE, math.sin(a) / SCALE
    im = im.transform((W, W), Image.AFFINE, (c, -sn, W / 2 - c * W / 2 + sn * W / 2, sn, c, W / 2 - sn * W / 2 - c * W / 2), resample=Image.BICUBIC, fillcolor=MINT)
im.resize((S, S), Image.LANCZOS).save(out)
print('wrote', out)
