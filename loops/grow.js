// Growth loops that don't need a following yet. Each one: trigger -> work -> self-check -> card -> state.
//   directories (3rd of the month): 2 free listings per client it hasn't done, with a ready-to-paste description.
//   events (Mondays): local events from feeds (RSS, iCal, or any page with event schema) -> local AI scores fit
//                     -> best 3 as calendar cards (Yes adds it to your Google Calendar). Dead feeds switch off.
//   gbp (Thursdays): a Google Business Profile post drafted from the client's best recent post or approved idea.
//   templates (Fridays): the client's best post of the month -> "Save as a template?" card -> winners list the ideas loop reads.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const TEXT = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
async function write(prompt, opts = {}) {
  let why = '';
  for (let i = 0; i < 2; i++) {
    const { text } = await L.ask(prompt + (why ? `\nLast try failed the check: ${why}` : ''), TEXT, 0.5);
    const broke = L.rules(text, opts);
    if (opts.minChars && text.length < opts.minChars) broke.push('too short');
    if (opts.maxChars && text.length > opts.maxChars) broke.push(`${text.length} characters, max ${opts.maxChars}`);
    if (!broke.length) return text;
    why = broke.join(', ');
  }
  return null;
}
// Answers on this loop's cards since last time: { id: status }.
async function answers(loop) {
  const out = {};
  (await L.hub('list', { loop })).rows.forEach(r => { out[r.id] = r.status; });
  return out;
}

async function directories() {
  const dirs = L.readJSON(path.join(L.HERE, 'data', 'directories.json'), { list: [] }).list, ans = await answers('directories');
  for (const c of L.clients().filter(c => c.listings)) {
    const file = path.join(L.STATE, c.id, 'listings.json'), st = L.readJSON(file, {});
    Object.keys(st).forEach(id => { const a = ans[`dir-${c.id}-${id}`]; if (a && a !== 'card') st[id] = a; });
    const next = dirs.filter(d => d.for.includes(c.listings) && !st[d.id]).slice(0, 2);
    let cards = 0;
    for (const d of next) {
      const text = await write(`Write the short description for ${c.name}'s free listing on ${d.name}.
Facts: ${c.promise}. Who they help: ${c.audience}.${c.city ? ` Based in ${c.city}.` : ''} Website: ${c.site || ''}.
2 to 3 plain sentences, 200 to 450 characters, third person, no hype words, no em dashes. Same facts as everywhere else.`, { minChars: 120, maxChars: 600 });
      if (!text) continue;
      await L.hub('add', { rows: [{ id: `dir-${c.id}-${d.id}`, loop: 'directories', client: c.id, kind: 'listing', title: `List ${c.name} on ${d.name}`,
        body: `${d.why}\n\nPaste this as the description:\n\n${text}\n\nWebsite: ${c.site || ''}`, link: d.url,
        ask: 'Yes once it is listed. Pass to never suggest this one again.' }] });
      st[d.id] = 'card'; cards++;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(st, null, 2) + '\n');
    await L.logRun({ loop: 'directories', client: c.id, status: 'ok', made: next.length, kept: cards, cards, note: next.map(d => d.id).join(', ') });
  }
}

