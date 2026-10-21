# AirDrop to Reel draft

Film a talking head on the iPhone, AirDrop it to the Mac, and a finished Reel draft shows up as a Hub card. Tap yes and the poster puts it on Instagram and Facebook. Free tools only.

## How it works
1. AirDrop lands the video in `~/Downloads`. The watcher also checks `~/Downloads/Video`, where the Downloads sorter moves videos, and edits from its own copy so a move mid-edit is fine.
2. `reel-watch.js` (pm2 process `reel-watch`) sees a new `.mov`/`.mp4` once it stops growing. It skips clips under 8 s or over 3 min, and clips with fewer than 12 spoken words.
3. `editor/thedit.py transcribe` cuts ums, dead air, stutters and restarted lines.
4. LM Studio on the Mac (`google/gemma-4-e4b`) writes the hook (one *accent* word), the cover headline and a caption that ends with the CTA and the full https:// link on its own line. It also plans 2 to 4 graphics, one per idea, each on its spoken word (pass 4).
5. `editor/thedit.py render` makes the IG Reel (1080x1920) and the FB square (2160x2160) with brand captions, title, graphics, cover and end card, following `editor/REEL-RULES.md`. It cuts you out of the background so graphics sit behind your head (pass 2) and adds sound effects made in code under the voice (pass 5). Voice only, so trending audio can be added in the IG app.
6. Voice-only copies at about 7 Mbps (under 25 MB) go to `~/Downloads/Open Frame LLC & Clients/Reels/<id>/` with the covers and `caption.md`.
7. The same copies are pushed to `reels/media/<id>/` in this repo, so GitHub Pages hosts them for the poster.
8. The n8n workflow "Reel drafts" (`n8n-reel-drafts.json`, webhook `/webhook/reel-draft`) adds two Queue rows (IG and FB), status `in_review`, `sensitive` = yes so they never post without a yes. Slot: the next weekday from tomorrow at 17:00 Chicago without another Reel.
9. The Hub shows the card. Yes = `approved`, then the poster posts it when it's due. Change = tell Claude in the Reels thread what to fix.

Problems (render failed, LM Studio off, push failed) go to the `Health` tab as `reel-drafts`, so the Hub shows a card and sends one email.

The footage color is never changed. HDR stays 10-bit HLG.

## Setup on the Mac (once)
1. `git clone https://github.com/grahamivyco/social-assets ~/social-assets` (needs push access).
2. `python3 -m pip install sherpa-onnx onnxruntime numpy pillow`. ffmpeg and ffprobe must be on the PATH (on Graham's Mac: static builds from https://ffmpeg.martin-riedl.de in ~/.local/bin). The speech model (about 640 MB) downloads on the first run.
3. `cd ~/social-assets/reels && npm i playwright-core@1.56.1 && npx playwright-core install chromium-headless-shell`.
4. Copy `config.example.json` to `config.json` and set `chromium` and `pwCore`.
5. `pm2 start reel-watch.js --name reel-watch && pm2 save`.
6. In n8n: Import from URL `https://raw.githubusercontent.com/grahamivyco/social-assets/main/reels/n8n-reel-drafts.json`, pick the Google service account in the 3 Sheet nodes, then Publish.
7. LM Studio stays running with `google/gemma-4-e4b` loaded (same as the DM replies).

On its first start the watcher marks everything already in Downloads as seen, so only new AirDrops become Reels.

## Other clients
Set `"brand": "ngm"` (or another slug) in `config.json`. Today the watcher makes Open Frame Reels by default. A client Reel also needs that client's fonts in `brands/<slug>/fonts/` on the Mac, and its own Reel graphics from `brands/design-notes.md`.

## Private copy rules
Put `"copyRules": "..."` in `config.json` (not in git) for things the AI must never write, such as personal topics to keep out of captions.

## Presets
Set `"preset": "one-take"` in `config.json` for the plain one-take look (no cuts beyond head and tail, no graphics or sound effects, static title box, small white captions). Leave it out for the full edit. See `editor/REEL-RULES.md`.

## Files
- `reel-watch.js`: the watcher. `state.json` remembers which files it has seen (delete a line to redo one).
- `editor/`: copy of the talking head editor from the project files, with env overrides for Mac paths. Fonts here are OFL (Fraunces, Inter, Manrope).
- `build-workflow.py`: builds `n8n-reel-drafts.json`.

## Trial Reels (2026-10-21)
Every Reel draft's Queue rows get `trial` = `yes`, so the poster sends the Instagram Reel as a Trial Reel (shown to non-followers first, `trial_params.graduation_strategy` = `SS_PERFORMANCE`, so it graduates to followers on its own if it does well). Set `"trial": false` in `config.json` to post normal Reels. Facebook ignores it.
