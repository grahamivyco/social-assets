// Loops that need posts, followers or clients first. Built now, switched off in loops.json ("off": true).
// Turn one on by setting "off": false (the weekly review flags when the data is there).
//   proof (3rd of the month): a client's numbers jump 20%+ vs last month -> case study carousel draft -> idea card.
//   warmup (weekdays): someone shows up 2+ times in comments/DMs -> soft DM draft card.
//   retention (5th of the month): per client, results trend + overdue approvals + quiet time -> a risk card when it slips.
//   trends (daily 12:30): a fresh 5x+ outlier from the viral scout -> fast rebuild idea card (same Yes -> script path).
const fs = require('fs'), path = require('path');
const L = require('./lib');

const OUT = { type: 'object', additionalProperties: false, required: ['title', 'hook', 'angle'],
  properties: { title: { type: 'string' }, hook: { type: 'string' }, angle: { type: 'string' } } };
const ok = t => !L.rules(t).length;

async function proof() {
  for (const c of L.clients()) {
    const r = await L.hub('results', { client: c.id }).catch(() => ({ empty: true }));
    if (r.empty) continue;
    const jumps = (r.tiles || []).filter(t => t.value != null && t.prev && t.value >= t.prev * 1.2).map(t => `${t.title}: ${t.prev} -> ${t.value}`);
    if (!jumps.length) { await L.logRun({ loop: 'proof', client: c.id, status: 'ok', made: 0, kept: 0, cards: 0, note: 'no 20% jump' }); continue; }
    const o = await L.ask(`${c.name}'s social numbers this month vs last: ${jumps.join('; ')}. Top posts: ${(r.top || []).map(p => p.caption).join(' | ')}.
Pitch a 5-slide case study carousel for Open Frame's own account showing what changed and why (only these real numbers, nothing made up).
title: under 8 words. hook: slide 1 text under 10 words. angle: slides 2-5 in one short paragraph. No em dashes.`, OUT, 0.5);
    if (!ok([o.title, o.hook, o.angle].join('\n'))) continue;
    await L.hub('add', { rows: [{ id: `ideas-proof-${c.id}-${L.today().slice(0, 7)}`, loop: 'ideas', client: 'open-frame', kind: 'case study',
      title: o.title, body: `Wed declutter / before-after · carousel\nHook: ${o.hook}\n\n${o.angle}`, why: `Real numbers: ${jumps.join('; ')}. Ask ${c.name} before naming them.`,
      ask: 'Make this case study post?' }] });
    await L.logRun({ loop: 'proof', client: c.id, status: 'ok', made: 1, kept: 1, cards: 1, note: jumps.join('; ') });
  }
}

async function warmup() {
  const have = new Set((await L.hub('list', { loop: 'warmup' })).rows.map(r => r.id));
  for (const c of L.clients()) {
    const { people = [] } = await L.hub('people', { client: c.id }).catch(() => ({}));
    let cards = 0;
    for (const p of people.filter(p => p.count >= 2).slice(0, 3)) {
      const id = `warmup-${c.id}-${L.slug(p.who)}`;
      if (have.has(id)) continue;
      const { text } = await L.ask(`Write a short, friendly DM from ${c.name} to ${p.who}, who has commented or messaged ${p.count} times this month (last: "${p.last}").
Thank them in a specific way and ask one easy question about what they'd like to see more of. 2 sentences. No pitch, no link, no em dashes${c.first_person_ok ? '' : ', no I/we/our'}.`,
        { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, 0.6);
      if (L.rules(text, { firstPersonOk: c.first_person_ok }).length) continue;
      await L.hub('add', { rows: [{ id, loop: 'warmup', client: c.id, kind: 'warm-up DM', status: 'todo', title: `${p.who} keeps showing up`, body: `${p.count} times this month (${p.kinds.join(', ')}).\n\nDM draft:\n${text}`, ask: 'Send it from the app if it feels right.' }] });
      cards++;
    }
    await L.logRun({ loop: 'warmup', client: c.id, status: 'ok', made: people.length, kept: cards, cards, note: '' });
  }
}

async function retention() {
  const { clients = [] } = await L.hub('retention').catch(() => ({}));
  for (const c of clients) {
    const tiles = (c.results && c.results.tiles) || [], down = tiles.filter(t => t.value != null && t.prev && t.value < t.prev * 0.8).map(t => t.title);
    let score = 100;
    score -= down.length * 15; score -= Math.min(30, (c.overdue || 0) * 10); if (c.daysSinceAnswer != null && c.daysSinceAnswer > 21) score -= 25;
    const why = [down.length ? `down 20%+: ${down.join(', ')}` : '', c.overdue ? `${c.overdue} posts past their review deadline` : '', c.daysSinceAnswer > 21 ? `no answer in ${c.daysSinceAnswer} days` : ''].filter(Boolean);
    if (score < 70) await L.hub('add', { rows: [{ id: `retention-${c.brand}-${L.today().slice(0, 7)}`, loop: 'retention', client: c.brand, kind: 'client health', status: 'todo',
      title: `${c.client} needs a check-in`, body: `Health ${score}/100: ${why.join('; ')}.\n\nA short call or a "how is it going" email this week usually fixes it.`, ask: '' }] });
    await L.logRun({ loop: 'retention', client: c.brand, status: score < 70 ? 'check' : 'ok', made: 1, kept: 1, cards: score < 70 ? 1 : 0, note: `health ${score}${why.length ? ': ' + why.join('; ') : ''}` });
  }
}

async function trends() {
  const dir = L.C.watched, cutoff = Date.now() - 36 * 36e5, c = L.clients()[0];
  let folders = [];
  try { folders = fs.readdirSync(dir).filter(n => !n.startsWith('_')).map(n => path.join(dir, n)).filter(p => fs.statSync(p).mtimeMs > cutoff); } catch {}
  let cards = 0;
  for (const f of folders) {
    let rep = ''; try { rep = fs.readFileSync(path.join(f, 'report.md'), 'utf8'); } catch { continue; }
    const ratio = Number((rep.match(/outlier ([\d.]+)x/) || [])[1] || 0);
    if (ratio < 5) continue;
    const o = await L.ask(`This video is a ${ratio}x outlier for its creator right now. Report:\n${rep.slice(0, 3000)}\n\nPitch a fast rebuild for ${c.name} (${c.promise}; audience ${c.audience}): same hook shape and format, their own topic, filmable today in one take.
title under 8 words, hook under 12 words (no question opener), angle 2 sentences. No em dashes.`, OUT, 0.6);
    if (!ok([o.title, o.hook, o.angle].join('\n'))) continue;
    await L.hub('add', { rows: [{ id: `ideas-trend-${c.id}-${path.basename(f).slice(0, 40)}`, loop: 'ideas', client: c.id, kind: 'trend', title: o.title,
      body: `Any slot · talking head Reel\nHook: ${o.hook}\n\n${o.angle}`, why: `Rebuilds a ${ratio}x outlier from the last day (${path.basename(f)}). Trends fade fast: film this week.`, ask: 'Make this? A yes writes the script.' }] });
    cards++;
  }
  await L.logRun({ loop: 'trends', client: c.id, status: 'ok', made: folders.length, kept: cards, cards, note: '' });
}

module.exports = { proof, warmup, retention, trends };
