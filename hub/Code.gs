/**
 * Open Frame Hub
 * One-card-at-a-time page for everything that needs Graham, a no-login review
 * page per client (opened from a private link emailed at each check-in that expires), and a weekly (or every-2-weeks) check-in email. Runs free in Google Apps Script, bound to the
 * "NGM social queue" Sheet. Reads and writes the same tabs n8n uses.
 *
 * Setup (once): paste this file into a new Apps Script project (or Extensions > Apps Script in the Sheet), run setup(),
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone),
 * then run emailMeMyLinks().
 */

const TZ = 'America/Chicago';
// The queue Sheet. Lets the script run as its own project or from Extensions > Apps Script in the Sheet.
const HUB_SHEET_ID = '1nec5cD5RtjV6yDLzxeKX9vGhI0k123PIaFFDwXqFM6A';
// The branded review page on Graham's site. It talks to this script through the api= links below.
const CLIENT_PAGE_URL = 'https://openframe.design/review/';
// This script's live web app link (Deploy > Manage deployments > Web app URL, ends in /exec).
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyBkDfWO-LghULYws9PCWUuqyga7kbGz2cat0w8tMIw09DmoEgtxBB7XprqRfCUyfGhpg/exec';
// Check-in: one email with everything that needs you. 1 = every week, 2 = every 2 weeks.
const CHECKIN_EVERY_WEEKS = 1;
const CHECKIN_DAY = 'MONDAY';
const CHECKIN_HOUR = 9;
// Between check-ins you only hear about things that can't wait: a failed post, posting that stopped, a DM (Meta closes replies after 24 hours).
const URGENT_HOUR = 8;
const OUTREACH_SHEET_ID = '1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU';
// Column names follow /mnt/project-files/automation/queue-schema.md. review_note is Graham's own note.
const QUEUE_EXTRA = ['client_decision', 'client_note', 'answered_by', 'decided_at', 'revision', 'review_note'];
const CLIENT_HEAD = ['client', 'brand', 'sheet_id', 'contact_email', 'client_approves', 'report_url'];
const STUCK_HOURS = 2;
// Client review links: a fresh private link per email, only for the address on file, that stops working after LINK_DAYS.
// Sending a new one switches off the older ones. Every approval is logged under the email it was sent to.
const LINK_DAYS = 14;
const LINK_HEAD = ['link', 'brand', 'email', 'created', 'expires', 'last_used'];
// At each check-in, email clients who have posts waiting (client_approves = yes and a contact_email).
const AUTO_SEND_CLIENTS = true;
const FROM_NAME = 'Open Frame';
// "Health" tab, written hourly by the n8n health-check workflow (thread "Workflow health check"):
// check | label | status (ok/warn/fail) | detail | since | updated_at | link | email
const HEALTH_MAC_CARD_HOURS = 3;
const HEALTH_MAC_EMAIL_HOURS = 20;
const REPLY_TO = 'hello@openframe.design';
// "Leads" tab in the outreach Sheet, written by the n8n "Open Frame lead follow-up" workflow (thread "Business ops automation and $4k goal").
// One open card per lead: kind email | dm | todo | ask_met | ask_signed, status drafted until you answer here.
// true = a lead card waiting is one of the things that can't wait (daily 8:00 email, only on days one is waiting).
const LEADS_URGENT = true;
const META_INBOX = 'https://business.facebook.com/latest/inbox/all';
// "Graphics" tab, written by the graphics idea loop on Graham's Mac (social-assets reels/graphics/loop.js, thread "Instagram profile like Gustavus").
// pitched -> Yes (approved) or Pass (passed) -> loop renders 3 stills (stills) -> pick A, B or C (picked) -> loop animates it (built, or check).
// "Loops" tab: cards from any loop in social-assets loops/ (thread "Self-running agent loops"). One contract for every loop:
// status card (Yes / Change / Pass) or todo (Got it) -> yes | change | pass | done -> the loop reads the answer and marks it used.
// "Loop runs" tab: one row per loop run (what it made, what passed its own check), read by the weekly improvement review.
// to + subject = an email card (Send sends it from your Gmail). when = 'start|end' ISO = a calendar card (Yes adds it to your calendar).
const LOOP_HEAD = ['id', 'loop', 'client', 'kind', 'title', 'body', 'why', 'ask', 'link', 'to', 'subject', 'when', 'status', 'note', 'created', 'updated'];
// "Check requests" tab: the free site + AI search check form (social-assets check/). The Mac runs the check and the Hub emails the result.
const CHECK_HEAD = ['id', 'at', 'name', 'org', 'email', 'site', 'status', 'score', 'report_url', 'note'];
const RUN_HEAD = ['at', 'loop', 'client', 'status', 'made', 'kept', 'cards', 'note'];
const GFX_HEAD = ['id', 'client', 'video', 'at', 'line', 'kind', 'params', 'idea', 'why_new', 'status', 'note', 'looks', 'pick', 'accent', 'checks', 'built', 'created', 'updated'];

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(HUB_SHEET_ID);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('HUB_ID', ss.getId());
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', token_(24));

  const q = table_(ss.getId(), 'Queue');
  QUEUE_EXTRA.forEach(h => { if (q.head.indexOf(h) < 0) addCol_(q, h); });

  let c = ss.getSheetByName('Clients');
  if (!c) {
    c = ss.insertSheet('Clients');
    c.getRange(1, 1, 1, CLIENT_HEAD.length).setValues([CLIENT_HEAD]).setFontWeight('bold');
    c.setFrozenRows(1);
    c.getRange(2, 1, 2, CLIENT_HEAD.length).setValues([
      ['Open Frame', 'open-frame', ss.getId(), '', 'no', ''],
      ['Needlework Guild of Minnesota', 'ngm', ss.getId(), '', 'yes', ''],
    ]);
  }
  linksTable_();

  ScriptApp.getProjectTriggers()
    .filter(t => ['morningDigest', 'checkIn', 'urgentCheck', 'healthCheck'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkIn').timeBased().onWeekDay(ScriptApp.WeekDay[CHECKIN_DAY]).atHour(CHECKIN_HOUR).inTimezone(TZ).create();
  ScriptApp.newTrigger('urgentCheck').timeBased().atHour(URGENT_HOUR).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('healthCheck').timeBased().everyHours(1).create();
  Logger.log('Setup done. Now deploy as a web app, then run emailMeMyLinks.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hub')
    .addItem('Email me my links', 'emailMeMyLinks')
    .addItem('Send check-in now', 'checkInNow')
    .addToUi();
}

function emailMeMyLinks() {
  if (!/\/exec$/.test(baseUrl_())) throw new Error('Paste the Web app URL (ends in /exec) into WEB_APP_URL at the top, save, then run this again.');
  const lines = ['Your check-in page. Bookmark it:', '', adminUrl_(), '',
    'Clients get their own private review link by email. Send one from the check-in page (Clients > Send review email), or it goes out on its own at each check-in when they have posts waiting.'];
  MailApp.sendEmail(me_(), 'Your Open Frame Check-in link', lines.join('\n'));
}

// ---------- web ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  const url = ScriptApp.getService().getUrl() || '';
  if (/\/exec$/.test(url)) PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', url);
  if (p.api) return api_(p);
  if (p.k && p.k === adminKey_()) return page_('Hub', ADMIN_HTML, { key: p.k, metaInbox: META_INBOX });
  if (p.c) {
    try {
      const c = clientByLink_(p.c);
      return page_(c.client + ' posts to review', CLIENT_HTML, { token: p.c, client: c.client });
    } catch (x) { /* falls through to the not-active note */ }
  }
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">This link is not active. Ask Open Frame for a new one.</p>');
}

