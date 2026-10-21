// One Approvals row from the command line, for builders a person or Claude runs by hand (brand kit rounds, kits, launches).
//   node loops/tools/approval.js --id ngm-kit-r1 --client ngm --kind pick_one --title "Pick a logo direction" \
//     --detail "Three directions from the kickoff call." --options "Direction A|Direction B|Direction C" --preview https://... --due 2026-10-28 --made_by brand-kit
// On the Mac (hub + hubKey in reels/config.json) it goes straight to the Hub, which checks it.
// Anywhere else it prints the row in column order, already checked, to append to the Hub Sheet's Approvals tab
// (Google Sheets append_values, range Approvals!A:O). Format: Open-Frame docs/approval-items.md. Map: loops/APPROVALS.md.
const L = require('../lib');

const HEAD = ['id', 'client', 'kind', 'title', 'detail', 'job', 'preview', 'options', 'due', 'client_ok', 'made_by', 'status', 'answer', 'comment', 'updated'];
const KINDS = ['post', 'reel', 'newsletter', 'report', 'pick_one', 'design', 'set', 'launch', 'files', 'brand_deal', 'reply', 'repost', 'ad_spend', 'request', 'hours', 'quote', 'invoice'];
const ALWAYS = ['brand_deal', 'ad_spend', 'repost', 'quote'];

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'yes';
  return o;
}

// Same rules the Hub applies (hub/Code.gs approvalRow_), for when the row can't go through the Hub.
function row(o) {
  if (!KINDS.includes(o.kind)) throw new Error(`Unknown kind "${o.kind}". Use one of: ${KINDS.join(', ')}. Ask for a new kind instead of inventing one.`);
  if (!o.id || !o.title || !o.client) throw new Error('--id, --client and --title are required');
  const ok = ALWAYS.includes(o.kind) ? 'yes' : /^(y|yes|true)$/i.test(o.client_ok || '') ? 'yes' : 'no';
  if (o.due && !/^\d{4}-\d{2}-\d{2}$/.test(o.due)) throw new Error('--due is YYYY-MM-DD');
  if (/[—–]/.test(o.title + (o.detail || ''))) throw new Error('No em dashes in title or detail (clients see them as written)');
  return { id: o.id, client: o.client, kind: o.kind, title: o.title, detail: o.detail || '', job: o.job || 'none', preview: o.preview || '',
    options: o.kind === 'pick_one' ? String(o.options || '').split('|').map(s => s.trim()).filter(Boolean).join(' | ') : '',
    due: o.due || '', client_ok: ok, made_by: o.made_by || 'graham', status: o.status === 'client' && ok === 'yes' ? 'client' : 'draft', answer: '', comment: '', updated: '' };
}

async function main() {
  const r = row(args(process.argv.slice(2)));
  if (L.C.hub && L.C.hubKey) { console.log(JSON.stringify(await L.approval(r))); return; }
  console.log(JSON.stringify([HEAD.map(h => r[h])]));
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { row, HEAD };
