/**
 * Open Frame Hub
 * One page for everything that needs Graham, a no-login review page per client,
 * and a morning email. Runs free inside Google Apps Script, bound to the
 * "NGM social queue" Sheet. Reads and writes the same tabs n8n uses.
 *
 * Setup (once): paste this file into Extensions > Apps Script, run setup(),
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone),
 * then run emailMeMyLinks().
 */

const TZ = 'America/Chicago';
const DIGEST_HOUR = 7;
const OUTREACH_SHEET_ID = '1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU';
const QUEUE_EXTRA = ['client_decision', 'client_note', 'decided_at', 'review_note'];
const CLIENT_HEAD = ['client', 'brand', 'sheet_id', 'token', 'contact_email', 'client_approves'];
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
      ['Open Frame', 'open-frame', ss.getId(), token_(16), '', 'no'],
      ['Needlework Guild of Minnesota', 'ngm', ss.getId(), token_(16), '', 'yes'],
    ]);
  }

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'morningDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('morningDigest').timeBased().atHour(DIGEST_HOUR).everyDays(1).inTimezone(TZ).create();
  Logger.log('Setup done. Now deploy as a web app, then run emailMeMyLinks.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hub')
    .addItem('Email me my links', 'emailMeMyLinks')
    .addItem('Send morning summary now', 'morningDigest')
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
  const out = { clients, approve: [], review: [], feedback: [], failed: [], upcoming: [], inbox: [], engage: [], photos: [], fixes: [] };
  const now = Date.now(), week = now + 7 * 864e5;

  uniq_(clients.map(c => c.sheet_id)).forEach(sid => {
    const q = table_(sid, 'Queue');
    if (q) {
      groupPosts_(q.rows.filter(r => r.id), sid, byBrand).forEach(g => {
        const t = g.publish_at ? new Date(g.publish_at).getTime() : 0;
        if (g.status === 'draft') out.approve.push(g);
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
  ['approve', 'review', 'feedback', 'failed', 'upcoming'].forEach(k => out[k].sort(sortT));
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
      media: [], posts: [], client_note: '', review_note: '',
    });
    g.ids.push(r.id);
    g.posts.push({ id: r.id, platform: r.platform, caption: r.caption });
    String(r.media_url || '').split(/\s+/).filter(Boolean).forEach(u => { if (g.media.indexOf(u) < 0) g.media.push(u); });
    if (r.client_note) g.client_note = r.client_note;
    if (r.review_note) g.review_note = r.review_note;
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
      if (action === 'approve' || action === 'retry') set.review_note = '';
      setCells_(q, r._row, set);
    });
    return status;
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
  const rows = q.rows.filter(r => r.brand === c.brand && (r.status === 'in_review' || (r.decided_at && within_(r.decided_at, 3))));
  const groups = groupPosts_(rows, c.sheet_id, { [c.brand]: c }).map(g => ({
    ids: g.ids, when: g.when, type: g.type, media: g.media, status: g.status, client_note: g.client_note,
    posts: g.posts.map(p => ({ platform: p.platform, caption: p.caption })),
  }));
  groups.sort((a, b) => (a.status === 'in_review' ? 0 : 1) - (b.status === 'in_review' ? 0 : 1));
  return { client: c.client, posts: groups };
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
      if (r.brand !== c.brand || r.status !== 'in_review') throw new Error('This post was already updated. Refresh the page.');
      setCells_(q, r._row, {
        status: map[0], client_decision: map[1], client_note: String(note || '').slice(0, 2000),
        decided_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
      });
    });
    if (decision === 'change') {
      MailApp.sendEmail(me_(), c.client + ' asked for a change', 'Note: ' + note + '\n\nOpen your dashboard:\n\n' + adminUrl_());
    }
    return map[0];
  });
}

// ---------- morning email ----------

