// Scripts loop (every few minutes). Each idea you said Yes (or Change) to -> local AI writes a one-take script + caption
// -> self-check (rules, length, AI judge, one retry) -> saved to Scripts/ on the Mac and loops/state/scripts/
// -> script card on the Studio Reels tab (openframe.design/studio, Reels). Filming + AirDrop hands off to reel-watch (reels/), which makes the draft.
// Also keeps state/<client>/backlog.md: every approved idea, which the monthly content plan reads.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const SCRIPT = { type: 'object', additionalProperties: false, required: ['script', 'caption'],
  properties: { script: { type: 'string' }, caption: { type: 'string' } } };

function parse(card) {
  const [head, ...rest] = String(card.body || '').split('\n');
  const [slot, format] = head.split(' · ');
  const hook = (rest.find(l => l.startsWith('Hook: ')) || '').slice(6);
  return { slot, format, hook, angle: rest.filter(l => l && !l.startsWith('Hook: ')).join('\n') };
}

async function write(client, card) {
  const i = parse(card);
  const vars = { ...client, title: card.title, slot: i.slot, format: i.format, hook: i.hook, body: i.angle, note: card.note };
  const system = await L.voice(client, [card.title, i.hook, i.angle].join('. '));
  let why = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await L.ask(L.fill('script.md', vars) + (why ? `\n\nLast try failed the check: ${why}. Fix that.` : ''), SCRIPT, 0.7, { system });
    const broke = [...L.rules(out.script, { maxWords: 120, firstPersonOk: client.first_person_ok }), ...L.rules(out.caption, { firstPersonOk: client.first_person_ok })];
    if (!/https:\/\//.test(out.caption)) broke.push('caption has no full https link');
    if (broke.length) { why = broke.join(', '); continue; }
    const j = await L.judge(client, out.script);
    if (!j.ok) { why = j.reason; continue; }
    return { ...out, score: j.avg };
  }
  return { failed: why };
}

async function tick() {
  const cards = (await L.hub('list', { loop: 'ideas', status: ['yes', 'change'] })).rows;
  if (!cards.length) return;
  L.pull();
  const byId = Object.fromEntries(L.clients().map(c => [c.id, c]));
  for (const card of cards) {
    const client = byId[card.client];
    if (!client) continue;
    let s;
    try { s = await write(client, card); } catch (e) { L.log('script failed:', e.message); continue; }  // retried next tick
    const backlog = path.join(L.STATE, client.id, 'backlog.md');
    fs.mkdirSync(path.dirname(backlog), { recursive: true });
    if (!fs.existsSync(backlog)) fs.writeFileSync(backlog, `# ${client.name} approved ideas\n\nWritten by loops/scripts.js. The monthly content plan picks from here first.\n\n`);
    fs.appendFileSync(backlog, `- ${L.today()} ${card.title} (${card.body.split('\n')[0]})${card.note ? ` Note: ${card.note}` : ''}\n`);

    await L.hub('set', { id: card.id, fields: { status: 'scripted' } });
    if (s.failed) {
      await L.logRun({ loop: 'scripts', client: client.id, status: 'check', made: 2, kept: 0, cards: 0, note: `${card.title}: ${s.failed}` });
      continue;
    }
    const audio = await require('./audio').pick(s.script);
    const name = `${L.today()}-${L.slug(card.title)}.md`;
    const md = `# ${card.title}\n\n${card.body}\n\n## Script\n\n${s.script}\n\n## Caption\n\n${s.caption}\n\n## Audio\n\n${audio}\n`;
    for (const dir of [path.join(L.C.scripts, client.name), path.join(L.STATE, client.id, 'scripts')]) {
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), md); } catch (e) { L.log('save failed:', e.message); }
    }
    await L.hub('add', { rows: [{ id: card.id.replace(/^ideas-/, 'script-'), loop: 'scripts', client: client.id, kind: 'of', status: 'ready',
      title: 'Film this: ' + card.title, body: `${s.script}\n\nCaption:\n${s.caption}\n\n${audio}`,
      ask: 'Film it in one take and AirDrop it. The Reel draft makes itself.' }] });
    await L.logRun({ loop: 'scripts', client: client.id, status: 'ok', made: 1, kept: 1, cards: 1, note: card.title });
    L.log(`script ${client.id}: ${card.title}`);
  }
  L.pushState('Loops: new scripts');
}

module.exports = { tick };
