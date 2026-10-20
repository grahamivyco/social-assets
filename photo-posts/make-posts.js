// Real photos in, branded Needlework Guild posts out.
// Usage: node make-posts.js <inbox> <out> [--base URL] [--date YYYY-MM-DD]
//   <inbox>/<post-folder>/*.jpg  one folder = one post (1 photo: single, 2: pair, 3+: carousel)
//   <inbox>/*.jpg                loose photos each become a single post
// Optional per folder: post.json (topic, kicker, title, body, captions) and photos.csv
// (file,caption,credit,quote,people,consent,focus). consent=no skips a photo.
// Writes 1080x1350 JPGs, caption.md per post, queue.csv (draft rows for the Sheet) and review.md.
const {chromium} = require('playwright-core');
const fs = require('fs'), path = require('path'), {execFileSync} = require('child_process');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i > -1 ? args.splice(i, 2)[1] : null; };
const BASE = opt('base') || 'https://grahamivyco.github.io/social-assets/ngm/posts';
const DATE = opt('date') || new Date().toISOString().slice(0, 10);
const [INBOX, OUT] = args;
if (!INBOX || !OUT) { console.log('node make-posts.js <inbox> <out> [--base URL] [--date YYYY-MM-DD]'); process.exit(1); }

const HERE = __dirname, NM = path.join(HERE, 'node_modules/@fontsource');
const ff = (fam, pkg, w, s) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:${s};src:url(data:font/woff2;base64,${fs.readFileSync(`${NM}/${pkg}/files/${pkg}-latin-${w}-${s}.woff2`).toString('base64')}) format('woff2')}`;
const svg = f => fs.readFileSync(path.join(HERE, 'assets', f), 'utf8').replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"');
const CSS = `${ff('Cormorant Garamond','cormorant-garamond',400,'normal')}${ff('Cormorant Garamond','cormorant-garamond',400,'italic')}${ff('Cormorant Garamond','cormorant-garamond',500,'normal')}
${ff('DM Sans','dm-sans',400,'normal')}${ff('DM Sans','dm-sans',500,'normal')}${ff('DM Sans','dm-sans',600,'normal')}
:root{--sage:#3E5538;--mid:#5C7A52;--palesage:#EEF3EC;--rose:#B87260;--palerose:#F5EBE7;--cream:#FAF7F2;--linen:#F0EAE0;--line:#DDD5C8;--ink:#242424;--soft:#656565}
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:var(--cream)}
.c{position:relative;width:1080px;height:1350px;overflow:hidden}
.h{font-family:'Cormorant Garamond',serif;font-weight:400;letter-spacing:-.5px;margin:0}
.h em{font-style:italic;color:var(--rose)} .dark .h em{color:#E9B7A6}
.t{font-family:'DM Sans',sans-serif}
.k{font-family:'DM Sans',sans-serif;font-weight:600;letter-spacing:.18em;text-transform:uppercase;font-size:24px;color:var(--rose)}
.dark .k{color:#E9B7A6}
.num{position:absolute;right:64px;top:64px;font:500 24px 'DM Sans';color:var(--soft)}
.dark .num{color:rgba(250,247,242,.8)}`;

// Topic presets: folder names (or post.json "topic") that map to guild copy.
const JOIN = 'https://needleworkguildmn.org/join', CAL = 'https://needleworkguildmn.org/calendar';
const TOPICS = {
  'come-and-stitch': {kicker: 'Come & Stitch', title: 'Bring what you’re *working* on', body: '3rd Saturday, 10 am to 12 pm. Free and open to all.', end: 'Come sit with *us*', endBody: 'Free, hybrid, every 3rd Saturday. No membership needed.', link: CAL,
    captions: ['Saturday morning at Come & Stitch. A room full of projects, coffee and people happy to help with a tricky stitch.\n\nCome & Stitch is free and open to everyone on the 3rd Saturday, 10 am to 12 pm, in person or on Zoom.', 'What did you work on this weekend? Here’s what was on the tables at Come & Stitch.\n\nBring your own project next time. All skill levels welcome.', 'Free, friendly and full of good projects. Come & Stitch meets every 3rd Saturday from 10 am to noon.\n\nNew faces are always welcome.']},
  'tea-and-stitch': {kicker: 'Sunday Tea & Stitch', title: 'Tea, talk and a *few* stitches', body: 'A Sunday afternoon in Richfield. Free and open to all.', end: 'Pull up a *chair*', endBody: 'Sunday Tea & Stitch, 1 to 4 pm. Free.', link: CAL,
    captions: ['A slow Sunday afternoon of tea and stitching in Richfield.\n\nSunday Tea & Stitch is free and open to everyone, 1 to 4 pm.', 'Bring a project, we’ll bring the tea. Sunday Tea & Stitch runs 1 to 4 pm in Richfield.\n\nAll skill levels welcome.', 'Some of what we worked on at Sunday Tea & Stitch.\n\nIt’s free, it’s relaxed and you don’t need to be a member.']},
  'retreat': {kicker: 'The guild retreat', title: 'Four days of *stitching* together', body: 'Nationally known teachers. Members only.', end: 'Join in time for *Retreat*', endBody: 'Membership is $30 a year.', link: 'https://needleworkguildmn.org/annual-retreat-2027',
    captions: ['A look at the guild Retreat. Four days, expert teachers and a lot of happy stitching.\n\nRetreat 2027 is open to members. Membership is $30 a year.', 'Projects and people from the guild Retreat.\n\nWant to come to Retreat 2027? It starts with a $30 membership.', 'This is what four days of stitching with friends looks like.\n\nRetreat 2027 details and class projects are on our site.']},
  'member-work': {kicker: 'Made by members', title: 'What our members are *making*', body: 'Shared at our meetings and groups.', end: 'Find *your* people and your stitching', endBody: 'All skill levels welcome. $30 a year.', link: JOIN,
    captions: ['A few finishes our members shared this month. Every one of these started as a pile of thread.\n\nWant to stitch alongside them? Membership is $30 a year and every skill level is welcome.', 'Member work from around the guild. Swipe through and tell us which one you’d stitch first.\n\nJoin us for $30 a year.', 'Proud of these. Our members made every piece here.\n\nFind your people and your stitching.']},
  'workshop': {kicker: 'Workshops', title: 'Learn it from someone who *loves* it', body: 'Expert teachers, small groups.', end: 'Take a class with *us*', endBody: 'Workshops are included with membership.', link: 'https://needleworkguildmn.org/workshops',
    captions: ['Scenes from a recent guild workshop. Small groups, patient teachers and a new technique to take home.\n\nWorkshops are one of the perks of membership.', 'Learning something new together. Here’s what our latest workshop made.\n\nSee what’s coming up next.', 'Hands, hoops and a lot of concentration at our latest workshop.\n\nMembers get access to workshops with expert instructors.']},
  'library': {kicker: 'The guild library', title: '400 books, *all* yours to borrow', body: 'Free with membership.', end: 'Borrow a *book*', endBody: 'The library comes with membership. $30 a year.', link: JOIN,
    captions: ['A peek at the guild library. Over 400 books on every stitch you can think of.\n\nMembers borrow for free. Membership is $30 a year.', 'Looking for your next technique? It’s probably on our shelves.\n\nJoin the guild and borrow anything in the library.', 'Some favorites from the guild library.\n\nMembership opens up all 400+ books.']},
  default: {kicker: 'Needlework Guild of Minnesota', title: 'A place for people who *love* to stitch', body: '', end: 'Find *your* people and your stitching', endBody: 'All skill levels welcome. $30 a year.', link: JOIN,
    captions: ['A few moments from around the guild.\n\nWe’re a place for people who love to stitch, from first-timers to experts. Membership is $30 a year.', 'Real people, real projects. This is the Needlework Guild of Minnesota.\n\nAll skill levels welcome.', 'Find your people and your stitching.\n\nWe meet in Bloomington, Richfield and on Zoom.']},
};
const ALIAS = {'come-stitch': 'come-and-stitch', 'tea-stitch': 'tea-and-stitch', 'sunday-tea-and-stitch': 'tea-and-stitch', 'retreat-2027': 'retreat', 'members': 'member-work', 'member-finishes': 'member-work', 'workshops': 'workshop', 'lending-library': 'library'};

const IMG = /\.(jpe?g|png|webp|heic)$/i;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const accent = s => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const slug = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function csv(file) { // small CSV reader, quotes supported
  if (!fs.existsSync(file)) return [];
  const rows = [], text = fs.readFileSync(file, 'utf8'); let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows.filter(r => r.some(c => c.trim()));
  return rest.map(r => Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), (r[i] || '').trim()])));
}
const cq = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

function dataUrl(file) {
  if (/\.heic$/i.test(file)) { // iPhone photos: macOS converts with sips
    const jpg = path.join(OUT, '.cache', path.basename(file) + '.jpg');
    fs.mkdirSync(path.dirname(jpg), {recursive: true});
    if (!fs.existsSync(jpg)) execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', jpg]);
    file = jpg;
  }
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
}
const pic = (p, style) => `<img src="${dataUrl(p.path)}" style="object-fit:cover;object-position:${p.focus || 'center'};${style}">`;


// Faded stitch patterns behind the content. Each slide in a post gets a different one.
const STITCH = {
  cross: c => `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><g stroke='${c}' stroke-width='2.2' stroke-linecap='round'><path d='M8 8l12 12M20 8L8 20'/></g></svg>`,
  blackwork: c => `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><g fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round'><path d='M32 8l24 24-24 24L8 32z'/><path d='M32 20v24M20 32h24'/><path d='M0 0l8 8M64 0l-8 8M0 64l8-8M64 64l-8-8'/></g></svg>`,
  running: c => `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='56'><path d='M0 28c20-18 60-18 80 0s60 18 80 0' fill='none' stroke='${c}' stroke-width='2.4' stroke-linecap='round' stroke-dasharray='11 9'/></svg>`,
  herringbone: c => `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='40'><g stroke='${c}' stroke-width='2' stroke-linecap='round'><path d='M2 6l16 14M18 6L2 20M20 26l14-14M34 26L20 12'/></g></svg>`,
  seed: c => `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><g stroke='${c}' stroke-width='2.6' stroke-linecap='round'><path d='M12 14l7 4M48 10l-3 8M76 24l8 2M28 44l2 8M62 50l7-5M16 74l8-1M50 78l-4 7M82 70l2 8'/></g></svg>`,
  lazydaisy: c => `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='none' stroke='${c}' stroke-width='2.2'><g transform='translate(30 30)'><ellipse cx='0' cy='-11' rx='4.5' ry='9'/><ellipse cx='0' cy='11' rx='4.5' ry='9'/><ellipse cx='-11' cy='0' rx='9' ry='4.5'/><ellipse cx='11' cy='0' rx='9' ry='4.5'/></g><g transform='translate(90 90) rotate(45)'><ellipse cx='0' cy='-11' rx='4.5' ry='9'/><ellipse cx='0' cy='11' rx='4.5' ry='9'/><ellipse cx='-11' cy='0' rx='9' ry='4.5'/><ellipse cx='11' cy='0' rx='9' ry='4.5'/></g></g></svg>`,
};
const PAT_NAMES = Object.keys(STITCH);
const hash = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
// fade: where the pattern shows, as a CSS mask (default: strongest at the edges, gone in the middle)
function stitchBg(P, s, color, opacity, fade = 'radial-gradient(ellipse at center,transparent 25%,#000 85%)', box = 'inset:0') {
  const name = P.pattern || PAT_NAMES[(hash(P.id) + (s.idx || 0)) % PAT_NAMES.length];
  const url = 'data:image/svg+xml,' + encodeURIComponent(STITCH[name](color));
  return `<div style="position:absolute;${box};background-image:url(&quot;${url}&quot;);opacity:${opacity};-webkit-mask-image:${fade};mask-image:${fade}"></div>`;
}

// ---------- layouts ----------
const L = {
  cover: (P, s) => `<div class="c dark">${pic(P.photos[0], 'position:absolute;inset:0;width:100%;height:100%')}
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(28,38,26,.55) 0%,rgba(28,38,26,0) 22%,rgba(28,38,26,0) 42%,rgba(28,38,26,.92) 78%)"></div>
    ${stitchBg(P, s, '#FAF7F2', .16, 'linear-gradient(180deg,transparent 55%,#000 100%)')}
    <div style="position:absolute;inset:26px;border:3px dashed rgba(250,247,242,.55);border-radius:6px"></div>
    <div style="position:absolute;left:64px;top:56px;width:420px;height:72px">${svg('logo-full-on-dark.svg')}</div>
    <div style="position:absolute;left:72px;right:72px;bottom:96px;display:flex;flex-direction:column;gap:22px">
      <div class="k">${esc(P.kicker)}</div>
      <h1 class="h" style="font-size:104px;line-height:1;color:var(--cream)">${accent(P.title)}</h1>
      ${P.body ? `<div class="t" style="font-size:30px;line-height:1.4;color:rgba(250,247,242,.88)">${esc(P.body)}</div>` : ''}
    </div>
    <div class="t" style="position:absolute;right:72px;bottom:48px;font-size:22px;font-weight:600;letter-spacing:.14em;color:#E9B7A6">SWIPE &rarr;</div></div>`,

  // the photo as a mounted print: cream mat, running stitch in rose, a slight tilt
  slide: (P, s) => { const p = s.photo, tilt = s.i % 2 ? 1.1 : -1.3, text = p.quote ? `“${p.quote}”` : p.caption;
    return `<div class="c" style="background:var(--linen)">${stitchBg(P, s, '#B87260', .22)}
    <div class="k" style="position:absolute;left:72px;top:68px">${esc(P.kicker)}</div><div class="num">${s.n}</div>
    <div style="position:absolute;left:84px;top:140px;width:912px;height:${text ? 900 : 1010}px;background:var(--cream);padding:26px;box-sizing:border-box;transform:rotate(${tilt}deg);box-shadow:0 18px 44px rgba(36,36,36,.18)">
      ${pic(p, 'width:100%;height:100%;display:block')}
      <div style="position:absolute;inset:11px;border:3px dashed var(--rose);border-radius:4px;opacity:.75;pointer-events:none"></div></div>
    ${text ? `<div class="h" style="position:absolute;left:84px;right:84px;top:1080px;font-size:${p.quote ? 46 : 50}px;line-height:1.12;color:var(--ink);${p.quote ? 'font-style:italic' : ''}">${accent(text)}</div>` : ''}
    ${p.credit ? `<div class="t" style="position:absolute;left:84px;bottom:52px;font-size:22px;color:var(--soft)">Photo: ${esc(p.credit)}</div>` : ''}
    <div style="position:absolute;right:68px;bottom:40px;width:46px;height:48px">${svg('logo-mark.svg')}</div></div>`; },

  single: (P, s) => { const p = P.photos[0];
    return `<div class="c">${pic(p, 'position:absolute;left:0;top:0;width:1080px;height:1000px')}
    <div class="dark" style="position:absolute;left:0;top:1000px;width:1080px;height:350px;background:var(--sage);padding:0 72px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:16px">
      ${stitchBg(P, s, '#FAF7F2', .12, 'linear-gradient(90deg,transparent 35%,#000 100%)')}
      <div class="k">${esc(P.kicker)}</div>
      <h1 class="h" style="font-size:72px;line-height:1.02;color:var(--cream);max-width:860px">${accent(p.quote ? `“${p.quote}”` : P.title)}</h1>
      <div class="t" style="font-size:26px;line-height:1.4;color:rgba(250,247,242,.85)">${esc(p.caption || P.body)}${p.credit ? ` &middot; Photo: ${esc(p.credit)}` : ''}</div>
      <div style="position:absolute;right:64px;top:50px;width:60px;height:64px">${svg('logo-mark-on-dark.svg')}</div></div></div>`; },

  pair: (P, s) => `<div class="c" style="background:var(--cream)">${stitchBg(P, s, '#3E5538', .16, 'linear-gradient(180deg,transparent 30%,#000 100%)')}
    <div style="position:absolute;left:72px;top:72px;right:180px;display:flex;flex-direction:column;gap:16px"><div class="k">${esc(P.kicker)}</div>
      <h1 class="h" style="font-size:72px;line-height:1.02;color:var(--sage)">${accent(P.title)}</h1></div>
    <div style="position:absolute;right:72px;top:68px;width:76px;height:80px">${svg('logo-mark.svg')}</div>
    ${pic(P.photos[0], 'position:absolute;left:72px;top:290px;width:560px;height:900px;border-radius:24px')}
    ${pic(P.photos[1], 'position:absolute;left:600px;top:420px;width:420px;height:620px;border-radius:24px;border:10px solid var(--cream);box-shadow:0 14px 36px rgba(36,36,36,.18)')}
    <div class="t" style="position:absolute;left:72px;right:72px;bottom:64px;font-size:28px;color:var(--ink)">${esc(P.body)}</div></div>`,

  end: (P, s) => `<div class="c dark" style="background:var(--sage)">${stitchBg(P, s, '#FAF7F2', .13)}
    <div style="position:absolute;left:96px;right:96px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:56px"><div style="width:460px;height:80px">${svg('logo-full-on-dark.svg')}</div>
    <div style="display:flex;gap:22px">${P.photos.slice(0, 4).map(p => pic(p, 'width:170px;height:170px;border-radius:50%;border:5px solid var(--cream)')).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:30px">
      <h1 class="h" style="font-size:96px;line-height:1.02;color:var(--cream)">${accent(P.end)}</h1>
      <div class="t" style="font-size:32px;line-height:1.45;color:rgba(250,247,242,.88)">${esc(P.endBody)}</div>
      <div class="t" style="align-self:flex-start;margin-top:12px;background:var(--rose);color:var(--cream);font-size:30px;font-weight:600;padding:20px 34px;border-radius:999px">${esc(P.link.replace('https://', ''))}</div></div></div>
    <div class="num">${s.n}</div></div>`,
};

// ---------- plan posts from the inbox ----------
function plan() {
  const posts = [];
  const entries = fs.readdirSync(INBOX, {withFileTypes: true}).filter(e => !e.name.startsWith('.'));
  const folders = entries.filter(e => e.isDirectory()).map(e => path.join(INBOX, e.name));
  const loose = entries.filter(e => e.isFile() && IMG.test(e.name)).map(e => path.join(INBOX, e.name));
  const rootNotes = csv(path.join(INBOX, 'photos.csv'));
  for (const dir of folders) {
    const meta = fs.existsSync(path.join(dir, 'post.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf8')) : {};
    const files = fs.readdirSync(dir).filter(f => IMG.test(f)).sort().map(f => path.join(dir, f));
    if (files.length) posts.push(build(path.basename(dir), meta, files, csv(path.join(dir, 'photos.csv'))));
  }
  for (const f of loose) posts.push(build(path.basename(f).replace(IMG, ''), {}, [f], rootNotes));
  return posts;
}

function build(name, meta, files, notes) {
  const key = slug(meta.topic || name.replace(/^\d{4}-\d{2}-\d{2}-?/, ''));
  const T = TOPICS[ALIAS[key] || key] || TOPICS.default;
  const P = {id: `ngm-${DATE}-${slug(name)}`, ...T, ...meta, skipped: [], flags: []};
  P.photos = [];
  for (const f of files) {
    const n = notes.find(r => r.file === path.basename(f)) || {};
    if (/^n/i.test(n.consent || '')) { P.skipped.push(path.basename(f)); continue; }
    if (/^y/i.test(n.people || '') && !/^y/i.test(n.consent || '')) P.flags.push(`${path.basename(f)} shows people, consent not recorded`);
    if (!n.credit) P.flags.push(`${path.basename(f)} has no photo credit`);
    P.photos.push({path: f, file: path.basename(f), ...n});
  }
  const ph = P.photos;
  if (!ph.length) P.slides = [];
  else if (ph.length === 1) P.slides = [{layout: 'single'}];
  else if (ph.length === 2) P.slides = [{layout: 'pair'}];
  else { // IG carousels top out at 10 cards: cover + up to 8 photos + end card
    const body = ph.slice(1, 9);
    P.slides = [{layout: 'cover'}, ...body.map((photo, i) => ({layout: 'slide', photo, i})), {layout: 'end'}];
  }
  P.slides.forEach((s, i) => { s.idx = i; s.n = P.slides.length > 1 ? `${i + 1}/${P.slides.length}` : ''; s.file = `${String(i + 1).padStart(2, '0')}.jpg`; });
  return P;
}

// ---------- render ----------
(async () => {
  const posts = plan().filter(p => p.slides.length);
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(fs.existsSync);
  const b = await chromium.launch(exe ? {executablePath: exe} : {channel: 'chrome'});
  const page = await b.newPage({viewport: {width: 1080, height: 1350}});
  const queue = [['id', 'brand', 'platform', 'type', 'publish_at', 'caption', 'media_url', 'status', 'posted_at']], review = [`# Review before approving (${DATE})`, ''];
  for (const P of posts) {
    const dir = path.join(OUT, P.id); fs.mkdirSync(dir, {recursive: true});
    for (const s of P.slides) {
      await page.setContent(`<html><head><style>${CSS}</style></head><body>${L[s.layout](P, s)}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      await page.screenshot({path: path.join(dir, s.file), type: 'jpeg', quality: 90});
    }
    const credits = [...new Set(P.photos.map(p => p.credit).filter(Boolean))];
    const caps = P.captions.map(c => `${c}${credits.length ? `\n\nPhotos: ${credits.join(', ')}` : ''}\n\n${P.link}`);
    fs.writeFileSync(path.join(dir, 'caption.md'), `# ${P.id}\n\n` + caps.map((c, i) => `## Option ${i + 1}\n\n${c}\n`).join('\n'));
    const urls = P.slides.map(s => `${BASE}/${P.id}/${s.file}`).join('\n');
    const type = P.slides.length > 1 ? 'carousel' : 'photo';
    for (const platform of ['instagram', 'facebook']) queue.push([`${P.id}-${platform.slice(0, 2)}`, 'ngm', platform, type, '', caps[0], urls, 'draft', '']);
    review.push(`## ${P.id} (${type}, ${P.slides.length} image${P.slides.length > 1 ? 's' : ''})`, ...(P.flags.length ? P.flags.map(f => `- [ ] ${f}`) : ['- No flags']), ...(P.skipped.length ? [`- Skipped (no consent): ${P.skipped.join(', ')}`] : []), '');
    console.log('wrote', dir, P.slides.length, 'images');
  }
  fs.writeFileSync(path.join(OUT, 'queue.csv'), queue.map(r => r.map(cq).join(',')).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'review.md'), review.join('\n'));
  await b.close();
})();
