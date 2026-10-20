// Builds one newsletter issue from issue.json, in the client's brand (brands.json).
// Usage: node build-issue.js issues/<brand>/<yyyy-mm>/issue.json
// Writes next to issue.json:
//   email.html   what Brevo sends ({{ mirror }} and {{ unsubscribe }} tags filled in by Brevo)
//   index.html   web version (the "view in browser" page, linked from social posts)
//   paste.html   same email without Brevo tags, for pasting into another email tool
//   thanks.html  landing page for poll votes
//   pages/NN.jpg the email cut into 1080px-wide pages, shown as a swipeable card in the Hub
//   social/NN.jpg 4:5 post images for sections marked "social"
//   queue.csv    Queue rows: the newsletter itself (platform newsletter) + its social posts
//   check.txt    anything still missing ([placeholders], no signup link)
// Setup, in the folder you run from: npm i playwright-core@1.56.1 @fontsource/fraunces @fontsource/inter @fontsource/cormorant-garamond @fontsource/dm-sans
const fs = require('fs'), path = require('path');
const paths = [process.cwd(), __dirname];
const mod = name => require(require.resolve(name, { paths }));

const PAGES_BASE = 'https://grahamivyco.github.io/social-assets/newsletter';
const issueFile = path.resolve(process.argv[2] || '');
if (!fs.existsSync(issueFile)) { console.error('Usage: node build-issue.js issues/<brand>/<yyyy-mm>/issue.json'); process.exit(1); }
const dir = path.dirname(issueFile);
const I = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'brands.json'), 'utf8'))[I.brand];
if (!B) { console.error(`No brand "${I.brand}" in brands.json`); process.exit(1); }
const C = B.colors;
const WEB = I.web_url || `${PAGES_BASE}/${path.relative(__dirname, dir).split(path.sep).join('/')}/`;
const SIGNUP = I.signup_url || B.signup_url || B.join_url;
const monthName = new Date(I.month + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' });
const plain = s => String(s || '').replace(/\*\*?/g, '');
const NAME = plain(B.newsletter);

// ---------- text helpers ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// *word* = brand italic accent, **bold**, [text](https://link)
const md = (s, emColor = C.accent, linkColor = C.primary) => esc(s)
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" style="color:${linkColor};font-weight:bold;">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, `<em style="color:${emColor};">$1</em>`);
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);

const H = B.head_stack, F = B.body_stack, HW = B.head_weight;
const kicker = (t, color = C.primary_soft) => t ? `<p style="margin:0;font-family:${F};font-size:12px;letter-spacing:.18em;color:${color};">${esc(String(t).toUpperCase())}</p>` : '';
const h2 = (t, color = C.primary, em = C.accent, size = 30) => t ? `<h2 style="margin:6px 0 8px 0;font-family:${H};font-weight:${HW};font-size:${size}px;line-height:1.15;color:${color};">${md(t, em)}</h2>` : '';
const paras = (list, color = C.ink, size = 16, link = C.primary) => arr(list).map((p, i, a) =>
  `<p style="margin:0 0 ${i === a.length - 1 ? 0 : 12}px 0;font-family:${F};font-size:${size}px;line-height:1.75;color:${color};">${md(p, C.accent, link)}</p>`).join('');
const button = (b, bg = C.primary, fg = C.card) => b && b.url ? `<p style="margin:18px 0 0 0;"><a href="${esc(b.url)}" style="display:inline-block;background:${bg};color:${fg};font-family:${F};font-size:15px;font-weight:bold;text-decoration:none;padding:13px 28px;border-radius:100px;">${esc(b.text || 'Learn more')}</a></p>` : '';
const box = (inner, bg) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border-radius:14px;"><tr><td style="padding:22px 24px;">${inner}</td></tr></table>`;
const row = (inner, pad = '32px 40px 0 40px') => `<tr><td style="padding:${pad};">${inner}</td></tr>`;

// ---------- sections ----------
const TONES = {
  pale: { bg: C.pale, k: C.primary, h: C.primary, em: C.accent, t: C.ink, link: C.primary },
  rose: { bg: C.pale_accent, k: C.accent, h: C.primary, em: C.accent, t: C.ink, link: C.primary },
  dark: { bg: C.dark, k: C.pale, h: C.on_dark, em: C.on_dark_em, t: C.on_dark, link: C.on_dark },
};
const pollUrl = (s, o) => `${WEB}thanks.html?vote=${encodeURIComponent(o.value || o.label)}&poll=${encodeURIComponent(s.id || 'poll')}`;

