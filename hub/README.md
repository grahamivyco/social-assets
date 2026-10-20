# Hub: one dashboard, client review pages, morning email

Free. Runs in Google Apps Script inside the "NGM social queue" Sheet. Reads and writes the same tabs n8n uses, so nothing else changes.

- **Your dashboard**: posts to approve, client change requests, DMs to answer, outreach comments to post, new photo submissions, failed or stuck posts, what's waiting on clients, what goes out this week. Tap Approve, Change, Send to client, Send reply.
- **Client review page**: one private link per client, no login. They tap Approve, Request change (with a note) or Skip.
- **Morning email** at 7:00 Central with what needs you and a link to the dashboard.

## Setup (once, about 5 minutes)
1. Open the Sheet: https://docs.google.com/spreadsheets/d/1nec5cD5RtjV6yDLzxeKX9vGhI0k123PIaFFDwXqFM6A/edit
2. Extensions > Apps Script. Delete what's in `Code.gs`, paste all of `Code.gs` from this folder, save
3. Pick `setup` in the function menu, Run, allow access
4. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy
5. Pick `emailMeMyLinks`, Run. Your dashboard link and each client's review link arrive by email

## Clients tab
`client | brand | sheet_id | token | contact_email | client_approves`
- `brand` matches the brand column in Queue
- `client_approves`: yes = posts go to the client's review page, no = you approve (Open Frame)
- `contact_email`: needed for the "Email them the link" button
- New client: add a row with a random token. A client with their own Sheet: put its id in `sheet_id`
- To cut off a link, change the token

## Statuses (Queue)
Follows the shared schema: /mnt/project-files/automation/queue-schema.md
- Graham: draft > in_review (or approved when client_approves = no). "Fixed, send back" bumps revision.
- Dashboard: plan rows (topics) for clients you approve show under "Topics to approve"; Approve/Change/Skip writes client_decision only, status stays plan.
- Client page: in_review > approved / changes / skipped, writes client_decision (Approve, Request change, Skip), client_note, answered_by, decided_at. Plan rows (status plan) only get client_decision; the monthly loop acts on it.
- Extra column only the hub uses: review_note (Graham's own change note).

## Updating the code
Paste the new `Code.gs`, then Deploy > Manage deployments > edit > Version: New version. The links stay the same.
