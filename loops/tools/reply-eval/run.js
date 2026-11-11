// Reply test kit: runs the local model (LM Studio) on a fixed set of comments and DMs with the live prompt and with
// candidate prompts/settings, then rule-checks every reply. Free: only LM Studio is called. Claude grades the results
// separately, once, as a judge (see README). Nothing here is wired into n8n.
//   node loops/tools/reply-eval/run.js                 all variants, 2 runs each
//   node loops/tools/reply-eval/run.js --only c1,d1 --reps 1 --model qwen/qwen3.5-9b --out ~/open-frame/reply-eval
const fs = require('fs'), path = require('path'), os = require('os');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const cfg = (() => { for (const f of ['loops/config.json', 'reels/config.json']) try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch {} return {}; })();
const MODEL = arg('model', cfg.model || 'qwen/qwen3.5-9b');
const URL_ = arg('url', 'http://127.0.0.1:1234/v1/chat/completions');
const REPS = Number(arg('reps', 2));
const ONLY = arg('only', '').split(',').filter(Boolean);
const OUT = path.join(arg('out', path.join(os.homedir(), 'open-frame', 'reply-eval')).replace(/^~/, os.homedir()), new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
const read = f => fs.readFileSync(path.join(HERE, 'prompts', f), 'utf8').trim();

// ---- the live comment flow's own rules, read from n8n/comment-replies.json so the baseline is exactly what runs ----
const code = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'comment-replies.json'), 'utf8')).nodes.find(n => n.name === 'New comments').parameters.jsCode;
const grabRe = name => eval(code.match(new RegExp(`const ${name} = (\\/.*\\/[a-z]*);`))[1]);
const [ABUSE, SPAM, INJECT, LEAD, UPSET, BAD] = ['ABUSE', 'SPAM', 'INJECT', 'LEAD', 'UPSET', 'bad'].map(grabRe);
const LIVE_RULES = code.match(/const RULES = `([\s\S]*?)`;/)[1].replace(/\\n/g, '\n')
  .replace(/Don't reuse[\s\S]*?(?=Return JSON)/, '');   // the live list of recent replies is empty in a test
const words = t => t.replace(/[@#][\w.]+/g, '').trim().split(/\s+/).filter(Boolean);
const emojiOnly = t => t.replace(/[\s@#\w.]+/g, '').length > 0 && !/[A-Za-z0-9]/.test(t.replace(/[@#][\w.]+/g, ''));
const tagsOnly = t => /^(\s*@[\w.]+\s*)+$/.test(t);
function route(t) {   // same order as the n8n node
  if (ABUSE.test(t) || SPAM.test(t)) return 'hidden';
  if (!t || tagsOnly(t)) return 'skipped';
  const isQ = t.includes('?') || LEAD.test(t);
  const intent = UPSET.test(t) ? 'upset' : LEAD.test(t) ? 'lead' : isQ ? 'question' : (!isQ && (emojiOnly(t) || words(t).length <= 10)) ? 'praise' : 'other';
  if (intent === 'praise') return 'pool';
  if (INJECT.test(t)) return 'filtered';
  return 'ai:' + intent;
}

// ---- the live DM prompt: the Mac's own voice file if it's there, else the repo copy ----
function liveDM() {
  const home = path.join(os.homedir(), 'open-frame');
  try { const v = fs.readFileSync(path.join(home, 'dm-voice.md'), 'utf8').trim(); if (v) return { src: '~/open-frame/dm-voice.md', text: v }; } catch {}
  for (const f of [path.join(home, 'add-sender-info.js')]) try { const m = fs.readFileSync(f, 'utf8').match(/const BRIEF = `([\s\S]*?)`;/); if (m) return { src: f, text: m[1] }; } catch {}
  const js = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'dm-inbox.json'), 'utf8')).nodes.find(n => n.name === 'Add sender info').parameters.jsCode;
  return { src: 'n8n/dm-inbox.json', text: js.match(/const BRIEF = `([\s\S]*?)`;/)[1] };
}

const NO_THINK = { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } };
const S_LIVE_C = { temperature: 0.8 };
const S_LIVE_D = { temperature: 0.4 };
const S_QWEN = { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };
const C_SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, send: { type: 'boolean' } }, required: ['reply', 'send'] };
const C_SCHEMA_NEED = { type: 'object', properties: { need: { type: 'string' }, reply: { type: 'string' }, send: { type: 'boolean' } }, required: ['need', 'reply', 'send'] };
const D_SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, send: { type: 'boolean' }, book: { type: 'boolean' } }, required: ['reply', 'send', 'book'] };
const NEED = '\n\nBefore the reply, fill "need" with what the commenter wants, in 3 to 6 words (for example "a tip on mobile menus" or "price for a homepage"). Then write the reply for that need.';
const dm = liveDM();
const VARIANTS = {
  c0: { kind: 'comment', label: 'live comment prompt, live settings', system: LIVE_RULES, s: S_LIVE_C, schema: C_SCHEMA },
  c1: { kind: 'comment', label: 'new prompt + examples, live settings', system: read('comment-v1.md'), s: S_LIVE_C, schema: C_SCHEMA },
  c2: { kind: 'comment', label: 'new prompt + examples, Qwen settings', system: read('comment-v1.md'), s: S_QWEN, schema: C_SCHEMA },
  c3: { kind: 'comment', label: 'new prompt + examples + "need" step, Qwen settings', system: read('comment-v1.md') + NEED, s: S_QWEN, schema: C_SCHEMA_NEED },
  d0: { kind: 'dm', label: `live DM prompt (${dm.src}), temp 0.4`, system: dm.text, s: S_LIVE_D, schema: D_SCHEMA },
  d1: { kind: 'dm', label: 'new DM prompt + examples, temp 0.4', system: read('dm-v1.md'), s: S_LIVE_D, schema: D_SCHEMA },
  d2: { kind: 'dm', label: 'new DM prompt + examples, Qwen settings', system: read('dm-v1.md'), s: S_QWEN, schema: D_SCHEMA },
};
for (const f of fs.existsSync(path.join(HERE, 'prompts')) ? fs.readdirSync(path.join(HERE, 'prompts')) : []) {   // extra drafts: prompts/comment-v2.md -> c-v2
  const m = f.match(/^(comment|dm)-(v\d+)\.md$/); if (!m || m[2] === 'v1') continue;
  const kind = m[1], id = (kind === 'comment' ? 'c-' : 'd-') + m[2];
  VARIANTS[id] = { kind, label: `${f}, Qwen settings`, system: read(f), s: S_QWEN, schema: kind === 'comment' ? C_SCHEMA : D_SCHEMA };
}

