# Motion scenes

Small branded motion graphics rendered from HTML. Free tools only: Chromium (Playwright) and ffmpeg.
Every scene is a pure function of time, so any frame renders the same way every time.

## Render
```
node render.js scenes/pendulum.html out.mp4                 # 1080x1920, 30 fps, silent H.264
node render.js scenes/pendulum.html out.png --still 4.2     # one frame
node render.js scenes/pendulum.html sheet.jpg --sheet 0.3   # contact sheet, a frame every 0.3 s
node render.js scenes/pendulum.html out.mp4 --params '{"answer":"Covered"}'
```
Videos are silent. Add the trending sound in the Instagram app. For Facebook 1:1, run the result through `/mnt/project-files/automation/export/social-export.sh`.

## Scenes

### `pendulum.html` (Open Frame)
A red dot on a string swings across the frame. Left of the dot is the answer, right of it the question, so each swing trades "Need a ...?" for the answer and the dot lands as the full stop. On the last swing it sticks, the string drops away and the mark comes up.
- Params: `questions[]`, `answer`, `final`, `line`, `bg`, `fg`, `dot`.
- Timing: true pendulum (cosine), 2.4 s per full swing, question swaps while hidden. 5 questions = 14.2 s.

### `sketch-to-guide.html` (any client with a mark, default NGM)
Pencil sketch draws on, construction guides and anchor points snap over it, design-tool panels slide in, the clean vector replaces the sketch, a flash through white into the lockup, color versions slide in as bands, palette bars rise, the real brand guide pages drift on a tilted plane, then whip cuts through the pages on the beat (117 BPM), then an end card. 16.9 s.
- Params: `sketch` (path to a real sketch photo, used instead of the traced pencil), `pages[]` (brand guide page images), `credit`.
- The pencil stage is traced from the final mark. If it's used as is, don't caption it as the original sketch.
- Guide pages: `assets/ngm/page-N.jpg`, from `brands/ngm/kit/guidelines.pdf` (`pdftoppm -r 110 -jpeg`).

## Where the techniques came from
Studied from @the.lazystudio (10 Reels watched with `watch/`, 2026-11-03). We take the technique, never their artwork or words.
- Their breakout Reel (353K views vs about 3K typical) is one 16 s shot: kinetic type on black, a red pendulum dot as the wipe edge and the full stop, a small studio lockup that grows at the end. No cuts.
- Their branding Reels run sketch, then vector with construction circles and guides, then lockup, color versions, palette stripes, brand book pages on a tilted grid, then mockups with whip cuts on a 117 BPM beat (11 of 16 cuts land on a hit), then a navy end card with a big faint mark and a credit line.
- Also common on the account: one word per card with a red dot as the period, brand book page-by-page flips, "Your brand next? DM us." end cards.

## Lib
`lib.js` has the easing set (`outExpo`, `inOutSine`, `outBack`...), `prog`, `tw`, `spring` and `beat(n, bpm)`.
