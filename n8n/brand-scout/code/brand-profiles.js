// Adds each brand's profile and builds the question for the local AI model (LM Studio)
const ABOUT = 'Open Frame is a small design and marketing studio (Minneapolis and Barcelona) that posts about branding, logos, websites, social media and marketing for mission-driven organizations, nonprofits and small brands.';
const SYSTEM = 'You sort Instagram accounts for a creator looking for brand deals. Reply only with JSON.';
const asked = $('Brand candidates').all().map(i => i.json);
return $input.all().map((item, idx) => {
  const b = { ...asked[idx] };
  delete b.fields;
  const bd = item.json.business_discovery;
  if (!bd) return { json: { ...b, handle_check: 'not found, or a personal account', tagged: [], llm: null } };
  const tagged = new Set();
  ((bd.media && bd.media.data) || []).forEach(m => (String(m.caption || '').match(/@([a-z0-9._]{2,30})/gi) || [])
    .forEach(t => { const h = t.slice(1).toLowerCase().replace(/\.+$/, ''); if (h !== b.handle) tagged.add(h); }));
  const user = `${ABOUT}\n\nAccount: @${bd.username}\nName: ${bd.name || ''}\nFollowers: ${bd.followers_count || 0}\nWebsite: ${bd.website || ''}\nBio: ${String(bd.biography || '').slice(0, 400)}\n\n` +
    'Answer:\n- type: "brand" if this is a company or product that pays creators, "creator" if it is a person or creator, "other" for media, events, agencies or anything else.\n' +
    '- fit: "high", "medium" or "low" for how likely this brand would sponsor Open Frame\'s content.\n- why: one plain sentence, max 15 words.';
  return { json: { ...b, name: bd.name || '', followers: bd.followers_count || '', website: bd.website || '',
    bio: String(bd.biography || '').replace(/\s+/g, ' ').slice(0, 200), handle_check: 'ok', tagged: [...tagged].slice(0, 15),
    llm: { model: 'qwen/qwen3.5-9b', reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false }, temperature: 0.2, max_tokens: 200,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name: 'brand_fit', strict: true, schema: { type: 'object',
        properties: { type: { type: 'string', enum: ['brand', 'creator', 'other'] }, fit: { type: 'string', enum: ['high', 'medium', 'low'] }, why: { type: 'string' } },
        required: ['type', 'fit', 'why'] } } } } } };
});
