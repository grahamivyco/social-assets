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
// "Mail" tab, written by the n8n "Open Frame inbox sorter" (local AI on the Mac). triageMail (every 10 minutes) files each
// email under a Gmail label, closes leads who ask not to be contacted, and puts AI replies in Gmail drafts.
// Lead and client emails that need a reply become cards here. Nothing is sent without your Send.
const MAIL_HEAD = ['message_id', 'received_at', 'from_email', 'from_name', 'subject', 'snippet', 'type', 'needs_reply', 'draft', 'optout', 'status', 'draft_id', 'thread_id', 'note', 'updated_at'];
const MAIL_LABELS = { lead: 'Open Frame/Leads', client: 'Open Frame/Clients', money: 'Open Frame/Money', admin: 'Open Frame/Admin', noise: 'Open Frame/Noise', check: 'Open Frame/Check' };
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
  askAllScopes_();
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
    .filter(t => ['morningDigest', 'checkIn', 'urgentCheck', 'healthCheck', 'triageMail'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkIn').timeBased().onWeekDay(ScriptApp.WeekDay[CHECKIN_DAY]).atHour(CHECKIN_HOUR).inTimezone(TZ).create();
  ScriptApp.newTrigger('urgentCheck').timeBased().atHour(URGENT_HOUR).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('healthCheck').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('triageMail').timeBased().everyMinutes(10).create();
  hubTab_('Mail', MAIL_HEAD);
  hubTab_('Projects', PROJECT_HEAD);
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
  const lines = ['Your check-in page. Bookmark it:', '', adminUrl_(), '', 'Or sign in from your site, on any device:', '', STUDIO_URL, '',
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
    if (b.fn === 'studio') return ContentService.createTextOutput(JSON.stringify(studioApi_(b))).setMimeType(ContentService.MimeType.JSON);
    checkKey_(b.key);
    if (b.fn === 'graphics') out = withLock_(() => graphicsApi_(b));
    else if (b.fn === 'loops') out = withLock_(() => loopsApi_(b));
    else throw new Error('Unknown request');
  } catch (x) { out = { error: x.message || String(x) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Studio: the private sign-in page on openframe.design/studio ----------
// Sign in with a 6-digit code (or the button) emailed to an address on the list. Nothing to install, no password.
// Admins (the account that owns this script, plus STUDIO_ADMINS) get the check-in cards and Results.
// A client contact (any contact_email in the Clients tab) gets their own review cards and results.
// Each sign-in lasts STUDIO_DAYS on that device, renewed while it's used. The "Studio sessions" tab keeps only a hash of each one:
// delete a row to sign that device out. Removing someone from contact_email cuts them off on their next tap.

const STUDIO_URL = 'https://openframe.design/studio/';
const STUDIO_ADMINS = [];   // extra admin emails, e.g. a VA. The script owner is always an admin.
const STUDIO_DAYS = 30;
const STUDIO_CODE_MIN = 15;
// Sign in with Google on the Studio page: the OAuth Web client ID (public, not a secret). Or a GOOGLE_CLIENT_ID Script Property.
const GOOGLE_CLIENT_ID = '444041586250-vmsnmvs3glhetpoidhb11r4g7ds4rfd8.apps.googleusercontent.com';
const SESSION_HEAD = ['session', 'email', 'role', 'brand', 'created', 'expires', 'last_used'];
// What a signed-in admin can run. Each takes the admin key first; the Studio never sees the key, the server adds it.
const STUDIO_ADMIN_FNS = { getDashboard, adminPost, adminTopic, adminCaption, adminReply, adminEngage, adminLead, adminPhoto, adminNotifyClient, adminGraphic, adminLoop, studioResults, studioReels, studioStatus, adminReelAsk, studioApprovals, adminApproval };

function studioApi_(b) {
  try {
    const email = String(b.email || '').trim().toLowerCase();
    if (b.op === 'ask') return studioAsk_(email);
    if (b.op === 'code') return studioCode_(email, String(b.code || '').replace(/\D/g, ''));
    if (b.op === 'link') return studioLink_(String(b.token || ''));
    if (b.op === 'config') return { google: GOOGLE_CLIENT_ID || PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '' };
    if (b.op === 'google') return studioGoogle_(String(b.credential || ''));
    const s = studioSession_(String(b.s || ''));
    if (b.op === 'me') return { who: s.who };
    if (b.op === 'out') { withLock_(() => setCells_(s.t, s.r._row, { expires: new Date().toISOString() })); return { ok: true }; }
    if (b.op === 'call') {
      const args = Array.isArray(b.args) ? b.args : [];
      if (s.who.role === 'admin') {
        const fn = STUDIO_ADMIN_FNS[b.name];
        if (!fn) throw new Error('Unknown request');
        return { out: fn(adminKey_(), ...args) };
      }
      const c = Object.assign({ email: s.who.email }, clients_().find(x => x.brand === s.who.brand));
      if (b.name === 'getClientPosts') return { out: clientPosts_(c) };
      if (b.name === 'getClientProjects') return { out: clientProjects_(c) };
      if (b.name === 'clientDecide') return { out: clientDecide_(c, (args[0] || []).map(String), args[1], args[2] || '') };
      if (b.name === 'getClientApprovals') return { out: clientApprovals_(c) };
      if (b.name === 'clientApproval') return { out: withLock_(() => clientApproval_(c, String(args[0] || ''), String(args[1] || ''), args[2] || '')) };
      throw new Error('Unknown request');
    }
    throw new Error('Unknown request');
  } catch (x) {
    // Our own messages are plain sentences. Google's system errors (permissions, quotas) carry links or
    // service names and can come in Spanish, so clients get a plain line and the details go to the log.
    const msg = x.message || String(x);
    if (/https?:\/\/|[A-Z]\w+App\.|Exception|Service invoked|permis/i.test(msg)) {
      console.error('Studio: ' + msg);
      return { error: 'Something went wrong on my side. Try again in a minute, or use your email to get a code.' };
    }
    return { error: msg, signedOut: !!x.signedOut };
  }
}

// Who an email is right now: admin, a client contact, or nobody.
function studioWho_(email) {
  const extra = String(PropertiesService.getScriptProperties().getProperty('STUDIO_ADMINS') || '');
  const admins = emails_([me_()].concat(STUDIO_ADMINS).join(',') + ',' + extra);
  if (admins.indexOf(email) >= 0) return { role: 'admin', email, name: 'Open Frame' };
  const c = email && clients_().find(x => emails_(x.contact_email).indexOf(email) >= 0);
  return c ? { role: 'client', email, brand: c.brand, name: c.client } : null;
}

// Always answers the same way, so the page never tells anyone which emails are on the list.
// At most one code a minute and five an hour per address.
function studioAsk_(email) {
  const cache = CacheService.getScriptCache();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return { error: 'Please check your email address.' };
  const who = studioWho_(email);
  const n = Number(cache.get('studio-n:' + email) || 0);
  if (!who || cache.get('studio-wait:' + email) || n >= 5) return { ok: true };
  const code = String(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid())
    .slice(0, 4).reduce((a, x) => a * 256 + ((x + 256) % 256), 0) % 1e6).padStart(6, '0');
  const token = hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now());
  cache.put('studio-code:' + email, JSON.stringify({ code, tries: 0 }), STUDIO_CODE_MIN * 60);
  cache.put('studio-link:' + token, email, STUDIO_CODE_MIN * 60);
  cache.put('studio-wait:' + email, '1', 60);
  cache.put('studio-n:' + email, String(n + 1), 3600);
  sendStudioCode_(email, code, STUDIO_URL + '#t=' + token);
  return { ok: true };
}

function studioCode_(email, code) {
  const cache = CacheService.getScriptCache(), key = 'studio-code:' + email;
  const saved = JSON.parse(cache.get(key) || 'null');
  if (!saved) return { error: 'That code expired. Ask for a new one.' };
  if (saved.code !== code) {
    saved.tries++;
    if (saved.tries >= 5) cache.remove(key); else cache.put(key, JSON.stringify(saved), STUDIO_CODE_MIN * 60);
    return { error: saved.tries >= 5 ? 'Too many tries. Ask for a new code.' : 'That code doesn\'t match. Check the newest email.' };
  }
  cache.remove(key);
  return studioStart_(email);
}

function studioLink_(token) {
  const cache = CacheService.getScriptCache(), email = token && cache.get('studio-link:' + token);
  if (!email) return { error: 'That sign-in link expired. Ask for a new code.' };
  cache.remove('studio-link:' + token);
  cache.remove('studio-code:' + email);
  return studioStart_(email);
}

// Google's button hands the page a signed ID token. Google checks the signature for us (tokeninfo); we check it was made
// for this site's client ID and the email is verified, then it's the same as a code sign-in.
function studioGoogle_(credential) {
  const id = GOOGLE_CLIENT_ID || PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!id || !credential) return { error: 'Google sign-in isn\'t set up yet. Use the email code.' };
  let r;
  try {
    r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
  } catch (e) {
    // Usually the script hasn't been allowed to reach Google yet: run checkGoogleSignIn in the editor and click Allow.
    console.error('Studio Google sign-in: ' + e.message);
    return { error: 'Google sign-in isn\'t working right now. Use your email to get a code instead.' };
  }
  if (r.getResponseCode() !== 200) return { error: 'Google sign-in didn\'t go through. Try again.' };
  const t = JSON.parse(r.getContentText());
  if (t.aud !== id || String(t.email_verified) !== 'true' || !/accounts\.google\.com$/.test(t.iss || '')) return { error: 'Google sign-in didn\'t go through. Try again.' };
  return studioStart_(String(t.email || '').toLowerCase());
}

// Google lets people untick single permissions on the Allow screen, and then never asks again on its own.
// This makes Google show the Allow screen for anything still missing (like reaching Google for Studio's sign-in).
function askAllScopes_() {
  if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

// Run this from the editor if Google sign-in on Studio fails. It asks for any missing permission, then checks
// the script can reach Google's sign-in check. The result shows in the Execution log.
function checkGoogleSignIn() {
  askAllScopes_();
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  console.log('Reached Google (answer ' + r.getResponseCode() + ', 400 is expected for a test token). Google sign-in on Studio should work now.');
}

function studioStart_(email) {
  const who = studioWho_(email);
  if (!who) return { error: 'This email doesn\'t have access.' };
  const session = hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now() + email);
  withLock_(() => {
    const t = hubTab_('Studio sessions', SESSION_HEAD), now = new Date();
    t.rows.filter(r => !(new Date(r.expires) > now)).map(r => r._row).sort((a, b) => b - a).forEach(n => t.sh.deleteRow(n));
    t.sh.appendRow([hex_(session), email, who.role, who.brand || '', now.toISOString(), new Date(now.getTime() + STUDIO_DAYS * 864e5).toISOString(), now.toISOString()]);
  });
  return { session, who };
}

// A live session whose email still has access. Renews the 30 days at most once an hour.
function studioSession_(session) {
  const out = () => { const e = new Error('Please sign in again.'); e.signedOut = true; return e; };
  if (!/^[0-9a-f]{64}$/.test(session)) throw out();
  const t = hubTab_('Studio sessions', SESSION_HEAD), h = hex_(session);
  const r = t.rows.find(x => x.session === h);
  if (!r || !(new Date(r.expires) > new Date())) throw out();
  const who = studioWho_(r.email);
  if (!who) throw out();
  if (!within_(r.last_used, 1 / 24)) {
    const now = new Date();
    setCells_(t, r._row, { last_used: now.toISOString(), expires: new Date(now.getTime() + STUDIO_DAYS * 864e5).toISOString() });
  }
  return { t, r, who };
}

// ---------- Studio projects (Projects tab) ----------
// One row per client project, edited by Graham in the Sheet. A signed-in client sees their own rows as Project cards.
// brand = the client's brand in the Clients tab. stage = a name from PROJECT_STAGES or its number (1-5).
// status: blank = active, done = finished (shows as Done), hidden = not shown. link: optional https link to the latest work.
const PROJECT_HEAD = ['brand', 'project', 'stage', 'next', 'need', 'due', 'note', 'link', 'status', 'updated'];
const PROJECT_STAGES = ['Discover', 'Define', 'Design', 'Build', 'Launch'];

function clientProjects_(c) {
  const t = table_(hubId_(), 'Projects');
  if (!t || !c.brand) return { stages: PROJECT_STAGES, projects: [] };
  const stageOf = v => {
    const x = String(v || '').trim(), n = Number(x);
    if (n >= 1 && n <= PROJECT_STAGES.length) return n - 1;
    return PROJECT_STAGES.findIndex(st => st.toLowerCase() === x.toLowerCase());
  };
  const projects = t.rows.filter(r => r.brand === c.brand && r.project && !/^hid/i.test(r.status || '')).map(r => ({
    project: r.project, stage: stageOf(r.stage), done: /^(done|finished|complete)/i.test(r.status || ''),
    next: r.next || '', need: r.need || '', due: r.due || '', note: r.note || '', updated: r.updated || '',
    link: /^https:\/\//.test(r.link || '') ? r.link : '',
  }));
  projects.sort((a, b) => a.done - b.done);
  return { stages: PROJECT_STAGES, projects };
}

function hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function sendStudioCode_(email, code, link) {
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = '<div style="background:#f3f1ea;padding:32px 16px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111110">'
    + '<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2ded2;border-radius:20px;padding:36px 32px;text-align:center">'
    + '<img src="https://openframe.design/icon-192.png" width="44" height="44" alt="Open Frame" style="display:block;margin:0 auto 20px">'
    + '<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4b4a46;margin:0 0 8px">Studio sign-in</p>'
    + '<p style="font-family:Georgia,serif;font-size:40px;letter-spacing:.18em;margin:6px 0 20px">' + esc(code) + '</p>'
    + '<a href="' + esc(link) + '" style="display:inline-block;background:#111110;color:#f3f1ea;text-decoration:none;font-weight:600;font-size:16px;padding:15px 30px;border-radius:100px">Sign in</a>'
    + '<p style="color:#84827b;font-size:13px;line-height:1.5;margin:26px 0 0">Type the code or tap the button. It works for ' + STUDIO_CODE_MIN + ' minutes. Didn\'t ask for this? Ignore it, nothing happens.</p>'
    + '</div></div>';
  MailApp.sendEmail({
    to: email, name: FROM_NAME, replyTo: REPLY_TO,
    subject: 'Your Open Frame sign-in code: ' + code,
    body: 'Your sign-in code: ' + code + '\n\nOr tap to sign in:\n\n' + link + '\n\nIt works for ' + STUDIO_CODE_MIN + ' minutes. Didn\'t ask for this? Ignore it, nothing happens.',
    htmlBody: html,
  });
}

// The Results view: each client's month so far, what every loop made in the last 7 days, and what you said yes to.
function studioResults(key) {
  checkKey_(key);
  const since = Date.now() - 7 * 864e5;
  const clients = clients_().map(c => { try { return { client: c.client, brand: c.brand, results: results_(c) }; } catch (e) { return { client: c.client, brand: c.brand, results: { empty: true } }; } });
  const ss = SpreadsheetApp.openById(hubId_());
  const runs = {};
  if (ss.getSheetByName('Loop runs')) table_(hubId_(), 'Loop runs').rows.filter(r => r.loop && new Date(r.at).getTime() > since).forEach(r => {
    const x = runs[r.loop] || (runs[r.loop] = { loop: r.loop, runs: 0, made: 0, kept: 0, cards: 0, failed: 0, last: '', note: '' });
    x.runs++; x.made += num_(r.made) || 0; x.kept += num_(r.kept) || 0; x.cards += num_(r.cards) || 0;
    if (/fail|error/i.test(r.status)) x.failed++;
    if (String(r.at) > x.last) { x.last = String(r.at); x.note = r.note || ''; }
  });
  const yes = ss.getSheetByName('Loops') ? table_(hubId_(), 'Loops').rows
    .filter(r => r.id && ['yes', 'sent', 'change'].indexOf(r.status) >= 0 && new Date(r.updated).getTime() > since)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 12)
    .map(r => ({ title: r.title, loop: r.loop, client: r.client, status: r.status, link: r.link, when: fmtWhen_(r.updated) })) : [];
  return { clients, runs: Object.keys(runs).map(k => runs[k]).sort((a, b) => b.last.localeCompare(a.last)).map(x => Object.assign(x, { last: fmtWhen_(x.last) })), yes };
}

