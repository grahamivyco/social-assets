// Open Frame numbered list cards for talking head Reels (style from a "Top 8" inspo Reel).
// node list.js spec.json outDir  -> title.png + card-01.png... (1080x1920, transparent)
// Copy of /mnt/project-files/open-frame/list-cards/render.js for thedit.py "list" (2026-10-21). Shots resolve from the spec's folder.
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2]));
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] || path.join(dir, 'out');
fs.mkdirSync(out, { recursive: true });
const F = path.join(__dirname, 'fonts');
const ACC = ['#F24333', '#2F6BF0', '#F4BF3A', '#33AC66'];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const accent = s => esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>');
const pad = n => String(n).padStart(2, '0');

const font = f => `url(data:font/${f.endsWith('otf') ? 'otf' : 'ttf'};base64,${fs.readFileSync(path.join(F, f)).toString('base64')})`;
const css = `
@font-face{font-family:Fr;font-weight:600;src:${font('Fraunces_600SemiBold.ttf')}}
@font-face{font-family:Fr;font-weight:600;font-style:italic;src:${font('Fraunces_600SemiBold_Italic.ttf')}}
@font-face{font-family:In;font-weight:600;src:${font('Inter-SemiBold.otf')}}
*{box-sizing:border-box;margin:0}
html,body{width:1080px;height:1920px;background:transparent;overflow:hidden}
.title{position:absolute;top:250px;left:90px;right:90px;text-align:center}
.title span{display:inline;background:#F3F1EA;color:#111110;font:600 64px/1.32 Fr;padding:6px 22px;
  border-radius:18px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.title em{font-style:italic;color:#F24333}
.card{position:absolute;left:90px;top:640px;width:900px;background:#111110;border-radius:40px;padding:44px 44px 36px;overflow:hidden}
.q{position:absolute;right:-90px;top:-90px;width:220px;height:220px;border-radius:50%}
.head{display:flex;align-items:center;gap:22px}
.num{width:96px;height:96px;border-radius:22px;display:grid;place-items:center;font:600 50px Fr;color:#111110}
.lab{font:600 26px In;letter-spacing:.14em;text-transform:uppercase;color:#F3F1EA}
.of{font:600 22px In;letter-spacing:.14em;color:#84827B;margin-top:6px}
.dom{font:600 74px/1.05 Fr;color:#F3F1EA;margin-top:34px;letter-spacing:-.01em}
.dom em{font-style:italic}
.desc{font:600 32px/1.35 In;color:#C9C6BC;margin-top:16px}
.br{margin-top:30px;border-radius:22px;overflow:hidden;background:#24231F}
.bar{height:52px;display:flex;align-items:center;gap:10px;padding:0 20px}
.dot{width:13px;height:13px;border-radius:50%;background:#4B4A46}
.url{margin-left:14px;background:#111110;color:#C9C6BC;font:600 20px In;padding:7px 18px;border-radius:99px}
.shot{width:100%;height:470px;object-fit:cover;object-position:top;display:block}
.prog{display:flex;gap:8px;margin-top:28px}
.prog i{flex:1;height:8px;border-radius:4px;background:#2E2D29}`;

const page = body => `<html><head><style>${css}</style></head><body>${body}</body></html>`;
const card = (it, i, n) => {
  const c = ACC[i % 4];
  const [name, ...rest] = it.domain.split('.');
  const shot = 'data:image/jpeg;base64,' + fs.readFileSync(path.resolve(dir, it.shot)).toString('base64');
  const prog = Array.from({ length: n }, (_, k) => `<i style="${k <= i ? `background:${c}` : ''}"></i>`).join('');
  return `<div class="card"><div class="q" style="background:${c}"></div>
    <div class="head"><div class="num" style="background:${c}">${pad(i + 1)}</div>
      <div><div class="lab">${esc(it.label)}</div><div class="of">${pad(i + 1)} OF ${pad(n)}</div></div></div>
    <div class="dom">${esc(name)}<em style="color:${c}">.${esc(rest.join('.'))}</em></div>
    <div class="desc">${esc(it.desc)}</div>
    <div class="br"><div class="bar"><b class="dot"></b><b class="dot"></b><b class="dot"></b><span class="url">${esc(it.domain)}</span></div>
      <img class="shot" src="${shot}"></div>
    <div class="prog">${prog}</div></div>`;
};

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const shoot = async (html, name) => {
    await p.setContent(page(html), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
  };
  await shoot(`<div class="title"><span>${accent(spec.title)}</span></div>`, 'title.png');
  for (let i = 0; i < spec.items.length; i++) await shoot(card(spec.items[i], i, spec.items.length), `card-${pad(i + 1)}.png`);
  await b.close();
  console.log('wrote', out);
})();
