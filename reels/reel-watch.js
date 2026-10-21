// AirDrop to Reel draft. Runs on Graham's Mac under pm2 ("reel-watch").
// A new phone video in ~/Downloads -> thedit.py transcribe -> local AI (LM Studio) writes the hook,
// cover headline and caption -> thedit.py render -> voice-only delivery copies in ~/Downloads/Open Frame/Reels/
// -> pushed to GitHub Pages -> n8n "Reel drafts" webhook adds the IG + FB rows to the Queue as Hub cards.
// Free tools only. Settings: config.json next to this file (see config.example.json).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const HERE = __dirname;
const HOME = os.homedir();
const C = {
  downloads: `${HOME}/Downloads`,
  // Graham's Downloads sorter moves videos into Downloads/Video within a minute, so watch both.
  also: [`${HOME}/Downloads/Video`],
  work: `${HOME}/open-frame/reels/work`,
  deliver: `${HOME}/Downloads/Open Frame LLC & Clients/Reels`,   // outside "Open Frame", which the Downloads sorter sweeps
  repo: `${HOME}/social-assets`,          // git clone of grahamivyco/social-assets with push access
  pages: 'https://grahamivyco.github.io/social-assets',
  brands: `${HERE}/../brands`,             // brand.json per client (repo mirror)
  brand: 'open-frame',
  python: 'python3',
  chromium: '',                            // headless Chromium or Chrome binary for the graphics
  pwCore: '',                              // path to node_modules/playwright-core
  llm: 'http://127.0.0.1:1234/v1/chat/completions',
  model: 'google/gemma-4-e4b',
  hook: 'http://localhost:5678/webhook/reel-draft',
  link: 'https://openframe.design/links',
  minSeconds: 8, maxSeconds: 180, minWords: 12,
  pollSeconds: 15,
  ...readJSON(path.join(HERE, 'config.json'), {}),
};
const STATE = path.join(HERE, 'state.json');
const EDITOR = path.join(HERE, 'editor');
const VIDEO = /\.(mov|mp4|m4v)$/i;

function readJSON(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }
function log(...a) { console.log(new Date().toISOString(), ...a); }
const slug = s => String(s).toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reel';

const state = readJSON(STATE, null) || { seen: {}, started: false };
function save() { fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); }

const DIRS = [C.downloads, ...(C.also || [])];
function listVideos(dirs = DIRS) {
  return dirs.filter(d => fs.existsSync(d)).flatMap(d => fs.readdirSync(d).filter(f => VIDEO.test(f) && !f.startsWith('.'))
    .map(f => path.join(d, f))).filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}
// A clip is the same clip after the sorter moves it, so it's remembered by name and size, not path.
const key = (file, size) => `${path.basename(file)}:${size}`;

// First run in each folder: what's already there counts as seen, so only new AirDrops become Reels.
// Clips from the last 6 hours still count as new (the sorter may have moved one before the watcher saw it).
state.dirs = state.dirs || {};
if (!state.started) { state.dirs[C.downloads] = true; }
for (const d of DIRS) {
  if (state.dirs[d] || !fs.existsSync(d)) continue;
  for (const p of listVideos([d])) {
    const st = fs.statSync(p);
    if (!state.started || Date.now() - Math.max(st.mtimeMs, st.ctimeMs) > 6 * 3600e3) state.seen[key(p, st.size)] = 'old';
  }
  state.dirs[d] = true;
}
if (!state.started) for (const p of listVideos([C.downloads])) state.seen[key(p, fs.statSync(p).size)] = 'old';
state.started = true; save();

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', file]).toString());
  return { dur: Number(j.format.duration), audio: j.streams.some(s => s.codec_type === 'audio') };
}

function run(cmd, args, opts = {}) {
  log('$', cmd, args.join(' '));
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', ...opts });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    const why = String(r.stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240);
    throw new Error(`${path.basename(cmd)} ${cmd === 'git' ? args[2] : path.basename(args[0])} failed: ${why || `exit ${r.status}`}`);
  }
}

