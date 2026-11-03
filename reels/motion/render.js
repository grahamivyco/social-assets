/* Motion scene renderer. Free tools only: Chromium (Playwright) + ffmpeg.
   node render.js <scene.html> <out.mp4>              -> H.264 mp4, 1080x1920, 30 fps
   node render.js <scene.html> <out.png> --still 4.2  -> one frame at 4.2 s
   node render.js <scene.html> <out.jpg> --sheet 2    -> contact sheet, one frame every 0.5 s
   Options: --fps 30  --params '{"answer":"Handled"}'  --size 1080x1920
   A scene is an HTML page that defines window.SCENE = { dur, seek(t) } and may read window.PARAMS. */
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require(process.env.PW_CORE || 'playwright-core')); } catch { ({ chromium } = require('playwright')); }

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const [scene, out] = args;
if (!scene || !out) { console.error('usage: node render.js scene.html out.mp4 [--still t] [--sheet step] [--fps 30] [--params json]'); process.exit(1); }
const fps = +opt('fps', 30);
const [W, H] = opt('size', '1080x1920').split('x').map(Number);
const params = JSON.parse(opt('params', '{}'));

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.error('scene error:', e.message));
  await page.addInitScript(p => { window.PARAMS = p; }, params);
  await page.goto('file://' + path.resolve(scene));
  await page.waitForFunction(() => window.SCENE && window.SCENE.ready !== false);
  await page.evaluate(() => document.fonts.ready);
  const dur = await page.evaluate(() => window.SCENE.dur);
  const at = async t => { await page.evaluate(t => window.SCENE.seek(t), t); return page.screenshot({ type: 'png' }); };

  if (args.includes('--still')) fs.writeFileSync(out, await at(+opt('still', 1)));
  else if (args.includes('--sheet')) {
    const step = +opt('sheet', 0.5), tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sheet-'));
    let n = 0;
    for (let t = 0; t < dur; t += step) fs.writeFileSync(path.join(tmp, String(n++).padStart(4, '0') + '.png'), await at(t));
    const cols = 8, rows = Math.ceil(n / cols);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%04d.png'),
      '-vf', `scale=200:-1,drawtext=text='%{expr\\:n*${step}}s':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}`,
      '-frames:v', '1', out]);
    fs.rmSync(tmp, { recursive: true });
  } else {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(dur * fps);
    for (let k = 0; k < n; k++) { const buf = await at(k / fps); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
    ff.stdin.end();
    await new Promise((ok, no) => ff.on('close', c => (c ? no(new Error('ffmpeg ' + c)) : ok())));
  }
  await browser.close();
  console.log(JSON.stringify({ out, dur, fps }));
})().catch(e => { console.error(e); process.exit(1); });