const SECTIONS = {
  note: s => `<tr><td style="padding:24px 40px 8px 40px;">${paras(s.body)}</td></tr>`,
  feature: s => {
    const t = TONES[s.tone] || null;
    if (!t) return row(`${kicker(s.kicker)}${h2(s.title)}${s.meta ? paras(`**${s.meta}**`, C.ink, 15) : ''}${s.meta ? '<div style="height:6px"></div>' : ''}${paras(s.body)}${button(s.button)}`);
    return row(box(`${kicker(s.kicker, t.k)}${h2(s.title, t.h, t.em, s.tone === 'dark' ? 32 : 30)}${s.meta ? paras(`**${s.meta}**`, t.t, 15, t.link) + '<div style="height:6px"></div>' : ''}${paras(s.body, t.t, 15, t.link)}${button(s.button, s.tone === 'dark' ? C.card : C.primary, s.tone === 'dark' ? C.primary : C.card)}`, t.bg), s.first ? '24px 40px 0 40px' : '32px 40px 0 40px');
  },
  article: s => row(`<div style="border-top:1px solid ${C.line};padding-top:28px;">${kicker(s.kicker)}${h2(s.title)}${paras(s.body)}${button(s.button)}</div>`),
  spotlight: s => row(box(`${kicker(s.kicker || 'Spotlight', C.accent)}${s.photo ? `<img src="${esc(s.photo)}" width="100%" alt="${esc(plain(s.title))}" style="display:block;width:100%;border-radius:10px;margin:12px 0 4px 0;">` : ''}${h2(s.title, C.primary, C.accent, 28)}${paras(s.body, C.ink, 15)}${s.quote ? `<p style="margin:10px 0 0 0;font-family:${H};font-style:italic;font-size:21px;line-height:1.4;color:${C.ink};">"${md(s.quote)}"</p>` : ''}`, C.pale_accent), '28px 40px 0 40px'),
  calendar: s => {
    const td = `padding:12px 0;border-bottom:1px solid ${C.rule};`;
    const rows = arr(s.rows).map(r => `<tr><td style="${td}width:92px;vertical-align:top;color:${C.accent};font-weight:bold;">${esc(r.when)}</td><td style="${td}">${arr(r.items || [r]).map(x => `<strong>${md(x.title)}</strong>${x.detail ? ' · ' + md(x.detail) : ''}`).join('<br>')}${r.note ? `<br><span style="color:${C.muted};font-size:13px;">${md(r.note)}</span>` : ''}</td></tr>`).join('');
    return `<tr><td style="padding:32px 40px 6px 40px;">${h2(s.title).replace('margin:6px 0 8px 0', 'margin:0')}${s.intro ? `<p style="margin:6px 0 0 0;font-family:${F};font-size:14px;line-height:1.6;color:${C.muted};">${md(s.intro)}</p>` : ''}</td></tr>` +
      row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${F};font-size:15px;line-height:1.5;color:${C.ink};">${rows}</table>${s.link ? `<p style="margin:14px 0 0 0;font-family:${F};font-size:14px;"><a href="${esc(s.link.url)}" style="color:${C.primary};font-weight:bold;">${esc(s.link.text)} →</a></p>` : ''}`, '8px 40px 0 40px');
  },
  poll: s => row(box(`${kicker(s.kicker || 'Your turn', C.primary)}${h2(s.title, C.primary, C.accent, 26)}${paras(s.body, C.ink, 15)}<div style="height:10px"></div>${arr(s.options).map(o =>
    `<a href="${pollUrl(s, o)}" style="display:block;margin:8px 0 0 0;background:${C.card};border:1px solid ${C.line};border-radius:100px;padding:12px 18px;font-family:${F};font-size:15px;color:${C.primary};font-weight:bold;text-decoration:none;text-align:center;">${esc(o.label)}</a>`).join('')}<p style="margin:12px 0 0 0;font-family:${F};font-size:13px;color:${C.muted};">One tap counts your answer. Results in next month's issue.</p>`, C.pale)),
  cta: s => `<tr><td style="padding:32px 40px 8px 40px;text-align:center;">${h2(s.title, C.primary, C.accent, 28).replace('margin:6px 0 8px 0', 'margin:0 0 8px 0')}${paras(s.body, C.ink, 15)}${button(s.button)}</td></tr>`,
};

