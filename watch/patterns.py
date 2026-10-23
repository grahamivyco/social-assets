#!/usr/bin/env python3
"""Pattern report across many watched videos: what the outliers have in common, in a form Open Frame can rebuild.

  patterns.py [--days 30] [--all] [--out DIR]

Reads every watch folder from the last --days (default 30): the viral scout's outliers ("outlier 4.2x @handle")
plus anything Graham saved himself. Writes _patterns/<date>.md (numbers, hook bank, and the local AI's read of the
repeating hooks, formats and edits, with 5 Open Frame rebuilds) and keeps _patterns/hook-bank.md growing.
Local AI: LM Studio on this Mac (WATCH_LLM, WATCH_LLM_MODEL). Without it the report still has the numbers and hooks.
Free tools only.
"""
import argparse, datetime, json, os, re, statistics, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import watch  # noqa: E402

LLM = os.environ.get("WATCH_LLM", "http://127.0.0.1:1234/v1/chat/completions")
try:  # same model setting as every other loop: reels/config.json "model"
    _cfg = json.loads((HERE.parent / "reels" / "config.json").read_text())
except (OSError, ValueError):
    _cfg = {}
MODEL = os.environ.get("WATCH_LLM_MODEL") or _cfg.get("model") or "qwen/qwen3.5-9b"


def row(md, label):
    m = re.search(rf"^\| {re.escape(label)} \| (.*?) \|$", md, re.M)
    return m.group(1).strip() if m else ""


def num(s, pat=r"([\d,.]+)"):
    m = re.search(pat, s or "")
    return float(m.group(1).replace(",", "")) if m else None


def read(folder):
    rep = (folder / "report.md").read_text()
    ed = (folder / "edit.md").read_text() if (folder / "edit.md").exists() else ""
    note = (re.search(r"^> Why it was saved: (.*)$", rep, re.M) or [None, ""])[1]
    ratio = num(note, r"outlier ([\d.]+)x")
    trans = re.findall(r"^- \*\*[\d:.]+\*\* (.*)$", rep, re.M)
    cap = re.search(r"## Caption\n\n(.*?)\n\n## ", rep, re.S)
    return {
        "folder": folder.name, "link": row(rep, "Source"), "creator": row(rep, "Creator"), "note": note,
        "outlier": ratio, "likes": num(row(rep, "Likes")), "comments": num(row(rep, "Comments")),
        "seconds": num(row(rep, "Length")), "cuts": num(row(rep, "Pacing")), "wpm": num(row(rep, "Speech"), r"(\d+) per minute"),
        "hook_said": re.sub(r"^\(nothing\)$", "", (re.search(r"^- Said: (.*)$", rep, re.M) or [None, ""])[1]),
        "hook_screen": re.sub(r"^\(no text\)$", "", (re.search(r"^- On screen: (.*)$", rep, re.M) or [None, ""])[1]),
        "first_line": trans[0] if trans else "", "last_line": trans[-1] if trans else "",
        "transcript": " ".join(trans)[:700], "caption": (cap.group(1).strip()[:300] if cap else ""),
        "transitions": row(ed, "Transitions"), "shot_avg": num(row(ed, "Shot length"), r"avg ([\d.]+)s"),
        "captions": row(ed, "Captions"), "camera": row(ed, "Camera"), "look": row(ed, "Look"),
        "sound": row(ed, "Sound"), "breakdown": (rep.split("## Analysis", 1)[1].strip()[:600] if "## Analysis" in rep else ""),
    }


