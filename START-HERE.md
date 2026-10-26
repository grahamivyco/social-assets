# Start here

Ben, thanks for looking at this. Over the last week I've built a lot of systems for Open Frame with Claude's help. I'd like a second set of eyes before I lean on them, and your honest read on whether this is helping me get clients or getting in the way.

## What I'd like from you, Ben

- **Check the logic.** Does each loop actually do what it says, and does the overall design make sense for a one-person studio?
- **Flag flaws.** Anything fragile, overbuilt, wrong or risky. Security too (I'll send you the security inventory directly, it isn't in this public repo).
- **Suggest improvements.** Simpler ways to do the same thing are welcome.
- **Pressure-test the plan.** Does the client pipeline and the $4k/month goal hold up? Am I spending time on the right things to land clients, and alongside that, a job?

Questions I'm stuck on are at the end: [Questions for Ben](#questions-for-ben).

## Where things honestly stand (2026-10-26)

- **Clients:** no paying clients yet. Open Frame and the Needlework Guild of Minnesota are my own test brands. Last week's pipeline loop counted 4 leads, 0 consults, 0 wins, 0 outreach comments sent.
- **Live and working:** posting to IG + FB, the Hub and Studio, the Mac keeper, the hourly health check, comment replies (polling), the DM bot for test accounts, analytics pulls, the inbox sorter, the brand scout, the video watch tool.
- **Built but not proven:** most of the newer loops (ideas, engage, proposals, onboarding, site check, deals) have barely run. Nobody has answered a Yes/Pass on a loop card yet, so there's no taste data to learn from.
- **Not working well yet:**
  - The automatic Reel drafts. I rejected all 4 as looking bad. The hand-edited v2s are better, but the automatic path isn't there.
  - Loops failed quietly for days. Runs stopped after Oct 22 and nobody noticed, because failures only went to a log. They now show up in the Loop runs tab, which showed Hub network blips and LM Studio timeouts (fixed with retries in #88 and #89). Today's runs still show failures: ideas, audio, reel-ask, site-collect, magnet, proposal, events.
  - DM replies to real customers wait on Meta (Live mode test or App Review). See [docs/meta-app.md](docs/meta-app.md).
  - Everything depends on my Mac being awake.

## The docs

| Doc | What's in it |
|---|---|
| This page | Goals, big picture, Mac setup, every loop and workflow, the site, history, questions |
| [docs/meta-app.md](docs/meta-app.md) | The Meta app: accounts, permissions, webhooks, DM bot, comment replies, posting, meta-mcp, App Review status, what's blocked |
| [docs/tech-stack.md](docs/tech-stack.md) | Every tool, library, API and service, with versions and why it was picked |
| [docs/video-system.md](docs/video-system.md) | The Reel editor, AirDrop pipeline, graphics, research tools, Claude skills and the rules I've refined |
| Security inventory (private, from me) | Every credential by name and location, exposure, ranked risks |

Two repos make up the code:

- **grahamivyco/social-assets** (this repo): automations, loops, n8n workflows, the Hub back end, the Reel editor, and public media served by GitHub Pages.
- **[grahamivyco/Open-Frame](https://github.com/grahamivyco/Open-Frame)**: the website https://openframe.design and Studio (the signed-in dashboard). Read its [CONTEXT.md](https://github.com/grahamivyco/Open-Frame/blob/main/CONTEXT.md) and [docs/design-rules.md](https://github.com/grahamivyco/Open-Frame/blob/main/docs/design-rules.md) first.

Both repos are **public**. My Google Sheets, the Hub and n8n on my Mac aren't in the repos; I can share those separately.

## 1. The goals

- **Open Frame** is Graham's design and marketing studio for mission-driven organizations (Minneapolis and Barcelona, US hours).
- **Revenue goal**: $4,000/month by 2027-04-20. Plan mix: 1 Growth + 1 Starter + 1 Care retainer. Prices are on https://openframe.design/pricing.
- **Product goal**: package the whole system (loops, n8n workflows, Hub, Studio, Reel editor) so it can be sold to other studios. So everything should be per-client config, documented, and free of secrets in code.
- **House rules**:
  - Free tools only. No paid APIs (no paid AI APIs in the system). AI work runs on a local model in LM Studio on Graham's Mac.
  - Anything that needs a yes from Graham or a client becomes one card. Graham answers cards, he doesn't edit spreadsheets.
  - Graham's own brands are the test clients: Open Frame, and Needlework Guild of Minnesota (NGM).

## 2. The big picture

```
 triggers (schedule, AirDrop, form, comment, email)
        |
        v
 work on Graham's Mac  ----> n8n (localhost:5678)  +  loops runner (pm2)  +  LM Studio (local AI)
        |
        v
 self-check (rules + local AI judge; bad output is dropped and logged)
        |
        v
 Google Sheets (data)  ---->  Hub (Apps Script web app)  ---->  Studio page + emails (cards for Graham / clients)
        |
        v
 publish (Meta Graph API for IG + FB) / GitHub Pages (media, reports, pages)
```

- **Mac**: everything that runs on a schedule runs on Graham's Mac. Nothing runs in a cloud server.
- **Google Sheets**: the database.
  - "NGM social queue": the main Sheet. Tabs Queue (every post), Clients, Approvals, Health, Mac status, Loops, Loop runs, Account stats, Post stats, Studio sessions, Review links, Graphics, Mail and more.
  - "Open Frame outreach": prospects and sales. Tabs Targets, Leads, Inbox, Subscribers, Engage, Creators, Brands, Viral creators, Outliers.
- **Hub**: a Google Apps Script web app bound to "NGM social queue". Source: [hub/Code.gs](hub/Code.gs). It turns Sheet rows into cards and emails, and it's the API that Studio, the loops and n8n call.
- **Studio**: https://openframe.design/studio/ (code in Open-Frame `studio/`). Graham's one screen: Home (approval queue), Clients, Analytics, Loops, Reels, Status. Clients sign in and see only their own items.

## 3. The Mac setup

All of this is installed by one script, [mac/install.sh](mac/install.sh). Details in [mac/README.md](mac/README.md).

| Piece | What it is | Notes |
|---|---|---|
| **pm2** | Keeps Node/Python apps running | Apps listed in [mac/apps.json](mac/apps.json): n8n, reel-watch, loops, video-watch, viral-patterns, ngrok |
| **keeper** | pm2 app `keeper` ([mac/keeper.js](mac/keeper.js)) every 2 min, plus a login agent ([mac/boot.sh](mac/boot.sh)) | Restarts stopped apps, starts LM Studio and loads the model, `git pull` every 10 min, deploys `hub/Code.gs` with clasp when it changes, re-imports n8n flows listed in [mac/n8n-flows.json](mac/n8n-flows.json). Writes to the Hub "Mac status" tab, shown in Studio Status |
| **n8n** | Workflow tool, self-hosted at http://localhost:5678 | Posting, DMs, comment replies, scouts, health check. Workflows are in [n8n/](n8n/) and other folders (map below) |
| **LM Studio** | Local AI server at http://127.0.0.1:1234 (OpenAI-compatible) | Model `qwen/qwen3.5-9b` since 2026-10-23 (was `google/gemma-4-e4b`). Free, offline |
| **ngrok** | Gives n8n a public https address | Used for Meta webhooks (DMs) and the iPhone "Watch with Claude" shortcut. Address is in [mac/README.md](mac/README.md) |
| **Git on the Mac** | Clone of this repo at `~/social-assets` | The loops push their state files (`loops/state/`) back to this public repo |

Gotchas worth knowing:
- The Mac clock is Barcelona time, so loop schedules are Barcelona time.
- Run Python tools with Python 3.13 (`/Library/Frameworks/Python.framework/Versions/3.13/bin/python3`); Homebrew's newer `python3` lacks the packages.
- Anything saved under `~/Downloads/Open Frame` gets swept by Graham's Downloads sorter. Outputs go to `~/Downloads/Open Frame LLC & Clients/`.

## 4. Every loop and workflow

The full registry is [loops/loops.json](loops/loops.json) (Studio's Loops page and the weekly review read it). The loop contract: trigger, then local AI work, then a self-check, then a card only when a human is needed, then the result feeds the next loop. Details in [loops/README.md](loops/README.md).

### Content

| Loop | Runs on | Trigger | What it does | Lands in |
|---|---|---|---|---|
| Stats pull | n8n "Social analytics" ([n8n/social-analytics.json](n8n/social-analytics.json)) | daily 06:00 | IG + FB account and post insights | Sheet tabs Account stats, Post stats |
| Viral scout | n8n "Open Frame viral scout" ([watch/scout/](watch/scout/)) + pm2 video-watch | Mon 07:30 | Finds posts that beat a creator's normal by 3x, watches each | Outliers tab, `~/Downloads/Open Frame LLC & Clients/Watched/` |
| Pattern report | pm2 viral-patterns ([watch/patterns.py](watch/patterns.py)) | Mon 12:00 | What the outliers share, hook bank | Watched/_patterns/ |
| Trending sounds | loops/audio.js | Mon 12:30 | Sounds from the outliers, one per script | Scripts and cards |
| Weekly ideas | loops/ideas.js | Mon 13:00 | 8 ideas per client from own stats + patterns + past yes/pass | Loops cards (Studio) |
| Scripts | loops/scripts.js, loops/asks.js | each idea Graham says yes to, or the "new scripts" button | One-take talking head script + caption | Studio Reels tab |
| Reel drafts | pm2 reel-watch ([reels/](reels/)) + n8n "Reel drafts" | Graham AirDrops a video to the Mac | Transcribe, edit, captions, cover, caption text, Queue rows | Queue tab, Studio Reels tab, media on GitHub Pages |
| Graphics ideas | pm2 graphics-loop ([reels/graphics/](reels/graphics/)) | after each transcript | Pitches a graphic, 3 stills, animates the pick | Graphics tab cards |
| Photo submissions | n8n "Content submissions" ([n8n/content-submissions.json](n8n/content-submissions.json)) | emails to the submissions address | Member photos become post drafts | Photo submissions tab cards |
| Monthly plan | Claude scheduled task | 10th and 18th | Plans and makes next month's posts | Queue rows for approval |
| Poster | n8n social poster ([n8n/social-poster.json](n8n/social-poster.json)) | every 15 min | Posts approved, due Queue rows to IG + FB (reels, photos, carousels) | Instagram, Facebook |
| Newsletter | n8n newsletter ([newsletter/](newsletter/)) | monthly | Client newsletter via Brevo | **Paused** |

### Replies and sales

| Loop | Runs on | Trigger | What it does | Lands in |
|---|---|---|---|---|
| Comment replies | n8n ([n8n/comment-replies.json](n8n/comment-replies.json)) | every 2 min | Hides spam, auto-replies to praise, questions become cards | IG/FB comments, Inbox tab, Hub cards |
| DM inbox | n8n ([n8n/dm-inbox.json](n8n/dm-inbox.json)) | Meta webhook through ngrok | Local AI drafts DM replies in Open Frame's voice, flags pricing/upset/scam | Messenger/IG DMs, Inbox tab |
| Outreach scout | n8n ([n8n/outreach-scout.json](n8n/outreach-scout.json)) | weekdays | Finds prospect posts | Targets + Engage tabs |
| Engagement | loops/engage.js | weekdays 07:20 | Drafts comments on prospect posts, learns from Graham's edits | Engage cards |
| Pipeline | loops/leads.js + n8n lead follow-up ([n8n/lead-followup.json](n8n/lead-followup.json)) | Mon 08:00, hourly | Funnel vs the $4k plan; follow-up emails after Graham approves | Leads tab, Hub cards, Gmail |
| Inbox sorter | n8n ([n8n/inbox-sorter.json](n8n/inbox-sorter.json)) | new Gmail | Labels mail, drafts replies (never sends alone) | Gmail labels and drafts, Mail tab |
| Free site check | loops/magnet.js + [check/](check/) form | someone fills in the form | Runs a site audit, publishes the report, emails it | Leads tab, report page |
| Proposals | loops/proposal.js | lead reaches "consult held" | Proposal page with rate card prices | Approvals (quote) |
| Onboarding | loops/onboard.js | lead marked won | Adds the client everywhere, day 0 to 90 steps | Clients tab, cards |
| Brand deals | n8n brand scout + contacts ([n8n/](n8n/)) + loops/deals.js | Mon 06:00 / 07:00, weekdays | Finds brands that pay similar creators, contacts, drafts pitches | Brands tab, cards |
| Contract check | n8n ([n8n/contract-check.json](n8n/contract-check.json)) | email to the contract address | Compares what the emails agreed with the contract | Email report ("not legal advice") |
| Key accounts | loops/key.js | weekdays, Wed | Follow-up DM drafts and a weekly spotlight | Cards |

### Growth and housekeeping

| Loop | Runs on | Trigger | What it does | Lands in |
|---|---|---|---|---|
| Site + AI search | loops/site.js | 1st of month, hourly collect | Site audit vs last month, ChatGPT prompt checks | Cards, `loops/state/` |
| Directories, events, Google Business, templates | loops/grow.js | 3rd, Mon, Thu, Fri | Free listings, local events, GBP posts, template candidates | Cards |
| Boost check | loops/boost.js | 2nd 10:00 | Finds a post worth boosting | Approvals (ad_spend) |
| Monthly report | Claude scheduled task | 2nd | Branded PDF report per client | Clients report_url, learnings file |
| Approvals sync | Hub | hourly | Mirrors Queue decisions into the Approvals tab for Studio | Approvals tab |
| Health check | n8n ([n8n/health-check.json](n8n/health-check.json)) + Hub | hourly | Workflow failures, Meta token expiry, Mac heartbeat | Health tab, Studio Status, emails |
| Mac keeper | mac/keeper.js | every 2 min | Keeps everything up (section 3) | Mac status tab |
| Weekly review | Claude scheduled task | Sunday | Reads Loop runs, fixes prompts, writes lessons | `loops/state/lessons.md`, PRs |
| Not on yet | loops/later.js | | proof posts, warm-up DMs, client health, trend Reels | Waiting for data |

How approvals work: [loops/APPROVALS.md](loops/APPROVALS.md) and Open-Frame [docs/approval-items.md](https://github.com/grahamivyco/Open-Frame/blob/main/docs/approval-items.md).

## 5. The website and Studio

- **Site**: https://openframe.design, GitHub Pages from the Open-Frame repo. `index.html` is the whole main site. Merging to `main` deploys in 1 to 2 minutes.
- **Standalone pages**: `studio/` (dashboard), `review/` (client review links), `links/` (bio link page), `privacy/`, `terms/`, `preview/`.
- **Studio sign-in**: invite only. Email + 6-digit code, or Sign in with Google. Sessions last 30 days, stored hashed in the Studio sessions tab.
- **Client review links**: https://openframe.design/review/#… private per-email links, expire after 14 days.
- **Analytics**: GA4, loads only after the visitor taps Allow.
- **Pages on this repo's GitHub Pages** (https://grahamivyco.github.io/social-assets/): free check form (`check/`), UGC page (`ugc/`), privacy page for the Meta app, Reel media, check reports and proposal pages.

## 6. History (short)

Most of the system was built between 2026-10-20 and 2026-10-26, one Claude project thread per system.

- 10-20: posting automation (n8n + Meta Graph API), Hub dashboard and client review pages, health check, analytics + monthly report, DM auto-replies (Meta Business Verification approved 10-21), lead follow-up, brand scout, Reel drafts pipeline, newsletter (paused 10-21).
- 10-21: loop engine (loops/), comment replies live, video watch tool + viral scout, Studio live on openframe.design, Mac keeper, Approvals tab, NGM as first Studio client (posting by hand until the guild's own accounts are connected), SEO + AI search fixes, services and pricing pages.
- 10-22 to 10-26: Reel editor improvements, loop failure logging and retries (#88, #89).

## 7. Where to look first

1. The security inventory (private, from Graham) and [docs/tech-stack.md](docs/tech-stack.md).
2. [hub/Code.gs](hub/Code.gs): the API everything calls (`doGet`, `doPost`, `checkKey_`).
3. [loops/lib.js](loops/lib.js) and [loops/runner.js](loops/runner.js): how loops run, call the Hub and push state.
4. [mac/install.sh](mac/install.sh) and [mac/keeper.js](mac/keeper.js): what runs on the Mac and with what access.
5. [n8n/](n8n/): workflow exports. Credentials are referenced by name only; the values live inside n8n on the Mac.

Some setup notes and source files (builders, READMEs) live in Graham's Claude project files, not in a repo. Ask Graham if you need one.

## Questions for Ben

1. **Funnel math.** The plan guesses about 20 outreach messages a week turn into 3 conversations and 1 consult. Last week's count was 0 comments sent. Is that funnel realistic for mission-driven orgs, and what would you change about how I find them?
2. **Pricing.** Care $400, Starter $1,400, Growth $2,500, Full $3,800 a month, setup $950, a founding Growth rate of $1,800 for the first 3 clients ([pricing](https://openframe.design/pricing)). Too high, too low, too many tiers for someone with no retainer clients yet?
3. **Overbuilt?** There are about 38 loops and workflows for zero paying clients. Which would you cut or pause so I spend that time on sales? Which few would you keep?
4. **Reels.** Is filming talking heads worth my time right now, or should the effort go into direct outreach and case studies?
5. **Security.** Of the risks in the inventory, which would you fix first? Is running everything from my laptop through a public tunnel acceptable for now?
6. **Reliability.** Loops failed quietly for days. Is a laptop-run system a sound base for client work, or should the client-facing parts move somewhere that's always on (still free)?
7. **Selling the system.** Is packaging this as a product a real option, or a distraction from getting clients?
8. **Job search.** I'm also looking for a job. How would you split my week between landing Open Frame clients and applying? Does this work help as a portfolio piece, and how should I present it?
9. **Blind spots.** What am I not seeing?