const editorEnv = () => ({
  ...process.env,
  THEDIT_BRANDS: path.resolve(C.brands),
  THEDIT_MARK: path.join(EDITOR, 'assets', 'of-mark.jpg'),
  COVER_FONTS: path.join(EDITOR, 'fonts', 'cover'),
  COVER_LOGOS: path.join(EDITOR, 'assets'),
  ...(C.chromium ? { CHROMIUM: C.chromium } : {}),
  ...(C.pwCore ? { PW_CORE: C.pwCore } : {}),
});

// LM Studio isn't running after a restart: start its server and load the model with its own CLI (lms), then retry once.
const LMS = C.lms || `${HOME}/.lmstudio/bin/lms`;
async function llmFetch(init) {
  const go = () => fetch(C.llm, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...init, signal: AbortSignal.timeout(180000) });
  try { return await go(); }
  catch (e) {
    if (!fs.existsSync(LMS)) throw new Error(`LM Studio isn't running (${e.message}). Open LM Studio and load ${C.model}.`);
    log('LM Studio not answering, starting it:', e.message);
    spawnSync(LMS, ['server', 'start'], { stdio: 'inherit', timeout: 60000 });
    spawnSync(LMS, ['load', C.model, '--yes'], { stdio: 'inherit', timeout: 180000 });
    try { return await go(); }
    catch (e2) { throw new Error(`LM Studio isn't running and wouldn't start (${e2.message}). Open LM Studio and load ${C.model}.`); }
  }
}

// The model sometimes invents track-record claims ("We helped many nonprofits..."). Drop any caption
// sentence with a number or a claim word that isn't in the transcript. Graham, 2026-10-21: only what he said.
const CLAIM = /\b(helped|help(?:ing)? (?:many|hundreds|dozens)|clients?|customers?|worked with|years|decades|track record|proven|award|countless|many)\b/gi;
function grounded(caption, transcript) {
  const said = transcript.toLowerCase();
  const [body, ...rest] = caption.split(/\n\s*\n/);
  const keep = (body.match(/[^.!?]+[.!?]*/g) || []).filter(sen => {
    const nums = sen.match(/\d+/g) || [];
    const claims = sen.match(CLAIM) || [];
    return nums.every(n => said.includes(n)) && claims.every(w => said.includes(w.toLowerCase()));
  }).map(x => x.trim()).join(' ');
  return [keep || body, ...rest].join('\n\n');
}