def ask_llm(videos):
    brief = [{k: v[k] for k in ("creator", "outlier", "likes", "seconds", "wpm", "cuts", "shot_avg", "hook_said",
                                 "hook_screen", "first_line", "last_line", "transitions", "captions", "camera", "sound", "look",
                                 "caption")}
             for v in videos[:40]]
    prompt = (
        "These are short videos that beat their creator's normal engagement (outlier = times their usual likes), "
        "plus some Graham saved himself. Find what repeats. Reply in Markdown using exactly these five headings, "
        "word for word, with nothing added to them:\n"
        "## Hook formulas\n## Formats and concepts\n## Edit patterns\n## Topics that pull\n## 5 rebuilds for Open Frame\n\n"
        "What goes under each:\n"
        "- Hook formulas: each as a fill-in-the-blank template, with 1-2 real examples and @creator.\n"
        "- Formats and concepts: named families, and which videos use them.\n"
        "- Edit patterns: length, pace, cuts, captions, camera, sound, with numbers from the data.\n"
        "- Topics that pull.\n"
        "- 5 rebuilds for Open Frame: each built on one hook formula from above (name it), with a hook line, a 3-beat "
        "outline and the format, in Graham's voice: warm, plain, specific, no hype words. Open Frame is a design and "
        "marketing studio for mission-driven organisations (Minneapolis and Barcelona). Never copy a creator's words. "
        "Where a real client story, number or result is needed, write [placeholder: what Graham should fill in] "
        "instead of inventing one.\n"
        "Only use what is in the data. An empty field means it was not measured: say so, and never write 'all' or "
        "'every' unless every video shows it. Short bullets.\n\nDATA:\n" + json.dumps(brief, ensure_ascii=False))
    # same settings as loops/llm.js for a tight task: thinking off, low temperature
    body = json.dumps({"model": MODEL, "temperature": 0.2, "top_p": 0.9, "top_k": 20, "max_tokens": 6000,
                       "reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False},
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(LLM, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return re.sub(r"^[\s\S]*?</think>\s*", "", json.loads(r.read())["choices"][0]["message"]["content"] or "").strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--all", action="store_true", help="every folder, not just the last --days")
    ap.add_argument("--out", type=Path, default=watch.OUT)
    a = ap.parse_args()
    since = time.time() - a.days * 86400
    folders = [f for f in sorted(a.out.iterdir()) if f.is_dir() and not f.name.startswith(("_", "."))
               and (f / "report.md").exists() and (a.all or (f / "report.md").stat().st_mtime >= since)]
    vids, seen = [], set()
    for v in sorted((read(f) for f in folders), key=lambda v: v["folder"], reverse=True):  # same link twice: keep the newest
        if v["link"] and v["link"] in seen:
            continue
        seen.add(v["link"]); vids.append(v)
    if not vids:
        sys.exit("nothing watched in that window")
    vids.sort(key=lambda v: -(v["outlier"] or 0))
    outl = [v for v in vids if v["outlier"]]
    med = lambda k: (lambda xs: f"{statistics.median(xs):.0f}" if xs else "n/a")([v[k] for v in vids if v[k] is not None])
    med1 = lambda k: (lambda xs: f"{statistics.median(xs):.1f}" if xs else "n/a")([v[k] for v in vids if v[k] is not None])
    one_word = sum(1 for v in vids if re.search(r", 1\.\d words each", v["captions"] or ""))
    with_caps = sum(1 for v in vids if v["captions"])
    today = datetime.date.today().isoformat()
    L = [f"# Viral patterns, {today}", "",
         f"{len(vids)} videos ({len(outl)} from the scout, {len(vids) - len(outl)} you saved), "
         f"{'all time' if a.all else f'last {a.days} days'}.", "",
         "## By the numbers", "", "| | median |", "|---|---|",
         f"| Length | {med('seconds')} s |", f"| Speech | {med('wpm')} words per minute |",
         f"| Cuts | {med('cuts')} |", f"| Average shot | {med1('shot_avg')} s |",
         f"| Captions | {with_caps} of {len(vids)} have them, {one_word} one word at a time |", ""]
    try:
        L += ["## What repeats (local AI)", "", ask_llm(vids), ""]
    except Exception as e:
        L += ["## What repeats", "", f"_Local AI not reachable ({e.__class__.__name__}); start LM Studio and run again, "
              "or ask Claude to read this file and write it._", ""]
    L += ["## Hook bank", "", "| Outlier | Creator | Said in the first 3 s | On screen | Link |", "|---|---|---|---|---|"]
    cell = lambda s: (s or "").replace("|", "/")
    for v in vids:
        tag = f"{v['outlier']}x" if v["outlier"] else "saved"
        L.append(f"| {tag} | "
                 f"{cell(v['creator'])} | {cell(v['hook_said'])} | {cell(v['hook_screen'])} | {v['link']} |")
    L += ["", "## Every video", "", "| Video | Length | WPM | Cuts | Transitions | Captions | Ends with |",
          "|---|---|---|---|---|---|---|"]
    for v in vids:
        L.append(f"| [{v['folder']}](../{v['folder']}/report.md) | {v['seconds'] or ''} | {v['wpm'] or ''} | "
                 f"{int(v['cuts']) if v['cuts'] is not None else ''} | {cell(v['transitions'])} | {cell(v['captions'])} | "
                 f"{cell(v['last_line'])} |")
    d = a.out / "_patterns"
    d.mkdir(exist_ok=True)
    (d / f"{today}.md").write_text("\n".join(L) + "\n")
    bank = d / "hook-bank.md"
    have = bank.read_text() if bank.exists() else "# Hook bank\n\nFirst 3 seconds of every watched video, newest last.\n\n"
    who = lambda v: ", ".join(x for x in (cell(v["creator"]), f"{v['outlier']}x" if v["outlier"] else "") if x)
    new = [f"- {v['hook_said'] or v['hook_screen']} ({who(v)}) {v['link']}"
           for v in vids if v["link"] and v["link"] not in have and (v["hook_said"] or v["hook_screen"])]
    bank.write_text(have + "".join(n + "\n" for n in new))
    print(d / f"{today}.md")


if __name__ == "__main__":
    main()
