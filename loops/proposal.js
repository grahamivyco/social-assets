// Proposal loop (hourly). A lead moves to "consult held" (Leads tab, set by the lead follow-up "We met" card)
// -> local AI reads the call notes and picks the plan from the rate card -> self-check (plan must exist, every price comes
// from the rate card below and never from the AI, copy rules) -> Open Frame proposal page on GitHub Pages
// -> Hub email card "Send the proposal to <name>?" (Send / Edit / Don't send). Prices: rate card v2 (pricing memory).
const fs = require('fs'), path = require('path');
const L = require('./lib');

const PLANS = {
  Care: { price: 400, discount: false, what: '8 posts a month on 1 or 2 platforms made from the photos and news you send, Canva templates in your brand, a short monthly report' },
  Starter: { price: 1400, discount: true, what: '12 posts a month on 2 platforms, written and designed for you, profile upkeep, monthly report and a 20-minute check-in, 2 rounds of revisions' },
  Growth: { price: 2500, discount: true, what: '16 posts a month on 3 platforms, 4 short videos, 1 email newsletter, comment and DM replies 3 times a week, monthly report and a 30-minute call, 2 rounds of revisions' },
  'Full Comms': { price: 3800, discount: true, what: '24 posts a month on 4 platforms, 6 short videos, 2 newsletters, 1 campaign per quarter, comment and DM replies 3 times a week, monthly call and quarterly planning' },
};
// Rate card v2: https://claude.ai/artifact/N8HjkfKWfKrUkx1LSJ5kow (10% off for 501(c)(3)s, not on Care; setup $950 or $855).
const SETUP = 950, SETUP_NP = 855, FILE = path.join(L.STATE, 'proposals.json');
const OUT = { type: 'object', additionalProperties: false, required: ['plan', 'why', 'goals', 'first30', 'nonprofit'],
  properties: { plan: { type: 'string', enum: Object.keys(PLANS) }, why: { type: 'string' }, goals: { type: 'array', items: { type: 'string' } },
    first30: { type: 'array', items: { type: 'string' } }, nonprofit: { type: 'boolean' } } };
const money = n => '$' + n.toLocaleString('en-US');

async function draft(lead, why) {
  return L.ask(`Draft the core of a proposal from Graham at Open Frame (design and marketing for mission-driven organizations) for ${lead.name || 'a lead'}${lead.org ? ` at ${lead.org}` : ''}.
Call notes and history: ${lead.notes || '(none)'}
Plans: ${Object.entries(PLANS).map(([k, v]) => `${k}: ${v.what}`).join('; ')}.
Pick the smallest plan that fits what they said. why: 1-2 plain sentences tied to what they said. goals: 3 short goals in their words.
first30: 3 concrete things done in the first 30 days. nonprofit: true only if they are a 501(c)(3).
Never write prices or numbers you weren't given. No em dashes, no hype words.${why ? `\nLast try failed the check: ${why}` : ''}`, OUT, 0.4);
}

async function tick() {
  const done = L.readJSON(FILE, {});
  const leads = (await L.hub('leads-list', { stages: ['consult held'] })).rows.filter(l => !done[l.id]);
  for (const lead of leads) {
    let p = null, why = '';
    for (let i = 0; i < 2 && !p; i++) {
      const o = await draft(lead, why);
      const text = [o.why, ...o.goals, ...o.first30].join('\n');
      const broke = L.rules(text, { maxWords: 220 });
      if (/\$\s?\d/.test(text)) broke.push('wrote a price');
      if (o.goals.length < 2 || o.first30.length < 2) broke.push('too few goals or steps');
      if (broke.length) why = broke.join(', '); else p = o;
    }
    if (!p) { await L.logRun({ loop: 'proposal', client: 'open-frame', status: 'check', made: 2, kept: 0, cards: 0, note: `${lead.id}: ${why}` }); done[lead.id] = 'failed'; continue; }
    const plan = PLANS[p.plan], np = p.nonprofit && plan.discount, monthly = np ? Math.round(plan.price * 0.9) : plan.price, setup = p.nonprofit ? SETUP_NP : SETUP;
    const first = (lead.name || '').split(' ')[0];
    const html = L.page(`Proposal for ${lead.org || lead.name}`, `
<div><div class="mute">Proposal for ${L.esc(lead.org || lead.name)}</div><h1>The <i>${L.esc(p.plan)}</i> plan</h1></div>
<p>${L.esc(p.why)}</p>
<div class="card"><h2>What you said matters most</h2><ul>${p.goals.map(g => `<li>${L.esc(g)}</li>`).join('')}</ul></div>
<div class="card"><h2>First 30 days</h2><ol>${p.first30.map(g => `<li>${L.esc(g)}</li>`).join('')}</ol></div>
<div class="card"><div class="price">${money(monthly)}<span class="mute" style="font:16px Inter"> a month${np ? ' (10% nonprofit rate)' : ''}</span></div>
<p class="mute">${L.esc(plan.what)}. One-time setup ${money(setup)}: voice guide, profile cleanup, a 90-day calendar, your approval page and a walkthrough call. 3-month minimum, billed on the 1st, then 30 days' notice.</p></div>
<p>To say yes, reply to the email this came in. I'll send the welcome steps the same day.</p>
<p><a class="btn" href="https://calendly.com/grahamivy-co/30min">Questions? Book 15 minutes</a></p>`);
    const url = L.publish(`proposals/${L.token(16)}`, { 'index.html': html }, 'Loops: proposal page');
    const body = `Hi ${first || 'there'},\n\nThanks for the call. Here's the plan I'd suggest, with what happens in the first 30 days:\n\n${url}\n\nReply here with any questions, or a yes and I'll send the welcome steps.\n\nGraham\nOpen Frame`;
    await L.hub('add', { rows: [{ id: `proposal-${L.slug(lead.id)}`, loop: 'proposal', client: 'open-frame', kind: 'proposal email', title: `Proposal for ${lead.org || lead.name}`,
      to: lead.email || '', subject: `Your plan from Open Frame`, body, why: `${p.plan} plan, ${money(monthly)}/mo. Page: ${url}`, link: url,
      status: lead.email ? 'card' : 'todo', ask: lead.email ? 'Send the proposal? Open the page first if you want to check it.' : 'No email on file. Send this link yourself.' }] });
    done[lead.id] = url;
    await L.logRun({ loop: 'proposal', client: 'open-frame', status: 'ok', made: 1, kept: 1, cards: 1, note: `${lead.id} ${p.plan}` });
  }
  fs.writeFileSync(FILE, JSON.stringify(done, null, 2));
}

module.exports = { tick, PLANS };