// Local AI writes the words. Graham still approves every Reel on a Hub card before it posts.
async function writeCopy(transcript) {
  const prompt = `You help Open Frame, a design and marketing agency for mission-driven organizations (Minneapolis and Barcelona), turn a talking head video into an Instagram Reel.
Here is the transcript (numbered lines, ~~struck~~ words are fillers that get cut):
${transcript}

Write:
- hook: the on-screen title for the first 2.5 seconds. 3 to 7 words, sentence case, taken from the video's main point. Wrap exactly one word in *asterisks* as the accent.
- headline: the cover headline, 2 to 5 words, may use \\n for a line break, exactly one *accent* word.
- caption: the Instagram and Facebook caption. 2 to 4 short sentences in plain, friendly first person, retelling only what is said in the video. Every claim must be something he actually says in the transcript. Never invent clients, numbers, results, past work or experience (no "we've helped many nonprofits"). No hashtags, no emoji, no em dashes, no hype words, no rhetorical question to open. End with this call to action on its own paragraph: "Book a free 30-min consult:" followed by a new line with exactly ${C.link}
- keywords: 15 search phrases (1 to 3 words each, lowercase, no repeats) that someone would type into Instagram search to find this video, e.g. "nonprofit marketing". The first one is the main keyword.
- The hook and the first sentence of the caption both use the main keyword in a natural way. Work 1 or 2 of the other keywords into the caption naturally. No keyword lists in the caption.
- alt_text: one plain sentence describing what is on screen and what it is about, for screen readers, using the main keyword (e.g. "Graham from Open Frame talking to the camera about nonprofit marketing.").
- topic: 2 to 4 words naming the video, for a file name.
- scenes: 2 to 4 small animated graphics, one per idea in the video, each fired on a word that is actually spoken (copy it exactly from the transcript, one word, no ~~struck~~ words). kind is one of: marketing (a screen going off), design (an artboard), brand (a swatch fan), website (a browser window), social (a phone with likes), send (a paper airplane landing on "Done", for a call to talk). Use each kind once. label: 1 or 2 words shown with it.`;
  // config "copyRules": private house rules for the words (e.g. topics never to mention). Kept in config.json, not in git.
  const rules = `\n\nHouse rules for everything you write: don't lead with AI, say "systems". Only use facts that are in the transcript. Never make up claims, client counts or results.${C.copyRules ? '\n' + C.copyRules : ''}`;
  const res = await llmFetch({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: C.model, temperature: 0.4, messages: [{ role: 'user', content: prompt + rules }],
      response_format: { type: 'json_schema', json_schema: { name: 'reel', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['hook', 'headline', 'caption', 'keywords', 'alt_text', 'topic', 'scenes'],
        properties: { hook: { type: 'string' }, headline: { type: 'string' }, caption: { type: 'string' }, topic: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } }, alt_text: { type: 'string' },
          scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['word', 'kind', 'label'], properties: {
            word: { type: 'string' }, kind: { type: 'string', enum: ['marketing', 'design', 'brand', 'website', 'social', 'send'] },
            label: { type: 'string' } } } } } } } },
    }),
  });
  if (!res.ok) throw new Error(`LM Studio said ${res.status}. Is it running with ${C.model} loaded?`);
  const out = JSON.parse((await res.json()).choices[0].message.content);
  // House rules the model can miss: one accent word, link on its own line after a blank line, no em dashes.
  const oneAccent = s => { let n = 0; return String(s).replace(/\*([^*]+)\*/g, (m, w) => (n++ ? w : m)); };
  // Also: straight apostrophes everywhere, and a headline the model left without an accent gets one.
  const tidy = s => String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const accent = s => {
    if (/\*[^*]+\*/.test(s)) return s;
    const long = (s.match(/[A-Za-z']+/g) || []).reduce((a, b) => (b.length > a.length ? b : a), '');
    let done = false;
    return s.replace(/[A-Za-z']+/g, w => (!done && w === long ? (done = true, `*${w}*`) : w));
  };
  out.hook = oneAccent(tidy(out.hook).replace(/—/g, ',').trim());
  let head = oneAccent(tidy(out.headline).replace(/\\n/g, '\n').replace(/—/g, ',').trim());
  if (!head || head.replace(/\*/g, '').split(/\s+/).length > 5) head = out.hook.replace(/\*/g, '').split(/\s+/).length <= 5 ? out.hook : head;
  out.headline = accent(head || out.hook);
  out.caption = grounded(tidy(out.caption), transcript);
  out.keywords = [...new Set((out.keywords || []).map(k => tidy(k).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9' -]/g, '').trim()).filter(Boolean))].slice(0, 15);
  out.alt_text = tidy(out.alt_text || '').replace(/—/g, ',').trim();
  let cap = out.caption.replace(/\s*—\s*/g, ', ').replace(/https?:\/\/\S+/g, '').replace(/\n{3,}/g, '\n\n').trim();
  // Graham, 2026-10-21: 15 keywords posted with every Reel, as one plain line above the call to action.
  if (out.keywords.length) {
    const kw = out.keywords.join(' · ');
    cap = /book a free/i.test(cap) ? cap.replace(/\n*(book a free[^\n]*)$/i, `\n\n${kw}\n\n$1`) : `${cap}\n\n${kw}`;
  }
  if (!/consult/i.test(cap)) cap += '\n\nBook a free 30-min consult:';
  out.caption = cap.replace(/:?\s*$/, ':') + `\n\n${C.link}`;
  return out;
}

function encodeCopy(src, dst, hdr) {
  // Copies for the Mac and for posting: about 7 Mbps so they stay under 25 MB. Color is untouched.
  const v = hdr
    ? ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10', '-tag:v', 'hvc1', '-b:v', '7M', '-maxrate', '7M', '-bufsize', '14M',
       '-x265-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error',
       '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc']
    : ['-c:v', 'libx264', '-profile:v', 'high', '-b:v', '7M', '-maxrate', '7M', '-bufsize', '14M',
       '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, ...v, '-c:a', 'copy', '-movflags', '+faststart', dst]);
}

async function waitLive(url) {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url, { method: 'HEAD' })).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error(`GitHub Pages never served ${url}`);
}

async function tell(body) {
  const res = await fetch(C.hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`n8n webhook said ${res.status}. Is the "Reel drafts" workflow published?`);
}

async function makeReel(file) {
  const { dur, audio } = probe(file);
  if (!audio || dur < C.minSeconds || dur > C.maxSeconds) { log('skip (not a talking head length):', file, dur); return 'skipped'; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const work = path.join(C.work, `${stamp}-${slug(path.basename(file, path.extname(file)))}`);
  fs.mkdirSync(work, { recursive: true });
  const thedit = path.join(EDITOR, 'thedit.py');
  run(C.python, [thedit, 'transcribe', file, work], { env: editorEnv() });
  const words = readJSON(path.join(work, 'words.json'), []);
  if (words.length < C.minWords) { log('skip (not enough speech):', file, words.length, 'words'); return 'skipped'; }
  // Graphics idea loop (graphics/README.md): pitch new graphics to the Hub. Never blocks the Reel.
  try { run('node', [path.join(HERE, 'graphics', 'loop.js'), 'pitch', work, path.basename(file)]); }
  catch (e) { log('graphics pitch skipped:', e.message); }

  const copy = await writeCopy(fs.readFileSync(path.join(work, 'transcript.md'), 'utf8'));
  const day = new Date().toISOString().slice(0, 10);
  const id = `${C.brand === 'open-frame' ? 'of' : C.brand}-${day}-${slug(copy.topic)}`;
  const edit = readJSON(path.join(work, 'edit.json'), {});
  // Pass 4 (motion): one scene per idea, fired on its spoken word. Words the model made up are dropped.
  const spoken = new Set(words.map(w => String(w.w).toLowerCase().replace(/[^a-z]/g, '')));
  const keywords = {};
  for (const sc of copy.scenes || []) {
    const w = String(sc.word).toLowerCase().replace(/[^a-z]/g, '');
    if (w && spoken.has(w)) keywords[w] = [sc.kind, String(sc.label).slice(0, 18)];
  }
  // config "preset" (e.g. "one-take") picks an editor preset; the preset turns graphics, cut-out and sound off itself.
  const look = C.preset ? { preset: C.preset } : { pop: true, cutout: true, sfx: true, keywords };
  // Keywords (Graham, 2026-10-21): a small but readable line in the first seconds, so Instagram's text reading picks them up.
  Object.assign(edit, { brand: C.brand, name: id, hook: copy.hook, ...look, topic_line: copy.keywords.slice(0, 3).join(' · '),
    cover: { ...(edit.cover || {}), headline: copy.headline } });
  fs.writeFileSync(path.join(work, 'edit.json'), JSON.stringify(edit, null, 2));
  run(C.python, [thedit, 'render', work], { env: editorEnv() });

  const out = path.join(work, 'out');
  const pick = re => fs.readdirSync(out).find(f => re.test(f));
  const reel = pick(/-reel-1080x1920\.mp4$/), square = pick(/-square-2160x2160\.mp4$/), cover = pick(/-cover-reel\.jpg$/);
  if (!reel || !square) throw new Error('render made no videos');
  const hdr = Boolean(edit.hdr);

  const dest = path.join(C.deliver, id);
  fs.mkdirSync(dest, { recursive: true });
  encodeCopy(path.join(out, reel), path.join(dest, `${id}-ig-reel.mp4`), hdr);
  encodeCopy(path.join(out, square), path.join(dest, `${id}-fb-square.mp4`), hdr);
  for (const f of fs.readdirSync(out).filter(f => /-cover-(reel|square)\.jpg$/.test(f))) fs.copyFileSync(path.join(out, f), path.join(dest, f));
  fs.writeFileSync(path.join(dest, 'caption.md'), `# ${copy.hook.replace(/\*/g, '')}\n\n${copy.caption}\n\n## Keywords\n${copy.keywords.join(', ')}\n\n## Alt text\n${copy.alt_text}\n`);

  // Host the voice-only copies on GitHub Pages so the poster can send them to Meta.
  const rel = `reels/media/${id}`;
  const pub = path.join(C.repo, rel);
  run('git', ['-C', C.repo, 'pull', '--rebase', '--autostash', '--quiet']);
  fs.mkdirSync(pub, { recursive: true });
  for (const f of [`${id}-ig-reel.mp4`, `${id}-fb-square.mp4`]) fs.copyFileSync(path.join(dest, f), path.join(pub, f));
  if (cover) fs.copyFileSync(path.join(out, cover), path.join(pub, `${id}-cover.jpg`));
  run('git', ['-C', C.repo, 'add', rel]);
  run('git', ['-C', C.repo, 'commit', '--quiet', '-m', `Reel draft ${id}`]);
  run('git', ['-C', C.repo, 'push', '--quiet']);
  const base = `${C.pages}/${rel}/${id}`;
  await waitLive(`${base}-ig-reel.mp4`);

  await tell({ kind: 'draft', id, brand: C.brand, hook: copy.hook.replace(/\*/g, ''), caption: copy.caption, trial: C.trial !== false, alt_text: copy.alt_text, keywords: copy.keywords.join(', '),
    ig_url: `${base}-ig-reel.mp4`, fb_url: `${base}-fb-square.mp4`, preview_url: cover ? `${base}-cover.jpg` : '',
    source: path.basename(file), folder: dest });
  spawnSync('osascript', ['-e', `display notification "Reel draft ready for a yes in the Hub" with title "${id}"`]);
  log('done', id);
  return id;
}

let busy = false;
const sizes = {};
async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const file of listVideos()) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }  // moved away mid-scan
      const k = key(file, st.size);
      const prev = state.seen[k];
      // A failed clip gets 2 more tries, 10 minutes apart (e.g. LM Studio was closed).
      const failed = typeof prev === 'string' && prev.startsWith('failed');
      const [, tries = '1', at = '0'] = failed ? prev.split(':') : [];
      if (prev && !(failed && Number(tries) < 3 && Date.now() - Number(at) > 10 * 60e3)) continue;
      if (!prev && state.seen[file] && state.seen[file] !== 'failed') continue;
      // AirDrop writes the file over a few seconds: wait until its size holds still for one poll.
      if (sizes[file] !== st.size || Date.now() - st.mtimeMs < 20000) { sizes[file] = st.size; continue; }
      state.seen[k] = 'working'; save();
      // Work from a private copy, so the sorter moving the original mid-edit can't break it.
      const copy = path.join(C.work, 'incoming', path.basename(file));
      try {
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.copyFileSync(file, copy);
        state.seen[k] = await makeReel(copy);
        fs.rmSync(copy, { force: true });
      }
      catch (e) {
        state.seen[k] = `failed:${failed ? Number(tries) + 1 : 1}:${Date.now()}`;
        log('FAILED', file, e.message);
        await tell({ kind: 'error', source: path.basename(file), detail: e.message }).catch(err => log('could not tell n8n:', err.message));
      }
      save();
    }
  } finally { busy = false; }
}

log('watching', DIRS.join(', '));
setInterval(() => tick().catch(e => log('tick error', e.message)), C.pollSeconds * 1000);
tick();
