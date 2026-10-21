# Mac keeper

Keeps everything on the Mac running without Terminal. Free tools only.

## Set up (one paste, once)
```
curl -fsSL https://raw.githubusercontent.com/grahamivyco/social-assets/main/mac/install.sh | HUB_KEY=<Hub admin key> bash
```
Safe to run again. It:
1. Pulls the repo to `~/social-assets`, installs pm2 + clasp inside `mac/` (no sudo) and adds `mac/env.sh` to `~/.zprofile`, so `pm2`, `ffmpeg` and `lms` work in Terminal too.
2. Saves the Hub address + key in `reels/config.json` (the loops, graphics pitch and keeper all use it).
3. Adds the login agent `~/Library/LaunchAgents/design.openframe.keeper.plist`: at login and every 5 minutes `boot.sh` brings pm2 back (`pm2 resurrect`) and makes sure the keeper runs.
4. Starts the keeper (pm2 `keeper`).
5. Imports and publishes the n8n workflows listed in `n8n-flows.json` (`n8n-fix.js`, uses n8n's own command line, no API key). Re-imports one under the same id when its file changes on main. To add a workflow, add a line there (`"active": false` = imported but left off).
6. Hub auto-update: turn on the Apps Script API at https://script.google.com/home/usersettings and click Allow once (`clasp login`). After that every change to `hub/Code.gs` on main deploys itself within 10 minutes. No more pasting.

## What the keeper does (every 2 minutes)
- pm2 apps in `apps.json`: restarts anything stopped (reel-watch, loops, video-watch, n8n, ngrok), starts missing repo apps, leaves cron apps (viral-patterns) alone between runs. n8n gets restarted if it stops answering on :5678 two checks in a row.
- LM Studio: starts the server with `lms server start` (opens the app hidden if needed) and loads the model (`reels/config.json` `model`).
- `git pull` every 10 minutes, so merged fixes land on their own.
- `hub/Code.gs` changed: `clasp push` + `clasp redeploy` to the live deployment (same /exec URL).
- Hourly, or as soon as a workflow file changes: every workflow in `n8n-flows.json` is in n8n and the active ones are published.
- Reports every check to the Hub `Mac status` tab. The Studio shows it (https://openframe.design/studio/?tab=status); anything still failing after 10 minutes becomes a Heads up card and one email.

## Files
- `keeper.js` (`node mac/keeper.js once` = one check, printed), `apps.json`, `boot.sh`, `env.sh`, `install.sh`, `n8n-fix.js`.
- `config.json` (optional, not in git): override `every`, `py`, `scriptId`, `deploymentId`, `model`.
- `state.json`, `logs/boot.log`: local only.

## Selling the system
A new owner changes `scriptId` + `deploymentId` in `mac/config.json` (their own Hub), and `HUB_URL` in `install.sh`.
