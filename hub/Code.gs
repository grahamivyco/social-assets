/**
 * Open Frame Hub
 * One-card-at-a-time page for everything that needs Graham, a no-login review
 * page per client, and a weekly (or every-2-weeks) check-in email. Runs free in Google Apps Script, bound to the
 * "NGM social queue" Sheet. Reads and writes the same tabs n8n uses.
 *
 * Setup (once): paste this file into Extensions > Apps Script, run setup(),
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone),
 * then run emailMeMyLinks().
 */

const TZ = 'America/Chicago';
// Check-in: one email with everything that needs you. 1 = every week, 2 = every 2 weeks.
const CHECKIN_EVERY_WEEKS = 1;
const CHECKIN_DAY = 'MONDAY';
const CHECKIN_HOUR = 9;
// Between check-ins you only hear about things that can't wait: a failed post, posting that stopped, a DM (Meta closes replies after 24 hours).
const URGENT_HOUR = 8;
const OUTREACH_SHEET_ID = '1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU';
// Column names follow /mnt/project-files/automation/queue-schema.md. review_note is Graham's own note.
const QUEUE_EXTRA = ['client_decision', 'client_note', 'answered_by', 'decided_at', 'revision', 'review_note'];
const CLIENT_HEAD = ['client', 'brand', 'sheet_id', 'token', 'contact_email', 'client_approves', 'report_url'];
const STUCK_HOURS = 2;

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
      ['Open Frame', 'open-frame', ss.getId(), token_(16), '', 'no', ''],
      ['Needlework Guild of Minnesota', 'ngm', ss.getId(), token_(16), '', 'yes', ''],
    ]);
  }

  ScriptApp.getProjectTriggers()
    .filter(t => ['morningDigest', 'checkIn', 'urgentCheck'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkIn').timeBased().onWeekDay(ScriptApp.WeekDay[CHECKIN_DAY]).atHour(CHECKIN_HOUR).inTimezone(TZ).create();
  ScriptApp.newTrigger('urgentCheck').timeBased().atHour(URGENT_HOUR).everyDays(1).inTimezone(TZ).create();
  Logger.log('Setup done. Now deploy as a web app, then run emailMeMyLinks.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hub')
    .addItem('Email me my links', 'emailMeMyLinks')
    .addItem('Send check-in now', 'checkInNow')
    .addToUi();
}

function emailMeMyLinks() {
  const base = baseUrl_();
  if (!base) throw new Error('Deploy the web app first: Deploy > New deployment > Web app.');
  const lines = ['Your dashboard (bookmark it, pin it in your life dashboard):', '', adminUrl_(), ''];
  clients_().forEach(c => lines.push(c.client + ' review page (send this to the client):', '', c.link, ''));
  MailApp.sendEmail(me_(), 'Your Hub links', lines.join('\n'));
}

// ---------- web ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.k && p.k === adminKey_()) return page_('Hub', ADMIN_HTML, { key: p.k });
  if (p.c) {
    const c = clients_().find(x => x.token === p.c);
    if (c) return page_(c.client + ' posts to review', CLIENT_HTML, { token: p.c, client: c.client });
  }
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">This link is not active. Ask Open Frame for a new one.</p>');
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
  const out = { clients, topics: [], approve: [], review: [], feedback: [], failed: [], upcoming: [], inbox: [], engage: [], photos: [], fixes: [] };
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

  const eng = table_(OUTREACH_SHEET_ID, 'Engage');
  if (eng) eng.rows.filter(r => r.status === 'drafted' && r.draft_comment).forEach(r => out.engage.push({
    id: r.post_id, handle: r.handle, url: r.post_url, caption: (r.caption || '').slice(0, 220), comment: r.draft_comment,
  }));

  clients.filter(c => c.client_approves && !c.contact_email)
    .forEach(c => out.fixes.push({ kind: 'setup', text: c.client + ' has no contact email in the Clients tab, so review emails can\'t go out. You can still send them the link yourself.' }));
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
  MailApp.sendEmail({
    to: c.contact_email,
    name: 'Open Frame',
    replyTo: me_(),
    subject: 'Your posts are ready to review',
    body: 'Hi,\n\nYour next posts are ready. Tap Approve or Request change on each one. No login needed.\n\n' + c.link + '\n\nThanks,\nGraham\nOpen Frame',
  });
  return 'sent';
}

// ---------- client page ----------

