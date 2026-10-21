#!/usr/bin/env python3
"""Video watch tool. Turns any Reel, TikTok, YouTube link or local video into something Claude can read.

  watch.py <url-or-file> [--out DIR] [--note TEXT] [--cookies chrome|safari|firefox] [--max-frames 24]

Free tools only: yt-dlp (download), ffmpeg (audio, cuts, frames), Parakeet via sherpa-onnx (speech,
same model as the talking head editor), Apple Vision (on-screen text, macOS only), Pillow (contact sheet).

Writes one folder per video:
  report.md          source, numbers, pacing, hook, shot list with on-screen text and words, transcript
  contact-sheet.jpg  one frame per shot with its time and on-screen text (read this, not the frames)
  frames/            the frames on their own
  words.json         every spoken word with its time
  edit.md            how it's cut: transitions, camera moves, zooms, text timing, layout, color, beat sync (edit.py)
  transitions.jpg    each transition frame by frame; timeline.jpg: frames over cut/motion/text/sound bars
  info.json          what the platform says (caption, likes, views, audio track)
  video.mp4          the download (kept so it can be re-cut or re-watched)
"""
import argparse, datetime, json, os, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EDITOR = Path(os.environ.get("WATCH_EDITOR", HERE.parent / "reels" / "editor"))
# Inside "Open Frame LLC & Clients" because the Downloads sorter sweeps a loose "Open Frame" folder away.
OUT = Path(os.environ.get("WATCH_OUT", Path.home() / "Downloads" / "Open Frame LLC & Clients" / "Watched"))
FONT = EDITOR / "fonts" / "Inter-SemiBold.otf"
SCENE = 0.27        # ffmpeg scene score that counts as a cut
MIN_SHOT = 0.35     # shorter flashes are merged into the shot before


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def slug(s, n=40):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:n] or "video"


def handle(info):
    """@handle without the @. Instagram gives a numeric id there, so fall back to the channel name."""
    h = str(info.get("uploader_id") or "").lstrip("@")
    return info.get("channel") or h if (not h or h.isdigit()) else h


def clock(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


# ---------- get the video ----------

def download(url, work, cookies=None):
    """yt-dlp into work/video.mp4 + work/info.json. Returns the info dict."""
    args = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-progress", "--restrict-filenames",
            "-f", "bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
            "--merge-output-format", "mp4", "--write-info-json", "--write-thumbnail",
            "--convert-thumbnails", "jpg", "-o", str(work / "video.%(ext)s"), url]
    if cookies:
        args[3:3] = ["--cookies-from-browser", cookies]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0 and not cookies and re.search(r"login|cookies|private|rate.?limit|not available", r.stderr, re.I):
        sys.exit("download needs a login. Run again with --cookies chrome (or safari) while signed in to "
                 "Instagram in that browser.\n" + r.stderr.strip()[-400:])
    if r.returncode != 0:
        sys.exit("download failed:\n" + r.stderr.strip()[-600:])
    info = json.loads((work / "video.info.json").read_text())
    (work / "video.info.json").rename(work / "info.json")
    vids = [p for p in work.glob("video.*") if p.suffix in (".mp4", ".mkv", ".webm", ".mov")]
    if vids and vids[0].name != "video.mp4":
        vids[0].rename(work / "video.mp4")
    keep = {k: info.get(k) for k in ("id", "title", "description", "uploader", "uploader_id", "channel",
            "webpage_url", "timestamp", "upload_date", "duration", "view_count", "like_count",
            "comment_count", "repost_count", "track", "artist", "album", "tags", "extractor_key")}
    (work / "info.json").write_text(json.dumps(keep, indent=1, ensure_ascii=False))
    return keep