// --- events ---
const strip = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
function parseEvents(body, src) {
  const out = [];
  if (/BEGIN:VEVENT/.test(body)) {
    for (const v of body.split('BEGIN:VEVENT').slice(1)) {
      const g = k => ((v.replace(/\r?\n[ \t]/g, '').match(new RegExp(`^${k}[^:]*:(.*)$`, 'm')) || [])[1] || '').trim();
      const d = s => s ? new Date(s.replace(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2}))?(Z?)$/, (m, y, mo, da, t, h, mi, se, z) => `${y}-${mo}-${da}T${h || '09'}:${mi || '00'}:${se || '00'}${z}`)) : null;
      out.push({ title: g('SUMMARY'), start: d(g('DTSTART')), end: d(g('DTEND')), where: g('LOCATION'), url: g('URL') || src, about: g('DESCRIPTION').slice(0, 300) });
    }
  }
  for (const m of body.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const walk = x => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      if (/Event$/.test([].concat(x['@type'] || '').join(' '))) out.push({ title: x.name, start: x.startDate ? new Date(x.startDate) : null, end: x.endDate ? new Date(x.endDate) : null,
        where: strip(x.location && (x.location.name || x.location.address && (x.location.address.addressLocality || x.location.address))), url: x.url || src, about: strip(x.description).slice(0, 300) });
      Object.values(x).forEach(v => typeof v === 'object' && walk(v));
    };
    walk(j);
  }
  if (!out.length && /<item>|<entry>/.test(body)) {
    for (const it of body.split(/<item>|<entry>/).slice(1)) {
      const g = k => strip((it.match(new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`)) || [])[1]);
      const link = (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || g('link');
      const when = g('ev:startdate') || g('startDate') || g('pubDate') || g('published');
      out.push({ title: g('title'), start: when ? new Date(when) : null, end: null, where: '', url: link || src, about: g('description').slice(0, 300), guessDate: true });
    }
  }
  return out.filter(e => e.title && e.start && !isNaN(e.start));
}

const SCORE = { type: 'object', additionalProperties: false, required: ['scores'], properties: { scores: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['n', 'score', 'why'], properties: { n: { type: 'integer' }, score: { type: 'integer' }, why: { type: 'string' } } } } } };

async function events() {
  for (const c of L.clients().filter(c => (c.event_feeds || []).length)) {
    const ff = path.join(L.STATE, c.id, 'feeds.json'), feeds = L.readJSON(ff, {}), seenF = path.join(L.STATE, c.id, 'events-seen.json'), seen = new Set(L.readJSON(seenF, []));
    let all = [];
    for (const url of c.event_feeds) {
      const f = feeds[url] || (feeds[url] = { fails: 0, off: false });
      if (f.off) continue;
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 OpenFrameEvents/1.0' }, signal: AbortSignal.timeout(20000) });
        const evs = parseEvents(await res.text(), url);
        if (!res.ok || !evs.length) throw new Error(res.ok ? 'no events found' : `HTTP ${res.status}`);
        f.fails = 0; f.last = evs.length; all = all.concat(evs);
      } catch (e) { f.fails++; f.error = e.message; if (f.fails >= 3) f.off = true; }
    }
    const now = Date.now(), soon = all.filter(e => e.start - now > 864e5 && e.start - now < 45 * 864e5 && !seen.has(e.url + e.title))
      .filter((e, i, a) => a.findIndex(x => x.title === e.title) === i).slice(0, 25);
    let cards = 0;
    if (soon.length) {
      const { scores } = await L.ask(`Graham runs ${c.name}: ${c.promise}. His clients: ${c.audience}. He goes to local events to meet potential clients and partners.
Score each event 1-5 for how likely he meets potential clients or partners there (5 = room full of nonprofit leaders or small mission-driven brand owners). One short why each.
${soon.map((e, i) => `${i}. ${e.title} | ${e.start.toDateString()} | ${e.where || ''} | ${e.about}`).join('\n')}`, SCORE, 0);
      const best = scores.filter(s => s.score >= 4 && soon[s.n]).sort((a, b) => b.score - a.score).slice(0, 3);
      for (const s of best) {
        const e = soon[s.n], end = e.end && !isNaN(e.end) ? e.end : new Date(+e.start + 2 * 36e5);
        await L.hub('add', { rows: [{ id: `event-${c.id}-${L.slug(e.title)}-${e.start.toISOString().slice(0, 10)}`, loop: 'events', client: c.id, kind: 'event',
          title: e.title, body: `${e.start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${e.where ? `\n${e.where}` : ''}${e.guessDate ? '\n(Check the date on the page.)' : ''}\n\n${e.about}`,
          why: s.why, link: e.url, when: `${e.start.toISOString()}|${end.toISOString()}`, ask: 'Go? Yes adds it to your calendar.' }] });
        cards++;
      }
      soon.forEach(e => seen.add(e.url + e.title));
    }
    fs.mkdirSync(path.dirname(ff), { recursive: true });
    fs.writeFileSync(ff, JSON.stringify(feeds, null, 2) + '\n');
    fs.writeFileSync(seenF, JSON.stringify([...seen].slice(-500)) + '\n');
    const dead = Object.entries(feeds).filter(([, f]) => f.off).map(([u]) => u);
    await L.logRun({ loop: 'events', client: c.id, status: all.length ? 'ok' : 'check', made: soon.length, kept: cards, cards, note: `${all.length} events read${dead.length ? `; feeds off: ${dead.join(' ')}` : ''}` });
  }
}

async function gbp() {
  for (const c of L.clients().filter(c => c.gbp)) {
    const stats = await L.hub('stats', { client: c.id, days: 30 }).catch(() => ({ top: [] }));
    let backlog = '';
    try { backlog = fs.readFileSync(path.join(L.STATE, c.id, 'backlog.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-3).join('\n'); } catch {}
    const source = stats.top && stats.top[0] ? `Their best post this month: "${stats.top[0].caption}"` : backlog ? `Recent approved ideas:\n${backlog}` : `What they do: ${c.promise}`;
    const text = await write(`Write a Google Business Profile update for ${c.name}${c.city ? ` in ${c.city}` : ''}. Who they help: ${c.audience}.
${source}
3 short sentences, one useful tip or concrete example, then a plain call to action. 300 to 700 characters. No hashtags, no emoji, no em dashes.`, { minChars: 200, maxChars: 800 });
    if (!text) { await L.logRun({ loop: 'gbp', client: c.id, status: 'check', made: 2, kept: 0, cards: 0, note: 'failed the check' }); continue; }
    await L.hub('add', { rows: [{ id: `gbp-${c.id}-${L.today()}`, loop: 'gbp', client: c.id, kind: 'Google post', status: 'todo', title: `Google Business update for ${c.name}`,
      body: `${text}\n\nButton: Learn more, link ${c.site || ''}\nPhoto: reuse this week's best post image.`, link: 'https://business.google.com/',
      ask: 'Open, Add update, paste, add the photo. Takes 1 minute and keeps the profile active.' }] });
    await L.logRun({ loop: 'gbp', client: c.id, status: 'ok', made: 1, kept: 1, cards: 1, note: '' });
  }
}

