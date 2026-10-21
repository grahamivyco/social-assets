# Builds n8n-contract-check.json from code/. Run: python3 build-workflow.py
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('OUT', os.path.join(HERE, 'n8n-contract-check.json'))
LM = 'http://127.0.0.1:1234/v1/chat/completions'
code = lambda f: open(os.path.join(HERE, 'code', f)).read()
nodes = []
def add(name, type_, ver, params, x, **extra):
    nodes.append({'parameters': params, 'id': 'cc%d' % len(nodes), 'name': name, 'type': type_, 'typeVersion': ver,
                  'position': [x, 300], **extra})
def js(name, f, x):
    add(name, 'n8n-nodes-base.code', 2, {'jsCode': code(f)}, x)
def ai(name, body, x):
    add(name, 'n8n-nodes-base.httpRequest', 4.2, {'method': 'POST', 'url': LM, 'sendBody': True, 'specifyBody': 'json',
        'jsonBody': body, 'options': {'timeout': 300000, 'batching': {'batch': {'batchSize': 1, 'batchInterval': 0}}}},
        x, onError='continueRegularOutput')

add('Contract emails', 'n8n-nodes-base.emailReadImap', 2.1,
    {'mailbox': 'INBOX', 'postProcessAction': 'read', 'downloadAttachments': True, 'format': 'simple',
     # Only mail sent to the +contract address, so no Gmail filter or label is needed
     'options': {'customEmailConfig': '["UNSEEN", ["TO", "grahamivy.co+contract@gmail.com"]]'}}, 0, credentials={'imap': {'id': '', 'name': 'Gmail IMAP'}})
js('Find the contract', 'find-contract.js', 220)
add('Read contract PDF', 'n8n-nodes-base.extractFromFile', 1,
    {'operation': 'pdf', 'binaryPropertyName': '={{ $json.pdfKey }}', 'options': {}}, 440,
    onError='continueRegularOutput', alwaysOutputData=True)
js('Build extraction requests', 'build-requests.js', 660)
ai('Local AI: terms from emails', '={{ JSON.stringify($json.llmEmail) }}', 880)
ai('Local AI: terms from contract', "={{ JSON.stringify($('Build extraction requests').item.json.llmContract) }}", 1100)
js('Compare terms', 'compare.js', 1320)
ai('Local AI: same or different', '={{ JSON.stringify($json.judge || { skip: true }) }}', 1540)
js('Write report', 'write-report.js', 1760)
add('Email me the report', 'n8n-nodes-base.emailSend', 2.1,
    {'fromEmail': 'Contract check <grahamivy.co@gmail.com>', 'toEmail': 'grahamivy.co@gmail.com',
     'subject': '={{ $json.subject }}', 'emailFormat': 'text', 'text': '={{ $json.text }}', 'options': {'appendAttribution': False}},
    1980, credentials={'smtp': {'id': '', 'name': 'Gmail SMTP'}})
names = [n['name'] for n in nodes]
conns = {a: {'main': [[{'node': b, 'type': 'main', 'index': 0}]]} for a, b in zip(names, names[1:])}
json.dump({'name': 'Open Frame contract check', 'nodes': nodes, 'connections': conns, 'settings': {'executionOrder': 'v1'}},
          open(OUT, 'w'), indent=1)
print('wrote', OUT)
