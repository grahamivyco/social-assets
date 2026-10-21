// Graphics idea loop. Runs on Graham's Mac (pm2 "graphics-loop"). Free tools only.
// 1. pitch: after a Reel is transcribed, the local AI (LM Studio) reads what was said and pitches a graphic
//    wherever one would explain it better than what's already in the library. Each idea is logged with the exact
//    line and why nothing in the library fits, then shows in the Hub as a Yes / Pass card.
// 2. stills: for each yes, renders 3 looks as stills (cream, color, ink) -> Hub card to pick one. Nothing animates yet.
// 3. build: animates the pick, checks its own render (text that doesn't fit, empty file), saves it to the library.
// The library (library.json) is reused: pitch skips ideas the library already covers, and the editor can pull from it.
//   node loop.js pitch <thedit work dir>     (reel-watch calls this after transcribe)
//   node loop.js tick                        (stills + build for whatever the Hub says is ready)
//   node loop.js watch                       (tick every few minutes, for pm2)
//   node loop.js redo <id> <look>            (same graphic, new words or numbers: edit params in library.json first)
// Settings: ../config.json (shared with reel-watch). Needs "hub" (Hub web app /exec link) and "hubKey" (the Hub ADMIN_KEY).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const HERE = __dirname, HOME = os.homedir();
const C = {
  repo: `${HOME}/social-assets`,
  pages: 'https://grahamivyco.github.io/social-assets',
  brand: 'open-frame',
  out: `${HOME}/open-frame/graphics`,          // finished animations (.mov with transparency) live here
  llm: 'http://127.0.0.1:1234/v1/chat/completions',
  model: 'google/gemma-4-e4b',
  hub: '', hubKey: '',
  maxIdeas: 3,
  everyMinutes: 5,
  ...readJSON(path.join(HERE, '..', 'config.json'), {}),
};
const LIB = path.join(HERE, 'library.json');
const KINDS = ['stat', 'compare', 'steps', 'quote'];
const LOOKS = ['cream', 'color', 'ink'];

function readJSON(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }
function log(...a) { console.log(new Date().toISOString(), ...a); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'graphic';
const run = (cmd, args, env) => execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
const library = () => readJSON(LIB, []);

async function hub(action, data = {}) {
  if (!C.hub || !C.hubKey) throw new Error('Add "hub" and "hubKey" to reels/config.json');
  const res = await fetch(C.hub, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ key: C.hubKey, fn: 'graphics', action, ...data }) });
  const out = await res.json();
  if (out.error) throw new Error('Hub: ' + out.error);
  return out;
}

async function ask(prompt, schema) {
  const res = await fetch(C.llm, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: C.model, temperature: 0.3, messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema } } }),
    signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`LM Studio said ${res.status}. Is it running with ${C.model} loaded?`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

const IDEA = { type: 'object', additionalProperties: false,
  required: ['line', 'kind', 'idea', 'why_new', 'label', 'from', 'to', 'unit', 'note', 'before_title', 'before_value', 'after_title', 'after_value', 'steps', 'quote'],
  properties: { line: { type: 'string' }, kind: { type: 'string', enum: KINDS }, idea: { type: 'string' }, why_new: { type: 'string' },
    label: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, unit: { type: 'string' }, note: { type: 'string' },
    before_title: { type: 'string' }, before_value: { type: 'string' }, after_title: { type: 'string' }, after_value: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } }, quote: { type: 'string' } } };

function paramsOf(x) {
  const label = String(x.label || '').slice(0, 40);
  if (x.kind === 'stat') return { label, from: x.from, to: x.to, unit: x.unit, note: x.note };
  if (x.kind === 'compare') return { label, before: { title: x.before_title, value: x.before_value }, after: { title: x.after_title, value: x.after_value } };
  if (x.kind === 'steps') return { label, steps: (x.steps || []).slice(0, 4) };
  return { label: '', text: x.quote };
}

