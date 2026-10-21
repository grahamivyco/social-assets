// A Reel is an outlier when it beat that creator's own normal by 3x or more (likes + 3 x comments, last 12 months).
// Beating their own normal works for any niche size, where a fixed "2M views" only fits huge niches.
const RATIO = 3, MIN_POSTS = 8, PER_CREATOR = 3, DAYS = 365;
const asked = $('Creators to check').all().map(i => i.json);
const known = new Set($('Read Outliers').all().map(i => String(i.json.permalink || '').trim()).filter(Boolean));
const cutoff = Date.now() - DAYS * 864e5;
const score = m => (m.like_count || 0) + 3 * (m.comments_count || 0);
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const now = new Date().toISOString();
const out = [];
$input.all().forEach((item, idx) => {
  const bd = item.json.business_discovery;
  const handle = (asked[idx] || {}).handle;
  if (!bd) return;
  // Hidden like counts come back missing; leave those posts out of the maths.
  const posts = ((bd.media && bd.media.data) || []).filter(m => new Date(m.timestamp).getTime() >= cutoff && m.like_count != null);
  if (posts.length < MIN_POSTS) return;
  const base = median(posts.map(score)) || 1;
  posts.filter(m => m.media_product_type === 'REELS' || m.media_type === 'VIDEO')
    .map(m => ({ m, ratio: score(m) / base }))
    .filter(x => x.ratio >= RATIO && !known.has(x.m.permalink))
    .sort((a, b) => b.ratio - a.ratio).slice(0, PER_CREATOR)
    .forEach(({ m, ratio }) => out.push({ json: {
      permalink: m.permalink, handle: bd.username || handle, followers: bd.followers_count || '',
      posted: String(m.timestamp).slice(0, 10), likes: m.like_count || 0, comments: m.comments_count || 0,
      ratio: Math.round(ratio * 10) / 10, caption: String(m.caption || '').replace(/\s+/g, ' ').slice(0, 200),
      status: 'sent to watch', found_at: now } }));
});
return out;
