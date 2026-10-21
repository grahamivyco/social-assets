// Compares the two sets of terms. Numbers are compared here; wording is sent to the local AI as same/different questions.
const parse = r => { try { const t = r.choices[0].message.content; return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { return null; } };
const LABEL = { fee: 'Fee', currency: 'Currency', payment_due_days: 'Payment timing (days)', deliverables: 'Deliverables', deliverable_count: 'Number of pieces',
  deadlines: 'Deadlines', usage_rights: 'Usage rights', paid_ads_or_whitelisting: 'Paid ads / whitelisting', exclusivity: 'Exclusivity',
  revisions: 'Revisions', approval: 'Approval process', cancellation_or_kill_fee: 'Cancellation / kill fee', content_ownership: 'Who owns the content' };
const NUMERIC = ['fee', 'payment_due_days', 'deliverable_count'];
const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const has = f => f && f.value !== null && f.value !== undefined && String(f.value).trim() !== '';
const prev = $('Build extraction requests').all().map(i => i.json);
const emailRes = $('Local AI: terms from emails').all().map(i => i.json);
return $input.all().map((item, idx) => {
  const p = prev[idx];
  const E = parse(emailRes[idx]) || {}, C = parse(item.json) || {};
  const rows = [], pairs = [];
  for (const k of Object.keys(LABEL)) {
    const e = E[k], c = C[k];
    const row = { field: k, label: LABEL[k], email: has(e) ? e : null, contract: has(c) ? c : null, result: '' };
    if (!row.email && !row.contract) row.result = 'neither';
    else if (row.email && !row.contract) row.result = 'missing';
    else if (!row.email && row.contract) row.result = 'contract only';
    else if (NUMERIC.includes(k)) row.result = Number(e.value) === Number(c.value) ? 'match' : 'mismatch';
    else if (norm(e.value) === norm(c.value)) row.result = 'match';
    else { row.result = 'check'; pairs.push({ id: k, email: String(e.value), contract: String(c.value) }); }
    rows.push(row);
  }
  // Red flags in the contract itself, whatever the emails said
  const flags = [];
  const v = k => (has(C[k]) ? String(C[k].value) : '');
  if (/perpetu|in perpetuity|forever|unlimited|irrevocable/i.test(v('usage_rights'))) flags.push(['Usage rights look permanent', C.usage_rights]);
  if (/assign|work.?for.?hire|all right|brand owns|company owns|exclusive owner/i.test(v('content_ownership'))) flags.push(['You may be giving up ownership of the content', C.content_ownership]);
  if (/yes|may|can|right to|whitelist|spark|boost|paid/i.test(v('paid_ads_or_whitelisting')) && !/no\b|not|without/i.test(v('paid_ads_or_whitelisting'))) flags.push(['Brand can run your content as paid ads. That usually earns an extra fee', C.paid_ads_or_whitelisting]);
  if (has(C.payment_due_days) && Number(C.payment_due_days.value) > 30) flags.push([`Payment comes ${C.payment_due_days.value} days after invoice`, C.payment_due_days]);
  const ex = v('exclusivity'); const exDays = (() => { const m = ex.match(/(\d+)\s*(day|week|month|year)/i); if (!m) return 0; return Number(m[1]) * { day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()]; })();
  if (ex && !/no exclusiv|none|not exclusive/i.test(ex) && (exDays === 0 || exDays > 30)) flags.push([exDays ? `Exclusivity lasts about ${exDays} days` : 'Exclusivity with no clear end date', C.exclusivity]);
  if (/unlimited|as many|until satisf/i.test(v('revisions'))) flags.push(['Unlimited revisions', C.revisions]);
  if (!has(C.cancellation_or_kill_fee)) flags.push(['No kill fee if the brand cancels after you start', null]);
  const judge = pairs.length ? { model: 'google/gemma-4-e4b', temperature: 0, max_tokens: 800,
    messages: [{ role: 'system', content: 'You compare deal terms. Reply only with JSON.' },
      { role: 'user', content: 'For each pair, say "same" if the contract matches what the emails agreed (wording can differ), or "different" if a number, amount, length of time, channel, count or obligation differs. Add a short reason, max 15 words.\n\n' + JSON.stringify(pairs) }],
    response_format: { type: 'json_schema', json_schema: { name: 'judgement', strict: true, schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object',
      properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['same', 'different'] }, reason: { type: 'string' } }, required: ['id', 'verdict', 'reason'] } } }, required: ['results'] } } } } : null;
  return { json: { ...p, llmEmail: undefined, llmContract: undefined, aiOk: !!(parse(emailRes[idx]) && parse(item.json)), rows, flags, judge } };
});
