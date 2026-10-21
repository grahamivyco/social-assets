// Audio loop (Mondays 12:30, after the pattern report). Instagram's API can't attach audio, so this loop makes picking it
// in the app a 5-second job:
//   1. Collects the sounds used by the outlier videos the viral scout watched in the last 30 days (watch tool "Audio" row),
//      weighted by how far each video beat its creator's normal, plus sounds you said Yes to before.
//   2. Local AI labels each new sound's mood once (cached).
//   3. One "This week's sounds" card: the top 5 to search in the Instagram audio picker.
//   4. scripts.js calls pick() so every Film this card names a sound + a backup that fit the script's mood.
// Reels still export voice-only (REEL-RULES); you add the sound in the app, kept low under your voice.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const FILE = path.join(L.STATE, 'audio.json');
const MOODS = ['upbeat', 'calm', 'dramatic', 'funny', 'warm', 'inspiring'];
const CREATIVE = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en';

function fromWatched() {
  const found = {}, cutoff = Date.now() - 30 * 864e5;
  let dirs = [];
  try { dirs = fs.readdirSync(L.C.watched).filter(n => !n.startsWith('_')).map(n => path.join(L.C.watched, n)); } catch {}
  for (const d of dirs) {
    let rep;
    try { if (fs.statSync(d).mtimeMs < cutoff) continue; rep = fs.readFileSync(path.join(d, 'report.md'), 'utf8'); } catch { continue; }
    const a = (rep.match(/^\| Audio \| (.*?) \|$/m) || [])[1];
    if (!a || /original sound|original audio|son original|audio original/i.test(a)) continue;   // a creator's own voice track isn't reusable
    const [name, artist = ''] = a.split(' · ').map(s => s.trim());
    const ratio = Number((rep.match(/outlier ([\d.]+)x/) || [])[1] || 1);
    const k = (name + '|' + artist).toLowerCase();
    const f = found[k] || (found[k] = { name, artist, uses: 0, weight: 0, best: 0 });
    f.uses++; f.weight += ratio; f.best = Math.max(f.best, ratio);
  }
  return found;
}

const MOOD = { type: 'object', additionalProperties: false, required: ['moods'], properties: { moods: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['n', 'mood'], properties: { n: { type: 'integer' }, mood: { type: 'string', enum: MOODS } } } } } };

async function run() {
  L.pull();
  const st = L.readJSON(FILE, { sounds: {}, liked: [] });
  const ans = (await L.hub('list', { loop: 'audio' })).rows;
  ans.filter(r => r.kind === 'sound' && (r.status === 'yes' || r.status === 'change')).forEach(r => { if (!st.liked.includes(r.title)) st.liked.push(r.title); });
  const found = fromWatched();
  Object.entries(found).forEach(([k, f]) => { st.sounds[k] = { ...(st.sounds[k] || {}), ...f, seen: L.today() }; });
  Object.values(st.sounds).forEach(s => { if (!found[(s.name + '|' + s.artist).toLowerCase()]) s.weight = (s.weight || 0) * 0.5; });   // fades when no longer used
  const need = Object.values(st.sounds).filter(s => !s.mood);
  if (need.length) {
    const { moods } = await L.ask(`Label the mood of each song or sound (from its name and artist) as one of: ${MOODS.join(', ')}.\n${need.map((s, i) => `${i}. ${s.name}${s.artist ? ' by ' + s.artist : ''}`).join('\n')}`, MOOD, 0);
    moods.forEach(m => { if (need[m.n]) need[m.n].mood = m.mood; });
  }
  const top = Object.values(st.sounds).filter(s => s.weight > 0.5).sort((a, b) => b.weight - a.weight).slice(0, 5);
  st.week = L.today(); st.top = top;
  fs.writeFileSync(FILE, JSON.stringify(st, null, 2) + '\n');
  const body = top.length
    ? top.map((s, i) => `${i + 1}. ${s.name}${s.artist ? ' · ' + s.artist : ''} (${s.mood || '?'}, in ${s.uses} outlier${s.uses === 1 ? '' : 's'}, best ${s.best}x)`).join('\n')
    : 'No named sounds in this week\'s outliers yet. Use the Instagram audio picker and look for the arrow (trending) mark.';
  await L.hub('add', { rows: [{ id: `audio-week-${L.today()}`, loop: 'audio', client: 'open-frame', kind: 'sounds', status: 'todo', title: 'This week\'s sounds',
    body: `${body}\n\nIn Instagram: Reel > audio > search the name. Keep it at 5 to 10% under your voice.\nMore trending sounds (free): ${CREATIVE}`, link: CREATIVE, ask: '' }] });
  await L.logRun({ loop: 'audio', client: 'open-frame', status: 'ok', made: Object.keys(found).length, kept: top.length, cards: 1, note: top.map(s => s.name).join(', ') });
  L.pushState('Loops: weekly sounds');
}

const PICK = { type: 'object', additionalProperties: false, required: ['mood', 'main', 'backup'],
  properties: { mood: { type: 'string', enum: MOODS }, main: { type: 'integer' }, backup: { type: 'integer' } } };
// For a script: the best-fitting sound and a backup from this week's list. Never invents a sound name.
async function pick(script) {
  const st = L.readJSON(FILE, {}), list = (st.top || []).concat((st.liked || []).map(t => ({ name: t, mood: '' })));
  if (!list.length) return 'Audio: pick a trending sound (arrow mark) in the Instagram audio picker, low under your voice.';
  try {
    const p = await L.ask(`Pick background sounds for this talking head Reel. Script:\n${script}\n\nSounds:\n${list.map((s, i) => `${i}. ${s.name}${s.artist ? ' · ' + s.artist : ''} (${s.mood || 'unknown'})`).join('\n')}\nmain and backup are numbers from the list. mood = the script's mood.`, PICK, 0);
    const a = list[p.main] || list[0], b = list[p.backup] && p.backup !== p.main ? list[p.backup] : list.find(s => s !== a);
    const n = s => `${s.name}${s.artist ? ' · ' + s.artist : ''}`;
    return `Audio (${p.mood}): ${n(a)}${b ? `. Backup: ${n(b)}` : ''}. Search it in the Instagram audio picker, keep it low under your voice.`;
  } catch { return 'Audio: pick from this week\'s sounds card, low under your voice.'; }
}

module.exports = { run, pick };
