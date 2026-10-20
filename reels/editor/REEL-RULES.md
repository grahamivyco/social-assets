# Reel rules (Graham, 2026-10-20)

These apply to every talking head Reel, for Open Frame and for every client. Graham set them while editing his first practice video.

## Footage
- Color (updated 2026-10-20): by default, keep the phone's original color and HDR (output HEVC 10-bit HLG, the same kind of file the phone records). Graham disliked the heavy filters and tone mapping on the early edits, so don't add looks on my own. Color work is allowed when Graham asks for it or a style calls for it: show him a before/after frame first and keep it subtle.
- Cut ums, stutters, dead air and restarted lines. Keep the last good take of each line.
- When there are several takes, mix the best lines from each. A shape wipe covers every switch between takes.
- Punch in on every other jump cut.

## Text
- All text uses the client's brand fonts and colors from `/mnt/project-files/brands/<client>/brand.json` (fonts in `fonts/`). For Open Frame that's Fraunces for headings and captions and Inter for small text, plus the Open Frame palette.
- Captions (updated 2026-10-20): one word at a time, only the word being spoken. Just the letters, in the brand head font, in one brand color (cream/white or a brand accent). No outline, no shadow, no box. Word starts snap to the audio.
- All other on-screen text also has no outline and no shadow (Graham, 2026-10-20).
- Video titles are styled: brand head font, one *italic accent word*, on a background shape. They pop in, then animate out.

## Graphics (updated 2026-10-20)
- Each brand has its own couple of signature Reel graphics, listed under "Reel graphics" in that client's section of `/mnt/project-files/brands/design-notes.md`. Reuse those every time so the client's Reels look consistent. Don't borrow another brand's style.
- Bauhaus is Open Frame only: flat ink-outlined illustrations on bold color fields, simple, fast and minimal. Examples: a screen going off for "marketing", an artboard for "design", a swatch fan for "brand", a browser window for "website", a phone with likes for "social", and a paper airplane that lands on "Done ✓" for "let's talk".
- For every brand: graphics are small, fast and animated, in the brand's colors. They sit at the top, clear of the face, and slide out as the next one comes in.
- A new client with no Reel graphics listed yet: propose two from their brand look, get Graham's OK, then add them to their section.

## Deliver
- An IG Reel at 1080x1920 and a Facebook square at 2160x2160, plus an end card with the CTA.
- Each Reel comes with a ready-to-paste caption that has a CTA. Put the full https:// link on its own line, after a blank line.
- No generated music.
- Getting files: the Drive connector can't move files over 10 MB, so Graham AirDrops the footage to his Mac's Downloads. Delivered videos go to `~/Downloads/<Client>/` on his Mac. Copies there must be under 25 MB, so re-encode them at about 7 Mbps.

## Tool
`/mnt/project-files/automation/talking-head/` (see README.md): `thedit.py transcribe`, review `transcript.md` and `edit.json` (`brand`, `hook` with a `*accent*` word, `parts`, `pop: true`, `cover`), then `thedit.py render`. The graphics need playwright-core (`npm i playwright-core@1.56.1`, path in `PW_CORE`) and the Chromium in `/opt/pw-browsers`.
