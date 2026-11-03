#!/usr/bin/env python3
"""Reel project helper: one folder per video, the 7 steps in order, Graham's approvals on record, safe cleanup.

  reel.py new <raw-video> [--name slug]        project folder, original kept read-only, transcript with word times
  reel.py status <project>                     steps done, what is next, who it waits on
  reel.py done <project> <step> [--file f]     a build step finished (rough_cut, plan, opening, full)
  reel.py approve <project> <step> --said "…" [--file f]   Graham said yes to that step, in his words
  reel.py direction <project> "…"              Graham's creative direction (after the rough cut is approved)
  reel.py note <project> "…"                   anything the next chat should know
  reel.py temp <project> <path>...             mark files as safe to delete and recreate
  reel.py finish <project>                     only after the final approval: copy that exact file to final/, then cleanup
  reel.py cleanup <project> [--apply]          dry run unless --apply; removes only files marked temp
  reel.py lesson <style> "mistake -> fix"      keep a lesson with the style it belongs to

Projects live in $REEL_PROJECTS (default "~/Downloads/Open Frame LLC & Clients/Reels"); styles in $REEL_STYLES
(default ".../Signature Style"). A preview or "keep going" is never final approval: `approve final` needs the file
and Graham's own words, and `finish` checks the file is unchanged since he approved it. Free tools only.
"""
import argparse, datetime, hashlib, json, os, re, shutil, stat, subprocess, sys
from pathlib import Path

BASE = Path(os.path.expanduser("~/Downloads/Open Frame LLC & Clients"))
PROJECTS = Path(os.environ.get("REEL_PROJECTS", BASE / "Reels"))
STYLES = Path(os.environ.get("REEL_STYLES", BASE / "Signature Style"))
THEDIT = Path(__file__).resolve().parent.parent / "editor" / "thedit.py"
# the order Graham set (2026-11-03). `who` = who acts next; approvals are always Graham's
STEPS = [
    ("transcript", "claude", "Own folder, original kept safe, transcript with word timings"),
    ("rough_cut", "claude", "Playable rough cut with sound: mistakes, repeat takes and dragging pauses out"),
    ("rough_cut_ok", "graham", "Graham approves the rough cut"),
    ("direction", "graham", "Graham's creative direction, extra clips, images or music (offer ideas if he's unsure)"),
    ("plan", "claude", "Beat-by-beat plan: captions, cutaways, graphics, camera moves, pacing, sound, transitions"),
    ("plan_ok", "graham", "Graham approves the plan"),
    ("opening", "claude", "First 10 to 15 s built from the plan, with sound (whole Reel if shorter)"),
    ("opening_ok", "graham", "Graham approves the opening (update the plan if his notes change it)"),
    ("full", "claude", "Full video, checked frame by frame before showing"),
    ("final_ok", "graham", "Graham clearly approves one specific final file"),
    ("finished", "claude", "That exact file saved to final/, notes updated, temp files cleaned"),
]
NAMES = [s[0] for s in STEPS]
KEEP = ("original", "final", "edit.json", "transcript.md", "words.json", "project.json", "notes.md", "plan.md")

def now(): return datetime.datetime.now().isoformat(timespec="seconds")
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(d): return json.loads((Path(d) / "project.json").read_text())
def save(d, pj): (Path(d) / "project.json").write_text(json.dumps(pj, indent=2))
def log(d, text):
    with open(Path(d) / "notes.md", "a") as f: f.write(f"- {now()} {text}\n")

def next_step(pj):
    for n in NAMES:
        if n not in pj["steps"]: return n
    return None

def need(pj, step):
    i = NAMES.index(step)
    missing = [n for n in NAMES[:i] if n not in pj["steps"]]
    if missing: sys.exit(f"Not yet: '{step}' comes after {', '.join(missing)}. Use the order Graham set.")