// Finds when a line was said, so the editor knows where the graphic goes.
function timeOf(line, words) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = String(line).split(/\s+/).map(norm).filter(Boolean).slice(0, 4);
  for (let i = 0; i < words.length; i++) if (want.every((w, k) => words[i + k] && norm(words[i + k].w) === w)) return words[i].start;
  return null;
}

async function pitch(work, video) {
  const words = readJSON(path.join(work, 'words.json'), []);
  const transcript = fs.readFileSync(path.join(work, 'transcript.md'), 'utf8');
  const lib = library();
  const have = lib.map(g => `- ${g.id}: ${g.kind}, "${g.params.label || g.params.text || ''}"`).join('\n') || '(empty)';
  const prompt = `You help make short talking head videos for ${C.brand === 'open-frame' ? 'Open Frame, a design and marketing agency for mission-driven organizations' : C.brand}.
Read the transcript and find up to ${C.maxIdeas} moments where a simple on-screen graphic would explain what's said better than the face alone:
a number that changes (stat: from, to, unit, note), a before and after (compare), a short process of 2 to 4 steps (steps), or one line worth putting on screen (quote, with exactly one *accent* word).
Only use numbers, names and words that are actually in the transcript. Never invent results. If nothing in the video needs a graphic, return an empty list.
Skip any idea the library below already covers.

Library:
${have}

Transcript:
${transcript}

For each idea: line = the exact words said (copy them), kind, idea = one plain sentence describing the graphic, why_new = why nothing in the library works,
label = 1 to 4 words shown at the top. Fill only the fields for that kind, leave the others as empty strings or an empty list.`;
  const { ideas } = await ask(prompt, { type: 'object', additionalProperties: false, required: ['ideas'], properties: { ideas: { type: 'array', items: IDEA } } });
  const day = new Date().toISOString().slice(0, 10);
  const rows = (ideas || []).slice(0, C.maxIdeas).filter(x => KINDS.includes(x.kind)).map(x => ({
    id: `g-${day}-${slug(x.label || x.quote || x.kind)}`, client: C.brand, video: video || path.basename(work),
    at: timeOf(x.line, words), line: x.line, kind: x.kind, params: JSON.stringify(paramsOf(x)), idea: x.idea, why_new: x.why_new, status: 'pitched',
  }));
  if (rows.length) await hub('add', { rows });
  log('pitched', rows.length, 'ideas from', work);
  return rows;
}

function render(spec, file, mode) {
  const tmp = path.join(os.tmpdir(), `gfx-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(spec));
  const env = { BRANDS: path.join(C.repo, 'brands') };
  if (C.chromium) env.CHROMIUM = C.chromium;
  if (C.pwCore) env.PW_CORE = C.pwCore;
  const out = JSON.parse(run('node', [path.join(HERE, 'render.js'), tmp, file, mode], env).trim().split('\n').pop());
  if (!fs.existsSync(file) || fs.statSync(file).size < 2000) out.warnings.push('render came out empty');
  return out.warnings;
}

function publish(rel, files, msg) {
  run('git', ['-C', C.repo, 'pull', '--rebase', '--autostash', '--quiet']);
  const dir = path.join(C.repo, rel);
  fs.mkdirSync(dir, { recursive: true });
  for (const [src, name] of files) fs.copyFileSync(src, path.join(dir, name));
  run('git', ['-C', C.repo, 'add', rel, path.relative(C.repo, LIB)]);
  run('git', ['-C', C.repo, 'commit', '--quiet', '-m', msg]);
  run('git', ['-C', C.repo, 'push', '--quiet']);
}

async function waitLive(url) {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url, { method: 'HEAD' })).ok) return; } catch {} await new Promise(r => setTimeout(r, 15000)); }
  throw new Error('GitHub Pages never served ' + url);
}

// Graham's change note goes straight into the words and numbers before anything is drawn.
async function applyNote(row, params) {
  if (!row.note) return params;
  const out = await ask(`Here is a graphic's content as JSON: ${JSON.stringify(params)}\nThe owner asked for this change: "${row.note}"\nReturn the same JSON with the change made. Keep the same keys.`,
    { type: 'object', additionalProperties: false, required: ['json'], properties: { json: { type: 'string' } } });
  try { return JSON.parse(out.json); } catch { return params; }
}