// ---------- Reels: the Reels tab in the Studio ----------
// Script cards by type (Loops rows with loop 'scripts': kind of | personal | viral), a "new scripts" button per type
// (adds a 'reel-ask' row the Mac's loops/asks.js answers with the local AI), the Reel drafts waiting for a yes,
// and the Mac's own status (the 'Mac status' tab, written every 2 minutes by mac/keeper.js).
const REEL_TYPES = { of: 'Open Frame', personal: 'Personal', viral: 'Viral in my niche' };
const MAC_HEAD = ['check', 'label', 'status', 'detail', 'since', 'updated_at', 'fix'];
const MAC_STALE_MIN = 15;     // no word from the Mac helper for this long = the Mac is off, asleep or the helper stopped
const MAC_FAIL_MIN = 10;      // something down this long (the helper couldn't fix it) = Heads up card + one email

function studioReels(key) {
  checkKey_(key);
  const ss = SpreadsheetApp.openById(hubId_());
  const lp = ss.getSheetByName('Loops') ? table_(hubId_(), 'Loops').rows : [];
  const scripts = lp.filter(r => r.id && r.loop === 'scripts' && ['ready', 'todo', 'change'].indexOf(r.status) >= 0)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))
    .map(r => ({ id: r.id, type: REEL_TYPES[r.kind] ? r.kind : 'of', title: String(r.title || '').replace(/^Film this: /, ''),
      body: r.body, why: r.why, status: r.status, note: r.note, when: fmtWhen_(r.created) }));
  const asks = uniq_(lp.filter(r => r.loop === 'reel-ask' && r.status === 'new').map(r => r.kind));
  const drafts = [];
  uniq_(clients_().map(c => c.sheet_id)).forEach(sid => {
    const q = table_(sid, 'Queue');
    if (!q) return;
    const byBrand = {};
    clients_().forEach(c => { byBrand[c.brand] = c; });
    groupPosts_(q.rows.filter(r => r.id && r.type === 'reel' && ['draft', 'in_review', 'changes'].indexOf(r.status) >= 0), sid, byBrand)
      .forEach(g => drafts.push(Object.assign(g, { media: g.media.filter(u => /\.mp4($|\?)/i.test(u)) })));
  });
  drafts.sort((a, b) => String(a.publish_at).localeCompare(String(b.publish_at)));
  return { types: REEL_TYPES, scripts, asks, drafts, mac: macStatus_() };
}

