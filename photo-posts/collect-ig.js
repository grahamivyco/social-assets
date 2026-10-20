// Pull the guild's public Instagram photos into the inbox, without admin access to the guild.
// Uses Instagram Business Discovery: Open Frame's IG business account reads another
// business/creator account's public posts. Needs a Page token for Open Frame in IG_TOKEN.
// Usage: IG_TOKEN=... node collect-ig.js <out-folder> [--user needleworkguildmn] [--limit 50]
// Writes one image per photo (carousel children included) and photos.csv with the caption,
// date and permalink, so you can pick the good ones and drop them into a post folder.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > -1 ? args.splice(i, 2)[1] : d; };
const USER = opt('user', 'needleworkguildmn'), LIMIT = +opt('limit', 50);
const ME = process.env.IG_USER_ID || '17841420040350345'; // open.framedesign
const TOKEN = process.env.IG_TOKEN, OUT = args[0];
if (!TOKEN || !OUT) { console.log('IG_TOKEN=... node collect-ig.js <out-folder> [--user name] [--limit 50]'); process.exit(1); }

const fields = `business_discovery.username(${USER}){media.limit(${LIMIT}){id,caption,timestamp,permalink,media_type,media_url,children{media_type,media_url}}}`;
const cq = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

(async () => {
  const r = await fetch(`https://graph.facebook.com/v21.0/${ME}?fields=${encodeURIComponent(fields)}&access_token=${TOKEN}`);
  const j = await r.json();
  if (j.error) { console.error(j.error.message); process.exit(1); }
  fs.mkdirSync(OUT, {recursive: true});
  const rows = [['file', 'caption', 'credit', 'quote', 'people', 'consent', 'focus', 'posted', 'permalink']];
  for (const m of j.business_discovery.media.data) {
    const items = m.media_type === 'CAROUSEL_ALBUM' ? m.children.data : [m];
    let n = 0;
    for (const it of items) {
      if (it.media_type !== 'IMAGE' || !it.media_url) continue; // videos are left out
      const file = `ig-${m.timestamp.slice(0, 10)}-${m.id}${items.length > 1 ? '-' + ++n : ''}.jpg`;
      if (!fs.existsSync(path.join(OUT, file))) fs.writeFileSync(path.join(OUT, file), Buffer.from(await (await fetch(it.media_url)).arrayBuffer()));
      rows.push([file, (m.caption || '').split('\n')[0].slice(0, 120), '', '', '', '', '', m.timestamp.slice(0, 10), m.permalink]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'photos.csv'), rows.map(r => r.map(cq).join(',')).join('\n') + '\n');
  console.log(`saved ${rows.length - 1} photos from @${USER} to ${OUT}`);
})();
