// Engagement loop (weekdays, after the 7:00 outreach scout). Free: LM Studio + the Hub.
// New posts in the Engage tab -> local AI drafts a comment in the playbook voice (learning from how you edited past ones)
// -> self-check (rules, 2 sentences, no links / hashtags / pitch, max one emoji, one retry) -> Engage row "drafted",
// which the Hub already shows as a "Copy and open" card. Sensitive posts (grief, crisis, politics) are skipped.
// Someone you've commented on 3+ times in 2 weeks gets a "they're warm" card with a DM draft.
// How many it drafts a day comes from state/targets.json, which the leads loop tunes from the pipeline.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const DRAFT = { type: 'object', additionalProperties: false, required: ['skip', 'comment'],
  properties: { skip: { type: 'boolean' }, comment: { type: 'string' } } };
const DM = { type: 'object', additionalProperties: false, required: ['dm'], properties: { dm: { type: 'string' } } };
const LATER = ['dm sent', 'replied', 'call booked', 'client', 'pass'];

function commentRules(text) {
  const t = String(text || ''), out = L.rules(t, { maxWords: 45 });
  if ((t.match(/[.!?](\s|$)/g) || []).length > 2) out.push('more than 2 sentences');
  if (/https?:|www\.|#\w/.test(t)) out.push('link or hashtag');
  if ((t.match(/\p{Extended_Pictographic}/gu) || []).length > 1) out.push('more than one emoji');
  if (/open frame|our services|book a|consult|dm me|check out/i.test(t)) out.push('pitch');
  return out.filter(x => x !== 'opens with a question');  // a real question is fine in a comment
}

function prompt(p, edits, why) {
  return `Write one Instagram comment from Graham (Open Frame, a design and marketing studio for mission-driven organizations) on this post by @${p.handle}.

Post caption:
${p.caption || '(no caption)'}

Rules: 1 or 2 sentences. Name one specific detail from the post. No pitch, no links, no hashtags, at most one emoji. About a third of the time ask a real question. Warm and plain, like a person. No em dashes.
If the post is about grief, a crisis, illness, death or politics, set skip to true and leave comment empty.
${edits.length ? `\nHow Graham rewrote earlier drafts (match his version):\n${edits.map(e => `- draft: ${e.ai}\n  his: ${e.sent}`).join('\n')}` : ''}${why ? `\n\nLast try failed the check: ${why}. Fix that.` : ''}`;
}

async function run() {
  const client = L.clients().find(c => c.engage);
  if (!client) return;
  const targets = L.readJSON(path.join(L.STATE, 'targets.json'), { commentsPerDay: 15 });
  const data = await L.hub('engage-list', { limit: targets.commentsPerDay });
  let drafted = 0, skipped = 0, failed = 0;
  for (const p of data.fresh) {
    let ok = null, why = '';
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      const out = await L.ask(prompt(p, data.edits || [], why), DRAFT, 0.7);
      if (out.skip) { ok = { skip: true }; break; }
      const broke = commentRules(out.comment);
      if (broke.length) why = broke.join(', '); else ok = out;
    }
    if (ok && ok.skip) { await L.hub('engage-set', { post_id: p.post_id, fields: { status: 'skip' } }); skipped++; }
    else if (ok) { await L.hub('engage-set', { post_id: p.post_id, fields: { draft_comment: ok.comment, ai_comment: ok.comment, status: 'drafted' } }); drafted++; }
    else failed++;   // stays "new", tried again tomorrow
  }

  // Warm prospects: 3+ comments sent in 14 days and not yet at the DM stage.
  const have = new Set((await L.hub('list', { loop: 'engage' })).rows.map(r => r.id));
  const warm = Object.entries(data.sent || {}).filter(([h, n]) => n >= 3 && !h.startsWith('#') && !LATER.includes(String((data.stage || {})[h] || '').toLowerCase()));
  let cards = 0;
  for (const [handle] of warm) {
    const id = `warm-${L.slug(handle)}`;
    if (have.has(id)) continue;
    const post = data.fresh.find(p => p.handle === handle);
    const { dm } = await L.ask(`Write a short Instagram DM from Graham (Open Frame, design and marketing for mission-driven organizations) to @${handle}. He has commented on their posts a few times.
Open with something specific about their work${post ? ` (recent post: ${post.caption.slice(0, 200)})` : ''}, then one soft question about how marketing is going for them. 2 to 3 sentences. No pitch, no link, no em dashes.`, DM, 0.6);
    if (L.rules(dm).length) continue;
    await L.hub('add', { rows: [{ id, loop: 'engage', client: client.id, kind: 'warm lead', status: 'todo', title: `@${handle} is warm`,
      body: `You've commented 3+ times in 2 weeks. DM draft:\n\n${dm}`, link: `https://www.instagram.com/${handle.replace(/^@/, '')}/`,
      ask: 'Send this DM from the app, then set their stage to DM sent on Targets.' }] });
    cards++;
  }
  await L.logRun({ loop: 'engage', client: client.id, status: failed && !drafted ? 'check' : 'ok', made: data.fresh.length, kept: drafted, cards,
    note: `${skipped} skipped as sensitive, ${failed} failed the check, ${data.sentToday} sent today` });
  L.log(`engage: ${drafted} drafted, ${skipped} skipped, ${failed} failed, ${cards} warm`);
}

module.exports = { run, commentRules };
