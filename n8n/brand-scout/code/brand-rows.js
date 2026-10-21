// Reads the local AI's answer. If LM Studio is off, the brand is still saved, just without fit and why
const prev = $('Brand profiles').all().map(i => i.json);
const now = new Date().toISOString();
return $input.all().map((item, idx) => {
  const b = { ...prev[idx] };
  let ai = {};
  if (b.handle_check === 'ok') try {
    const txt = item.json.choices[0].message.content;
    ai = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  } catch (e) { ai = {}; }
  const type = b.handle_check !== 'ok' ? 'unknown' : (ai.type || 'brand');
  delete b.llm;
  return { json: { ...b, type, fit: type === 'unknown' ? '' : (ai.fit || ''), why: type === 'unknown' ? 'Check the handle on Instagram' : String(ai.why || '').slice(0, 140), last_checked: now } };
});
