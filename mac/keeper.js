// Mac keeper (pm2 "keeper"). Every 2 minutes it makes sure the whole system is up, fixes what it can, and tells the Hub.
//   - pm2 apps in apps.json: restarts any that stopped, starts missing ones (n8n and ngrok only get restarted)
//   - n8n answers on :5678, LM Studio's server answers on :1234 with the model loaded (starts it with lms if not)
//   - every 10 min: git pull, so merged fixes reach this Mac on their own
//   - hub/Code.gs changed on main: pushes it to Apps Script and deploys a new version (clasp, after one sign-in)
//   - every hour (or when a flow file changes): the n8n workflows in n8n-flows.json are imported and published (n8n-fix.js)
// Status goes to the Hub "Mac status" tab -> status lights on openframe.design/studio (Reels) and one email when
// something stays down. Free tools only. Run one check now: node mac/keeper.js once
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME = os.homedir(), HERE = __dirname, REPO = path.resolve(HERE, '..');
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const reels = readJSON(path.join(REPO, 'reels', 'config.json'), {});
const C = {
  hub: reels.hub || '', hubKey: reels.hubKey || '', model: reels.model || 'google/gemma-4-e4b',
  llm: 'http://127.0.0.1:1234', lms: reels.lms || `${HOME}/.lmstudio/bin/lms`, ctx: reels.ctx || 16384,
  py: '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13',
  scriptId: '1C76LbW1Bb1vm2Ce30mC0lTZGf_xJmag1DenYsSRBmNVnuOjQyRYkZOZi',
  deploymentId: 'AKfycbyBkDfWO-LghULYws9PCWUuqyga7kbGz2cat0w8tMIw09DmoEgtxBB7XprqRfCUyfGhpg',
  every: 2,
  ...readJSON(path.join(HERE, 'config.json'), {}),
};
const STATE = path.join(HERE, 'state.json');
const S = readJSON(STATE, {});
const save = () => fs.writeFileSync(STATE, JSON.stringify(S, null, 2));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Same PATH as env.sh, so everything this starts finds ffmpeg, python, lms and pm2.
const extra = ['/usr/local/bin', '/opt/homebrew/bin', `${HOME}/.lmstudio/bin`, path.join(HERE, 'node_modules', '.bin'), `${HOME}/.local/bin`, path.dirname(process.execPath)];
process.env.PATH = [...extra.filter(d => fs.existsSync(d)), ...String(process.env.PATH || '').split(':')].filter((d, i, a) => d && a.indexOf(d) === i).join(':');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, cwd: REPO, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), err: r.error };
}
const PM2 = ['pm2', path.join(HERE, 'node_modules', '.bin', 'pm2')].find(p => run(p, ['-v'], { timeout: 20000 }).ok) || 'pm2';
const pm2 = (...a) => run(PM2, a, { timeout: 60000 });
async function get(url, ms = 5000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? (await r.text()) : null; } catch { return null; }
}
const row = (check, label, status, detail, fix = '') => ({ check, label, status, detail, fix });

// ---------- pm2 apps ----------
async function apps() {
  const want = readJSON(path.join(HERE, 'apps.json'), { apps: [] }).apps;
  const list = (() => { const o = pm2('jlist').out; try { return JSON.parse(o.slice(o.indexOf('['))); } catch { return null; } })();
  if (!list) return [row('pm2', 'pm2', 'fail', "pm2 isn't answering.", 'Restart the Mac, or run mac/install.sh again.')];
  const out = [];
  let changed = false;
  for (const a of want) {
    const p = list.find(x => x.name === a.name), st = p && p.pm2_env.status;
    if (!p) {
      if (a.external) { if (!a.optional) out.push(row(a.name, a.label, 'fail', `${a.label} isn't set up in pm2.`, 'Ask Claude to set it up again.')); continue; }
      const args = ['start', path.join(REPO, a.script), '--name', a.name, '--cwd', path.join(REPO, a.cwd || '')];
      if (a.py) args.push('--interpreter', fs.existsSync(C.py) ? C.py : 'python3.13');
      if (a.cron) args.push('--cron-restart', a.cron, '--no-autorestart');
      if (a.args) args.push('--', ...a.args);
      const r = pm2(...args);
      changed = true;
      out.push(row(a.name, a.label, r.ok ? 'fixing' : 'fail', r.ok ? 'Was missing, started it.' : `Was missing and wouldn't start: ${r.out.slice(-160)}`));
      continue;
    }
    if (a.cron) { out.push(row(a.name, a.label, 'ok', st === 'online' ? 'Running now.' : 'Waiting for its next run.')); continue; }
    if (st === 'online') {
      // Online but not answering (n8n): restart after 2 checks in a row.
      if (a.url && !(await get(a.url))) {
        S.miss = S.miss || {}; S.miss[a.name] = (S.miss[a.name] || 0) + 1;
        if (S.miss[a.name] >= 2) { pm2('restart', a.name, '--update-env'); S.miss[a.name] = 0; out.push(row(a.name, a.label, 'fixing', "Wasn't answering, restarted it.")); continue; }
        out.push(row(a.name, a.label, 'ok', 'Running (slow to answer).')); continue;
      }
      if (S.miss) S.miss[a.name] = 0;
      const up = Math.round((Date.now() - p.pm2_env.pm_uptime) / 36e5);
      out.push(row(a.name, a.label, 'ok', `Running${up ? ` for ${up} h` : ''}.`));
      continue;
    }
    const r = pm2('restart', a.name, '--update-env');
    out.push(row(a.name, a.label, r.ok ? 'fixing' : 'fail', r.ok ? `Was ${st}, restarted it.` : `Was ${st} and wouldn't restart. Log: pm2 logs ${a.name}`));
  }
  if (changed) pm2('save');
  return out;
}

