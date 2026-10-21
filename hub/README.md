# Hub: weekly check-in, client review pages

Free. Runs in Google Apps Script inside the "NGM social queue" Sheet. Reads and writes the same tabs n8n uses, so nothing else changes.

- **Your check-in page**: one card at a time. Yes, Change, or a small Skip. Covers topic ideas, posts, DMs, outreach comments, guild photos and anything broken. Ends with "All done".
- **Client review page**: `https://openframe.design/review/#xxxx-xxxx-xxxx-xxxx` on Graham's site (source: `review/index.html` in grahamivyco/Open-Frame), no password, no Google bar. Each client contact gets a branded "posts ready for review" email with one button. That link is private to their address, stops working after 14 days or when a newer one is sent, and every approval is logged under their email (`answered_by`). An expired link shows "Email me a new link", which only sends to the address on file. Links live in the `Review links` tab. One post at a time: Looks good, Change something (with a note) or Skip. Below that, one line of results ("October so far: reached 2,140 people, up 78%") with See more for the tiles, top posts and PDF.
- **Check-in email**: every Monday 9:00 Central (or every 2 weeks) with how many things need you and one link. Between check-ins you only get an email for things that can't wait: a failed post, posting that stopped, a new DM (Meta closes replies after 24 hours). Clients asking for a change also email you right away. At each check-in, clients with posts waiting get their review email automatically (at most once every 6 days; `AUTO_SEND_CLIENTS`).

## Setup (once, about 5 minutes)
1. Open https://script.google.com/home and start a new project (or open the Sheet and use Extensions > Apps Script)
2. Delete what's in `Code.gs`, paste all of `Code.gs` from this folder, save
3. Pick `setup` in the function menu, Run, allow access
4. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy
5. Paste the Web app URL (ends in /exec) into `WEB_APP_URL` at the top of Code.gs and into `API` in Open-Frame `review/index.html`. Save, then Deploy > Manage deployments > edit > Version: New version.
6. Pick `emailMeMyLinks`, Run. Your check-in link arrives by email. Client links are only ever sent to the client

