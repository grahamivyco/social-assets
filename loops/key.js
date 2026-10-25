// Key accounts loops. Graham (2026-10-21): a few important followers beat a big count. So these aim at the right people
// (Targets tab: ideal clients, partners, peers), and measure key accounts reached, not followers.
//   radar (weekdays 12:00): a key account commented, DMed or keeps showing up this week -> card with a follow-up DM draft.
//   spotlight (Wednesdays 10:00): one mission-driven org a week gets a Thursday spotlight draft built from their own recent posts,
//     plus a DM asking their OK. Yes -> approved-ideas backlog (monthly plan) + "ask them first" card. Being featured is the
//     strongest reason for an org to follow and share.
// Engagement drafts already go to key accounts' freshest posts first (Hub engage-list sort).
const fs = require('fs'), path = require('path');
const L = require('./lib');

const TEXT = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
const SPOT = { type: 'object', additionalProperties: false, required: ['title', 'slides', 'caption', 'dm'],
  properties: { title: { type: 'string' }, slides: { type: 'array', items: { type: 'string' } }, caption: { type: 'string' }, dm: { type: 'string' } } };

async function radar() {
  const c = L.clients()[0];
  const { touches = [], accounts = [] } = await L.hub('key-accounts', { client: c.id });
  const have = new Set((await L.hub('list', { loop: 'key' })).rows.map(r => r.id));
  const by = {};
  touches.forEach(t => (by[t.handle] = by[t.handle] || []).push(t));
  let cards = 0;
  for (const [handle, ts] of Object.entries(by)) {
    const id = `key-${L.slug(handle)}-${L.today().slice(0, 7)}-${Math.ceil(new Date().getDate() / 7)}`;   // at most one card per account per week
    if (have.has(id)) continue;
    const a = accounts.find(x => x.handle === handle) || {};
    const { text } = await L.ask(`@${handle}${a.name ? ` (${a.name})` : ''} is one of Graham's key accounts (a mission-driven org he'd love to work with). This week they wrote:
${ts.map(t => `- (${t.kind}) ${t.text}`).join('\n')}
Write a short DM from Graham that continues the conversation: thank them for something specific, then one easy question about their work. 2 sentences, warm, no pitch, no link, no em dashes.`, TEXT, 0.6);
    if (L.rules(text).length) continue;
    await L.hub('add', { rows: [{ id, loop: 'key', client: c.id, kind: 'key account', status: 'todo', title: `@${handle} reached out`,
      body: `${ts.length} time${ts.length === 1 ? '' : 's'} this week${a.stage ? ` · stage: ${a.stage}` : ''}\n"${ts[ts.length - 1].text}"\n\nDM draft:\n${text}`,
      link: `https://www.instagram.com/${handle}/`, ask: 'Key account. Reply today while it is warm.' }] });
    cards++;
  }
  await L.logRun({ loop: 'key', client: c.id, status: 'ok', made: Object.keys(by).length, kept: cards, cards, note: `${touches.length} touches from ${Object.keys(by).length} key accounts this week` });
}

async function spotlight() {
  L.pull();
  const c = L.clients()[0];
  const file = path.join(L.STATE, c.id, 'spotlights.json'), done = L.readJSON(file, {});
  // Answers from earlier spotlight cards: Yes -> backlog + ask-first DM card. Pass -> never again.
  const rows = (await L.hub('list', { loop: 'spotlight' })).rows;
  for (const r of rows.filter(r => r.kind === 'spotlight' && ['yes', 'change', 'pass'].includes(r.status))) {
    const h = r.id.slice(`spot-${c.id}-`.length);
    if (r.status === 'pass') { done[h] = 'passed'; await L.hub('set', { id: r.id, fields: { status: 'used' } }); continue; }
    const backlog = path.join(L.STATE, c.id, 'backlog.md');
    fs.mkdirSync(path.dirname(backlog), { recursive: true });
    fs.appendFileSync(backlog, `- ${L.today()} ${r.title} (Thu mission-driven spotlight · carousel) Ask first: ${r.link}${r.note ? ` Note: ${r.note}` : ''}\n`);
    const dm = (r.body.split('DM to ask first:\n')[1] || '').trim();
    await L.hub('add', { rows: [{ id: r.id.replace(/^spot-/, 'spotask-'), loop: 'spotlight', client: c.id, kind: 'ask first', status: 'todo', title: `Ask before featuring: ${r.title}`,
      body: dm, link: r.link, ask: 'Send this DM from the app. The post goes in next month\'s plan once they say yes.' }] });
    await L.hub('set', { id: r.id, fields: { status: 'used' } });
    done[h] = 'approved';
  }
  // This week's pick: a key account not featured yet, with enough of their own posts to write from.
  const { accounts = [] } = await L.hub('key-accounts', { client: c.id });
  const pick = accounts.find(a => !done[a.handle] && a.posts.length >= 2);
  let cards = 0, why = '';
  if (pick) {
    let s = null;
    for (let i = 0; i < 2 && !s; i++) {
      const o = await L.ask(`Draft a "mission-driven spotlight" carousel for ${c.name}'s Instagram about @${pick.handle}${pick.name ? ` (${pick.name})` : ''}.
Use only facts from their own recent posts:
${pick.posts.map(p => `- ${p}`).join('\n')}
slides: 4 short slide texts (what they do, one real example from the posts, why it matters, "follow @${pick.handle}"). caption: 2 short lines crediting them, tag @${pick.handle}.
dm: a short DM from Graham asking if they're OK being featured this week, warm, 2 sentences, no pitch.
Never invent numbers, names or quotes. No em dashes, no hype words.${why ? `\nLast try failed the check: ${why}` : ''}`, SPOT, 0.5);
      const broke = L.rules([o.title, ...o.slides, o.caption, o.dm].join('\n'));
      if (!o.caption.includes('@' + pick.handle)) broke.push('caption must tag them');
      if (o.slides.length < 3) broke.push('too few slides');
      if (broke.length) why = broke.join(', '); else s = o;
    }
    if (s) {
      await L.hub('add', { rows: [{ id: `spot-${c.id}-${pick.handle}`, loop: 'spotlight', client: c.id, kind: 'spotlight', title: s.title,
        body: `Slides:\n${s.slides.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nCaption:\n${s.caption}\n\nDM to ask first:\n${s.dm}`,
        why: `@${pick.handle} is a key account${pick.stage ? ` (${pick.stage})` : ''}. Featuring them is the best reason for them to follow and share.`,
        link: `https://www.instagram.com/${pick.handle}/`, ask: 'Spotlight them? Yes queues the post and a DM asking their OK first.' }] });
      done[pick.handle] = 'card'; cards = 1;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(done, null, 2) + '\n');
  await L.logRun({ loop: 'spotlight', client: c.id, status: 'ok', made: pick ? 1 : 0, kept: cards, cards, note: pick ? `${pick.handle}${cards ? '' : ` failed the check: ${why}`}` : 'no key account with 2+ recent posts' });
  L.pushState('Loops: spotlight');
}

module.exports = { radar, spotlight };
