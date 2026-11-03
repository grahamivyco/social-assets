#!/usr/bin/env python3
"""Render the brand art that goes onto the mockup photos (art-tee.png, art-sign.png ...), one transparent PNG each.

  python3 mockup-art.py <out-dir>

Today it is the Needlework Guild set: its mark (from scenes/sketch-to-guide.html), colors, Cormorant Garamond +
DM Sans, and copy from the guild's own site. For a new client, copy this file and change C, the fonts and the copy.
Then run mockup-composite.py to put the art on the photos. Needs network for Google Fonts, and Playwright.
"""
import re, os, sys, subprocess
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.abspath(sys.argv[1]); os.makedirs(out, exist_ok=True)
src = open(os.path.join(here, '../scenes/sketch-to-guide.html')).read()
th = re.search(r'<path id="thread" d="([^"]+)"', src).group(1); nd = re.search(r'<path id="needle" d="([^"]+)"', src).group(1)
C = dict(sage='#3E5538', mid='#5C7A52', rose='#B87260', prose='#F5EBE7', cream='#FAF7F2', linen='#F0EAE0', ink='#242424')
FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=DM+Sans:wght@500&display=block'
def mark(w, t, n): return f'<svg width="{w}" height="{w*39/37:.1f}" viewBox="-3 -3 37 39"><path d="{th}" fill="none" stroke="{t}" stroke-width="1.10903" stroke-linecap="round"/><path d="{nd}" fill="{n}"/></svg>'
H = lambda s, size, col, extra='': f'<div style="font:500 {size}px/1.05 \'Cormorant Garamond\';color:{col};{extra}">{s}</div>'
Sm = lambda s, size, col, ls, extra='': f'<div style="font:500 {size}px/1 \'DM Sans\';letter-spacing:{ls}px;color:{col};{extra}">{s}</div>'
I = lambda s, col: f'<i style="color:{col}">{s}</i>'
col = 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center'
rows = [('Come and stitch', 'ALL LEVELS WELCOME'), ('Monthly meeting', 'GUESTS WELCOME'), ('Retreat', 'STITCH TOGETHER')]
pieces = {
 'tee': f'<div id="tee" style="width:400px;height:520px;{col};gap:26px">{mark(300, C["rose"], C["sage"])}{Sm("NEEDLEWORK GUILD", 30, C["sage"], 6)}</div>',
 'sign': f'<div id="sign" style="width:1000px;height:1000px;background:{C["sage"]};{col};gap:34px">{mark(330, C["prose"], C["cream"])}{H("Needlework Guild", 112, C["cream"])}{Sm("OF MINNESOTA", 34, C["prose"], 10)}<div style="height:30px"></div>{Sm("COME AND STITCH WITH US", 28, C["cream"], 6, "opacity:.8")}</div>',
 'button': f'<div id="button" style="width:800px;height:800px;border-radius:50%;background:{C["rose"]};{col};gap:28px">{mark(330, C["cream"], C["cream"])}{Sm("STITCH WITH US", 40, C["cream"], 8)}</div>',
 'phone': f'''<div id="phone" style="width:564px;height:1234px;background:{C["cream"]};position:relative;overflow:hidden">
   <div style="position:absolute;left:44px;top:110px;display:flex;align-items:center;gap:14px">{mark(46, C["rose"], C["sage"])}{Sm("NEEDLEWORK GUILD", 15, C["sage"], 3)}</div>
   <div style="position:absolute;left:44px;top:210px">{H("Find " + I("your", C["rose"]) + "<br>group", 78, C["ink"])}</div>
   <div style="position:absolute;left:44px;top:400px">{Sm("ALL LEVELS WELCOME", 15, C["mid"], 3)}</div>
   {"".join(f'<div style="position:absolute;left:32px;right:32px;top:{470 + i * 150}px;height:126px;border-radius:22px;background:{[C["sage"], C["linen"], C["linen"]][i]};padding:28px;box-sizing:border-box">{H(n, 40, [C["cream"], C["ink"], C["ink"]][i])}<div style="height:14px"></div>{Sm(s, 14, [C["prose"], C["mid"], C["mid"]][i], 2)}</div>' for i, (n, s) in enumerate(rows))}
   <div style="position:absolute;left:32px;right:32px;top:1000px;height:96px;border-radius:48px;background:{C["rose"]};{col}">{Sm("JOIN THE GUILD", 20, C["cream"], 5)}</div>
 </div>''',
 'tote': f'<div id="tote" style="width:700px;height:640px;{col};gap:30px">{mark(300, C["rose"], C["sage"])}{H("Needlework Guild", 92, C["sage"])}{Sm("OF MINNESOTA", 28, C["rose"], 9)}</div>',
 'hoop': f'<div id="hoop" style="width:700px;height:700px;{col};gap:30px">{mark(360, C["rose"], C["sage"])}{H("Stitch " + I("with", C["rose"]) + " us", 84, C["sage"])}</div>',
 'badge': f'''<div id="badge" style="width:600px;height:1000px;background:{C["cream"]};position:relative">
   <div style="position:absolute;left:0;right:0;top:0;height:360px;background:{C["sage"]};{col};gap:24px;padding-top:70px;box-sizing:border-box">{mark(130, C["prose"], C["cream"])}{Sm("HELLO, I STITCH", 24, C["cream"], 5)}</div>
   <div style="position:absolute;left:0;right:0;top:470px;{col};gap:26px">{H("Your name", 104, C["ink"])}{Sm("MEMBER", 26, C["rose"], 10)}</div>
   <div style="position:absolute;left:0;right:0;bottom:70px;{col}">{Sm("NEEDLEWORK GUILD OF MINNESOTA", 17, C["sage"], 4)}</div>
 </div>''',
 'cardF': f'<div id="cardF" style="width:1050px;height:600px;background:{C["sage"]};{col};gap:24px">{mark(170, C["prose"], C["cream"])}{H("Needlework Guild", 86, C["cream"])}{Sm("OF MINNESOTA", 26, C["prose"], 9)}</div>',
 'cardB': f'''<div id="cardB" style="width:1050px;height:600px;background:{C["cream"]};position:relative">
   <div style="position:absolute;left:80px;top:90px">{mark(90, C["rose"], C["sage"])}</div>
   <div style="position:absolute;left:80px;top:270px">{H("Find " + I("your", C["rose"]) + " group", 74, C["ink"])}<div style="height:22px"></div>{Sm("COME AND STITCH WITH US", 22, C["mid"], 5)}<div style="height:44px"></div>{Sm("needleworkguildmn.org", 26, C["sage"], 1)}</div>
 </div>''',
}
html = f'<!doctype html><meta charset=utf-8><link rel="stylesheet" href="{FONTS}"><style>body{{margin:0;background:transparent}}body>div{{margin:20px}}</style>' + ''.join(pieces.values())
open(os.path.join(out, 'art.html'), 'w').write(html)
js = """const { chromium } = require('playwright');
(async () => { const [dir, ids] = [process.argv[1], process.argv[2].split(',')];
  const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 1200 } });
  await p.goto('file://' + dir + '/art.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  for (const id of ids) await p.locator('#' + id).screenshot({ path: dir + '/art-' + id + '.png', omitBackground: true });
  await b.close(); })();"""
subprocess.run(['node', '-e', js, out, ','.join(pieces)], check=True)
print('wrote', len(pieces), 'art pieces to', out)