// ---------- LM Studio ----------
async function lmstudio() {
  const label = 'LM Studio (local AI)';
  const models = async () => { const t = await get(`${C.llm}/api/v0/models`); try { return JSON.parse(t).data; } catch { return t ? [] : null; } };
  let m = await models(), did = '';
  if (m == null) {
    if (!fs.existsSync(C.lms)) return row('lmstudio', label, 'fail', "LM Studio's server is off and its command line tool isn't installed.", 'Open LM Studio once. It installs lms on first start.');
    run(C.lms, ['server', 'start'], { timeout: 60000 });
    m = await models();
    if (m == null) {   // the app itself isn't running: open it hidden, then start the server
      run('open', ['-gj', '-a', 'LM Studio'], { timeout: 20000 });
      await new Promise(r => setTimeout(r, 20000));
      run(C.lms, ['server', 'start'], { timeout: 60000 });
      m = await models();
    }
    if (m == null) return row('lmstudio', label, 'fail', "LM Studio's server won't start.", 'Open the LM Studio app. In Settings, turn on "Run LLM server on login".');
    did = 'Server was off, started it. ';
  }
  // One copy only, at the context the loops need. 16 GB can't hold two: a second copy (google/gemma-4-e4b:2) filled swap.
  const ours = x => x.id === C.model || String(x.id).endsWith(C.model.split('/').pop());
  const live = m.filter(x => x.state === 'loaded');
  for (const x of live.filter(x => /:\d+$/.test(x.id))) { run(C.lms, ['unload', x.id], { timeout: 60000 }); did += `Unloaded extra copy ${x.id}. `; }
  const mine = live.find(x => ours(x) && !/:\d+$/.test(x.id));
  const short = mine && mine.loaded_context_length && mine.loaded_context_length < C.ctx;
  if (m.length && (!mine || short)) {
    // Switching or reloading: free the memory first (other chat models, or ours at the old context).
    for (const x of live.filter(x => (x.type === 'llm' || x.type === 'vlm') && !/:\d+$/.test(x.id))) run(C.lms, ['unload', x.id], { timeout: 60000 });
    const r = run(C.lms, ['load', C.model, '--identifier', C.model, '-c', String(C.ctx), '--parallel', '1', '--yes'], { timeout: 240000 });
    if (!r.ok) return row('lmstudio', label, 'fail', `${did}${C.model} wouldn't load.`, 'In LM Studio, download or load ' + C.model + '.');
    did += `Loaded ${C.model} (${C.ctx} context). `;
  }
  return row('lmstudio', label, did ? 'fixing' : 'ok', did || `Server on, ${C.model} loaded.`);
}

// ---------- repo + Hub deploy ----------
function pull() {
  if (Date.now() - (S.pulled || 0) < 10 * 6e4) return null;
  if (fs.existsSync(path.join(REPO, '.git', 'index.lock'))) return null;
  const mine = () => run('git', ['-C', REPO, 'log', '-1', '--format=%H', '--', 'mac/keeper.js']).out.trim();
  const before = mine();
  let r = run('git', ['-C', REPO, 'pull', '--rebase', '--autostash', '-q'], { timeout: 90000 });
  if (!r.ok && fs.existsSync(path.join(REPO, '.git', 'rebase-merge'))) {
    // a stuck rebase (two pulls at once, or a clash with a Reel commit): undo it and try once more
    run('git', ['-C', REPO, 'rebase', '--abort']);
    r = run('git', ['-C', REPO, 'pull', '--rebase', '--autostash', '-q'], { timeout: 90000 });
  }
  S.pulled = Date.now();
  if (r.ok) S.pullFailSince = 0; else S.pullFailSince = S.pullFailSince || Date.now();
  // new keeper code came down: let pm2 start the new version after this check reports
  if (r.ok && before && mine() !== before) S.restart = true;
  const why = r.out.replace(/\s+/g, ' ').trim().slice(-200);
  const long = S.pullFailSince && Date.now() - S.pullFailSince > 60 * 6e4;
  return row('repo', 'Code updates', long ? 'fail' : 'ok', r.ok ? 'Up to date.' : (long ? 'git pull keeps failing: ' : 'Pull failed, will retry: ') + why);
}

