# Builds n8n-brand-contacts.json from code/. Run: python3 build-workflow.py
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('OUT', os.path.join(HERE, 'n8n-brand-contacts.json'))
SHEET = 'https://docs.google.com/spreadsheets/d/1VgiiTBTpmFh5bqutvYvjvNZmSicc8Es2vLSmnPlpHaU/edit'
GOOGLE = {'googleApi': {'id': '', 'name': 'Google Service Account account'}}
code = lambda f: open(os.path.join(HERE, 'code', f)).read()
tab = {'documentId': {'__rl': True, 'mode': 'url', 'value': SHEET},
       'sheetName': {'__rl': True, 'mode': 'name', 'value': 'Brands'}, 'options': {}, 'authentication': 'serviceAccount'}
cols = ['handle', 'domain', 'contact_email', 'other_emails', 'email_found_on', 'program_url', 'linkedin_search', 'contacts_checked']
schema = [{'id': c, 'displayName': c, 'required': False, 'defaultMatch': False, 'display': True,
           'type': 'string', 'canBeUsedToMatch': True, 'removed': False} for c in cols]
nodes = [
    {'parameters': {'rule': {'interval': [{'field': 'weeks', 'triggerAtDay': [1], 'triggerAtHour': 7}]}},
     'id': 'bc0', 'name': 'Every Monday 7am', 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2, 'position': [0, 300]},
    {'parameters': tab, 'id': 'bc1', 'name': 'Read Brands', 'type': 'n8n-nodes-base.googleSheets', 'typeVersion': 4.5,
     'position': [220, 300], 'credentials': GOOGLE, 'executeOnce': True, 'alwaysOutputData': True},
    {'parameters': {'jsCode': code('brands-to-check.js')}, 'id': 'bc2', 'name': 'Brands to check',
     'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [440, 300]},
    {'parameters': {'jsCode': code('find-contacts.js')}, 'id': 'bc3', 'name': 'Find contacts on brand websites',
     'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [660, 300]},
    {'parameters': {**tab, 'operation': 'appendOrUpdate', 'columns': {'mappingMode': 'defineBelow',
        'value': {c: '={{ $json.%s }}' % c for c in cols}, 'matchingColumns': ['handle'], 'schema': schema,
        'attemptToConvertTypes': False, 'convertFieldsToString': False}},
     'id': 'bc4', 'name': 'Save contacts', 'type': 'n8n-nodes-base.googleSheets', 'typeVersion': 4.5,
     'position': [880, 300], 'credentials': GOOGLE},
]
chain = ['Every Monday 7am', 'Read Brands', 'Brands to check', 'Find contacts on brand websites', 'Save contacts']
conns = {a: {'main': [[{'node': b, 'type': 'main', 'index': 0}]]} for a, b in zip(chain, chain[1:])}
json.dump({'name': 'Open Frame brand contacts', 'nodes': nodes, 'connections': conns, 'settings': {'executionOrder': 'v1'}},
          open(OUT, 'w'), indent=1)
print('wrote', OUT)
