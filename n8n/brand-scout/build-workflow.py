# Builds n8n-brand-scout.json from the code/ files. Run: python3 build-workflow.py
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = 'https://docs.google.com/spreadsheets/d/1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU/edit'
IG = 'https://graph.facebook.com/v21.0/17841420040350345'
GOOGLE = {'googleApi': {'id': '', 'name': 'Google Service Account account'}}
META = {'facebookGraphApi': {'id': '', 'name': 'Open Frame Page'}}
code = lambda f: open(os.path.join(HERE, 'code', f)).read()
nodes, conns = [], {}

def add(name, type_, params, x, y, **extra):
    nodes.append({'parameters': params, 'id': 'bd%d' % len(nodes), 'name': name, 'type': type_,
                  'typeVersion': {'n8n-nodes-base.scheduleTrigger': 1.2, 'n8n-nodes-base.googleSheets': 4.5,
                                  'n8n-nodes-base.httpRequest': 4.2, 'n8n-nodes-base.code': 2}[type_],
                  'position': [x, y], **extra})

def link(a, *bs):
    conns[a] = {'main': [[{'node': b, 'type': 'main', 'index': 0} for b in bs]]}

def sheet(name, tab, x, y, op='read', cols=None, **extra):
    p = {'documentId': {'__rl': True, 'mode': 'url', 'value': SHEET},
         'sheetName': {'__rl': True, 'mode': 'name', 'value': tab}, 'options': {}, 'authentication': 'serviceAccount'}
    if op != 'read':
        p['operation'] = op
        # n8n needs the column schema on write nodes, or it fails with 'Could not get parameter "columns.schema"'
        schema = [{'id': c, 'displayName': c, 'required': False, 'defaultMatch': False, 'display': True,
                   'type': 'string', 'canBeUsedToMatch': True, 'removed': False} for c in cols]
        p['columns'] = {'mappingMode': 'defineBelow', 'value': {c: '={{ $json.%s }}' % c for c in cols},
                        'matchingColumns': ['handle'] if op == 'appendOrUpdate' else [], 'schema': schema,
                        'attemptToConvertTypes': False, 'convertFieldsToString': False}
    add(name, 'n8n-nodes-base.googleSheets', p, x, y, credentials=GOOGLE, **extra)

def ig(name, x, y, query, **extra):
    add(name, 'n8n-nodes-base.httpRequest', {'url': IG, 'sendQuery': True, 'specifyQuery': 'json', 'jsonQuery': query,
        'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 400}}},
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'facebookGraphApi'},
        x, y, credentials=META, onError='continueRegularOutput', **extra)

def js(name, f, x, y):
    add(name, 'n8n-nodes-base.code', {'jsCode': code(f)}, x, y)

add('Every Monday 6am', 'n8n-nodes-base.scheduleTrigger',
    {'rule': {'interval': [{'field': 'weeks', 'triggerAtDay': [1], 'triggerAtHour': 6}]}}, 0, 300)
sheet('Read Creators', 'Creators', 220, 300, executeOnce=True, alwaysOutputData=True)
sheet('Read Brands', 'Brands', 440, 300, executeOnce=True, alwaysOutputData=True)
ig('IG: my profile', 660, 300, '={{ JSON.stringify({ fields: "username,biography,followers_count,media.limit(50){caption}" }) }}', executeOnce=True)
js('Creators to scan', 'creators-to-scan.js', 880, 300)
ig('IG: look up creator', 1100, 300, '={{ JSON.stringify({ fields: $json.fields }) }}')
js('Creator results', 'creator-results.js', 1320, 300)
sheet('Update Creators', 'Creators', 1540, 160, 'appendOrUpdate',
      ['handle', 'status', 'name', 'followers', 'similarity', 'deal_posts', 'top_brands', 'last_scanned', 'handle_check'])
js('Brand candidates', 'brand-candidates.js', 1540, 420)
ig('IG: look up brand', 1760, 420, '={{ JSON.stringify({ fields: $json.fields }) }}')
js('Brand profiles', 'brand-profiles.js', 1980, 420)
add('Local AI: brand fit', 'n8n-nodes-base.httpRequest',
    {'method': 'POST', 'url': 'http://127.0.0.1:1234/v1/chat/completions', 'sendBody': True, 'specifyBody': 'json',
     'jsonBody': '={{ JSON.stringify($json.llm || { skip: true }) }}',
     'options': {'timeout': 120000, 'batching': {'batch': {'batchSize': 1, 'batchInterval': 0}}}},
    2200, 420, onError='continueRegularOutput')
js('Brand rows', 'brand-rows.js', 2420, 420)
js('Brands to save', 'brands-to-save.js', 2640, 320)
sheet('Save Brands', 'Brands', 2860, 320, 'appendOrUpdate',
      ['handle', 'name', 'status', 'fit', 'why', 'creators_seen', 'creator_handles', 'deal_posts', 'followers', 'website',
       'example_post', 'last_seen', 'bio', 'handle_check', 'last_checked'])
js('New creators', 'new-creators.js', 2640, 540)
sheet('Add suggested creators', 'Creators', 2860, 540, 'append', ['handle', 'status', 'source'])

link('Every Monday 6am', 'Read Creators'); link('Read Creators', 'Read Brands'); link('Read Brands', 'IG: my profile')
link('IG: my profile', 'Creators to scan'); link('Creators to scan', 'IG: look up creator')
link('IG: look up creator', 'Creator results'); link('Creator results', 'Update Creators', 'Brand candidates')
link('Brand candidates', 'IG: look up brand'); link('IG: look up brand', 'Brand profiles')
link('Brand profiles', 'Local AI: brand fit'); link('Local AI: brand fit', 'Brand rows')
link('Brand rows', 'Brands to save', 'New creators'); link('Brands to save', 'Save Brands')
link('New creators', 'Add suggested creators')

wf = {'name': 'Open Frame brand scout', 'nodes': nodes, 'connections': conns, 'settings': {'executionOrder': 'v1'}}
json.dump(wf, open(os.path.join(HERE, '..', 'brand-scout.json'), 'w'), indent=1)
print('wrote', len(nodes), 'nodes')
