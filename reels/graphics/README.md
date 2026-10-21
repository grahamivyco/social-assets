# Graphics idea loop

Claude watches what you say in each Reel and pitches graphics. You answer yes or pass, then pick one of 3 looks. It builds the pick and keeps it in a library it reuses. Free tools only: LM Studio, Chromium, ffmpeg, GitHub Pages and the Hub.

The idea comes from an inspo Reel (joshuablatch, "How my motion graphics mod thinks").

## The loop
1. **Pitch** (`node loop.js pitch <work dir>`, run by reel-watch after transcribe): the local AI reads the transcript and looks for up to 3 moments a graphic would explain better. Each idea gets logged with the exact line, when it was said, the kind of graphic, and why nothing in `library.json` already works. It only uses numbers and words actually said, and skips ideas the library covers.
2. **Yes / Pass** in the Hub. Change sends a note, for example "show 3 steps, not 4".
3. **3 stills** (`tick`): cream, color and ink looks, with your note applied first. Nothing animates yet.
4. **Pick A, B or C** in the Hub.
5. **Build** (`tick`): animates the pick to a transparent `.mov` in `~/open-frame/graphics/`. It checks its own render first: text that doesn't fit gets one retry with shorter words, and an empty file is flagged. If something still looks off, you get a "check this" card. Otherwise the graphic goes into `library.json`.
6. **Reuse**: `node loop.js redo <id> [look]` rebuilds a library graphic. Change its words or numbers in `library.json` first.

## Graphic kinds (templates.js)
- `stat`: a number that changes (97 to 60), with a bar and a note
- `compare`: before and after
- `steps`: 2 to 4 steps
- `quote`: one line, with one *accent* word

Each kind comes in 3 looks: cream panel, color field, ink panel. They use the client's colors and fonts from `brands/<client>/brand.json`. The panel sits in the top half, so your face stays visible.

## Setup on the Mac (once)
1. Add to `reels/config.json`:
   - `"hub"`: the Hub web app link, ending in /exec
   - `"hubKey"`: the Hub's ADMIN_KEY, from Apps Script > Project settings > Script properties
2. Paste the new Hub `Code.gs`, then go to Deploy > Manage deployments > edit > Version: New version.
3. Start it with `pm2 start reels/graphics/loop.js --name graphics-loop -- watch`, then run `pm2 save`.
4. In reel-watch, after transcribe, run `node graphics/loop.js pitch <work> <video name>`.

## Test
`node render.js spec.json out.png still` renders one look. `anim` makes the `.mov`. It prints `{"warnings":[...]}`.
