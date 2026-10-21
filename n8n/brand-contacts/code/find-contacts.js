// Reads each brand's public website (no logins, no LinkedIn) for partnership emails and creator program pages,
// and builds a LinkedIn people search link Graham opens himself.
const LINK_IN_BIO = /(linktr\.ee|linkin\.bio|clicklinkin\.bio|visitstore\.bio|linkstre\.am|beacons\.ai|stan\.store|lnk\.bio|campsite\.bio|tap\.bio|bio\.site|hoo\.be|later\.com|shorby|milkshake|solo\.to|flowcode|bit\.ly|linkpop|snipfeed|komi\.io|direct\.me)/i;
const SOCIAL = /(instagram|facebook|fb\.me|tiktok|youtube|youtu\.be|twitter|x\.com|threads\.net|pinterest|linkedin|spotify|apple\.com|google|gstatic|cloudflare|cdn|w3\.org|schema\.org|wa\.me|whatsapp|snapchat|discord|reddit|vimeo|twitch)/i;
const PAGE_WORDS = /(creator|influencer|ambassador|affiliate|partner|collab|press|media|contact)/i;
const PROGRAM_WORDS = /(creator|influencer|ambassador|affiliate|partner)/i;
const GOOD_EMAIL = [/partner|collab|creator|influencer|ambassador|affiliate/i, /marketing|brand|social|pr\b|press|media|pr@/i, /hello|info|contact|team/i];
const BAD_EMAIL = /(\.(png|jpe?g|gif|svg|webp)$|example\.|sentry|wixpress|domain\.com|email\.com|yourname|noreply|no-reply|privacy|legal|dpo|gdpr|careers|jobs|support|help|abuse|security|billing|invoice|orders?@|returns)/i;

const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const base = d => d.split('.').slice(-2).join('.');
const self = this;
async function get(url) {
  try {
    const r = await self.helpers.httpRequest({ url, method: 'GET', timeout: 10000, ignoreHttpStatusErrors: true, returnFullResponse: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': 'text/html' } });
    return r.statusCode < 400 && typeof r.body === 'string' ? r.body : '';
  } catch (e) { return ''; }
}
const links = (html, from) => [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m => { try { return new URL(m[1], from).href; } catch (e) { return ''; } }).filter(Boolean);
const emails = html => [...new Set((html.replace(/&#64;|\[at\]|\(at\)/gi, '@').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(e => e.toLowerCase()))].filter(e => !BAD_EMAIL.test(e));
const emailScore = e => { const local = e.split('@')[0]; const i = GOOD_EMAIL.findIndex(r => r.test(local)); return i < 0 ? 9 : i; };

const out = [];
for (const { json: b } of $input.all()) {
  let site = b.website && !/^https?:/i.test(b.website) ? 'https://' + b.website : b.website;
  let domain = host(site);
  let home = '';
  // Link-in-bio page: pick the brand's own domain from its links (the one used most, ideally named like the brand)
  if (!domain || LINK_IN_BIO.test(domain)) {
    const html = site ? await get(site) : '';
    const count = {};
    links(html, site).map(host).filter(h => h && !SOCIAL.test(h) && !LINK_IN_BIO.test(h)).forEach(h => count[base(h)] = (count[base(h)] || 0) + 1);
    const stem = b.handle.replace(/[^a-z0-9]/g, '');
    const best = Object.entries(count).sort((x, y) => (y[0].includes(stem) - x[0].includes(stem)) || y[1] - x[1])[0];
    domain = best ? best[0] : '';
  }
  const found = new Map(); let program = '';
  if (domain) {
    const root = 'https://' + domain;
    home = await get(root);
    const pages = [...new Set(links(home, root).filter(u => base(host(u)) === base(domain) && PAGE_WORDS.test(u.split(/[?#]/)[0].replace(root, ''))))].slice(0, 6);
    if (!pages.some(u => /contact/i.test(u))) pages.push(root + '/contact');
    program = pages.find(u => PROGRAM_WORDS.test(u)) || '';
    emails(home).forEach(e => found.set(e, 'home page'));
    for (const p of pages) {
      const html = await get(p);
      emails(html).forEach(e => { if (!found.has(e)) found.set(e, p); });
    }
  }
  const ranked = [...found.keys()].sort((x, y) => emailScore(x) - emailScore(y) || (base(x.split('@')[1]) === base(domain) ? -1 : 1));
  const brandName = String(b.name || b.handle).replace(/[^\w\s&'.-]/g, '').trim();
  out.push({ json: { handle: b.handle, domain, contact_email: ranked[0] || '', other_emails: ranked.slice(1, 4).join(', '),
    email_found_on: ranked[0] ? found.get(ranked[0]) : '', program_url: program,
    linkedin_search: 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(`${brandName} creator partnerships`),
    contacts_checked: new Date().toISOString() } });
}
return out;
