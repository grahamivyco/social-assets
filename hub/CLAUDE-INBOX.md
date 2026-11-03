# Claude inbox: what needs Graham, answered in Claude

Graham doesn't open Studio or the Hub page. He asks Claude **"what needs me?"** (or "anything for me?", "what's waiting?"). Studio is paused since 2026-11-03 (Open-Frame branch `archive/studio-2026-11` keeps it). The Hub back end keeps running and does the work; Claude is just the screen.

Free, no keys, no recurring Claude task. Claude uses the Google Sheets connector on the Hub Sheet.

- Hub Sheet ("NGM social queue"): `1nec5cD5RtjV6yDLzxeKX9vGhI0k123PIaFFDwXqFM6A`
- Read: tab **Needs you** (rebuilt every 10 minutes by the Hub's `triageMail` trigger)
- Write: tab **Claude answers** (applied by the next 10-minute run)

## 1. Read

`get_values` on `Needs you!A1:L300`. Columns:

| column | what |
|---|---|
| source | `approvals`, `loops`, `mail`, `leads`, `inbox`, `health` |
| id | the id to answer with |
| client | whose it is |
| kind | post, reel, report, directories / listing, post from phone, email to answer, ... |
| title, body | what to show (body has the caption for posts and Reels) |
| preview | cover image or first slide |
| link | every media link (Reel videos, carousel slides), or where to go |
| buttons | the answers that fit, e.g. `Looks good \| Change \| Skip` |
| due, ref, built | due date, internal ref, when the row was built |

If `built` is more than 30 minutes old, the Mac or the Hub trigger may be off: say so.

## 2. Show

Graham's rules: visual, one card at a time, minimal, never a big table.

- Lead with the count by type ("3 posts, 1 Reel, 2 listings").
- Then one item at a time: title, the image (`preview`) and for a Reel the video link from `link`, the caption, then the buttons. In a project thread use `request_decision` with the row's buttons as options. Otherwise ask with the button words.
- Posts and Reels first, then emails and leads, then loop cards. `health` rows are things to fix, show them last in one line each.
- Scripts to film are not in this tab. They are `Loops` rows with `loop = scripts`, `status = ready`. Show them only when Graham asks for a script.

## 3. Answer

Only write what Graham actually said. Never answer for him, never approve on silence.

`append_values` to `Claude answers!A:E`, one row per answer:

| at | source | id | answer | note |
|---|---|---|---|---|
| ISO time | from Needs you | from Needs you | a button word from `buttons` (yes / ok / skip / pass also work) | Change: what to change. Inbox Send: the reply text. Mail Send: edited text, or blank to send the draft |

Leave `status` and `result` blank. Within 10 minutes the Hub applies it through the same code Studio's buttons used, then writes `status` = `done` (with the button it used) or `error` (with why). Tell Graham "done, it moves within 10 minutes", and check the row on the next ask.

What an answer does:

- **Post or Reel, Looks good**: Queue row approved. Posts go out at their time. Open Frame IG Reels become a "Post from your phone" item (video + caption + sounds) for Graham to post with a sound; **Got it** on that item marks it posted.
- **Change** + note: the row goes back for a redo with the note. **Skip**: never posts.
- **Loops card** Yes / Change / Pass, **email card** Send (sends from Gmail), **todo** Got it.
- **Mail** Send / Skip / Done. **Leads** Send / Skip / Done. **Inbox** (DMs, comments) Send with reply text in note, or I'll handle it.

## Rules that stay true

- Nothing posts without Graham's explicit yes. The old silence rule (auto-approve at the review deadline) is gone since 2026-11-03, and the Hub's `noAutoApprove_` sends any `answered_by = auto...` row back to waiting.
- Free tools only. No new recurring Claude tasks for this without asking Graham.
- Emails from the Hub (weekly check-in, can't-wait items, health) now link to Graham's Claude project instead of Studio. Override with Script Property `CLAUDE_URL`.
