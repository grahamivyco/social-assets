# Builds n8n-video-watch.json: iPhone Share Sheet -> n8n webhook (public via ngrok) -> watch server on the Mac.
import json, os
nodes = [
    {"id": "w1", "name": "Link from phone", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 200],
     "webhookId": "of-video-watch", "parameters": {"httpMethod": "POST", "path": "watch", "responseMode": "lastNode", "options": {}}},
    {"id": "w2", "name": "Send to watch tool", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [240, 200],
     "parameters": {"method": "POST", "url": "http://127.0.0.1:5680/watch", "sendBody": True, "specifyBody": "json",
                    "jsonBody": "={{ JSON.stringify({ url: $json.body.url, note: $json.body.note || '', token: $json.body.token }) }}",
                    "options": {"response": {"response": {"neverError": True}}}}},
    {"id": "w3", "name": "Reply to phone", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [480, 200],
     "parameters": {"assignments": {"assignments": [{"id": "a1", "name": "message", "type": "string",
                    "value": "={{ $json.ok ? 'Watching it now. Ask Claude about it in a few minutes.' : 'Not saved: ' + ($json.error || 'the watch tool is off') }}"}]},
                    "options": {}}},
]
conn = {"Link from phone": {"main": [[{"node": "Send to watch tool", "type": "main", "index": 0}]]},
        "Send to watch tool": {"main": [[{"node": "Reply to phone", "type": "main", "index": 0}]]}}
wf = {"name": "Video watch", "nodes": nodes, "connections": conn, "settings": {"executionOrder": "v1"}}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "n8n-video-watch.json")
open(out, "w").write(json.dumps(wf, indent=1))
print("wrote", out)