// ---------- email ----------
const fontLink = (() => { const n = B.card_fonts.head[0].replace(/ /g, '+'); return `<link href="https://fonts.googleapis.com/css2?family=${n}:ital,wght@0,${HW};1,${HW}&display=swap" rel="stylesheet">`; })();
function email(mode) { // mode: brevo | web | paste
  const body = I.sections.map((s, i) => {
    if (!SECTIONS[s.type]) throw new Error(`Unknown section type "${s.type}"`);
    return `\n<!-- ${s.type}${s.kicker ? ': ' + s.kicker : ''} -->\n` + SECTIONS[s.type](Object.assign({ first: i === 1 }, s)).replace('<tr>', `<tr data-s="${i}">`);
  }).join('');
  const lc = C.primary;
  const top = mode === 'brevo' ? `<tr><td align="center" style="padding:0 0 10px 0;font-family:${F};font-size:12px;color:${C.muted};">Trouble reading this? <a href="{{ mirror }}" style="color:${C.muted};">View it in your browser</a></td></tr>` : '';
  const signupBar = mode === 'web' && SIGNUP ? `<tr><td align="center" style="padding:0 0 14px 0;font-family:${F};font-size:14px;color:${C.ink};">Like this? <a href="${esc(SIGNUP)}" style="color:${C.primary};font-weight:bold;">Get ${esc(NAME)} free each month</a></td></tr>` : '';
  const unsub = mode === 'brevo' ? `<br><a href="{{ unsubscribe }}" style="color:${C.muted};">Unsubscribe</a>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(NAME)} · ${monthName}</title>
${fontLink}
<!-- Built by newsletter/build-issue.js from issue.json. Edit issue.json, not this file. -->
</head>
<body style="margin:0;padding:0;background:${C.outer};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(I.preview_text || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.outer};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">${top}${signupBar}</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:14px;">

<!-- Masthead -->
<tr><td style="padding:36px 40px 8px 40px;text-align:center;">
  <p style="margin:0;font-family:${F};font-size:12px;letter-spacing:.18em;color:${C.primary_soft};">${esc(B.org.toUpperCase())} · ${esc(monthName.toUpperCase())}</p>
  <h1 style="margin:10px 0 0 0;font-family:${H};font-weight:${HW};font-size:46px;line-height:1.1;color:${C.primary};">${md(B.newsletter)}</h1>
</td></tr>
<tr><td style="padding:16px 40px 0 40px;"><div style="border-top:1px solid ${C.line};"></div></td></tr>
${body}

<!-- Footer -->
<tr><td style="padding:28px 40px 32px 40px;text-align:center;font-family:${F};font-size:13px;line-height:1.7;color:${C.muted};">
  <div style="border-top:1px solid ${C.line};padding-top:20px;">
  ${B.footer.map(l => l.replace(/<a /g, `<a style="color:${lc};" `)).join('<br>\n  ')}${unsub}
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;
}

function thanks() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Thanks · ${esc(NAME)}</title>${fontLink}</head>
<body style="margin:0;background:${C.outer};font-family:${F};color:${C.ink};">
<div style="max-width:520px;margin:12vh auto 0;padding:36px 28px;background:${C.card};border:1px solid ${C.line};border-radius:14px;text-align:center;">
<p style="margin:0;font-size:12px;letter-spacing:.18em;color:${C.primary_soft};">${esc(NAME.toUpperCase())}</p>
<h1 style="margin:10px 0 8px;font-family:${H};font-weight:${HW};font-size:38px;color:${C.primary};">Thank <em style="color:${C.accent};">you</em></h1>
<p style="font-size:16px;line-height:1.7;margin:0 0 20px;">We counted your answer. You'll see the results in next month's issue.</p>
<a href="${esc(B.site)}" style="display:inline-block;background:${C.primary};color:${C.card};font-weight:bold;text-decoration:none;padding:13px 28px;border-radius:100px;">Visit ${esc(B.org)}</a>
</div></body></html>`;
}

// ---------- checks ----------
const issues = [];
JSON.stringify(I.sections, null, 1).split('\n').forEach(l => {
  (l.replace(/\[[^\]]+\]\([^)]+\)/g, '').match(/\[[^\]]+\]/g) || []).forEach(m => issues.push(`Still a placeholder: ${m}`));
});
if (!B.signup_url && !I.signup_url) issues.push(`No newsletter sign-up link for ${I.brand} yet (brands.json signup_url). Social posts point to ${B.join_url} for now.`);
if (!I.subject) issues.push('No subject line');
if (!I.send_at) issues.push('No send_at date');