function getClientPosts(token) {
  const c = clientByToken_(token);
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
  if (!acc.length && !posts.length) return { empty: true, report_url: c.report_url };
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
  return { empty: false, month: label(month), prevMonth: label(prev), tiles, top, report_url: c.report_url };
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
  const c = clientByToken_(token);
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
        answered_by: 'client review page', decided_at: new Date().toISOString(),
      };
      if (!isPlan) set.status = map[0]; // plan rows keep status plan; the monthly loop reads client_decision
      setCells_(q, r._row, set);
    });
    if (decision === 'change') {
      MailApp.sendEmail(me_(), c.client + ' asked for a change', 'Note: ' + note + '\n\nOpen your dashboard:\n\n' + adminUrl_());
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
}

function checkInNow() {
  const d = getDashboard(adminKey_());
  const parts = [
    [d.topics.length, 'topic idea', 'topic ideas'], [d.approve.length, 'post', 'posts'], [d.inbox.length, 'message', 'messages'],
    [d.engage.length, 'comment to leave', 'comments to leave'], [d.photos.length, 'photo sent in', 'photos sent in'],
    [d.failed.length + d.fixes.length, 'thing to fix', 'things to fix'],
  ].filter(p => p[0]).map(p => p[0] + ' ' + (p[0] === 1 ? p[1] : p[2]));
  const total = d.topics.length + d.approve.length + d.inbox.length + d.engage.length + d.photos.length + d.failed.length + d.fixes.length;
  const lines = total
    ? ['You have ' + total + ' to go through: ' + parts.join(', ') + '.', '', 'Tap Yes or Change on each one:', '', adminUrl_()]
    : ['Nothing needs you this time.'];
  const fyi = [];
  if (d.upcoming.length) fyi.push(d.upcoming.length + (d.upcoming.length === 1 ? ' post' : ' posts') + ' going out this week');
  if (d.review.length) fyi.push(d.review.length + ' waiting on clients');
  if (fyi.length) lines.push('', fyi.join(', ') + '.');
  MailApp.sendEmail(me_(), total ? 'Check-in: ' + total + (total === 1 ? ' thing needs you' : ' things need you') : 'Check-in: nothing needs you', lines.join('\n'));
}

// Daily, but only emails when something new can't wait for the check-in.
function urgentCheck() {
  const d = getDashboard(adminKey_());
  const items = d.failed.map(g => ['f' + g.ids[0], g.clientName + ': the post for ' + g.when + " didn't go out."])
    .concat(d.fixes.filter(f => f.kind === 'stuck').map(f => ['s' + f.text, f.text]))
    .concat(d.inbox.map(m => ['m' + m.id, (m.who || 'Someone') + ' sent a message: ' + m.text.slice(0, 80)]));
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty('URGENT_SEEN') || '[]');
  const fresh = items.filter(x => seen.indexOf(x[0]) < 0);
  props.setProperty('URGENT_SEEN', JSON.stringify(items.map(x => x[0]).slice(-200)));
  if (!fresh.length) return;
  MailApp.sendEmail(me_(), fresh.length === 1 ? 'One thing can\'t wait' : fresh.length + " things can't wait",
    fresh.map(x => '- ' + x[1]).join('\n') + '\n\nHandle it here:\n\n' + adminUrl_());
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
  return t.rows.filter(r => r.brand && r.token).map(r => ({
    client: r.client || r.brand, brand: r.brand, sheet_id: r.sheet_id || hubId_(), token: r.token,
    contact_email: r.contact_email || '', report_url: r.report_url || '', client_approves: /^(y|yes|true)$/i.test(r.client_approves || ''),
    link: baseUrl_() + '?c=' + r.token,
  }));
}

function clientByToken_(token) {
  const c = token && clients_().find(x => x.token === token);
  if (!c) throw new Error('This link is not active.');
  return c;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { const out = fn(); SpreadsheetApp.flush(); return out; } finally { lock.releaseLock(); }
}

