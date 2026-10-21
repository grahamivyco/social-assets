// Reel script asks (every 2 min). The "New scripts" button on the Studio Reels tab adds a 'reel-ask' row in the Hub.
// This writes 3 talking head scripts of that type with the local AI -> self-check (rules + AI judge, one retry)
// -> Loops rows (loop 'scripts', kind of | personal | viral, status 'ready') that show as cards on the Reels tab.
// It also rewrites a script you tapped Change on, using your note.
// Types: of = Open Frame talking heads, personal = Graham's own account, viral = rebuilt from what's blowing up in the niche (viral scout).
const fs = require('fs'), path = require('path');
const L = require('./lib');
const { patterns } = require('./ideas');

const COUNT = 3;
const TYPES = {
  of: { label: 'Open Frame talking head', brief: 'For the Open Frame business account: design and marketing for nonprofits and mission-driven groups. Teach one useful thing or tell one real project story. End with the call to action.', cta: 'https://calendly.com/grahamivy-co/30min' },
  personal: { label: 'personal account, build in public', brief: "For the owner's personal account: a designer who moved from Minneapolis to Barcelona, building his studio in public with real numbers. Warm, honest, a little funny. Never sounds like an ad.", cta: 'https://openframe.design/links' },
  viral: { label: 'rebuilt from a viral format', brief: 'Take a hook formula or format from the viral pattern report and hooks below, and rebuild it for nonprofits and mission-driven groups in the owner\'s voice. Say which format it borrows in "borrowed".', cta: 'https://calendly.com/grahamivy-co/30min' },
};
const ONE = { type: 'object', additionalProperties: false, required: ['title', 'hook', 'hooks', 'script', 'caption', 'borrowed'],
  properties: { title: { type: 'string' }, hook: { type: 'string' }, hooks: { type: 'array', items: { type: 'string' } }, script: { type: 'string' },
    caption: { type: 'string' }, borrowed: { type: 'string' } } };
const MANY = { type: 'object', additionalProperties: false, required: ['scripts'], properties: { scripts: { type: 'array', items: ONE } } };

// Private copy rules live in reels/config.json on the Mac (never in git): things the AI must never write.
const privateRules = () => { const r = L.readJSON(path.join(L.C.repo, 'reels', 'config.json'), {}).copyRules; return r ? 'Never break these private rules: ' + r : ''; };
const hookFirst = s => String(s.script || '').trim().split('\n')[0];