// ---------- social posts + queue rows ----------
const firstLine = s => (arr(s.body)[0] || s.quote || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?/g, '');
const socialSections = I.sections.filter(s => s.social);
function caption(s) {
  if (s.social && s.social.caption) return s.social.caption;
  const cta = (B.signup_url || I.signup_url) ? `There's more in ${NAME}, our free monthly email. Get it in your inbox:` : `Members get ${NAME} every month. Join here:`;
  return [plain(s.title), s.meta ? plain(s.meta) : '', firstLine(s), cta].filter(Boolean).join('\n\n') + `\n\n${SIGNUP}`;
}
const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
const COLS = ['id', 'brand', 'platform', 'type', 'publish_at', 'caption', 'media_url', 'status', 'posted_at', 'month', 'pillar', 'hook', 'preview_url', 'sensitive', 'client_decision', 'client_note', 'answered_by', 'decided_at', 'revision', 'review_deadline', 'review_note'];

(async () => {
  fs.writeFileSync(path.join(dir, 'email.html'), email('brevo'));
  fs.writeFileSync(path.join(dir, 'index.html'), email('web'));
  fs.writeFileSync(path.join(dir, 'paste.html'), email('paste'));
  if (I.sections.some(s => s.type === 'poll')) fs.writeFileSync(path.join(dir, 'thanks.html'), thanks());

  const fontDir = pkg => path.dirname(require.resolve(`@fontsource/${pkg}/package.json`, { paths }));
  const ff = (family, pkg, weight, style) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${fs.readFileSync(`${fontDir(pkg)}/files/${pkg}-latin-${weight}-${style}.woff2`).toString('base64')}) format('woff2')}`;
  const [hn, hp, hw] = B.card_fonts.head, [bn, bp] = B.card_fonts.body;
  const fonts = ff(hn, hp, hw, 'normal') + ff(hn, hp, hw, 'italic') + ff(bn, bp, 400, 'normal') + ff(bn, bp, 600, 'normal');

  const { chromium } = mod('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // Pages for the Hub card: the email at 1080px wide, cut into 4:5 pages.
  const W = 624, scale = 1080 / W, pageH = Math.round(1350 / scale);
  const p = await browser.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: scale });
  await p.setContent(email('paste').replace('</head>', `<style>${fonts}</style></head>`), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  const total = await p.evaluate(() => document.documentElement.scrollHeight);
  fs.rmSync(path.join(dir, 'pages'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'pages'));
  const pages = [];
  for (let y = 0, n = 1; y < total; y += pageH, n++) {
    const f = `pages/${String(n).padStart(2, '0')}.jpg`;
    await p.screenshot({ path: path.join(dir, f), type: 'jpeg', quality: 86, fullPage: true, clip: { x: 0, y, width: W, height: Math.min(pageH, total - y) } });
    pages.push(WEB + f);
  }

  // Snapshot of each social section, shown on its post so the post looks like the newsletter.
  const snaps = {};
  for (const s of socialSections) {
    const el = await p.$(`tr[data-s="${I.sections.indexOf(s)}"] > td`);
    if (el) snaps[I.sections.indexOf(s)] = 'data:image/png;base64,' + (await el.screenshot({ type: 'png' })).toString('base64');
  }

  // Social cards, 1080x1350, one per section marked "social".
  fs.rmSync(path.join(dir, 'social'), { recursive: true, force: true });
  if (socialSections.length) fs.mkdirSync(path.join(dir, 'social'));
  const logo = `data:image/${B.logo.endsWith('png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(__dirname, 'assets', B.logo)).toString('base64')}`;
  const card = s => {
    const dark = s.tone === 'dark', bg = dark ? C.dark : s.tone === 'rose' ? C.pale_accent : s.tone === 'pale' ? C.pale : C.card;
    const fg = dark ? C.on_dark : C.primary, em = dark ? C.on_dark_em : C.accent, tx = dark ? C.on_dark : C.ink;
    const hook = (s.social && s.social.hook) || s.title;
    const sub = (s.social && s.social.line) || s.meta || '';
    return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0}body{width:1080px;height:1350px;overflow:hidden;background:${bg};color:${tx};font-family:'${bn}',sans-serif;display:flex;flex-direction:column;padding:96px 92px 80px}
.k{font-size:30px;letter-spacing:.2em;text-transform:uppercase;color:${dark ? C.pale : C.accent};font-weight:600}
h1{font-family:'${hn}',serif;font-weight:${hw};font-size:${plain(hook).length > 30 ? 84 : 112}px;line-height:1.02;color:${fg};margin-top:40px;letter-spacing:-.01em}h1 em{color:${em}}
.sub{font-size:36px;line-height:1.4;margin-top:28px;max-width:860px}.grow{flex:1}
.snap{flex:none;max-height:760px;margin:56px -12px 0;padding:18px 10px 6px;position:relative;overflow:hidden;border-radius:22px;background:${C.card};box-shadow:0 18px 50px rgba(0,0,0,.18);transform:rotate(-1.6deg)}
.snap img{width:100%;display:block})}
.foot{display:flex;align-items:center;gap:26px;border-top:2px solid ${dark ? 'rgba(255,255,255,.25)' : C.line};padding-top:36px;font-size:28px}
.foot img{width:84px;height:84px;border-radius:50%;object-fit:cover;background:${C.card}}.foot b{font-family:'${hn}',serif;font-weight:${hw};font-size:40px;color:${fg};display:block}
</style></head><body><div class="k">${esc(s.kicker || s.type)}</div><h1>${md(hook, em, fg)}</h1>${sub ? `<p class="sub">${md(sub, em, fg)}</p>` : ''}${snaps[I.sections.indexOf(s)] ? `<div class="snap"><img src="${snaps[I.sections.indexOf(s)]}"></div>` : ''}<div class="grow"></div>
<div class="foot"><img src="${logo}"><div><b>${md(B.newsletter, em, fg)}</b>${esc(monthName)} · free monthly email</div></div></body></html>`;
  };
  const social = [];
  for (let i = 0; i < socialSections.length; i++) {
    const s = socialSections[i], f = `social/${String(i + 1).padStart(2, '0')}.jpg`;
    const c = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await c.setContent(card(s), { waitUntil: 'load' });
    await c.evaluate(() => document.fonts.ready);
    await c.screenshot({ path: path.join(dir, f), type: 'jpeg', quality: 90 });
    await c.close();
    social.push({ s, url: WEB + f });
  }
  await browser.close();

  // Queue rows. Newsletter rows are always sensitive (they never send without a yes).
  const base = { brand: I.brand, month: I.month, status: 'draft', revision: 0 };
  const rows = [Object.assign({}, base, {
    id: `${I.brand}-${I.month}-newsletter`, platform: 'newsletter', type: 'email', publish_at: I.send_at,
    caption: `Subject: ${I.subject}\nPreview: ${I.preview_text || ''}\n\nFull email:\n\n${WEB}`,
    media_url: pages.join('\n'), pillar: 'newsletter', hook: I.subject, preview_url: pages[0], sensitive: 'yes', review_deadline: I.review_deadline || '',
  })];
  social.forEach(({ s, url }, i) => ['instagram', 'facebook'].forEach(pl => rows.push(Object.assign({}, base, {
    id: `${I.brand}-${I.month}-nl-${i + 1}-${pl === 'instagram' ? 'ig' : 'fb'}`, platform: pl, type: 'image',
    publish_at: (s.social && s.social.publish_at) || '', caption: caption(s), media_url: url, pillar: 'newsletter',
    hook: plain((s.social && s.social.hook) || s.title), preview_url: url, sensitive: s.type === 'spotlight' ? 'yes' : '',
  }))));
  fs.writeFileSync(path.join(dir, 'queue.csv'), [COLS.join(','), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'captions.md'), social.map(({ s, url }, i) => `## ${i + 1}. ${plain(s.title)}\nImage: ${url}\n\n${caption(s)}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'check.txt'), issues.length ? issues.join('\n') + '\n' : 'Ready\n');

  console.log(`Built ${path.relative(process.cwd(), dir)}: ${pages.length} pages, ${social.length} social posts, ${rows.length} queue rows`);
  console.log(issues.length ? 'Needs:\n- ' + issues.join('\n- ') : 'Ready');
  console.log('Web version: ' + WEB);
})().catch(e => { console.error(e); process.exit(1); });
