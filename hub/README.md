# Hub: weekly check-in, client review pages

Free. Runs in Google Apps Script inside the "NGM social queue" Sheet. Reads and writes the same tabs n8n uses, so nothing else changes.

- **Your check-in page**: one card at a time. Yes, Change, or a small Skip. Covers topic ideas, posts, DMs, outreach comments, guild photos and anything broken. Ends with "All done".
- **Client review page**: one private link per client, no login. One post at a time: Looks good, Change something (with a note) or Skip. Below that, one line of results ("October so far: reached 2,140 people, up 78%") with See more for the tiles, top posts and PDF.
- **Check-in email**: every Monday 9:00 Central (or every 2 weeks) with how many things need you and one link. Between check-ins you only get an email for things that can't wait: a failed post, posting that stopped, a new DM (Meta closes replies after 24 hours). Clients asking for a change also email you right away.

## Setup (once, about 5 minutes)
1. Open https://script.google.com/home and start a new project (or open the Sheet and use Extensions > Apps Script)
2. Delete what's in `Code.gs`, paste all of `Code.gs` from this folder, save
3. Pick `setup` in the function menu, Run, allow access
4. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy
5. Pick `emailMeMyLinks`, Run. Your dashboard link and each client's review link arrive by email

## Clients tab
`client | brand | sheet_id | token | contact_email | client_approves | report_url`
- `brand` matches the brand column in Queue
- `client_approves`: yes = posts go to the client's review page, no = you approve (Open Frame)
- `contact_email`: needed for the "Email them the link" button
- New client: add a row with a random token. A client with their own Sheet: put its id in `sheet_id`
- `report_url`: optional link to the latest monthly report PDF, shown under Results
- To cut off a link, change the token

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
