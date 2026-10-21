// Brand + UGC deals loop (weekdays 10:30; step 3 of the brand deals agent). Reads the Brands tab that the n8n brand scout
// (Mon 6:00) and contact finder (Mon 7:00) fill. Two kinds of deal:
//   UGC: the brand pays for videos it posts on its own channels. Needs no big following, so it is the default today.
//   Sponsored: a paid post on Open Frame's account. Only pitched when the brand already works with small creators.
// Each run: up to 3 best-fit brands -> local AI picks the angle + drafts the pitch -> self-check -> card:
//   has a creator program page -> "Apply here" card (fastest route), has an email -> Send / Edit email card, neither -> skipped.
// Then: sent -> Brands status pitched; Pass -> skip; 7 days with no reply -> one follow-up card, then stop.
// Pitches link the UGC page (social-assets ugc/) and the Instagram profile. Never quotes a price in writing.
const L = require('./lib');

const PER_RUN = 3, UGC_PAGE = `${L.PAGES}/ugc/`, IG = 'https://www.instagram.com/open.framedesign/';
const PITCH = { type: 'object', additionalProperties: false, required: ['kind', 'subject', 'body', 'ideas'],
  properties: { kind: { type: 'string', enum: ['ugc', 'sponsored'] }, subject: { type: 'string' }, body: { type: 'string' }, ideas: { type: 'array', items: { type: 'string' } } } };

async function draft(b, why) {
  return L.ask(`Write a short pitch email from Graham Ivy (Open Frame, a design and marketing studio in Minneapolis and Barcelona that makes short videos for mission-driven brands) to ${b.name} (@${b.handle}).
About them: ${b.bio || '(no bio)'} ${b.website || ''}. Why they fit: ${b.why || b.fit}. They have worked with ${b.creators_seen || 'some'} creators.
kind: "ugc" (videos they post on their own channels) unless they clearly sponsor small creators' posts, then "sponsored".
ideas: 3 specific video ideas for their product or mission, under 12 words each.
body: under 120 words. One specific line about them, what Graham makes, the 3 ideas as a short list, a link line "${UGC_PAGE}", and one easy ask (a 15 minute call or "want a sample?"). Sign off "Graham".
No prices, no follower counts, no em dashes, no hype words.${why ? `\nLast try failed the check: ${why}` : ''}`, PITCH, 0.6);
}

async function run() {
  const now = Date.now(), cards = (await L.hub('list', { loop: 'deals' })).rows;
  // 1. Answers on earlier cards.
  for (const r of cards.filter(r => ['sent', 'yes', 'done', 'pass'].includes(r.status) && !/-used$/.test(r.note || ''))) {
    const handle = r.id.replace(/^deal(fu)?-/, '');
    if (r.id.startsWith('dealfu-')) await L.hub('brand-set', { handle, fields: { followed_up: r.status === 'pass' ? 'not needed' : L.today() } });
    else if (r.status === 'pass') await L.hub('brand-set', { handle, fields: { status: 'skip' } });
    else await L.hub('brand-set', { handle, fields: { status: 'pitched', pitched_at: new Date().toISOString(), pitch_kind: r.kind } });
    await L.hub('set', { id: r.id, fields: { note: (r.note || '') + '-used' } });
  }
  const have = new Set(cards.map(r => r.id));
  // 2. One follow-up a week after the pitch, then stop.
  const pitched = (await L.hub('brands-list', { statuses: ['pitched'] })).rows;
  for (const b of pitched.filter(b => b.pitched_at && !b.followed_up && now - new Date(b.pitched_at) > 7 * 864e5 && b.contact_email && !have.has(`dealfu-${b.handle}`))) {
    await L.hub('add', { rows: [{ id: `dealfu-${b.handle}`, loop: 'deals', client: 'open-frame', kind: 'follow-up', title: `Follow up with ${b.name}`, to: b.contact_email,
      subject: `Re: video ideas for ${b.name}`, body: `Hi,\n\nFloating this back up in case it got buried. Happy to make a free sample video for ${b.name} so you can see the fit first.\n\n${UGC_PAGE}\n\nGraham`,
      ask: 'Send one follow-up? Pass if they already replied.' }] });
  }
  // 3. New pitches.
  const fresh = (await L.hub('brands-list', { statuses: ['new', 'pitch'] })).rows
    .filter(b => ['high', 'medium'].includes(b.fit) && (b.contact_email || b.program_url) && !have.has(`deal-${b.handle}`))
    .sort((a, b) => (a.fit === 'high' ? 0 : 1) - (b.fit === 'high' ? 0 : 1) || (Number(b.creators_seen) || 0) - (Number(a.creators_seen) || 0)).slice(0, PER_RUN);
  let made = 0;
  for (const b of fresh) {
    let p = null, why = '';
    for (let i = 0; i < 2 && !p; i++) {
      const o = await draft(b, why);
      const broke = L.rules(o.body, { maxWords: 150 }).filter(x => x !== 'opens with a question');
      if (/\$\s?\d|\bfollowers?\b/i.test(o.body)) broke.push('price or follower count');
      if (!o.body.includes(UGC_PAGE)) broke.push('missing the UGC page link');
      if (broke.length) why = broke.join(', '); else p = o;
    }
    if (!p) { await L.logRun({ loop: 'deals', client: 'open-frame', status: 'check', made: 2, kept: 0, cards: 0, note: `${b.handle}: ${why}` }); continue; }
    const label = p.kind === 'ugc' ? 'UGC' : 'Sponsored post';
    const row = { id: `deal-${b.handle}`, loop: 'deals', client: 'open-frame', kind: p.kind, title: `${label} pitch: ${b.name}`,
      why: `Fit ${b.fit}${b.why ? `: ${b.why}` : ''}. Ideas: ${p.ideas.join('; ')}` };
    if (b.program_url) Object.assign(row, { status: 'todo', link: b.program_url, body: `They have a creator program. Applying there is the fastest route.\n\nUse this as your pitch:\n\n${p.body}\n\nAlso on file: ${b.contact_email || 'no email'}`,
      ask: 'Open, apply, paste the pitch. Got it marks them pitched.' });
    else Object.assign(row, { to: b.contact_email, subject: p.subject, body: p.body, ask: `Send this ${label.toLowerCase()} pitch?` });
    await L.hub('add', { rows: [row] });
    made++;
  }
  await L.logRun({ loop: 'deals', client: 'open-frame', status: 'ok', made: fresh.length, kept: made, cards: made, note: fresh.map(b => b.handle).join(', ') });
}

module.exports = { run };
