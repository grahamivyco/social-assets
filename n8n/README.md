# Health check (n8n workflows + Meta token)

Runs every hour at :05 on Graham's Mac. Writes one row per check to the `Health` tab of "NGM social queue". The Hub (Apps Script) turns problems into check-in cards and emails, and warns when the rows stop updating (Mac off or n8n stopped).

## What it checks
| Check | Problem (email) | Heads up (card only) |
|---|---|---|
| Social poster, outreach scout, analytics puller | latest run failed, or switched off | hasn't run on schedule, or failed earlier today but recovered |
| Photo submissions, DM replies, any other active workflow | latest run failed | failed earlier today but recovered |
| Meta token "Open Frame Page" | stopped working, or 14 days or less left (urgent at 5) | can't reach Meta |
| n8n itself | health check can't read n8n (API key) | |
| Heartbeat | Hub emails if no update for 20 hours | Hub card after 3 hours |

Token end date comes from `oauth/access_token_info`. If Meta gives no end date (Page tokens made by a Page admin often never expire), the hourly live test still catches a dead token.

## Setup (once)
1. Create an n8n API key: http://localhost:5678/settings/api > Create an API key > Expiration: No expiration > copy it
2. Credentials > Create credential > Header Auth. Credential name `n8n API key`, Name `X-N8N-API-KEY`, Value = the key
3. New workflow > ... menu > Import from URL: https://raw.githubusercontent.com/grahamivyco/social-assets/main/n8n/health-check.json
4. Pick credentials: `n8n API key` in the 3 "n8n:" nodes, `Open Frame Page` in the 2 "Meta:" nodes, the Google service account in "Save to Health tab"
5. Execute workflow once, check the Health tab, then Publish

## Change what's watched
"Settings" node: `watch` list (name match, mustBeOn, staleHours), `warnDays`, `urgentDays`.


# Lead follow-up

`lead-followup.json`: Calendly booking emails and Targets replies become rows on the `Leads` tab of "Open Frame outreach"; an hourly planner drafts each lead's next follow-up as a Hub card; approved emails go out every 15 minutes over Gmail SMTP. Setup, sequence and columns: /mnt/project-files/business-ops/lead-followup/README.md (source: build-workflow.py + code/).

Import from URL: https://raw.githubusercontent.com/grahamivyco/social-assets/main/n8n/lead-followup.json


# Comment replies

`comment-replies.json`: every 2 minutes reads comments on Open Frame's own IG + FB posts, hides spam, auto-replies to praise after a random 1 to 3 minute delay, and sends questions/leads to the Hub as cards. Max 10 replies an hour, never the same wording twice. Setup and modes: /mnt/project-files/comment-replies/README.md (source: build-workflow.py + code/).

Import from URL: https://raw.githubusercontent.com/grahamivyco/social-assets/main/n8n/comment-replies.json

# Inbox sorter

`inbox-sorter.json`: new inbox mail (IMAP) is typed by LM Studio on the Mac (free, local) and written to the `Mail` tab of NGM social queue; the Hub's `triageMail` applies Gmail labels, saves reply drafts and shows lead/client replies as Send cards. Setup: /mnt/project-files/business-ops/inbox-sorter/README.md

Import from URL: https://raw.githubusercontent.com/grahamivyco/social-assets/main/n8n/inbox-sorter.json
