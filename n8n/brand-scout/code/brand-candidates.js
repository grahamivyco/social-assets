// Brands that similar creators tagged in sponsored posts, merged with what the Brands tab already knows
const clean = h => String(h || '').trim().replace(/^@/, '').toLowerCase();
const list = s => String(s || '').split(/[,\s]+/).map(clean).filter(Boolean);
const creators = new Set($('Read Creators').all().map(i => clean(i.json.handle)).filter(Boolean));
const known = new Map($('Read Brands').all().map(i => i.json).filter(r => clean(r.handle)).map(r => [clean(r.handle), r]));
const agg = {};
for (const { json: c } of $('Creator results').all()) {
  if (c.status !== 'active') continue;
  for (const d of c._deals || []) for (const b of d.brands) {
    if (creators.has(b)) continue;
    const a = agg[b] = agg[b] || { creators: new Set(), posts: 0, example: '', last: '' };
    a.creators.add(c.handle); a.posts++;
    if (!a.last || d.timestamp > a.last) { a.last = d.timestamp; a.example = d.permalink; }
  }
}
const out = [];
for (const [handle, a] of Object.entries(agg)) {
  const k = known.get(handle) || {};
  if (['skip', 'not a brand'].includes(String(k.status || '').toLowerCase())) continue;
  list(k.creator_handles).forEach(h => a.creators.add(h));
  const prevPosts = Number(k.deal_posts) || 0;
  out.push({ handle, isNew: !known.has(handle), status: k.status || 'new',
    creators_seen: a.creators.size, creator_handles: [...a.creators].map(h => '@' + h).join(', '),
    deal_posts: Math.max(prevPosts, a.posts), example_post: a.example || k.example_post || '',
    last_seen: a.last ? a.last.slice(0, 10) : (k.last_seen || '') });
}
// New brands and brands seen with the most creators first; 40 lookups a week keeps us far under Instagram's limit
out.sort((x, y) => (y.isNew - x.isNew) || (y.creators_seen - x.creators_seen) || (y.deal_posts - x.deal_posts));
const F = '{username,name,biography,website,followers_count,media_count,media.limit(25){caption}}';
return out.slice(0, 40).map(b => ({ json: { ...b, fields: `business_discovery.username(${b.handle})${F}` } }));