// The graphics loop on Graham's Mac talks to the Hub here. Body: JSON { key, fn: 'graphics', action, ... }.
function doPost(e) {
  let out;
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.fn === 'check') return ContentService.createTextOutput(JSON.stringify(withLock_(() => checkRequest_(b)))).setMimeType(ContentService.MimeType.JSON);
    checkKey_(b.key);
    if (b.fn === 'graphics') out = withLock_(() => graphicsApi_(b));
    else if (b.fn === 'loops') out = withLock_(() => loopsApi_(b));
    else throw new Error('Unknown request');
  } catch (x) { out = { error: x.message || String(x) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function graphicsTable_() {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName('Graphics')) {
    const sh = ss.insertSheet('Graphics');
    sh.getRange(1, 1, 1, GFX_HEAD.length).setValues([GFX_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return table_(hubId_(), 'Graphics');
}

function graphicsApi_(b) {
  const t = graphicsTable_(), now = new Date().toISOString();
  if (b.action === 'list') return { rows: t.rows.filter(r => r.id) };
  if (b.action === 'add') {
    let added = 0;
    (b.rows || []).forEach(r => {
      if (!r.id || t.rows.some(x => x.id === r.id)) return;
      const row = Object.assign({}, r, { created: now, updated: now });
      t.sh.appendRow(t.head.map(h => { const v = row[h] == null ? '' : row[h]; return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }));
      t.rows.push(row); added++;
    });
    return { added };
  }
  if (b.action === 'set') {
    const r = findRow_(t, 'id', b.id);
    setCells_(t, r._row, Object.assign({}, b.fields || {}, { updated: now }));
    return { ok: true };
  }
  throw new Error('Unknown graphics action');
}

function hubTab_(name, head) {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName(name)) {
    const sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return table_(hubId_(), name);
}
const safeCell_ = v => (v == null ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);

// Public: anyone can ask for a free check from the form. Light limits so it can't be used to spam.
function checkRequest_(b) {
  if (b.website_hp) return { ok: true };   // honeypot field: bots fill it, people never see it
  const email = String(b.email || '').trim().toLowerCase(), site = String(b.site || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return { error: 'Please check your email address.' };
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(site)) return { error: 'Please enter your full website address, starting with https://' };
  const t = hubTab_('Check requests', CHECK_HEAD), day = new Date().toISOString().slice(0, 10);
  const today = t.rows.filter(r => String(r.at).slice(0, 10) === day);
  if (today.length >= 30 || today.filter(r => r.email === email).length >= 2) return { error: 'Your request is already in. Results come by email within a day.' };
  t.sh.appendRow(CHECK_HEAD.map(h => safeCell_({ id: token_(12), at: new Date().toISOString(), name: String(b.name || '').slice(0, 80), org: String(b.org || '').slice(0, 120),
    email, site: site.slice(0, 200), status: 'new' }[h])));
  return { ok: true };
}

// The check result email. Plain words, the score, the top 3 fixes, the full report link and the booking link.
function sendCheck_(r, score, fixes, url) {
  const lines = ['Hi' + (r.name ? ' ' + String(r.name).split(' ')[0] : '') + ',', '',
    'Your free website and AI search check for ' + r.site + ' is ready.', '', 'Score: ' + score + '/100', '',
    'The 3 fixes that matter most:', ...fixes.slice(0, 3).map((f, i) => (i + 1) + '. ' + f), '',
    'Full report:', '', url, '',
    'Want help with these? Book a free 30 minute call:', '', 'https://calendly.com/grahamivy-co/30min', '',
    'Graham', 'Open Frame', 'https://openframe.design'];
  MailApp.sendEmail({ to: r.email, subject: 'Your website check: ' + score + '/100', body: lines.join('\n'), replyTo: REPLY_TO, name: 'Graham at Open Frame' });
}

// Loops API. list: cards (optionally by loop and status). add: new cards, skips ids already there. set: change fields.
// log: one "Loop runs" row. stats: a client's best and weakest posts from the last `days` days (same score as the report).
function loopsApi_(b) {
  const now = new Date().toISOString();
  if (b.action === 'log') {
    const t = hubTab_('Loop runs', RUN_HEAD);
    t.sh.appendRow(t.head.map(h => safeCell_(h === 'at' ? now : b.run && b.run[h])));
    return { ok: true };
  }
  if (b.action === 'stats') {
    const c = clients_().find(x => x.brand === b.client);
    const pt = c && c.sheet_id ? table_(c.sheet_id, 'Post stats') : null;
    const since = new Date(Date.now() - (Number(b.days) || 30) * 864e5).toISOString().slice(0, 10);
    const rows = (pt ? pt.rows : []).filter(p => p.client === b.client && String(p.published_at).slice(0, 10) >= since && score_(p) != null)
      .sort((x, y) => score_(y) - score_(x))
      .map(p => ({ id: String(p.post_id || ''), url: p.permalink || '', platform: p.platform, type: p.type, published: String(p.published_at).slice(0, 10), caption: String(p.caption || '').slice(0, 200),
        reach: num_(p.reach), likes: num_(p.likes), comments: num_(p.comments), saves: num_(p.saves), shares: num_(p.shares), score: Math.round(score_(p)) }));
    return { posts: rows.length, top: rows.slice(0, 5), weakest: rows.length > 5 ? rows.slice(-3) : [] };
  }
  if (b.action === 'engage-list') {
    // New posts the scout found (Engage tab, outreach Sheet) + comments sent per handle in the last 14 days + Targets stage.
    const e = table_(OUTREACH_SHEET_ID, 'Engage'), tg = table_(OUTREACH_SHEET_ID, 'Targets');
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const sent = {};
    (e ? e.rows : []).filter(r => r.status === 'sent' && String(r.sent_at) >= since).forEach(r => { sent[r.handle] = (sent[r.handle] || 0) + 1; });
    const stage = {};
    (tg ? tg.rows : []).forEach(r => { if (r.handle) stage[String(r.handle).replace(/^@/, '')] = r.stage || ''; });
    const pick = r => ({ post_id: String(r.post_id), handle: r.handle, post_url: r.post_url, caption: String(r.caption || '').slice(0, 400) });
    return { fresh: (e ? e.rows : []).filter(r => r.post_id && r.status === 'new').slice(0, Number(b.limit) || 15).map(pick),
      edits: (e ? e.rows : []).filter(r => r.status === 'sent' && r.ai_comment && String(r.sent_at) >= since && r.ai_comment !== r.draft_comment)
        .slice(-10).map(r => ({ ai: r.ai_comment, sent: r.draft_comment })),
      sent, stage, sentToday: (e ? e.rows : []).filter(r => r.status === 'sent' && String(r.sent_at).slice(0, 10) === new Date().toISOString().slice(0, 10)).length };
  }
  if (b.action === 'engage-set') {
    const e = table_(OUTREACH_SHEET_ID, 'Engage'), r = findRow_(e, 'post_id', b.post_id);
    setCells_(e, r._row, b.fields || {});
    return { ok: true };
  }
  if (b.action === 'check-list') return { rows: hubTab_('Check requests', CHECK_HEAD).rows.filter(r => r.id && r.status === 'new') };
  if (b.action === 'check-done') {
    // Mac finished the check: email the result, add them to Leads (the n8n follow-up takes it from there), tell Graham.
    const t = hubTab_('Check requests', CHECK_HEAD), r = findRow_(t, 'id', b.id);
    if (b.failed) { setCells_(t, r._row, { status: 'failed', note: b.failed }); return { ok: true }; }
    sendCheck_(r, b.score, b.fixes || [], b.report_url);
    setCells_(t, r._row, { status: 'sent', score: b.score, report_url: b.report_url });
    const l = table_(OUTREACH_SHEET_ID, 'Leads'), id = 'em:' + r.email;
    if (l && !l.rows.some(x => x.id === id)) {
      const row = { id, added: new Date().toISOString(), source: 'site check', name: r.name, org: r.org, email: r.email, stage: 'talking',
        last_contact: new Date().toISOString(), notes: 'Ran the free site check: ' + b.score + '/100. ' + r.site + ' ' + b.report_url, updated_at: new Date().toISOString() };
      l.sh.appendRow(l.head.map(h => safeCell_(row[h])));
    }
    return { ok: true };
  }
  if (b.action === 'leads-list') {
    const l = table_(OUTREACH_SHEET_ID, 'Leads');
    return { rows: (l ? l.rows : []).filter(r => r.id && (!b.stages || b.stages.indexOf(r.stage) >= 0))
      .map(r => ({ id: r.id, name: r.name, org: r.org, email: r.email, handle: r.handle, stage: r.stage, source: r.source, notes: r.notes,
        consult_at: String(r.consult_at || ''), updated_at: String(r.updated_at || '') })) };
  }
  if (b.action === 'client-add') {
    const t = table_(hubId_(), 'Clients');
    if (t && !t.rows.some(r => r.brand === b.brand)) {
      const row = { client: b.client, brand: b.brand, contact_email: b.contact_email, client_approves: 'yes' };
      t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
      return { added: 1 };
    }
    return { added: 0 };
  }
  if (b.action === 'people') {
    // Who keeps showing up in a client's comments and DMs (Inbox tab), last 30 days. For the warm-up loop.
    const c = clients_().find(x => x.brand === b.client), t = c ? table_(c.sheet_id, 'Inbox') : null, by = {};
    (t ? t.rows : []).filter(r => within_(r.received_at || r.timestamp, 30)).forEach(r => {
      const who = r.username || r.sender_name || r.sender; if (!who) return;
      const p = by[who] || (by[who] = { who, count: 0, kinds: [], last: '' });
      p.count++; if (p.kinds.indexOf(r.kind || 'dm') < 0) p.kinds.push(r.kind || 'dm'); p.last = String(r.text || '').slice(0, 200);
    });
    return { people: Object.keys(by).map(k => by[k]).sort((x, y) => y.count - x.count) };
  }
  if (b.action === 'retention') {
    // Per client: results now vs last month, posts stuck waiting on them, days since they last answered.
    return { clients: clients_().filter(c => c.client_approves).map(c => {
      const q = table_(c.sheet_id, 'Queue'), rows = q ? q.rows.filter(r => r.brand === c.brand) : [];
      const waiting = rows.filter(r => r.status === 'in_review' && r.review_deadline && new Date(r.review_deadline) < new Date()).length;
      const last = rows.map(r => r.decided_at).filter(Boolean).map(d => new Date(d).getTime()).sort().pop();
      return { client: c.client, brand: c.brand, results: results_(c), overdue: waiting, daysSinceAnswer: last ? Math.round((Date.now() - last) / 864e5) : null };
    }) };
  }
  if (b.action === 'results') { const c = clients_().find(x => x.brand === b.client); return c ? results_(c) : { empty: true }; }
  if (b.action === 'funnel') {
    // Last 7 days of the pipeline (Engage + Leads tabs) and where every lead sits now.
    const e = table_(OUTREACH_SHEET_ID, 'Engage'), l = table_(OUTREACH_SHEET_ID, 'Leads');
    const since = new Date(Date.now() - 7 * 864e5).toISOString(), leads = l ? l.rows.filter(r => r.id) : [];
    const stages = {};
    leads.forEach(r => { const st = r.stage || 'talking'; stages[st] = (stages[st] || 0) + 1; });
    const inWeek = v => v && String(v instanceof Date ? v.toISOString() : v) >= since;
    return { comments: (e ? e.rows : []).filter(r => r.status === 'sent' && inWeek(r.sent_at)).length,
      newLeads: leads.filter(r => inWeek(r.added)).length,
      consults: leads.filter(r => inWeek(r.consult_at)).length,
      won: leads.filter(r => r.stage === 'won' && inWeek(r.updated_at)).length, stages };
  }
  const t = hubTab_('Loops', LOOP_HEAD);
  if (b.action === 'list') return { rows: t.rows.filter(r => r.id && (!b.loop || r.loop === b.loop) && (!b.status || [].concat(b.status).indexOf(r.status) >= 0)) };
  if (b.action === 'add') {
    let added = 0;
    (b.rows || []).forEach(r => {
      if (!r.id || t.rows.some(x => x.id === r.id)) return;
      const row = Object.assign({ status: 'card' }, r, { created: now, updated: now });
      t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
      t.rows.push(row); added++;
    });
    return { added };
  }
  if (b.action === 'set') {
    const r = findRow_(t, 'id', b.id);
    setCells_(t, r._row, Object.assign({}, b.fields || {}, { updated: now }));
    return { ok: true };
  }
  throw new Error('Unknown loops action');
}

// Yes / Change / Pass on a loop card, Got it on a todo card.
function adminLoop(key, id, action, note) {
  checkKey_(key);
  const status = { yes: 'yes', change: 'change', pass: 'pass', done: 'done', send: 'sent' }[action];
  if (!status) throw new Error('Unknown answer');
  return withLock_(() => {
    const t = hubTab_('Loops', LOOP_HEAD), r = findRow_(t, 'id', id);
    if (r.to && (action === 'yes' || action === 'send')) {
      MailApp.sendEmail({ to: r.to, subject: r.subject || r.title, body: action === 'send' && note ? note : r.body, replyTo: REPLY_TO, name: 'Graham at Open Frame' });
      setCells_(t, r._row, { status: 'sent', note: action === 'send' ? note : '', updated: new Date().toISOString() });
      return 'ok';
    }
    if (r.when && action === 'yes') {
      const [a, z] = String(r.when).split('|');
      CalendarApp.getDefaultCalendar().createEvent(r.title, new Date(a), new Date(z || a), { description: [r.body, r.link].filter(Boolean).join('\n\n') });
    }
    setCells_(t, r._row, { status, note: note || '', updated: new Date().toISOString() });
    return 'ok';
  });
}

// Yes / Pass on a pitched idea, A / B / C on the stills, Got it on a built one that needs a look.
function adminGraphic(key, id, action, note) {
  checkKey_(key);
  return withLock_(() => {
    const t = graphicsTable_(), r = findRow_(t, 'id', id);
    const set = f => setCells_(t, r._row, Object.assign(f, { updated: new Date().toISOString() }));
    if (action === 'yes') set({ status: 'approved', note: '' });
    else if (action === 'change') set({ status: 'approved', note: note || '' });
    else if (action === 'pass') set({ status: 'passed' });
    else if (/^[abc]$/.test(action)) set({ status: 'picked', pick: action });
    else if (action === 'ok') set({ status: 'built' });
    else throw new Error('Unknown answer');
    return 'ok';
  });
}

// JSON for the review page on openframe.design. GET only, so the browser needs no preflight.
function api_(p) {
  let out;
  try {
    if (p.api === 'client') out = getClientPosts(p.c);
    else if (p.api === 'decide') out = { status: clientDecide(p.c, String(p.ids || '').split(',').filter(Boolean), p.d, p.note || '') };
    else if (p.api === 'resend') out = { status: resendLink_(p.c) };
    else throw new Error('Unknown request');
  } catch (e) {
    out = { error: e.message || String(e) };
    if (e.expired) out.expired = true;
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function page_(title, html, boot) {
  return HtmlService.createHtmlOutput(html.replace('__BOOT__', () => JSON.stringify(boot).replace(/</g, '\\u003c')))
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- data for the dashboard ----------

function getDashboard(key) {
  checkKey_(key);
  const clients = clients_();
  const byBrand = {};
  clients.forEach(c => { byBrand[c.brand] = c; });
  const out = { clients: clients.map(c => ({ client: c.client, brand: c.brand, contact_email: c.contact_email, client_approves: c.client_approves })), topics: [], approve: [], review: [], feedback: [], failed: [], upcoming: [], inbox: [], engage: [], photos: [], fixes: [], leads: [], graphics: [], loops: [], pipeline: {} };
  const now = Date.now(), week = now + 7 * 864e5;

  uniq_(clients.map(c => c.sheet_id)).forEach(sid => {
    const q = table_(sid, 'Queue');
    if (q) {
      groupPosts_(q.rows.filter(r => r.id), sid, byBrand).forEach(g => {
        const t = g.publish_at ? new Date(g.publish_at).getTime() : 0;
        if (g.status === 'plan') { if (!g.decision) (g.clientApproves ? out.review : out.topics).push(g); }
        else if (g.status === 'draft') out.approve.push(g);
        else if (g.status === 'in_review') out.review.push(g);
        else if (g.status === 'changes') out.feedback.push(g);
        else if (g.status === 'failed') out.failed.push(g);
        else if (g.status === 'approved') {
          if (t && t < now - STUCK_HOURS * 36e5) out.fixes.push({ kind: 'stuck', text: (g.clientName || g.brand) + ': an approved post due ' + g.when + ' has not gone out. n8n on your Mac may be off or asleep.' });
          else if (!t || t <= week) out.upcoming.push(g);
        }
      });
    }
    const inbox = table_(sid, 'Inbox');
    if (inbox) inbox.rows.filter(r => r.status === 'needs_reply').forEach(r => out.inbox.push({
      sheetId: sid, id: r.id, who: r.username || r.sender_name || r.sender || '', kind: r.kind || 'dm',
      text: r.text || '', intent: r.intent || '', options: [r.option_1, r.option_2, r.option_3].filter(Boolean),
      draft: r.draft_reply || '', at: r.received_at || r.timestamp || '',
    }));
    const ph = table_(sid, 'Photo submissions');
    if (ph) ph.rows.filter(r => r.status === 'new').forEach(r => out.photos.push({
      sheetId: sid, row: r._row, received: r.received, from: r.from_name || r.from_email, file: r.file,
      verdict: r.verdict, topic: r.topic, what: r.what, caption: r.caption, issues: r.issues,
    }));
  });

  const leads = table_(OUTREACH_SHEET_ID, 'Leads');
  if (leads) {
    leads.rows.filter(r => r.id && r.status === 'drafted').forEach(r => out.leads.push({
      id: r.id, who: r.name || r.org || r.handle || r.email, org: r.name ? r.org : '', kind: r.kind, step: r.step,
      card: r.card, subject: r.subject, body: r.body, email: r.email, handle: r.handle,
    }));
    leads.rows.filter(r => r.id).forEach(r => { const st = r.stage || 'talking'; out.pipeline[st] = (out.pipeline[st] || 0) + 1; });
  }
  const eng = table_(OUTREACH_SHEET_ID, 'Engage');
  if (eng) eng.rows.filter(r => r.status === 'drafted' && r.draft_comment).forEach(r => out.engage.push({
    id: r.post_id, handle: r.handle, url: r.post_url, caption: (r.caption || '').slice(0, 220), comment: r.draft_comment,
  }));

  const gfx = SpreadsheetApp.openById(hubId_()).getSheetByName('Graphics') ? table_(hubId_(), 'Graphics') : null;
  if (gfx) gfx.rows.filter(r => r.id && ['pitched', 'stills', 'check'].indexOf(r.status) >= 0).forEach(r => out.graphics.push({
    id: r.id, status: r.status, video: r.video, line: r.line, idea: r.idea, why: r.why_new, kind: r.kind,
    looks: String(r.looks || '').split(/\n/).filter(Boolean), checks: r.checks, at: r.at,
  }));
  const lp = SpreadsheetApp.openById(hubId_()).getSheetByName('Loops') ? table_(hubId_(), 'Loops') : null;
  if (lp) lp.rows.filter(r => r.id && (r.status === 'card' || r.status === 'todo')).forEach(r => out.loops.push({
    id: r.id, loop: r.loop, client: r.client, kind: r.kind, title: r.title, body: r.body, why: r.why, ask: r.ask, link: r.link, status: r.status,
    to: r.to, subject: r.subject, when: String(r.when || ''),
  }));
  clients.filter(c => c.client_approves && !c.contact_email)
    .forEach(c => out.fixes.push({ kind: 'setup', text: c.client + ' has no contact email in the Clients tab, so review emails can\'t go out.' }));
  health_().cards.forEach(h => out.fixes.push({ kind: 'health', text: h.text, link: h.link }));
  const sortT = (a, b) => String(a.publish_at).localeCompare(String(b.publish_at));
  ['topics', 'approve', 'review', 'feedback', 'failed', 'upcoming'].forEach(k => out[k].sort(sortT));
  return out;
}

function groupPosts_(rows, sid, byBrand) {
  const groups = {};
  rows.forEach(r => {
    const k = [r.brand, r.publish_at, r.type, r.status].join('|') + (r.publish_at ? '' : '|' + r.id);
    const c = byBrand[r.brand] || {};
    const g = groups[k] || (groups[k] = {
      sheetId: sid, ids: [], brand: r.brand, clientName: c.client || r.brand, clientApproves: !!c.client_approves,
      type: r.type, status: r.status, publish_at: r.publish_at, when: fmtWhen_(r.publish_at),
      media: [], posts: [], client_note: '', review_note: '', preview: '', deadline: '', sensitive: false, revision: 0,
    });
    g.ids.push(r.id);
    g.posts.push({ id: r.id, platform: r.platform, caption: r.caption || r.hook || r.pillar || '' });
    String(r.media_url || '').split(/\s+/).filter(Boolean).forEach(u => { if (g.media.indexOf(u) < 0) g.media.push(u); });
    if (r.client_note) g.client_note = r.client_note;
    if (r.client_decision) g.decision = r.client_decision;
    if (r.review_note) g.review_note = r.review_note;
    if (r.preview_url) g.preview = r.preview_url;
    if (r.review_deadline) g.deadline = fmtWhen_(r.review_deadline);
    if (/^y/i.test(r.sensitive || '')) g.sensitive = true;
    g.revision = Math.max(g.revision, Number(r.revision) || 0);
  });
  return Object.keys(groups).map(k => groups[k]);
}

// ---------- dashboard actions ----------

function adminPost(key, sheetId, ids, action, note) {
  checkKey_(key);
  const status = { approve: 'approved', toClient: 'in_review', change: 'changes', skip: 'skipped', retry: 'approved', back: 'draft' }[action];
  if (!status) throw new Error('Unknown action');
  return withLock_(() => {
    const q = table_(sheetId, 'Queue');
    ids.forEach(id => {
      const r = findRow_(q, 'id', id);
      const set = { status };
      if (note) set.review_note = note;
      if (action === 'toClient' && r.status === 'changes') {
        set.revision = (Number(r.revision) || 0) + 1;
        set.client_decision = '';
      }
      if (action === 'approve' || action === 'retry') set.review_note = '';
      setCells_(q, r._row, set);
    });
    return status;
  });
}

// Plan rows keep status plan; the monthly loop's make run reads client_decision.
function adminTopic(key, sheetId, ids, decision, note) {
  checkKey_(key);
  const val = { approve: 'Approve', change: 'Request change', skip: 'Skip' }[decision];
  if (!val) throw new Error('Unknown choice');
  return withLock_(() => {
    const q = table_(sheetId, 'Queue');
    ids.forEach(id => setCells_(q, findRow_(q, 'id', id)._row, {
      client_decision: val, client_note: note || '', answered_by: 'Graham', decided_at: new Date().toISOString(),
    }));
    return val;
  });
}

function adminCaption(key, sheetId, id, caption) {
  checkKey_(key);
  return withLock_(() => {
    const q = table_(sheetId, 'Queue');
    setCells_(q, findRow_(q, 'id', id)._row, { caption });
    return 'saved';
  });
}

function adminReply(key, sheetId, id, reply, action) {
  checkKey_(key);
  return withLock_(() => {
    const t = table_(sheetId, 'Inbox');
    const r = findRow_(t, 'id', id);
    setCells_(t, r._row, action === 'done' ? { status: 'handled' } : { draft_reply: reply, status: 'approved' });
    return 'ok';
  });
}

function adminEngage(key, id, action, comment) {
  checkKey_(key);
  return withLock_(() => {
    const t = table_(OUTREACH_SHEET_ID, 'Engage');
    const r = findRow_(t, 'post_id', id);
    const set = action === 'sent' ? { status: 'sent', sent_at: new Date().toISOString() } : { status: 'skip' };
    if (comment) set.draft_comment = comment;
    setCells_(t, r._row, set);
    return 'ok';
  });
}

// Lead cards. Emails go out from n8n within 15 minutes of a yes; DMs you paste yourself, so they count as sent.
function adminLead(key, id, action, text) {
  checkKey_(key);
  return withLock_(() => {
    const t = table_(OUTREACH_SHEET_ID, 'Leads');
    const r = findRow_(t, 'id', id);
    const now = new Date().toISOString();
    const set = {
      send: { status: r.kind === 'email' ? 'approved' : 'sent', sent_at: r.kind === 'email' ? '' : now, last_contact: r.kind === 'email' ? r.last_contact : now },
      done: { status: 'done' },
      skip: { status: 'skipped' },
      met: { stage: 'consult held', met_at: now, last_contact: now, step: 'met', status: '' },
      noshow: { stage: 'talking', step: 'noshow_pending', status: '' },
      notyet: { status: 'done' },
      won: { stage: 'won', status: 'done', last_contact: now },
      lost: { stage: 'lost', status: 'done' },
    }[action];
    if (!set) throw new Error('Unknown action');
    if (text && action === 'send') set.body = text;
    set.updated_at = now;
    setCells_(t, r._row, set);
    return 'ok';
  });
}

function adminPhoto(key, sheetId, row, received, status) {
  checkKey_(key);
  if (['use', 'skip'].indexOf(status) < 0) throw new Error('Unknown action');
  return withLock_(() => {
    const t = table_(sheetId, 'Photo submissions');
    const r = t.rows.find(x => x._row === row && x.received === received);
    if (!r) throw new Error('That photo moved. Refresh the page.');
    setCells_(t, r._row, { status: status === 'use' ? 'to_post' : 'skip' });
    return 'ok';
  });
}

function adminNotifyClient(key, brand) {
  checkKey_(key);
  const c = clients_().find(x => x.brand === brand);
  if (!c || !c.contact_email) throw new Error('Add a contact email for this client in the Clients tab first.');
  return sendReviewEmail_(c);
}

// One fresh link per address. Older links for that address stop working.
function sendReviewEmail_(c, onlyEmail) {
  const emails = emails_(c.contact_email).filter(e => !onlyEmail || e === onlyEmail);
  if (!emails.length) throw new Error('No contact email on file.');
  const q = table_(c.sheet_id, 'Queue');
  const waiting = q ? q.rows.filter(r => r.brand === c.brand && (r.status === 'in_review' || (r.status === 'plan' && !r.client_decision))) : [];
  const open = groupPosts_(waiting, c.sheet_id, { [c.brand]: c });
  const first = waiting.map(r => r.review_deadline).filter(x => x && !isNaN(new Date(x))).sort((x, y) => new Date(x) - new Date(y))[0];
  const due = first ? fmtWhen_(first) : '';
  emails.forEach(email => {
    const link = withLock_(() => newLink_(c.brand, email));
    sendLinkEmail_(c, email, link, open.length, due);
  });
  return 'sent';
}

function sendLinkEmail_(c, email, link, count, due) {
  const until = Utilities.formatDate(new Date(Date.now() + LINK_DAYS * 864e5), TZ, 'EEEE, MMMM d');
  const what = count === 1 ? '1 post is' : count ? count + ' posts are' : 'Your posts are';
  const ask = due ? 'Please take a look by ' + due + '.' : 'It takes about two minutes.';
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = '<div style="background:#f3f1ea;padding:32px 16px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111110">'
    + '<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2ded2;border-radius:20px;padding:36px 32px;text-align:center">'
    + '<img src="https://openframe.design/icon-192.png" width="44" height="44" alt="Open Frame" style="display:block;margin:0 auto 20px">'
    + '<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4b4a46;margin:0 0 8px">' + esc(c.client) + '</p>'
    + '<h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 12px">' + esc(what) + ' ready for your review</h1>'
    + '<p style="color:#4b4a46;font-size:16px;line-height:1.55;margin:0 0 26px">Look at each one and tap <b>Looks good</b> or <b>Change something</b>. ' + esc(ask) + '</p>'
    + '<a href="' + esc(link) + '" style="display:inline-block;background:#111110;color:#f3f1ea;text-decoration:none;font-weight:600;font-size:16px;padding:15px 30px;border-radius:100px">Review your posts</a>'
    + '<p style="color:#84827b;font-size:13px;line-height:1.5;margin:26px 0 0">This private link is just for ' + esc(email) + ' and works until ' + esc(until) + '. No password needed.</p>'
    + '</div>'
    + '<p style="max-width:480px;margin:18px auto 0;text-align:center;color:#84827b;font-size:12px;line-height:1.5">Open Frame · <a href="https://openframe.design" style="color:#84827b">openframe.design</a><br>Questions? Just reply to this email.</p></div>';
  MailApp.sendEmail({
    to: email, name: FROM_NAME, replyTo: REPLY_TO,
    subject: c.client + ': ' + (count === 1 ? '1 post' : count ? count + ' posts' : 'posts') + ' ready for review',
    body: what + ' ready for your review. ' + ask + '\n\nReview your posts:\n\n' + link
      + '\n\nThis private link is just for ' + email + ' and works until ' + until + '.\n\nOpen Frame\nhttps://openframe.design',
    htmlBody: html,
  });
}

// From an expired or replaced link: send a fresh one to the same address on file. Never to a typed-in address.
function resendLink_(code) {
  const t = linksTable_();
  const r = code && t.rows.find(x => x.link === String(code));
  if (!r) throw new Error('This link is not active.');
  const c = clients_().find(x => x.brand === r.brand);
  if (!c || emails_(c.contact_email).indexOf(r.email) < 0) throw new Error('This link is not active.');
  const recent = t.rows.some(x => x.brand === r.brand && x.email === r.email && within_(x.created, 10 / 1440));
  if (!recent) sendReviewEmail_(c, r.email);
  return 'sent';
}

// ---------- client page ----------

function getClientPosts(token) {
  const c = clientByLink_(token);
  const q = table_(c.sheet_id, 'Queue');
  const rows = q.rows.filter(r => r.brand === c.brand && (r.status === 'in_review' || (r.status === 'plan' && !r.client_decision) || (r.decided_at && within_(r.decided_at, 3))));
  const groups = groupPosts_(rows, c.sheet_id, { [c.brand]: c }).map(g => ({
    ids: g.ids, when: g.when, type: g.type, media: g.media, preview: g.preview, status: g.status, client_note: g.client_note,
    deadline: g.deadline, sensitive: g.sensitive,
    posts: g.posts.map(p => ({ platform: p.platform, caption: p.caption })),
  }));
  const open = s => (s === 'in_review' || s === 'plan' ? 0 : 1);
  groups.sort((a, b) => open(a.status) - open(b.status));
  return { client: c.client, posts: groups, results: results_(c) };
}

// ---------- client results (same formulas as analytics/report/build-report.js kpis()) ----------

function results_(c) {
  const at = table_(c.sheet_id, 'Account stats'), pt = table_(c.sheet_id, 'Post stats');
  const acc = at ? at.rows.filter(r => r.client === c.brand) : [];
  const posts = pt ? pt.rows.filter(r => r.client === c.brand) : [];
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  const newsletter = newsletter_(c, month);
  if (!acc.length && !posts.length) return { empty: true, report_url: c.report_url, newsletter };
  const now = kpis_(acc, posts, month), was = kpis_(acc, posts, prev);
  const label = mo => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(mo.slice(5)) - 1];
  const tiles = [
    ['reach', 'Accounts reached', 'People who saw your posts'],
    ['interactions', 'Interactions', 'Likes, comments, saves and shares'],
    ['views', 'Views', 'Times your posts were shown'],
    ['follows', 'New followers', 'Across both accounts'],
    ['clicks', 'Clicks and taps', 'Profile links and post clicks'],
  ].map(([k, title, sub]) => ({ title, sub, value: now[k], prev: was[k] }));
  const top = postsIn_(posts, month).filter(p => score_(p) != null).sort((a, b) => score_(b) - score_(a)).slice(0, 3)
    .map(p => ({ platform: p.platform, type: p.type, caption: String(p.caption || '').slice(0, 140), url: p.permalink,
      reach: num_(p.reach), likes: num_(p.likes), comments: num_(p.comments), saves: num_(p.saves), shares: num_(p.shares) }));
  return { empty: false, month: label(month), prevMonth: label(prev), tiles, top, report_url: c.report_url, newsletter };
}

// One plain sentence from the "Newsletter stats" tab (Brevo, written by n8n). Same math as the PDF report (build-report.js).
// '' when the client has no newsletter rows at all.
function newsletter_(c, month) {
  const t = table_(c.sheet_id, 'Newsletter stats');
  const all = t ? t.rows.filter(r => r.brand === c.brand).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))) : [];
  if (!all.length) return '';
  const issues = all.filter(r => String(r.month).slice(0, 7) === month);
  if (!issues.length) return 'Newsletter: no newsletter this month.';
  const sum = f => (issues.some(r => num_(r[f]) != null) ? issues.reduce((s, r) => s + (num_(r[f]) || 0), 0) : null);
  const delivered = sum('delivered'), clicks = sum('unique_clicks'), opens = sum('unique_opens'), unsubs = sum('unsubscribes');
  const pct = v => (v == null || !delivered ? '' : ' (' + Math.round(v / delivered * 1000) / 10 + '% of delivered)');
  const last = issues[issues.length - 1], before = all.filter(r => String(r.month).slice(0, 7) < month).pop();
  const a = last && num_(last.list_size_at_send), b = before && num_(before.list_size_at_send);
  const growth = a != null && b != null ? a - b : null;
  const n = v => Math.round(v).toLocaleString('en-US');
  const parts = [];
  if (clicks != null) parts.push(n(clicks) + (clicks === 1 ? ' person' : ' people') + ' clicked a link' + pct(clicks));
  if (opens != null) parts.push(n(opens) + ' opened it (Apple Mail inflates opens)');
  if (growth != null) parts.push((growth >= 0 ? n(growth) + ' new' : n(-growth) + ' fewer') + ' subscribers');
  if (unsubs != null) parts.push(n(unsubs) + ' unsubscribed');
  return parts.length ? 'Newsletter: ' + parts.join(', ') + '.' : 'Newsletter: numbers come in a day or two after it goes out.';
}

function kpis_(a, posts, month) {
  const ig = postsIn_(posts, month, 'instagram'), fb = postsIn_(posts, month, 'facebook');
  const acct = (platform, ...metrics) => {
    for (const m of metrics) {
      const r = a.find(x => x.month === month && x.platform === platform && x.metric === m);
      if (r && num_(r.value) != null) return num_(r.value);
    }
    return null;
  };
  const add = (...v) => (v.every(x => x == null) ? null : v.reduce((s, x) => s + (x || 0), 0));
  const sum = (ps, f) => (ps.some(p => num_(p[f]) != null) ? ps.reduce((s, p) => s + (num_(p[f]) || 0), 0) : null);
  const or = (x, y) => (x != null ? x : y);
  return {
    reach: add(acct('instagram', 'reach'), acct('facebook', 'page_impressions_unique', 'page_total_media_view_unique')),
    clicks: add(acct('instagram', 'profile_links_taps'), acct('instagram', 'website_clicks'), sum(fb, 'clicks')),
    follows: add(acct('instagram', 'new_followers'), acct('facebook', 'page_daily_follows_unique', 'page_follows')),
    interactions: add(or(acct('instagram', 'total_interactions'), sum(ig, 'interactions')), or(acct('facebook', 'page_post_engagements'), sum(fb, 'interactions'))),
    views: add(acct('instagram', 'views'), acct('facebook', 'page_media_view')),
  };
}

function postsIn_(posts, month, platform) {
  return posts.filter(p => String(p.published_at).slice(0, 7) === month && (!platform || p.platform === platform));
}
function num_(v) { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); return s === '' || isNaN(Number(s)) ? null : Number(s); }
// Signal score: the actions that mean someone valued the post. Reach breaks ties.
function score_(p) {
  const r = num_(p.reach);
  return r == null ? null : (num_(p.saves) || 0) * 3 + (num_(p.shares) || 0) * 3 + (num_(p.comments) || 0) * 2 + (num_(p.likes) || 0) + r / 1e6;
}

function clientDecide(token, ids, decision, note) {
  const c = clientByLink_(token, true);
  const map = { approve: ['approved', 'Approve'], change: ['changes', 'Request change'], skip: ['skipped', 'Skip'] }[decision];
  if (!map) throw new Error('Unknown choice');
  if (decision === 'change' && !String(note || '').trim()) throw new Error('Tell us what to change.');
  return withLock_(() => {
    const q = table_(c.sheet_id, 'Queue');
    ids.forEach(id => {
      const r = findRow_(q, 'id', id);
      const isPlan = r.status === 'plan' && !r.client_decision;
      if (r.brand !== c.brand || (r.status !== 'in_review' && !isPlan)) throw new Error('This post was already updated. Refresh the page.');
      const set = {
        client_decision: map[1], client_note: String(note || '').slice(0, 2000),
        answered_by: c.email, decided_at: new Date().toISOString(),
      };
      if (!isPlan) set.status = map[0]; // plan rows keep status plan; the monthly loop reads client_decision
      setCells_(q, r._row, set);
    });
    if (decision === 'change') {
      MailApp.sendEmail(me_(), c.client + ' asked for a change', c.email + ' wrote: ' + note + '\n\nOpen your dashboard:\n\n' + adminUrl_());
    }
    return map[0];
  });
}

// ---------- check-in emails ----------

function checkIn() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_CHECKIN') || 0);
  if (CHECKIN_EVERY_WEEKS > 1 && Date.now() - last < (CHECKIN_EVERY_WEEKS * 7 - 1) * 864e5) return;
  checkInNow();
  props.setProperty('LAST_CHECKIN', String(Date.now()));
  if (AUTO_SEND_CLIENTS) sendClientEmails_();
}

// Clients with posts waiting get a fresh link, at most once every 6 days.
function sendClientEmails_() {
  const sent = linksTable_().rows;
  clients_().filter(c => c.client_approves && c.contact_email).forEach(c => {
    if (sent.some(x => x.brand === c.brand && within_(x.created, 6))) return;
    const q = table_(c.sheet_id, 'Queue');
    const waiting = q && q.rows.some(r => r.brand === c.brand && (r.status === 'in_review' || (r.status === 'plan' && !r.client_decision)));
    if (waiting) { try { sendReviewEmail_(c); } catch (e) { Logger.log(c.client + ': ' + e.message); } }
  });
}

function checkInNow() {
  const d = getDashboard(adminKey_());
  const parts = [
    [d.topics.length, 'topic idea', 'topic ideas'], [d.approve.length, 'post', 'posts'], [d.inbox.length, 'message', 'messages'],
    [d.engage.length, 'comment to leave', 'comments to leave'], [d.photos.length, 'photo sent in', 'photos sent in'],
    [d.leads.length, 'lead follow-up', 'lead follow-ups'], [d.graphics.length, 'graphic idea', 'graphic ideas'],
    [d.failed.length + d.fixes.length, 'thing to fix', 'things to fix'],
  ].filter(p => p[0]).map(p => p[0] + ' ' + (p[0] === 1 ? p[1] : p[2]));
  const total = d.topics.length + d.approve.length + d.inbox.length + d.engage.length + d.photos.length + d.leads.length + d.graphics.length + d.failed.length + d.fixes.length;
  const lines = total
    ? ['You have ' + total + ' to go through: ' + parts.join(', ') + '.', '', 'Tap Yes or Change on each one:', '', adminUrl_()]
    : ['Nothing needs you this time.'];
  const fyi = [];
  if (d.upcoming.length) fyi.push(d.upcoming.length + (d.upcoming.length === 1 ? ' post' : ' posts') + ' going out this week');
  if (d.review.length) fyi.push(d.review.length + ' waiting on clients');
  if (fyi.length) lines.push('', fyi.join(', ') + '.');
  const pipe = pipeline_(d.pipeline);
  if (pipe) lines.push('', 'Leads: ' + pipe + '.');
  MailApp.sendEmail(me_(), total ? 'Check-in: ' + total + (total === 1 ? ' thing needs you' : ' things need you') : 'Check-in: nothing needs you', lines.join('\n'));
}

// Daily, but only emails when something new can't wait for the check-in.
function urgentCheck() {
  const d = getDashboard(adminKey_());
  const items = d.failed.map(g => ['f' + g.ids[0], g.clientName + ': the post for ' + g.when + " didn't go out."])
    .concat(d.fixes.filter(f => f.kind === 'stuck').map(f => ['s' + f.text, f.text]))
    .concat(d.inbox.map(m => ['m' + m.id, (m.who || 'Someone') + ' sent a message: ' + m.text.slice(0, 80)]))
    .concat(LEADS_URGENT ? d.leads.map(l => ['l' + l.id + '|' + l.step, (l.who || 'A lead') + ': ' + leadLine_(l)]) : []);
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty('URGENT_SEEN') || '[]');
  const fresh = items.filter(x => seen.indexOf(x[0]) < 0);
  props.setProperty('URGENT_SEEN', JSON.stringify(items.map(x => x[0]).slice(-200)));
  if (!fresh.length) return;
  MailApp.sendEmail(me_(), fresh.length === 1 ? 'One thing can\'t wait' : fresh.length + " things can't wait",
    fresh.map(x => '- ' + x[1]).join('\n') + '\n\nHandle it here:\n\n' + adminUrl_());
}

