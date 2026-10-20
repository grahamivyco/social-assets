// Snowball: creators that brands tag, plus "brands" that turned out to be people, become suggested creators.
// They get scanned next week and switch to active or skip on their own.
const clean = h => String(h || '').trim().replace(/^@/, '').toLowerCase();
const have = new Set([...$('Read Creators').all(), ...$('Read Brands').all()].map(i => clean(i.json.handle)).filter(Boolean));
const brandSet = new Set($input.all().map(i => i.json.handle));
const out = new Map();
for (const { json: b } of $input.all()) {
  if (b.type === 'creator' && !have.has(b.handle)) out.set(b.handle, `looked like a brand, is a creator (seen with ${b.creator_handles})`);
  if (b.type !== 'brand') continue;
  for (const t of b.tagged || []) if (!have.has(t) && !brandSet.has(t) && !out.has(t)) out.set(t, `tagged by @${b.handle}`);
}
return [...out].slice(0, 30).map(([handle, source]) => ({ json: { handle, status: 'suggested', source } }));