// "New scripts" button. One waiting ask per type is enough; the Mac answers it within a few minutes.
function adminReelAsk(key, type, note) {
  checkKey_(key);
  if (!REEL_TYPES[type]) throw new Error('Unknown script type');
  return withLock_(() => {
    const t = hubTab_('Loops', LOOP_HEAD), now = new Date().toISOString();
    if (t.rows.some(r => r.loop === 'reel-ask' && r.kind === type && r.status === 'new')) return 'waiting';
    const row = { id: 'reel-ask-' + type + '-' + Date.now(), loop: 'reel-ask', client: 'open-frame', kind: type,
      title: 'New ' + REEL_TYPES[type] + ' scripts', body: String(note || '').slice(0, 500), status: 'new', created: now, updated: now };
    t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
    return 'asked';
  });
}

// Status tab: what the Mac keeper sees right now, plus the n8n health check's rows (workflows, Meta token).
function studioStatus(key) {
  checkKey_(key);
  const t = table_(hubId_(), 'Health');
  const hb = t && t.rows.find(r => r.check === 'heartbeat');
  const n8n = t ? t.rows.filter(r => r.check && r.check !== 'heartbeat').map(r => ({ label: r.label || r.check, status: String(r.status).toLowerCase(),
    detail: r.detail, link: /^https:/.test(r.link || '') ? r.link : '', when: fmtWhen_(r.updated_at) })) : [];
  return { mac: macStatus_(), n8n, n8nLast: hb ? fmtWhen_(hb.updated_at) : '', n8nStale: !hb || !within_(hb.updated_at, 2 / 24) };
}

function macStatus_() {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName('Mac status')) return { rows: [], updated: '', stale: true, never: true };
  const rows = table_(hubId_(), 'Mac status').rows.filter(r => r.check);
  const last = rows.map(r => String(r.updated_at)).sort().pop() || '';
  const t = last ? new Date(last).getTime() : 0;
  return { rows: rows.map(r => ({ check: r.check, label: r.label, status: r.status, detail: r.detail, fix: r.fix, since: fmtWhen_(r.since) })),
    updated: fmtWhen_(last), stale: !t || Date.now() - t > MAC_STALE_MIN * 6e4, never: !t };
}