// Hourly. Emails health problems marked email = yes once per check + since + status, and a long Mac outage once.
function healthCheck() {
  const h = health_();
  const items = h.cards.filter(c => c.email).map(c => [c.key, c.text + (c.link ? '\n  Fix it here: ' + c.link : '')]);
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty('HEALTH_SEEN') || '[]');
  const fresh = items.filter(x => seen.indexOf(x[0]) < 0);
  if (!fresh.length) return;
  props.setProperty('HEALTH_SEEN', JSON.stringify(seen.concat(fresh.map(x => x[0])).slice(-200)));
  MailApp.sendEmail(me_(), fresh.length === 1 ? 'Something stopped working' : fresh.length + ' things stopped working',
    fresh.map(x => '- ' + x[1]).join('\n') + '\n\nYour check-in page:\n\n' + adminUrl_());
}

// Current non-ok rows from the latest run, plus a card when the run itself stopped (Mac off or asleep).
function health_() {
  const out = { cards: [] };
  const t = table_(hubId_(), 'Health');
  if (!t || !t.rows.length) return out;
  const hb = t.rows.find(r => r.check === 'heartbeat');
  if (!hb) return out;
  const ran = new Date(hb.updated_at).getTime();
  const yes = v => /^(y|yes|true)$/i.test(String(v || ''));
  t.rows.filter(r => r.check && r.check !== 'heartbeat' && r.updated_at === hb.updated_at && /^(warn|fail)$/i.test(r.status))
    .forEach(r => out.cards.push({
      key: [r.check, r.since, r.status].join('|'), text: r.detail || (r.label || r.check) + ' needs a look.', link: r.link || '', email: yes(r.email),
    }));
  const hours = ran ? (Date.now() - ran) / 36e5 : 0;
  if (ran && hours > HEALTH_MAC_CARD_HOURS) out.cards.push({
    key: 'mac|' + hb.updated_at, link: '', email: hours > HEALTH_MAC_EMAIL_HOURS,
    text: "n8n on your Mac hasn't checked in since " + fmtWhen_(hb.updated_at) + '. The Mac may be off or asleep, so nothing posts or gets pulled.',
  });
  return out;
}

