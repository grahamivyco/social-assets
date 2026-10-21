# Approval map

Every automation that needs a yes from Graham or a client writes one row in the Hub's **Approvals** tab, in the format in Open-Frame [`docs/approval-items.md`](https://github.com/grahamivyco/Open-Frame/blob/main/docs/approval-items.md): one row per decision, a `kind` from that list, `client_ok` set by its rules. Studio reads and answers the tab (Hub calls `studioApprovals` / `adminApproval` for Graham, `getClientApprovals` / `clientApproval` for clients; the Studio pages that use them ship next). The old cards (Hub dashboard, client review page, Loops cards) keep working alongside.

How to write a row:

- **Loops on the Mac**: `L.approval({...})` in `lib.js`. It checks the kind, sets `client_ok` by the rules, never writes `answer` / `comment` / `updated`, and skips an `id` that's already there.
- **n8n or anything else**: POST `{ key, fn: 'loops', action: 'approval-add', rows: [...] }` to the Hub.
- **Coming up**: write the row early with `status: 'planned'` (a Reel being edited, next month's newsletter). It shows on the client's page under Coming up with no buttons. When it's made, `L.approvalSet({ id, status: 'draft', preview })` (or `action: 'approval-set'`) moves it on. Only planned rows can be moved this way.
- **Read the answer back**: `L.approvals({ made_by, status })` or `action: 'approval-list'`.
- **Old Loops card with the same `id`**: Graham's answer there (Yes / Send / Got it, Change, Pass) is copied into the row while it waits on him, so both places agree.

`client_ok` rules (enforced in the Hub, so every writer gets them):

- `brand_deal`, `ad_spend`, `repost`, `quote`: always `yes`.
- `reply`: `no` unless the loop marks it touchy (complaint, press, donor).
- Everything else: the loop decides, normally the client's `client_approves` in the Clients tab (Open Frame = `no`, Graham approves).

## Situations

| # | Situation | kind | client_ok | Loop that writes the row | When | After the answer |
|---|---|---|---|---|---|---|
| 1 | Client and Open Frame posts | `post` | client's `client_approves` | **Queue sync** in the Hub (any Queue writer: monthly content plan 10th/18th, photo posts) | Queue row reaches `draft`, `in_review` or `plan` | Looks good: Queue `approved`, poster posts at `publish_at`. Change: Queue `changes`, revised in the 24th-26th run. Skip: Queue `skipped`. |
| 2 | Reels | `reel` | client's `client_approves` | Queue sync (Reel drafts from AirDrop write the Queue) | Reel draft lands | Looks good: `approved` (IG goes to the phone card when `reel_music` = app, FB auto-posts). Change: re-edit. Skip. |
| 3 | Newsletters | `newsletter` | yes | Queue sync (newsletter builder writes `platform = newsletter`; paused) | Issue built | Looks good: n8n Client newsletters sends at `publish_at`. Change: rebuild. |
| 4 | Monthly reports, site and SEO checks | `report` | yes | Hub sync: a new `report_url` in the Clients tab, which the report run on the 2nd sets | Report PDF ready | Mark read: closed. Ask a question: Got it card for Graham with the question. |
| 5 | Brand kit rounds | `pick_one` (directions), `design` (colours and type), `files` (final files) | yes | `brand-kit/build-brand-kit.js` when it renders a round | Each round | Pick: next round built from the pick. Comment: revise this round. Final files: handoff. |
| 6 | Website launches | `launch` | yes | Projects tab row for a website job reaches "staging ready" | Staging link ready | Approve to launch: Got it card for Graham to go live. Not yet: their note goes on a Graham card. |
| 7 | Brand deals | `brand_deal` | yes, always | `triageMail` in the Hub: a reply from a brand in the Brands tab, or an email about sponsorship, collabs or UGC (a client forwarding one = their deal) | Offer arrives | Yes: acceptance email card for Graham. Not for us: polite no draft. Ask: Graham card. |
| 8 | Sensitive replies | `reply` | yes for touchy (upset, press, donor, sponsor, refund) when the client approves their own posts, no for everyday | **Inbox sync** in the Hub (rows the n8n comment replies + DM inbox write with `needs_reply`) | A comment or DM gets flagged | Send as is: n8n sends it. Change: edited, then sent. I'll handle it: closed, nothing sent. |
| 9 | Reposts | `repost` | yes, always | **Photo submissions sync** in the Hub (members' photos from the n8n content submissions workflow) | A photo comes in | Graham's Use = his yes, then the client's. Approve: `to_post`, it goes into a post (with credit). Skip: `skip`. |
| 10 | Ad spend | `ad_spend` | yes, always | `boost.js` on the 2nd: a post that did 3x the client's median, only for clients with `boost_budget` in `clients.json` | Monthly | Approve spend: Got it card for Graham to set it up. No: not suggested again for that post. |
| 11 | Photos or info from the client | `request` | yes | Monthly content plan (a slot with no real material), `onboard.js` (logins, logo files) | Plan day, onboarding day 0 | Upload: content intake fills the slot and closes the row. Not yet: one reminder at the next check-in. |
| 12 | Hours | `hours` | yes | Money loop (n8n, business ops) on the 1st | Month end | Approve hours: invoice row. Question: Graham card. |
| 13 | Quotes and agreements | `quote` | yes, always | `proposal.js` after a consult | Proposal page made | Sign: lead `won`, onboarding starts. No answer in 7 days: follow-up card. |
| 14 | Invoices | `invoice` | yes | Money loop on the billing day | Invoice made | Pay now: paid, receipt. 7 days late: reminder card. |
| 15 | Kits (Giving Tuesday, event promo) | `set` | yes | The kit builders | Kit built | Approve set: Queue rows. Change one: that piece is revised. |

## Not in the Approvals tab (yet)

Graham-only planning cards have no kind in the list: weekly ideas, scripts, trending sounds, outgoing pitch and proposal emails, events, directory listings, Google Business posts. They stay as `Loops` cards (Studio Needs you and Reels tabs) unless new kinds are added to `approval-items.md`.

## Build order

1. Queue sync (posts, reels, newsletters). **Built first.**
2. Sensitive replies (Inbox sync in the Hub, same hourly run). **Built.**
3. Requests for photos or info (`onboard.js` day 0: logo files, photos, account access). **Built.** Content plan asks: monthly content loop.
4. Quotes (`proposal.js`). **Built.**
5. Reports (Hub: a new Clients `report_url` = one `report` row a month). **Built.**
6. Brand deals (Hub `triageMail` writes the row, `deals.js` drafts the yes or no reply). **Built.**
7. Reposts (Hub sync of the Photo submissions tab). **Built.**
8. Ad spend (`boost.js`, 2nd at 10:00, clients with `boost_budget` only). **Built.**
9. Brand kit rounds, launches, kits.
10. Hours and invoices (with the business ops money loop).
