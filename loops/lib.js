// Shared pieces for every loop: settings, the local AI, the Hub, the self-check, the run log, git sync.
// Free tools only: LM Studio on this Mac, the Hub (Google Apps Script), git.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const LLM = require('./llm');

const HERE = __dirname, HOME = os.homedir();
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const reels = readJSON(path.join(HERE, '..', 'reels', 'config.json'), {});

// loops/config.json wins, then reels/config.json (hub, hubKey, model are shared), then these defaults.
const C = {
  repo: path.resolve(HERE, '..'),
  llm: 'http://127.0.0.1:1234/v1/chat/completions',
  model: reels.model || 'qwen/qwen3.5-9b',
  embed: 'text-embedding-nomic-embed-text-v1.5',
  hub: reels.hub || '', hubKey: reels.hubKey || '',
  watched: `${HOME}/Downloads/Open Frame LLC & Clients/Watched`,
  scripts: `${HOME}/Downloads/Open Frame LLC & Clients/Scripts`,
  push: true,
  ...readJSON(path.join(HERE, 'config.json'), {}),
};
const STATE = path.join(HERE, 'state');

function log(...a) { console.log(new Date().toISOString(), ...a); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const today = () => new Date().toISOString().slice(0, 10);
const clients = () => Object.entries(readJSON(path.join(HERE, 'clients.json'), {}))
  .filter(([k, v]) => !k.startsWith('_') && v.enabled).map(([id, v]) => ({ id, ...v }));

// {{name}} in a prompt file -> value. Lists become bullet lines.
function fill(file, vars) {
  return fs.readFileSync(path.join(HERE, 'prompts', file), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    if (Array.isArray(v)) return v.length ? v.map(x => '- ' + x).join('\n') : '(none yet)';
    return v == null || v === '' ? '(none yet)' : String(v);
  });
}

// system: standing instructions (voice rules, examples) sent as the system message, kept apart from the task.
// One model copy is shared with reel-watch and asks.js, so a request can wait in LM Studio's queue: a timeout gets one
// more try with double the time before the loop gives up (Loop runs showed ideas and engage timing out at 4 minutes).
// Plain http, not fetch: Node's fetch drops any answer that takes over 5 minutes to start ("fetch failed"), so the
// 8-minute retry never got its 8 minutes and reel-ask, scripts, ideas and audio never finished once (audit 2026-10-29).
function post(url, body, ms) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => { clearTimeout(t); resolve({ ok: res.statusCode < 300, status: res.statusCode, json: () => JSON.parse(text) }); });
      res.on('error', e => { clearTimeout(t); reject(e); });
    });
    const t = setTimeout(() => req.destroy(Object.assign(new Error(`LM Studio took over ${ms / 60000} min`), { name: 'TimeoutError' })), ms);
    req.on('error', e => { clearTimeout(t); reject(e); });
    req.end(body);
  });
}

async function ask(prompt, schema, temperature = 0.4, { system } = {}) {
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  const body = JSON.stringify({ model: C.model, messages, max_tokens: 4000, ...LLM.sampling(temperature),
    response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema } } });
  let res;
  try { res = await post(C.llm, body, 240000); } catch (e) {
    if (e.name !== 'TimeoutError' && !/ECONNREFUSED|ECONNRESET|socket hang up/.test(e.message)) throw e;
    log('LM Studio slow or unreachable, trying once more:', e.message);
    await sleep(15000);
    res = await post(C.llm, body, 480000);
  }
  if (!res.ok) throw new Error(`LM Studio said ${res.status}. Is it running with ${C.model} loaded?`);
  return JSON.parse(LLM.content(res.json().choices[0].message));
}

