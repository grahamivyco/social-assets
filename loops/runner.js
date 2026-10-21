// Loop runner. Runs on Graham's Mac under pm2 ("loops"). Free tools only.
//   node runner.js daemon          check every minute: run scheduled loops (loops.json "schedule") and "every N min" loops
//   node runner.js ideas [client]  run the weekly ideas loop now (all enabled clients, or one)
//   node runner.js <loop> [client] run any loop in MODS now (ideas, scripts, engage, leads, site, site-collect)
// Loops with "off": true in loops.json are skipped by the daemon (still runnable by hand).
// Schedules use this Mac's clock. Last runs are kept in state/last-run.json so a restart never runs a loop twice.
const fs = require('fs'), path = require('path');
const L = require('./lib');

const MODS = {
  ideas: () => require('./ideas').run, scripts: () => require('./scripts').tick,
  engage: () => require('./engage').run, leads: () => require('./leads').run,
  site: () => require('./site').run, 'site-collect': () => require('./site').collect,
  audio: () => require('./audio').run, 'reel-ask': () => require('./asks').tick,
  magnet: () => require('./magnet').tick, proposal: () => require('./proposal').tick, onboard: () => require('./onboard').run,
  directories: () => require('./grow').directories, events: () => require('./grow').events, gbp: () => require('./grow').gbp, templates: () => require('./grow').templates,
  proof: () => require('./later').proof, warmup: () => require('./later').warmup, retention: () => require('./later').retention, trends: () => require('./later').trends,
  'key-radar': () => require('./key').radar, spotlight: () => require('./key').spotlight, deals: () => require('./deals').run,
};
const LAST = path.join(L.STATE, 'last-run.json');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function due(loop, last, now) {
  if (loop.every) return !last || now - new Date(last) >= loop.every * 60000;
  const [day, hm] = String(loop.schedule || '').toLowerCase().split(' ');
  if (!hm) return false;
  const [h, m] = hm.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  const dayOk = day === 'daily' || DAYS[now.getDay()] === day || (day === 'weekdays' && now.getDay() % 6 !== 0)
    || (/^\d+$/.test(day) && now.getDate() === Number(day));   // "1 09:00" = 1st of the month
  return dayOk && now >= at && (!last || new Date(last) < at);
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date(), last = L.readJSON(LAST, {});
    for (const loop of L.readJSON(path.join(L.HERE, 'loops.json'), { loops: [] }).loops.filter(l => l.run && MODS[l.run] && !l.off)) {
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
else { console.log('Use: node runner.js daemon | ' + Object.keys(MODS).join(' | ')); process.exit(1); }