function leadLine_(l) {
  return { email: 'follow-up email ready', dm: 'follow-up message ready', todo: 'something to do today', ask_met: 'did the consult happen?', ask_signed: 'did they say yes?' }[l.kind] || 'needs a look';
}

const STAGES = ['talking', 'consult booked', 'consult held', 'won'];
function pipeline_(p) {
  return STAGES.filter(s => p && p[s]).map(s => p[s] + ' ' + s).join(', ');
}

// ---------- helpers ----------

function table_(sheetId, tab) {
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
  if (!sh) return null;
  const vals = sh.getLastRow() ? sh.getDataRange().getDisplayValues() : [[]];
  const head = vals[0].map(h => String(h).trim());
  const rows = vals.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { if (h) o[h] = r[j]; });
    return o;
  });
  return { sh, head, rows };
}

function addCol_(t, h) {
  const col = t.head.length + 1;
  if (t.sh.getMaxColumns() < col) t.sh.insertColumnsAfter(t.sh.getMaxColumns(), col - t.sh.getMaxColumns());
  t.sh.getRange(1, col).setValue(h);
  t.head.push(h);
  return col - 1;
}

function setCells_(t, rowNum, obj) {
  Object.keys(obj).forEach(k => {
    let c = t.head.indexOf(k);
    if (c < 0) c = addCol_(t, k);
    let v = obj[k];
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v; // never let typed text run as a formula
    t.sh.getRange(rowNum, c + 1).setValue(v);
  });
}

