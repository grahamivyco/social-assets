# Reel editing workflow

Graham's order for every Reel (2026-11-03). Use it even if a video skill suggests another order; still follow each tool's technical needs. `reel.py` enforces the order and keeps the record, so any new chat can run `reel.py status <project>` and pick up where the last one stopped.

Read first, every time: [REEL-RULES.md](../editor/REEL-RULES.md), [MOTION-BRIEF.md](MOTION-BRIEF.md), the Reel's style in `Signature Style/<style>/` (draft for Open Frame: [signature-style-open-frame.md](signature-style-open-frame.md)), `/mnt/project-files/brands/design-notes.md`, and the project's `notes.md`.

| # | Step | Helper | Stops for Graham? |
|---|---|---|---|
| 1 | Own folder in Reels, original copied read-only, transcript with word times, captions follow the edited cut | `reel.py new <video>` (runs `thedit.py transcribe`) | no |
| 2 | Playable rough cut **with sound**: mistakes, repeat takes and dragging pauses out, meaning and natural delivery kept | edit `work/edit.json` cuts, `thedit.py render work`, then `reel.py done <p> rough_cut --file …` | **yes**: `reel.py approve <p> rough_cut --said "…"` |
| 3 | Ask for his creative direction and any extra clips, images or music. He owns it; offer 2 or 3 ideas if he's unsure | `reel.py direction <p> "…"` | **yes** |
| 4 | Beat-by-beat plan for the whole Reel in `plan.md`: captions, cutaways, graphics (or real screenshot, per REEL-RULES), camera moves, pacing, sound, transitions. Offer a storyboard of stills if useful | `reel.py done <p> plan --file plan.md` | **yes** |
| 5 | Build the first 10 to 15 s from the plan (the whole Reel if it's shorter), show with sound. Update the plan if his notes change it | `reel.py done <p> opening --file previews/…` | **yes** |
| 6 | Full video. Inspect the render (MOTION-BRIEF, last section) before showing. Changes by talking | `reel.py done <p> full --file previews/…` | **yes** |
| 7 | Only when he clearly approves one specific file. "Keep going" or liking a preview is not final | `reel.py approve <p> final --file … --said "…"`, then `reel.py finish <p>` | final yes |

Approvals reach Graham in Claude (he doesn't use Studio or the Hub): one item at a time, the video attached, a clear question. Silence never approves. Nothing posts from here; posting is a separate yes.

## Exports

Final exports keep the original resolution and frame rate unless Graham asks otherwise. Smaller previews are fine once he's OK with them (the 7 Mbps copies under 25 MB in `Reels/<id>/` are previews).

## Learning

At the finish, log clear mistakes and their fixes with the style they belong to: `reel.py lesson open-frame "what went wrong -> what fixed it"`. Save a lasting style change only when Graham asks; one video's special request stays in that Reel's `notes.md`.

## Cleanup

`reel.py cleanup <p>` is a dry run; `--apply` or `finish` deletes only paths marked with `reel.py temp`, never `original/`, `final/`, `edit.json`, `transcript.md`, `plan.md`, `notes.md` or `project.json`. It leaves unknown files alone, and never touches tools, speech models (`~/.cache/thedit`) or style notes. Tested on throwaway files: out-of-order steps refused, "keep going" refused as final, a changed file after approval refused, original kept read-only, only marked temp files removed.

## Folders on the Mac

`~/Downloads/Open Frame LLC & Clients/`: `Raw` (unedited recordings), `Reels` (Projects: one folder per video), `Signature Style` (branding, examples, saved styles, lessons), `Setup` (tool notes, see [docs/editor-setup-mac.md](../../docs/editor-setup-mac.md)).
