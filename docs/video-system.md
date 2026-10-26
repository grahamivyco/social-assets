# Video system and skills

Everything built for Reels: the editor, the AirDrop pipeline, the graphics, the watch and research tools, the Claude skills, and the rules Graham set along the way. Status as of 2026-10-26.

## Where the code lives

- **Editor source of truth:** Graham's project files `automation/talking-head/`. A copy with Mac path overrides lives in [reels/editor/](../reels/editor/). Re-copy when the editor changes.
- **Pipeline:** [reels/](../reels/) (watcher, n8n workflow, media), [reels/graphics/](../reels/graphics/) (graphics idea loop).
- **Research:** [watch/](../watch/) (watch tool, edit breakdown, viral scout, patterns).
- **Loops that feed Reels:** [loops/ideas.js](../loops/ideas.js), [loops/scripts.js](../loops/scripts.js), [loops/asks.js](../loops/asks.js), [loops/audio.js](../loops/audio.js).

## 1. The editor

`thedit.py` turns a raw phone clip into finished Reels. Free tools only: ffmpeg, Python 3.13, Parakeet (sherpa-onnx) on CPU.

```
thedit.py transcribe raw.mov work/   ->  words.json, transcript.md, edit.json
(review transcript.md, adjust edit.json)
thedit.py render work/               ->  work/out/*.mp4 + covers
```

What `transcribe` does:
- Word-level transcript with times, word starts snapped to the audio.
- Pre-fills cuts: ums and uhs, stutters, gaps over 0.35 s, and earlier takes of a restarted line (keeps the last one).

