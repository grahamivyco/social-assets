// Onboarding loop (daily 9:00). A lead marked won (lead follow-up "Yes, they signed") starts the signed-client chain
// from the onboarding playbook: day 0 welcome (F), 3 next steps (G), 7 kickoff, 14 first review email, 30 first report,
// 60 results + testimonial ask (H), 90 review (I). Each step lands as one card on its day: emails as Send / Edit cards
// (local AI drafts from the step brief, self-checked), the rest as Got it reminders.
// Day 0 also adds the client to the Hub Clients tab and a switched-off block in clients.json, so every loop is ready for them.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const STEPS = [
  { day: 0, id: 'welcome', email: true, brief: 'Welcome. Thank them for saying yes. Next: the invoice comes separately, then a short intake form and a 30 minute kickoff call. Ask them to reply with good kickoff times this week.' },
  { day: 0, id: 'setup', brief: 'Send the invoice (setup + first month). Make their Start here page. Run the brand kit build.' },
  { day: 3, id: 'steps', email: true, brief: 'Friendly check on the open steps: intake form, logo files, a few photos, account access. One line on why each helps.' },
  { day: 7, id: 'kickoff', brief: 'Kickoff call this week. Agenda: goals, audience, voice, first month plan, how approvals work in their review page.' },
  { day: 14, id: 'review', email: true, brief: 'Their first posts are ready to review on their private page. Explain Approve / Request change / Skip in one line each.' },
  { day: 30, id: 'report', brief: 'First monthly report goes out on the 2nd. Check it reads well for a beginner.' },
  { day: 60, id: 'results', email: true, brief: 'Share 2 results so far in plain words (leave [result] slots for Graham to fill), then ask for a 2 sentence testimonial they are happy to have shared.' },
  { day: 90, id: 'quarter', email: true, brief: 'Three months in. Offer a 20 minute review call: what is working, what to change, what next quarter looks like.' },
];
// Day 0 asks the client for what the first month needs, as Approvals rows (kind request: Upload / Not yet) on their Studio page.
// Upload -> a Got it card to look in the Content Inbox. Not yet -> asked once more a week later.
const ASKS = [
  { id: 'logo', title: 'Your logo files', detail: 'The original logo files (SVG, AI, EPS or a large PNG) so every post and page uses the real thing.' },
  { id: 'photos', title: 'A few photos', detail: 'Ten or so photos of your people, space or work. Phone photos are fine.' },
  { id: 'access', title: 'Access to your accounts', detail: 'Add hello@openframe.design to your Instagram, Facebook and website so I can post and fix things for you.' },
];
const FILE = path.join(L.STATE, 'onboarding.json');
const MAIL = { type: 'object', additionalProperties: false, required: ['subject', 'body'], properties: { subject: { type: 'string' }, body: { type: 'string' } } };

async function email(lead, step) {
  let why = '';
  for (let i = 0; i < 2; i++) {
    const m = await L.ask(`Write a short email from Graham at Open Frame to ${lead.name || 'a new client'}${lead.org ? ` at ${lead.org}` : ''}, a new client.
Purpose: ${step.brief}
Under 120 words. Warm, plain, first person singular (Graham is a studio of one, so "I" not "we"). Sign off "Graham". No em dashes, no hype words.${why ? `\nLast try failed the check: ${why}` : ''}`, MAIL, 0.5);
    const broke = L.rules(m.body, { maxWords: 140 }).filter(x => x !== 'opens with a question');
    if (/\bwe\b|\bour\b/i.test(m.body)) broke.push('used we/our');
    if (!broke.length) return m;
    why = broke.join(', ');
  }
  return null;
}