def cmd_new(a):
    raw = Path(a.video).expanduser().resolve()
    if not raw.exists(): sys.exit(f"no such file: {raw}")
    slug = a.name or re.sub(r"[^a-z0-9]+", "-", raw.stem.lower()).strip("-")
    d = Path(a.root or PROJECTS) / f"{datetime.date.today()}-{slug}"
    if d.exists(): sys.exit(f"already exists: {d}")
    for sub in ("original", "work", "previews", "final"): (d / sub).mkdir(parents=True)
    orig = d / "original" / raw.name
    shutil.copy2(raw, orig); os.chmod(orig, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)  # read-only, never edited
    pj = {"name": slug, "created": now(), "original": str(orig), "original_sha256": sha(orig), "style": a.style,
          "steps": {}, "temp": [], "approvals": []}
    save(d, pj); (d / "notes.md").write_text(f"# {slug}\n\nStyle: {a.style}. Original: original/{raw.name} (read-only).\n\n## Log\n")
    if not a.no_transcribe:
        subprocess.run([sys.executable, str(THEDIT), "transcribe", str(orig), str(d / "work")], check=True)
        pj["steps"]["transcript"] = {"at": now(), "file": "work/transcript.md"}; save(d, pj)
        log(d, "transcript done (work/transcript.md, edit.json)")
    print(d)

def cmd_status(a):
    pj = load(a.project)
    for n, who, what in STEPS:
        s = pj["steps"].get(n); mark = "x" if s else " "
        extra = f"  ({s.get('file') or s.get('said', '')})" if s else ""
        print(f"[{mark}] {n:12} {what}{extra}")
    nx = next_step(pj)
    if nx: print(f"\nNext: {nx}, waiting on {dict((s[0], s[1]) for s in STEPS)[nx]}")
    else: print("\nDone.")

def cmd_done(a):
    pj = load(a.project)
    if a.step not in NAMES or dict((s[0], s[1]) for s in STEPS)[a.step] != "claude" or a.step == "finished":
        sys.exit(f"'{a.step}' is not a build step. Build steps: transcript, rough_cut, plan, opening, full")
    need(pj, a.step)
    pj["steps"][a.step] = {"at": now(), **({"file": a.file} if a.file else {})}; save(a.project, pj)
    log(a.project, f"{a.step} ready{' -> ' + a.file if a.file else ''}. Show Graham with sound and wait for his answer.")
    print(f"{a.step} recorded. Now show it to Graham and wait.")

def cmd_approve(a):
    pj = load(a.project); step = a.step if a.step.endswith("_ok") else a.step + "_ok"
    if step not in NAMES: sys.exit(f"nothing to approve called {a.step}")
    need(pj, step)
    if not a.said or len(a.said.strip()) < 2: sys.exit("Quote what Graham said. An approval needs his own words.")
    if re.fullmatch(r"\s*(keep going|continue|next|go on|looks good so far)\W*", a.said, re.I) and step == "final_ok":
        sys.exit("That reads as 'keep going', not final approval. Ask Graham to approve this specific file.")
    rec = {"at": now(), "said": a.said}
    if step == "final_ok":
        if not a.file: sys.exit("Final approval needs the exact file he approved: --file")
        f = (Path(a.project) / a.file) if not Path(a.file).is_absolute() else Path(a.file)
        if not f.exists(): sys.exit(f"no such file: {f}")
        rec.update(file=str(f), sha256=sha(f))
    elif a.file: rec["file"] = a.file
    pj["steps"][step] = rec; pj["approvals"].append({"step": step, **rec}); save(a.project, pj)
    log(a.project, f"Graham approved {step}: \"{a.said}\"")
    print(f"{step} approved.")

def cmd_direction(a):
    pj = load(a.project); need(pj, "direction")
    pj["steps"]["direction"] = {"at": now(), "said": a.text}; save(a.project, pj)
    log(a.project, f"direction: {a.text}"); print("direction recorded")

def cmd_note(a): log(a.project, a.text); print("noted")

def inside(d, p):
    try: Path(p).resolve().relative_to(Path(d).resolve()); return True
    except ValueError: return False

