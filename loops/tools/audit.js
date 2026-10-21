// Copy of /mnt/project-files/site-audit/audit.js (thread "SEO and AI search visibility" owns it). Re-copy when that changes.
// Website + AI search audit (free lead magnet). Usage: node audit.js https://example.org [out-dir] [--pages 10]
// Node 18+, no packages. Reads the homepage and up to N linked pages, robots.txt, sitemap.xml and llms.txt,
// then writes audit.json and report.html (Open Frame branded, prioritized fixes in plain words).
// Run it where the site is reachable (Graham's Mac); the cloud container can't reach most sites.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const start = args.find(a => /^https?:\/\//.test(a));
if (!start) { console.error('Usage: node audit.js https://example.org [out-dir] [--pages 10]'); process.exit(1); }
const out = args.find(a => !a.startsWith('-') && a !== start && !/^\d+$/.test(a)) || '.';
const maxPages = Number(args[args.indexOf('--pages') + 1]) || 10;
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function get(url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'OpenFrameAudit/1.0 (+https://openframe.design)' }, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    return { ok: r.ok, status: r.status, url: r.url, body, ms: Date.now() - t, type: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, status: 0, url, body: '', ms: Date.now() - t, error: e.message }; }
}

// Small regex-based reader: enough for tags we check, no DOM needed.
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null; };
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const text = s => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, key) => { const t = tags(html, 'meta').find(m => (attr(m, 'name') || attr(m, 'property') || '').toLowerCase() === key); return t ? attr(t, 'content') : null; };