What `render` does:
- Applies the cuts, levels audio to -14 LUFS.
- Burns in captions, title, graphics, cover and end card.
- Outputs an IG Reel at 1080x1920 and a Facebook square at 2160x2160 (FB desktop shows vertical video in a square box, and 1080 looked soft after FB's compression).
- Keeps iPhone HDR as HDR: 10-bit HLG master, HEVC main10 HLG output. Graphics are converted into HLG so they don't look washed out.

`edit.json` options, roughly in the order they were added:

| Key | What it does |
|---|---|
| `cut`, `max_gap` | Word ranges to drop, pause limit |
| `brand` | Client slug, so fonts and colors come from `brands/<client>/brand.json` |
| `hook`, `hook_seconds` | On-screen title, one `*accent*` word in italic |
| `endcard`, `endcard_lines` | End card with the mark and the consult CTA |
| `cover` | Branded cover (headline, variant, frame time), also baked in as frame 1 |
| `parts` | Mix lines from several takes, each loudness-matched |
| `pop` | The pop layer: title on a shape, animated scenes on key words, punch-ins, shape wipes |
| `keywords` | Spoken word to scene, picked by the local AI |
| `cutout` | Lift the speaker off the background so graphics sit behind the head |
| `sfx` | Sound effects made in code |
| `list` | "Top N" numbered cards behind the speaker |
| `split` | Hard cuts between full face and a split view with a screen recording |
| `items` | "#N Name" pills when item N comes up |
| `topic_line` | Top keywords as a small readable line while the hook is up |
| `beats` | Hand-picked graphics, one per idea, on the word that says it (2026-10-22) |
| `preset: "one-take"` | Plain one-take look (head and tail trim only, small white captions, static title box) |

### Supporting files

| File | Role |
|---|---|
| `pop.py` | Plans the pop layer from the transcript: title timing, which scene fires on which word (first time only), punch-ins on every other jump cut, wipes at take changes |
| `pop.js` | Canvas drawing for every scene and wipe. Bauhaus style for Open Frame: flat ink-outlined illustrations on bold color fields, accents cycled red, blue, yellow, green. Beat kinds include pdfs, menu, stock, door, timer, num, headline, people, button, sticky, nav, trash, peek, belong, tuesday, friends |
| `pop-render.js` | Renders pop.js frame by frame in headless Chromium (playwright-core 1.56.1) to a transparent .mov |
| `passes.py` | Pass 2 cut-out (RobustVideoMatting onnx, soft edges) and pass 5 sound (whoosh on hook and take changes, tap on graphics, chime on the end card, made with numpy so nothing needs a license) |
| `cover.js` | Branded covers: the photo fills the cover, a thin color frame, one small Bauhaus shape, headline above the head. Variants arch, circle, ink. Text kept inside the IG grid crop |
| `list.js` | Numbered list cards from a spec (style from a "Top 8 free websites" inspo Reel) |
| `social-export.sh` | Final encode for anything not made by thedit: render at 2x, lanczos downscale, 30 fps, H.264 high, 12 Mbps, 2 s GOP, bt709, AAC 48k. Presets `fb-square`, `fb-feed`, `ig-reel`, `ig-feed` |

## 2. AirDrop to Reel draft (live since 2026-10-21)

```
iPhone  --AirDrop-->  ~/Downloads
   reel-watch.js (pm2)   skips <8 s, >3 min, <12 words
   thedit transcribe
   LM Studio (qwen3.5-9b): hook, cover headline, caption with CTA, 15 keywords, 2-4 graphics on spoken words
   graphics loop pitch (never blocks the Reel)
   thedit render (cut-out, captions, graphics, sfx, cover, end card)
   7 Mbps copies -> ~/Downloads/Open Frame LLC & Clients/Reels/<id>/
   push -> reels/media/<id>/ on GitHub Pages
   POST localhost:5678/webhook/reel-draft  (n8n "Reel drafts")
        2 Queue rows (IG reel, FB square), status in_review, sensitive=yes
   Studio Reels tab card: Post it / Change
```

- Slot: the next weekday at 17:00 Chicago with no other Reel.
- IG Reels default to Trial Reels (shown to non-followers first, graduate on performance).
- Since PR #59, Open Frame IG Reels go to a "Post from your phone" card (video, caption, top sounds) so Graham adds trending audio in the app. The FB copy still auto-posts.
- Captions are "grounded": a caption sentence with numbers or claims that aren't in the transcript gets dropped (the model once invented "We helped many nonprofits").
- Errors go to the Health tab as `reel-drafts`, which becomes a Studio card and one email.
- Raw clips stay on the Mac. This repo is public, so raws are never pushed.

**Honest status:** all 4 automatic drafts from 2026-10-21 were rejected by Graham as "bad, looks terrible" (cut-out put a wall lamp over the graphics, hook box clipped, generic graphics, unreadable keyword line, thin low captions, flat copy). So there's a quality hold. On 2026-10-22/23 Claude re-edited those 4 by hand with matching beat graphics (editor PRs #85 to #87), and the v2s were waiting for Graham's Post it. The automatic path still needs to reach that quality.

## 3. Graphics idea loop

[reels/graphics/](../reels/graphics/), from a joshuablatch "motion graphics mod" inspo Reel.
1. After each transcript, the local AI pitches up to 3 moments a graphic would explain better, using only numbers and words actually said.
2. Studio card: Yes / Pass / Change.
3. Three stills in cream, color and ink looks. Graham picks A, B or C.
4. The pick is animated to a transparent .mov, self-checked (text that doesn't fit gets one retry with shorter words) and saved in `library.json` for reuse.

Kinds: stat, compare, steps, quote.

## 4. Cinematic Reel builder

Graham's project files `open-frame/cinematic-reel/` (overlay.html, render-layers.js, make-reel.sh). From a Reel ad he liked: moody close-up, centered serif headline with one bold phrase, logo under it. Takes a clip or a still and outputs IG 9:16 + FB square, silent. Rev 2 follows the Reel rules (no grading or grain by default, HDR kept). It still needs a real 6 to 10 s moody clip from Graham.

## 5. Research: watching what works

| Tool | What it does |
|---|---|
| **watch.py** ([watch/](../watch/)) | Any IG, TikTok or YouTube link (or a screen recording): yt-dlp download, ffmpeg cut detection with one frame per shot, Parakeet transcript, Apple Vision OCR. Writes `report.md` + `contact-sheet.jpg` in `~/Downloads/Open Frame LLC & Clients/Watched/`. iPhone Share > "Watch with Claude" sends links through ngrok |
| **edit.py** | Frame-level edit breakdown: every transition (hard cut, jump cut, punch-in with zoom, dissolve, fade, flash, whip), camera moves via optical flow, text and caption timing, face position, palette, audio hits and beat sync. Tuned to 6 of 6 on a known test. About 45 s per 1-minute Reel |
| **Viral scout** (n8n, Mon 07:30) | Outliers from big creators in "Viral creators" plus active Creators: likes + 3x comments at least 3x that creator's median over 12 months. Each outlier is watched |
| **patterns.py** (pm2, Mon 12:00) | What the outliers share, plus a hook bank, written by the local AI |
| **audio.js** (Mon 12:30) | Trending sounds from the outliers. Every script names a sound and a backup |
| **Ad and attention lessons** | 4 YouTube talks (Cordeddu, Wiebe, Tuan Le, Dara Denney): steal proven formats, credential first, never lead with the product, Hook / Problem / Story / Payoff, 3 hook takes per Reel, 4+ concept families a month |

Limits: IG gives no view counts or audio names through the API. Cuts inside one half of a split screen are missed.

## 6. Scripts

- `ideas.js` pitches 8 ideas per client each Monday from own stats, viral patterns and past yes/pass.
- `scripts.js` turns each Yes into a one-take script + caption. `asks.js` writes 3 scripts on demand from Studio's button (types: Open Frame, Personal, Viral in my niche).
- 19 scripts seeded in Studio on 2026-10-21 (founder story, trial Reels, trending short ideas). None filmed yet as of 2026-10-25.

## 7. Claude skills used for video

| Skill | Source | Used for |
|---|---|---|
| `watch-video` | this repo, [watch/skill/](../watch/skill/), installed on the Mac | Runs the watch tool and writes the breakdown checked against the Reel rules |
| `video-shotcraft` | Claude plugin | Shot variety and framing |
| `remotion:*` (best-practices, captions, create, render and more) | Claude plugin | Motion-graphics technique reference. Rendering here is done with canvas + Chromium, not Remotion |
| social-media-skills plugin: `talking-head-and-piece-to-camera`, `short-form-video-script`, `reels-script`, `hook-writer`, `captions-and-clipping`, `thumbnail-design`, `platform-specs-and-validation`, `instagram-reels-publishing`, `viral-reverse-engineering`, `trend-jacking`, `capcut`, `descript`, `opus-clip` | Claude plugin | Scripting, hooks, captions, covers, export checks. CapCut, Descript and Opus Clip are technique reference only; their paid features are replaced by thedit and the pop layer |
| `open-frame-content` | Graham's own skill | Brand voice and captions with a CTA |
| **Ootto pack** (54 skills, MIT, [Ootto-AI/claude-content-skills](https://github.com/Ootto-AI/claude-content-skills)) | Installed 2026-10-21 in `~/.claude/skills` on the Mac | Free stand-in for Sandcastles (paid). e.g. `/viral-hook-writer`, `/reel-analyzer`, `/content-factory` |

Rule: use every installed video skill on every edit, free tools only.

## 8. The rules Graham refined

Full file: Graham's project files `automation/talking-head/REEL-RULES.md` (copy at [reels/editor/REEL-RULES.md](../reels/editor/REEL-RULES.md)). The short version, with when each was set:

- **Talking heads only for now** (10-21). Extras become editor graphics, never footage he has to shoot.
- **Color** (10-20): keep the phone's original color and HDR. He hated the early heavy filter and tone mapping. Grading only when he asks, with a before/after first.
- **Captions** (10-20, reconfirmed 10-21): one word at a time, only the spoken word, plain letters in one brand color, no box, outline or shadow.
- **Titles**: brand head font, one italic accent word, on a brand-color shape, pop in then animate out.
- **Brand per client**: every client's text and graphics use their own fonts and colors. Bauhaus scenes are Open Frame only. Each other brand gets its own couple of signature graphics.
- **Graphics** (10-22): should match what he's saying, one per idea, on the word that says it. Small, fast, animated, clear of the face.
- **Covers**: branded, large photo of him with a thin color frame, no captions, baked in as frame 1.
- **Sizes**: IG 9:16 Reels, 4:5 photos and carousels, FB video 1:1 at 2160.
- **Audio**: no generated music (he disliked it, and baked-in music "doesn't do anything for my reels", 10-21). Trending audio is added in the IG app.
- **Keywords** (10-21): 15 per Reel, the main one in the hook and first caption sentence, all 15 as one visible line above the CTA. Never hidden text (a spam pattern).
- **Captions text**: never invent claims. Full https:// link on its own line after a blank line, always with a CTA.
- **Script style** (10-21): no client names needed, "here's what you should do" how-to, line-by-line beats. Hook / Problem / Story / Payoff, 3 hook takes.
- **Founder Reels**: "I have ADHD", never "I'm ADHD". Never imply he creates only for money. Don't lead with AI, say "systems". Private personal topics are kept out by `copyRules` in the Mac config (not in git).
- **Delivery**: Mac copies under 25 MB (about 7 Mbps), into the LLC folder, because his Downloads sorter moves anything in `~/Downloads/Open Frame`.