// The owner's own filmed scripts (prompts/voice.md, Open Frame only), the n closest to this topic first.
// The small embedding model already in LM Studio does the matching; if it can't load, the first n are used.
async function voice(client, topic, n = 3) {
  if (client.id !== 'open-frame') return '';
  let ex = [];
  try { ex = fs.readFileSync(path.join(HERE, 'prompts', 'voice.md'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, '').split(/^Example \d+:\s*$/m).map(x => x.trim()).filter(Boolean); } catch { return ''; }
  try {
    const res = await fetch(C.llm.replace(/\/chat\/completions$/, '/embeddings'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: C.embed, input: ['search_query: ' + topic, ...ex.map(x => 'search_document: ' + x)] }), signal: AbortSignal.timeout(60000) });
    const v = (await res.json()).data.map(d => d.embedding);
    const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    ex = ex.map((x, i) => [cos(v[0], v[i + 1]), x]).sort((a, b) => b[0] - a[0]).map(r => r[1]);
  } catch {}
  return `You write short talking head Reel scripts that ${client.name}'s owner, Graham, says to camera. Sound exactly like him: short spoken lines, "you", one concrete step, plain words, no hype.
Here is how he really talks. Copy the rhythm, never the topics or lines:

${ex.slice(0, n).map((x, i) => `Example ${i + 1}:\n${x}`).join('\n\n')}`;
}

// Network blips (Wi-Fi waking up) and Google's busy page ("<!doctype ..." instead of JSON) are retried 3 times before
// the loop fails. A Hub error answer ({ error }) is real and is not retried, except 'Hub busy' (another run holds the lock).
async function hub(action, data = {}) {
  if (!C.hub || !C.hubKey) throw new Error('Add "hub" and "hubKey" to reels/config.json or loops/config.json');
  let last;
  for (const wait of [0, 5000, 20000, 60000]) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(C.hub, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ key: C.hubKey, fn: 'loops', action, ...data }), signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      let out;
      try { out = JSON.parse(text); } catch { throw new Error(`Hub sent a page instead of data (${res.status})`); }
      if (out.error) throw Object.assign(new Error('Hub: ' + out.error), { final: !/Hub busy|bloqueo|lock/i.test(out.error) });
      return out;
    } catch (e) { if (e.final) throw e; last = e; }
  }
  throw last;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every decision a person has to make also goes in the Hub's Approvals tab, for Studio (format: Open-Frame docs/approval-items.md,
// map of who writes what: loops/APPROVALS.md). The Hub checks the kind and the client_ok rules and skips an id it already has.
// row: { id, client (brand or name), kind, title, detail, job, preview, options, due, client_ok, made_by, status: 'draft' | 'client' | 'planned' }
// Leave client_ok out and the Hub uses the client's client_approves from the Clients tab.
const approval = rows => hub('approval-add', { rows: [].concat(rows) });
// The answers come back here: { made_by, status, ids, client } -> rows with status, answer, comment, updated (Studio writes those).
const approvals = (filter = {}) => hub('approval-list', filter).then(o => o.rows);
// Moves a row this loop wrote with status 'planned' (Coming up on the client's page) to 'draft' or 'client' once it's made.
const approvalSet = rows => hub('approval-set', { rows: [].concat(rows) });

// The rule half of the self-check. Same bans as Graham's copy rules (memory + brands/design-notes.md).
const BANNED = ['leverage', 'seamless', 'robust', 'elevate', 'unlock', 'empower', 'transform', 'game-changer', 'game changer',
  'landscape', 'journey', 'delve', 'dive in', 'testament', "in today's world", 'next level', 'synergy', 'cutting-edge'];
