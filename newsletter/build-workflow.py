# Writes n8n-newsletter.json. Edit this file, then run: python3 build-workflow.py
# One workflow, two schedules:
#   every 30 minutes  send approved newsletter rows from the Queue through each client's Brevo account
#   every morning 8am remind contributors (ask, nudge, last call, summary to the owner) + refresh Brevo stats
import json, os

SHEET = "https://docs.google.com/spreadsheets/d/1nec5cD5RtjV6yDLzxeKX9vGhI0k123PIaFFDwXqFM6A/edit"
SA = {"googleApi": {"id": "", "name": "Google Service Account account"}}
BREVO = "https://api.brevo.com/v3"

keys = r'''// One line per client: brand slug (as in the Queue) -> that client's Brevo API key.
// Get it in the client's Brevo account: https://app.brevo.com/settings/keys/api
// Keys stay here in n8n on your Mac. Never put them in the Sheet or in GitHub.
const KEYS = {
  ngm: 'PASTE_NGM_BREVO_API_KEY',
};
const run = $('Every 30 minutes').isExecuted ? 'send' : 'daily';
return [{ json: { run, keys: KEYS } }];'''

rows_helper = r'''const rows = name => $(name).all().map(i => i.json).filter(r => Object.values(r).some(v => v !== '' && v != null));
const yes = v => /^y/i.test(String(v || ''));'''

due = rows_helper + r'''
// Approved newsletter rows that are due, one item per Brevo campaign (a list over the free 300/day goes out in daily batches).
const keys = $('Brevo keys').first().json.keys;
const settings = Object.fromEntries(rows('Read settings (send)').map(s => [s.brand, s]));
const now = Date.now(), out = [];
for (const r of rows('Read queue')) {
  if (r.platform !== 'newsletter' || String(r.status).toLowerCase() !== 'approved' || r.posted_at) continue;
  if (!r.publish_at || new Date(r.publish_at).getTime() > now) continue;
  const s = settings[r.brand];
  if (!s || !keys[r.brand] || /PASTE/.test(keys[r.brand])) throw new Error(`Newsletter ${r.id}: no Newsletter settings row or Brevo key for "${r.brand}"`);
  const preview = (String(r.caption).match(/^Preview:\s*(.*)$/m) || [])[1] || '';
  // list_ids: "3" one list, "3,4" several lists at once, "3;4" list 3 today and list 4 tomorrow
  String(s.list_ids).split(';').map(b => b.split(',').map(Number).filter(Boolean)).filter(b => b.length).forEach((listIds, batch) => out.push({ json: {
    row_id: r.id, brand: r.brand, month: r.month, batch, api_key: keys[r.brand], list_ids: String(s.list_ids),
    email_url: String(r.preview_url).replace(/pages\/[^/]+$/, 'email.html'),
    campaign: {
      name: `${r.id}${batch ? ' batch ' + (batch + 1) : ''}`, subject: r.hook, previewText: preview,
      sender: { name: s.sender_name, email: s.sender_email }, replyTo: s.reply_to || s.sender_email,
      recipients: { listIds },
      ...(batch ? { scheduledAt: new Date(now + batch * 864e5).toISOString() } : {}),
    },
  }}));
}
return out;'''

body = r'''// Put the email HTML into each campaign.
const src = $('Newsletters due').all();
return $input.all().map((it, i) => {
  const html = String(it.json.html || it.json.data || '');
  if (!/\{\{\s*unsubscribe\s*\}\}/.test(html)) throw new Error(`${src[i].json.email_url} has no unsubscribe link. Rebuild it with build-issue.js`);
  return { json: { ...src[i].json, campaign: { ...src[i].json.campaign, htmlContent: html } } };
});'''

created = r'''// Mark each issue sent before Brevo sends it, so a retry never sends twice.
const src = $('Campaign body').all(), by = {};
$input.all().forEach((it, i) => {
  const s = src[i].json, g = by[s.row_id] ??= { id: s.row_id, brand: s.brand, month: s.month, subject: s.campaign.subject, list_ids: s.list_ids, ids: [] };
  g.ids.push(it.json.id);
});
const now = new Date().toISOString();
return Object.values(by).map(g => ({ json: { id: g.id, status: 'posted', posted_at: now,
  stats: { issue_id: g.id, brand: g.brand, month: g.month, subject: g.subject, sent_at: now, campaign_ids: g.ids.join(','), list_ids: g.list_ids, status: 'sending' } } }));'''

