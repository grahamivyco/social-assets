// Boost check (2nd of the month, 10:00, after the monthly report). A post that did 3x a client's usual this month is worth
// putting money behind, so it becomes an ad_spend row in Approvals (always the client's call). Only for clients with
// boost_budget in clients.json (their usual boost, in dollars); no budget = never suggested.
// Approve spend -> a Got it card for Graham to set up the boost. No -> that post is never suggested again.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const BEAT = 3, MIN_POSTS = 6, DAYS = 7, FILE = path.join(L.STATE, 'boosts.json');

async function run() {
  L.pull();
  const seen = L.readJSON(FILE, {});
  for (const c of L.clients().filter(c => Number(c.boost_budget) > 0)) {
    const st = await L.hub('stats', { client: c.id, days: 30 });
    const best = st.top && st.top[0];
    if (!best || st.posts < MIN_POSTS || !st.median || best.score < BEAT * st.median || !best.url) {
      await L.logRun({ loop: 'boost', client: c.id, status: 'ok', made: 0, kept: 0, cards: 0, note: 'no standout post' });
      continue;
    }
    const id = `boost-${c.id}-${L.slug(best.id)}`;
    if (seen[id]) continue;
    const times = Math.round(best.score / st.median * 10) / 10;
    await L.approval({ id, client: c.id, kind: 'ad_spend', title: `Boost your ${best.published} post with $${Number(c.boost_budget)}`,
      detail: `It did ${times}x your usual this month. A ${DAYS}-day boost shows it to people like the ones who already liked it.`,
      preview: best.url, due: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), made_by: 'boost', status: 'draft' });
    seen[id] = 'asked';
    await L.logRun({ loop: 'boost', client: c.id, status: 'ok', made: 1, kept: 1, cards: 1, note: `${best.id} ${times}x` });
  }
  // Answers.
  for (const r of await L.approvals({ made_by: 'boost', status: ['approved', 'skipped', 'changes'] })) {
    if (seen[r.id] && seen[r.id] !== 'asked') continue;
    if (r.status === 'approved') {
      await L.hub('add', { rows: [{ id: `${r.id}-setup`, loop: 'boost', client: r.client, kind: 'boost', status: 'todo', link: r.preview,
        title: `${r.client} said yes: ${r.title.toLowerCase()}`, body: `Open the post, tap Boost, ${DAYS} days, audience "people like your followers". ${r.comment || ''}`.trim() }] });
      seen[r.id] = 'approved';
    } else seen[r.id] = 'no';
  }
  fs.writeFileSync(FILE, JSON.stringify(seen, null, 2) + '\n');
  L.pushState('Loops: boost check');
}

module.exports = { run };
