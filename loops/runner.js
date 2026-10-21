// Loop runner. Runs on Graham's Mac under pm2 ("loops"). Free tools only.
//   node runner.js daemon          check every minute: run scheduled loops (loops.json "schedule") and "every N min" loops
//   node runner.js ideas [client]  run the weekly ideas loop now (all enabled clients, or one)
//   node runner.js scripts         turn approved ideas into scripts now
// Schedules use this Mac's clock. Last runs are kept in state/last-run.json so a restart never runs a loop twice.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const MODS = { ideas: () => require('./ideas').run, scripts: () => require('./scripts').tick };
const LAST = path.join(L.STATE, 'last-run.json');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function due(loop, last, now) {
  if (loop.every) return !last || now - new Date(last) >= loop.every * 60000;
  const [day, hm] = String(loop.schedule || '').toLowerCase().split(' ');
  if (!hm) return false;
  const [h, m] = hm.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  const dayOk = day === 'daily' || DAYS[now.getDay()] === day;
  return dayOk && now >= at && (!last || new Date(last) < at);
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date(), last = L.readJSON(LAST, {});
    for (const loop of L.readJSON(path.join(L.HERE, 'loops.json'), { loops: [] }).loops.filter(l => l.run && MODS[l.run])) {
      if (!due(loop, last[loop.id], now)) continue;
      last[loop.id] = now.toISOString();
      fs.writeFileSync(LAST, JSON.stringify(last, null, 2));
      try { await MODS[loop.run]()(); } catch (e) { L.log(loop.id, 'failed:', e.message); }
    }
  } finally { busy = false; }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'daemon') { L.log('loops runner started'); tick(); setInterval(tick, 60000); }
else if (MODS[cmd]) MODS[cmd]()(arg).catch(e => { console.error(e.message); process.exit(1); });
else { console.log('Use: node runner.js daemon | ideas [client] | scripts'); process.exit(1); }
