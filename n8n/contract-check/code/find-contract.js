// One forwarded email = one deal. Pulls the email text and finds the contract PDF among the attachments.
const strip = h => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
return $input.all().map(item => {
  const j = item.json;
  const bin = item.binary || {};
  const keys = Object.keys(bin);
  const pdfKey = keys.find(k => /pdf/i.test(bin[k].mimeType || '') || /\.pdf$/i.test(bin[k].fileName || '')) || '';
  const other = keys.filter(k => k !== pdfKey).map(k => bin[k].fileName || k);
  return { json: { subject: String(j.subject || '').replace(/^(fwd?|fw):\s*/i, ''), from: j.from || '',
    emailText: String(j.textPlain || j.text || strip(j.textHtml || j.html)).trim(),
    pdfKey: pdfKey || 'none', contractFile: pdfKey ? bin[pdfKey].fileName || 'contract.pdf' : '', otherFiles: other },
    binary: item.binary };
});
