// Every looked-up account is saved so it isn't looked up again. People and media accounts get status "not a brand"
return $input.all().map(i => {
  const b = i.json;
  const status = b.type === 'creator' || b.type === 'other' ? 'not a brand' : b.status;
  return { json: { handle: b.handle, status, fit: b.fit, why: b.why, creators_seen: b.creators_seen,
    creator_handles: b.creator_handles, deal_posts: b.deal_posts, followers: b.followers || '', website: b.website || '',
    example_post: b.example_post, last_seen: b.last_seen, bio: b.bio || '', handle_check: b.handle_check, last_checked: b.last_checked } };
});
