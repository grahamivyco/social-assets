# Builds n8n-reel-drafts.json. Edit the code strings here, then run: python3 build-workflow.py
import json, os
SHEET = "https://docs.google.com/spreadsheets/d/1nec5cD5RtjV6yDLzxeKX9vGhI0k123PIaFFDwXqFM6A/edit"
GOOGLE = {"googleApi": {"id": "", "name": "Google Service Account account"}}

rows = r'''// Two Queue rows per Reel draft (IG 9:16, FB square), shown as one Hub card each for a yes.
// Slot: next weekday from tomorrow at 17:00 Chicago with no other Reel that day (11:00 is the daily post).
const d = $('Reel draft from Mac').first().json.body;
const taken = new Set($input.all().map(i => i.json)
  .filter(r => String(r.type).toLowerCase() === 'reel' && r.brand === d.brand && r.status !== 'skipped' && r.publish_at)
  .map(r => DateTime.fromISO(String(r.publish_at)).setZone('America/Chicago').toISODate()));
let day = DateTime.now().setZone('America/Chicago').plus({ days: 1 }).startOf('day');
while (day.weekday > 5 || taken.has(day.toISODate())) day = day.plus({ days: 1 });
const at = day.set({ hour: 17 }).toISO({ suppressMilliseconds: true });
const base = {
  brand: d.brand, type: 'reel', publish_at: at, caption: d.caption, status: 'in_review', month: day.toFormat('yyyy-MM'),
  pillar: 'reel', hook: d.hook, preview_url: d.preview_url, sensitive: 'yes', revision: 0,
  // Trial Reel (Graham, 2026-10-21): shown to non-followers first; graduates to followers if it does well.
  trial: d.trial === false ? 'no' : 'yes',
};
return [
  { json: { id: `${d.id}-ig`, platform: 'instagram', media_url: d.ig_url, ...base } },
  { json: { id: `${d.id}-fb`, platform: 'facebook', media_url: d.fb_url, ...base } },
];'''

health_ok = r'''// Clear the Reel drafts health row once a draft goes through.
const d = $('Reel draft from Mac').first().json.body;
return [{ json: { check: 'reel-drafts', label: 'Reel drafts', status: 'ok', email: 'no', since: '',
  detail: `Last draft: ${d.id} from ${d.source}.`, updated_at: DateTime.now().toISO(), link: '' } }];'''

health_fail = r'''// The Mac watcher hit a problem. The Hub turns this into a card and one email.
const d = $('Reel draft from Mac').first().json.body;
return [{ json: { check: 'reel-drafts', label: 'Reel drafts', status: 'fail', email: 'yes', since: DateTime.now().toISO(),
  detail: `Couldn't make a Reel from ${d.source}: ${String(d.detail || '').slice(0, 300)} (log: pm2 logs reel-watch)`,
  updated_at: DateTime.now().toISO(), link: '' } }];'''

def code(i, name, js, pos):
    return {"id": i, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": js}}

def sheet(i, name, op, tab, pos, match=None):
    p = {"authentication": "serviceAccount", "operation": op,
         "documentId": {"__rl": True, "mode": "url", "value": SHEET},
         "sheetName": {"__rl": True, "mode": "name", "value": tab}}
    if op != "read":
        p["columns"] = {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": match or [], "schema": []}
    p["options"] = {}
    n = {"id": i, "name": name, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": pos,
         "parameters": p, "credentials": GOOGLE}
    if op == "read":
        n["alwaysOutputData"] = True
    return n

nodes = [
    {"id": "r1", "name": "Reel draft from Mac", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 200],
     "webhookId": "of-reel-draft", "parameters": {"httpMethod": "POST", "path": "reel-draft", "options": {}}},
    {"id": "r2", "name": "Draft or problem?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [220, 200],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                                   "conditions": [{"id": "c1", "leftValue": "={{ $json.body.kind }}", "rightValue": "draft",
                                                   "operator": {"type": "string", "operation": "equals"}}],
                                   "combinator": "and"}, "options": {}}},
    sheet("r3", "Read queue", "read", "Queue", [440, 100]),
    code("r4", "Make Queue rows", rows, [660, 100]),
    sheet("r5", "Add to Queue", "append", "Queue", [880, 100]),
    code("r6", "Health ok", health_ok, [1100, 100]),
    code("r7", "Health problem", health_fail, [440, 320]),
    sheet("r8", "Save to Health tab", "appendOrUpdate", "Health", [1320, 200], ["check"]),
]
conn = {
    "Reel draft from Mac": {"main": [[{"node": "Draft or problem?", "type": "main", "index": 0}]]},
    "Draft or problem?": {"main": [[{"node": "Read queue", "type": "main", "index": 0}],
                                   [{"node": "Health problem", "type": "main", "index": 0}]]},
    "Read queue": {"main": [[{"node": "Make Queue rows", "type": "main", "index": 0}]]},
    "Make Queue rows": {"main": [[{"node": "Add to Queue", "type": "main", "index": 0}]]},
    "Add to Queue": {"main": [[{"node": "Health ok", "type": "main", "index": 0}]]},
    "Health ok": {"main": [[{"node": "Save to Health tab", "type": "main", "index": 0}]]},
    "Health problem": {"main": [[{"node": "Save to Health tab", "type": "main", "index": 0}]]},
}
wf = {"name": "Reel drafts", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1", "timezone": "America/Chicago"}}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n-reel-drafts.json")
open(out, "w").write(json.dumps(wf, indent=1))
print("wrote", out)