def probe(video):
    j = json.loads(run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration:stream=codec_type,width,height,r_frame_rate:stream_side_data=rotation",
                        "-of", "json", str(video)]).stdout)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    w, h = v.get("width", 0), v.get("height", 0)
    rot = next((abs(int(sd.get("rotation", 0))) for sd in v.get("side_data_list", []) if "rotation" in sd), 0)
    if rot in (90, 270):
        w, h = h, w
    num, den = (v.get("r_frame_rate") or "30/1").split("/")
    return {"dur": float(j["format"]["duration"]), "w": w, "h": h, "fps": round(int(num) / max(int(den), 1), 2),
            "audio": any(s["codec_type"] == "audio" for s in j["streams"])}


# ---------- listen ----------

def transcribe(video, work):
    wav = work / "audio.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    sys.path.insert(0, str(EDITOR))
    import thedit
    words = thedit.transcribe_words(wav)
    loud = run(["ffmpeg", "-hide_banner", "-i", str(wav), "-af", "ebur128", "-f", "null", "-"]).stderr
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", loud)
    wav.unlink()
    return words, (float(m[-1]) if m else None)


def sentences(words):
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        gap = words[i + 1]["start"] - w["end"] if i + 1 < len(words) else 9
        if re.search(r"[.!?]$", w["w"]) or gap > 0.8:
            out.append(cur); cur = []
    return out + ([cur] if cur else [])


# ---------- look ----------