def cmd_temp(a):
    pj = load(a.project); d = Path(a.project)
    for p in a.paths:
        rel = os.path.relpath(Path(p).resolve(), d.resolve())
        if not inside(d, p) or rel.split(os.sep)[0] in KEEP or rel in KEEP: sys.exit(f"refusing to mark {p} as temp")
        if rel not in pj["temp"]: pj["temp"].append(rel)
    save(d, pj); print(f"{len(pj['temp'])} temp paths")

def cleanup(d, apply):
    pj = load(d); d = Path(d); gone = []
    for rel in pj["temp"]:
        p = d / rel
        if rel.split(os.sep)[0] in KEEP or not inside(d, p) or not p.exists(): continue
        gone.append(rel)
        if apply: shutil.rmtree(p) if p.is_dir() else p.unlink()
    if apply:
        pj["temp"] = [r for r in pj["temp"] if r not in gone]; save(d, pj); log(d, f"cleanup removed {len(gone)} temp paths")
    print(("removed: " if apply else "would remove (dry run): ") + (", ".join(gone) or "nothing"))

def cmd_cleanup(a): cleanup(a.project, a.apply)

def cmd_finish(a):
    pj = load(a.project); need(pj, "finished"); fin = pj["steps"]["final_ok"]; f = Path(fin["file"])
    if not f.exists() or sha(f) != fin["sha256"]: sys.exit("The approved file changed or is missing since Graham approved it. Show him again.")
    if sha(pj["original"]) != pj["original_sha256"]: sys.exit("The original recording changed. Stop and tell Graham.")
    out = Path(a.project) / "final" / f.name
    if f.resolve() != out.resolve(): shutil.copy2(f, out)
    assert sha(out) == fin["sha256"]
    pj["steps"]["finished"] = {"at": now(), "file": str(out.relative_to(a.project))}; save(a.project, pj)
    log(a.project, f"finished: final/{f.name} saved (same file Graham approved)")
    cleanup(a.project, True); print(out)

def cmd_lesson(a):
    p = STYLES / a.style / "lessons.md"; p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists(): p.write_text(f"# Lessons for the {a.style} style\n\nMistakes we fixed. Only lasting ones; one-off requests stay in that Reel's notes.\n\n")
    with open(p, "a") as f: f.write(f"- {datetime.date.today()} {a.text}\n")
    print(p)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("new"); p.add_argument("video"); p.add_argument("--name"); p.add_argument("--root"); p.add_argument("--style", default="open-frame"); p.add_argument("--no-transcribe", action="store_true"); p.set_defaults(f=cmd_new)
    p = sp.add_parser("status"); p.add_argument("project"); p.set_defaults(f=cmd_status)
    p = sp.add_parser("done"); p.add_argument("project"); p.add_argument("step"); p.add_argument("--file"); p.set_defaults(f=cmd_done)
    p = sp.add_parser("approve"); p.add_argument("project"); p.add_argument("step"); p.add_argument("--said", required=True); p.add_argument("--file"); p.set_defaults(f=cmd_approve)
    p = sp.add_parser("direction"); p.add_argument("project"); p.add_argument("text"); p.set_defaults(f=cmd_direction)
    p = sp.add_parser("note"); p.add_argument("project"); p.add_argument("text"); p.set_defaults(f=cmd_note)
    p = sp.add_parser("temp"); p.add_argument("project"); p.add_argument("paths", nargs="+"); p.set_defaults(f=cmd_temp)
    p = sp.add_parser("cleanup"); p.add_argument("project"); p.add_argument("--apply", action="store_true"); p.set_defaults(f=cmd_cleanup)
    p = sp.add_parser("finish"); p.add_argument("project"); p.set_defaults(f=cmd_finish)
    p = sp.add_parser("lesson"); p.add_argument("style"); p.add_argument("text"); p.set_defaults(f=cmd_lesson)
    a = ap.parse_args(); a.f(a)