async function stills(row) {
  const params = await applyNote(row, JSON.parse(row.params));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-'));
  const accent = ['r', 'b', 'y', 'g'][library().length % 4];
  const files = [], problems = [];
  LOOKS.forEach((look, i) => {
    const f = path.join(tmp, `${'abc'[i]}.png`);
    const w = render({ kind: row.kind, params, look, accent, brand: row.client || C.brand }, f, 'still');
    if (w.length) problems.push(`${look}: ${w.join(', ')}`);
    files.push([f, `${row.id}-${'abc'[i]}.png`]);
  });
  const rel = `reels/graphics/looks/${row.id}`;
  publish(rel, files, `Graphic looks ${row.id}`);
  const urls = files.map(([, n]) => `${C.pages}/${rel}/${n}`);
  await waitLive(urls[2]);
  await hub('set', { id: row.id, fields: { status: 'stills', looks: urls.join('\n'), params: JSON.stringify(params), accent, checks: problems.join('; ') } });
  log('stills ready', row.id, problems.length ? problems : 'clean');
}

async function build(row, look = LOOKS['abc'.indexOf(String(row.pick || 'a').toLowerCase())] || 'cream') {
  const params = JSON.parse(row.params);
  const spec = { kind: row.kind, params, look, accent: row.accent || 'r', brand: row.client || C.brand };
  fs.mkdirSync(C.out, { recursive: true });
  const mov = path.join(C.out, `${row.id}.mov`), png = path.join(os.tmpdir(), `${row.id}.png`);
  // Checks its own render before Graham sees it: text that doesn't fit gets one retry with shorter words.
  let warn = render(spec, png, 'still');
  if (warn.length) {
    spec.params = await applyNote({ note: 'Make every text shorter so it fits: ' + warn.join(', ') }, params);
    warn = render(spec, png, 'still');
  }
  warn = warn.concat(render(spec, mov, 'anim'));
  const lib = library().filter(g => g.id !== row.id);
  lib.push({ id: row.id, client: spec.brand, kind: row.kind, look, accent: spec.accent, params: spec.params, line: row.line, video: row.video,
    file: mov, preview: `${C.pages}/reels/graphics/lib/${row.id}.png`, created: new Date().toISOString() });
  fs.writeFileSync(LIB, JSON.stringify(lib, null, 1));
  publish('reels/graphics/lib', [[png, `${row.id}.png`]], `Graphic built ${row.id}`);
  await hub('set', { id: row.id, fields: { status: warn.length ? 'check' : 'built', built: mov, checks: warn.join('; ') } });
  log('built', row.id, mov, warn.length ? warn : 'clean');
}

async function tick() {
  const { rows } = await hub('list');
  for (const r of rows.filter(r => r.status === 'approved')) await stills(r).catch(e => log('stills failed', r.id, e.message));
  for (const r of rows.filter(r => r.status === 'picked')) await build(r).catch(e => log('build failed', r.id, e.message));
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'pitch') await pitch(path.resolve(a), b);
  else if (cmd === 'tick') await tick();
  else if (cmd === 'watch') { for (;;) { await tick().catch(e => log('tick failed', e.message)); await new Promise(r => setTimeout(r, C.everyMinutes * 60000)); } }
  else if (cmd === 'redo') { const g = library().find(x => x.id === a); if (!g) throw new Error('not in library: ' + a); await build({ ...g, params: JSON.stringify(g.params), pick: 'abc'[LOOKS.indexOf(b || g.look)] }, b || g.look); }
  else console.log('usage: node loop.js pitch <work dir> [video] | tick | watch | redo <id> [look]');
})().catch(e => { log(e.message || e); process.exit(1); });
