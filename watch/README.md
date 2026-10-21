# Video watch tool

Lets Claude watch any Instagram Reel, TikTok, YouTube or Shorts link (or a screen recording) and break it down: hook, pacing, captions, sound, message. Free tools only, all on the Mac.

## What you get
One folder per video in `~/Downloads/Open Frame LLC & Clients/Watched/<date>-<creator>-<id>/`:
- `report.md`: creator, caption, views/likes/comments, audio track, length, cut pace, words per minute, the hook, a shot list (time, on-screen text, what's said) and the full transcript. Claude adds the breakdown at the end.
- `contact-sheet.jpg`: one frame per shot, with its time and on-screen text.
- `edit.md` + `transitions.jpg` + `timeline.jpg` (from `edit.py`): every transition (hard cut, jump cut, punch-in with its zoom, dissolve, fade, flash, whip, camera reframe) and a frame-by-frame strip of each, camera moves per shot (zoom %/s, pan, tilt, shake, still), shot sizes and where the face sits, text and caption timing with position, size and whether Instagram's buttons cover it, palette and look, audio hits, tempo and how many cuts land on a hit, and cut pace per 5 s.
- `frames/`, `words.json` (every word with its time), `info.json`, `video.mp4`, `thumbnail.jpg`.
- `index.md` in the parent folder lists everything watched.

## Use it
- **From Claude on the Mac:** paste the link and say "watch this". The `watch-video` skill runs the tool and writes the breakdown.
- **From the iPhone:** Share > "Watch with Claude" on any Reel or video. It lands in the folder within a few minutes. Then ask Claude about it.
- **By hand** (`python3.13`: Homebrew's `python3` has none of the packages): `python3.13 ~/social-assets/watch/watch.py "<link>" --note "why I saved it"`. Add `--cookies chrome` if Instagram asks for a login.

## How it works
1. `yt-dlp` downloads the video and the post's details.
2. `ffmpeg` finds every cut (scene change) and pulls one frame per shot. Long takes get a frame every few seconds. 24 frames max.
3. Parakeet (the same speech model as the talking head editor, via sherpa-onnx) writes the transcript with a time on every word.
4. Apple Vision (`ocr.swift`, built into macOS) reads the on-screen text in each frame.
5. `watch.py` writes `report.md` and the contact sheet.
6. `edit.py` reads the video at 10 frames a second with OpenCV (optical flow for camera moves and zooms, feature matching for punch-ins, colour histograms for cuts and dissolves), runs Apple Vision 3 times a second for text boxes and faces, and finds audio hits with numpy.

## Setup on the Mac (once)
1. `git -C ~/social-assets pull` (or clone it).
2. `python3.13 -m pip install --user yt-dlp sherpa-onnx numpy pillow opencv-python-headless`
3. ffmpeg + ffprobe without Homebrew: download the macOS builds from https://ffmpeg.martin-riedl.de into `~/.local/bin` and make them executable.
4. Skill: `cp -R ~/social-assets/watch/skill/watch-video ~/.claude/skills/`
5. Phone intake:
   - `mkdir -p ~/.config/video-watch && openssl rand -hex 16 > ~/.config/video-watch/token`
   - `pm2 start ~/social-assets/watch/server.py --name video-watch --interpreter python3.13 && pm2 save`
   - n8n: Import from URL `https://raw.githubusercontent.com/grahamivyco/social-assets/main/watch/n8n-video-watch.json`, then Publish.
   - iPhone Shortcut "Watch with Claude": Show in Share Sheet, accepts URLs and Text. Actions: **Get Contents of URL** `https://overthrow-spoken-verbalize.ngrok-free.dev/webhook/watch`, Method POST, Request Body JSON: `url` = Shortcut Input, `token` = the token, `note` = Ask for Input (optional). Then **Show Notification** with the result's `message`.

## Viral scout
Weekly outlier finder + pattern report across top creators: see `scout/README.md`.

## Files
- `watch.py`: the tool. `ocr.swift`: on-screen text. `server.py`: phone intake (127.0.0.1:5680, needs the token).
- `build-workflow.py` builds `n8n-video-watch.json`.
- `patterns.py`: pattern report and hook bank across everything watched (`scout/` runs it weekly).
- `skill/watch-video/SKILL.md`: how Claude reads the folder and writes the breakdown.
- Speech uses `../reels/editor/thedit.py` (set `WATCH_EDITOR` to point elsewhere). Output folder: `WATCH_OUT`.