// ---- rule checks (the same bans as the live flows, plus Graham's copy rules) ----
const BANNED = /\b(leverage|seamless|robust|elevate|unlock|empower|transform|game.changer|landscape|journey|delve|dive in|testament|next level|synergy)/i;
const STIFF = /(kind words|our approach|appreciate your (feedback|comment|kind)|thank you for your (comment|feedback|message)|great question|we'?re (so )?(glad|happy) to help|feel free to|don't hesitate)/i;
function check(kind, reply) {
  const t = String(reply || ''), f = [];
  if (!t.trim()) f.push('empty');
  if (/\b(i|me|my|mine|we|us|our|ours|i'm|i've|i'll|we're|we've|we'll)\b/i.test(t)) f.push('first person');
  if (/\p{Extended_Pictographic}/u.test(t)) f.push('emoji');
  if (/!/.test(t)) f.push('exclamation');
  if (/[—–]/.test(t)) f.push('em dash');
  if (/@\w/.test(t)) f.push('@mention');
  if (/#\w/.test(t)) f.push('hashtag');
  if (BANNED.test(t)) f.push('hype word');
  if (STIFF.test(t)) f.push('stiff phrase');
  if (/\$|€|£|\d+\s*(%|dollars|euros|per hour|\/hr)/i.test(t)) f.push('price');
  if (/\b(language model|as an ai|i am an ai|chatbot|we do not use ai|we don'?t use ai|no ai)\b/i.test(t)) f.push('AI claim');
  if (kind === 'comment') {
    if (/https?:|www\./.test(t)) f.push('link');
    if (words(t).length > 18) f.push(`${words(t).length} words`);
  } else if (words(t).length > 55) f.push(`${words(t).length} words`);
  return f;
}

async function call(v, user) {
  const t0 = Date.now();
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ model: MODEL, max_tokens: 400, ...v.s, ...NO_THINK,
      response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema: v.schema } },
      messages: [{ role: 'system', content: v.system }, { role: 'user', content: user }] }) });
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = (await res.json()).choices[0].message;
  const raw = String(msg.content || '').replace(/^[\s\S]*?<\/think>\s*/, '').replace(/^```(json)?|```$/g, '').trim();
  return { out: JSON.parse(raw), ms: Date.now() - t0 };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  const ids = Object.keys(VARIANTS).filter(id => !ONLY.length || ONLY.includes(id));
  console.log(`model ${MODEL}, variants ${ids.join(' ')}, ${REPS} run(s) each, out ${OUT}`);
  for (const id of ids) {
    const v = VARIANTS[id];
    const list = v.kind === 'comment' ? cases.comments : cases.dms;
    for (const c of list) {
      const r = v.kind === 'comment' ? route(c.text) : 'ai';
      if (!r.startsWith('ai')) { if (id === ids.find(x => VARIANTS[x].kind === 'comment')) rows.push({ variant: 'route', id: c.id, text: c.text, route: r, want_route: c.route || 'ai' }); continue; }
      const user = v.kind === 'comment'
        ? `Our post said:\n"""${cases.posts[c.post]}"""\n\nComment from someone:\n"""${c.text}"""`
        : c.text;
      for (let rep = 0; rep < REPS; rep++) {
        try {
          const { out, ms } = await call(v, user);
          let reply = String(out.reply || '');
          let final = reply, dropped = false;
          if (v.kind === 'comment') {   // what the n8n node does to it
            final = reply.replace(/https?:\/\/\S+/g, '').replace(/\s*[—–]\s*/g, ', ').replace(/!/g, '.').replace(/\s+/g, ' ').trim();
            dropped = !final || BAD.test(final) || final.length > 160;
          }
          const flags = check(v.kind, reply);
          const sendOk = c.want === 'either' || out.send === c.want;
          rows.push({ variant: id, id: c.id, route: r, text: c.text, rep, reply, need: out.need, final: dropped ? '' : final, dropped, send: out.send, book: out.book,
            want: c.want, sendOk, flags, ms, ref: c.ref });
          process.stdout.write(`${id} ${c.id} ${flags.length ? 'x' : '.'}${sendOk ? '' : 's'} `);
        } catch (e) { rows.push({ variant: id, id: c.id, rep, error: String(e.message || e) }); process.stdout.write(`${id} ${c.id} ERR `); }
      }
    }
    console.log('');
  }
  // summary
  const lines = [`# Reply test, ${new Date().toISOString().slice(0, 16)} UTC, model ${MODEL}, ${REPS} run(s) per case`, '',
    '| variant | what | clean (no rule flags) | right send call | dropped by n8n filter | avg words | avg time |', '|---|---|---|---|---|---|---|'];
  for (const id of ids) {
    const rs = rows.filter(r => r.variant === id && !r.error), n = rs.length || 1;
    const pct = k => Math.round(100 * rs.filter(k).length / n) + '%';
    lines.push(`| ${id} | ${VARIANTS[id].label} | ${pct(r => !r.flags.length)} | ${pct(r => r.sendOk)} | ${VARIANTS[id].kind === 'comment' ? pct(r => r.dropped) : 'n/a'} | ${(rs.reduce((s, r) => s + words(r.reply).length, 0) / n).toFixed(1)} | ${(rs.reduce((s, r) => s + r.ms, 0) / n / 1000).toFixed(1)}s |`);
  }
  const errs = rows.filter(r => r.error);
  if (errs.length) lines.push('', `Errors: ${errs.length} (first: ${errs[0].error})`);
  const routes = rows.filter(r => r.variant === 'route');
  if (routes.length) lines.push('', 'Routing before the AI (n8n code):', ...routes.map(r => `- ${r.id} "${r.text}" -> ${r.route}${r.route !== r.want_route ? ` (expected ${r.want_route})` : ''}`));
  lines.push('', '## Every reply', '');
  for (const id of ids) {
    lines.push(`### ${id}: ${VARIANTS[id].label}`, '');
    for (const r of rows.filter(r => r.variant === id)) lines.push(r.error ? `- ${r.id}: ERROR ${r.error}` :
      `- ${r.id} [${r.send ? 'send' : 'hold'}${r.sendOk ? '' : ' WRONG'}${r.dropped ? ', dropped' : ''}${r.flags.length ? ', ' + r.flags.join(', ') : ''}] "${r.text}" -> ${r.need ? `(${r.need}) ` : ''}${r.reply}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ model: MODEL, reps: REPS, variants: Object.fromEntries(ids.map(i => [i, { ...VARIANTS[i], system: VARIANTS[i].system }])), rows }, null, 1));
  fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
  console.log('\n' + lines.slice(0, 4 + ids.length).join('\n') + `\n\nWrote ${OUT}/summary.md and results.json`);
})();