async function templates() {
  const ans = await answers('templates');
  for (const c of L.clients()) {
    const file = path.join(L.STATE, c.id, 'winners.json'), win = L.readJSON(file, []);
    for (const w of win) { const a = ans[`tpl-${c.id}-${w.id}`]; if (a && a !== 'card' && w.status === 'card') w.status = a === 'yes' || a === 'change' ? 'saved' : 'passed'; }
    const stats = await L.hub('stats', { client: c.id, days: 30 }).catch(() => ({ top: [] }));
    const best = (stats.top || []).find(p => p.id && !win.some(w => w.id === p.id));
    let cards = 0;
    if (best && best.score >= 10) {
      win.push({ id: best.id, url: best.url, type: best.type, platform: best.platform, caption: best.caption, score: best.score, saved_on: L.today(), status: 'card' });
      await L.hub('add', { rows: [{ id: `tpl-${c.id}-${best.id}`, loop: 'templates', client: c.id, kind: 'winner', title: `Make this a ${c.name} template?`,
        body: `${best.type} on ${best.platform}, ${best.published}\n"${best.caption}"\n\nScore ${best.score} (saves, shares, comments, likes), top of the month.`, link: best.url,
        ask: 'Yes saves its format and hook so new posts reuse it.' }] });
      cards = 1;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(win, null, 2) + '\n');
    await L.logRun({ loop: 'templates', client: c.id, status: 'ok', made: best ? 1 : 0, kept: cards, cards, note: best ? '' : 'no new top post yet' });
  }
}

const wrap = (name, fn) => async () => { L.pull(); try { await fn(); } finally { L.pushState(`Loops: ${name}`); } };
module.exports = { directories: wrap('directories', directories), events: wrap('events', events), gbp: wrap('gbp', gbp), templates: wrap('templates', templates), parseEvents };