// After one sign-in (install.sh runs `clasp login`), every change to hub/Code.gs on main deploys itself.
function hubDeploy() {
  const label = 'Hub auto-update';
  if (!fs.existsSync(path.join(HOME, '.clasprc.json'))) return row('hub', label, 'off', 'Hub updates need a paste until you sign in once.', 'Run mac/install.sh again and click Allow.');
  const code = fs.readFileSync(path.join(REPO, 'hub', 'Code.gs'), 'utf8');
  const sha = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
  if (S.hubSha === sha) return row('hub', label, 'ok', `Hub is on the latest code (${S.hubAt || 'earlier'}).`);
  const dir = path.join(HERE, '.hub-deploy'), clasp = path.join(HERE, 'node_modules', '.bin', 'clasp');
  if (!fs.existsSync(path.join(dir, 'appsscript.json'))) {
    fs.mkdirSync(dir, { recursive: true });
    const r = run(clasp, ['clone', C.scriptId, '--rootDir', dir], { cwd: dir });
    if (!r.ok) return row('hub', label, 'fail', `Couldn't reach the Hub script: ${r.out.slice(-200)}`, 'Turn on the Apps Script API at https://script.google.com/home/usersettings');
  }
  fs.readdirSync(dir).filter(f => /\.(gs|js)$/.test(f) && f !== 'Code.js' && f !== 'Code.gs').forEach(f => fs.unlinkSync(path.join(dir, f)));
  fs.writeFileSync(path.join(dir, fs.existsSync(path.join(dir, 'Code.js')) ? 'Code.js' : 'Code.gs'), code);
  let r = run(clasp, ['push', '-f'], { cwd: dir });
  if (r.ok) r = run(clasp, ['redeploy', C.deploymentId, '-d', `auto ${sha}`], { cwd: dir });
  if (!r.ok) return row('hub', label, 'fail', `Deploy failed: ${r.out.slice(-200)}`, 'Turn on the Apps Script API at https://script.google.com/home/usersettings');
  S.hubSha = sha; S.hubAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  log('hub deployed', sha);
  return row('hub', label, 'fixing', 'Deployed the new Hub code.');
}

// ---------- n8n workflows (hourly) ----------
function n8nFlows() {
  // hourly, or right away when a workflow file changed on main
  const sum = require('crypto').createHash('sha1');
  try { for (const f of JSON.parse(fs.readFileSync(path.join(HERE, 'n8n-flows.json'), 'utf8'))) { try { sum.update(fs.readFileSync(path.join(REPO, f.file))); } catch {} } } catch {}
  const flowsSha = sum.digest('hex');
  if (Date.now() - (S.flowsAt || 0) < 60 * 6e4 && S.flows && S.flowsSha === flowsSha) return S.flows;
  S.flowsSha = flowsSha;
  const r = run(process.execPath, [path.join(HERE, 'n8n-fix.js'), '--json'], { timeout: 300000 });
  let x;
  try { x = JSON.parse(r.out.slice(r.out.lastIndexOf('\n{') + 1)); } catch { x = { status: 'fail', detail: 'Check failed: ' + r.out.slice(-160) }; }
  S.flowsAt = Date.now();
  S.flows = row('scout', 'n8n workflows (scouts, contracts)', x.status, x.detail, x.fix || '');
  return S.flows;
}

// ---------- report ----------
async function report(rows) {
  if (!C.hub || !C.hubKey) { log('no hub/hubKey in reels/config.json, status stays local'); return; }
  try {
    const res = await fetch(C.hub, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ key: C.hubKey, fn: 'loops', action: 'mac', rows }), signal: AbortSignal.timeout(60000) });
    const out = await res.json();
    if (out.error) log('hub said:', out.error);
  } catch (e) { log('hub report failed:', e.message); }
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const rows = [...(await apps()), await lmstudio()];
    const p = pull(); if (p) rows.push(p);
    try { rows.push(hubDeploy()); } catch (e) { rows.push(row('hub', 'Hub auto-update', 'fail', e.message)); }
    try { rows.push(n8nFlows()); } catch (e) { log('n8n check:', e.message); }
    rows.push(row('keeper', 'Mac keeper', 'ok', 'Checked everything.'));
    save();
    rows.filter(r => r.status !== 'ok').forEach(r => log(r.check, r.status, r.detail));
    await report(rows);
    if (process.argv[2] === 'once') console.log(JSON.stringify(rows, null, 1));
  } catch (e) { log('tick failed:', e.message); }
  finally { busy = false; }
  if (S.restart && process.argv[2] !== 'once') { S.restart = false; save(); log('new keeper code, restarting'); process.exit(0); }
}

if (process.argv[2] === 'once') tick();
else { log('keeper started'); tick(); setInterval(tick, C.every * 6e4); }