function readPage(r) {
  const h = r.body;
  const title = ((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  const imgs = tags(h, 'img');
  const ld = [...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => {
    try { const j = JSON.parse(m[1]); const all = [].concat(j['@graph'] || j); return all.map(x => [].concat(x['@type'] || [])).flat(); } catch { return ['(invalid JSON-LD)']; }
  });
  const sameAs = [...h.matchAll(/"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)].flatMap(m => { try { return [].concat(JSON.parse(m[1])); } catch { return []; } });
  const links = tags(h, 'a').map(a => ({ href: attr(a, 'href') })).filter(a => a.href);
  const anchorText = [...h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m => text(m[1]).toLowerCase());
  return {
    url: r.url, status: r.status, ms: r.ms, kb: Math.round(h.length / 1024),
    title, description: (meta(h, 'description') || '').replace(/&amp;/g, '&'),
    h1: (h.match(/<h1\b/gi) || []).length,
    lang: attr((h.match(/<html\b[^>]*>/i) || [''])[0], 'lang') || '',
    viewport: !!meta(h, 'viewport'),
    canonical: !!tags(h, 'link').find(l => (attr(l, 'rel') || '').toLowerCase() === 'canonical'),
    ogImage: !!meta(h, 'og:image'), ogTitle: !!meta(h, 'og:title'),
    images: imgs.length, noAlt: imgs.filter(i => attr(i, 'alt') == null).length,
    schema: ld, sameAs, words: text(h).split(' ').length,
    scripts: tags(h, 'script').length,
    faq: /<details\b|faq|frequently asked/i.test(h),
    links, anchorText,
  };
}

const robotsBlocks = (robots, bot) => {
  // Find the group for this bot (or *), and see if it disallows the whole site.
  const groups = []; let cur = null;
  for (const line of robots.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean)) {
    const [k, ...v] = line.split(':'); const val = v.join(':').trim();
    if (/^user-agent$/i.test(k)) { if (!cur || cur.rules.length) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(val.toLowerCase()); }
    else if (cur && /^(dis)?allow$/i.test(k)) cur.rules.push({ allow: /^allow$/i.test(k), path: val });
  }
  const g = groups.find(x => x.agents.includes(bot.toLowerCase())) || groups.find(x => x.agents.includes('*'));
  return !!g && g.rules.some(r => !r.allow && r.path === '/') && !g.rules.some(r => r.allow && r.path === '/');
};

(async () => {
  const origin = new URL(start).origin;
  const home = await get(start);
  if (!home.ok) { console.error(`Could not load ${start} (${home.status || home.error})`); process.exit(1); }
  const pages = [readPage(home)];
  const seen = new Set([new URL(home.url).href.replace(/#.*$/, '')]);
  const queue = pages[0].links.map(l => { try { return new URL(l.href, home.url); } catch { return null; } })
    .filter(u => u && u.origin === new URL(home.url).origin && !/\.(pdf|jpe?g|png|gif|svg|zip|docx?)$/i.test(u.pathname)).map(u => u.href.replace(/#.*$/, ''));
  for (const u of queue) {
    if (pages.length >= maxPages) break;
    if (seen.has(u)) continue; seen.add(u);
    const r = await get(u);
    if (r.ok && r.type.includes('html')) pages.push(readPage(r));
  }
  const httpRedirect = start.startsWith('https') ? await get(start.replace(/^https:/, 'http:')) : null;
  const robots = await get(origin + '/robots.txt');
  const sitemap = await get(origin + '/sitemap.xml');
  const llms = await get(origin + '/llms.txt');
  // Every page listed in the sitemap should load with a 200. Single-page apps often answer 404 and redirect with JavaScript,
  // which people never notice but Google and AI crawlers do.
  const smUrls = sitemap.ok ? [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]) : [];
  const smOtherHost = smUrls.filter(u => { try { return new URL(u).origin !== origin; } catch { return true; } });
  const smChecks = [];
  for (const u of smUrls.slice(0, 25)) {
    let local = u; try { const x = new URL(u); local = origin + x.pathname + x.search; } catch {}
    const r = await get(local); smChecks.push({ url: local, status: r.status });
  }
  const smBroken = smChecks.filter(c => c.status !== 200);
  const smDates = sitemap.ok ? [...sitemap.body.matchAll(/<lastmod>\s*([0-9-]{10})/gi)].map(m => m[1]).sort() : [];
  const smNewest = smDates[smDates.length - 1];
  const staleDays = smNewest ? Math.round((Date.now() - Date.parse(smNewest)) / 864e5) : null;
  const titles = pages.map(p => p.title).filter(Boolean);
  const dupTitles = titles.length - new Set(titles).size;
  const allSameAs = [...new Set(pages.flatMap(p => p.sameAs))];
  const blockedBots = robots.ok ? AI_BOTS.filter(b => robotsBlocks(robots.body, b)) : [];
  const allSchema = [...new Set(pages.flatMap(p => p.schema))];
  const allAnchors = pages.flatMap(p => p.anchorText).join(' | ');
  const pct = (f) => Math.round(pages.filter(f).length / pages.length * 100);

  // Each check: group, pass, priority when failing, plain-words fix.
  const C = [];
  const add = (group, name, pass, priority, fix, detail) => C.push({ group, name, pass: !!pass, priority, fix, detail: detail || '' });
  add('Search basics', 'Secure site (https)', home.url.startsWith('https://') && (!httpRedirect || httpRedirect.url.startsWith('https://')), 'high', 'Turn on https and send every http visit to the https address. Browsers warn visitors away from sites without it.');
  add('Search basics', 'Page titles', pct(p => p.title.length >= 10 && p.title.length <= 60) >= 80, 'high', 'Give every page its own title of 10 to 60 characters that says what the page is and who it is for.', `${pct(p => p.title.length >= 10 && p.title.length <= 60)}% of pages OK`);
  add('Search basics', 'Page descriptions', pct(p => p.description.length >= 50 && p.description.length <= 160) >= 80, 'medium', 'Write a 1 to 2 sentence description for each page (50 to 160 characters). Google often shows it under your link.', `${pct(p => p.description.length >= 50 && p.description.length <= 160)}% of pages OK`);
  add('Search basics', 'One main heading per page', pct(p => p.h1 === 1) >= 80, 'low', 'Each page should have exactly one main heading (H1) that names the page.', `${pct(p => p.h1 === 1)}% of pages OK`);
  add('Search basics', 'Sitemap', sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.body), 'medium', 'Publish a sitemap at /sitemap.xml and submit it in Google Search Console.');
  add('Search basics', 'Every page in the sitemap loads', smUrls.length ? smBroken.length === 0 : true, 'high', 'Some pages in your sitemap answer with an error code. Google and AI tools skip pages that error, even if they look fine in a browser. Fix the hosting so each page answers 200.', smBroken.length ? `${smBroken.length} of ${smChecks.length}: ${smBroken.slice(0, 4).map(c => `${new URL(c.url).pathname} (${c.status})`).join(', ')}` : `${smChecks.length} checked`);
  add('Search basics', 'Sitemap uses this domain', smOtherHost.length === 0, 'medium', 'Your sitemap lists addresses on a different domain. List the exact addresses visitors use.', smOtherHost.length ? smOtherHost.slice(0, 2).join(', ') : '');
  add('Search basics', 'Each page has its own title', dupTitles === 0, 'medium', 'Several pages share the same title, so Google and AI tools can\'t tell them apart. Give each page its own.', dupTitles ? `${dupTitles} duplicate titles` : '');
  add('Search basics', 'Preferred address set (canonical)', pct(p => p.canonical) >= 80, 'low', 'Add a canonical link to each page so search engines know the one true address for it.', `${pct(p => p.canonical)}% of pages`);
  add('Search basics', 'Fast pages', pages.every(p => p.ms < 2500), 'medium', 'Some pages took over 2.5 seconds to load. Compress images and remove unused scripts.', `slowest ${Math.max(...pages.map(p => p.ms))} ms`);
  add('Search basics', 'Enough words on each page', pct(p => p.words >= 250) >= 70, 'low', 'Thin pages rank poorly. Give each program or event page at least a few paragraphs: who it is for, when, where, how to join.', `${pct(p => p.words >= 250)}% of pages have 250+ words`);
  add('AI answers', 'AI assistants allowed to read the site', robots.ok ? blockedBots.length === 0 : true, 'high', `Your robots.txt blocks ${blockedBots.join(', ')}. ChatGPT, Claude, Perplexity and Google's AI answers can't recommend a site they're not allowed to read.`, blockedBots.length ? `blocked: ${blockedBots.join(', ')}` : 'none blocked');
  add('AI answers', 'Organization details in code (schema)', allSchema.some(t => /Organization|NGO|NonprofitOrganization|LocalBusiness/i.test(t)), 'high', 'Add Organization (or NGO) structured data with your name, logo, address, phone, email and social links. AI tools and Google use it to describe you correctly.', allSchema.length ? `found: ${allSchema.join(', ')}` : 'none found');
  add('AI answers', 'Readable without JavaScript', pages[0].words >= 150, 'high', 'Most AI crawlers read the raw page and do not run JavaScript. Your homepage has almost no text until scripts run, so they see a blank page. Put the main text in the HTML.', `${pages[0].words} words in the raw homepage`);
  add('AI answers', 'Social profiles linked in code', allSameAs.length >= 2, 'medium', 'List your Instagram, Facebook, LinkedIn and other profiles in the structured data (sameAs). It helps AI tools connect your site, socials and reviews as one organization.', allSameAs.length ? `${allSameAs.length} linked` : 'none');
  add('AI answers', 'Recently updated', staleDays === null ? false : staleDays <= 180, 'low', 'AI answers favor fresh pages. Update key pages at least every few months and keep the dates in your sitemap current.', staleDays === null ? 'no dates in sitemap' : `newest sitemap date ${smNewest} (${staleDays} days ago)`);
  add('AI answers', 'Events in code (schema)', allSchema.some(t => /Event/i.test(t)), 'medium', 'Mark up meetings and events with Event structured data so they can show in Google and AI answers with dates and places.');
  add('AI answers', 'Questions answered on the site', pages.some(p => p.faq), 'medium', 'Add an FAQ: who can join, what it costs, where and when you meet, how to give. AI answers quote pages that answer questions directly.');
  add('AI answers', 'llms.txt', llms.ok && llms.type.includes('text') && llms.body.length > 50, 'low', 'Add a short /llms.txt that summarizes who you are and links your key pages. It is new and optional, and it is cheap to add.');
  add('AI answers', 'Share previews (Open Graph)', pct(p => p.ogImage && p.ogTitle) >= 80, 'medium', 'Add a share image and title to every page so links look right on Facebook, LinkedIn and in messages.', `${pct(p => p.ogImage && p.ogTitle)}% of pages OK`);
  add('People and trust', 'Clear next step in the menu', /donat|give|join|member|volunteer|sign up|book|contact/.test(allAnchors), 'high', 'Put one clear action (Join, Donate, Volunteer or Book) in the main menu as a button.');
  add('People and trust', 'Contact details visible', pages.some(p => /mailto:|tel:/i.test(p.links.map(l => l.href).join(' '))), 'medium', 'Show an email address or phone number on every page, usually in the footer.');
  add('People and trust', 'Image descriptions (alt text)', pages.reduce((s, p) => s + p.noAlt, 0) === 0, 'medium', 'Describe each image in its alt text. Screen readers read it out, and search engines use it.', `${pages.reduce((s, p) => s + p.noAlt, 0)} of ${pages.reduce((s, p) => s + p.images, 0)} images missing alt`);
  add('People and trust', 'Language set', pages.every(p => p.lang), 'low', 'Set the page language (lang="en") so screen readers pronounce it correctly.');
  add('People and trust', 'Works on phones', pages.every(p => p.viewport), 'high', 'Add the mobile viewport tag so pages fit phone screens.');

  const W = { high: 3, medium: 2, low: 1 };
  const groups = [...new Set(C.map(c => c.group))].map(g => {
    const cs = C.filter(c => c.group === g), tot = cs.reduce((s, c) => s + W[c.priority], 0), got = cs.filter(c => c.pass).reduce((s, c) => s + W[c.priority], 0);
    return { group: g, score: Math.round(got / tot * 100), checks: cs };
  });
  const score = Math.round(groups.reduce((s, g) => s + g.score, 0) / groups.length);
  const fixes = C.filter(c => !c.pass).sort((a, b) => W[b.priority] - W[a.priority]);
  const result = { site: origin, checked: new Date().toISOString(), pages: pages.map(({ links, anchorText, ...p }) => p), sitemapChecks: smChecks, score, groups, fixes };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'report.html'), report(result));
  console.log(`Score ${score}/100. ${fixes.length} fixes. Wrote audit.json and report.html to ${out}`);
})();

function report(r) {
  const host = new URL(r.site).host;
  const ring = s => `<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="60" cy="60" r="50" fill="none" stroke="${s >= 80 ? 'var(--up)' : s >= 50 ? 'var(--warn)' : 'var(--acc)'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(s / 100 * 314).toFixed(1)} 314" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" font-size="28" font-family="Fraunces,Georgia,serif" fill="var(--ink)">${s}</text></svg>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(host)} website check</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;1,400&family=Inter:wght@400;600&display=swap">
<style>:root{--bg:#f3f1ea;--card:#fbfaf6;--ink:#111110;--soft:#4b4a46;--muted:#6d6b64;--line:#d9d5c8;--acc:#f24333;--up:#1f7a45;--warn:#b7791f;--band:#111110;--onband:#f3f1ea}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55}
.page{max-width:860px;margin:0 auto;padding:44px 24px}h1,h2{font-family:Fraunces,Georgia,serif;font-weight:500}h1{font-size:40px;line-height:1.1;margin:8px 0 10px}h1 em{color:var(--acc)}h2{font-size:26px;margin:36px 0 12px}
.k{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-weight:600}.lede{color:var(--soft);font-size:17px;max-width:620px}
.top{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;margin-top:24px}.groups{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;min-width:0}.g b{font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:500;display:block}
.fix{display:grid;grid-template-columns:90px 1fr;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.fix:last-child{border:0}
.pri{font-size:12px;font-weight:600;border-radius:99px;padding:2px 10px;justify-self:start;align-self:start}.high{background:#fde3df;color:#a3271b}.medium{background:#fbf0d9;color:#7a4f0e}.low{background:#e8e6df;color:var(--soft)}
.fix b{display:block}.fix span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse}td{padding:8px 4px;border-bottom:1px solid var(--line);vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.y{color:var(--up);font-weight:600}.n{color:var(--acc);font-weight:600}
.band{background:var(--band);color:var(--onband);border-radius:14px;padding:24px;margin-top:36px}.band h2{margin:0 0 6px;color:var(--onband)}.band a{color:var(--onband)}
.foot{margin-top:24px;font-size:12px;color:var(--muted)}
@media (max-width:700px){.top{grid-template-columns:1fr}.groups{grid-template-columns:1fr}.fix{grid-template-columns:1fr}.page{padding:28px 16px}h1{font-size:30px}}
@media print{.card,.fix{break-inside:avoid}}</style></head><body><div class="page">
<div class="k">Free website check by Open Frame</div><h1>${esc(host)}: <em>${r.fixes.length}</em> things to fix</h1>
<p class="lede">How easy your site is to find on Google, how AI assistants like ChatGPT see it, and whether visitors know what to do next. We checked ${r.pages.length} pages on ${new Date(r.checked).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
<div class="top">${ring(r.score)}<div class="groups">${r.groups.map(g => `<div class="card g"><span class="k">${esc(g.group)}</span><b>${g.score}</b></div>`).join('')}</div></div>
<h2>Fix these first</h2><div class="card">${r.fixes.length ? r.fixes.map(f => `<div class="fix"><span class="pri ${f.priority}">${f.priority === 'high' ? 'Fix now' : f.priority === 'medium' ? 'Soon' : 'Nice to have'}</span><div><b>${esc(f.name)}</b>${esc(f.fix)}${f.detail ? `<br><span>${esc(f.detail)}</span>` : ''}</div></div>`).join('') : '<p>Nothing to fix. Nice work.</p>'}</div>
<h2>Everything we checked</h2><div class="card"><table>${r.groups.flatMap(g => g.checks).map(c => `<tr><td>${esc(c.name)}${c.detail ? `<br><span style="color:var(--muted);font-size:13px">${esc(c.detail)}</span>` : ''}</td><td class="${c.pass ? 'y' : 'n'}">${c.pass ? 'Pass' : 'Fix'}</td></tr>`).join('')}</table></div>
<div class="band"><h2>Want help with these?</h2><p>We fix sites like this for mission-driven organizations. Book a free consult:</p><p style="margin-top:8px"><a href="https://openframe.design/links">https://openframe.design/links</a></p></div>
<div class="foot">Open Frame · design and marketing for mission-driven organizations · Minneapolis and Barcelona. Automated check of public pages; a person reviews it before it is sent.</div>
</div></body></html>`;
}
