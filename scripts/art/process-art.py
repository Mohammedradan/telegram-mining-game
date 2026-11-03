#!/usr/bin/env python3
"""Post-processing for the "cave" art (public/assets/cave).

The pictures are generated as plain images; this script turns them into web assets:

  key   <raw.png> <out.webp> [--height N | --width N]   cut a character/object out of a flat bright-green screen
                                                       (soft alpha + green de-spill), trim, resize, WebP with alpha
  icon  <raw.png> <out.webp> [--crop 0.86]               centre-crop a square medal icon, resize to 192x192, WebP
  scene <raw.png|jpg> <out.jpg> [--quality 78]           re-encode a background picture as a progressive JPEG
  portrait <hero.webp> <out.webp>                        head-and-shoulders medal of the keyed hero on a navy plate (workshop medal)

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


def key_green(src, dst, height=None, width=None, pad=6, t0=40.0, t1=150.0, shrink=0.6, quality=84):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    h, w, _ = a.shape
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
    out = Image.fromarray(np.dstack([fg, alpha[..., 0] * 255]).astype(np.uint8), 'RGBA')
    x0, y0, x1, y1 = out.getchannel('A').point(lambda v: 255 if v > 14 else 0).getbbox()
    out = out.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))
    if height:
        out = out.resize((round(out.width * height / out.height), height), Image.LANCZOS)
    elif width:
        out = out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)
    out.save(dst, 'WEBP', quality=quality, method=6, alpha_quality=92)
    return out.size


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


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    k = sub.add_parser('key'); k.add_argument('src'); k.add_argument('dst'); k.add_argument('--height', type=int); k.add_argument('--width', type=int)
    i = sub.add_parser('icon'); i.add_argument('src'); i.add_argument('dst'); i.add_argument('--crop', type=float, default=0.86)
    s = sub.add_parser('scene'); s.add_argument('src'); s.add_argument('dst'); s.add_argument('--quality', type=int, default=78)
    pt = sub.add_parser('portrait'); pt.add_argument('src'); pt.add_argument('dst')
    a = p.parse_args()
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
