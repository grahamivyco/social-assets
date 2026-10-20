// Up to 40 creators a week: active ones first, then suggested ones (oldest scan first)
const clean = h => String(h || '').trim().replace(/^@/, '').replace(/\/$/, '').split('/').pop().toLowerCase();
const rows = $('Read Creators').all().map(i => i.json).filter(r => clean(r.handle));
const st = r => String(r.status || '').trim().toLowerCase();
const age = r => (r.last_scanned ? new Date(r.last_scanned).getTime() : 0) || 0;
const active = rows.filter(r => st(r) === 'active' || st(r) === '').sort((a, b) => age(a) - age(b));
const suggested = rows.filter(r => st(r) === 'suggested').sort((a, b) => age(a) - age(b));
const F = '{username,name,biography,website,followers_count,media_count,media.limit(50){caption,permalink,timestamp}}';
return [...active, ...suggested].slice(0, 40).map(r => {
  const handle = clean(r.handle);
  return { json: { handle, status: st(r) || 'active', fields: `business_discovery.username(${handle})${F}` } };
});