send_list = r'''// Batch 1 goes now. Later batches were created with a send date and go on their own.
const src = $('Campaign body').all();
return $('Brevo: create campaign').all().map((it, i) => ({ json: { id: it.json.id, api_key: src[i].json.api_key, batch: src[i].json.batch } }))
  .filter(x => x.batch === 0);'''

plan = rows_helper + r'''
// Who to email today. Everything for an issue happens in the month before it:
// ask_day: ask everyone; due_day - 3: nudge whoever hasn't sent anything; due_day: last call; the 3 days after: summary to the owner.
const TZ = 'America/Chicago';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const [Y, M, D] = today.split('-').map(Number);
const pad = n => String(n).padStart(2, '0');
const issue = M === 12 ? `${Y + 1}-01` : `${Y}-${pad(M + 1)}`;
const issueName = new Date(issue + '-15T12:00:00').toLocaleString('en-US', { month: 'long' });
const monthName = new Date(`${Y}-${pad(M)}-15T12:00:00`).toLocaleString('en-US', { month: 'long' });
const logged = new Set(rows('Read newsletter log').map(l => l.key));
const subs = rows('Read submissions');
const out = [];
const add = (s, stage, to, name, subject, text) => {
  const key = [s.brand, issue, stage, String(to).toLowerCase()].join('|');
  if (logged.has(key)) return;
  logged.add(key);
  out.push({ json: { to, subject, text, from_name: s.from_name || s.newsletter, reply_to: s.reply_to,
    log: { key, brand: s.brand, issue, stage, email: to, name, sent_at: new Date().toISOString() } } });
};
for (const s of rows('Read settings (daily)')) {
  if (!yes(s.active)) continue;
  const ask = Number(s.ask_day) || 1, dueDay = Number(s.due_day) || 12, nudge = Math.max(ask + 1, dueDay - 3);
  const stage = D >= dueDay + 1 && D <= dueDay + 3 ? 'summary' : D === dueDay ? 'final' : D >= nudge && D < dueDay ? 'nudge' : D >= ask && D < nudge ? 'ask' : null;
  if (!stage) continue;
  const name = String(s.newsletter || '').replace(/\*/g, '');
  const dueText = `${monthName} ${dueDay}`;
  const since = new Date(`${Y}-${pad(M)}-${pad(ask)}T00:00:00`).getTime() - 864e5;
  const sentIn = subs.filter(r => (!r.brand || r.brand === s.brand) && new Date(r.received).getTime() >= since);
  const sentBy = new Set(sentIn.map(r => String(r.from_email).toLowerCase()));
  const people = rows('Read contributors').filter(c => c.brand === s.brand && c.email && !/^n/i.test(c.active || ''));
  const sign = `\n\nThank you,\n${s.from_name || name}`;
  if (stage === 'summary') {
    const missing = people.filter(c => !sentBy.has(c.email.toLowerCase())).map(c => c.name || c.email);
    add(s, stage, s.owner_email, 'owner', `${name} ${issueName}: ${sentIn.length} submission${sentIn.length === 1 ? '' : 's'} in`,
      `${people.length - missing.length} of ${people.length} contributors sent something for the ${issueName} issue.` +
      (missing.length ? `\n\nNothing yet from: ${missing.join(', ')}` : '') +
      (sentIn.length ? `\n\nIn so far:\n${sentIn.map(r => `- ${r.from_name || r.from_email}: ${r.subject || r.type}`).join('\n')}` : '') +
      `\n\nClaude drafts the issue next and it shows up in your check-in for a yes.`);
    continue;
  }
  for (const c of people) {
    if (stage !== 'ask' && sentBy.has(c.email.toLowerCase())) continue;
    const first = String(c.name || '').split(' ')[0] || 'there';
    const what = c.asks_for || 'news, a finished piece, a photo or a date we should share';
    const txt = {
      ask: [`${name}: anything for ${issueName}?`, `Hi ${first},\n\nWe're putting together the ${issueName} issue of ${name}. Could you send ${what}?\n\nJust reply to this email by ${dueText}. A few lines and a photo is plenty.`],
      nudge: [`Reminder: ${name} for ${issueName}`, `Hi ${first},\n\nA quick reminder that we'd love ${what} for the ${issueName} issue. The deadline is ${dueText}. Just reply to this email.`],
      final: [`Last call for ${name}`, `Hi ${first},\n\nToday is the last day to send something for the ${issueName} issue. Reply with whatever you have, even a line or two. If you'd rather skip this month, no need to reply.`],
    }[stage];
    add(s, stage, c.email, c.name, txt[0], txt[1] + sign);
  }
}
return out;'''

