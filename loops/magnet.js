// Lead magnet loop (every 5 min). The free check form (social-assets check/) saves a request in the Hub.
// This loop runs the site check on the Mac (tools/audit.js), puts the report on GitHub Pages under an unguessable link,
// waits a few minutes for Pages to go live, then tells the Hub, which emails the result + booking link and adds the
// person to Leads (the n8n lead follow-up handles nudges from there). The email is a fixed template: no AI, so no check
// needed beyond "did the audit run". Nothing waits on Graham. He sees one Got it card per new lead.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const L = require('./lib');

const FILE = path.join(L.STATE, 'checks.json');
const WAIT_MIN = 4;

async function tick() {
  const done = L.readJSON(FILE, {});
  const rows = (await L.hub('check-list')).rows;
  for (const r of rows) {
    const d = done[r.id];
    if (!d) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
      try {
        execFileSync(process.execPath, [path.join(L.HERE, 'tools', 'audit.js'), r.site, tmp, '--pages', '12'], { encoding: 'utf8', timeout: 600000 });
        const a = JSON.parse(fs.readFileSync(path.join(tmp, 'audit.json'), 'utf8'));
        if (!a.pages || !a.pages.length || !a.pages[0].words) throw new Error('Could not read the site');
        const url = L.publish(`checks/${L.token(16)}`, { 'index.html': fs.readFileSync(path.join(tmp, 'report.html'), 'utf8').replace('<head>', '<head><meta name="robots" content="noindex">') }, 'Loops: site check report');
        done[r.id] = { at: new Date().toISOString(), url, score: a.score, fixes: a.fixes.slice(0, 3).map(f => f.fix) };
      } catch (e) {
        await L.hub('check-done', { id: r.id, failed: e.message.split('\n')[0] });
        await L.hub('add', { rows: [{ id: `check-fail-${r.id}`, loop: 'magnet', client: 'open-frame', kind: 'site check', status: 'todo',
          title: `Couldn't check ${r.site}`, body: `${r.name || ''} ${r.org ? `(${r.org})` : ''} ${r.email}\n${e.message.split('\n')[0]}\n\nEmail them yourself or try the address again.`, ask: '' }] });
        await L.logRun({ loop: 'magnet', client: 'open-frame', status: 'check', made: 1, kept: 0, cards: 1, note: `${r.site}: ${e.message.split('\n')[0]}` });
      }
      fs.writeFileSync(FILE, JSON.stringify(done, null, 2));
      continue;
    }
    if (Date.now() - new Date(d.at) < WAIT_MIN * 60000) continue;
    await L.hub('check-done', { id: r.id, score: d.score, fixes: d.fixes, report_url: d.url });
    await L.hub('add', { rows: [{ id: `check-${r.id}`, loop: 'magnet', client: 'open-frame', kind: 'new lead', status: 'todo',
      title: `${r.name || r.email} ran the free check`, body: `${r.org || ''}\n${r.site}: ${d.score}/100\n\nThey got the report and booking link. Follow-ups come as lead cards.`, link: d.url, ask: '' }] });
    await L.logRun({ loop: 'magnet', client: 'open-frame', status: 'ok', made: 1, kept: 1, cards: 1, note: `${r.site} ${d.score}/100` });
  }
}

module.exports = { tick };