## Leads
Cards from the `Leads` tab of the outreach Sheet (n8n "Open Frame lead follow-up"): follow-up emails (Send / Change / Don't send; n8n sends within 15 minutes), DMs (Copy and open the Meta inbox), to-dos, "Did you meet them?" and "Did they say yes?". The check-in email and page footer show a pipeline line. `LEADS_URGENT = true` adds lead cards to the daily 8:00 can't-wait email. Details: /mnt/project-files/business-ops/lead-followup/README.md

## Email
`triageMail` (every 10 minutes, set by `setup`) works the `Mail` tab the n8n inbox sorter fills: Gmail labels under Open Frame/, AI reply drafts in Gmail, new leads into the Leads tab, opt-outs close the lead. Lead and client emails needing a reply are cards (Send / Change / Don't reply, or Open in Gmail). Details: /mnt/project-files/business-ops/inbox-sorter/README.md

## Health alerts
The n8n health-check workflow (/mnt/project-files/automation/health/) writes a `Health` tab hourly. Problems from its latest run show as Heads up cards (with a "Fix it here" link), and `healthCheck` (hourly trigger) emails rows marked `email = yes` once per problem. If n8n hasn't checked in for 3 hours you get a card; after 20 hours, one email. No Health tab = nothing happens.

## Studio: sign in from openframe.design
`https://openframe.design/studio/` (source: `studio/index.html` in grahamivyco/Open-Frame) is the same check-in, behind a sign-in, on any device.
- Sign in: type your email, get a 6-digit code (or tap the button in that email). No password, nothing to set up. Each device stays signed in 30 days, renewed while you use it.
- Who gets in: the Google account that owns this script, anyone in `STUDIO_ADMINS` (top of the Studio section in `Code.gs`, or a `STUDIO_ADMINS` Script Property, comma separated), and every `contact_email` in the Clients tab. Clients only see their own review cards and results.
- Admins see two tabs: **Needs you** (the same cards as the check-in page, same code) and **Results** (each client's month so far, what every loop made in the last 7 days, what you said yes to).
- The page never holds the admin key. It sends its session to the Hub, which checks it and adds the key itself.
- Sign a device out: delete its row in the `Studio sessions` tab (only a hash of each session is stored). Remove a client's address from `contact_email` and they're out on their next tap.
- The card code is served by the Hub (`?api=studio_js`), so new card types show up in the Studio after you deploy a new version. Nothing to change on the site.
- Selling the system: a new owner deploys their own copy and changes `STUDIO_URL` and the site page's `API`. The owner becomes the admin automatically.

## Studio: Reels and Status tabs
- **Reels** (`studioReels`): Reel drafts waiting for a yes (Queue rows, type `reel`, status draft / in_review / changes) with the video, Post it / Change / Don't post. Below, scripts to film by type: Open Frame, Personal, Viral in my niche (`Loops` rows, loop `scripts`, kind `of` | `personal` | `viral`, status `ready`). Filmed it = done, Change = the Mac rewrites it with your note (`loops/asks.js`), Pass. "Write 3 new scripts" adds a `reel-ask` row (`adminReelAsk`); the Mac's local AI answers in a few minutes and the page refreshes itself.
- **Status** (`studioStatus`): the Mac keeper's checks (`Mac status` tab, written every 2 minutes by `mac/keeper.js` through `fn: 'loops', action: 'mac'`) and the n8n health rows. Something still failing after `MAC_FAIL_MIN` (10) minutes = Heads up card + one email. No word from the Mac for `MAC_STALE_MIN` (15) = shown as off or asleep.
- **Sign in with Google**: `GOOGLE_CLIENT_ID` (OAuth Web client, origin https://openframe.design). The page asks the Hub for it (`op: 'config'`) and shows Google's button; the Hub checks the token with Google (`tokeninfo`) and starts the same 30-day session as a code. While the Google app is in Testing, only its test users can use the button; everyone else uses the code.
- Health also now shows problems tools write on their own between hourly runs (e.g. `reel-drafts` from the Mac) for 2 days.

## Clients tab
`client | brand | sheet_id | contact_email | client_approves | report_url` (an old `token` column is ignored)
- `brand` matches the brand column in Queue
- `client_approves`: yes = posts go to the client's review page, no = you approve (Open Frame)
- `contact_email`: who gets review links. Several addresses are fine, separated by commas; each gets their own link
- New client: add a row. A client with their own Sheet: put its id in `sheet_id`
- `report_url`: optional link to the latest monthly report PDF, shown under Results
- To cut someone off, remove their address from `contact_email`; their links stop working right away

## Statuses (Queue)
Follows the shared schema: /mnt/project-files/automation/queue-schema.md
- Graham: draft > in_review (or approved when client_approves = no). "Fixed, send back" bumps revision.
- Dashboard: plan rows (topics) for clients you approve show under "Topics to approve"; Approve/Change/Skip writes client_decision only, status stays plan.
- Client page: in_review > approved / changes / skipped, writes client_decision (Approve, Request change, Skip), client_note, answered_by, decided_at. Plan rows (status plan) only get client_decision; the monthly loop acts on it.
- Extra column only the hub uses: review_note (Graham's own change note).

## Updating the code
Once the Mac keeper is signed in to clasp (`mac/install.sh`), a merged change to `hub/Code.gs` deploys itself within 10 minutes. Without it: paste the new `Code.gs`, then Deploy > Manage deployments > edit > Version: New version. The links stay the same.
Before pasting, `node hub/check-pages.js hub/Code.gs` checks the page scripts (a broken one leaves the check-in page stuck on "Loading...").

## Check-in timing
At the top of `Code.gs`:
- `CHECKIN_EVERY_WEEKS = 1` for weekly, `2` for every 2 weeks
- `CHECKIN_DAY = 'MONDAY'`, `CHECKIN_HOUR = 9`
After changing them, run `setup` again. A weekly check-in needs posts queued at least a week ahead (two weeks for every 2 weeks).

## Loops (thread "Self-running agent loops")

- `doPost` fn `loops`: `list` / `add` / `set` cards in the `Loops` tab, `log` a row in `Loop runs`, `stats` = a client's best and weakest posts from `Post stats` (same score as the report).
- Cards: status `card` = Yes / Change / Pass, `todo` = Got it. Answers set `yes` / `change` / `pass` / `done`; the loop then marks it used (`scripted`).
- Callers: social-assets `loops/` (runner.js on the Mac).
- Key accounts + deals (2026-10-21): `engage-list` puts Targets handles first and flags them `key`. `key-accounts` returns Targets with their last 3 Engage captions plus Inbox touches from the last 8 days. `brands-list` / `brand-set` read and update the Brands tab (outreach Sheet; columns like `pitched_at`, `pitch_kind`, `followed_up` are added on first write).
- Reels posted from the phone (2026-10-21): an approved IG Reel for a client with `reel_music` = `app` (Clients tab column; blank = app for open-frame, auto for others) moves to status `phone` instead of going to the n8n poster, and a "Post from your phone" card (loop `phone`) shows the video, caption and the audio loop's top sounds. Got it marks the Queue row `posted`. Queue column `music` = `none` lets one Reel auto-post. Runs on approval and every 10 minutes (inside the `triageMail` trigger). The Facebook copy still auto-posts.
