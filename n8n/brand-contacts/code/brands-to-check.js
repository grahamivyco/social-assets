// Brands worth contacting that don't have contact info yet: new or pitch, fit high or medium, 10 per run
const rows = $('Read Brands').all().map(i => i.json).filter(r => r.handle);
const rank = { high: 0, medium: 1 };
return rows
  .filter(r => ['new', 'pitch'].includes(String(r.status).toLowerCase()) && String(r.fit).toLowerCase() in rank && !r.contacts_checked)
  .sort((a, b) => rank[String(a.fit).toLowerCase()] - rank[String(b.fit).toLowerCase()] || (Number(b.creators_seen) || 0) - (Number(a.creators_seen) || 0))
  .slice(0, 10)
  .map(r => ({ json: { handle: r.handle, name: r.name || r.handle, website: r.website || '', bio: r.bio || '' } }));