function rules(text, { maxWords = 0, firstPersonOk = true } = {}) {
  const t = String(text || ''), low = t.toLowerCase(), out = [];
  BANNED.forEach(w => { if (new RegExp(`\\b${w.replace(/[-']/g, '.')}`, 'i').test(low)) out.push(`banned word "${w}"`); });
  if (/[—–]/.test(t)) out.push('em dash');
  if (/\bnot (just |only )?[\w\s']{1,30}, but\b|\bisn'?t just\b|\bisn't about\b/i.test(t)) out.push('"not X, but Y"');
  if (/whether you'?re/i.test(t)) out.push('"whether you\'re" setup');
  if (/^[^.\n]{0,80}\?/.test(t.trim())) out.push('opens with a question');
  if (!firstPersonOk && /\b(i|we|our|us|my)\b/i.test(t)) out.push('first-person word');
  if (/\[(name|client|insert)[^\]]*\]|lorem ipsum|XX%/i.test(t)) out.push('placeholder left in');
  const words = t.split(/\s+/).filter(Boolean).length;
  if (maxWords && words > maxWords) out.push(`${words} words, max ${maxWords}`);
  return out;
}

// The AI half of the self-check: a second local-AI pass scores it. Kept only if every score is 3+ and the average is 3.5+.
const JUDGE = { type: 'object', additionalProperties: false, required: ['fit', 'specific', 'hook', 'doable', 'reason'],
  properties: { fit: { type: 'integer' }, specific: { type: 'integer' }, hook: { type: 'integer' }, doable: { type: 'integer' }, reason: { type: 'string' } } };
async function judge(client, text) {
  const s = await ask(fill('judge.md', { ...client, text }), JUDGE, 0);
  const nums = [s.fit, s.specific, s.hook, s.doable].map(n => Math.max(1, Math.min(5, Number(n) || 1)));
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { ok: Math.min(...nums) >= 3 && avg >= 3.5, avg: Math.round(avg * 10) / 10, reason: s.reason };
}

// One line per run, here (state/runs.jsonl, read by the weekly review) and in the Hub "Loop runs" tab.
async function logRun(run) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(path.join(STATE, 'runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...run }) + '\n');
  try { await hub('log', { run }); } catch (e) { log('hub log failed:', e.message); }
}

// Loops share state through the repo: the Mac pushes loops/state, the weekly review reads it and pushes lessons + prompt fixes.
const git = (...a) => execFileSync('git', ['-C', C.repo, ...a], { encoding: 'utf8' });
function pull() { try { git('pull', '--rebase', '--autostash', '-q'); } catch (e) { log('git pull failed:', e.message.split('\n')[0]); } }
function pushState(msg, extra = []) {
  if (!C.push) return;
  const paths = ['loops/state', ...extra];
  try {
    git('add', ...paths);
    if (!git('status', '--porcelain', ...paths).trim()) return;
    git('commit', '-q', '-m', msg, '--', ...paths);
    pull();
    git('push', '-q');
  } catch (e) { log('git push failed:', e.message.split('\n')[0]); }
}

// Put a page on GitHub Pages (public link, unguessable folder). Returns the https link. Pages takes about a minute to go live.
const PAGES = 'https://grahamivyco.github.io/social-assets';
function publish(dir, files, msg) {
  const abs = path.join(C.repo, dir);
  fs.mkdirSync(abs, { recursive: true });
  Object.entries(files).forEach(([name, body]) => fs.writeFileSync(path.join(abs, name), body));
  if (C.push) {
    git('add', dir);
    git('commit', '-q', '-m', msg || `Loops: publish ${dir}`, '--', dir);
    pull();
    git('push', '-q');
  }
  return `${PAGES}/${dir.replace(/\\/g, '/')}/`;
}
const token = (n = 10) => require('crypto').randomBytes(n).toString('hex').slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Open Frame page shell for client-facing pages the loops make (proposals). Brand fonts and colors from brands/open-frame.
function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=Inter:wght@400;500;600&display=swap">
<style>:root{--ink:#111110;--ink2:#4B4A46;--cream:#F3F1EA;--red:#F24333;--blue:#2F6BF0;--yellow:#F4BF3A;--green:#33AC66}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:16px/1.6 Inter,Arial,sans-serif;padding:0 max(16px,env(safe-area-inset-left))}
main{max-width:760px;margin:0 auto;padding:40px 0 64px;display:grid;gap:28px}h1,h2{font-family:Fraunces,Georgia,serif;font-weight:500;margin:0;line-height:1.1}
h1{font-size:clamp(32px,5vw,48px)}h1 i{color:var(--red)}h2{font-size:24px}.logo{height:26px}.card{background:var(--cream);border:2.5px solid var(--ink);border-radius:16px;padding:22px}
.price{font:500 40px Fraunces,Georgia,serif}.mute{color:var(--ink2)}ul,ol{margin:8px 0 0;padding-left:20px;display:grid;gap:6px}
.btn{display:inline-block;background:var(--red);color:#fff;border:2.5px solid var(--ink);border-radius:999px;padding:12px 22px;font-weight:600;text-decoration:none}</style></head>
<body><main><img class="logo" src="${PAGES}/brands/open-frame/open-frame-wordmark-horizontal.svg" alt="Open Frame">${inner}</main></body></html>`;
}

module.exports = { approval, approvals, approvalSet, PAGES, publish, token, esc, page, C, HERE, STATE, readJSON, log, slug, today, clients, fill, ask, voice, hub, rules, judge, logRun, pull, pushState };
