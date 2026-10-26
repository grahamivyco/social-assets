# The Meta app

How Open Frame talks to Instagram and Facebook: the app, the accounts, the permissions, the webhooks and every workflow that uses them. Status is as of 2026-10-26. No secret values here. Credentials are listed privately (ask Graham for the security inventory).

## The app

| | |
|---|---|
| Name | Open Frame Poster |
| App id | 2155131125076167 ([dashboard](https://developers.facebook.com/apps/2155131125076167/)) |
| Business | Open Frame LLC (Wyoming LLC), **Business Verification approved 2026-10-21** |
| Domain | openframe.design, verified with Meta by a meta tag (Open-Frame PR #80) |
| Products | Messenger, plus Instagram messaging through the Messenger setup (no separate Instagram product, on purpose: adding it would make a second setup) |
| Privacy policy | https://grahamivyco.github.io/social-assets/privacy.html ([privacy.html](../privacy.html) in this repo) |
| Data deletion | https://grahamivyco.github.io/social-assets/privacy.html#deleting-your-data |
| Category / icon | Business and pages / [app-icon-1024.png](../open-frame/profile-kit/app-icon-1024.png) |
| App mode | Development until 2026-10-21. Graham was asked to switch to **Live** and test with a stranger's DM. Result not confirmed yet |

## Accounts linked

| Account | Id | Notes |
|---|---|---|
| Facebook Page "Open Frame Design" | 1080869611776488 | The Page token is made from this Page |
| Instagram professional account @open.framedesign | 17841420040350345 | Linked to the Page. "Allow access to messages" is on in the IG app |
| Needlework Guild accounts | not connected | Graham isn't an admin on the guild's FB Page. The poster must never post NGM rows until they're connected and it routes by brand |
| Graham's personal IG | not connected | He posts personal Reels himself |

## The token

- One **Page access token**, stored in n8n as the credential **"Open Frame Page"**. Meta reports no end date for it (Page tokens made by a Page admin usually don't expire). The hourly health check tests it and reads `oauth/access_token_info`, so a dead or expiring token shows up as a Studio card and an email.
- The same token is used by the meta-mcp server on the Mac (below).
- An earlier user token in the outreach work had a 60-day life (around 2026-12-10). It was replaced by the no-expiry Page token on 2026-10-20/21. If any workflow still fails around that date, check it's on "Open Frame Page".

## Permissions

Graph API version in the workflows: **v21.0** (analytics uses v24.0).

| Permission | Used for | Status |
|---|---|---|
| `pages_show_list`, `pages_read_engagement` | Read the Page, its posts and comments | Standard access, working |
| `pages_manage_posts` | Post photos, videos and text to the Page | Working (poster) |
| `instagram_basic` | Read the IG account, usernames | Working |
| `instagram_content_publish` | Publish Reels, photos, carousels | Working (poster) |
| `instagram_manage_insights`, `read_insights` | Stats for reports | Working (analytics) |
| `pages_messaging` | Reply to Page DMs | Works for people with a role on the app. Real customers need Advanced Access or Live mode (see below) |
| `instagram_manage_messages` | Reply to IG DMs | Same as above |
| `instagram_manage_comments` | Read and reply to IG comments, private replies | Same as above |
| `pages_manage_metadata` | Subscribe the Page to webhooks | Same as above |

The 6 messaging and webhook permissions are the ones in the App Review plan. Ready-to-paste descriptions, the screen-recording script and reviewer notes are in Graham's project files (`dm-automation/app-review.md`).

## Webhooks

```
Instagram DM / Page DM / comment
        |
   Meta webhook  ----->  ngrok (fixed free domain, pm2 app "ngrok")
        |
   n8n on the Mac  /webhook/meta-dm  ("Open Frame DM inbox")
```

- Page subscriptions: `messages`, `messaging_postbacks`, `feed`. Instagram subscriptions: `messages`, `messaging_postbacks`, `comments`.
- The Page was connected to the app with `POST /{page-id}/subscribed_apps`.
- Both webhooks were verified and subscribed on 2026-10-20. The first Facebook test DM was answered and logged that evening.
- The verify step uses a phrase stored in the workflow (replaced with a placeholder in the repo copy).

## What uses the app

| Workflow | Where | What it does with Meta |
|---|---|---|
| **Social poster** | [n8n/social-poster.json](../n8n/social-poster.json), every 15 min | Approved, due Queue rows: IG `POST /{ig-id}/media` (container) then `/media_publish`; FB `/photos`, `/videos`, `/feed`. Reels, photos, carousels (2 to 10). IG Reels can be Trial Reels (`trial_params`, graduate on performance). Since PR #59 Open Frame IG Reels go to a "Post from your phone" card instead, so Graham can add trending audio in the app (the API can't attach library music). FB copies still auto-post |
| **DM inbox** | [n8n/dm-inbox.json](../n8n/dm-inbox.json), webhook | Logs each DM to the Inbox tab of "Open Frame outreach", asks LM Studio for a reply in Open Frame's voice, sends it with `POST /{page-id}/messages` (IG and FB), one CTA button as a second bubble. Rules below |
| **Comment replies** | [n8n/comment-replies.json](../n8n/comment-replies.json), every 2 min (polling, so it works without App Review) | Reads comments on Open Frame's own IG + FB posts, hides spam, replies to praise from a short fixed list after 1 to 3 min, sends questions and leads to Studio as cards. Max 10 replies an hour, never the same wording twice |
| **Social analytics** | [n8n/social-analytics.json](../n8n/social-analytics.json), daily 06:00 | Account and post insights into the Account stats and Post stats tabs. One request per metric, so a retired metric only blanks one cell |
| **Outreach scout** | [n8n/outreach-scout.json](../n8n/outreach-scout.json), weekday mornings | `business_discovery` on target accounts and `ig_hashtag_search` for hashtags, so Graham gets prospect posts to comment on (he posts those comments himself; the API can't comment on other accounts) |
| **Brand scout** | [n8n/brand-scout.json](../n8n/brand-scout.json), Mon 06:00 | `business_discovery` on similar creators to find brands that sponsor them |
| **Viral scout** | [watch/scout/](../watch/scout/), Mon 07:30 | Finds creators' outlier posts (3x their normal engagement) |
| **Health check** | [n8n/health-check.json](../n8n/health-check.json), hourly | Live `/me` test and token expiry check |
| **meta-mcp** | Graham's Mac | Lets Claude read and act on the IG/FB accounts directly (see below) |

## DM bot rules

- Voice file `dm-voice.md` (live copy on the Mac at `~/open-frame/dm-voice.md`, loaded into the n8n node by `~/open-frame/sync-voice.sh`).
- Speaks as "Open Frame" or "the team". No I, me, my, we, us or our ("you" is fine).
- Never gives prices or dates. Pricing and availability questions stay flagged as `needs_reply` for Graham.
- Upset messages get a fixed apology and the booking link and stay flagged. Crude messages get no reply. Scam and link messages get no reply and are flagged.
- Past-client questions get a fixed answer with a "See recent work" button.
- If asked whether Open Frame uses AI: a fixed honest answer (uses technology including AI tools, Graham directs and reviews). If asked "are you a bot": a fixed honest line.
- Buttons: "Book a free 30-minute consult" (Calendly) and "See recent work".
- Invented URLs are stripped from AI replies.
- Red-team script (`~/open-frame/redteam/redteam.mjs`): 0 slips out of 33 on 2026-10-20.
- Meta rules followed: replies only within 24 hours of the person's last message; a private reply to a comment only once and within 7 days; no follow-gating (nothing is offered in exchange for a follow).

Layer 1, which works without the app: Meta Business Suite instant reply, away message and saved replies.

## meta-mcp (Claude to Instagram)

- Package: [mikusnuz/meta-mcp](https://github.com/mikusnuz/meta-mcp), npm `@mikusnuz/meta-mcp` pinned at **2.2.2**. MIT, free, only calls `graph.facebook.com` and `graph.threads.net`.
- Installed on Graham's Mac as server **"instagram-openframe"** in Claude Code (user scope) and the Claude desktop config. Uses the "Open Frame Page" token and the ids above.
- Picked over adelaidasofia/instagram-mcp (multi-account, Python, a good fit later for clients) and exileum/meta-mcp (near fork).
- For a client, add a second server entry with that account's token and ids.
- Its DM tools hit the same Advanced Access limit as the bot.

## App Review and what's blocked

| Step | Status |
|---|---|
| Privacy + deletion URLs, category, icon | Done 2026-10-21 |
| Domain verification | Done |
| Business Verification | **Approved 2026-10-21** (first try failed on 2026-10-20: the EIN letter had no phone and a different address; passed with the Wyoming filing and the legal address) |
| Live mode test | Asked on 2026-10-21. Meta's page says Advanced Access is only needed when an app serves other businesses. This app only serves Open Frame's own Page and IG, so Live mode might be enough. **Not confirmed yet** |
| Advanced Access request for the 6 permissions + screen recording | Only needed if the Live test fails. Not submitted |

Still blocked or open:
1. **DM replies to the public.** In Development mode Meta only sends message webhooks for people with a role on the app. Waiting on the Live mode test (or App Review).
2. **Comments from other people.** Comment replies polled 0 comments in the first read test. It's unclear whether others' comments are hidden until the app is Live. The first live reply went to Graham's own test comment, and that account has a role on the app, so it doesn't prove strangers' comments come through.
3. **Webhook keyword flows** (comment "KIT" sends a DM, email capture) wait on the same thing, and the kit itself isn't made yet.
4. **Guild accounts** aren't connected (needs admin on the guild Page).
5. **Trending audio** can't be added through the API at all, so Open Frame Reels are posted from the phone.
