// Site + AI search loop. Free: tools/audit.js (no packages) + the Hub.
// run (1st of the month): for each client with a "site", run the site check, compare with last month
//   -> one card: score, what broke since last time, what got fixed. Full report in Site checks/ on the Mac.
//   Then 3 AI search cards (rotating through the client's ai_prompts): one tap on the link asks ChatGPT,
//   then Yes = they named the brand, Pass = they didn't, Change = add a note (who they named instead).
// collect (hourly): answered prompt cards -> state/<client>/ai-search.csv, read by the monthly report and weekly review.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const q = s => encodeURIComponent(s);

async function checkSite(c) {
  const dir = path.join(L.C.sitechecks || path.join(L.C.scripts, '..', 'Site checks'), c.name, L.today());
  execFileSync(process.execPath, [path.join(L.HERE, 'tools', 'audit.js'), c.site, dir, '--pages', '20'], { encoding: 'utf8', timeout: 600000 });
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'audit.json'), 'utf8'));
  const histFile = path.join(L.STATE, c.id, 'site.json'), hist = L.readJSON(histFile, []);
  const prev = hist[hist.length - 1], now = a.fixes.map(f => f.name);
  const broke = prev ? now.filter(n => !prev.fixes.includes(n)) : [], fixed = prev ? prev.fixes.filter(n => !now.includes(n)) : [];
  hist.push({ date: L.today(), score: a.score, fixes: now });
  fs.mkdirSync(path.dirname(histFile), { recursive: true });
  fs.writeFileSync(histFile, JSON.stringify(hist.slice(-24), null, 2) + '\n');
  const top = a.fixes.filter(f => f.priority === 'high').slice(0, 3);
  const body = [`Score ${a.score}/100${prev ? ` (was ${prev.score})` : ''}.`,
    broke.length ? `New problems: ${broke.join(', ')}.` : 'Nothing new broke.',
    fixed.length ? `Fixed since last month: ${fixed.join(', ')}.` : '',
    top.length ? `\nTop fixes:\n${top.map(f => `- ${f.name}: ${f.fix}`).join('\n')}` : '',
    `\nFull report: ${dir}/report.html`].filter(Boolean).join('\n');
  await L.hub('add', { rows: [{ id: `site-${c.id}-${L.today()}`, loop: 'site', client: c.id, kind: 'site check', status: 'todo',
    title: `${c.name} site check`, body, link: c.site, ask: broke.length ? 'Something new broke. Fix it or ask Claude to.' : '' }] });
  return { score: a.score, broke: broke.length };
}

async function promptCards(c) {
  const list = c.ai_prompts || [];
  if (!list.length) return 0;
  const m = new Date().getFullYear() * 12 + new Date().getMonth(), pick = [0, 1, 2].map(i => list[(m * 3 + i) % list.length]);
  const month = L.today().slice(0, 7);
  await L.hub('add', { rows: [...new Set(pick)].map(p => ({ id: `ai-${c.id}-${month}-${L.slug(p)}`, loop: 'site', client: c.id, kind: 'AI search',
    title: `Does ChatGPT name ${c.name}?`, body: `Ask: "${p}"\n\nAlso worth a look:\nhttps://www.perplexity.ai/search?q=${q(p)}\nhttps://www.google.com/search?q=${q(p)}`,
    link: `https://chatgpt.com/?q=${q(p)}`, ask: `Tap Open, read the answer. Yes if ${c.name} is named, Pass if not, Change to note who was named.` })) });
  return pick.length;
}

async function run() {
  L.pull();
  for (const c of L.clients().filter(c => c.site)) {
    try {
      const s = await checkSite(c), n = await promptCards(c);
      await L.logRun({ loop: 'site', client: c.id, status: s.broke ? 'check' : 'ok', made: 1 + n, kept: 1 + n, cards: 1 + n, note: `score ${s.score}, ${s.broke} new problems` });
    } catch (e) { await L.logRun({ loop: 'site', client: c.id, status: 'fail', made: 0, kept: 0, cards: 0, note: e.message.split('\n')[0] }); }
  }
  L.pushState('Loops: monthly site check');
}

async function collect() {
  const done = (await L.hub('list', { loop: 'site', status: ['yes', 'pass', 'change'] })).rows.filter(r => r.kind === 'AI search');
  if (!done.length) return;
  L.pull();
  for (const r of done) {
    const file = path.join(L.STATE, r.client, 'ai-search.csv');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, 'date,engine,prompt,named,note\n');
    const prompt = (r.body.match(/Ask: "(.*)"/) || [])[1] || r.title;
    const cell = s => `"${String(s || '').replace(/"/g, '""')}"`;
    fs.appendFileSync(file, [L.today(), 'ChatGPT', cell(prompt), r.status === 'yes' ? 'y' : r.status === 'pass' ? 'n' : '', cell(r.note)].join(',') + '\n');
    await L.hub('set', { id: r.id, fields: { status: 'logged' } });
  }
  L.pushState('Loops: AI search answers');
}

module.exports = { run, collect };
