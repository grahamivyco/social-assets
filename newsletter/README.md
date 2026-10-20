# Client newsletters

A monthly email for each client, in their brand, that gathers news from their people, gets a yes, sends, tracks results and turns into social posts. Free: Brevo free plan, n8n on Graham's Mac, the Hub, GitHub Pages.

## The month (for an issue going out in month M, everything happens in month M-1)
| Day (settings) | What happens | Who |
|---|---|---|
| `ask_day` (1st) | Every contributor gets "anything for December?" with what we'd like from them | n8n |
| `due_day` - 3 | Nudge to anyone who hasn't sent anything | n8n |
| `due_day` (12th) | Last call to anyone still quiet | n8n |
| day after due | Summary to the owner: who sent what, who didn't | n8n |
| after due | Draft `issue.json` from submissions, calendar and last month's learnings, build, add Queue rows | Claude |
| check-in | One card in the Hub: swipe the email pages, Yes / Change / Skip | client or Graham |
| `send_at` | Sent through the client's Brevo account | n8n |
| daily for 45 days | Opens, clicks, unsubscribes, list size, poll answers into `Newsletter stats` | n8n |
| 2nd | Newsletter numbers go into the monthly report | Claude |

Contributors reply to the reminder email. Replies go to the client's submissions address, which the Content submissions workflow (`automation/content-submissions`) already logs, so a reply counts as "sent something" and they get no more reminders that month.

Readers give input through the poll section: each answer is a tracked link, and the stats pull counts the taps.

## Files
- `build-issue.js`: `issue.json` -> `email.html` (Brevo), `index.html` (web version), `paste.html` (any other email tool), `pages/*.jpg` (Hub card), `social/*.jpg` + `captions.md` (posts), `queue.csv` (rows for the Queue), `check.txt` (what's missing)
- `brands.json`: one entry per client: colors, fonts, newsletter name, footer, sign-up link. New client = new entry
- `issues/<brand>/<yyyy-mm>/issue.json`: the issue. Sections: `note`, `feature` (tone pale, rose or dark), `calendar`, `article`, `spotlight`, `poll`, `cta`. Add `"social": {"hook", "line"}` to a section to make a post from it. `*word*` = brand italic, `**bold**`, `[text](https://link)`
- `n8n-newsletter.json`: the workflow (built by `build-workflow.py`)

Build an issue:
```
node build-issue.js issues/ngm/2026-11/issue.json
```
Setup for the script: `npm i playwright-core@1.56.1 @fontsource/fraunces @fontsource/inter @fontsource/cormorant-garamond @fontsource/dm-sans`. Push to main and GitHub Pages serves it at `https://grahamivyco.github.io/social-assets/newsletter/issues/<brand>/<yyyy-mm>/`.

## Queue rows
The newsletter is one Queue row: `platform` newsletter, `type` email, `hook` = subject, `caption` = subject, preview text and web link, `media_url` = the page images, `preview_url` = page 1, `sensitive` yes (never sends without a yes). The poster ignores it. The Hub shows it like any post. The newsletter workflow sends it when it's `approved` and due, then sets `posted`.

## One-time setup (Graham, about 15 minutes)

### 1. Sheet tabs
Already added to "NGM social queue" on 2026-10-20, with the guild's settings row (`active` no until Brevo is set up). Every client shares these tabs, one row per client, and the newsletter rows go in the same Queue as the posts. If a tab ever goes missing: add it, click A1 and paste its header row (it splits into columns on its own).

Tab name:
```
Newsletter settings
```
Header:
```
brand	newsletter	active	owner_email	from_name	reply_to	ask_day	due_day	send_day	list_ids	sender_name	sender_email
```

Tab name:
```
Newsletter contributors
```
Header:
```
brand	name	email	asks_for	active
```

Tab name:
```
Newsletter log
```
Header:
```
key	brand	issue	stage	email	name	sent_at
```

Tab name:
```
Newsletter stats
```
Header:
```
issue_id	brand	month	subject	sent_at	campaign_ids	list_ids	status	recipients	delivered	unique_opens	open_rate	unique_clicks	click_rate	unsubscribes	bounces	complaints	list_size	list_size_at_send	top_links	poll_results	updated_at
```

### 2. Import the workflow
1. Open http://localhost:5678, then Workflows > Import from file > `n8n-newsletter.json`
2. Open each node with a red credential warning and pick the existing one: Google Service Account, Gmail SMTP
3. Leave it unpublished until the first client's Brevo key is in (step 3 below), then Publish

## Add a client (about 20 minutes each)

### 1. Brevo account (free, in the client's name so they own their list)
1. Sign up:
```
https://onboarding.brevo.com/account/register
```
2. Add and verify the sender address (their own domain, not Gmail):
```
https://app.brevo.com/senders/list
```
3. Authenticate their domain so mail lands in inboxes (Brevo shows the DNS records to add):
```
https://app.brevo.com/senders/domain/list
```
4. Make a list, note its number (ID), and import their existing subscribers as a CSV:
```
https://app.brevo.com/contact/list-listing
```
5. Make a sign-up form for that list and copy its share link into `signup_url` for the client in `brands.json`:
```
https://app.brevo.com/forms
```
6. Make an API key named n8n and copy it:
```
https://app.brevo.com/settings/keys/api
```

### 2. n8n
Open the "Brevo keys" node and add a line with the client's brand slug and key, like:
```
ngm: 'xkeysib-...',
```

### 3. Sheet rows
- `Newsletter settings`: one row. `active` yes. `reply_to` = the client's submissions address. `list_ids`: `3` for one list, `3,4` for two lists at once, `3;4` for list 3 today and list 4 tomorrow (Brevo free sends 300 emails a day, so split a bigger list into lists of 300)
- `Newsletter contributors`: one row per person to ask. `asks_for` is what we'd like from them ("the librarian's pick", "photos from Come & Stitch"). Blank = "news, a finished piece, a photo or a date"
- `Clients` tab (Hub): `client_approves` yes if they approve their own issue

### 4. Submissions inbox
Give the client a submissions address the same way as the guild's (`automation/content-submissions/setup.md`).

### 5. Brand
Add an entry to `brands.json` (copy `ngm` and change the colors, fonts, name, footer, links).

## What gets measured (Newsletter stats)
| Column | From Brevo |
|---|---|
| recipients, delivered | sent and delivered emails |
| unique_opens, open_rate | people who opened, out of delivered. Apple Mail opens everything automatically, so treat opens as a rough trend |
| unique_clicks, click_rate | people who clicked any link, out of delivered. The number to trust |
| unsubscribes, bounces, complaints | list health |
| list_size, list_size_at_send | subscribers now and when sent. New sign-ups = this issue's `list_size_at_send` minus last issue's |
| top_links | the 5 most-clicked links |
| poll_results | taps per poll answer |

## Free plan limits worth knowing
- Brevo free: 300 emails a day, unlimited contacts, small Brevo logo in the footer. Starter removes the daily cap if a client outgrows it
- Stats keep updating for 45 days after sending