function morningDigest() {
  const d = getDashboard(adminKey_());
  const sec = [
    ['Posts to approve', d.approve.map(g => g.clientName + ', ' + g.when + ', ' + g.type)],
    ['Client asked for changes', d.feedback.map(g => g.clientName + ', ' + g.when + ': ' + g.client_note)],
    ['Messages to answer', d.inbox.map(m => (m.who || 'Someone') + ': ' + m.text.slice(0, 80))],
    ['Comments ready to post', d.engage.map(e => '@' + e.handle)],
    ['New photos sent in', d.photos.map(p => (p.from || 'Someone') + ': ' + (p.what || p.file || ''))],
    ['Needs fixing', d.fixes.concat(d.failed.map(g => ({ text: g.clientName + ': a post on ' + g.when + ' failed to publish' }))).map(f => f.text)],
    ['Waiting on clients', d.review.map(g => g.clientName + ', ' + g.when)],
  ].filter(s => s[1].length);

  const total = sec.reduce((n, s) => n + (s[0] === 'Waiting on clients' ? 0 : s[1].length), 0);
  const lines = [];
  if (!total) lines.push('Nothing needs you today.', '');
  sec.forEach(s => {
    lines.push(s[0] + ' (' + s[1].length + ')');
    s[1].slice(0, 5).forEach(x => lines.push('- ' + x));
    if (s[1].length > 5) lines.push('- and ' + (s[1].length - 5) + ' more');
    lines.push('');
  });
  lines.push('Open your dashboard:', '', adminUrl_());
  if (d.upcoming.length) lines.push('', d.upcoming.length + ' approved posts go out in the next 7 days.');
  MailApp.sendEmail(me_(), total ? total + ' things need you today' : 'Nothing needs you today', lines.join('\n'));
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
    contact_email: r.contact_email || '', client_approves: /^(y|yes|true)$/i.test(r.client_approves || ''),
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

const BASE_CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d1b18;--mute:#6b665d;--line:#e4dfd4;--accent:#2f5d50;--accent-ink:#fff;--warn:#a5481f;--soft:#eef3f0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:16px}h1{font-size:22px;margin:8px 0 2px}h2{font-size:17px;margin:28px 0 10px}
.sub{color:var(--mute);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.row{display:flex;gap:14px;flex-wrap:wrap}.media{display:flex;gap:6px;overflow-x:auto;max-width:100%}
.media img,.media video{height:180px;border-radius:8px;background:#ddd;flex:none}
.meta{font-size:13px;color:var(--mute);margin-bottom:6px}.pill{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;background:var(--soft);margin-right:4px}
textarea{width:100%;min-height:90px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px}
button,.btn{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;color:var(--ink);text-decoration:none;display:inline-block}
button.go{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}button.warn{color:var(--warn)}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.note{background:#fff7e8;border-radius:8px;padding:8px;margin-top:8px;font-size:14px}
.cap{white-space:pre-wrap;font-size:14px}.empty{color:var(--mute);font-size:14px}.done{opacity:.45;pointer-events:none}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.tabs a{font-size:13px;padding:6px 10px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none}
.tabs a b{color:var(--accent)}select{font:inherit;padding:6px;border-radius:8px;border:1px solid var(--line)}
.opt{display:block;width:100%;text-align:left;margin:4px 0;font-size:14px;white-space:pre-wrap}
`;

const SHARED_JS = `
const BOOT = __BOOT__;
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); Object.entries(a).forEach(([k, v]) => k === 'on' ? Object.entries(v).forEach(([n, f]) => e.addEventListener(n, f)) : k === 'text' ? e.textContent = v : e.setAttribute(k, v)); kids.flat().forEach(c => c && e.append(c)); return e; };
const call = (fn, ...args) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(e => { alert(e.message || e); no(e); })[fn](...args));
function mediaEl(urls) {
  return $('div', { class: 'media' }, urls.map(u => /\\.(mp4|mov|webm)(\\?|$)/i.test(u)
    ? $('video', { src: u, controls: '', preload: 'metadata', playsinline: '' })
    : $('a', { href: u, target: '_blank' }, $('img', { src: u, loading: 'lazy', alt: '' }))));
}
`;

const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<h1>What needs you</h1><div class="sub" id="sub">Loading...</div>
<div class="row" style="margin-top:10px;align-items:center"><label class="sub">Client <select id="f"><option value="">All clients</option></select></label><button onclick="load()">Refresh</button></div>
<div class="tabs" id="tabs"></div><div id="out"></div></div>
<script>${SHARED_JS}
let D = null;
const SECTIONS = [
  ['approve', 'Posts to approve'], ['feedback', 'Client asked for changes'], ['inbox', 'Messages to answer'],
  ['engage', 'Comments ready to post'], ['photos', 'New photos sent in'], ['fixes', 'Needs fixing'],
  ['review', 'Waiting on clients'], ['upcoming', 'Going out this week'],
];
function load() { call('getDashboard', BOOT.key).then(d => { D = d; fill(); render(); }); }
function fill() {
  const f = document.getElementById('f'); const v = f.value;
  f.innerHTML = '<option value="">All clients</option>';
  D.clients.forEach(c => f.append($('option', { value: c.brand, text: c.client })));
  f.value = v; f.onchange = render;
}
function pick(list) { const b = document.getElementById('f').value; return b ? list.filter(x => !x.brand || x.brand === b) : list; }
function render() {
  const out = document.getElementById('out'), tabs = document.getElementById('tabs'); out.innerHTML = ''; tabs.innerHTML = '';
  const failed = pick(D.failed).map(g => ({ kind: 'failed', g, text: g.clientName + ': post on ' + g.when + ' failed to publish' }));
  const data = Object.assign({}, D, { fixes: failed.concat(D.fixes) });
  let needs = 0;
  SECTIONS.forEach(([k, title]) => {
    const list = k === 'fixes' ? data.fixes : pick(data[k]);
    if (!['review', 'upcoming'].includes(k)) needs += list.length;
    tabs.append($('a', { href: '#' + k }, title + ' ', $('b', { text: String(list.length) })));
    out.append($('h2', { id: k, text: title + ' (' + list.length + ')' }));
    if (!list.length) out.append($('div', { class: 'empty', text: 'Nothing here.' }));
    list.forEach(x => out.append(CARD[k](x)));
  });
  clientLinks(out);
  document.getElementById('sub').textContent = needs ? needs + ' things need you' : 'Nothing needs you right now';
}
function done(el, msg) { el.classList.add('done'); el.querySelector('.acts') && (el.querySelector('.acts').innerHTML = '<span class=sub>' + msg + '</span>'); }
function postCard(g, acts, opts = {}) {
  const el = $('div', { class: 'card' });
  const caps = g.posts.map(p => {
    const ta = $('textarea', {}); ta.value = p.caption || '';
    const save = $('button', { text: 'Save caption', on: { click: () => call('adminCaption', BOOT.key, g.sheetId, p.id, ta.value).then(() => save.textContent = 'Saved') } });
    return opts.edit ? $('div', {}, $('div', { class: 'meta', text: p.platform }), ta, $('div', { class: 'acts', style: 'margin-top:4px' }, save))
      : $('div', {}, $('div', { class: 'meta', text: p.platform }), $('div', { class: 'cap', text: p.caption || '' }));
  });
  el.append(
    $('div', { class: 'meta' }, $('span', { class: 'pill', text: g.clientName }), $('span', { class: 'pill', text: g.type || 'post' }), g.when),
    mediaEl(g.media), ...caps,
    g.client_note ? $('div', { class: 'note', text: 'Client: ' + g.client_note }) : '',
    g.review_note ? $('div', { class: 'note', text: 'Your note: ' + g.review_note }) : '',
    $('div', { class: 'acts' }, acts(el)));
  return el;
}
const act = (g, el, action, label, msg, cls) => $('button', { class: cls || '', text: label, on: { click: () => {
  let note = '';
  if (action === 'change') { note = prompt('What should change?'); if (!note) return; }
  call('adminPost', BOOT.key, g.sheetId, g.ids, action, note).then(() => done(el, msg));
} } });
const CARD = {
  approve: g => postCard(g, el => [
    g.clientApproves ? act(g, el, 'toClient', 'Send to client', 'Sent to client for review', 'go') : act(g, el, 'approve', 'Approve', 'Approved. It posts on schedule.', 'go'),
    g.clientApproves ? act(g, el, 'approve', 'Approve without client', 'Approved') : '',
    act(g, el, 'change', 'Change', 'Marked for changes'), act(g, el, 'skip', 'Skip', 'Skipped', 'warn')], { edit: true }),
  feedback: g => postCard(g, el => [
    act(g, el, g.clientApproves ? 'toClient' : 'approve', g.clientApproves ? 'Fixed, send back to client' : 'Fixed, approve', 'Done', 'go'),
    act(g, el, 'approve', 'Approve as is', 'Approved'), act(g, el, 'skip', 'Skip', 'Skipped', 'warn')], { edit: true }),
  review: g => postCard(g, el => [act(g, el, 'approve', 'Approve for them', 'Approved'), act(g, el, 'back', 'Pull back to draft', 'Back to draft')]),
  upcoming: g => postCard(g, el => [act(g, el, 'back', 'Pull back to draft', 'Pulled back', 'warn')]),
  inbox: m => {
    const el = $('div', { class: 'card' }); const ta = $('textarea', {}); ta.value = m.draft || m.options[0] || '';
    el.append($('div', { class: 'meta' }, $('span', { class: 'pill', text: m.kind }), $('span', { class: 'pill', text: m.intent }), (m.who || '') + ' ' + (m.at || '')),
      $('div', { class: 'cap', text: m.text }),
      ...m.options.map(o => $('button', { class: 'opt', text: o, on: { click: () => ta.value = o } })), ta,
      $('div', { class: 'acts' },
        $('button', { class: 'go', text: 'Send reply', on: { click: () => call('adminReply', BOOT.key, m.sheetId, m.id, ta.value, 'send').then(() => done(el, 'Sending within 5 minutes')) } }),
        $('button', { text: 'I handled it', on: { click: () => call('adminReply', BOOT.key, m.sheetId, m.id, '', 'done').then(() => done(el, 'Done')) } })));
    return el;
  },
  engage: x => {
    const el = $('div', { class: 'card' }); const ta = $('textarea', {}); ta.value = x.comment;
    el.append($('div', { class: 'meta', text: '@' + x.handle }), $('div', { class: 'cap', text: x.caption }), ta,
      $('div', { class: 'acts' },
        $('button', { text: 'Copy and open post', on: { click: () => { navigator.clipboard && navigator.clipboard.writeText(ta.value); window.open(x.url, '_blank'); } } }),
        $('button', { class: 'go', text: 'Posted it', on: { click: () => call('adminEngage', BOOT.key, x.id, 'sent', ta.value).then(() => done(el, 'Logged')) } }),
        $('button', { class: 'warn', text: 'Skip', on: { click: () => call('adminEngage', BOOT.key, x.id, 'skip', '').then(() => done(el, 'Skipped')) } })));
    return el;
  },
  photos: p => {
    const el = $('div', { class: 'card' });
    el.append($('div', { class: 'meta', text: (p.from || 'Someone') + ', ' + p.received + (p.verdict ? ', ' + p.verdict : '') }),
      $('div', { class: 'cap', text: [p.what, p.caption, p.issues ? 'Issues: ' + p.issues : ''].filter(Boolean).join('\\n') }),
      p.file ? $('a', { href: p.file, target: '_blank', class: 'btn', text: 'See photo' }) : '',
      $('div', { class: 'acts' },
        $('button', { class: 'go', text: 'Use it', on: { click: () => call('adminPhoto', BOOT.key, p.sheetId, p.row, p.received, 'use').then(() => done(el, 'Claude will add it to a post')) } }),
        $('button', { class: 'warn', text: 'Skip', on: { click: () => call('adminPhoto', BOOT.key, p.sheetId, p.row, p.received, 'skip').then(() => done(el, 'Skipped')) } })));
    return el;
  },
  fixes: f => f.g ? postCard(f.g, el => [act(f.g, el, 'retry', 'Try again', 'Will retry on the next run', 'go'), act(f.g, el, 'skip', 'Skip', 'Skipped', 'warn')])
    : $('div', { class: 'card' }, $('div', { class: 'cap', text: f.text })),
};
function clientLinks(out) {
  out.append($('h2', { id: 'clients', text: 'Client review pages' }));
  pick(D.clients).forEach(c => {
    const waiting = D.review.filter(g => g.brand === c.brand).length;
    const el = $('div', { class: 'card' });
    el.append($('div', { class: 'meta', text: c.client + (c.client_approves ? ', approves their own posts' : ', you approve') + (waiting ? ', ' + waiting + ' waiting' : '') }),
      $('div', { class: 'acts' },
        $('button', { text: 'Copy review link', on: { click: () => { navigator.clipboard && navigator.clipboard.writeText(c.link); } } }),
        $('a', { class: 'btn', href: c.link, target: '_blank', text: 'Open as client' }),
        c.contact_email ? $('button', { class: 'go', text: 'Email them the link', on: { click: (e) => call('adminNotifyClient', BOOT.key, c.brand).then(() => e.target.textContent = 'Sent') } }) : ''));
    out.append(el);
  });
}
load();
</script></body></html>`;

const CLIENT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="wrap">
<h1 id="h"></h1><div class="sub">Tap Approve or Request change on each post.</div><div id="out"><p class="empty">Loading...</p></div></div>
<script>${SHARED_JS}
document.getElementById('h').textContent = BOOT.client + ': posts to review';
function load() {
  call('getClientPosts', BOOT.token).then(d => {
    const out = document.getElementById('out'); out.innerHTML = '';
    const open = d.posts.filter(p => p.status === 'in_review');
    if (!open.length) out.append($('p', { class: 'empty', text: 'All caught up. We will email you when new posts are ready.' }));
    d.posts.forEach(p => out.append(card(p)));
  });
}
function card(p) {
  const el = $('div', { class: 'card' });
  const caps = p.posts.map(x => $('div', {}, $('div', { class: 'meta', text: x.platform }), $('div', { class: 'cap', text: x.caption || '' })));
  const ta = $('textarea', { placeholder: 'What should change?' }); ta.style.display = 'none';
  const decide = (d) => call('clientDecide', BOOT.token, p.ids, d, ta.value).then(s => {
    el.classList.add('done'); acts.innerHTML = '<span class=sub>' + ({ approved: 'Approved. Thank you!', changes: 'Got it. We will update it and send it back.', skipped: 'Skipped.' }[s]) + '</span>';
  });
  const acts = $('div', { class: 'acts' });
  if (p.status === 'in_review') {
    acts.append(
      $('button', { class: 'go', text: 'Approve', on: { click: () => decide('approve') } }),
      $('button', { text: 'Request change', on: { click: () => { if (ta.style.display === 'none') { ta.style.display = 'block'; ta.focus(); } else decide('change'); } } }),
      $('button', { class: 'warn', text: 'Skip this one', on: { click: () => decide('skip') } }));
  } else {
    el.classList.add('done');
    acts.append($('span', { class: 'sub', text: { approved: 'Approved', changes: 'Change requested', skipped: 'Skipped' }[p.status] || p.status }));
  }
  el.append($('div', { class: 'meta' }, $('span', { class: 'pill', text: p.type || 'post' }), p.when), mediaEl(p.media), ...caps,
    p.client_note ? $('div', { class: 'note', text: 'Your note: ' + p.client_note }) : '', ta, acts);
  return el;
}
load();
</script></body></html>`;
