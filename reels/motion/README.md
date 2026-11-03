# Motion scenes

Small branded motion graphics rendered from HTML. Free tools only: Chromium (Playwright) and ffmpeg.
Every scene is a pure function of time, so any frame renders the same way every time.

## Render
```
node render.js scenes/frame-flip.html out.mp4                 # 1080x1920, 30 fps, silent H.264
node render.js scenes/frame-flip.html out.png --still 4.2     # one frame
node render.js scenes/frame-flip.html sheet.jpg --sheet 0.3   # contact sheet, a frame every 0.3 s
node render.js scenes/frame-flip.html out.mp4 --params '{"cta":"Book a free consult"}'
```
Videos are silent. Add the trending sound in the Instagram app. For Facebook 1:1, run the result through `/mnt/project-files/automation/export/social-export.sh`.

## Scenes

### `frame-flip.html` (Open Frame)
A thin rectangle holds the words. The sparkle sweeps across it, left to right for each question and back for its answer, and the new line is revealed behind it as it passes. At the end the rectangle shrinks into the Open Frame mark: its top-right corner opens and the sparkle settles in the middle, so the logo is fixed. Then the free consult. (v3, Graham 2026-11-03.)
- Params: `pairs` ([[question, answer], ...]), `cta`, `link`.
- Questions are cream, answers take the pair's accent (red, blue, yellow, green). Helvetica Neue Bold, upright (system font on the Mac, Liberation Sans on Linux).
- Timing: 0.62 s sweep, 1.05 s hold on a question, 1.25 s on an answer; 4 pairs = 18 s.

### `sketch-to-guide.html` (any client with a mark, default NGM)
Pencil sketch draws on, construction guides and anchor points snap over it, design-tool panels slide in, the clean vector replaces the sketch, a flash through white into the lockup, color versions slide in as bands, palette bars rise, the real brand guide pages drift on a tilted plane, then flat mockups (tee, hanging sign, stickers, app, tote, embroidery hoop, name badge, business cards, from `mockups-ngm.js`) with whip cuts on the beat (117 BPM), the guild end card, and an Open Frame sign-off question ("Want your brand to be next?"). 22.2 s.
- Params: `sketch` (path to a real sketch photo, used instead of the traced pencil), `pages[]` (brand guide page images), `credit`, `question`, `cta`.
- Mockups are drawn flat shapes in the client's brand (no stock photos, no outlines). For a new client, copy `mockups-ngm.js` and swap colors and copy.
- Guild fonts load from Google Fonts at render time (fonts are never mirrored in this repo). The Open Frame sign-off card is Helvetica Neue Bold with the accent word in red, no italics.
- The pencil stage is traced from the final mark. If it's used as is, don't caption it as the original sketch.
- Guide pages: `assets/ngm/page-N.jpg`, from `brands/ngm/kit/guidelines.pdf` (`pdftoppm -r 110 -jpeg`).

## Where the techniques came from
Studied from @the.lazystudio (10 Reels watched with `watch/`, 2026-11-03). We take the technique, never their artwork or words.
- Their breakout Reel (353K views vs about 3K typical) is one 16 s shot: kinetic type on black, a red pendulum dot as the wipe edge and the full stop, a small studio lockup that grows at the end. No cuts.
- Their branding Reels run sketch, then vector with construction circles and guides, then lockup, color versions, palette stripes, brand book pages on a tilted grid, then mockups with whip cuts on a 117 BPM beat (11 of 16 cuts land on a hit), then a navy end card with a big faint mark and a credit line.
- Also common on the account: one word per card with a red dot as the period, brand book page-by-page flips, "Your brand next? DM us." end cards.

## Lib
`lib.js` has the easing set (`outExpo`, `inOutSine`, `outBack`...), `prog`, `tw`, `spring` and `beat(n, bpm)`.
