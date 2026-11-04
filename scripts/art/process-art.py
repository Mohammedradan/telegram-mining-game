#!/usr/bin/env python3
"""Post-processing for the "cave" art (public/assets/cave).

The pictures are generated as plain images; this script turns them into web assets:

  key   <raw.png> <out.webp> [--height N | --width N]   cut a character/object out of a flat bright-green screen
                                                       (soft alpha + green de-spill), trim, resize, WebP with alpha
  icon  <raw.png> <out.webp> [--crop 0.86]               centre-crop a square medal icon, resize to 192x192, WebP
  scene <raw.png|jpg> <out.jpg> [--quality 78]           re-encode a background picture as a progressive JPEG
  portrait <hero.webp> <out.webp>                        head-and-shoulders medal of the keyed hero on a navy plate (workshop medal)
  sheet <out.webp> --cols N --cell-height H <frame>...   cut several green-screen frames out and pack them into ONE aligned sprite
                                                         sheet (same feet anchor, same union crop, same scale for every frame)
  atlas <out.webp> [--size 384] [--quality 62] "name=src[,off=0..1][,sat=S][,tint=R:G:B][,gain=G][,calm=cyan|orange:K]"...
                                                         square rock textures packed side by side (the Deep Dig layers). sat/tint/gain
                                                         recolour one picture into several layers; calm=cyan|orange:K softens small bright
                                                         specks of that hue (K 0..1) so a texture cannot be mistaken for ore.

Needs Pillow + numpy (dev-time only; nothing here ships to the browser):
  python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow numpy
  /tmp/venv/bin/python scripts/art/process-art.py key hero-raw.png public/assets/cave/hero.webp --height 560

After replacing a picture, bump the ?v=<n> on every /assets/cave reference (a test checks they all agree):
the server caches /assets/cave for a week as immutable.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def matte(src, t0=40.0, t1=150.0, shrink=0.6):
    """Full-canvas RGBA cut-out of a subject on a flat bright-green screen (soft alpha + de-spill)."""
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    border = np.concatenate([a[0, :, :], a[-1, :, :], a[:, 0, :], a[:, -1, :]], axis=0)
    key = np.median(border, axis=0)                      # the screen colour, measured from the picture's border
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = g - np.maximum(r, b)                          # how much greener than red/blue: ~255 on the screen, <= 0 on the subject
    top = min(t1, (key[1] - max(key[0], key[2])) - 8)
    alpha = 1.0 - np.clip((green - t0) / max(1.0, top - t0), 0, 1)
    al = Image.fromarray((alpha * 255).astype(np.uint8), 'L')
    if shrink > 0:                                        # contract the matte a hair to kill the halo
        al = al.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(shrink))
    alpha = np.clip(np.asarray(al).astype(np.float32) / 255.0, 0, 1)[..., None]
    k = key.reshape(1, 1, 3)
    fg = np.where(alpha > 0.02, (a - (1 - alpha) * k) / np.maximum(alpha, 0.02), a)   # un-mix the screen from edge pixels
    fg = np.clip(fg, 0, 255)
    spill = np.clip(fg[..., 1] - np.maximum(fg[..., 0], fg[..., 2]) - 6, 0, None)     # remaining green tint
    fg[..., 1] = np.clip(fg[..., 1] - spill * 0.85, 0, 255)
    return Image.fromarray(np.dstack([fg, alpha[..., 0] * 255]).astype(np.uint8), 'RGBA')


def alpha_bbox(im):
    return im.getchannel('A').point(lambda v: 255 if v > 14 else 0).getbbox()


def key_green(src, dst, height=None, width=None, pad=6, quality=84):
    out = matte(src)
    w, h = out.size
    x0, y0, x1, y1 = alpha_bbox(out)
    out = out.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))
    if height:
        out = out.resize((round(out.width * height / out.height), height), Image.LANCZOS)
    elif width:
        out = out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)
    out.save(dst, 'WEBP', quality=quality, method=6, alpha_quality=92)
    return out.size


def feet_anchor(im):
    """(x centre of the boots, bottom y) of a cut-out: the lowest 10% of the subject."""
    x0, y0, x1, y1 = alpha_bbox(im)
    band = np.asarray(im.getchannel('A'))[int(y1 - 0.10 * (y1 - y0)):y1, :]
    cols = np.where(band.max(axis=0) > 14)[0]
    return (float(cols.min() + cols.max()) / 2.0 if len(cols) else (x0 + x1) / 2.0), float(y1)


def sprite_sheet(frames, dst, cols, cell_height, pad=8, quality=76, align='feet'):
    """Cut several frames out of their green screens and pack them into one aligned sprite sheet.

    All frames are shifted so their feet (or, with align='centre', their middle) coincide with the first frame's,
    cropped to the SAME union box and scaled by the SAME factor, so swapping frames never makes the subject jump or resize."""
    mats = [matte(f) for f in frames]
    anchors = [feet_anchor(m) if align == 'feet' else ((alpha_bbox(m)[0] + alpha_bbox(m)[2]) / 2.0, (alpha_bbox(m)[1] + alpha_bbox(m)[3]) / 2.0) for m in mats]
    ax, ay = anchors[0]
    boxes = []
    for m, (fx, fy) in zip(mats, anchors):
        x0, y0, x1, y1 = alpha_bbox(m)
        boxes.append((x0 + (ax - fx), y0 + (ay - fy), x1 + (ax - fx), y1 + (ay - fy)))     # each frame's box once shifted onto the first
    ux0 = int(min(b[0] for b in boxes)) - pad; uy0 = int(min(b[1] for b in boxes)) - pad
    ux1 = int(max(b[2] for b in boxes)) + pad; uy1 = int(max(b[3] for b in boxes)) + pad
    uw, uh = ux1 - ux0, uy1 - uy0
    scale = cell_height / uh
    cw, ch = round(uw * scale), cell_height
    rows = -(-len(mats) // cols)
    sheet = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    for i, (m, (fx, fy)) in enumerate(zip(mats, anchors)):
        canvas = Image.new('RGBA', (uw, uh), (0, 0, 0, 0))
        canvas.alpha_composite(m, (int(round(ux0 * -1 + (ax - fx))), int(round(uy0 * -1 + (ay - fy)))))
        cell = canvas.resize((cw, ch), Image.LANCZOS)
        sheet.alpha_composite(cell, ((i % cols) * cw, (i // cols) * ch))
    sheet.save(dst, 'WEBP', quality=quality, method=6, alpha_quality=92)
    return {'cell': (cw, ch), 'cols': cols, 'rows': rows, 'size': sheet.size, 'feetY': round((ay - uy0) * scale), 'feetX': round((ax - ux0) * scale)}


def medal_icon(src, dst, crop=0.86, size=192, quality=80):
    im = Image.open(src).convert('RGB')
    s = int(min(im.size) * crop)
    x0, y0 = (im.width - s) // 2, (im.height - s) // 2
    im.crop((x0, y0, x0 + s, y0 + s)).resize((size, size), Image.LANCZOS).save(dst, 'WEBP', quality=quality, method=6)
    return (size, size)


def scene(src, dst, quality=78):
    im = Image.open(src).convert('RGB')
    im.save(dst, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')
    return im.size


def portrait(src, dst, size=192, quality=82):
    hero = Image.open(src).convert('RGBA')
    w, h = hero.size
    face = hero.crop((int(w * 0.10), 0, int(w * 0.90), int(h * 0.56)))
    side = max(face.size)
    yy, xx = np.mgrid[0:side, 0:side]
    d = np.clip(np.sqrt((xx - side * 0.5) ** 2 + (yy - side * 0.42) ** 2) / (side * 0.75), 0, 1)
    c0, c1 = np.array([46, 66, 140]), np.array([9, 14, 40])               # the same navy plate the other medals sit on
    plate = (c0[None, None, :] * (1 - d[..., None]) + c1[None, None, :] * d[..., None]).astype(np.uint8)
    bg = Image.fromarray(np.dstack([plate, np.full((side, side), 255, np.uint8)]), 'RGBA')
    bg.alpha_composite(face, ((side - face.width) // 2, int(side * 0.10)))
    bg.convert('RGB').resize((size, size), Image.LANCZOS).save(dst, 'WEBP', quality=quality, method=6)
    return (size, size)


def _parse_cell(spec):
    """'name=src,opt=val,...' -> (name, src, {opt: val})"""
    head, *rest = spec.split(',')
    name, src = head.split('=', 1)
    return name, src, dict(r.split('=', 1) for r in rest if '=' in r)


def _calm(im, kind, strength):
    """Replace small bright specks of one hue by a median-filtered copy (feathered mask), keeping the rock's own colour."""
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    if kind == 'cyan':
        hue = np.clip(((g + b) / 2.0 - r - 35.0) / 60.0, 0, 1)
        bright = np.clip((lum - 80.0) / 70.0, 0, 1)
    else:                                                  # orange embers
        hue = np.clip((r - b - 70.0) / 80.0, 0, 1)
        bright = np.clip((lum - 90.0) / 90.0, 0, 1)
    m = Image.fromarray((hue * bright * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(3))
    m = np.asarray(m).astype(np.float32)[..., None] / 255.0 * strength
    med = np.asarray(im.filter(ImageFilter.MedianFilter(17))).astype(np.float32)
    return Image.fromarray(np.clip(a * (1 - m) + med * m, 0, 255).astype(np.uint8), 'RGB')


def _recolour(im, sat=1.0, tint=(1.0, 1.0, 1.0), gain=1.0):
    a = np.asarray(im).astype(np.float32)
    gray = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]
    a = (gray + (a - gray) * sat) * np.array(tint, dtype=np.float32).reshape(1, 1, 3) * gain
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')


