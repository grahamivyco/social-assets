# Technology stack

Every tool, library, API and service in the system, what it does here and why it was picked. Versions are the pinned or last confirmed ones (2026-10-26).

**The rule behind most choices:** free tools only, no paid AI APIs. So AI runs on a local model, hosting is GitHub Pages, the database is Google Sheets and the back end is Apps Script. The other rule is the least effort for Graham: one card at a time, no Terminal.

## Runs on Graham's Mac

| Tool | Version | Used for | Why this one |
|---|---|---|---|
| **macOS** (MacBook Pro) | | Hosts everything that runs on a schedule. Clock set to Barcelona time | Free, already owned. No server bill |
| **Node.js** | system install | Loops, keeper, Reel watcher, renderers | Same language as n8n code nodes and Apps Script |
| **Python** | 3.13 (python.org build at `/Library/Frameworks/Python.framework/Versions/3.13/`) | Reel editor, video watch tool, patterns | Speech and vision libraries are Python. Homebrew's `python3` (3.15) lacks the packages, so 3.13 is pinned |
| **pm2** | 7.0.4 | Keeps every app running, restarts on crash, cron for scheduled apps | Simple, free, no sudo, installed inside `~/social-assets/mac` |
| **LaunchAgent** `design.openframe.keeper` | | Runs `mac/boot.sh` at login and every 5 min | Brings pm2 back after a restart without Graham doing anything |
| **n8n** | 2.x, self-hosted (npm global, `~/.npm-global/bin/n8n`), http://localhost:5678 | Posting, DMs, comment replies, scouts, analytics, inbox sorter, lead follow-up, contract check, health check | Free when self-hosted, visual, has Sheets/HTTP/IMAP/SMTP nodes. Timezone set to Europe/Madrid |
| **LM Studio** | CLI `~/.lmstudio/bin/lms`, server http://127.0.0.1:1234 (OpenAI-compatible) | All AI writing and judging: DM replies, comment drafts, captions, hooks, scripts, ideas, email sorting, contract terms, self-checks | Free and private. Nothing leaves the Mac |
| LM Studio model | **qwen/qwen3.5-9b** since 2026-10-23, one copy, 16K context, thinking off | | Swapped from google/gemma-4-e4b: better scripts (judge score 4.3 of 5 vs hook-only), swap use down from 28 GB to 5 GB |
| **ngrok** | free static domain, `~/.local/bin/ngrok`, pm2 app `ngrok` | Public https address for n8n: Meta webhooks and the iPhone "Watch with Claude" shortcut | Free fixed domain, so Meta's callback URL never changes |
| **clasp** | 3.4.1 | Keeper pushes `hub/Code.gs` to Apps Script and redeploys | Lets Hub changes ship from git with no copy-paste |
| **git** | | Keeper pulls `main` every 10 min. Loops push state. Reel media pushed to Pages | Merged fixes reach the Mac on their own |
| **ffmpeg / ffprobe** | 9.0.2 static builds (https://ffmpeg.martin-riedl.de) in `~/.local/bin` | Every cut, encode, loudness pass, frame grab | Standard, free. Static build avoids Homebrew |
| **sherpa-onnx + Parakeet TDT** | model `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` (about 640 MB, `~/.cache/thedit`) | Word-level transcripts for the editor and the watch tool | Free, runs on CPU, accurate word times. Whisper weights couldn't be fetched through the cloud proxy |
| **RobustVideoMatting** | `rvm_mobilenetv3_fp32.onnx` v1.0.0 via onnxruntime | Cuts the speaker out so graphics sit behind the head | Free, local, soft edges |
| **numpy, Pillow** | | Audio analysis, sound effects made in code, images | |
| **OpenCV** (`opencv-python-headless`) | | Edit breakdowns: optical flow, punch-ins, cuts, dissolves | |
| **Apple Vision** (`watch/ocr.swift`) | built into macOS | On-screen text and faces in watched videos | Free, accurate, already on the Mac |
| **yt-dlp** | | Downloads Reels, TikToks, YouTube for the watch tool | Free. Cloud sessions can't reach these sites, the Mac can |
| **youtube-transcript-api** | | Transcripts of YouTube lessons | Free |
| **playwright-core + Chromium headless shell** | 1.56.1 | Renders HTML/canvas graphics: pop layer, covers, list cards, frames, reports, brand kits | Pixel-exact brand fonts and layouts, transparent video frames |
| **meta-mcp** | `@mikusnuz/meta-mcp` 2.2.2 | Claude reads and acts on the IG/FB accounts | MIT, free, only calls Meta's APIs. See [meta-app.md](meta-app.md) |

## Google

| Service | Used for | Notes |
|---|---|---|
| **Google Sheets** | The database. "NGM social queue" (Queue, Clients, Approvals, Health, Mac status, Loops, Loop runs, stats, sessions and more) and "Open Frame outreach" (Targets, Leads, Inbox, Engage, Creators, Brands, Outliers) | Free, Graham can see it, every tool can reach it |
| **Google service account** | n8n reads and writes the Sheets | Sheets are shared with its email |
| **Apps Script ("Hub")** | Web app bound to "NGM social queue", V8 runtime. Cards, emails (MailApp), calendar events (CalendarApp), Studio API, approvals sync, health alerts, review links | Free, runs in Google, no server. Source [hub/Code.gs](../hub/Code.gs). Deployed as "Execute as me, Anyone" |
| **Google Identity** | "Sign in with Google" on Studio. GCP project `enhanced-rite-512212-t9`, app "Open Frame", In production, scopes openid/email/profile | Token checked with Google's tokeninfo |
| **Gmail** | IMAP + SMTP for n8n (sorter, follow-ups, contract check, submissions). Labels and filters (Calendly, NGM Submissions, Open Frame/*) | Gmail app password |
| **Google Drive** | "Content Inbox" folder for photos and ideas | Drive connector can't move files over 10 MB, so video goes by AirDrop |
| **Google Analytics 4** | openframe.design traffic (G-RF906YB2TT), loads only after consent | |
| **Search Console** | openframe.design indexing | |
| **Gemini API (free tier)** | Describes member photos in the content submissions workflow | Free tier key, header auth |

## Hosting and web

| Service | Used for |
|---|---|
| **GitHub** | Two public repos: this one (system) and [Open-Frame](https://github.com/grahamivyco/Open-Frame) (site). Claude sessions open and merge PRs |
| **GitHub Pages** | openframe.design (custom domain) and https://grahamivyco.github.io/social-assets/ (Reel media, post images, reports, check form, UGC page, privacy page). The poster needs public media URLs, Pages gives them free |
| **Plain HTML/CSS/JS** | The site is a single-file SPA (`index.html`) plus standalone pages (`studio/`, `review/`, `links/`, `privacy/`, `terms/`). No framework, no build step beyond `tools/build-pages.js` |
| **Fonts (OFL)** | Fraunces, Inter, Manrope for Open Frame. Cormorant Garamond, DM Sans for the guild. Embedded as base64 in renders |
| **Calendly** (free) | Booking link for the free consult |
| **Brevo** (free plan) | Planned client newsletters. **Paused** |

## Meta

| Piece | Used for |
|---|---|
| **Graph API** v21.0 (analytics v24.0) | Posting, insights, comments, DMs, `business_discovery`, hashtag search |
| **Messenger + Instagram webhooks** | DMs and comments into n8n |
| **Meta Business Suite** | Native instant replies, away message, saved replies |
| Full details | [meta-app.md](meta-app.md) |

## Claude

| Piece | Used for |
|---|---|
| **Claude projects and threads** | Building and changing the system, one thread per system |
| **Scheduled tasks** | Weekly loop review (Sunday), monthly report (2nd), monthly content plan (10th, 18th). Graham paused several older ones to save credits, so new recurring work should be a local loop |
| **Remote Control** | Runs a Claude session on the Mac for installs and renders. The Mac's safety check needs Graham's own words for publishing or installing |
| **Skills** | Video and content skills (see [video-system.md](video-system.md)), `watch-video` (this repo's [watch/skill](../watch/skill/)), humanizer and structural-humanizer for site copy |
| **Connectors** | GitHub, Google (Gmail, Drive, Sheets, Calendar), Figma, Metricool and others on Graham's account |

Claude is used to build and review, never inside the running system (no Claude API calls in any workflow).

## Why not the usual paid tools

| Instead of | This system uses |
|---|---|
| Hootsuite / Buffer / Later | n8n poster + Graph API |
| ManyChat | n8n DM inbox + LM Studio |
| OpenAI / Claude API | LM Studio on the Mac |
| CapCut Pro / Descript / Opus Clip | `thedit.py` + pop layer |
| Sandcastles | Viral scout + watch tool + the free Ootto skills |
| Zapier / Make | n8n |
| A hosted database or server | Google Sheets + Apps Script |
| Vercel / Netlify | GitHub Pages |
