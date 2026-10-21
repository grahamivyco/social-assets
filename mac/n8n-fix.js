// Makes sure the n8n "Open Frame viral scout" workflow is imported and published, with no clicks.
// Uses n8n's own command line (same install pm2 runs), so no API key is needed:
//   list:workflow -> import:workflow (credentials filled in from the ones already in n8n) -> publish:workflow -> pm2 restart n8n
// node mac/n8n-fix.js          fix it and say what happened
// node mac/n8n-fix.js --json   same, last line is { status, detail, fix } for the keeper
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

const HERE = __dirname, REPO = path.resolve(HERE, '..');
const NAME = 'Open Frame viral scout';
const FLOW = path.join(REPO, 'watch', 'scout', 'n8n-viral-scout.json');
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
if (!app) done('fail', "n8n isn't running under pm2, so the scout can't be checked.", 'Ask Claude to set up n8n in pm2.');
const bin = app.pm2_env.pm_exec_path, interp = app.pm2_env.exec_interpreter;
const env = { ...process.env, ...(app.pm2_env.env || {}) };
// pm2 usually runs n8n's own bin file with node. If it runs a wrapper script instead, use the n8n on the PATH.
const direct = /node_modules\/n8n\/|\/n8n$/.test(bin);
const n8n = (...a) => !direct ? run('n8n', a, { env }) : interp === 'none' ? run(bin, a, { env }) : run(process.execPath, [bin, ...a], { env });
const flows = out => out.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim().match(/([A-Za-z0-9]{16})\|(.+)$/)).filter(Boolean).map(m => ({ id: m[1], name: m[2].trim() }));
const all = flows(n8n('list:workflow').out);
const active = flows(n8n('list:workflow', '--active=true').out);
let mine = all.find(w => w.name === NAME);
if (mine && active.some(w => w.id === mine.id)) done('ok', 'Published. Runs Mondays 7:30.');

if (!mine) {
  // Credential ids by type from the ones already set up (no secrets read: plain export has no decrypted data).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-'));
  const ex = n8n('export:credentials', '--all', `--output=${path.join(tmp, 'creds.json')}`);
  let creds = [];
  try { creds = JSON.parse(fs.readFileSync(path.join(tmp, 'creds.json'), 'utf8')); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!creds.length) done('fail', "Couldn't read n8n's credential list: " + ex.out.slice(-160), 'Import it by hand: n8n > Import from URL.');
  const pick = (type, name) => creds.find(c => c.type === type && c.name === name) || creds.find(c => c.type === type);
  const wf = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  for (const n of wf.nodes) for (const [type, ref] of Object.entries(n.credentials || {})) {
    const c = pick(type, ref.name);
    if (!c) done('fail', `No "${type}" credential in n8n for the scout.`, 'Set up the Google service account and "Open Frame Page" credentials in n8n.');
    n.credentials[type] = { id: c.id, name: c.name };
  }
  wf.id = 'ofViralScout0001';
  wf.active = false;
  const f = path.join(os.tmpdir(), 'of-viral-scout.json');
  fs.writeFileSync(f, JSON.stringify(wf));
  const im = n8n('import:workflow', `--input=${f}`);
  fs.unlinkSync(f);
  mine = flows(n8n('list:workflow').out).find(w => w.name === NAME);
  if (!mine) done('fail', "Import didn't work: " + im.out.slice(-200), 'Import it by hand: n8n > Import from URL.');
}

const pub = n8n('publish:workflow', `--id=${mine.id}`);
if (!pub.ok) {
  const old = n8n('update:workflow', `--id=${mine.id}`, '--active=true');   // n8n 1.x name for the same thing
  if (!old.ok) done('fail', "Couldn't publish the scout: " + pub.out.slice(-200), `Open http://localhost:5678/workflow/${mine.id} and click Publish.`);
}
run(PM2, ['restart', 'n8n', '--update-env']);   // n8n only picks up published changes on restart
done('fixing', 'Imported and published the scout, restarted n8n.');
