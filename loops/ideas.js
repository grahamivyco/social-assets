// Ideas loop (weekly). For each client: what worked on their accounts + what's working for big creators + what the owner
// said yes / pass to before -> local AI pitches ideas -> self-check (rules + AI judge, one retry) -> best 5 as Hub cards.
// A yes goes to the scripts loop. Feeds on: Hub "Post stats" (analytics), viral scout pattern report + hook bank.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const KEEP = 5, PITCH = 8;
const IDEA = { type: 'object', additionalProperties: false, required: ['ideas'], properties: { ideas: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['title', 'slot', 'format', 'hook', 'angle', 'borrowed'],
  properties: { title: { type: 'string' }, slot: { type: 'string' }, format: { type: 'string' }, hook: { type: 'string' },
    angle: { type: 'string' }, borrowed: { type: 'string' } } } } } };

function patterns() {
  const d = path.join(L.C.watched, '_patterns');
  let report = '', hooks = [];
  try {
    const f = fs.readdirSync(d).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().pop();
    if (f) report = fs.readFileSync(path.join(d, f), 'utf8').replace(/## Every video[\s\S]*/, '').slice(0, 5000);
  } catch {}
  try { hooks = fs.readFileSync(path.join(d, 'hook-bank.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-30).map(l => l.slice(2)); } catch {}
  return { report, hooks };
}

const postLine = p => `${p.published} ${p.platform} ${p.type}: "${p.caption.replace(/\s+/g, ' ').slice(0, 120)}" (score ${p.score}, reach ${p.reach ?? '?'}, saves ${p.saves ?? 0}, shares ${p.shares ?? 0})`;

async function runClient(client) {
  const stats = await L.hub('stats', { client: client.id, days: 30 }).catch(e => (L.log('stats:', e.message), { top: [], weakest: [] }));
  const past = (await L.hub('list', { loop: 'ideas' })).rows.filter(r => r.client === client.id);
  const liked = past.filter(r => ['yes', 'change', 'scripted'].includes(r.status)).slice(-15).map(r => r.title + (r.note ? ` (note: ${r.note})` : ''));
  const passed = past.filter(r => r.status === 'pass').slice(-15).map(r => r.title);
  const lessons = fs.readFileSync(path.join(L.STATE, 'lessons.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-15).map(l => l.slice(2));
  const p = patterns();
  const vars = { ...client, pillars: client.pillars.join(', '), formats: client.formats.join(', '), count: PITCH,
    top: (stats.top || []).map(postLine), weakest: (stats.weakest || []).map(postLine),
    patterns: p.report, hooks: p.hooks, liked, passed, lessons };

  let made = 0, kept = [];
  for (let attempt = 0; attempt < 2 && kept.length < KEEP; attempt++) {
    const prompt = L.fill('ideas.md', vars) + (attempt ? `\n\nLast try failed the check. Avoid: ${vars.failed}` : '');
    const { ideas } = await L.ask(prompt, IDEA, 0.7);
    made += ideas.length;
    const fails = [];
    for (const i of ideas) {
      const text = `${i.title}\nHook: ${i.hook}\n${i.angle}`;
      const broke = L.rules(text, { firstPersonOk: client.first_person_ok });
      if (passed.some(t => t.toLowerCase() === i.title.toLowerCase())) broke.push('already passed');
      if (kept.some(k => k.title.toLowerCase() === i.title.toLowerCase())) broke.push('duplicate');
      if (broke.length) { fails.push(broke.join(', ')); continue; }
      const j = await L.judge(client, text);
      if (!j.ok) { fails.push(j.reason); continue; }
      kept.push({ ...i, score: j.avg });
    }
    vars.failed = fails.slice(0, 6).join('; ');
  }
  kept = kept.sort((a, b) => b.score - a.score).slice(0, KEEP);
  const week = L.today();
  await L.hub('add', { rows: kept.map(i => ({
    id: `ideas-${client.id}-${week}-${L.slug(i.title)}`, loop: 'ideas', client: client.id, kind: 'idea', title: i.title,
    body: `${i.slot} · ${i.format}\nHook: ${i.hook}\n\n${i.angle}`, why: `Borrows: ${i.borrowed}. Check score ${i.score}/5.`,
    ask: 'Make this? A yes writes the script.' })) });
  await L.logRun({ loop: 'ideas', client: client.id, status: kept.length ? 'ok' : 'check', made, kept: kept.length, cards: kept.length,
    note: kept.length ? '' : 'Nothing passed the check: ' + vars.failed });
  L.log(`ideas ${client.id}: ${made} pitched, ${kept.length} kept`);
}

async function run(only) {
  L.pull();
  for (const c of L.clients().filter(c => !only || c.id === only)) {
    try { await runClient(c); }
    catch (e) { L.log(`ideas ${c.id} failed:`, e.message); await L.logRun({ loop: 'ideas', client: c.id, status: 'fail', made: 0, kept: 0, cards: 0, note: e.message }); }
  }
  L.pushState('Loops: ideas run');
}

module.exports = { run };
