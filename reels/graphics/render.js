/* Renders one graphic from templates.js.
   node render.js spec.json out.png still   -> the finished frame (transparent PNG)
   node render.js spec.json out.mov anim    -> transparent QuickTime (qtrle), spec.dur seconds at spec.fps
   Prints {"warnings":[...]} so the loop can catch text that doesn't fit before Graham sees it.
   spec: { kind, params, look, accent, brand, W, H, fps, dur } (brand colors and fonts come from brands/<brand>/brand.json) */
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const HERE = __dirname;
const BRANDS = process.env.BRANDS || path.join(HERE, '..', '..', 'brands');
const FONT_DIRS = [path.join(HERE, '..', 'editor', 'fonts'), '/mnt/project-files/automation/talking-head/fonts'];
let chromium;
try { ({ chromium } = require(process.env.PW_CORE || 'playwright-core')); } catch { ({ chromium } = require('playwright')); }

function palette(brand) {
  const b = JSON.parse(fs.readFileSync(path.join(BRANDS, brand, 'brand.json'), 'utf8'));
  const col = {}; b.colors.forEach(c => { col[c.token] = c.hex; });
  const ink = col.ink || col[(b.roles || {}).text] || '#111110', light = col.cream || col.white || '#ffffff';
  let acc = ['red', 'blue', 'yellow', 'green'].filter(k => col[k]).map(k => col[k]);
  if (acc.length < 4) Object.entries(col).forEach(([k, v]) => { if (!acc.includes(v) && v !== ink && v !== light && !/hairline|muted|white/.test(k)) acc.push(v); });
  acc = (acc.length ? acc.concat(acc, acc, acc) : ['#F24333']).slice(0, 4);
  return { ink, cream: light, r: acc[0], b: acc[1], y: acc[2], g: acc[3], head: (b.fonts && b.fonts.head && b.fonts.head.family) || 'Fraunces' };
}

function fontFile(brand, family, re) {
  const want = family.replace(/\s/g, '').toLowerCase();
  for (const d of [path.join(BRANDS, brand, 'fonts'), ...FONT_DIRS]) {
    if (!fs.existsSync(d)) continue;
    const f = fs.readdirSync(d).find(n => n.replace(/[-_\s]/g, '').toLowerCase().includes(want) && re.test(n) && !/italic/i.test(n));
    if (f) return path.join(d, f);
  }
  throw new Error(`missing font ${family} (put it in brands/${brand}/fonts)`);
}

(async () => {
  const [specPath, out, mode = 'still'] = process.argv.slice(2);
  const spec = { W: 1080, H: 1920, fps: 30, dur: 3.5, look: 'cream', brand: 'open-frame', ...JSON.parse(fs.readFileSync(specPath, 'utf8')) };
  spec.pal = palette(spec.brand);
  const fonts = [
    { family: 'Fr', file: fontFile(spec.brand, spec.pal.head, /500|medium/i) },
    { family: 'In', file: fontFile(spec.brand, 'Inter', /600|semibold/i) },
  ].map(f => ({ family: f.family, data: fs.readFileSync(f.file).toString('base64') }));
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: spec.W, height: spec.H } });
  await page.setContent('<html><body style="margin:0;background:transparent"><div id="g"></div></body></html>');
  await page.addScriptTag({ path: path.join(HERE, 'templates.js') });
  const warnings = await page.evaluate(async ({ spec, fonts }) => {
    for (const f of fonts) {
      const bin = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      document.fonts.add(await new FontFace(f.family, bin).load());
    }
    window.G = makeGraphic(spec);
    return G.check();
  }, { spec, fonts });
  const shot = async t => { await page.evaluate(t => G.set(t), t); return page.screenshot({ omitBackground: true, type: 'png' }); };
  if (mode === 'still') fs.writeFileSync(out, await shot(spec.dur - 0.5));
  else {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(spec.fps), '-i', '-', '-c:v', 'qtrle', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(spec.dur * spec.fps);
    for (let k = 0; k < n; k++) { const buf = await shot(k / spec.fps); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
    ff.stdin.end();
    await new Promise((ok, no) => ff.on('close', c => (c ? no(new Error('ffmpeg ' + c)) : ok())));
  }
  await browser.close();
  console.log(JSON.stringify({ warnings }));
})().catch(e => { console.error(e.message || e); process.exit(1); });
