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

## Health alerts
The n8n health-check workflow (/mnt/project-files/automation/health/) writes a `Health` tab hourly. Problems from its latest run show as Heads up cards (with a "Fix it here" link), and `healthCheck` (hourly trigger) emails rows marked `email = yes` once per problem. If n8n hasn't checked in for 3 hours you get a card; after 20 hours, one email. No Health tab = nothing happens.

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
Paste the new `Code.gs`, then Deploy > Manage deployments > edit > Version: New version. The links stay the same.

## Check-in timing
At the top of `Code.gs`:
- `CHECKIN_EVERY_WEEKS = 1` for weekly, `2` for every 2 weeks
- `CHECKIN_DAY = 'MONDAY'`, `CHECKIN_HOUR = 9`
After changing them, run `setup` again. A weekly check-in needs posts queued at least a week ahead (two weeks for every 2 weeks).

## Loops (thread "Self-running agent loops")

- `doPost` fn `loops`: `list` / `add` / `set` cards in the `Loops` tab, `log` a row in `Loop runs`, `stats` = a client's best and weakest posts from `Post stats` (same score as the report).
- Cards: status `card` = Yes / Change / Pass, `todo` = Got it. Answers set `yes` / `change` / `pass` / `done`; the loop then marks it used (`scripted`).
- Callers: social-assets `loops/` (runner.js on the Mac).
