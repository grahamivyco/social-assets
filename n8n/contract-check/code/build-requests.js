// Two questions for the local AI: what the emails agreed, and what the contract says. Same fields for both.
const MODEL = 'qwen/qwen3.5-9b';   // thinking off in each request: the answers need the token budget
const CAP = 14000; // characters per text, so it fits the model's context window
const KEY = /(fee|pay|paid|\$|usd|eur|invoice|net ?\d|rate|compens|deliverabl|post|reel|video|stor(y|ies)|deadline|due|date|usage|licen[cs]|rights?|perpetu|exclusiv|compet|revision|approv|terminat|cancel|kill|own|intellectual|whitelist|boost|ads?\b|spark|term\b|months?|days?|weeks?)/i;
function focus(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (t.length <= CAP) return { text: t, cut: false };
  // Long text: keep the paragraphs that talk about money, rights, deliverables and dates
  const parts = t.split(/\n\s*\n|(?<=\.)\s{2,}/).filter(p => KEY.test(p));
  let out = '';
  for (const p of parts) { if (out.length + p.length > CAP) break; out += p.trim() + '\n\n'; }
  return { text: out || t.slice(0, CAP), cut: true };
}
const FIELD = { type: 'object', properties: { value: { type: ['string', 'null'] }, quote: { type: ['string', 'null'] } }, required: ['value', 'quote'] };
const NUM = { type: 'object', properties: { value: { type: ['number', 'null'] }, quote: { type: ['string', 'null'] } }, required: ['value', 'quote'] };
const FIELDS = {
  fee: NUM, currency: FIELD, payment_due_days: NUM, deliverables: FIELD, deliverable_count: NUM, deadlines: FIELD,
  usage_rights: FIELD, paid_ads_or_whitelisting: FIELD, exclusivity: FIELD, revisions: FIELD, approval: FIELD,
  cancellation_or_kill_fee: FIELD, content_ownership: FIELD
};
const schema = { type: 'object', properties: FIELDS, required: Object.keys(FIELDS) };
const HELP = 'fee = total money paid to the creator as a number. payment_due_days = days after invoice or posting until payment (Net 30 = 30). ' +
  'deliverables = what the creator must make and post, in short words. deliverable_count = number of pieces of content. ' +
  'usage_rights = how long and where the brand may use the content. paid_ads_or_whitelisting = whether the brand can run the content as ads or from the creator\'s account. ' +
  'exclusivity = any ban on working with competitors, with how long. content_ownership = who owns the content.';
const ask = (who, text) => ({ model: MODEL, reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false }, temperature: 0, max_tokens: 1500,
  messages: [
    { role: 'system', content: 'You read creator brand-deal documents and pull out the terms. Reply only with JSON. Use null when the text does not say. quote = a short exact quote from the text, max 25 words. Never guess.' },
    { role: 'user', content: `${HELP}\n\n${who}\n\n---\n${text}\n---` }],
  response_format: { type: 'json_schema', json_schema: { name: 'deal_terms', strict: true, schema } } });
return $input.all().map((item, idx) => {
  const src = $('Find the contract').all()[idx].json;
  const contract = String(item.json.text || '').trim();
  const e = focus(src.emailText), c = focus(contract);
  return { json: { ...src, contractRead: contract.length > 200, emailCut: e.cut, contractCut: c.cut,
    llmEmail: ask('These are the emails between the creator and the brand. Use the LATEST terms both sides agreed to. Ignore quoted older versions that were changed later.', e.text),
    llmContract: ask('This is the contract.', c.text) } };
});
