// Turns the comparison into a plain email for Graham. Flags only, never legal advice.
const parse = r => { try { const t = r.choices[0].message.content; return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { return null; } };
const prev = $('Compare terms').all().map(i => i.json);
const q = f => (f && f.quote ? `"${String(f.quote).trim()}"` : (f ? String(f.value) : ''));
return $input.all().map((item, idx) => {
  const p = prev[idx];
  const verdicts = {};
  ((parse(item.json) || {}).results || []).forEach(r => verdicts[r.id] = r);
  const issues = [], ok = [], missing = [];
  for (const r of p.rows) {
    let res = r.result;
    if (res === 'check') res = verdicts[r.field] ? (verdicts[r.field].verdict === 'same' ? 'match' : 'mismatch') : 'unsure';
    if (res === 'mismatch' || res === 'unsure') issues.push(`- ${r.label}${res === 'unsure' ? ' (check by eye)' : ''}\n  Emails: ${q(r.email)}\n  Contract: ${q(r.contract)}${verdicts[r.field] ? `\n  Why: ${verdicts[r.field].reason}` : ''}`);
    else if (res === 'missing') missing.push(`- ${r.label}: agreed in email (${q(r.email)}) but not in the contract`);
    else if (res === 'match') ok.push(r.label);
  }
  const lines = [];
  if (!p.contractFile) lines.push('No PDF contract was attached, so only the emails were read. Forward the thread again with the contract PDF attached.', '');
  else if (!p.contractRead) lines.push(`Couldn't read text from ${p.contractFile}. If it's a scan, ask the brand for a text PDF.`, '');
  if (!p.aiOk) lines.push('The local AI (LM Studio) did not answer, so this check is incomplete. Make sure LM Studio is running, then forward the thread again.', '');
  lines.push(issues.length ? `DIFFERENT FROM WHAT YOU AGREED (${issues.length})` : 'Nothing in the contract contradicts the emails.', ...issues, '');
  if (missing.length) lines.push(`AGREED BUT MISSING FROM THE CONTRACT (${missing.length})`, ...missing, '');
  if (p.flags.length) lines.push(`WORTH A SECOND LOOK (${p.flags.length})`, ...p.flags.map(([t, f]) => `- ${t}${f ? `\n  Contract: ${q(f)}` : ''}`), '');
  if (ok.length) lines.push(`MATCHES: ${ok.join(', ')}`, '');
  if (p.emailCut || p.contractCut) lines.push('Long document: only the parts about money, rights, deliverables and dates were checked.', '');
  lines.push('This is an automatic check that flags differences to ask about. It is not legal advice. For anything big, have a lawyer read the contract.');
  const n = issues.length + missing.length;
  return { json: { subject: `Contract check: ${n ? n + ' to fix' : 'no differences'}${p.flags.length ? `, ${p.flags.length} to review` : ''} | ${p.subject}`.slice(0, 180), text: lines.join('\n') } };
});
