#!/usr/bin/env python3
"""Put a client's brand art onto real product photos and frame each one 9:16 for the sketch-to-guide mockup run.

  python3 mockup-composite.py <art-dir> <out-dir> [--photos ../assets/mockups] [--config mockups.json]

<art-dir> holds one transparent PNG per piece (art-tee.png, art-sign.png ...), rendered from the client's brand
(see mockup-art.html). The config says, per photo, where the art goes and how it sits on the surface:
  print:  ink on fabric (multiply), placed by center/width/rotation in photo pixels
  surface: a flat face (sign, card, badge), placed by its 4 corners, the photo's own light and shadow kept
  screen: a phone screen, placed by 4 corners, only on the lit screen pixels so the notch and bezel stay
Then each result is framed 1080x1920 around `frame` = [center x, center y, visible width]. Where the photo
doesn't reach the top or bottom, a soft blurred copy of it fills the rest. Free tools only: Pillow + numpy.
"""
import json, sys, os, argparse
import numpy as np
from PIL import Image, ImageFilter

def coeffs(dst, src):
    # perspective coefficients mapping output (dst quad) back to input (src quad), as PIL wants
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]; B += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def warp(art, quad, size):
    w, h = art.size
    return art.transform(size, Image.PERSPECTIVE, coeffs(quad, [(0, 0), (w, 0), (w, h), (0, h)]), Image.BICUBIC)

def place(art, c, width, rot, size):
    a = art.resize((round(width), round(width * art.height / art.width)), Image.LANCZOS).rotate(-rot, Image.BICUBIC, expand=True)
    layer = Image.new('RGBA', size, (0, 0, 0, 0)); layer.alpha_composite(a, (round(c[0] - a.width / 2), round(c[1] - a.height / 2)))
    return layer

def lum(img): return np.asarray(img.convert('L'), float) / 255

def composite(photo, art, spec):
    size = photo.size; P = np.asarray(photo, float) / 255
    kind = spec['kind']
    layer = place(art, spec['center'], spec['width'], spec.get('rot', 0), size) if kind == 'print' else warp(art, spec['quad'], size)
    L = np.asarray(layer, float) / 255; rgb, a = L[..., :3], L[..., 3:] * spec.get('opacity', 1)
    if kind == 'print':
        a = np.asarray(Image.fromarray((a[..., 0] * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7)), float)[..., None] / 255
        out = P * rgb                                   # ink soaks into the fabric, folds show through
    else:
        Y = lum(photo); m = a[..., 0] > 0.5
        ref = np.percentile(Y[m], 85) if m.any() else 1
        shade = np.clip(Y / ref, 0, 1.25)[..., None]    # keep the photo's light: shadows darken, highlights lift
        out = np.clip(rgb * shade, 0, 1) if kind == 'surface' else rgb * 0.97
        if kind == 'screen':                            # only the lit screen pixels, so the notch and bezel stay
            near = np.abs(P - np.array(spec.get('screen_rgb', [0.89, 0.886, 0.91]))).max(-1) < spec.get('tol', 0.08)
            near = np.asarray(Image.fromarray((near * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)), float) / 255
            a = a * near[..., None]
        if 'keep_dark' in spec:                         # leave dark things on the surface alone (a punched hole)
            a = a * np.clip((Y - spec['keep_dark']) / 0.08, 0, 1)[..., None]
    res = P * (1 - a) + out * a
    return Image.fromarray((np.clip(res, 0, 1) * 255).astype('uint8'))

def frame(img, cx, cy, vw, W=1080, H=1920):
    s = W / vw
    fg = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x0 = min(0, max(W - fg.width, round(W / 2 - cx * s)))
    if fg.height >= H:
        y = min(0, max(H - fg.height, round(H / 2 - cy * s)))
        return fg.crop((-x0, -y, -x0 + W, -y + H))
    # the photo is shorter than the frame: centre it and carry its top and bottom edges out, softly, to fill
    fg = fg.crop((-x0, 0, -x0 + W, fg.height)); y0 = (H - fg.height) // 2
    F = np.asarray(fg, float); f = min(220, fg.height // 4)
    def tone(rows):                                       # the wall's colour a little inside the edge, as a soft left-to-right
        strip = F[rows]; e = W // 7                       # gradient, so nothing standing in the strip gets smeared out
        l, r = np.median(strip[:, :e].reshape(-1, 3), 0), np.median(strip[:, -e:].reshape(-1, 3), 0)
        k = np.linspace(0, 1, W)[:, None]; return l * (1 - k) + r * k
    out = np.zeros((H, W, 3)); out[:y0 + f] = tone(slice(f // 2, f)); out[y0 + f:] = tone(slice(fg.height - f, fg.height - f // 2))
    g = np.ones(fg.height); r = np.linspace(0, 1, f) ** 1.5; g[:f] = r; g[-f:] = r[::-1]
    out[y0:y0 + fg.height] = out[y0:y0 + fg.height] * (1 - g[:, None, None]) + F * g[:, None, None]
    out = Image.fromarray(np.clip(out, 0, 255).astype('uint8'))
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('art'); ap.add_argument('out')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--photos', default=os.path.join(here, '../assets/mockups'))
    ap.add_argument('--config', default=os.path.join(here, '../assets/mockups/mockups.json'))
    ap.add_argument('--full', action='store_true', help='also save the full-size composite')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    cfg = json.load(open(a.config))
    for name, spec in cfg['photos'].items():
        photo = Image.open(os.path.join(a.photos, spec['photo'])).convert('RGB')
        img = photo
        for piece in spec['pieces']:
            img = composite(img, Image.open(os.path.join(a.art, f"art-{piece['art']}.png")).convert('RGBA'), piece)
        if a.full: img.save(os.path.join(a.out, f'{name}-full.jpg'), quality=90)
        frame(img, *spec['frame']).save(os.path.join(a.out, f'{name}.jpg'), quality=88)
        print('wrote', name)