function check(client, s) {
  const text = [s.title, s.hook, s.script].join('\n');
  const broke = [...L.rules(text, { maxWords: 130 }), ...L.rules(s.caption)];
  if (!/https:\/\//.test(s.caption)) broke.push('caption has no full https link');
  if (/\bI'?m ADHD\b/i.test(text)) broke.push('say "I have ADHD"');
  if (/\[(b-?roll|cut to|show)/i.test(s.script)) broke.push('talking head only, no b-roll');
  return broke;
}

async function write(client, type, rows, note, count) {
  const T = TYPES[type];
  const p = type === 'personal' ? { report: '', hooks: [] } : patterns();
  const have = rows.filter(r => r.loop === 'scripts' && r.kind === type && r.status !== 'pass').slice(-8)
    .map(r => `${r.title.replace(/^Film this: /, '')}: ${String(r.body).split('\n\nCaption')[0].replace(/\s+/g, ' ').slice(0, 400)}`);
  const passed = rows.filter(r => r.loop === 'scripts' && r.kind === type && r.status === 'pass').slice(-10).map(r => r.title);
  const lessons = fs.readFileSync(path.join(L.STATE, 'lessons.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-10).map(l => l.slice(2));
  const vars = { ...client, count, type: T.label, brief: T.brief + ` Call to action link: ${T.cta}`, have, passed, note: note || '(none)',
    patterns: p.report || (type === 'viral' ? 'No scout report yet. Use the hooks below, or proven short-form formats: list of 3, myth vs fact, before and after, one mistake, hot take.' : ''),
    hooks: p.hooks, lessons, private: privateRules() };
  let kept = [], why = '', made = 0;
  for (let attempt = 0; attempt < 2 && kept.length < count; attempt++) {
    const { scripts } = await L.ask(L.fill('reel-ask.md', vars) + (why ? `\n\nLast try failed the check: ${why}. Fix that.` : ''), MANY, 0.7);
    made += scripts.length;
    const fails = [];
    for (const s of scripts) {
      const broke = check(client, s);
      if (kept.some(k => k.title.toLowerCase() === s.title.toLowerCase())) broke.push('duplicate');
      if (broke.length) { fails.push(broke.join(', ')); continue; }
      const j = await L.judge(client, s.script);
      if (!j.ok) { fails.push(j.reason); continue; }
      kept.push({ ...s, score: j.avg });
    }
    why = fails.slice(0, 4).join('; ');
  }
  return { kept: kept.sort((a, b) => b.score - a.score).slice(0, count), made, why };
}

const body = s => `${s.script.trim()}\n\nCaption:\n${s.caption.trim()}`;
const why = (s, type) => [s.hooks && s.hooks.length ? 'Other hooks to film: ' + s.hooks.slice(0, 2).join(' / ') : '',
  type === 'viral' && s.borrowed ? 'Borrows: ' + s.borrowed : ''].filter(Boolean).join('\n');

async function tick() {
  const asks = (await L.hub('list', { loop: 'reel-ask', status: 'new' })).rows;
  const changes = (await L.hub('list', { loop: 'scripts', status: 'change' })).rows;
  if (!asks.length && !changes.length) return;
  const rows = (await L.hub('list', { loop: 'scripts' })).rows;
  const client = L.clients().find(c => c.id === 'open-frame') || L.clients()[0];
  for (const a of asks) {
    const type = TYPES[a.kind] ? a.kind : 'of';
    await L.hub('set', { id: a.id, fields: { status: 'working' } });
    try {
      const r = await write(client, type, rows, a.body, COUNT);
      await L.hub('add', { rows: r.kept.map(s => ({ id: `script-${type}-${L.today()}-${L.slug(s.title)}`, loop: 'scripts', client: client.id, kind: type,
        status: 'ready', title: s.title, body: body(s), why: why(s, type), ask: 'Film it in one take and AirDrop it. The Reel draft makes itself.' })) });
      await L.hub('set', { id: a.id, fields: { status: 'done', note: `${r.kept.length} scripts` } });
      await L.logRun({ loop: 'reel-ask', client: client.id, status: r.kept.length ? 'ok' : 'check', made: r.made, kept: r.kept.length, cards: r.kept.length,
        note: r.kept.length ? type : 'Nothing passed the check: ' + r.why });
      L.log(`reel-ask ${type}: ${r.kept.length} scripts`);
    } catch (e) {
      // LM Studio off etc: put it back so the next tick tries again (the Mac helper restarts LM Studio meanwhile).
      await L.hub('set', { id: a.id, fields: { status: 'new', note: e.message.slice(0, 200) } });
      L.log('reel-ask failed:', e.message);
    }
  }
  for (const c of changes) {
    const type = TYPES[c.kind] ? c.kind : 'of';
    try {
      const old = `Rewrite this script. Keep what works, change what the owner asked.\n${c.title}\n${c.body}`;
      const r = await write(client, type, rows, `${c.note || 'Make it better.'}\n\n${old}`, 1);
      if (!r.kept.length) { await L.hub('set', { id: c.id, fields: { status: 'ready', note: 'Rewrite failed the check: ' + r.why.slice(0, 200) } }); continue; }
      const s = r.kept[0];
      await L.hub('set', { id: c.id, fields: { status: 'ready', title: s.title, body: body(s), why: why(s, type), note: 'Rewritten: ' + (c.note || '') } });
      await L.logRun({ loop: 'reel-ask', client: client.id, status: 'ok', made: r.made, kept: 1, cards: 1, note: 'rewrite ' + c.title });
    } catch (e) { L.log('rewrite failed:', e.message); }
  }
}

module.exports = { tick, TYPES };