// The Mac helper reports here: rows of { check, label, status: ok | fixing | fail, detail, fix }. 'since' moves only when the status changes.
function macReport_(rows) {
  const t = hubTab_('Mac status', MAC_HEAD), now = new Date().toISOString();
  (rows || []).forEach(x => {
    if (!x || !x.check) return;
    const r = t.rows.find(y => y.check === x.check);
    const row = { check: x.check, label: x.label || x.check, status: x.status || 'ok', detail: x.detail || '', fix: x.fix || '', updated_at: now };
    if (!r) { row.since = now; t.sh.appendRow(t.head.map(h => safeCell_(row[h]))); t.rows.push(row); return; }
    if (r.status !== row.status) row.since = now;
    setCells_(t, r._row, row);
  });
  return { ok: true };
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
    const mid = rows.length ? rows[Math.floor(rows.length / 2)].score : null;   // sorted high to low, so this is the median
    return { posts: rows.length, median: mid, top: rows.slice(0, 5), weakest: rows.length > 5 ? rows.slice(-3) : [] };
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
    // Key accounts first (Targets handles, not hashtag finds), then the freshest posts: a comment in the first hours gets seen.
    const key = r => (stage[String(r.handle).replace(/^@/, '')] !== undefined ? 0 : 1);
    const fresh = (e ? e.rows : []).filter(r => r.post_id && r.status === 'new')
      .sort((x, y) => key(x) - key(y) || String(y.posted_at).localeCompare(String(x.posted_at)));
    return { fresh: fresh.slice(0, Number(b.limit) || 15).map(r => Object.assign(pick(r), { key: !key(r) })),
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
  if (b.action === 'lead-set') {
    // A loop moves a lead on (e.g. the client signed the quote in Studio -> stage won, which starts onboarding).
    const l = table_(OUTREACH_SHEET_ID, 'Leads'), r = findRow_(l, 'id', b.id);
    setCells_(l, r._row, Object.assign({}, b.fields || {}, { updated_at: new Date().toISOString() }));
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
  if (b.action === 'brands-list') {
    // Brand deals: the brand scout + contact finder rows (Brands tab, outreach Sheet).
    const t = table_(OUTREACH_SHEET_ID, 'Brands');
    return { rows: (t ? t.rows : []).filter(r => r.handle && (!b.statuses || b.statuses.indexOf(String(r.status).toLowerCase()) >= 0)).map(r => ({
      handle: r.handle, name: r.name || r.handle, website: r.website, bio: String(r.bio || '').slice(0, 300), fit: String(r.fit || '').toLowerCase(), why: r.fit_why || r.why || '',
      status: String(r.status || '').toLowerCase(), contact_email: r.contact_email, program_url: r.program_url, creators_seen: r.creators_seen,
      pitched_at: String(r.pitched_at || ''), followed_up: r.followed_up || '' })) };
  }
  if (b.action === 'brand-set') {
    const t = table_(OUTREACH_SHEET_ID, 'Brands'), r = findRow_(t, 'handle', b.handle);
    setCells_(t, r._row, b.fields || {});
    return { ok: true };
  }
  if (b.action === 'key-accounts') {
    // Key accounts = Targets (ideal clients, partners). With what they posted lately and who reached out (Inbox).
    const tg = table_(OUTREACH_SHEET_ID, 'Targets'), e = table_(OUTREACH_SHEET_ID, 'Engage');
    const c = clients_().find(x => x.brand === (b.client || 'open-frame')), ib = c ? table_(c.sheet_id, 'Inbox') : null;
    const h = s => String(s || '').replace(/^@/, '').trim().toLowerCase();
    const accounts = (tg ? tg.rows : []).filter(r => r.handle && r.stage !== 'pass' && !/^TEMPLATE/.test(r.handle)).map(r => ({
      handle: h(r.handle), name: r.name || r.org || '', stage: r.stage || '', notes: String(r.notes || '').slice(0, 200),
      posts: (e ? e.rows : []).filter(x => h(x.handle) === h(r.handle)).slice(-3).map(x => String(x.caption || '').slice(0, 300)) }));
    const keys = accounts.map(a => a.handle);
    const touches = (ib ? ib.rows : []).filter(r => within_(r.received_at || r.timestamp, 8) && keys.indexOf(h(r.username || r.sender)) >= 0)
      .map(r => ({ handle: h(r.username || r.sender), kind: r.kind || 'dm', text: String(r.text || '').slice(0, 200), at: String(r.received_at || r.timestamp) }));
    return { accounts, touches };
  }
  if (b.action === 'approval-add') return approvalAdd_(b.rows);
  if (b.action === 'approval-list') return approvalList_(b);
  if (b.action === 'approval-set') return approvalSet_(b.rows);
  if (b.action === 'approval-sync') return syncApprovals_();
  if (b.action === 'mac') return macReport_(b.rows);
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
    if (r.loop === 'phone' && action === 'done') phonePosted_(r.id.replace(/^phone-/, ''));
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
  if (p.api === 'studio_js') return ContentService.createTextOutput(HELPERS_JS + (p.r === 'client' ? CLIENT_JS : ADMIN_JS)).setMimeType(ContentService.MimeType.JAVASCRIPT);
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
  const out = { clients: clients.map(c => ({ client: c.client, brand: c.brand, contact_email: c.contact_email, client_approves: c.client_approves })), topics: [], approve: [], review: [], feedback: [], failed: [], upcoming: [], inbox: [], engage: [], photos: [], fixes: [], leads: [], graphics: [], loops: [], mail: [], pipeline: {} };
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
  const mail = SpreadsheetApp.openById(hubId_()).getSheetByName('Mail') ? table_(hubId_(), 'Mail') : null;
  if (mail) mail.rows.filter(r => r.message_id && r.status === 'drafted').forEach(r => out.mail.push({
    id: r.message_id, who: r.from_name || r.from_email, email: r.from_email, type: r.type, subject: r.subject, snippet: r.snippet,
    draft: r.draft_id ? r.draft : '', link: r.thread_id ? 'https://mail.google.com/mail/u/0/#all/' + r.thread_id : 'https://mail.google.com/',
  }));
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
    if (status === 'approved') phoneReels_();
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

// ---------- email (Mail tab) ----------

function triageMail() {
  try { withLock_(phoneReels_); } catch (e) { console.error('phoneReels_: ' + e.message); }   // rides this 10-minute trigger, no setup re-run
  withLock_(() => {
    const t = hubTab_('Mail', MAIL_HEAD), now = new Date().toISOString();
    const clientEmails = [].concat.apply([], clients_().map(c => emails_(c.contact_email)));
    const done = {};
    t.rows.forEach(r => { if (r.status && r.status !== 'new') done[r.message_id] = true; });
    t.rows.filter(r => r.message_id && r.status === 'new').slice(0, 20).forEach(r => {
      if (done[r.message_id]) return setCells_(t, r._row, { status: 'dup', updated_at: now });
      done[r.message_id] = true;
      const mid = String(r.message_id).replace(/^<|>$/g, '');
      const th = GmailApp.search('rfc822msgid:' + mid, 0, 1)[0];
      if (!th) { if (!within_(r.received_at, 2)) setCells_(t, r._row, { status: 'missing', updated_at: now }); return; }
      const type = clientEmails.indexOf(String(r.from_email).toLowerCase()) >= 0 ? 'client' : (r.type || 'check');
      if (MAIL_LABELS[type]) th.addLabel(GmailApp.getUserLabelByName(MAIL_LABELS[type]) || GmailApp.createLabel(MAIL_LABELS[type]));
      const set = { type, thread_id: th.getId(), updated_at: now };
      if (r.optout === 'yes') {
        leadFromMail_(r, { stage: 'lost', status: '', notes: 'Asked not to be contacted (' + now.slice(0, 10) + ')' });
        Object.assign(set, { status: 'done', note: 'Asked not to be contacted. Lead closed, no reply.' });
      } else if ((type === 'lead' || type === 'client') && r.needs_reply === 'yes') {
        if (r.draft) set.draft_id = mailMessage_(th, mid).createDraftReply(r.draft).getId();
        set.status = 'drafted';
        if (type === 'lead') leadFromMail_(r, {});
      } else set.status = 'done';
      setCells_(t, r._row, set);
      try { dealOffer_(r, th, clients_()); } catch (e) { console.error('dealOffer_: ' + e.message); }
    });
  });
}

// A brand offering a deal (a reply from a brand we pitched, or an email that talks sponsorship, collab or UGC)
// = one brand_deal row for Studio. Always the client's call. deals.js picks up the answer and drafts the reply.
const DEAL_WORDS = /\b(sponsor\w*|collab\w*|partnership|paid (post|partnership)|ugc|ambassador|gifted|brand deal|campaign brief|rate card|creator program)\b/i;
function dealOffer_(r, th, clients) {
  const from = String(r.from_email || '').toLowerCase(), text = [r.subject, r.snippet].join(' ');
  const br = table_(OUTREACH_SHEET_ID, 'Brands'), brand = br && br.rows.find(x => from && String(x.contact_email || '').toLowerCase() === from);
  if (!brand && (!DEAL_WORDS.test(text) || r.type === 'noise')) return;
  // A client forwarding an offer = their deal. Anything else = the studio's own brand (first row of the Clients tab).
  const c = clients.find(x => emails_(x.contact_email).indexOf(from) >= 0) || clients[0];
  if (!c) return;
  approvalAdd_([{ id: 'deal-offer-' + hex_(String(r.message_id)).slice(0, 12), client: c.brand, kind: 'brand_deal',
    title: 'Offer from ' + ((brand && brand.name) || r.from_name || from), detail: String(r.subject || '').slice(0, 120) + '. ' + String(r.snippet || '').slice(0, 220),
    preview: 'https://mail.google.com/mail/u/0/#all/' + th.getId(), made_by: 'deals', status: 'draft' }]);
  if (brand) setCells_(br, brand._row, { status: 'replied' });
}

function mailMessage_(th, mid) {
  const msgs = th.getMessages();
  return msgs.filter(m => String(m.getHeader('Message-ID') || '').indexOf(mid) >= 0)[0] || msgs[msgs.length - 1];
}

// A lead who emails joins the Leads tab once (the lead follow-up workflow then plans nudges). Later emails refresh last_contact.
function leadFromMail_(r, extra) {
  const t = table_(OUTREACH_SHEET_ID, 'Leads');
  if (!t) return;
  const email = String(r.from_email || '').toLowerCase(), now = new Date().toISOString();
  const row = t.rows.find(x => String(x.email).toLowerCase() === email);
  if (row) return setCells_(t, row._row, Object.assign({ last_contact: now, updated_at: now }, extra));
  const v = Object.assign({ id: 'em:' + email, added: now, source: 'email', name: r.from_name || '', email, stage: 'talking', last_contact: now,
    step: 'synced', notes: 'First email: ' + (r.subject || ''), updated_at: now }, extra);
  t.sh.appendRow(t.head.map(h => safeCell_(v[h])));
}

function adminMail(key, id, action, text) {
  checkKey_(key);
  return withLock_(() => {
    const t = hubTab_('Mail', MAIL_HEAD), r = findRow_(t, 'message_id', id), now = new Date().toISOString();
    const drop = () => { if (r.draft_id) try { GmailApp.getDraft(r.draft_id).deleteDraft(); } catch (e) { /* already sent or deleted in Gmail */ } };
    if (action === 'send') {
      if (text || !r.draft_id) {
        drop();
        const th = GmailApp.getThreadById(r.thread_id);
        mailMessage_(th, String(r.message_id).replace(/^<|>$/g, '')).createDraftReply(text || r.draft).send();
      } else GmailApp.getDraft(r.draft_id).send();
      setCells_(t, r._row, { status: 'sent', note: text ? 'edited before sending' : '', updated_at: now });
      if (r.type === 'lead') leadFromMail_(r, {});
    } else if (action === 'skip') {
      drop();
      setCells_(t, r._row, { status: 'skipped', updated_at: now });
    } else if (action === 'done') setCells_(t, r._row, { status: 'done', updated_at: now });
    else throw new Error('Unknown action');
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

function getClientPosts(token) { return clientPosts_(clientByLink_(token)); }
function clientPosts_(c) {
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

function clientDecide(token, ids, decision, note) { return clientDecide_(clientByLink_(token, true), ids, decision, note); }
// c.email is who answered: the review link's address, or the signed-in Studio email.
function clientDecide_(c, ids, decision, note) {
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
    if (map[0] === 'approved') phoneReels_();
    if (decision === 'change') {
      MailApp.sendEmail(me_(), c.client + ' asked for a change', c.email + ' wrote: ' + note + '\n\nOpen your dashboard:\n\n' + adminUrl_());
    }
    return map[0];
  });
}

// ---------- Approvals tab (Studio Phase 2 reads it) ----------
// One row per decision, for Graham's Studio Home and each client's "Ready for you" list.
// Format: Open-Frame docs/approval-items.md. Which loop writes which row: social-assets loops/APPROVALS.md.
// Loops write id..status (fn 'loops', action 'approval-add'); Studio writes answer, comment, updated.
// Queue rows (posts, Reels, newsletters) get their rows from syncApprovals_ every hour, both ways:
// an answer on the old cards shows up here, and an answer Studio writes here moves the Queue row, so the poster keeps working.
const APPROVAL_HEAD = ['id', 'client', 'kind', 'title', 'detail', 'job', 'preview', 'options', 'due', 'client_ok', 'made_by', 'status', 'answer', 'comment', 'updated'];
const APPROVAL_KINDS = ['post', 'reel', 'newsletter', 'report', 'pick_one', 'design', 'set', 'launch', 'files', 'brand_deal', 'reply', 'repost', 'ad_spend', 'request', 'hours', 'quote', 'invoice'];
const APPROVAL_CLIENT_ALWAYS = ['brand_deal', 'ad_spend', 'repost', 'quote'];
const APPROVAL_DONE = ['approved', 'changes', 'skipped'];
const MONTHLY_PLANS = ['Care', 'Starter', 'Growth', 'Full Comms'];
// The sync's memory of what it last saw on each row, so it can tell a Studio answer from its own copy.
const APPROVAL_SEEN_HEAD = ['id', 'seen', 'at'];

function approvalsTable_() { return hubTab_('Approvals', APPROVAL_HEAD); }

// Checks and fills a row the way approval-items.md says. Throws on a bad kind so a loop can't invent one.
function approvalRow_(r, clients) {
  const kind = String(r.kind || '').trim();
  if (APPROVAL_KINDS.indexOf(kind) < 0) throw new Error('Approvals: unknown kind "' + kind + '". Use one from approval-items.md or ask for a new one.');
  if (!r.id || !r.title) throw new Error('Approvals: id and title are required');
  const c = (clients || clients_()).find(x => x.brand === r.client || x.client === r.client);
  // Left blank, the client's client_approves (Clients tab) decides. Replies are Graham's unless a loop marks one touchy.
  let ok = r.client_ok == null || r.client_ok === '' ? (kind !== 'reply' && c && c.client_approves ? 'yes' : 'no') : /^(y|yes|true)$/i.test(String(r.client_ok)) ? 'yes' : 'no';
  if (APPROVAL_CLIENT_ALWAYS.indexOf(kind) >= 0) ok = 'yes';
  // planned = in the works, nothing to answer yet (the client's Coming up list). The loop moves it on with approval-set.
  const status = r.status === 'planned' ? 'planned' : r.status === 'client' && ok === 'yes' ? 'client' : 'draft';
  // A plain date stays as it is (new Date would read it as UTC midnight, the day before in Chicago).
  const raw = String(r.due || '').trim(), dd = raw ? new Date(raw) : null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dd && !isNaN(dd) ? Utilities.formatDate(dd, TZ, 'yyyy-MM-dd') : '';
  return {
    id: String(r.id), client: c ? c.client : String(r.client || ''), kind, title: String(r.title).slice(0, 120), detail: String(r.detail || '').slice(0, 400),
    job: r.job || approvalJob_(c ? c.brand : '', approvalProjects_()), preview: r.preview || '', options: kind === 'pick_one' ? [].concat(r.options || []).join(' | ') : '',
    due, client_ok: ok, made_by: r.made_by || 'graham', status,
  };
}

function approvalAdd_(rows) {
  const t = approvalsTable_(), clients = clients_();
  let added = 0;
  (rows || []).forEach(r => {
    const row = approvalRow_(r, clients);
    if (t.rows.some(x => x.id === row.id)) return;
    t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
    t.rows.push(row); added++;
  });
  return { added };
}

function approvalList_(b) {
  const want = b.status ? [].concat(b.status) : null, ids = b.ids ? [].concat(b.ids) : null;
  return { rows: approvalsTable_().rows.filter(r => r.id && (!b.made_by || r.made_by === b.made_by) && (!want || want.indexOf(r.status) >= 0)
    && (!ids || ids.indexOf(r.id) >= 0) && (!b.client || r.client === b.client)).map(r => { const o = Object.assign({}, r); delete o._row; return o; }) };
}

// A loop moves its own planned row on (planned -> draft or client) and fills in the preview, title or due date.
// Rows that are past planned belong to Studio and the sync, so they're left alone.
function approvalSet_(rows) {
  const t = approvalsTable_(), clients = clients_();
  let moved = 0;
  (rows || []).forEach(r => {
    const cur = t.rows.find(x => x.id && x.id === String(r.id));
    if (!cur || cur.status !== 'planned') return;
    const row = approvalRow_(Object.assign({}, cur, r), clients), diff = {};
    ['title', 'detail', 'job', 'preview', 'options', 'due', 'client_ok', 'status'].forEach(k => { if (String(cur[k] || '') !== String(row[k] || '')) diff[k] = row[k]; });
    if (Object.keys(diff).length) { setCells_(t, cur._row, diff); Object.assign(cur, diff); moved++; }
  });
  return { moved };
}

// ---------- Studio v1: reading and answering Approvals rows ----------
// The buttons Studio draws for each kind (approval-items.md). What a button does:
// ok = approved (Graham's ok on a client_ok row sends it to the client instead), change = changes + their note,
// skip = skipped, later = answer noted, still waiting, open = just opens the preview link (the page there does the rest).
const APPROVAL_BUTTONS = {
  post: [['Looks good', 'ok'], ['Change', 'change'], ['Skip', 'skip']],
  reel: [['Looks good', 'ok'], ['Change', 'change'], ['Skip', 'skip']],
  newsletter: [['Open draft', 'open'], ['Looks good', 'ok'], ['Change', 'change']],
  report: [['Mark read', 'ok'], ['Ask a question', 'change']],
  pick_one: [['Comment', 'change']],
  design: [['Looks good', 'ok'], ['Change', 'change']],
  set: [['Approve set', 'ok'], ['Change one', 'change']],
  launch: [['Approve to launch', 'ok'], ['Not yet', 'change']],
  files: [['Approve and download', 'ok']],
  brand_deal: [['Yes, go ahead', 'ok'], ['Not for us', 'skip'], ['Ask a question', 'change']],
  reply: [['Send as is', 'ok'], ['Change', 'change'], ["I'll handle it", 'skip']],
  repost: [['Approve', 'ok'], ['Skip', 'skip']],
  ad_spend: [['Approve spend', 'ok'], ['No', 'skip']],
  request: [['Upload', 'open'], ['Not yet', 'later']],
  hours: [['Approve hours', 'ok'], ['Question', 'change']],
  quote: [['Sign', 'open']],
  invoice: [['Pay now', 'open']],
};
// Rows the loops that read Queue and Inbox sheets made: an answer here has to reach those sheets right away.
const APPROVAL_SYNCED = ['content-plan', 'reel-watch', 'newsletter', 'replies'];

function approvalButtons_(r) {
  const b = APPROVAL_BUTTONS[r.kind] || [];
  if (r.kind !== 'pick_one') return b;
  return String(r.options || '').split('|').map(o => o.trim()).filter(Boolean).map(o => [o, 'ok']).concat(b);
}

// What Studio gets for one row: the row without its sheet position, plus its buttons.
function approvalView_(r) {
  const o = Object.assign({}, r);
  delete o._row;
  o.buttons = approvalButtons_(r).map(b => ({ label: b[0], act: b[1] }));
  return o;
}

const byDue_ = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'));
const recent_ = (r, days) => APPROVAL_DONE.indexOf(r.status) >= 0 && within_(r.updated, days);

// Graham's Home: what needs him first (draft), what waits on a client, what's being redone or in the works, and the last week's answers.
function studioApprovals(key) {
  checkKey_(key);
  const rows = approvalsTable_().rows.filter(r => r.id), pick = st => rows.filter(r => r.status === st).sort(byDue_).map(approvalView_);
  return { needs: pick('draft'), waiting: pick('client'), changing: pick('changes'), planned: pick('planned'),
    done: rows.filter(r => recent_(r, 7)).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).map(approvalView_) };
}

function adminApproval(key, id, label, comment) {
  checkKey_(key);
  return withLock_(() => {
    const t = approvalsTable_(), r = findRow_(t, 'id', id);
    if (r.status !== 'draft') throw new Error('Someone already answered this one. Refresh the page.');
    return answerApproval_(t, r, label, comment, true);
  });
}

// A client's page: Ready for you (waiting on them), Coming up (in the works or being redone), and the last month's answers.
function clientApprovals_(c) {
  const rows = approvalsTable_().rows.filter(r => r.id && r.client === c.client);
  const view = r => { const o = approvalView_(r); if (r.status !== 'client') o.buttons = []; return o; };
  return { ready: rows.filter(r => r.status === 'client').sort(byDue_).map(view),
    coming: rows.filter(r => r.status === 'planned' || r.status === 'changes').sort(byDue_).map(view),
    done: rows.filter(r => recent_(r, 30)).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).map(view) };
}

function clientApproval_(c, id, label, comment) {
  const t = approvalsTable_(), r = findRow_(t, 'id', id);
  if (r.client !== c.client) throw new Error('That item moved or was removed. Refresh the page.');
  if (r.status !== 'client') throw new Error('This one was already answered. Refresh the page.');
  return answerApproval_(t, r, label, comment, false);
}

// Writes the answer (status, answer, comment, updated), then runs the sync for Queue and Inbox rows so the post or reply moves now, not at the next hourly run.
function answerApproval_(t, r, label, comment, byGraham) {
  const btn = approvalButtons_(r).find(b => b[0] === label);
  if (!btn) throw new Error('That button does not fit this item. Refresh the page.');
  const act = btn[1], note = String(comment || '').trim().slice(0, 1000);
  if (act === 'open') return approvalView_(r);
  if (act === 'change' && !note) throw new Error('Add a short note first, so the change is clear.');
  let set = { status: { ok: 'approved', change: 'changes', skip: 'skipped', later: r.status }[act], answer: label, comment: act === 'change' ? note : '', updated: new Date().toISOString() };
  // Graham's ok on something the client signs off on hands it to them; the answer stays theirs to give.
  if (byGraham && act === 'ok' && r.client_ok === 'yes') set = { status: 'client', answer: '', comment: '', updated: set.updated };
  setCells_(t, r._row, set);
  Object.assign(r, set);
  if (APPROVAL_SYNCED.indexOf(r.made_by) >= 0) try { syncApprovals_(); } catch (e) { console.error('Approvals sync after answer: ' + e.message); }
  return approvalView_(r);
}

let approvalProjectsCache_;
function approvalProjects_() { return approvalProjectsCache_ || (approvalProjectsCache_ = table_(hubId_(), 'Projects')); }
// The client's monthly plan from the Projects tab, for the job column.
function approvalJob_(brand, projects) {
  const p = (projects ? projects.rows : []).find(r => r.brand === brand && MONTHLY_PLANS.indexOf(String(r.project).trim()) >= 0 && !/^(hid|done|finished)/i.test(r.status || ''));
  return p ? String(p.project).trim() : 'none';
}

// One Approvals row per Queue decision: a post's Instagram and Facebook copies are one decision, a topic (plan) is
// another, and each revision after a Change is a new one (-r1, -r2), so the history stays readable.
function queueDecisions_(c, q, projects) {
  const groups = {};
  q.rows.filter(r => r.id && r.brand === c.brand).forEach(r => {
    const base = String(r.id).replace(/-(ig|fb|instagram|facebook)$/i, '');
    const k = r.publish_at ? [r.publish_at, r.type].join('|') : base;
    (groups[k] = groups[k] || []).push(r);
  });
  const out = [];
  Object.keys(groups).forEach(k => {
    const rows = groups[k].sort((a, b) => String(a.id).localeCompare(String(b.id))), r0 = rows[0];
    const pick = f => (rows.find(r => r[f]) || {})[f] || '';
    const base = String(r0.id).replace(/-(ig|fb|instagram|facebook)$/i, '');
    const status = r0.status, rev = Math.max.apply(null, rows.map(r => Number(r.revision) || 0));
    const order = ['instagram', 'facebook'], plats = uniq_(rows.map(r => r.platform)).sort((x, y) => (order.indexOf(x) + 1 || 9) - (order.indexOf(y) + 1 || 9))
      .map(p => ({ instagram: 'Instagram', facebook: 'Facebook' }[p] || p));
    const kind = r0.platform === 'newsletter' ? 'newsletter' : r0.type === 'reel' ? 'reel' : 'post';
    const media = String(pick('media_url')).split(/\s+/).filter(Boolean);
    const when = r0.publish_at ? Utilities.formatDate(new Date(r0.publish_at), TZ, 'EEE MMM d') : '';
    const words = String(pick('hook') || pick('caption') || pick('pillar')).split('\n')[0].slice(0, 90);
    const plan = status === 'plan';
    const row = {
      id: base + (plan ? '-plan' : rev ? '-r' + rev : ''), client: c.client, kind,
      title: plan ? 'Topic: ' + words : words || (kind === 'newsletter' ? 'Newsletter' : 'Post') + (when ? ' for ' + when : ''),
      detail: plan ? 'Topic for ' + (when || 'next month') + '. The post gets made after a yes.'
        : (kind === 'newsletter' ? 'Goes out ' : 'Posts ') + (when || 'when it gets a date') + (kind === 'newsletter' ? '' : ' on ' + plats.join(' and ')) + '.' + (rev ? ' Updated after the last note.' : ''),
      job: approvalJob_(c.brand, projects), preview: pick('preview_url') || media[0] || '',
      due: pick('review_deadline'), client_ok: c.client_approves ? 'yes' : 'no',
      made_by: kind === 'newsletter' ? 'newsletter' : kind === 'reel' ? 'reel-watch' : 'content-plan',
    };
    const dec = pick('client_decision'), note = pick('client_note') || pick('review_note');
    const fromDecision = { 'Approve': 'approved', 'Request change': 'changes', 'Skip': 'skipped' }[dec];
    if (plan) row.status = fromDecision || (c.client_approves ? 'client' : 'draft');
    else row.status = { draft: 'draft', in_review: 'client', changes: 'changes', approved: 'approved', phone: 'approved', posted: 'approved', failed: 'approved', skipped: 'skipped' }[status] || '';
    if (row.status === 'client' && !c.client_approves) row.status = 'draft';
    if (APPROVAL_DONE.indexOf(row.status) >= 0) {
      row.answer = { approved: 'Looks good', changes: 'Change', skipped: 'Skip' }[row.status];
      row.comment = row.status === 'changes' ? note : '';
      row.updated = pick('decided_at');
    }
    row.open = plan ? !dec : ['draft', 'in_review', 'changes'].indexOf(status) >= 0;
    row.queue = { sheetId: c.sheet_id, ids: rows.map(r => r.id), status, plan };
    out.push(row);
  });
  return out;
}

function syncApprovalsNow() { return withLock_(syncApprovals_); }

function syncApprovals_() {
  const t = approvalsTable_(), seenT = hubTab_('Approvals sync', APPROVAL_SEEN_HEAD);
  const byId = {}, seen = {};
  t.rows.forEach(r => { if (r.id) byId[r.id] = r; });
  seenT.rows.forEach(r => { if (r.id) seen[r.id] = r; });
  const projects = table_(hubId_(), 'Projects'), stamp = r => [r.status, r.answer, r.comment].join('|');
  const out = { added: 0, mirrored: 0, applied: 0 }, now = new Date().toISOString();
  let approvedAny = false;
  const all = clients_(), ds = [];
  all.forEach(c => { const q = table_(c.sheet_id, 'Queue'); if (q) queueDecisions_(c, q, projects).forEach(d => ds.push([c, d])); });
  uniq_(all.map(c => c.sheet_id)).forEach(sid => {
    const ib = table_(sid, 'Inbox');
    if (ib) inboxDecisions_(all.filter(c => c.sheet_id === sid), ib, sid).forEach(x => ds.push(x));
    const ph = table_(sid, 'Photo submissions');
    if (ph) photoDecisions_(all.filter(c => c.sheet_id === sid), ph, sid).forEach(x => ds.push(x));
  });
  ds.forEach(([c, d]) => {
      const cur = byId[d.id];
      if (!cur) {
        if (!d.open) return;   // history (posted, skipped before this existed) stays out
        const row = Object.assign(approvalRow_(d, [c]), { status: d.status, answer: d.answer || '', comment: d.comment || '', updated: d.updated || '' });
        t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
        byId[d.id] = row; out.added++;
        return remember_(seenT, seen, d.id, stamp(row), now);
      }
      // Studio changed the row since the last run: move the Queue or Inbox row to match, if it's still waiting.
      // Only Studio edits these rows after they're made, so any change since the last run is Studio's.
      const studio = seen[d.id] && seen[d.id].seen !== stamp(cur);
      if (studio && (d.inbox ? applyStudioReply_ : d.photo ? applyStudioPhoto_ : applyStudioAnswer_)(d, cur)) { out.applied++; if (cur.status === 'approved' && d.queue) approvedAny = true; return remember_(seenT, seen, d.id, stamp(cur), now); }
      const want = { status: d.status, title: d.title, detail: d.detail, preview: d.preview, due: approvalRow_(d, [c]).due };
      // Inbox and photo rows have no "waiting on the client" state of their own, so a row Studio sent to the client stays there.
      if (!d.queue && cur.status === 'client' && d.status === 'draft') want.status = 'client';
      // A photo's to_post means Graham's yes or the client's; once the client approved it, it stays approved.
      if (d.photo && cur.status === 'approved' && d.status === 'client') want.status = 'approved';
      const answerMoved = cur.status !== d.status || String(cur.answer || '') !== d.answer || String(cur.comment || '') !== String(d.comment || '');
      if (d.answer && answerMoved) Object.assign(want, { answer: d.answer, comment: d.comment, updated: d.updated || now });
      const diff = {};
      Object.keys(want).forEach(k => { if (String(cur[k] || '') !== String(want[k] || '')) diff[k] = want[k]; });
      if (Object.keys(diff).length) { setCells_(t, cur._row, diff); Object.assign(cur, diff); out.mirrored++; }
      remember_(seenT, seen, d.id, stamp(cur), now);
  });
  loopCardAnswers_(t, out);
  reportRows_(t, byId, out);
  launchRows_(t, byId, out);
  if (approvedAny) phoneReels_();
  return out;
}

// Monthly reports: a new report_url in the Clients tab (the report run on the 2nd sets it) = one report row for that month.
// Mark read closes it. Ask a question (changes + comment) = a Got it card for Graham with their question.
function reportRows_(t, byId, out) {
  clients_().forEach(c => {
    if (!/^https:\/\//.test(c.report_url)) return;
    // Month from a #yyyy-mm on the link (Drive links carry it there), else any yyyy-mm in the path, else this month.
    const m = c.report_url.match(/#(20\d\d-\d\d)\b/) || c.report_url.match(/(20\d\d-\d\d)/), month = m ? m[1] : Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    const id = 'report-' + c.brand + '-' + month;
    if (byId[id]) return;
    const label = Utilities.formatDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 15), TZ, 'MMMM yyyy');
    const row = Object.assign(approvalRow_({ id, client: c.client, kind: 'report', title: 'Your ' + label + ' report',
      detail: 'How ' + label.split(' ')[0] + ' went, on one page, with what comes next.', preview: c.report_url,
      client_ok: c.client_approves ? 'yes' : 'no', made_by: 'report' }, [c]), { answer: '', comment: '', updated: '' });
    t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
    byId[id] = row; out.added++;
  });
  const asks = t.rows.filter(r => /^report-/.test(r.id) && r.status === 'changes' && r.comment);
  if (!asks.length) return;
  const lt = hubTab_('Loops', LOOP_HEAD), now = new Date().toISOString();
  asks.forEach(r => {
    const id = r.id + '-question';
    if (lt.rows.some(x => x.id === id)) return;
    const card = { id, loop: 'report', client: r.client, kind: 'report question', status: 'todo', title: r.client + ' asked about their report',
      body: r.comment, link: r.preview, created: now, updated: now };
    lt.sh.appendRow(lt.head.map(h => safeCell_(card[h])));
    lt.rows.push(card); out.added++;
  });
}

// Website launches: a Projects row at stage Launch with an https staging link = one launch row (Approve to launch / Not yet).
// Approve = a Got it card for Graham to go live. Not yet = a card with their note.
function launchRows_(t, byId, out) {
  const pj = approvalProjects_();
  if (!pj) return;
  const cs = clients_(), last = PROJECT_STAGES.length - 1;
  pj.rows.filter(r => r.brand && r.project && /^https:\/\//.test(r.link || '') && !/^(hid|done|finished|complete)/i.test(r.status || '')
      && (String(r.stage).trim() === String(last + 1) || String(r.stage).trim().toLowerCase() === PROJECT_STAGES[last].toLowerCase())).forEach(r => {
    const c = cs.find(x => x.brand === r.brand);
    const id = 'launch-' + r.brand + '-' + hex_(String(r.project)).slice(0, 8);
    if (!c || byId[id]) return;
    const row = Object.assign(approvalRow_({ id, client: c.client, kind: 'launch', title: r.project + ' is ready to go live',
      detail: r.next || 'Have a look at the staging site. Approve it and it goes live.', job: r.project, preview: r.link, due: r.due,
      client_ok: c.client_approves ? 'yes' : 'no', made_by: 'projects', status: c.client_approves ? 'client' : 'draft' }, [c]), { answer: '', comment: '', updated: '' });
    t.sh.appendRow(t.head.map(h => safeCell_(row[h])));
    byId[id] = row; out.added++;
  });
  const done = t.rows.filter(r => /^launch-/.test(r.id) && APPROVAL_DONE.indexOf(r.status) >= 0);
  if (!done.length) return;
  const lt = hubTab_('Loops', LOOP_HEAD), now = new Date().toISOString();
  done.forEach(r => {
    const id = r.id + '-' + r.status;
    if (lt.rows.some(x => x.id === id)) return;
    const go = r.status === 'approved';
    const card = { id, loop: 'projects', client: r.client, kind: 'launch', status: 'todo', link: r.preview, created: now, updated: now,
      title: go ? r.client + ' approved: ' + r.title.replace(/ is ready to go live$/, '') + ' goes live' : r.client + ' said not yet on ' + r.title.replace(/ is ready to go live$/, ''),
      body: go ? 'Point the domain at the new site and check it on a phone.' + (r.comment ? ' Their note: ' + r.comment : '') : (r.comment || 'No note left.') };
    lt.sh.appendRow(lt.head.map(h => safeCell_(card[h])));
    lt.rows.push(card); out.added++;
  });
}

// A loop that also makes an old Loops card (same id) gets Graham's answer there copied in while the row still waits on him:
// Yes / Send -> client (or approved when the client doesn't sign off), Change -> changes, Pass -> skipped.
function loopCardAnswers_(t, out) {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName('Loops')) return;
  const cards = {};
  table_(hubId_(), 'Loops').rows.forEach(r => { if (r.id) cards[r.id] = r; });
  t.rows.filter(r => r.id && r.status === 'draft' && cards[r.id]).forEach(r => {
    const k = cards[r.id], ok = r.client_ok === 'yes';
    const set = { yes: ok ? { status: 'client' } : { status: 'approved', answer: 'Looks good' }, sent: { status: ok ? 'client' : 'approved' }, done: { status: ok ? 'client' : 'approved' },
      change: { status: 'changes', answer: 'Change', comment: k.note || '' }, pass: { status: 'skipped', answer: 'Skip' } }[k.status];
    if (!set) return;
    set.updated = k.updated || new Date().toISOString();
    setCells_(t, r._row, set); Object.assign(r, set); out.mirrored++;
  });
}

function remember_(t, seen, id, value, now) {
  const s = seen[id];
  if (s && s.seen === value) return;
  if (s && s._row) setCells_(t, s._row, { seen: value, at: now });
  else { t.sh.appendRow([id, value, now]); seen[id] = { id, seen: value, _row: t.sh.getLastRow() }; }
}

// Comment and DM replies waiting on a yes (Inbox status needs_reply, from the n8n comment replies + DM inbox workflows).
// Everyday ones are Graham's (client_ok no). Touchy ones (upset, press, donors, sponsors) go to the client too,
// when the client signs off on their own posts (client_approves). Rows without a brand belong to the first client on that Sheet.
const TOUCHY_REPLY = /\b(journalist|reporter|press|article|interview|podcast|news|donat\w*|donor|gift|grant|sponsor\w*|lawyer|legal|refund|complain\w*)\b/i;
function inboxDecisions_(cs, ib, sid) {
  return ib.rows.filter(r => r.id && ['needs_reply', 'approved', 'sent', 'handled'].indexOf(r.status) >= 0).map(r => {
    const c = cs.find(x => x.brand === r.brand) || cs[0];
    const who = r.username || r.sender_name || r.sender || 'someone', dm = (r.kind || 'dm') === 'dm';
    const touchy = r.intent === 'upset' || TOUCHY_REPLY.test(r.text || '');
    const status = { needs_reply: r.review_note ? 'changes' : 'draft', approved: 'approved', sent: 'approved', handled: 'skipped' }[r.status];
    const d = {
      id: 'reply-' + r.id, client: c.client, kind: 'reply',
      title: (dm ? 'Reply to a message from ' : 'Reply to a comment from ') + (who[0] === '@' || / /.test(who) ? who : '@' + who),
      detail: ('They wrote: ' + String(r.text || '').slice(0, 160) + (r.draft_reply ? ' Reply: ' + String(r.draft_reply).slice(0, 180) : '')).trim(),
      job: 'none', preview: '', options: '',
      // Meta closes DM replies 24 hours after their message.
      due: dm && r.received_at ? new Date(new Date(r.received_at).getTime() + 864e5).toISOString() : '',
      client_ok: touchy && c.client_approves ? 'yes' : 'no', made_by: 'replies', status, open: r.status === 'needs_reply',
      inbox: { sheetId: sid, id: r.id, status: r.status },
    };
    if (status !== 'draft') {
      d.answer = { skipped: "I'll handle it", changes: 'Change' }[status] || 'Send as is';
      d.comment = status === 'changes' ? r.review_note : ''; d.updated = r.sent_at || '';
    }
    return [c, d];
  });
}

// Photos members send in (Photo submissions tab, n8n content submissions) are someone else's photos, so each needs a repost yes
// from the client (client_ok always yes). Graham's Use on the old card = his yes, so it moves to the client.
// Rows without a brand belong to the first client on that Sheet who signs off on their own posts.
function photoDecisions_(cs, ph, sid) {
  const owner = cs.find(c => c.client_approves) || cs[0];
  return ph.rows.filter(r => r.file && ['new', 'to_post', 'skip', 'posted'].indexOf(r.status) >= 0).map(r => {
    const c = cs.find(x => x.brand === r.brand) || owner, from = r.from_name || r.from_email || 'a member';
    const status = { new: 'draft', to_post: 'client', posted: 'approved', skip: 'skipped' }[r.status];
    const d = {
      id: 'repost-' + hex_(String(r.received) + '|' + r.file).slice(0, 12), client: c.client, kind: 'repost',
      title: 'Share a photo from ' + from, detail: [r.what || r.topic, r.caption ? 'Caption idea: ' + r.caption : ''].filter(Boolean).join('. ').slice(0, 300),
      job: approvalJob_(c.brand, approvalProjects_()), preview: /^https:\/\//.test(r.file) ? r.file : '', client_ok: 'yes', made_by: 'content-submissions',
      status, open: r.status === 'new', photo: { sheetId: sid, row: r._row, received: r.received, status: r.status },
    };
    if (status === 'approved' || status === 'skipped') { d.answer = status === 'approved' ? 'Approve' : 'Skip'; d.comment = ''; d.updated = ''; }
    return [c, d];
  });
}

// Studio's answer on a photo: Approve -> to_post, Skip -> skip. Sent to the client -> nothing to change yet.
function applyStudioPhoto_(d, a) {
  if (['new', 'to_post'].indexOf(d.photo.status) < 0) return false;
  if (a.status === 'client') return true;
  const set = { approved: 'to_post', skipped: 'skip' }[a.status];
  if (!set) return false;
  const t = table_(d.photo.sheetId, 'Photo submissions'), r = t.rows.find(x => x._row === d.photo.row && x.received === d.photo.received);
  if (!r) return false;
  setCells_(t, r._row, { status: set });
  return true;
}

// Studio's answer on a reply: Send as is -> approved (n8n sends it), I'll handle it -> handled,
// Change -> the note goes on the Inbox row (review_note) and the reply waits for a new draft on the old card.
function applyStudioReply_(d, a) {
  if (d.inbox.status !== 'needs_reply') return false;
  const set = { approved: { status: 'approved' }, skipped: { status: 'handled' }, changes: { review_note: a.comment || 'Change' } }[a.status];
  if (a.status === 'client') return true;   // waiting on the client now; nothing to do in the Inbox yet
  if (!set) return false;
  const ib = table_(d.inbox.sheetId, 'Inbox');
  setCells_(ib, findRow_(ib, 'id', d.inbox.id)._row, set);
  return true;
}

// An answer from Studio, written onto the Queue rows the same way the old cards do it. False = the Queue moved on already.
function applyStudioAnswer_(d, a) {
  const qs = d.queue, st = qs.status;
  const q = table_(qs.sheetId, 'Queue'), at = a.updated || new Date().toISOString();
  const waiting = qs.plan ? d.open : (st === 'draft' || st === 'in_review');
  if (!waiting) return false;
  let set;
  if (a.status === 'client' && st === 'draft') set = { status: 'in_review' };
  else if (APPROVAL_DONE.indexOf(a.status) >= 0) {
    const dec = { approved: 'Approve', changes: 'Request change', skipped: 'Skip' }[a.status];
    set = { client_decision: dec, client_note: a.status === 'changes' ? a.comment || '' : '', answered_by: 'Studio', decided_at: at };
    if (!qs.plan) set.status = a.status;
  } else return false;
  qs.ids.forEach(id => setCells_(q, findRow_(q, 'id', id)._row, set));
  return true;
}

// ---------- Reels posted from the phone (Graham, 2026-10-21) ----------
// Instagram's API can't add music from its library, so an approved IG Reel for a client with reel_music = app
// (Clients tab; Open Frame defaults to app) never reaches the n8n poster: it moves to status 'phone' and a
// "Post from your phone" card lands in Needs you with the video, the caption and this week's trending sounds.
// Got it on the card marks the row posted. Queue column `music` = none on a row lets that one auto-post silent.
// The Facebook copy still auto-posts. Runs right after an approval and every 10 minutes (triageMail trigger).
const SOUNDS_URL = 'https://raw.githubusercontent.com/grahamivyco/social-assets/main/loops/state/audio.json';

function phoneReels_() {
  const byBrand = {};
  clients_().forEach(c => { byBrand[c.brand] = c; });
  const loops = hubTab_('Loops', LOOP_HEAD), now = new Date().toISOString();
  let sounds = null;
  uniq_(clients_().map(c => c.sheet_id)).forEach(sid => {
    const q = table_(sid, 'Queue');
    if (!q) return;
    q.rows.filter(r => r.id && r.status === 'approved' && !r.posted_at && r.platform === 'instagram' && r.type === 'reel'
      && String(r.music || '').toLowerCase() !== 'none' && byBrand[r.brand] && byBrand[r.brand].reel_music === 'app').forEach(r => {
      if (sounds === null) sounds = trendingSounds_();
      setCells_(q, r._row, { status: 'phone' });
      const id = 'phone-' + r.id;
      if (loops.rows.some(x => x.id === id)) return;
      const video = String(r.media_url || '').split(/\s+/).filter(u => /^https:/.test(u))[0] || '';
      const row = { id, loop: 'phone', client: r.brand, kind: 'post from phone', status: 'todo',
        title: 'Post from your phone: ' + (r.hook || r.id), link: video,
        body: 'Post ' + fmtWhen_(r.publish_at) + '.\n\n' + (/^y(es)?$/i.test(String(r.trial || '')) ? 'Trial Reel: on the share screen turn on Trial, so it shows to non-followers first.\n\n' : '') + (sounds.length ? 'Sound (search it in the Reel audio picker, keep it low under your voice):\n' + sounds.join('\n') + '\n\n' : 'Sound: pick one with the trending arrow in the Reel audio picker, kept low under your voice.\n\n') + 'Caption:\n' + (r.caption || ''),
        ask: 'Open the video on your phone, save it, post it in Instagram with a sound' + (/^y(es)?$/i.test(String(r.trial || '')) ? ' and Trial on' : '') + '. Got it once it is live.', created: now, updated: now };
      loops.sh.appendRow(loops.head.map(h => safeCell_(row[h])));
      loops.rows.push(row);
    });
  });
}

// This week's top sounds from the audio loop (loops/audio.js pushes loops/state/audio.json from the Mac).
function trendingSounds_() {
  try {
    const r = UrlFetchApp.fetch(SOUNDS_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return [];
    return (JSON.parse(r.getContentText()).top || []).slice(0, 3).map((x, i) => (i + 1) + '. ' + x.name + (x.artist ? ' · ' + x.artist : ''));
  } catch (e) { return []; }
}

function phonePosted_(queueId) {
  uniq_(clients_().map(c => c.sheet_id)).some(sid => {
    const q = table_(sid, 'Queue'), r = q && q.rows.find(x => x.id === queueId);
    if (!r) return false;
    if (r.status === 'phone') setCells_(q, r._row, { status: 'posted', posted_at: new Date().toISOString() });
    return true;
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
    [d.mail.length, 'email to answer', 'emails to answer'], [d.leads.length, 'lead follow-up', 'lead follow-ups'], [d.graphics.length, 'graphic idea', 'graphic ideas'],
    [d.failed.length + d.fixes.length, 'thing to fix', 'things to fix'],
  ].filter(p => p[0]).map(p => p[0] + ' ' + (p[0] === 1 ? p[1] : p[2]));
  const total = d.topics.length + d.approve.length + d.inbox.length + d.engage.length + d.photos.length + d.mail.length + d.leads.length + d.graphics.length + d.failed.length + d.fixes.length;
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
    .concat(d.mail.map(m => ['e' + m.id, (m.who || 'Someone') + ' emailed: ' + (m.subject || m.snippet).slice(0, 80)]))
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
  try { syncApprovalsNow(); } catch (e) { Logger.log('Approvals sync: ' + e.message); }
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
  const out = { cards: macCards_() };
  const t = table_(hubId_(), 'Health');
  if (!t || !t.rows.length) return out;
  const hb = t.rows.find(r => r.check === 'heartbeat');
  if (!hb) return out;
  const ran = new Date(hb.updated_at).getTime();
  const yes = v => /^(y|yes|true)$/i.test(String(v || ''));
  // Rows from the hourly run, plus problems other tools write on their own (e.g. reel-drafts from the Mac) in the last 2 days.
  t.rows.filter(r => r.check && r.check !== 'heartbeat' && /^(warn|fail)$/i.test(r.status)
      && (r.updated_at === hb.updated_at || (r.updated_at > hb.updated_at && within_(r.updated_at, 2))))
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

// Things the Mac helper couldn't fix on its own for MAC_FAIL_MIN minutes: one card and one email each.
function macCards_() {
  const ss = SpreadsheetApp.openById(hubId_());
  if (!ss.getSheetByName('Mac status')) return [];
  const m = macStatus_();
  if (m.stale) return [];   // Mac off or asleep: the n8n heartbeat card covers that
  return table_(hubId_(), 'Mac status').rows.filter(r => r.check && r.status === 'fail' && !within_(r.since, MAC_FAIL_MIN / 1440))
    .map(r => ({ key: ['mac', r.check, r.since].join('|'), text: (r.label || r.check) + ': ' + (r.detail || 'stopped') + (r.fix ? ' ' + r.fix : ''),
      link: STUDIO_URL + '?tab=status', email: true }));
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
    reel_music: String(r.reel_music || (r.brand === 'open-frame' ? 'app' : 'auto')).toLowerCase(),
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

// Card helpers shared by both pages here and by the Studio page on openframe.design (served by api=studio_js).
const HELPERS_JS = `
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); Object.entries(a).forEach(([k, v]) => k === 'on' ? Object.entries(v).forEach(([n, f]) => e.addEventListener(n, f)) : k === 'text' ? e.textContent = v : e.setAttribute(k, v)); kids.flat().forEach(c => c && e.append(c)); return e; };
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

// Inside Apps Script pages: BOOT comes from the server and call() goes through google.script.run.
const SHARED_JS = `
const BOOT = __BOOT__;
const call = (fn, ...args) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(e => { alert(e.message || e); no(e); })[fn](...args));
` + HELPERS_JS;

// Your check-in cards. Same code runs here (?k=) and on openframe.design/studio, which brings its own call() and an empty K.
const ADMIN_JS = `
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
  d.mail.forEach(m => {
    const label = [$('b', { text: m.who || 'Someone' }), ' · ' + (m.type === 'client' ? 'client' : 'lead') + ' email'];
    const body = [$('p', { class: 'text', text: 'Subject: ' + m.subject }), $('div', { class: 'quote', text: m.snippet })];
    const openGmail = () => { window.open(m.link, '_blank'); return call('adminMail', K, m.id, 'done', ''); };
    if (m.draft) q.push({ label, body: body.concat([$('p', { class: 'text', text: 'Reply: ' + m.draft })]), ask: 'Send this reply?',
      yes: ['Send', () => call('adminMail', K, m.id, 'send', '')],
      change: ['Change', 'Your reply', n => call('adminMail', K, m.id, 'send', n), m.draft],
      skip: ['Don\\'t reply', () => call('adminMail', K, m.id, 'skip', '')] });
    else q.push({ label, body, ask: 'This one needs your own words.', yes: ['Open in Gmail', openGmail],
      change: ['Write it here', 'Your reply', n => call('adminMail', K, m.id, 'send', n), ''],
      skip: ['No reply needed', () => call('adminMail', K, m.id, 'skip', '')] });
  });
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
    if (l.to) q.push({ label, body: [$('p', { class: 'text', text: 'To: ' + l.to + '\\nSubject: ' + (l.subject || l.title) }), $('div', { class: 'quote', text: l.body }), l.why ? $('p', { class: 'mute', text: 'Why: ' + l.why }) : ''],
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
function startAdmin() {
  call('getDashboard', K).then(d => {
    summary(d);
    const box = document.getElementById('box');
    runQueue(build(d), box, document.getElementById('count'), () =>
      box.append($('div', { class: 'card done' }, $('h2', { text: 'All done' }), $('p', { class: 'mute', text: 'Nothing else needs you right now.' }))));
  });
}
`;

// A client's review cards. Same code runs here (?c=) and on openframe.design/studio for a signed-in client.
const CLIENT_JS = `
document.getElementById('h').textContent = BOOT.client;
function results(R) {
  const more = document.getElementById('more'); more.innerHTML = '';
  if (!R || R.empty) { more.append(BOOT.projects ? '' : $('p', { text: 'Results appear after the first stats pull.' }), R && R.newsletter ? $('p', { text: R.newsletter }) : ''); return; }
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
function startClient() {
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
    // A client with Project cards and no posts waiting doesn't need the "All caught up" card under them.
    if (!items.length && BOOT.projects) { box.textContent = ''; return; }
    runQueue(items, box, document.getElementById('count'), () => box.append($('div', { class: 'card done' },
      $('h2', { text: items.length ? 'All done, thank you!' : 'All caught up' }),
      $('p', { class: 'mute', text: 'We will email you when new posts are ready.' }))));
  });
}
`;

const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<div class="top"><h1>Check-in</h1><span class="count" id="count">Loading...</span></div>
<div id="box"></div><div class="more" id="more"></div></div>
<script>${SHARED_JS}
const K = BOOT.key;
${ADMIN_JS}
startAdmin();
</script></body></html>`;

const CLIENT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<div class="top"><h1 id="h"></h1><span class="count" id="count"></span></div>
<div id="box"><p class="mute">Loading...</p></div><div class="more" id="more"></div></div>
<script>${SHARED_JS}
${CLIENT_JS}
startClient();
</script></body></html>`;
