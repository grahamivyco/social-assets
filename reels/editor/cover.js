// Before a run: read /mnt/project-files/brands/design-notes.md (Part 1 + Open Frame section).
// Branded Reel covers. Usage: node cover.js spec.json
// spec: {photo, headline, variant: "blue"|"yellow"|"red"|"all", out_dir}
// photo: a clean frame of the speaker (thedit.py render grabs one from the cut, before captions).
// Layout (Graham, 2026-10-20): the photo fills the cover, color is only a thin frame around it,
// one small Bauhaus shape, headline on the photo above the head (soft dark fade behind it). *word* becomes the accent (bold, frame color).
// Writes <out_dir>/cover-<variant>-reel.jpg (1080x1920, text inside the IG grid crop)
// and <out_dir>/cover-<variant>-square.jpg (2160x2160 for FB).
const {chromium} = require(process.env.PW_CORE || require.resolve('playwright', {paths: ['/opt/node-tools/node_modules', __dirname]}));
const fs = require('fs'), path = require('path');

const ROOT = process.env.THEDIT_ROOT || '/mnt/project-files';
const FONTS = process.env.COVER_FONTS || `${ROOT}/open-frame/cinematic-reel/fonts`;
const LOGOS = process.env.COVER_LOGOS || `${ROOT}/brands/open-frame/logos`;
const b64 = p => fs.readFileSync(p).toString('base64');
const font = w => `@font-face{font-family:F;font-weight:${w};src:url(data:font/woff2;base64,${b64(`${FONTS}/fraunces-latin-${w}-normal.woff2`)})}`;
const img = p => `data:image/${path.extname(p).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml')};base64,${b64(p)}`;

// One accent per cover: frame color, plus the small shape's radius.
const V = {
  blue:   {frame: '#2F6BF0', shape: 'border-radius:50%'},
  yellow: {frame: '#F4BF3A', shape: 'border-radius:100% 0 0 0'},
  red:    {frame: '#F24333', shape: 'border-radius:999px 999px 0 0'},
};
const CREAM = '#F3F1EA';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const head = s => esc(s).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function html(spec, sq) {
  const v = V[spec.variant] || V.blue;
  // IG grid crop is the center 1080x1350 (y 285 to 1635), so the headline and mark sit inside it.
  const L = sq
    ? {W: 1080, H: 1080, pad: 22, txt: 'left:76px;right:76px;top:70px', fs: 92, mark: 'left:76px;bottom:70px', dot: 'right:76px;bottom:74px', pos: 'center 62%', fade: 38}
    : {W: 1080, H: 1920, pad: 30, txt: 'left:90px;right:90px;top:330px', fs: 112, mark: 'left:90px;bottom:330px', dot: 'right:90px;bottom:334px', pos: 'center 40%', fade: 34};
  return `<!doctype html><html><head><style>${font(400)}${font(700)}
  *{margin:0;box-sizing:border-box} body{width:${L.W}px;height:${L.H}px;background:${v.frame};position:relative;overflow:hidden;font-family:F}
  .ph{position:absolute;inset:${L.pad}px;background:url(${img(spec.photo)}) ${L.pos}/cover no-repeat}
  .ph:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(17,17,16,.7) 0%,rgba(17,17,16,.45) ${L.fade * .6}%,rgba(17,17,16,0) ${L.fade}%)}
  .txt{position:absolute;${L.txt};color:${CREAM};font-size:${L.fs}px;line-height:1.02;letter-spacing:-2px}
  .txt b{font-weight:700;color:${v.frame}}
  .mark{position:absolute;${L.mark};height:60px}
  .dot{position:absolute;${L.dot};width:52px;height:52px;background:${v.frame};${v.shape}}
  </style></head><body><div class="ph"></div><div class="txt">${head(spec.headline)}</div>
  <img class="mark" src="${img(`${LOGOS}/open-frame-mark-cream.svg`)}"><div class="dot"></div></body></html>`;
}

(async () => {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  fs.mkdirSync(spec.out_dir, {recursive: true});
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)});
  const variants = spec.variant === 'all' ? Object.keys(V) : [spec.variant in V ? spec.variant : 'blue'];
  for (const variant of variants) {
    for (const sq of [false, true]) {
      const page = await browser.newPage({viewport: {width: 1080, height: sq ? 1080 : 1920}, deviceScaleFactor: sq ? 2 : 1});
      await page.setContent(html({...spec, variant}, sq));
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(spec.out_dir, `cover-${variant}-${sq ? 'square' : 'reel'}.jpg`);
      await page.screenshot({path: out, type: 'jpeg', quality: 92});
      console.log(out);
      await page.close();
    }
  }
  await browser.close();
})();
