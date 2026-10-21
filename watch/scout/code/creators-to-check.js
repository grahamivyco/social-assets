// Up to 50 creators a week: the "Viral creators" tab first (big names Graham adds), then active brand-scout creators.
const clean = h => String(h || '').trim().replace(/^@/, '').replace(/\/$/, '').split('/').pop().toLowerCase();
const st = r => String(r.status || '').trim().toLowerCase();
const pick = node => { try { return $(node).all().map(i => i.json).filter(r => clean(r.handle) && (st(r) === 'active' || st(r) === '')); } catch (e) { return []; } };
const seen = new Set();
const F = '{username,followers_count,media.limit(50){caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count}}';
return [...pick('Read Viral creators'), ...pick('Read Creators')]
  .map(r => clean(r.handle)).filter(h => !seen.has(h) && seen.add(h)).slice(0, 50)
  .map(handle => ({ json: { handle, fields: `business_discovery.username(${handle})${F}` } }));
