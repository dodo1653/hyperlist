# Perceptual hashes (aHash, dHash, pHash) of images, pure Pillow (no numpy), and their bit distance to the first image.
# Duplicate-image checks use hashes like these: a distance under ~10 of 64 reads as "the same picture".
# python tools/phash.py ref.png other.png [...]
import sys, math
from PIL import Image

def gray(p, w, h): return list(Image.open(p).convert('L').resize((w, h), Image.LANCZOS).getdata())
def ahash(p):
    g = gray(p, 8, 8); m = sum(g) / 64; return [v > m for v in g]
def dhash(p):
    g = gray(p, 9, 8); return [g[r * 9 + c] > g[r * 9 + c + 1] for r in range(8) for c in range(8)]
N = 32
C = [[math.cos((2 * x + 1) * u * math.pi / (2 * N)) for x in range(N)] for u in range(N)]
def phash(p):
    g = gray(p, N, N); rows = [g[r * N:(r + 1) * N] for r in range(N)]
    t = [[sum(rows[r][x] * C[u][x] for x in range(N)) for u in range(8)] for r in range(N)]          # DCT along x
    f = [[sum(t[y][u] * C[v][y] for y in range(N)) for u in range(8)] for v in range(8)]              # then along y
    vals = [f[v][u] for v in range(8) for u in range(8)][1:]; m = sorted(vals)[len(vals) // 2]
    return [x > m for x in vals]
def dist(a, b): return sum(x != y for x, y in zip(a, b))

ref = sys.argv[1]; H = {k: f(ref) for k, f in (('a', ahash), ('d', dhash), ('p', phash))}
for p in sys.argv[2:]:
    print(p, ' '.join(f'{k}Hash {dist(H[k], f(p)):2d}' for k, f in (('a', ahash), ('d', dhash), ('p', phash))))