function findRow_(t, key, val) {
  const r = t && t.rows.find(x => String(x[key]) === String(val));
  if (!r) throw new Error('That item moved or was removed. Refresh the page.');
  return r;
}

function clients_() {
  const t = table_(hubId_(), 'Clients');
  if (!t) return [];
  return t.rows.filter(r => r.brand).map(r => ({
    client: r.client || r.brand, brand: r.brand, sheet_id: r.sheet_id || hubId_(),
    contact_email: r.contact_email || '', report_url: r.report_url || '', client_approves: /^(y|yes|true)$/i.test(r.client_approves || ''),
  }));
}

function emails_(s) { return String(s || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => /@/.test(e)); }

function linksTable_() {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName('Review links')) {
    const sh = ss.insertSheet('Review links');
    sh.getRange(1, 1, 1, LINK_HEAD.length).setValues([LINK_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return table_(hubId_(), 'Review links');
}

function newLink_(brand, email) {
  const t = linksTable_();
  const now = new Date();
  t.rows.filter(r => r.brand === brand && r.email === email && new Date(r.expires) > now)
    .forEach(r => setCells_(t, r._row, { expires: now.toISOString() }));
  const code = linkCode_();
  t.sh.appendRow([code, brand, email, now.toISOString(), new Date(now.getTime() + LINK_DAYS * 864e5).toISOString(), '']);
  return CLIENT_PAGE_URL + '#' + code;
}

// The link must exist, be unexpired, and its email must still be a contact for that client.
function clientByLink_(code, touch) {
  const t = linksTable_();
  const r = code && t.rows.find(x => x.link === String(code));
  const c = r && clients_().find(x => x.brand === r.brand);
  if (!r || !c || emails_(c.contact_email).indexOf(r.email) < 0) throw new Error('This link is not active.');
  if (!(new Date(r.expires) > new Date())) { const e = new Error('This link has expired.'); e.expired = true; throw e; }
  if (touch) setCells_(t, r._row, { last_used: new Date().toISOString() });
  return Object.assign({ email: r.email }, c);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { const out = fn(); SpreadsheetApp.flush(); return out; } finally { lock.releaseLock(); }
}

function checkKey_(key) { if (!key || key !== adminKey_()) throw new Error('Not allowed'); }
function adminKey_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_KEY'); }
function hubId_() { return PropertiesService.getScriptProperties().getProperty('HUB_ID') || HUB_SHEET_ID; }
// Run from the editor, getUrl() gives the /dev test link, which only works for the owner.
// The live /exec link is saved the first time a page is opened through it.
function baseUrl_() {
  if (/\/exec$/.test(WEB_APP_URL)) return WEB_APP_URL;
  const saved = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  return saved || ScriptApp.getService().getUrl() || '';
}
function adminUrl_() { return baseUrl_() + '?k=' + adminKey_(); }
function me_() { return Session.getEffectiveUser().getEmail(); }
function uniq_(a) { return a.filter((x, i) => a.indexOf(x) === i); }
function within_(s, days) { const t = new Date(s).getTime(); return t && Date.now() - t < days * 864e5; }
function fmtWhen_(s) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d) ? Utilities.formatDate(d, TZ, 'EEE MMM d, h:mm a') : 'no date yet';
}
// 16 random letters and numbers in groups of four, like k7m2-p9x4-c3q8-w6t2 (80 bits).
function linkCode_() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  let s = '';
  for (let i = 0; i < 16; i++) { s += a[(bytes[i] + 256) % 32]; if (i % 4 === 3 && i < 15) s += '-'; }
  return s;
}

