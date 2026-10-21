// Scores each creator against our own profile and pulls their sponsored posts
const MIN_SIM = 20, MIN_FOLLOWERS = 1000, MAX_FOLLOWERS = 300000;
const DAYS = 365;
const STOP = new Set('the and for you your with this that are our was have has from but not all can just what when out new get got its it\'s one more about how they them their will who make made into like love here there day today week year time back been some very also than then which would could should these those over only even most much many really thing things want need see let lets dont don\'t isnt didnt cant http https www com link bio comment comments post posts follow share save'.split(' '));
const TOPICS = ['design','designer','brand','branding','logo','logos','marketing','social','socialmedia','content','creative','creator','studio','agency','nonprofit','nonprofits','smallbusiness','business','website','websites','web','typography','type','illustration','graphic','graphicdesign','canva','figma','adobe','photography','newsletter','strategy','mission','community','minneapolis','barcelona','freelance','entrepreneur'];
const words = t => (String(t || '').toLowerCase().match(/[a-z][a-z0-9']{2,}/g) || []).filter(w => !STOP.has(w));
function vec(bio, captions) {
  const v = {};
  words(bio).forEach(w => v[w] = (v[w] || 0) + 3);
  captions.forEach(c => words(c).forEach(w => v[w] = (v[w] || 0) + 1));
  return v;
}
function similarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k in b) nb += b[k] * b[k];
  const cos = na && nb ? dot / Math.sqrt(na * nb) : 0;
  const mine = TOPICS.filter(t => a[t]);
  const shared = mine.filter(t => b[t]).length;
  const topic = mine.length ? Math.min(1, shared / Math.min(mine.length, 6)) : 0;
  return Math.round(100 * (0.5 * Math.min(1, cos * 2) + 0.5 * topic));
}
const DEAL = /(#ad\b|#ads\b|#sponsored|#spon\b|#paidpartnership|#partner\b|#brandpartner|#ambassador|#[a-z0-9]+partner\b|#[a-z0-9]+ambassador\b|#gifted|paid partnership|in partnership with|partnered with|partnering with|sponsored by|thanks to @|thank you @|use (my )?code|discount code|promo code|affiliate link|#collab\b)/i;
const IGNORE = new Set(['gmail.com', 'instagram', 'threads', 'youtube', 'tiktok', 'linkedin']);
function dealBrands(caption, self) {
  const out = new Set();
  (caption.match(/@([a-z0-9._]{2,30})/gi) || []).forEach(m => {
    const h = m.slice(1).toLowerCase().replace(/\.+$/, '');
    if (h && h !== self && !IGNORE.has(h)) out.add(h);
  });
  if (!out.size) (caption.match(/#([a-z0-9]{3,25})(partner|ambassador)\b/gi) || []).forEach(m => {
    const h = m.slice(1).toLowerCase().replace(/(partner|ambassador)$/, '');
    if (h && h !== 'brand' && h !== 'paid') out.add(h);
  });
  return [...out];
}

const me = $('IG: my profile').first().json;
const myVec = vec(me.biography, ((me.media && me.media.data) || []).map(m => m.caption || ''));
const asked = $('Creators to scan').all().map(i => i.json);
const now = new Date().toISOString();
const cutoff = Date.now() - DAYS * 864e5;

return $input.all().map((item, idx) => {
  const ask = asked[idx] || {};
  const bd = item.json.business_discovery;
  if (!bd) {
    return { json: { handle: ask.handle, status: ask.status === 'suggested' ? 'skip' : ask.status, last_scanned: now,
      handle_check: 'not found, or a personal account (only creator/business accounts can be read)', _deals: [] } };
  }
  const media = (bd.media && bd.media.data) || [];
  const sim = similarity(myVec, vec(bd.biography, media.map(m => m.caption || '')));
  const deals = media.filter(m => m.caption && DEAL.test(m.caption) && new Date(m.timestamp).getTime() >= cutoff)
    .map(m => ({ permalink: m.permalink, timestamp: m.timestamp, brands: dealBrands(m.caption, bd.username.toLowerCase()) }))
    .filter(d => d.brands.length);
  const count = {};
  deals.forEach(d => d.brands.forEach(b => count[b] = (count[b] || 0) + 1));
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b]) => '@' + b).join(', ');
  let status = ask.status;
  if (status === 'suggested') {
    const f = bd.followers_count || 0;
    status = sim >= MIN_SIM && f >= MIN_FOLLOWERS && f <= MAX_FOLLOWERS ? 'active' : 'skip';
  }
  return { json: { handle: ask.handle, status, name: bd.name || '', followers: bd.followers_count || '', similarity: sim,
    deal_posts: deals.length, top_brands: top, last_scanned: now, handle_check: 'ok', _deals: deals } };
});