function checkKey_(key) { if (!key || key !== adminKey_()) throw new Error('Not allowed'); }
function adminKey_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_KEY'); }
function hubId_() { return PropertiesService.getScriptProperties().getProperty('HUB_ID') || SpreadsheetApp.getActiveSpreadsheet().getId(); }
function baseUrl_() { return ScriptApp.getService().getUrl() || ''; }
function adminUrl_() { return baseUrl_() + '?k=' + adminKey_(); }
function me_() { return Session.getEffectiveUser().getEmail(); }
function uniq_(a) { return a.filter((x, i) => a.indexOf(x) === i); }
function within_(s, days) { const t = new Date(s).getTime(); return t && Date.now() - t < days * 864e5; }
function fmtWhen_(s) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d) ? Utilities.formatDate(d, TZ, 'EEE MMM d, h:mm a') : 'no date yet';
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
function mediaEl(urls, poster) {
  if (!urls.length && poster) urls = [poster];
  if (!urls.length) return '';
  return $('div', { class: 'media' + (urls.length > 1 ? ' many' : '') }, urls.map(u => /\\.(mp4|mov|webm)(\\?|$)/i.test(u)
    ? $('video', Object.assign({ src: u, controls: '', preload: 'metadata', playsinline: '' }, poster ? { poster } : {}))
    : $('img', { src: u, loading: 'lazy', alt: '' })));
}
// One card at a time. Each item: { label, body: [nodes], ask, yes: [text, fn], change: [text, placeholder, fn, prefill] | null, skip: [text, fn] | null }
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
    btns.append($('button', { class: 'yes', text: it.yes[0], on: { click: () => busy(card, it.yes[1]) } }));
    if (it.change) btns.append($('button', { text: it.change[0], on: { click: () => {
      const ta = $('textarea', { placeholder: it.change[1] }); ta.value = it.change[3] || '';
      const send = $('button', { class: 'yes', text: 'Send', on: { click: () => { if (!ta.value.trim()) return ta.focus(); busy(card, () => it.change[2](ta.value.trim())); } } });
      const back = $('button', { text: 'Back', on: { click: show } });
      btns.replaceWith($('div', {}, ta, $('div', { class: 'btns' }, back, send))); ta.focus();
    } } }));
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
function postLabel(g, what) { return [$('b', { text: g.clientName }), ' · ' + what + ' · ' + g.when]; }
function postBody(g) {
  const caps = g.posts.filter((p, i, a) => a.findIndex(x => x.caption === p.caption) === i);
  return [mediaEl(g.media, g.preview), ...caps.map(p => $('p', { class: 'text', text: p.caption || '' })),
    g.client_note ? $('div', { class: 'note', text: 'Client said: ' + g.client_note }) : ''];
}
function build(d) {
  const q = [];
  d.failed.forEach(g => q.push({ label: postLabel(g, 'post didn\\'t go out'), body: postBody(g), ask: 'Try posting it again?',
    yes: ['Try again', () => call('adminPost', K, g.sheetId, g.ids, 'retry', '')], change: null,
    skip: ['Drop this post', () => call('adminPost', K, g.sheetId, g.ids, 'skip', '')] }));
  d.fixes.forEach(f => q.push({ label: ['Heads up'], body: [$('p', { class: 'text', text: f.text })], ask: '',
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
  if (bits.length) more.append($('p', { text: bits.join(' · ') }));
  const links = $('div', { style: 'display:none' }, d.clients.map(c => $('div', { class: 'row' }, $('span', { text: c.client }),
    $('span', {}, $('a', { class: 'link', href: c.link, target: '_blank', text: 'Open' }), ' · ',
      $('a', { class: 'link', href: '#', text: 'Copy link', on: { click: e => { e.preventDefault(); try { navigator.clipboard.writeText(c.link).then(() => e.target.textContent = 'Copied', () => {}); } catch (x) {} } } }),
      c.contact_email ? [' · ', $('a', { class: 'link', href: '#', text: 'Email it', on: { click: e => { e.preventDefault(); call('adminNotifyClient', K, c.brand).then(() => e.target.textContent = 'Sent'); } } })] : ''))));
  more.append($('a', { class: 'link', href: '#', text: 'Client links', on: { click: e => { e.preventDefault(); links.style.display = links.style.display ? '' : 'none'; } } }), links);
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
  if (!R || R.empty) { more.append($('p', { text: 'Results appear after the first stats pull.' })); return; }
  const t = {}; R.tiles.forEach(x => t[x.title] = x);
  const reach = t['Accounts reached'], fol = t['New followers'], clk = t['Clicks and taps'];
  const parts = [];
  if (reach && reach.value != null) parts.push('reached ' + fmt(reach.value) + ' people' + pct(reach.value, reach.prev));
  if (fol && fol.value != null) parts.push(fmt(fol.value) + ' new followers');
  if (clk && clk.value != null) parts.push(fmt(clk.value) + ' clicks');
  more.append($('p', { text: parts.length ? R.month + ' so far: ' + parts.join(', ') + '.' : 'Results appear after the first stats pull.' }));
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
      label: [$('b', { text: plan ? 'Idea for a post' : 'Post' }), ' · ' + p.when],
      body: [mediaEl(p.media, p.preview), ...caps.map(x => $('p', { class: 'text', text: x.caption || '' })),
        p.deadline ? $('p', { class: 'mute', text: 'Please answer by ' + p.deadline + '.' }) : ''],
      ask: plan ? 'Good idea?' : 'Good to post?',
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
