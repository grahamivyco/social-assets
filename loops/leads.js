// Leads loop (Mondays 8:00). Reads last week's pipeline (comments sent, new leads, consults, wins) against the $4k plan
// (about 3 new conversations and 1 consult a week) and tunes the engagement loop:
//   - behind on leads and you sent most drafts -> draft 5 more comments a day (max in targets.json)
//   - you sent under half the drafts -> 5 fewer a day, so the pile never grows
// Then one "Pipeline this week" card (incl. key accounts that engaged) says what happened and what it changed. Lead follow-ups themselves stay in
// the n8n "Open Frame lead follow-up" workflow (business ops thread); this loop only watches and tunes.
const fs = require('fs'), path = require('path');
const L = require('./lib');

async function run() {
  L.pull();
  const file = path.join(L.STATE, 'targets.json'), t = L.readJSON(file, {});
  const f = await L.hub('funnel');
  const drafted = t.commentsPerDay * 5, keptUp = f.comments >= drafted * 0.5, behind = f.newLeads < t.weekly.newLeads || f.consults < t.weekly.consults;
  const before = t.commentsPerDay;
  if (!keptUp) t.commentsPerDay = Math.max(t.minComments, before - 5);
  else if (behind) t.commentsPerDay = Math.min(t.maxComments, before + 5);
  const change = t.commentsPerDay === before ? `Comment drafts stay at ${before} a day.`
    : t.commentsPerDay > before ? `Behind on new conversations, so drafts go up to ${t.commentsPerDay} a day.`
    : `You sent ${f.comments} of about ${drafted} drafts, so drafts drop to ${t.commentsPerDay} a day.`;
  fs.writeFileSync(file, JSON.stringify(t, null, 2) + '\n');

  // Key accounts reached matter more than follower count (Graham, 2026-10-21).
  const k = await L.hub('key-accounts', { client: 'open-frame' }).catch(() => ({}));
  const reached = new Set((k.touches || []).map(x => x.handle)).size;
  const won = f.stages.won || 0;
  const body = [`Comments sent: ${f.comments} (goal ${t.weekly.comments})`, `New leads: ${f.newLeads} (goal ${t.weekly.newLeads})`,
    `Key accounts that engaged: ${reached} of ${(k.accounts || []).length}`, `Consults: ${f.consults} (goal ${t.weekly.consults})`, `Won this week: ${f.won}. Clients so far: ${won} of about 4 for $4k/month.`, '', change].join('\n');
  await L.hub('add', { rows: [{ id: `leads-week-${L.today()}`, loop: 'leads', client: 'open-frame', kind: 'pipeline', status: 'todo',
    title: 'Pipeline this week', body, ask: '' }] });
  await L.logRun({ loop: 'leads', client: 'open-frame', status: 'ok', made: 1, kept: 1, cards: 1,
    note: `comments ${f.comments}, key ${reached}, leads ${f.newLeads}, consults ${f.consults}, won ${f.won}; drafts/day ${before} -> ${t.commentsPerDay}` });
  L.pushState('Loops: weekly pipeline');
}

module.exports = { run };