refresh = rows_helper + r'''
// Issues sent in the last 45 days: one item per Brevo campaign and per list, so the stats keep updating.
const keys = $('Brevo keys').first().json.keys, out = [];
for (const r of rows('Read newsletter stats')) {
  if (!r.campaign_ids || !keys[r.brand] || Date.now() - new Date(r.sent_at).getTime() > 45 * 864e5) continue;
  String(r.campaign_ids).split(',').filter(Boolean).forEach(id => out.push({ json: { issue_id: r.issue_id, kind: 'campaign', id, api_key: keys[r.brand] } }));
  String(r.list_ids).split(/[;,]/).map(Number).filter(Boolean).forEach(id => out.push({ json: { issue_id: r.issue_id, kind: 'list', id, api_key: keys[r.brand] } }));
}
return out;'''

summ = rows_helper + r'''
// Add up each issue's campaigns. Rates are out of delivered emails. Poll answers are clicks on links with ?vote=.
const src = $('Campaigns to refresh').all(), by = {};
const prev = Object.fromEntries(rows('Read newsletter stats').map(r => [r.issue_id, r]));
const n = v => Number(v) || 0;
$input.all().forEach((it, i) => {
  const s = src[i].json, j = it.json, g = by[s.issue_id] ??= { sent: 0, delivered: 0, opens: 0, clicks: 0, unsub: 0, bounces: 0, complaints: 0, list: 0, links: {}, status: [] , err: [] };
  if (j.error) { g.err.push(`${s.kind} ${s.id}: ${j.error.message || j.error}`); return; }
  if (s.kind === 'list') { g.list += n(j.uniqueSubscribers ?? j.totalSubscribers); return; }
  const st = j.statistics || {};
  let t = st.globalStats || {};
  if (!n(t.sent) && Array.isArray(st.campaignStats)) t = st.campaignStats.reduce((a, c) => { Object.keys(c).forEach(k => a[k] = n(a[k]) + n(c[k])); return a; }, {});
  g.sent += n(t.sent); g.delivered += n(t.delivered); g.opens += n(t.uniqueViews ?? t.viewed); g.clicks += n(t.uniqueClicks ?? t.clickers);
  g.unsub += n(t.unsubscriptions); g.bounces += n(t.hardBounces) + n(t.softBounces); g.complaints += n(t.complaints);
  Object.entries(st.linksStats || {}).forEach(([u, c]) => g.links[u] = n(g.links[u]) + n(c));
  g.status.push(j.status);
});
return Object.entries(by).map(([id, g]) => {
  const links = Object.entries(g.links).sort((a, b) => b[1] - a[1]);
  const poll = links.filter(([u]) => /[?&]vote=/.test(u)).map(([u, c]) => `${decodeURIComponent(u.match(/[?&]vote=([^&]+)/)[1])}: ${c}`);
  const rate = v => g.delivered ? (v / g.delivered).toFixed(3) : '';
  return { json: {
    issue_id: id, recipients: g.sent, delivered: g.delivered, unique_opens: g.opens, open_rate: rate(g.opens),
    unique_clicks: g.clicks, click_rate: rate(g.clicks), unsubscribes: g.unsub, bounces: g.bounces, complaints: g.complaints,
    list_size: g.list, list_size_at_send: (prev[id] && prev[id].list_size_at_send) || g.list,
    top_links: links.filter(([u]) => !/[?&]vote=/.test(u)).slice(0, 5).map(([u, c]) => `${c} ${u}`).join('\n'),
    poll_results: poll.join('\n'),
    status: g.err.length ? 'error: ' + g.err.join('; ') : g.status.every(x => x === 'sent') ? 'sent' : g.status.join(','),
    updated_at: new Date().toISOString(),
  } };
});'''