def cuts(video, dur):
    """Times where the picture changes (hard cuts and big moves)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-an", "-vf",
                        f"scale=320:-2,select='gt(scene,{SCENE})',showinfo", "-f", "null", "-"],
                       capture_output=True, text=True)
    ts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    out = []
    for t in ts:
        if t > MIN_SHOT and t < dur - MIN_SHOT and (not out or t - out[-1] >= MIN_SHOT):
            out.append(round(t, 2))
    return out


def shots(cut_times, dur, max_frames):
    edges = [0.0] + cut_times + [dur]
    sh = [{"start": a, "end": b} for a, b in zip(edges, edges[1:])]
    # Long single-take videos still get a frame every few seconds.
    step = max(dur / max_frames, 4.0)
    out = []
    for s in sh:
        n = max(1, int((s["end"] - s["start"]) // (step * 1.5)) + 1) if s["end"] - s["start"] > step * 1.5 else 1
        seg = (s["end"] - s["start"]) / n
        for k in range(n):
            out.append({"start": round(s["start"] + k * seg, 2), "end": round(s["start"] + (k + 1) * seg, 2),
                        "cut": k == 0})
    while len(out) > max_frames:  # merge the two shortest neighbours
        i = min(range(len(out) - 1), key=lambda i: out[i + 1]["end"] - out[i]["start"])
        out[i] = {"start": out[i]["start"], "end": out[i + 1]["end"], "cut": out[i]["cut"]}
        del out[i + 1]
    for s in out:
        s["at"] = round(min(s["start"] + 0.4 if s["start"] == 0 else (s["start"] + s["end"]) / 2, s["end"] - 0.05), 2)
    return out


def grab(video, shot_list, frames):
    frames.mkdir(exist_ok=True)
    for i, s in enumerate(shot_list, 1):
        p = frames / f"{i:02d}_{s['at']:06.2f}s.jpg"
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(s["at"]), "-i", str(video), "-frames:v", "1",
             "-vf", "scale=540:-2", "-q:v", "4", str(p)])
        s["frame"] = p.name


def ocr(frames_dir):
    """Apple Vision text per frame, {name: text}. Empty when not on a Mac."""
    if sys.platform != "darwin" or not shutil.which("swift"):
        return {}
    r = subprocess.run(["swift", str(HERE / "ocr.swift"), str(frames_dir)], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except ValueError:
        print("ocr skipped:", r.stderr.strip()[-300:], file=sys.stderr)
        return {}


def contact_sheet(frames_dir, shot_list, path, cols=6):
    from PIL import Image, ImageDraw, ImageFont
    ims = [Image.open(frames_dir / s["frame"]).convert("RGB") for s in shot_list]
    tw = 220
    th = max(int(tw * im.height / im.width) for im in ims)
    lab = 64
    font = ImageFont.truetype(str(FONT), 15) if FONT.exists() else ImageFont.load_default()
    small = ImageFont.truetype(str(FONT), 12) if FONT.exists() else font
    rows = -(-len(ims) // cols)
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * (th + lab) + (rows + 1) * 8), "#111110")
    d = ImageDraw.Draw(sheet)
    for i, (im, s) in enumerate(zip(ims, shot_list)):
        x, y = 8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + lab + 8)
        im = im.resize((tw, int(tw * im.height / im.width)))
        sheet.paste(im, (x, y))
        d.text((x + 4, y + th + 4), f"{i + 1}  {clock(s['at'])}  ({s['end'] - s['start']:.1f}s)", fill="#f4bf3a", font=font)
        txt = (s.get("text") or "").replace("\n", " ")
        line, lines = "", []
        for w in txt.split():
            if d.textlength(line + " " + w, font=small) > tw - 8:
                lines.append(line); line = w
            else:
                line = (line + " " + w).strip()
        lines = (lines + [line])[:2] if txt else []
        for k, l in enumerate(lines):
            d.text((x + 4, y + th + 24 + k * 16), l, fill="#f3f1ea", font=small)
    sheet.save(path, quality=82)


# ---------- write ----------

def report(work, src, info, meta, words, lufs, shot_list, note):
    dur = meta["dur"]
    n_cuts = sum(1 for s in shot_list[1:] if s["cut"])
    spoken = sum(w["end"] - w["start"] for w in words)
    wpm = round(len(words) / (dur / 60)) if dur else 0
    hook_words = " ".join(w["w"] for w in words if w["start"] < 3.0)
    for s in shot_list:
        s["said"] = " ".join(w["w"] for w in words if s["start"] <= w["start"] < s["end"])
    L = [f"# {info.get('title') or Path(src).name}", ""]
    if note:
        L += [f"> Why it was saved: {note}", ""]
    L += ["| | |", "|---|---|", f"| Source | {info.get('webpage_url') or src} |"]
    if info.get("uploader") or info.get("channel"):
        L.append(f"| Creator | {str(info.get('uploader') or info.get('channel')).replace('|', '/')} (@{handle(info)}) |")
    if info.get("upload_date"):
        u = info["upload_date"]; L.append(f"| Posted | {u[:4]}-{u[4:6]}-{u[6:]} |")
    for k, lbl in (("view_count", "Views"), ("like_count", "Likes"), ("comment_count", "Comments")):
        if info.get(k) is not None:
            L.append(f"| {lbl} | {info[k]:,} |")
    if info.get("track") or info.get("artist"):
        audio = f"{info.get('track') or ''} {('· ' + info['artist']) if info.get('artist') else ''}".replace("|", "/")
        L.append(f"| Audio | {audio} |")
    L += [f"| Length | {dur:.1f} s, {meta['w']}x{meta['h']}, {meta['fps']} fps |",
          f"| Pacing | {n_cuts} cuts, one every {dur / (n_cuts + 1):.1f} s on average |",
          f"| Speech | {len(words)} words, {wpm} per minute, talking {100 * spoken / dur:.0f}% of the time |"
          if words else "| Speech | none detected (music, text or silent video) |",
          f"| Loudness | {lufs:.1f} LUFS |" if lufs is not None else "| Loudness | no audio |",
          f"| Watched | {datetime.date.today().isoformat()} |", ""]
    if info.get("description"):
        L += ["## Caption", "", info["description"].strip(), ""]
    L += ["## Hook (first 3 seconds)", "",
          f"- Said: {hook_words or '(nothing)'}",
          f"- On screen: {(shot_list[0].get('text') or '(no text)').replace(chr(10), ' / ')}",
          f"- Frame: frames/{shot_list[0]['frame']}", "",
          "## Shot list", "", "Frames are in `contact-sheet.jpg` (one tile per row below).", "",
          "| # | Time | Length | On screen | Said |", "|---|---|---|---|---|"]
    for i, s in enumerate(shot_list, 1):
        cell = lambda t: (t or "").replace("\n", " / ").replace("|", "/")
        L.append(f"| {i} | {clock(s['start'])} | {s['end'] - s['start']:.1f}s{'' if s['cut'] else ' (same shot)'} "
                 f"| {cell(s.get('text'))} | {cell(s['said'])} |")
    L += ["", "## Transcript", ""]
    for sent in sentences(words):
        L.append(f"- **{clock(sent[0]['start'])}** {' '.join(w['w'] for w in sent)}")
    if not words:
        L.append("(no speech)")
    L += ["", "## Analysis", "", "_Not written yet. Ask Claude to watch this folder._", ""]
    (work / "report.md").write_text("\n".join(L))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="link (Instagram, TikTok, YouTube, ...) or a video file")
    ap.add_argument("--out", type=Path, default=OUT, help=f"parent folder (default {OUT})")
    ap.add_argument("--note", default="", help="why this video was saved")
    ap.add_argument("--cookies", help="browser to borrow a login from: chrome, safari, firefox")
    ap.add_argument("--max-frames", type=int, default=24)
    ap.add_argument("--no-edit", action="store_true", help="skip the edit breakdown (edit.md)")
    a = ap.parse_args()

    is_url = re.match(r"https?://", a.src)
    tmp = a.out / f".tmp-{os.getpid()}"
    tmp.mkdir(parents=True, exist_ok=True)
    if is_url:
        try:
            info = download(a.src, tmp, a.cookies)
        except SystemExit:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        video = tmp / "video.mp4"
    else:
        video = Path(a.src).expanduser().resolve()
        info = {"title": video.stem}
    name = f"{datetime.date.today().isoformat()}-{slug(handle(info) or info.get('uploader') or 'file', 20)}-" \
           f"{slug(info.get('id') or video.stem, 24)}"
    work = a.out / name
    if work.exists():
        shutil.rmtree(work)
    tmp.rename(work)
    if is_url:
        video = work / "video.mp4"
        for t in work.glob("video.jpg"):
            t.rename(work / "thumbnail.jpg")
    else:
        (work / "info.json").write_text(json.dumps({"source_file": str(video)}, indent=1))

    meta = probe(video)
    print(f"watching {name}: {meta['dur']:.1f}s")
    words, lufs = transcribe(video, work) if meta["audio"] else ([], None)
    (work / "words.json").write_text(json.dumps(words))
    shot_list = shots(cuts(video, meta["dur"]), meta["dur"], a.max_frames)
    grab(video, shot_list, work / "frames")
    text = ocr(work / "frames")
    for s in shot_list:
        s["text"] = text.get(s["frame"], "")
    contact_sheet(work / "frames", shot_list, work / "contact-sheet.jpg")
    report(work, a.src, info, meta, words, lufs, shot_list, a.note)
    if not a.no_edit:
        try:
            import edit
            edit.run(work, video)
            with open(work / "report.md") as f:
                r = f.read()
            (work / "report.md").write_text(r.replace("## Shot list", "Edit breakdown (transitions, motion, text timing, layout, color, beat): "
                                                      "`edit.md`, `transitions.jpg`, `timeline.jpg`.\n\n## Shot list", 1))
        except Exception as e:  # the report is still useful without it
            print("edit breakdown skipped:", e, file=sys.stderr)
    with open(a.out / "index.md", "a") as f:
        f.write(f"- {datetime.date.today().isoformat()} [{info.get('title') or name}]({name}/report.md)"
                f"{' · ' + a.note if a.note else ''}\n")
    print(work / "report.md")


if __name__ == "__main__":
    main()
