# Security inventory

Every credential the system uses, where it lives, what it can reach, and the open risks. **Names and locations only. No secret values belong in this file or anywhere in this repo.** Both repos are public.

Last checked: 2026-10-26.

## Scan result (2026-10-26)

- Scanned all files and the full git history of **social-assets** (155 commits, all branches) and **Open-Frame** (202 commits) for tokens, passwords, API keys, private keys, service account JSON, Hub admin keys and `?k=` admin links.
- **No secrets found.** Hits were false positives (base64 image metadata, the Apps Script project id, the public Google OAuth client id).
- The Meta webhook verify token was hardcoded in the DM inbox workflow in Graham's project files. It's replaced with `SET_YOUR_META_VERIFY_TOKEN` in the repo copy ([n8n/dm-inbox.json](n8n/dm-inbox.json)). The live copy on the Mac still has the real one.

## Credentials

| # | Credential | Used for | Stored where | Can access | Expires | Known exposure |
|---|---|---|---|---|---|---|
| 1 | **Meta Page token** (n8n credential "Open Frame Page") | Posting, insights, comment replies, DMs, health check | n8n credential store on the Mac (encrypted by n8n's key in `~/.n8n`). Also in the meta-mcp server entry in Claude Code / Claude desktop config on the Mac (plain JSON) | Open Frame FB Page + IG open.framedesign: publish, read insights, read/reply comments and messages | No end date (Page token) | Created via Graph API Explorer during setup; check whether it was pasted in a chat |
| 2 | **Google service account** (n8n "Google Service Account account") | All n8n Sheet reads/writes | JSON key inside n8n on the Mac | Any Sheet shared with the service account email ("NGM social queue", "Open Frame outreach") | Never, until the key is deleted in Google Cloud | None known |
| 3 | **Gmail app password** (n8n "Gmail IMAP" + "Gmail SMTP") | Inbox sorter, lead follow-up, contract check, content submissions | n8n on the Mac | **Full read and send** on Graham's Gmail | Never, until revoked | **Pasted in a Claude chat 2026-10-21. Rotate.** |
| 4 | **ngrok authtoken** | Runs the public tunnel to n8n | ngrok config on the Mac (`~/.local/bin/ngrok`, config in ngrok's default folder) | Graham's ngrok account: start tunnels on his domain | Never, until reset | **Pasted in a Claude chat 2026-10-20. Reset.** |
| 5 | **Hub admin key** (`ADMIN_KEY` Script Property) | Graham's Hub dashboard link (`/exec?k=…`) and every loop/n8n/Mac call to the Hub API | Apps Script Script Properties; Mac `~/social-assets/reels/config.json` (`hubKey`); Graham's "Your Hub links" email; shell history from the `HUB_KEY=… bash` install paste | **Everything in the Hub**: all Sheets data, cards, sending email as Graham through MailApp, Calendar events | Never. Regenerates only if the property is deleted and `setup` re-run | In an email, a URL (browser history), a config file and `~/.zsh_history` |
| 6 | **n8n API key** (n8n "n8n API key") | Health check reads workflow runs | n8n on the Mac | Full n8n API: read, edit, run every workflow and credential reference | Set to "No expiration" | None known |
| 7 | **Gemini API key** (n8n "Gemini API key") | Content submissions (describes member photos) | n8n on the Mac | Google AI Studio free tier | Never, until deleted | None known |
| 8 | **Meta webhook verify token** | Meta subscribes the DM webhook | Hardcoded in the live n8n DM inbox workflow; was in Graham's project files | Only lets Meta confirm the webhook. Weak secret | Never | In project files (now redacted in the repo copy) |
| 9 | **video-watch token** | iPhone Shortcut to n8n "Video watch" | `~/.config/video-watch/token` on the Mac and in the Shortcut | Queue a video download/analysis on the Mac | Never | None known |
| 10 | **clasp login** | Mac keeper deploys `hub/Code.gs` | `~/.clasprc.json` on the Mac (Google OAuth refresh token) | Graham's Google account: Apps Script projects and deployments | Until revoked in Google account settings | None known |
| 11 | **Git credential on the Mac** | Keeper `git pull`, loops `git push` of `loops/state/` | Mac git credential helper (check which: Keychain, `gh`, or a PAT) | Push to this repo (and any other repo the credential covers) | Depends on type | Unknown: check the scope |
| 12 | **Google OAuth client id** (Studio sign-in) | "Sign in with Google" on Studio | Hub `GOOGLE_CLIENT_ID` | Nothing on its own (public by design, scopes openid/email/profile, no client secret used) | n/a | Public, fine |
| 13 | **Studio sessions** | Signed-in Studio users | Hashed in the "Studio sessions" tab; token in each browser's `localStorage` (`of-studio`) | That user's Studio view (admin sessions see everything) | 30 days | n/a |
| 14 | **Client review links** | Clients approve posts without signing in | "Review links" tab | That client's items | 14 days or when a newer link is sent | Sent by email |
| 15 | **Brevo API key** | Newsletter | Not set up (newsletter paused) | n/a | n/a | n/a |

Not credentials, but public identifiers already in the repos: the Hub `/exec` URL, the ngrok address, Sheet ids, the Apps Script project id, IG/FB account ids. None grant access alone, but they tell an attacker where to knock.

## Other access paths

- **Claude account connectors**: Graham's Claude account has connectors for Gmail, Google Drive, Sheets, Calendar, GitHub, Mercury (bank), PocketSmith, Supabase, Figma and others. Any Claude session in his projects can use them. Mercury includes money-movement request tools.
- **Claude Remote Control** sessions run on the Mac with Graham's local access.
- **Claude sessions push to `main`** of this repo and merge their own PRs (Graham's standing choice).

## Open risks, in the order to look at them

1. **Merge to `main` = code running on the Mac.** `mac/install.sh` is piped from `main`, the keeper `git pull`s every 10 minutes, the loops runner restarts on new code, and the keeper deploys `hub/Code.gs` to the live Hub. Anyone who can push to `main` controls the Mac, n8n's credentials and the Hub. Consider branch protection, and keep collaborators at Read.
2. **ngrok exposes all of n8n, not only webhooks.** The tunnel points at port 5678, so the n8n editor login and REST API are reachable from the internet with no ngrok auth or IP policy. Check the n8n owner password and 2FA, or restrict the tunnel to `/webhook/*` with an ngrok traffic policy.
3. **Gmail app password and ngrok authtoken were pasted in chat.** Rotate both (steps below).
4. **Hub admin key is long-lived and spread around** (URL, email, config file, shell history) and unlocks the whole Hub, including sending email as Graham. Rotate it now and on a schedule, and prefer Studio sign-in over the `?k=` link.
5. **DM webhook doesn't check Meta's signature.** n8n doesn't verify `X-Hub-Signature-256`, so anyone with the ngrok address can post fake DM events. Add the app-secret signature check.
6. **Public repo holds generated data.** `loops/state/` (runs, proposals, onboarding, targets) is pushed from the Mac, and the check and proposal loops publish pages under token paths on GitHub Pages. Tokens in a public repo aren't private: anyone can list the folder. Keep client and lead data out of this repo, or move it to a private repo.
7. **No-expiry tokens everywhere** (Meta Page token, n8n API key, service account key, Gmail app password). Fine for a solo setup; a schedule for rotating them would help.
8. **meta-mcp config holds the Meta token in plain JSON** on the Mac. Same token as n8n, so one leak covers both.

## How to rotate the exposed ones

1. Gmail app password
   - Revoke and create a new one: https://myaccount.google.com/apppasswords
   - In n8n, paste the new one into the credentials "Gmail IMAP" and "Gmail SMTP": http://localhost:5678/home/credentials
2. ngrok authtoken
   - Reset it: https://dashboard.ngrok.com/get-started/your-authtoken
   - On the Mac, save the new one with `ngrok config add-authtoken` and restart the `ngrok` pm2 app.
3. Hub admin key
   - In the Apps Script project, Project Settings > Script Properties, delete `ADMIN_KEY`, run `setup` once (it makes a new key), then update `hubKey` in `~/social-assets/reels/config.json` on the Mac and get the new dashboard link from the Hub.
