# Build MapLibre SDF glyph PBFs: python scripts/build_glyphs.py <font.ttf> "<Font Name>" assets/glyphs/"<Font Name>"
# Requires freetype-py, numpy, scipy. Baseline offset matches the earlier fontnik-style output (top = yMax - 27).
import sys, os, numpy as np, freetype
from scipy.ndimage import distance_transform_edt as edt
SIZE, BUF, RADIUS, CUTOFF = 24, 3, 8, 0.25

def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)
def zz(n): return (n << 1) ^ (n >> 63)
def fv(f, v): return varint(f << 3) + varint(v)
def fb(f, b): return varint((f << 3) | 2) + varint(len(b)) + b


SS = 8
def glyph(face, cp):
    gi = face.get_char_index(cp)
    if not gi: return None
    face.load_glyph(gi, freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_NO_BITMAP)
    adv = int(round(face.glyph.advance.x / 64 / SS))
    msg = fv(1, cp)
    hface.load_glyph(gi, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
    g = hface.glyph; b = g.bitmap
    if not (b.width and b.rows):
        return msg + fv(3, 0) + fv(4, 0) + fv(5, 0) + fv(6, zz(-BASE)) + fv(7, adv)
    hi = np.array(b.buffer, dtype=np.float32).reshape(b.rows, b.pitch)[:, :b.width] / 255
    x0 = int(np.floor(g.bitmap_left / SS)); y1 = int(np.ceil(g.bitmap_top / SS))
    x1 = int(np.ceil((g.bitmap_left + b.width) / SS)); y0 = int(np.floor((g.bitmap_top - b.rows) / SS))
    w, h = x1 - x0, y1 - y0
    P = (BUF + RADIUS) * SS
    canvas = np.zeros(((h) * SS + 2 * P, (w) * SS + 2 * P), np.float32)
    ox = g.bitmap_left - x0 * SS + P; oy = y1 * SS - g.bitmap_top + P
    canvas[oy:oy + b.rows, ox:ox + b.width] = hi
    inside = canvas > 0.5
    d = (edt(~inside) - edt(inside)) / SS
    # sample at centres of the low-res pixels covering glyph box plus BUF
    off = RADIUS * SS
    ys = off + np.arange(h + 2 * BUF) * SS + SS // 2
    xs = off + np.arange(w + 2 * BUF) * SS + SS // 2
    dd = d[np.ix_(ys, xs)]
    v = np.clip(np.round(255 - 255 * (dd / RADIUS + CUTOFF)), 0, 255).astype(np.uint8)
    return msg + fb(2, v.tobytes()) + fv(3, w) + fv(4, h) + fv(5, zz(x0)) + fv(6, zz(y1 - BASE)) + fv(7, adv)

ttf, name, outdir = sys.argv[1:4]
BASE = 27
face = freetype.Face(ttf); face.set_char_size(SIZE * SS * 64)
hface = face
os.makedirs(outdir, exist_ok=True)
for start in range(0, 65536, 256):
    end = start + 255
    stack = fb(1, name.encode()) + fb(2, f"{start}-{end}".encode())
    for cp in range(start, end + 1):
        m = glyph(face, cp)
        if m: stack += fb(3, m)
    open(os.path.join(outdir, f"{start}-{end}.pbf"), "wb").write(fb(1, stack))