code = lambda i, name, pos, js: {"id": i, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": js}}
def read(i, name, tab, pos, once=True):
    n = {"id": i, "name": name, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": pos, "alwaysOutputData": True,
         "parameters": {"authentication": "serviceAccount", "documentId": {"__rl": True, "mode": "url", "value": SHEET},
                        "sheetName": {"__rl": True, "mode": "name", "value": tab}, "options": {}}, "credentials": SA}
    if once: n["executeOnce"] = True
    return n
def write(i, name, tab, pos, op, match, value=None):
    cols = {"mappingMode": "defineBelow" if value else "autoMapInputData", "value": value or {}, "matchingColumns": match, "schema": []}
    return {"id": i, "name": name, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": pos,
            "parameters": {"authentication": "serviceAccount", "operation": op, "documentId": {"__rl": True, "mode": "url", "value": SHEET},
                           "sheetName": {"__rl": True, "mode": "name", "value": tab}, "columns": cols, "options": {}}, "credentials": SA}
def brevo(i, name, pos, method, url, body=None, extra=None):
    p = {"method": method, "url": url, "sendHeaders": True,
         "headerParameters": {"parameters": [{"name": "api-key", "value": "={{ $json.api_key }}"}, {"name": "accept", "value": "application/json"}]},
         "options": {}}
    if body:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": body})
    n = {"id": i, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos, "parameters": p,
         "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000}
    if extra: n.update(extra)
    return n

stats_cols = ["issue_id", "brand", "month", "subject", "sent_at", "campaign_ids", "list_ids", "status"]
nodes = [
 {"id": "n1", "name": "Every 30 minutes", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 200],
  "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 30}]}}},
 {"id": "n2", "name": "Every morning 8am", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 600],
  "parameters": {"rule": {"interval": [{"field": "days", "daysInterval": 1, "triggerAtHour": 8}]}}},
 code("n3", "Brevo keys", [220, 400], keys),
 {"id": "n4", "name": "Send or daily?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [440, 400],
  "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
   "conditions": [{"id": "c1", "leftValue": "={{ $json.run }}", "rightValue": "send", "operator": {"type": "string", "operation": "equals"}}], "combinator": "and"}, "options": {}}},
 # send
 read("s1", "Read queue", "Queue", [660, 200], once=False),
 read("s2", "Read settings (send)", "Newsletter settings", [880, 200]),
 code("s3", "Newsletters due", [1100, 200], due),
 {"id": "s4", "name": "Get email HTML", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1320, 200],
  "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
  "parameters": {"url": "={{ $json.email_url }}", "options": {"response": {"response": {"responseFormat": "text", "outputPropertyName": "html"}}}}},
 code("s5", "Campaign body", [1540, 200], body),
 brevo("s6", "Brevo: create campaign", [1760, 200], "POST", BREVO + "/emailCampaigns", "={{ JSON.stringify($json.campaign) }}"),
 code("s7", "Mark sent", [1980, 200], created),
 write("s8", "Queue: posted", "Queue", [2200, 200], "update", ["id"], {"id": "={{ $json.id }}", "status": "={{ $json.status }}", "posted_at": "={{ $json.posted_at }}"}),
 write("s9", "Newsletter stats: add", "Newsletter stats", [2420, 200], "appendOrUpdate", ["issue_id"],
       {c: "={{ $('Mark sent').item.json.stats.%s }}" % c for c in stats_cols}),
 code("s10", "Send-now list", [2640, 200], send_list),
 brevo("s11", "Brevo: send now", [2860, 200], "POST", "=" + BREVO + "/emailCampaigns/{{ $json.id }}/sendNow"),
 # daily: reminders
 read("d1", "Read settings (daily)", "Newsletter settings", [660, 520], once=True),
 read("d2", "Read contributors", "Newsletter contributors", [880, 520]),
 read("d3", "Read submissions", "Content submissions", [1100, 520]),
 read("d4", "Read newsletter log", "Newsletter log", [1320, 520]),
 code("d5", "Plan reminders", [1540, 520], plan),
 {"id": "d6", "name": "Send reminder", "type": "n8n-nodes-base.emailSend", "typeVersion": 2.1, "position": [1760, 520],
  "parameters": {"fromEmail": "={{ $json.from_name }} <grahamivy.co@gmail.com>", "toEmail": "={{ $json.to }}", "subject": "={{ $json.subject }}",
   "emailFormat": "text", "text": "={{ $json.text }}", "options": {"appendAttribution": False, "replyTo": "={{ $json.reply_to }}"}},
  "credentials": {"smtp": {"id": "", "name": "Gmail SMTP"}}},
 write("d7", "Log reminder", "Newsletter log", [1980, 520], "append", [],
       {c: "={{ $('Plan reminders').item.json.log.%s }}" % c for c in ["key", "brand", "issue", "stage", "email", "name", "sent_at"]}),
 # daily: stats
 read("t1", "Read newsletter stats", "Newsletter stats", [660, 800], once=True),
 code("t2", "Campaigns to refresh", [880, 800], refresh),
 brevo("t3", "Brevo: get stats", [1100, 800], "GET",
       "={{ '" + BREVO + "' + ($json.kind === 'list' ? '/contacts/lists/' : '/emailCampaigns/') + $json.id }}", extra={"onError": "continueRegularOutput"}),
 code("t4", "Add up per issue", [1320, 800], summ),
 write("t5", "Newsletter stats: update", "Newsletter stats", [1540, 800], "update", ["issue_id"]),
]
to = lambda *ns: [{"node": n, "type": "main", "index": 0} for n in ns]
conn = {
 "Every 30 minutes": {"main": [to("Brevo keys")]},
 "Every morning 8am": {"main": [to("Brevo keys")]},
 "Brevo keys": {"main": [to("Send or daily?")]},
 "Send or daily?": {"main": [to("Read queue"), to("Read settings (daily)", "Read newsletter stats")]},
 "Read queue": {"main": [to("Read settings (send)")]},
 "Read settings (send)": {"main": [to("Newsletters due")]},
 "Newsletters due": {"main": [to("Get email HTML")]},
 "Get email HTML": {"main": [to("Campaign body")]},
 "Campaign body": {"main": [to("Brevo: create campaign")]},
 "Brevo: create campaign": {"main": [to("Mark sent")]},
 "Mark sent": {"main": [to("Queue: posted")]},
 "Queue: posted": {"main": [to("Newsletter stats: add")]},
 "Newsletter stats: add": {"main": [to("Send-now list")]},
 "Send-now list": {"main": [to("Brevo: send now")]},
 "Read settings (daily)": {"main": [to("Read contributors")]},
 "Read contributors": {"main": [to("Read submissions")]},
 "Read submissions": {"main": [to("Read newsletter log")]},
 "Read newsletter log": {"main": [to("Plan reminders")]},
 "Plan reminders": {"main": [to("Send reminder")]},
 "Send reminder": {"main": [to("Log reminder")]},
 "Read newsletter stats": {"main": [to("Campaigns to refresh")]},
 "Campaigns to refresh": {"main": [to("Brevo: get stats")]},
 "Brevo: get stats": {"main": [to("Add up per issue")]},
 "Add up per issue": {"main": [to("Newsletter stats: update")]},
}
names = {n["name"] for n in nodes}
assert all(k in names and all(t["node"] in names for b in v["main"] for t in b) for k, v in conn.items()), "bad connection"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n-newsletter.json")
json.dump({"name": "Client newsletters", "nodes": nodes, "connections": conn,
           "settings": {"executionOrder": "v1", "timezone": "America/Chicago"}, "pinData": {}}, open(out, "w"), indent=1)
print("wrote", out)
