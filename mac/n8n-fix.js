// Keeps the n8n workflows listed in mac/n8n-flows.json imported and published, with no clicks.
// Uses n8n's own command line (same install pm2 runs), so no API key is needed:
//   list:workflow -> import:workflow (credentials filled in from the ones already in n8n) -> publish:workflow -> pm2 restart n8n
// A flow is (re)imported when it's missing or its file changed on main (sha kept in mac/state-n8n.json), always under the
// same id. "active": true flows get published; "active": false ones stay as they were (off until someone turns them on).
// To add a workflow: add a line to n8n-flows.json (id = 16 letters/digits).
// node mac/n8n-fix.js          fix it and say what happened
// node mac/n8n-fix.js --json   same, last line is { status, detail, fix } for the keeper
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname, REPO = path.resolve(HERE, '..');
const FLOWS = JSON.parse(fs.readFileSync(path.join(HERE, 'n8n-flows.json'), 'utf8'));
const STATE = path.join(HERE, 'state-n8n.json');
const json = process.argv.includes('--json');
const done = (status, detail, fix = '') => {
  if (json) console.log('\n' + JSON.stringify({ status, detail, fix }));
  else console.log(`${status}: ${detail}${fix ? '\n' + fix : ''}`);
  process.exit(0);
};
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 180000, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

// Find how pm2 runs n8n, and run the CLI the same way (same binary, same env, same database).
const PM2 = ['pm2', path.join(HERE, 'node_modules', '.bin', 'pm2')].find(p => run(p, ['-v'], { timeout: 20000 }).ok);
if (!PM2) done('fail', "pm2 isn't installed.", 'Run mac/install.sh.');
const jl = run(PM2, ['jlist']).out;
let list = [];
try { list = JSON.parse(jl.slice(jl.indexOf('['))); } catch {}
const app = list.find(p => p.name === 'n8n');
if (!app) done('fail', "n8n isn't running under pm2, so its workflows can't be checked.", 'Ask Claude to set up n8n in pm2.');
const bin = app.pm2_env.pm_exec_path, interp = app.pm2_env.exec_interpreter;
const env = { ...process.env, ...(app.pm2_env.env || {}) };
// pm2 usually runs n8n's own bin file with node. If it runs a wrapper script instead, use the n8n on the PATH.
const direct = /node_modules\/n8n\/|\/n8n$/.test(bin);
const n8n = (...a) => !direct ? run('n8n', a, { env }) : interp === 'none' ? run(bin, a, { env }) : run(process.execPath, [bin, ...a], { env });
const flows = out => out.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim().match(/([A-Za-z0-9]{16})\|(.+)$/)).filter(Boolean).map(m => ({ id: m[1], name: m[2].trim() }));
const all = flows(n8n('list:workflow').out);
const active = flows(n8n('list:workflow', '--active=true').out);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}

// Credential ids by type from the ones already set up (no secrets read: plain export has no decrypted data).
let creds = null, credsErr = '';
function credList() {
  if (creds) return creds;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-'));
  const ex = n8n('export:credentials', '--all', `--output=${path.join(tmp, 'creds.json')}`);
  try { creds = JSON.parse(fs.readFileSync(path.join(tmp, 'creds.json'), 'utf8')); } catch { creds = []; credsErr = ex.out.slice(-160); }
  fs.rmSync(tmp, { recursive: true, force: true });
  return creds;
}

const fails = [], changed = [];
for (const f of FLOWS) {
  const file = path.join(REPO, f.file);
  if (!fs.existsSync(file)) { fails.push({ f, why: `${f.file} isn't in the repo yet.` }); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const sha = crypto.createHash('sha1').update(text).digest('hex');
  const have = all.find(w => w.id === f.id) || all.find(w => w.name === f.name);
  const id = have ? have.id : f.id;
  const wasOn = active.some(w => w.id === id);
  if (!have || state[id] !== sha) {
    const list = credList();
    if (!list.length) { fails.push({ f, why: "Couldn't read n8n's credential list: " + credsErr }); continue; }
    const pick = (type, name) => list.find(c => c.type === type && c.name === name) || list.find(c => c.type === type);
    const wf = JSON.parse(text);
    let missing = '';
    for (const n of wf.nodes) for (const [type, ref] of Object.entries(n.credentials || {})) {
      const c = pick(type, ref.name);
      if (!c) { missing = `No "${ref.name || type}" credential in n8n.`; break; }
      n.credentials[type] = { id: c.id, name: c.name };
    }
    if (missing) { fails.push({ f, why: missing, fix: `Add the "${f.name}" credentials in n8n (http://localhost:5678/home/credentials).` }); continue; }
    wf.id = id; wf.name = wf.name || f.name; wf.active = false;
    // own temp folder per run: the keeper's check and install.sh can run this at the same moment
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-flow-'));
    const tmpf = path.join(dir, 'flow.json');
    fs.writeFileSync(tmpf, JSON.stringify(wf));
    const im = n8n('import:workflow', `--input=${tmpf}`);
    fs.rmSync(dir, { recursive: true, force: true });
    if (!flows(n8n('list:workflow').out).some(w => w.id === id)) { fails.push({ f, why: "Import didn't work: " + im.out.slice(-200) }); continue; }
    state[id] = sha;
    changed.push(`${have ? 'updated' : 'added'} ${f.name}`);
  } else if (!(f.active && !wasOn)) continue;
  // publish: always for active flows; for off-by-default ones only if someone had already turned it on
  if (f.active || wasOn) {
    const pub = n8n('publish:workflow', `--id=${id}`);
    if (!pub.ok && !n8n('update:workflow', `--id=${id}`, '--active=true').ok)   // n8n 1.x name for the same thing
      fails.push({ f, why: "Couldn't publish: " + pub.out.slice(-200), fix: `Open http://localhost:5678/workflow/${id} and click Publish.` });
    else if (!wasOn) changed.push(`published ${f.name}`);
  }
}
fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
if (changed.length) run(PM2, ['restart', 'n8n', '--update-env']);   // n8n only picks up published changes on restart

if (fails.length) done('fail', fails.map(x => `${x.f.name}: ${x.why}`).join(' '), fails.map(x => x.fix).filter(Boolean)[0] || 'Ask Claude to look at mac/n8n-fix.js.');
if (changed.length) done('fixing', changed.join(', ').replace(/^./, c => c.toUpperCase()) + '; restarted n8n.');
done('ok', `All ${FLOWS.length} workflows are in n8n and the ones that should run are published.`);
