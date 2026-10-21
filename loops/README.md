# Loops

The marketing system grows through loops instead of prompts. Every loop follows one contract:

1. **Trigger**: a schedule or an event, never a person typing.
2. **Work**: the free local AI (LM Studio on the Mac) or a script does it.
3. **Self-check**: rule checks (banned words, em dashes, length, links, past passes) plus a second local-AI pass that scores it. One retry with the reasons. Still failing = dropped and logged, never shown.
4. **Card**: only when a person has to decide. One Yes / Change / Pass card in the Hub (`Loops` tab).
5. **Feeds**: the answer becomes the next loop's input.

Two layers:

- **Runtime loops** on Graham's Mac: n8n workflows, pm2 processes, LM Studio. No paid APIs, no Claude inside.
- **Improvement loops**: Claude scheduled tasks in the Marketing project. Weekly review reads `state/runs.jsonl`, the Hub `Loops` / `Loop runs` tabs and post stats, writes `state/lessons.md` and fixes `prompts/` and the rules in `lib.js` by PR.

`loops.json` lists every loop in the system (including the n8n ones) so the map and the weekly review see the whole chain.

## The first chain

```
stats (n8n daily) + viral scout -> pattern report (Mon 12:00)
  -> ideas.js (Mon 13:00): 8 ideas per client -> self-check -> best 5 as Hub cards
  -> you tap Yes -> scripts.js (every 5 min): script + caption -> self-check -> "Film this" card + Scripts/ folder
  -> you film + AirDrop -> reel-watch -> Reel draft card -> poster -> stats -> next Monday's ideas
approved ideas -> state/<client>/backlog.md -> monthly content plan (10th)
Sunday: weekly review -> lessons + prompt fixes -> next run
```

## Files

| File | What |
|---|---|
| `clients.json` | One block per brand. `enabled: true` = every loop runs for it. New client = copy a block. |
| `loops.json` | Registry of every loop: trigger, work, check, card, feeds, status. `run` + `schedule`/`every` = runner.js runs it. |
| `runner.js` | `daemon` (pm2), or run one loop now. |
| `lib.js` | Local AI, Hub API, self-check rules, run log, git sync of `state/`. |
| `ideas.js`, `scripts.js`, `audio.js` | Weekly ideas, scripts from each Yes, trending sounds picked for each script. |
| `asks.js` | Scripts on demand: the "Write 3 new scripts" button on the Studio Reels tab (Open Frame, Personal, Viral in my niche) and rewrites after Change. Every 2 min. Scripts show as cards on the Reels tab, not in Needs you. |
| `engage.js`, `leads.js` | Daily comment drafts (learns from your edits), weekly pipeline that tunes how many. |
| `site.js`, `magnet.js` | Monthly site + ChatGPT check; the free check form (`../check/`) runs a check, emails it, adds a lead. |
| `proposal.js`, `onboard.js` | Proposal page + email after a consult (rate card prices only); day 0-90 onboarding cards after a yes. |
| `grow.js` | Directories (3rd), local events (Mon, Yes adds to calendar), Google Business post (Thu), template saver (Fri). |
| `key.js` | Key accounts: `key-radar` (weekdays 12:00, DM draft when a Targets account engages) and `spotlight` (Wed 10:00, one mission-driven org a week, asks their OK first). Measures key accounts reached, not followers. |
| `deals.js` | Brand + UGC deals (weekdays 10:30): Brands tab rows -> pitch with 3 video ideas linking the UGC page (social-assets `ugc/`), email or Apply card, one follow-up after 7 days. No prices in writing. |
| `later.js` | Built but `off` until there's data: proof posts, warm-up DMs, client health, trend Reels. |
| `data/directories.json`, `tools/audit.js` | Free listings list; copy of the SEO thread's site check. |
| `prompts/*.md` | What the local AI is told. The weekly review edits these. |
| `state/` | Run log, lessons, approved-idea backlog and scripts per client. Pushed by the Mac. |

## Mac setup (once)

1. In the Hub Apps Script, paste the new `hub/Code.gs` and deploy a new version (adds the `Loops`, `Loop runs` and `Check requests` tabs, email and calendar cards). Google asks once to allow Calendar and sending email.
2. `reels/config.json` already has `hub`, `hubKey` and `model`; the loops reuse them. Optional `loops/config.json` overrides anything in `lib.js` `C`.
3. LM Studio running with the model loaded (same as reel-watch).
4. Start it:

```
cd ~/social-assets && git pull && pm2 start loops/runner.js --name loops -- daemon && pm2 save
```

Run one now: `node loops/runner.js ideas open-frame` (any name in `MODS`).

Free check form: https://grahamivyco.github.io/social-assets/check/ (link it from openframe.design and the IG links page). Reports and proposals are published under unguessable links in `checks/` and `proposals/`.

## Adding a loop

1. Write `loops/<name>.js` exporting a function. Use `L.ask`, `L.rules` + `L.judge`, `L.hub('add', ...)`, `L.logRun(...)`.
2. Add it to `MODS` in `runner.js` and to `loops.json` with `run` and `schedule` ("mon 13:00", "daily 08:00") or `every` (minutes).
3. Cards: `kind` and `ask` decide the wording; `status: 'todo'` makes a Got it card instead of Yes / Change / Pass.