async function run() {
  L.pull();
  const state = L.readJSON(FILE, {});
  const won = (await L.hub('leads-list', { stages: ['won'] })).rows;
  for (const lead of won) {
    let s = state[lead.id];
    if (!s) {
      const slug = L.slug(lead.org || lead.name || lead.id);
      s = state[lead.id] = { start: L.today(), slug, done: [] };
      const cf = path.join(L.HERE, 'clients.json'), clients = L.readJSON(cf, {});
      if (!clients[slug]) {
        clients[slug] = { enabled: false, _why_off: 'New client from onboarding. Fill in the brief, then set enabled: true.', name: lead.org || lead.name,
          audience: '', promise: '', pillars: [], formats: ['photo post', 'carousel'], cta: '', voice: '', first_person_ok: true };
        fs.writeFileSync(cf, JSON.stringify(clients, null, 2) + '\n');
      }
      if (lead.email) await L.hub('client-add', { client: lead.org || lead.name, brand: slug, contact_email: lead.email });
      const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      await L.approval(ASKS.map(a => ({ id: `onboard-${slug}-${a.id}`, client: slug, kind: 'request', title: a.title, detail: a.detail,
        due, client_ok: 'yes', made_by: 'onboard', status: 'client' })));
    }
    const age = Math.floor((Date.now() - new Date(s.start)) / 864e5);
    for (const step of STEPS.filter(x => x.day <= age && !s.done.includes(x.id))) {
      const id = `onboard-${s.slug}-${step.id}`;
      if (step.email && lead.email) {
        const m = await email(lead, step);
        if (!m) { await L.logRun({ loop: 'onboard', client: s.slug, status: 'check', made: 2, kept: 0, cards: 0, note: `${step.id} failed the check` }); continue; }
        await L.hub('add', { rows: [{ id, loop: 'onboard', client: s.slug, kind: 'onboarding email', title: `${lead.org || lead.name}: day ${step.day}`, to: lead.email, subject: m.subject, body: m.body }] });
      } else {
        await L.hub('add', { rows: [{ id, loop: 'onboard', client: s.slug, kind: 'onboarding', status: 'todo', title: `${lead.org || lead.name}: day ${step.day}`, body: step.brief, ask: '' }] });
      }
      s.done.push(step.id);
      await L.logRun({ loop: 'onboard', client: s.slug, status: 'ok', made: 1, kept: 1, cards: 1, note: step.id });
    }
  }
  await followAsks(state);
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n');
  L.pushState('Loops: onboarding', ['loops/clients.json']);
}

// The answers to the day 0 asks. Upload -> Got it card for Graham. Not yet -> one more ask after 7 days, then a Got it card for Graham.
async function followAsks(state) {
  const rows = await L.approvals({ made_by: 'onboard', status: ['approved', 'skipped', 'changes'] });
  for (const r of rows) {
    const s = Object.values(state).find(x => r.id.startsWith(`onboard-${x.slug}-`));
    if (!s) continue;
    s.asks = s.asks || {};
    if (s.asks[r.id]) continue;
    if (r.status === 'approved') {
      await L.hub('add', { rows: [{ id: `${r.id}-in`, loop: 'onboard', client: s.slug, kind: 'onboarding', status: 'todo',
        title: `${r.client}: ${r.title.toLowerCase()} sent`, body: 'They said they uploaded it. Check the Content Inbox and file it in brands/' + s.slug + '/.' + (r.comment ? ' Their note: ' + r.comment : '') }] });
      s.asks[r.id] = 'in';
    } else if (/-again$/.test(r.id)) {
      await L.hub('add', { rows: [{ id: `${r.id}-you`, loop: 'onboard', client: s.slug, kind: 'onboarding', status: 'todo',
        title: `${r.client}: still waiting on ${r.title.toLowerCase()}`, body: 'Asked twice. Worth a quick call or a text.' + (r.comment ? ' Their note: ' + r.comment : '') }] });
      s.asks[r.id] = 'graham';
    } else if (Date.now() - new Date(r.updated || Date.now()) >= 7 * 864e5) {
      const base = ASKS.find(a => r.id.endsWith('-' + a.id));
      if (!base) continue;
      await L.approval({ id: `${r.id}-again`, client: s.slug, kind: 'request', title: base.title, detail: base.detail + ' Whenever you have a minute.',
        due: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), client_ok: 'yes', made_by: 'onboard', status: 'client' });
      s.asks[r.id] = 'asked again';
    }
  }
}

module.exports = { run };
