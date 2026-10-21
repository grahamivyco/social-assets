# Builds n8n-viral-scout.json from code/. Run: python3 build-workflow.py
# Weekly: creators (Viral creators tab + active brand-scout Creators) -> IG business_discovery -> Reels at 3x+ the
# creator's own median -> Outliers tab -> the Mac watch tool (127.0.0.1:5680/scout). patterns.py writes the report.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = 'https://docs.google.com/spreadsheets/d/1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU/edit'
IG = 'https://graph.facebook.com/v21.0/17841420040350345'
GOOGLE = {'googleApi': {'id': '', 'name': 'Google Service Account account'}}
META = {'facebookGraphApi': {'id': '', 'name': 'Open Frame Page'}}
COLS = ['permalink', 'handle', 'followers', 'posted', 'likes', 'comments', 'ratio', 'caption', 'status', 'found_at']
code = lambda f: open(os.path.join(HERE, 'code', f)).read()
nodes, conns = [], {}
V = {'n8n-nodes-base.scheduleTrigger': 1.2, 'n8n-nodes-base.googleSheets': 4.5, 'n8n-nodes-base.httpRequest': 4.2,
     'n8n-nodes-base.code': 2}

def add(name, type_, params, x, y, **extra):
    nodes.append({'parameters': params, 'id': 'vs%d' % len(nodes), 'name': name, 'type': type_,
                  'typeVersion': V[type_], 'position': [x, y], **extra})

def link(a, *bs):
    conns[a] = {'main': [[{'node': b, 'type': 'main', 'index': 0} for b in bs]]}

def sheet(name, tab, x, y, op='read', cols=None, **extra):
    p = {'documentId': {'__rl': True, 'mode': 'url', 'value': SHEET},
         'sheetName': {'__rl': True, 'mode': 'name', 'value': tab}, 'options': {}, 'authentication': 'serviceAccount'}
    if op != 'read':
        p['operation'] = op
        schema = [{'id': c, 'displayName': c, 'required': False, 'defaultMatch': False, 'display': True,
                   'type': 'string', 'canBeUsedToMatch': True, 'removed': False} for c in cols]
        p['columns'] = {'mappingMode': 'defineBelow', 'value': {c: '={{ $json.%s }}' % c for c in cols},
                        'matchingColumns': [], 'schema': schema,
                        'attemptToConvertTypes': False, 'convertFieldsToString': False}
    add(name, 'n8n-nodes-base.googleSheets', p, x, y, credentials=GOOGLE, **extra)

add('Every Monday 7:30', 'n8n-nodes-base.scheduleTrigger',
    {'rule': {'interval': [{'field': 'weeks', 'triggerAtDay': [1], 'triggerAtHour': 7, 'triggerAtMinute': 30}]}}, 0, 300)
sheet('Read Viral creators', 'Viral creators', 220, 300, executeOnce=True, alwaysOutputData=True, onError='continueRegularOutput')
sheet('Read Creators', 'Creators', 440, 300, executeOnce=True, alwaysOutputData=True)
sheet('Read Outliers', 'Outliers', 660, 300, executeOnce=True, alwaysOutputData=True)
add('Creators to check', 'n8n-nodes-base.code', {'jsCode': code('creators-to-check.js')}, 880, 300)
add('IG: creator Reels', 'n8n-nodes-base.httpRequest',
    {'url': IG, 'sendQuery': True, 'specifyQuery': 'json', 'jsonQuery': '={{ JSON.stringify({ fields: $json.fields }) }}',
     'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 400}}},
     'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'facebookGraphApi'},
    1100, 300, credentials=META, onError='continueRegularOutput')
add('Find outliers', 'n8n-nodes-base.code', {'jsCode': code('find-outliers.js')}, 1320, 300)
sheet('Save to Outliers', 'Outliers', 1540, 200, 'append', COLS)
add('Send to watch tool', 'n8n-nodes-base.httpRequest',
    {'method': 'POST', 'url': 'http://127.0.0.1:5680/scout', 'sendBody': True, 'specifyBody': 'json',
     'jsonBody': "={{ JSON.stringify({ url: $json.permalink, note: 'outlier ' + $json.ratio + 'x @' + $json.handle }) }}",
     'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 200}}}},
    1540, 420, onError='continueRegularOutput')
link('Every Monday 7:30', 'Read Viral creators'); link('Read Viral creators', 'Read Creators')
link('Read Creators', 'Read Outliers'); link('Read Outliers', 'Creators to check')
link('Creators to check', 'IG: creator Reels'); link('IG: creator Reels', 'Find outliers')
link('Find outliers', 'Save to Outliers', 'Send to watch tool')
wf = {'name': 'Open Frame viral scout', 'nodes': nodes, 'connections': conns, 'settings': {'executionOrder': 'v1'}}
json.dump(wf, open(os.path.join(HERE, 'n8n-viral-scout.json'), 'w'), indent=1)
print('wrote', len(nodes), 'nodes')