function token_(n) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  Utilities.getUuid().replace(/-/g, '').concat(Utilities.getUuid().replace(/-/g, ''))
    .slice(0, n).split('').forEach((ch, i) => { s += a[(parseInt(ch, 16) * 2 + i) % a.length]; });
  return s;
}

// ---------- pages ----------
// Both pages show one card at a time: Yes, Change, or a small Skip.

const BASE_CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d1b18;--mute:#6b665d;--line:#e4dfd4;--accent:#2f5d50;--accent-ink:#fff;--soft:#eef3f0;--note:#fff7e8}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:16px 16px 40px}
.top{display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 14px}.top h1{font-size:20px;margin:0}.count{color:var(--mute);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.label{font-size:13px;color:var(--mute);margin-bottom:10px}.label b{color:var(--ink);font-weight:600}
.media{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 -4px 12px;padding:0 4px}
.media img,.media video{width:100%;max-height:440px;object-fit:contain;border-radius:10px;background:#e9e5dc;flex:none;scroll-snap-align:center}
.media.many img,.media.many video{width:85%}
.text{white-space:pre-wrap;font-size:15px;margin:0 0 6px}.quote{background:var(--soft);border-radius:10px;padding:10px 12px;white-space:pre-wrap;font-size:15px;margin:8px 0}
.note{background:var(--note);border-radius:10px;padding:10px 12px;font-size:14px;margin:8px 0}
.ask{font-weight:600;margin:14px 0 10px}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button{font:inherit;font-size:16px;border-radius:12px;padding:14px 10px;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink)}
button.yes{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
button:disabled{opacity:.5}
.skip{display:block;margin:14px auto 0;background:none;border:0;color:var(--mute);font-size:14px;padding:6px;text-decoration:underline}
textarea{width:100%;min-height:96px;font:inherit;font-size:15px;padding:10px;border:1px solid var(--line);border-radius:10px;margin:4px 0 10px}
.done{text-align:center;padding:40px 16px}.done h2{font-size:22px;margin:0 0 6px}.mute{color:var(--mute);font-size:14px}
.more{margin-top:28px;font-size:14px;color:var(--mute)}.more a,.link{color:var(--accent)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}
.tile b{display:block;font-size:22px}.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
`;

const SHARED_JS = `
const BOOT = __BOOT__;
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); Object.entries(a).forEach(([k, v]) => k === 'on' ? Object.entries(v).forEach(([n, f]) => e.addEventListener(n, f)) : k === 'text' ? e.textContent = v : e.setAttribute(k, v)); kids.flat().forEach(c => c && e.append(c)); return e; };
const call = (fn, ...args) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(e => { alert(e.message || e); no(e); })[fn](...args));
// Caption text with any https link made clickable (a newsletter's "Full email" link).
function textEl(t) {
  return $('p', { class: 'text' }, String(t || '').split(/(https?:\\/\\/[^\\s<>"]+)/).map((x, i) => i % 2
    ? $('a', { class: 'link', href: x, target: '_blank', rel: 'noopener', text: x }) : document.createTextNode(x)));
}
const isNews = g => g.posts.some(p => p.platform === 'newsletter');
function mediaEl(urls, poster) {
  if (!urls.length && poster) urls = [poster];
  if (!urls.length) return '';
  return $('div', { class: 'media' + (urls.length > 1 ? ' many' : '') }, urls.map(u => /\\.(mp4|mov|webm)(\\?|$)/i.test(u)
    ? $('video', Object.assign({ src: u, controls: '', preload: 'metadata', playsinline: '' }, poster ? { poster } : {}))
    : $('img', { src: u, loading: 'lazy', alt: '' })));
}
// One card at a time. Each item: { label, body: [nodes], ask, yes: [text, fn] (or picks: [[text, fn], ...] for a row of choices), change: [text, placeholder, fn, prefill] | null, alt: [text, fn] (second button when there's no change), skip: [text, fn] | null }
function runQueue(items, box, countEl, onDone) {
  let i = 0;
  const show = () => {
    box.innerHTML = '';
    if (i >= items.length) { countEl.textContent = ''; return onDone(); }
    countEl.textContent = (i + 1) + ' of ' + items.length;
    const it = items[i], next = () => { i++; show(); window.scrollTo(0, 0); };
    const busy = (b, fn) => { b.querySelectorAll('button').forEach(x => x.disabled = true); return fn().then(next, () => b.querySelectorAll('button').forEach(x => x.disabled = false)); };
    const card = $('div', { class: 'card' }, $('div', { class: 'label' }, it.label), ...it.body, $('div', { class: 'ask', text: it.ask }));
    const btns = $('div', { class: 'btns' });
    if (it.picks) {
      it.picks.forEach(p => btns.append($('button', { class: 'yes', text: p[0], on: { click: () => busy(card, p[1]) } })));
      btns.style.gridTemplateColumns = 'repeat(' + it.picks.length + ',1fr)';
    } else btns.append($('button', { class: 'yes', text: it.yes[0], on: { click: () => busy(card, it.yes[1]) } }));
    if (it.picks) { /* the picks are the buttons */ }
    else if (it.change) btns.append($('button', { text: it.change[0], on: { click: () => {
      const ta = $('textarea', { placeholder: it.change[1] }); ta.value = it.change[3] || '';
      const send = $('button', { class: 'yes', text: 'Send', on: { click: () => { if (!ta.value.trim()) return ta.focus(); busy(card, () => it.change[2](ta.value.trim())); } } });
      const back = $('button', { text: 'Back', on: { click: show } });
      btns.replaceWith($('div', {}, ta, $('div', { class: 'btns' }, back, send))); ta.focus();
    } } }));
    else if (it.alt) btns.append($('button', { text: it.alt[0], on: { click: () => busy(card, it.alt[1]) } }));
    else btns.style.gridTemplateColumns = '1fr';
    card.append(btns);
    if (it.skip) card.append($('button', { class: 'skip', text: it.skip[0], on: { click: () => busy(card, it.skip[1]) } }));
    box.append(card);
  };
  show();
}
const fmt = v => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const pct = (a, b) => (a == null || b == null || b === 0) ? '' : ' (' + (a >= b ? 'up ' : 'down ') + Math.abs(Math.round((a - b) / b * 100)) + '%)';
`;

const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<div class="top"><h1>Check-in</h1><span class="count" id="count">Loading...</span></div>
<div id="box"></div><div class="more" id="more"></div></div>
<script>${SHARED_JS}
const K = BOOT.key;
const nothing = () => Promise.resolve();
function postLabel(g, what) { return [$('b', { text: g.clientName }), ' · ' + (isNews(g) && what === g.type ? 'newsletter' : what) + ' · ' + g.when]; }
function postBody(g) {
  const caps = g.posts.filter((p, i, a) => a.findIndex(x => x.caption === p.caption) === i);
  return [mediaEl(g.media, g.preview), ...caps.map(p => textEl(p.caption)),
    g.client_note ? $('div', { class: 'note', text: 'Client said: ' + g.client_note }) : ''];
}
function build(d) {
  const q = [];
  d.failed.forEach(g => q.push({ label: postLabel(g, 'post didn\\'t go out'), body: postBody(g), ask: 'Try posting it again?',
    yes: ['Try again', () => call('adminPost', K, g.sheetId, g.ids, 'retry', '')], change: null,
    skip: ['Drop this post', () => call('adminPost', K, g.sheetId, g.ids, 'skip', '')] }));
  d.fixes.forEach(f => q.push({ label: ['Heads up'], body: [$('p', { class: 'text', text: f.text }),
    f.link ? $('p', {}, $('a', { class: 'link', href: f.link, target: '_blank', rel: 'noopener', text: 'Fix it here' })) : ''], ask: '',
    yes: ['Got it', nothing], change: null, skip: null }));
  d.topics.forEach(g => q.push({ label: postLabel(g, 'topic idea'), body: postBody(g), ask: 'Make this post?',
    yes: ['Yes', () => call('adminTopic', K, g.sheetId, g.ids, 'approve', '')],
    change: ['Change', 'What should change?', n => call('adminTopic', K, g.sheetId, g.ids, 'change', n)],
    skip: ['Skip this topic', () => call('adminTopic', K, g.sheetId, g.ids, 'skip', '')] }));
  d.approve.forEach(g => q.push({ label: postLabel(g, g.type || 'post'), body: postBody(g),
    ask: g.clientApproves ? 'Send to ' + g.clientName + ' to approve?' : 'Post this?',
    yes: [g.clientApproves ? 'Yes, send' : 'Yes', () => call('adminPost', K, g.sheetId, g.ids, g.clientApproves ? 'toClient' : 'approve', '')],
    change: ['Change', 'What should change?', n => call('adminPost', K, g.sheetId, g.ids, 'change', n)],
    skip: ['Don\\'t post this', () => call('adminPost', K, g.sheetId, g.ids, 'skip', '')] }));
  d.inbox.forEach(m => { const reply = m.draft || m.options[0] || ''; q.push({
    label: [$('b', { text: m.who || 'Someone' }), ' · ' + (m.kind === 'comment' ? 'comment' : 'message')],
    body: [$('div', { class: 'quote', text: m.text }), reply ? $('p', { class: 'text', text: 'Reply: ' + reply }) : ''],
    ask: reply ? 'Send this reply?' : 'Write a reply?',
    yes: reply ? ['Send', () => call('adminReply', K, m.sheetId, m.id, reply, 'send')] : ['I handled it', () => call('adminReply', K, m.sheetId, m.id, '', 'done')],
    change: ['Change', 'Your reply', n => call('adminReply', K, m.sheetId, m.id, n, 'send'), reply],
    skip: reply ? ['I handled it myself', () => call('adminReply', K, m.sheetId, m.id, '', 'done')] : null }); });
  const openPost = (x, text) => { try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {} window.open(x.url, '_blank'); return call('adminEngage', K, x.id, 'sent', text); };
  d.engage.forEach(x => q.push({ label: [$('b', { text: '@' + x.handle }), ' · comment to leave'],
    body: [$('div', { class: 'quote', text: x.caption }), $('p', { class: 'text', text: 'Your comment: ' + x.comment })],
    ask: 'Post this comment? It gets copied and the post opens. Paste and send.',
    yes: ['Copy and open', () => openPost(x, x.comment)],
    change: ['Change', 'Your comment', n => openPost(x, n), x.comment],
    skip: ['Skip this one', () => call('adminEngage', K, x.id, 'skip', '')] }));
  d.leads.forEach(l => {
    const label = [$('b', { text: l.who || 'A lead' }), l.org ? ' · ' + l.org : '', ' · lead'];
    const go = a => () => call('adminLead', K, l.id, a, '');
    if (l.kind === 'email') q.push({ label, body: [$('p', { class: 'text', text: 'To: ' + l.email + '\\nSubject: ' + l.subject }), $('div', { class: 'quote', text: l.body })],
      ask: 'Send this follow-up?', yes: ['Send', go('send')],
      change: ['Change', 'Your email', n => call('adminLead', K, l.id, 'send', n), l.body], skip: ['Don\\'t send', go('skip')] });
    else if (l.kind === 'dm') { const open = text => { try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {} window.open(BOOT.metaInbox, '_blank'); return call('adminLead', K, l.id, 'send', text); };
      q.push({ label, body: [$('div', { class: 'quote', text: l.body })],
      ask: 'Send this message' + (l.handle ? ' to @' + l.handle : '') + '? It gets copied and your inbox opens. Paste and send.',
      yes: ['Copy and open', () => open(l.body)], change: ['Change', 'Your message', n => open(n), l.body], skip: ['Don\\'t send', go('skip')] }); }
    else if (l.kind === 'ask_met') q.push({ label, body: [textEl(l.card)], ask: '', yes: ['We met', go('met')], change: null, alt: ['They didn\\'t show', go('noshow')], skip: null });
    else if (l.kind === 'ask_signed') q.push({ label, body: [textEl(l.card)], ask: '', yes: ['Yes, they signed', go('won')], change: null, alt: ['Not yet', go('notyet')], skip: ['No, close their file', go('lost')] });
    else q.push({ label, body: [textEl(l.card)], ask: '', yes: ['Got it', go('done')], change: null, skip: null });
  });
  d.graphics.forEach(g => {
    const label = [$('b', { text: 'Graphic idea' }), g.video ? ' · ' + g.video : ''];
    const go = a => () => call('adminGraphic', K, g.id, a, '');
    if (g.status === 'pitched') q.push({ label, body: [$('div', { class: 'quote', text: '"' + g.line + '"' }), textEl(g.idea), g.why ? $('p', { class: 'mute', text: 'Why new: ' + g.why }) : ''],
      ask: 'Make this graphic? You pick from 3 looks before anything animates.', yes: ['Yes', go('yes')],
      change: ['Change', 'What should it show instead?', n => call('adminGraphic', K, g.id, 'change', n)], skip: ['Pass', go('pass')] });
    else if (g.status === 'stills') q.push({ label, body: [$('div', { class: 'media many' }, g.looks.map((u, i) => $('figure', { style: 'margin:0' },
      $('img', { src: u, loading: 'lazy', alt: '', style: 'background:#6b6b6b' }), $('figcaption', { class: 'mute', text: 'ABC'[i] })))), textEl(g.idea),
      g.checks ? $('p', { class: 'note', text: 'Check: ' + g.checks }) : ''],
      ask: 'Which look?', picks: [['A', go('a')], ['B', go('b')], ['C', go('c')]],
      skip: ['Redo with a note', () => { const n = prompt('What should change?'); return n ? call('adminGraphic', K, g.id, 'change', n) : Promise.reject(new Error('')); }] });
    else q.push({ label, body: [textEl(g.idea), $('p', { class: 'note', text: 'It built, but check this: ' + g.checks })], ask: '', yes: ['Got it', go('ok')], change: null, skip: null });
  });
  d.loops.forEach(l => {
    const label = [$('b', { text: l.title || 'Loop' }), ' · ' + [l.client, l.kind].filter(Boolean).join(' · ')];
    const go = a => () => call('adminLoop', K, l.id, a, '');
    const body = [textEl(l.body), l.why ? $('p', { class: 'mute', text: 'Why: ' + l.why }) : '',
      l.link ? $('p', {}, $('a', { class: 'link', href: l.link, target: '_blank', text: 'Open' })) : ''];
    if (l.to) q.push({ label, body: [$('p', { class: 'text', text: 'To: ' + l.to + '\nSubject: ' + (l.subject || l.title) }), $('div', { class: 'quote', text: l.body }), l.why ? $('p', { class: 'mute', text: 'Why: ' + l.why }) : ''],
      ask: l.ask || 'Send this email?', yes: ['Send', go('yes')], change: ['Edit', 'Your email', n => call('adminLoop', K, l.id, 'send', n), l.body], skip: ['Don\\'t send', go('pass')] });
    else if (l.status === 'todo') q.push({ label, body, ask: l.ask || '', yes: ['Got it', go('done')], change: null, skip: null });
    else q.push({ label, body, ask: l.ask || 'Go ahead?', yes: ['Yes', go('yes')],
      change: ['Change', 'What should change?', n => call('adminLoop', K, l.id, 'change', n)], skip: ['Pass', go('pass')] });
  });
  d.photos.forEach(p => q.push({ label: [$('b', { text: p.from || 'Someone' }), ' · sent a photo'],
    body: [p.file ? $('img', { src: p.file, alt: '', style: 'width:100%;border-radius:10px;margin-bottom:10px' }) : '', $('p', { class: 'text', text: [p.what, p.issues ? 'Note: ' + p.issues : ''].filter(Boolean).join('\\n') })],
    ask: 'Use it in a post?', yes: ['Yes', () => call('adminPhoto', K, p.sheetId, p.row, p.received, 'use')], change: null,
    skip: ['No', () => call('adminPhoto', K, p.sheetId, p.row, p.received, 'skip')] }));
  return q;
}
function summary(d) {
  const more = document.getElementById('more'); more.innerHTML = '';
  const bits = [];
  if (d.upcoming.length) bits.push(plural(d.upcoming.length, 'post', 'posts') + ' going out this week');
  if (d.review.length) bits.push(plural(d.review.length, 'post', 'posts') + ' waiting on clients');
  if (d.feedback.length) bits.push(plural(d.feedback.length, 'post', 'posts') + ' being revised');
  const pipe = ['talking', 'consult booked', 'consult held', 'won'].filter(s => d.pipeline[s]).map(s => d.pipeline[s] + ' ' + s).join(', ');
  if (pipe) bits.push('Leads: ' + pipe);
  if (bits.length) more.append($('p', { text: bits.join(' · ') }));
  const links = $('div', { style: 'display:none' }, d.clients.map(c => $('div', { class: 'row' }, $('span', { text: c.client }),
    c.contact_email
      ? $('a', { class: 'link', href: '#', text: 'Send review email', on: { click: e => { e.preventDefault(); e.target.textContent = 'Sending...'; call('adminNotifyClient', K, c.brand).then(() => e.target.textContent = 'Sent to ' + c.contact_email, () => e.target.textContent = 'Send review email'); } } })
      : $('span', { class: 'mute', text: 'Add an email in the Clients tab' }))));
  more.append($('a', { class: 'link', href: '#', text: 'Clients', on: { click: e => { e.preventDefault(); links.style.display = links.style.display ? '' : 'none'; } } }), links);
}
call('getDashboard', K).then(d => {
  summary(d);
  const box = document.getElementById('box');
  runQueue(build(d), box, document.getElementById('count'), () =>
    box.append($('div', { class: 'card done' }, $('h2', { text: 'All done' }), $('p', { class: 'mute', text: 'Nothing else needs you right now.' }))));
});
</script></body></html>`;

const CLIENT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<div class="top"><h1 id="h"></h1><span class="count" id="count"></span></div>
<div id="box"><p class="mute">Loading...</p></div><div class="more" id="more"></div></div>
<script>${SHARED_JS}
document.getElementById('h').textContent = BOOT.client;
function results(R) {
  const more = document.getElementById('more'); more.innerHTML = '';
  if (!R || R.empty) { more.append($('p', { text: 'Results appear after the first stats pull.' }), R && R.newsletter ? $('p', { text: R.newsletter }) : ''); return; }
  const t = {}; R.tiles.forEach(x => t[x.title] = x);
  const reach = t['Accounts reached'], fol = t['New followers'], clk = t['Clicks and taps'];
  const parts = [];
  if (reach && reach.value != null) parts.push('reached ' + fmt(reach.value) + ' people' + pct(reach.value, reach.prev));
  if (fol && fol.value != null) parts.push(fmt(fol.value) + ' new followers');
  if (clk && clk.value != null) parts.push(fmt(clk.value) + ' clicks');
  more.append($('p', { text: parts.length ? R.month + ' so far: ' + parts.join(', ') + '.' : 'Results appear after the first stats pull.' }), R.newsletter ? $('p', { text: R.newsletter }) : '');
  const detail = $('div', { style: 'display:none' },
    $('div', { class: 'tiles' }, R.tiles.map(x => $('div', { class: 'tile' }, $('b', { text: fmt(x.value) }), x.title + pct(x.value, x.prev)))),
    R.top.length ? $('p', { style: 'margin:14px 0 4px', text: 'Top posts' }) : '',
    R.top.map(p => $('div', { class: 'row' }, $('span', { text: p.caption.slice(0, 70) }), p.url ? $('a', { class: 'link', href: p.url, target: '_blank', text: 'See' }) : '')),
    R.report_url ? $('p', {}, $('a', { class: 'link', href: R.report_url, target: '_blank', text: 'Monthly report (PDF)' })) : '');
  more.append($('a', { class: 'link', href: '#', text: 'See more', on: { click: e => { e.preventDefault(); detail.style.display = detail.style.display ? '' : 'none'; } } }), detail);
}
call('getClientPosts', BOOT.token).then(d => {
  results(d.results);
  const open = d.posts.filter(p => p.status === 'in_review' || p.status === 'plan');
  const box = document.getElementById('box');
  const items = open.map(p => {
    const caps = p.posts.filter((x, i, a) => a.findIndex(y => y.caption === x.caption) === i);
    const plan = p.status === 'plan';
    return {
      label: [$('b', { text: plan ? 'Idea for a post' : isNews(p) ? 'Newsletter' : 'Post' }), ' · ' + p.when],
      body: [mediaEl(p.media, p.preview), ...caps.map(x => textEl(x.caption)),
        p.deadline ? $('p', { class: 'mute', text: 'Please answer by ' + p.deadline + '.' }) : ''],
      ask: plan ? 'Good idea?' : isNews(p) ? 'Good to send?' : 'Good to post?',
      yes: ['Looks good', () => call('clientDecide', BOOT.token, p.ids, 'approve', '')],
      change: ['Change something', 'What should we change?', n => call('clientDecide', BOOT.token, p.ids, 'change', n)],
      skip: ['Skip this one', () => call('clientDecide', BOOT.token, p.ids, 'skip', '')],
    };
  });
  runQueue(items, box, document.getElementById('count'), () => box.append($('div', { class: 'card done' },
    $('h2', { text: items.length ? 'All done, thank you!' : 'All caught up' }),
    $('p', { class: 'mute', text: 'We will email you when new posts are ready.' }))));
});
</script></body></html>`;
