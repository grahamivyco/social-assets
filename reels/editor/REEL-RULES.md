# Reel rules (Graham, 2026-10-20)

These apply to every talking head Reel, for Open Frame and for every client. Graham set them while editing his first practice video.

## Footage
- Color (updated 2026-10-20): by default, keep the phone's original color and HDR (output HEVC 10-bit HLG, the same kind of file the phone records). Graham disliked the heavy filters and tone mapping on the early edits, so don't add looks on my own. Color work is allowed when Graham asks for it or a style calls for it: show him a before/after frame first and keep it subtle.
- Cut ums, stutters, dead air and restarted lines. Keep the last good take of each line.
- When there are several takes, mix the best lines from each. A shape wipe covers every switch between takes.
- Punch in on every other jump cut.

## Text
- All text uses the client's brand fonts and colors from `/mnt/project-files/brands/<client>/brand.json` (fonts in `fonts/`). For Open Frame that's Helvetica Neue Bold for headings and captions (upright, the accent word is a color, never italic; since 2026-11-03, was Fraunces) and Inter for small text, plus the Open Frame palette. Helvetica Neue is a macOS system font, so it's never copied into a repo; Linux previews use Liberation Sans.
- Captions (updated 2026-11-03, replaces one word at a time): 3 words at a time, the word being spoken in a different brand color (Open Frame: yellow #F4BF3A, rest white). No black outline, no shadow, no box, no italics. Font: brand.json `fonts.caption` (Open Frame: Manrope ExtraBold, Graham picked 2026-11-03), else the head font. edit.json `"caption_font"`/`"caption_weight"` override it (any family in the brand's fonts/ folder, editor/fonts or the Mac's system fonts), `"caption_color"`/`"caption_hi"` change the two colors, `"caption_words": 1` brings back one word at a time. Word timing snaps to the audio. Motion graphics use the current brand design: flat shapes, no ink outlines (see brands/design-notes.md).
- All other on-screen text also has no outline and no shadow (Graham, 2026-10-20).
- Covers (Graham, 2026-11-03): full-bleed photo, no colored rim or frame around it (he hated the blue rim), and no logo. Headline in the brand head font with one color accent word.
- Video titles are styled: brand head font, one *italic accent word*, on a background shape. They pop in, then animate out.

## Graphics (updated 2026-10-20)
- Each brand has its own couple of signature Reel graphics, listed under "Reel graphics" in that client's section of `/mnt/project-files/brands/design-notes.md`. Reuse those every time so the client's Reels look consistent. Don't borrow another brand's style.
- Bauhaus is Open Frame only: flat ink-outlined illustrations on bold color fields, simple, fast and minimal. Examples: a screen going off for "marketing", an artboard for "design", a swatch fan for "brand", a browser window for "website", a phone with likes for "social", and a paper airplane that lands on "Done ✓" for "let's talk".
- For every brand: graphics are small, fast and animated, in the brand's colors. They sit at the top, clear of the face, and slide out as the next one comes in.
- A new client with no Reel graphics listed yet: propose two from their brand look, get Graham's OK, then add them to their section.

## Passes (added 2026-10-21, from the 5-pass method Graham sent)
1. Transcribe: every word timestamped in `words.json`. Captions, graphics and sound all sync to it.
2. Cut-out: the speaker is lifted off the background on every frame (soft edges, no outline), so titles and graphics sit behind the head. Captions stay on top. `"cutout": true` in edit.json (default with `pop`). Free local model (RobustVideoMatting).
3. Captions: see Text above.
4. Motion: one scene per idea, each fired on its spoken word. The local AI picks the words and scenes into `keywords`.
5. Sound: sound effects made in code (no licensing): a whoosh on the hook and each take change, a tap on each graphic, a chime on the end card, mixed under the voice, about -14 LUFS. `"sfx": false` turns it off. Still no music, so trending audio goes on in the IG app.

- "Top N" list Reels (2026-10-21): numbered list cards (from `open-frame/list-cards/`) via edit.json `"list": {"spec": "spec.json"}`. Card N slides up when its number or name is said and stays until the next one, behind the speaker cut-out. The list title shows before card 1.

- Split screen (2026-10-21, from Graham's inspo): edit.json `"split": {"screen": "screen.mov"}` hard-cuts every 1.5 to 3 s between the full face and a split view. The screen recording is on top and the face on the bottom, with captions on the seam.
- Numbered items (2026-10-21): `"items": ["Firecrawl", ...]` shows a white "#N Name" pill when item N comes up.

## Deliver
- An IG Reel at 1080x1920 and a Facebook square at 2160x2160, plus an end card with the CTA.
- Each Reel comes with a ready-to-paste caption that has a CTA. Put the full https:// link on its own line, after a blank line.
- No generated music.
- Getting files: the Drive connector can't move files over 10 MB, so Graham AirDrops the footage to his Mac's Downloads. Delivered videos go to `~/Downloads/<Client>/` on his Mac. Copies there must be under 25 MB, so re-encode them at about 7 Mbps.

## Tool
`/mnt/project-files/automation/talking-head/` (see README.md): `thedit.py transcribe`, review `transcript.md` and `edit.json` (`brand`, `hook` with a `*accent*` word, `parts`, `pop: true`, `cover`), then `thedit.py render`. The graphics need playwright-core (`npm i playwright-core@1.56.1`, path in `PW_CORE`) and the Chromium in `/opt/pw-browsers`.

## Hooks and structure (2026-10-21)
Use the hook bank and rules in `/mnt/project-files/lessons/ad-attention-videos.md`. Skeleton: Hook, Problem, Story, Payoff. Record 3 openings per Reel.

## Presets (2026-10-21)
- `"preset": "one-take"` in edit.json (or `"preset"` in the Mac watcher's config.json): one take with only head and tail trimmed, no punch-ins, graphics, cut-out, sound effects or end card, small white 3-word captions 55.6% down (spoken word in yellow), static title on a white rounded box for 4 s. Frame with the face in the top third or set `caption_y`.

## Keywords (Graham, 2026-10-21)
- Every Reel gets 15 search keywords from the local AI: the main one in the hook and the first caption sentence, 1 or 2 more worked into the caption, and all 15 as one plain line above the call to action.
- On screen: the top 3 as a small but readable line where the captions sit, while the hook is up (edit.json `topic_line`). Never hidden or unreadable text. Instagram reads on-screen text it can actually see, and text made to be invisible is a spam pattern that can get a Reel held back.
- Alt text: one plain sentence with the main keyword, saved in caption.md. Instagram's API takes alt text on photos, not on Reels, so it is ready for photo posts and for pasting in the app where Instagram offers an alt text field.

## Beat graphics (2026-10-22)
- Graham asked for graphics that match what he is saying. edit.json `"beats"` picks them by hand, one per idea, on the word that says it: `[{"w": word#, "kind": "pdfs", "label": "Old PDFs", "data": {...}}]`. Kinds in pop.js: pdfs, menu, stock, door, timer, num (data.n), headline, people, button (data.words), sticky, nav (data.items, data.at_w), trash, peek, belong, tuesday, friends, plus the older ones. Labels can take a `\n` for two lines.
- When the background has objects the cut-out grabs (like the wall lamp in his porch shots), set `"cutout": false`. Graphics sit above his head anyway.
- The keyword line under the hook is now one keyword per line, at 3.2% of the height.
- Key point graphics (2026-11-03): centered card in the topic color with a 3x2 grid of animated art plate tiles and the label underneath. No pictograms. `"scene_style": "illustrated"` in edit.json brings back the old drawn ones.

## Graphic or real image (Graham, 2026-11-03)

Every key point visual is one of two things:

- **Real screenshot or photo** (`"kind": "image", "src": "file.png"`): just the screenshot, centered near the top, no border, background or title (Graham, 2026-11-03) when the line is about a specific real thing a viewer could check:
  - a client's actual website, post, ad, email or app screen
  - a real number or result from a dashboard (Instagram insights, Search Console, Calendly)
  - a before and after, a real product, a real place or event
  - a tool's screen when the Reel teaches how to use it
  - a real person, only with their OK
- **Motion graphic** (topic glyphs: `website`, `phone`, `branding`, `people`, `computer`, `shapes`, `trash`) when the line is general advice or an idea ("your website needs one job"), when no real asset exists, or when the real one would show private info.
- Never fake a screenshot or mock up a result that didn't happen. Captions and graphics never invent claims.
- Screenshots: crop the file to the part that matters before it goes in, blur names, emails, DMs and anything private, max about 2.5 s on screen, slow push in. Graham drops them in the Reel's folder; the plan names them line by line.
- If unsure, ask Graham in the graphics plan step instead of guessing.