def rock_atlas(cells, dst, size=384, quality=62):
    """Pack square rock textures side by side (one cell per Deep Dig layer, in the order given)."""
    sheet = Image.new('RGB', (size * len(cells), size))
    names = []
    for i, spec in enumerate(cells):
        name, src, o = _parse_cell(spec)
        im = Image.open(src).convert('RGB')
        side = min(im.size)
        off = float(o.get('off', 0.5))                       # where the square window sits along the longer side
        x0, y0 = int((im.width - side) * off) if im.width > im.height else 0, int((im.height - side) * off) if im.height > im.width else 0
        im = im.crop((x0, y0, x0 + side, y0 + side)).resize((size, size), Image.LANCZOS)
        if 'calm' in o:
            kind, k = o['calm'].split(':')
            im = _calm(im, kind, float(k))
        if any(k in o for k in ('sat', 'tint', 'gain')):
            im = _recolour(im, float(o.get('sat', 1)), tuple(float(v) for v in o.get('tint', '1:1:1').split(':')), float(o.get('gain', 1)))
        sheet.paste(im, (i * size, 0))
        names.append(name)
    sheet.save(dst, 'WEBP', quality=quality, method=6)
    return sheet.size, names


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    k = sub.add_parser('key'); k.add_argument('src'); k.add_argument('dst'); k.add_argument('--height', type=int); k.add_argument('--width', type=int)
    i = sub.add_parser('icon'); i.add_argument('src'); i.add_argument('dst'); i.add_argument('--crop', type=float, default=0.86)
    s = sub.add_parser('scene'); s.add_argument('src'); s.add_argument('dst'); s.add_argument('--quality', type=int, default=78)
    pt = sub.add_parser('portrait'); pt.add_argument('src'); pt.add_argument('dst')
    sh = sub.add_parser('sheet'); sh.add_argument('dst'); sh.add_argument('frames', nargs='+'); sh.add_argument('--cols', type=int, required=True)
    sh.add_argument('--cell-height', type=int, required=True); sh.add_argument('--align', choices=['feet', 'centre'], default='feet')
    at = sub.add_parser('atlas'); at.add_argument('dst'); at.add_argument('cells', nargs='+')
    at.add_argument('--size', type=int, default=384); at.add_argument('--quality', type=int, default=62)
    a = p.parse_args()
    if a.cmd == 'atlas':
        size, names = rock_atlas(a.cells, a.dst, a.size, a.quality)
        print(f"{a.dst}: {size[0]}x{size[1]} ({len(names)} cells of {a.size}px: {', '.join(names)}), {os.path.getsize(a.dst)} bytes")
        return 0
    if a.cmd == 'sheet':
        meta = sprite_sheet(a.frames, a.dst, a.cols, a.cell_height, align=a.align)
        print(f"{a.dst}: {meta['size'][0]}x{meta['size'][1]} ({meta['cols']}x{meta['rows']} cells of {meta['cell'][0]}x{meta['cell'][1]}, feet at {meta['feetX']},{meta['feetY']}), {os.path.getsize(a.dst)} bytes")
        return 0
    if a.cmd == 'portrait':
        size = portrait(a.src, a.dst)
    elif a.cmd == 'key':
        size = key_green(a.src, a.dst, a.height, a.width)
    elif a.cmd == 'icon':
        size = medal_icon(a.src, a.dst, a.crop)
    else:
        size = scene(a.src, a.dst, a.quality)
    print(f'{a.dst}: {size[0]}x{size[1]}, {os.path.getsize(a.dst)} bytes')


if __name__ == '__main__':
    sys.exit(main())
