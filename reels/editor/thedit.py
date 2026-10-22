#!/usr/bin/env python3
"""Talking head auto-editor. Free tools only: ffmpeg + sherpa-onnx (Parakeet TDT, runs on CPU).

  thedit.py transcribe <video> <workdir>   mezzanine + word timestamps + transcript.md + edit.json
  (review transcript.md, then edit edit.json: add word ranges to cut, set the hook text)
  thedit.py render <workdir>                cut, burn captions, end card -> workdir/out/*.mp4

Cuts: filler words, every gap longer than max_gap, earlier takes of a repeated line, plus any
word ranges listed in edit.json "cut". Captions are Open Frame style: Manrope 800, cream on ink
blocks, the spoken word in yellow. Outputs: IG Reel 1080x1920 and FB square 2160x2160.
"""
import difflib, json, os, re, subprocess, sys, tarfile, urllib.request, wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"
MARK = Path(os.environ.get("THEDIT_MARK", HERE.parent / "frames" / "assets" / "of-mark.jpg"))
MODEL_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL_NAME}.tar.bz2"
MODEL_DIR = Path(os.environ.get("THEDIT_MODELS", Path.home() / ".cache" / "thedit")) / MODEL_NAME
FPS = 30
FILLERS = re.compile(r"^(u+m+|u+h+|uhm|e+r+m*|a+h+|h+m+|m+h*m+)$")
# Open Frame palette
INK, CREAM, YELLOW = "111110", "f3f1ea", "f4bf3a"
FORMATS = {  # name: (w, h, crop focus 0=top 1=bottom, caption y as share of height, bitrate)
    "reel": (1080, 1920, 0.5, 0.83, "12M"),
    "square": (2160, 2160, 0.55, 0.94, "20M"),
}
# edit.json "preset" (2026-10-21). These settings win over the rest of edit.json.
# "one-take", from @nategaffney's Reel (references/nategaffney-one-take-recipe.md): one locked-off take, only the
# head and tail trimmed, no punch-ins, graphics, cut-out, sound effects or end card, ends on the last word so it
# loops. Small white one-word captions ~55% down, static title on a white rounded box for 4 s.
PRESETS = {
    "one-take": {"one_take": True, "pop": False, "cutout": False, "sfx": False, "endcard": False,
                 "cut_fillers": False, "cut": [], "hook_seconds": 4.0, "caption_words": 1,
                 "caption_color": "ffffff", "caption_y": 0.556, "caption_size": 0.04, "title_box": True},
}


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


M709_2020 = ((0.6274, 0.3293, 0.0433), (0.0691, 0.9195, 0.0114), (0.0164, 0.0880, 0.8956))


def hlg_array(a):
    """sRGB 0-255 array (..., 3) -> HLG BT.2020 0-255, SDR white landing on HLG reference white (75%)."""
    import numpy as np
    c = np.asarray(a, dtype=np.float64) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    e = np.clip(lin @ np.array(M709_2020).T * 0.2650, 0, 1)
    A, B, C = 0.17883277, 0.28466892, 0.55991073
    v = np.where(e <= 1 / 12, np.sqrt(3 * e), A * np.log(np.maximum(12 * e - B, 1e-9)) + C)
    return np.clip(np.round(v * 255), 0, 255).astype(np.uint8)


def hlg_rgb(rgb):
    return tuple(int(x) for x in hlg_array([rgb])[0])


def hlg_hex(h):
    return "%02x%02x%02x" % hlg_rgb((int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)))


def hlg_image(path):
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert("RGB")
    Image.fromarray(hlg_array(np.asarray(im))).save(path)


def ass_color(hexrgb, alpha="00"):
    return f"&H{alpha}{hexrgb[4:6]}{hexrgb[2:4]}{hexrgb[0:2]}".upper()


# ---------- transcribe ----------

def load_model():
    if not (MODEL_DIR / "tokens.txt").exists():
        MODEL_DIR.parent.mkdir(parents=True, exist_ok=True)
        tar = MODEL_DIR.parent / (MODEL_NAME + f".{os.getpid()}.tar.bz2")
        tmp = MODEL_DIR.parent / f".{MODEL_NAME}.{os.getpid()}"
        print("downloading speech model (once, about 640 MB)...")
        urllib.request.urlretrieve(MODEL_URL, tar)
        # unpack beside it and rename, so another run never reads a half-written model
        with tarfile.open(tar) as t:
            t.extractall(tmp)
        tar.unlink()
        if not (MODEL_DIR / "tokens.txt").exists():
            (tmp / MODEL_NAME).replace(MODEL_DIR)
    import sherpa_onnx
    d = MODEL_DIR
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"),
        joiner=str(d / "joiner.int8.onnx"), tokens=str(d / "tokens.txt"),
        model_type="nemo_transducer", num_threads=os.cpu_count() or 4)


def read_wav(path):
    import numpy as np
    with wave.open(str(path)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a


def chunk_bounds(a, sr, size=40.0, slack=4.0):
    """Split long audio near the quietest 100 ms around every `size` seconds."""
    import numpy as np
    n, out, start = len(a), [], 0
    while n - start > (size + slack) * sr:
        lo, hi = int(start + (size - slack) * sr), int(start + (size + slack) * sr)
        win = int(0.1 * sr)
        e = np.convolve(a[lo:hi] ** 2, np.ones(win), "valid")
        cut = lo + int(e.argmin()) + win // 2
        out.append((start, cut)); start = cut
    out.append((start, n))
    return out


def transcribe_words(wav):
    rec, sr = load_model(), 16000
    a = read_wav(wav)
    words = []
    for s0, s1 in chunk_bounds(a, sr):
        st = rec.create_stream(); st.accept_waveform(sr, a[s0:s1]); rec.decode_stream(st)
        r, off = st.result, s0 / sr
        for tok, t, d in zip(r.tokens, r.timestamps, r.durations):
            t, end = t + off, t + off + max(d, 0.08)
            if tok.startswith(" ") or not words or words[-1].get("closed"):
                words.append({"w": tok.strip(), "start": round(t, 3), "end": round(end, 3)})
            else:
                words[-1]["w"] += tok
                words[-1]["end"] = round(max(words[-1]["end"], end), 3)
        if words:
            words[-1]["closed"] = True  # never glue words across chunk boundaries
    for i, w in enumerate(words):
        w.pop("closed", None); w["i"] = i
    return [w for w in words if w["w"]]


def silences(wav, min_len=0.2):
    """Quiet stretches, judged against this recording's own noise floor and speech level."""
    import numpy as np
    a, hop = read_wav(wav), 320  # 20 ms frames at 16 kHz
    n = len(a) // hop
    db = 10 * np.log10((a[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-10)
    floor, speech = np.percentile(db, 10), np.percentile(db, 90)
    quiet = db < floor + 0.35 * (speech - floor)
    out, k = [], 0
    while k < n:
        if quiet[k]:
            j = k
            while j < n and quiet[j]:
                j += 1
            if (j - k) * 0.02 >= min_len:
                out.append((k * 0.02, j * 0.02))
            k = j
        else:
            k += 1
    return out


def trim_to_speech(words, quiet):
    """The model stretches a word until the next one starts. Pull its edges in to where sound stops."""
    for w in words:
        for s0, s1 in quiet:
            if s0 >= w["end"] or s1 <= w["start"]:
                continue
            if s0 > w["start"] + 0.08:
                w["end"] = round(min(w["end"], s0), 3)
            elif s1 < w["end"] - 0.08:
                w["start"] = round(max(w["start"], s1), 3)
    return words


def snap_onsets(words, wav):
    """Line each word's start up with where its sound actually begins (10 ms steps), so the
    highlighted caption word changes exactly when the word is heard."""
    import numpy as np
    a, hop = read_wav(wav), 160
    n = len(a) // hop
    db = 10 * np.log10((a[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-10)
    floor, speech = np.percentile(db, 10), np.percentile(db, 90)
    loud = db > floor + 0.3 * (speech - floor)
    for k, w in enumerate(words):
        lo = int(max(w["start"] - 0.12, words[k - 1]["start"] + 0.05 if k else 0) * 100)
        hi = min(int((w["start"] + 0.25) * 100), n - 1)
        for f in range(max(lo, 5), hi):
            if loud[f] and not loud[f - 5:f].any():  # sound after at least 50 ms of quiet
                w["start"] = round(f / 100, 3)
                w["end"] = max(w["end"], w["start"] + 0.08)
                break
    return words


def sentences(words):
    """Lines end at . ? ! or at a pause long enough to be a restart."""
    out, cur = [], []
    for k, w in enumerate(words):
        cur.append(w)
        nxt = words[k + 1] if k + 1 < len(words) else None
        if re.search(r"[.?!]$", w["w"]) or (nxt and nxt["start"] - w["end"] > 0.7):
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return out


def norm(w):
    return re.sub(r"[^a-z0-9']", "", w["w"].lower())


def find_retakes(sents):
    """An earlier line that the speaker restarts (same opening words) is a dead take."""
    cuts = []
    for i, s in enumerate(sents):
        a = [norm(w) for w in s if not FILLERS.match(norm(w))]
        if len(a) < 2:
            continue
        for j in range(i + 1, min(i + 3, len(sents))):
            b = [norm(w) for w in sents[j]][: len(a) + 2]
            if a[:2] == b[:2] and difflib.SequenceMatcher(None, a, b).ratio() >= 0.6:
                cuts.append({"from": s[0]["i"], "to": s[-1]["i"], "why": f"retake, line {j + 1} says it again"})
                break
    return cuts


def find_stutters(words):
    """Doubled words or phrases said back to back ("I I think", "we we do"): keep the second."""
    cuts, n, k = [], [norm(w) for w in words], 0
    while k < len(n):
        for size in (3, 2, 1):
            if n[k:k + size] == n[k + size:k + 2 * size] and len(n[k:k + size]) == size:
                cuts.append({"from": words[k]["i"], "to": words[k + size - 1]["i"], "why": "stutter"})
                k += size - 1
                break
        k += 1
    return cuts


def cmd_transcribe(video, work):
    work = Path(work); work.mkdir(parents=True, exist_ok=True)
    print("making the 30 fps edit master...")
    trc = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=color_transfer", "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip().split(",")[0]
    # Graham's rule: never change the footage's color. iPhone HDR stays HDR (10-bit HLG) end to end.
    hdr = trc in ("arib-std-b67", "smpte2084")
    run(["ffmpeg", "-v", "error", "-y", "-i", video, "-map", "0:v:0", "-map", "0:a:0",
         "-vf", f"fps={FPS},format={'yuv420p10le' if hdr else 'yuv420p'}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
         "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(work / "master.mkv")])
    run(["ffmpeg", "-v", "error", "-y", "-i", str(work / "master.mkv"), "-vn", "-ac", "1", "-ar", "16000",
         str(work / "speech.wav")])
    print("transcribing...")
    words = trim_to_speech(transcribe_words(work / "speech.wav"), silences(work / "speech.wav"))
    words = snap_onsets(words, work / "speech.wav")
    (work / "words.json").write_text(json.dumps(words, indent=0))
    sents = sentences(words)
    edit = {
        "source": str(Path(video).resolve()),
        "hdr": trc if hdr else "",
        "hook": "",            # big title over the first seconds, e.g. "Great work. Nobody knows about it."
        "hook_seconds": 2.5,
        "endcard": True,       # Open Frame mark + free consult CTA, 2.5 s
        "endcard_lines": ["Book a free 30-min consult", "openframe.design/links"],
        "max_gap": 0.35,       # longer silences get cut down
        "pad_before": 0.08, "pad_after": 0.14,
        "cut_fillers": True,
        "cut": find_retakes(sents) + find_stutters(words),  # add {"from": word#, "to": word#, "why": "..."} to cut fluff
        "formats": list(FORMATS),
        # branded cover (cover.js): built from a frame at "at" seconds of the cut, saved to out/
        # and baked in as the first frame so it is the default cover when posting from the app
        "cover": {"headline": "", "variant": "blue", "at": 1.0},
    }
    (work / "edit.json").write_text(json.dumps(edit, indent=2))
    lines = ["# Transcript", "", "Each line: [first word#-last word#] start time. Cut by adding word ranges to edit.json.", ""]
    for n, s in enumerate(sents, 1):
        text = " ".join(f"~~{w['w']}~~" if FILLERS.match(norm(w)) else w["w"] for w in s)
        lines.append(f"{n}. [{s[0]['i']}-{s[-1]['i']}] {s[0]['start']:.1f}s  {text}")
    (work / "transcript.md").write_text("\n".join(lines) + "\n")
    print(f"{len(words)} words, {len(sents)} lines -> {work}/transcript.md, edit.json")


# ---------- render ----------

def keep_segments(words, edit):
    if edit.get("one_take"):  # one piece: first word to last word, so the loop restarts on the next word
        snap = lambda t: round(t * FPS) / FPS
        return [(snap(max(words[0]["start"] - edit["pad_before"], 0)), snap(words[-1]["end"] + 0.05), list(words))]
    cut = set()
    for c in edit["cut"]:
        cut.update(range(c["from"], c["to"] + 1))
    kept = [w for w in words if w["i"] not in cut and not (edit["cut_fillers"] and FILLERS.match(norm(w)))]
    segs = []
    for w in kept:
        a, b = w["start"] - edit["pad_before"], w["end"] + edit["pad_after"]
        if segs and a - segs[-1][1] <= edit["max_gap"] - edit["pad_before"] - edit["pad_after"]:
            segs[-1][1] = b; segs[-1][2].append(w)
        elif segs and a < segs[-1][1]:  # padding overlap across a cut: split the difference
            mid = (segs[-1][1] + a) / 2; segs[-1][1] = mid
            segs.append([mid, b, [w]])
        else:
            segs.append([max(a, 0), b, [w]])
    # snap to frames so picture and sound cut at the same instant
    snap = lambda t: round(t * FPS) / FPS
    return [(snap(a), snap(b), ws) for a, b, ws in segs if snap(b) > snap(a)]


def remap_words(segs):
    out, t = [], 0.0
    for a, b, ws in segs:
        for w in ws:
            out.append({**w, "start": max(w["start"] - a, 0) + t, "end": min(w["end"], b) - a + t})
        t += b - a
    return out, t


def caption_chunks(words, max_words=3, max_chars=16):
    chunks, cur = [], []
    for k, w in enumerate(words):
        cur.append(w)
        nxt = words[k + 1] if k + 1 < len(words) else None
        text = " ".join(x["w"] for x in cur)
        if (len(cur) >= max_words or len(text) >= max_chars or re.search(r"[.?!,]$", w["w"])
                or nxt is None or nxt["start"] - w["end"] > 0.5):
            chunks.append(cur); cur = []
    return chunks


def ass_text(s):
    return s.replace("\\", "").replace("{", "(").replace("}", ")")


def clean(w):
    return re.sub(r"[.,!]+$", "", w)


def write_ass(path, words, W, H, cap_y, edit):
    br = edit["_brand"]  # brand colors (already in the footage's color space) and head font
    INK, CREAM, YELLOW = br["hex"]["ink"], br["hex"]["cream"], br["hex"]["y"]
    wname = {300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}
    font = f"{br['head']['family']} {wname.get(br['head']['weight'], '')}".strip()
    fs = round(H * edit["caption_size"]) if edit.get("caption_size") else round(W * (0.10 if H > W else 0.075))
    hook_fs = round(W * (0.078 if H > W else 0.062))
    pad = round(fs * 0.22)
    hdr = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{fs},{ass_color(CREAM)},{ass_color(CREAM)},{ass_color(INK)},{ass_color(INK, "80")},0,0,0,0,100,100,0,0,1,0,0,5,{W // 10},{W // 10},0,1
Style: Hook,{font},{hook_fs},{ass_color(CREAM)},{ass_color(CREAM)},{ass_color(INK)},{ass_color(INK, "80")},0,0,0,0,100,100,0,0,1,0,0,8,{W // 12},{W // 12},{round(H * (0.12 if H > W else 0.07))},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ts = lambda t: f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"
    ev = []
    if edit.get("hook") and not edit.get("pop") and not edit.get("title_box"):  # pop.js / title_png draw it otherwise
        ev.append(f"Dialogue: 1,{ts(0)},{ts(edit['hook_seconds'])},Hook,,0,0,0,,{{\\fad(0,200)}}{ass_text(edit['hook'].replace('*', ''))}")
    pos = f"{{\\an5\\pos({W // 2},{round(H * cap_y)})}}"
    # edit.json "topic_line" (Graham, 2026-10-21): search keywords in small plain letters where the captions go,
    # while the hook is up. Readable on purpose: Instagram reads on-screen text, and hidden text is a spam pattern.
    if edit.get("topic_line"):
        ts_end = edit["hook_seconds"] if edit.get("hook") else 2.5
        tl = hlg_hex("ffffff") if edit.get("hdr") else "ffffff"
        # one keyword per line, big enough to read (2026-10-22: one long line at 2.6% was too small)
        tpos = f"{{\\an8\\pos({W // 2},{round(H * edit['topic_y'])})}}" if edit.get("topic_y") else pos  # "topic_y": top of the block, clear of the face
        ev.append(f"Dialogue: 0,{ts(0)},{ts(ts_end)},Cap,,0,0,0,,{tpos}{{\\fs{round(H * 0.032)}\\c{ass_color(tl)}}}"
                  + "\\N".join(ass_text(k.strip()) for k in edit['topic_line'].split("·")))
    seam = f"{{\\an5\\pos({W // 2},{H // 2})}}"
    on_split = lambda t: any(a <= t < b for a, b in edit.get("_split", []))
    # Graham, 2026-10-20: one word at a time, just the word being said, plain letters in the brand accent
    per = edit.get("caption_words", 1)
    # single-word captions are white (Graham, 2026-10-20); "caption_color" overrides, as sRGB hex
    cc = edit.get("caption_color", "ffffff").lstrip("#")
    WORD = hlg_hex(cc) if edit.get("hdr") else cc
    chunks = caption_chunks(words, max_words=per)
    for n, ch in enumerate(chunks):
        nxt = chunks[n + 1][0]["start"] if n + 1 < len(chunks) else 1e9
        for k, w in enumerate(ch):
            a = w["start"]
            # never let a line hang on after the next one starts: one caption on screen at a time
            b = ch[k + 1]["start"] if k + 1 < len(ch) else min(ch[-1]["end"] + 0.15, nxt)
            if edit.get("hook") and b <= edit["hook_seconds"]:
                continue  # the hook title owns the screen while it's up
            if per == 1:
                ev.append(f"Dialogue: 0,{ts(max(a, edit['hook_seconds'] if edit.get('hook') else 0))},{ts(b)},Cap,,0,0,0,,"
                          f"{seam if on_split(a) else pos}{{\\c{ass_color(WORD)}}}{ass_text(clean(w['w']))}")
                continue
            parts = [(f"{{\\i1\\c{ass_color(YELLOW)}}}" if j == k else "") + ass_text(clean(x["w"])) +
                     (f"{{\\i0\\c{ass_color(CREAM)}}}" if j == k else "") for j, x in enumerate(ch)]
            ev.append(f"Dialogue: 0,{ts(max(a, edit['hook_seconds'] if edit.get('hook') else 0))},{ts(b)},Cap,,0,0,0,,{seam if on_split(a) else pos}{' '.join(parts)}")
    Path(path).write_text(hdr + "\n".join(ev) + "\n")


def endcard_png(path, W, H, lines, bg=None, fg=None, head_font=None, hdr=False):
    from PIL import Image, ImageDraw, ImageFont
    bg, fg = bg or CREAM, fg or INK
    im = Image.new("RGB", (W, H), "#" + bg)
    # use the mark's dark strokes as a mask, so its own background never shows as a box
    mark = Image.open(MARK).convert("L").crop((270, 270, 810, 810))
    mask = mark.point(lambda v: max(0, min(255, (200 - v) * 2)))
    s = round(min(W, H) * 0.30)
    mask = mask.resize((s, s), Image.LANCZOS)
    top = round(H * (0.32 if H > W else 0.20))
    im.paste(Image.new("RGB", (s, s), "#" + fg), ((W - s) // 2, top), mask)
    d = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(str(head_font or FONTS / "Fraunces_500Medium.ttf"), round(W * (0.064 if H > W else 0.062)))
    f2 = ImageFont.truetype(str(FONTS / "Inter-SemiBold.otf"), round(W * (0.056 if H > W else 0.048)))
    y = top + s + round(min(W, H) * 0.08)
    for n, line in enumerate(lines):
        f = f1 if n == 0 else f2
        d.text((W / 2, y), line, font=f, fill="#" + fg, anchor="ma")
        y += round(f.size * 1.5)
    im.save(path)
    if hdr:
        hlg_image(path)


def title_png(path, W, H, text, brand, hdr=False):
    """Static title for the one-take preset: brand head font on a white rounded box near the top, the *accent*
    word in italic. Full-frame transparent PNG."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = brand["files"]
    bw, bh = round(W * 0.74), round(H * 0.085)
    size = round(H * 0.052)
    toks = [(t.strip("*"), t.startswith("*")) for t in re.findall(r"\*[^*]+\*|[^\s*]+", text)]
    while True:
        reg, ita = ImageFont.truetype(str(f["head"]), size), ImageFont.truetype(str(f["head_italic"]), size)
        gap = reg.getlength(" ")
        widths = [(ita if it else reg).getlength(w) for w, it in toks]
        total = sum(widths) + gap * (len(toks) - 1)
        if total <= bw * 0.88 or size < 12:
            break
        size -= 2
    x0, cy = (W - bw) // 2, round(H * 0.1675)
    d.rounded_rectangle((x0, cy - bh // 2, x0 + bw, cy + bh // 2), radius=round(bh * 0.28), fill=(255, 255, 255, 255))
    x = (W - total) / 2
    ink = "#" + brand["hex"]["ink"]
    for (w, it), wd in zip(toks, widths):
        d.text((x, cy), w, font=ita if it else reg, fill=ink, anchor="lm")
        x += wd + gap
    im.save(path)
    if hdr:
        hlg_rgba(path)


NUMS = "zero one two three four five six seven eight nine ten eleven twelve".split()
ORDS = ",first,second,third,fourth,fifth,sixth,seventh,eighth,ninth,tenth,eleventh,twelfth".split(",")


def hlg_rgba(path):
    """hlg_image for transparent PNGs: converts the color, keeps the alpha."""
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    a[..., :3] = hlg_array(a[..., :3])
    Image.fromarray(a, "RGBA").save(path)


def list_cards(work, lst, words, dur, hdr):
    """edit.json "list": {"spec": "spec.json"} (open-frame/list-cards format). Numbered cards made by list.js.
    Card N slides up when its number ("three", "3", "third") or its site/label name is said, and stays until
    the next one. The list title shows before the first card. Returns [(png, start, end)]."""
    spec_path = Path(lst["spec"]) if Path(lst["spec"]).is_absolute() else (work / lst["spec"]).resolve()
    spec = json.loads(spec_path.read_text())
    d = work / "list"; d.mkdir(exist_ok=True)
    run(["node", str(HERE / "list.js"), str(spec_path), str(d)])
    key = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())
    ws = [(key(w["w"]), w["start"]) for w in words]
    times, after = [], lst.get("start", 0.0)
    for i, it in enumerate(spec["items"], 1):
        keys = {str(i), NUMS[i] if i < len(NUMS) else "", ORDS[i] if i < len(ORDS) else "",
                key(it.get("domain", "").split(".")[0]), key((it.get("label") or " ").split()[0])} - {""}
        t = next((st for k, st in ws if st > after + 0.2 and k in keys), None)
        if t is None:  # never said: keep the list moving at an even pace
            t = after + (lst.get("each", 2.5) if times else 0.5)
        times.append(min(t, dur - 0.5)); after = times[-1]
    out = [(d / "title.png", 0.0, times[0])] if lst.get("title", True) and times[0] > 0.8 else []
    for i, t in enumerate(times):
        out.append((d / f"card-{i + 1:02d}.png", t, times[i + 1] if i + 1 < len(times) else min(dur, t + lst.get("last", 4.0))))
    if hdr:
        for png, _, _ in out:
            hlg_rgba(png)
    return out


def list_chain(cards, first, inp, outp, W, H, conv):
    """Overlay the list cards on [inp] -> [outp]: a 0.3 s slide-up and fade in at each start."""
    if not cards:
        return f"[{inp}]null[{outp}]"
    g, cur = [], inp
    for k, (_, a, b) in enumerate(cards):
        nxt = outp if k == len(cards) - 1 else f"l{k}"
        g.append(f"[{first + k}:v]scale=-2:{H},{conv},fade=in:st={a:.3f}:d=0.25:alpha=1[c{k}];"
                 f"[{cur}][c{k}]overlay=x=(W-w)/2:y='max(0,1-(t-{a:.3f})/0.3)*{round(H * .06)}':"
                 f"enable='between(t,{a:.3f},{b:.3f})':format=auto[{nxt}]")
        cur = nxt
    return ";".join(g)


def split_segments(sp, words, dur, start):
    """edit.json "split": hard cuts between full face and split screen every 1.5 to 3 s (Graham's inspo,
    2026-10-21). "segments": [[a, b], ...] in output seconds overrides. Cuts snap to the nearest word start."""
    if sp.get("segments"):
        return [(float(a), float(b)) for a, b in sp["segments"]]
    starts = [w["start"] for w in words]
    snap = lambda t: min(starts, key=lambda x: abs(x - t)) if starts and min(abs(x - t) for x in starts) < 0.4 else t
    face, split = sp.get("face", [2.2, 1.6, 2.6]), sp.get("split", [2.8, 2.0, 3.0, 2.4])
    segs, t, k = [], start, 0
    while True:
        a = snap(t + face[k % len(face)])
        b = snap(a + split[k % len(split)])
        if b > dur - 0.4:
            break
        segs.append((a, b)); t, k = b, k + 1
    return segs


def split_chain(segs, si, inp, outp, W, H, PF, hdr, face_y):
    """Split view: screen recording on the top half, the face (cropped from the full shot) on the bottom."""
    on = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in segs)
    sconv = ("zscale=tin=bt709:pin=bt709:min=bt709:t=arib-std-b67:p=bt2020:m=bt2020nc:npl=203,format=yuv420p10le"
             if hdr else "format=yuv420p")
    h2 = H // 2 // 2 * 2
    return (f"[{inp}]format={PF},split[sx1][sx2];[sx2]crop={W}:{h2}:0:{round(H * face_y) // 2 * 2},setsar=1[sxf];"
            f"[{si}:v]scale={W}:{h2}:force_original_aspect_ratio=increase,crop={W}:{h2},setsar=1,fps={FPS},{sconv}[sxs];"
            f"[sxs][sxf]vstack,format={PF}[sxv];[sx1][sxv]overlay=enable='{on}':shortest=1,format={PF}[{outp}]")


def item_pills(work, items, words, dur, W, H, font, hdr):
    """edit.json "items": ["Firecrawl", ...] -> a white "#N Name" pill when item N comes up (its number or
    name is said). Returns [(png, start, end)]."""
    from PIL import Image, ImageDraw, ImageFont
    key = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())
    ws = [(key(w["w"]), w["start"]) for w in words]
    f = ImageFont.truetype(str(font), round(W * 0.046))
    out, after = [], 0.0
    for i, name in enumerate(items, 1):
        keys = {str(i), NUMS[i] if i < len(NUMS) else "", ORDS[i] if i < len(ORDS) else "", key(str(name).split()[0])} - {""}
        t = next((st for k, st in ws if st > after + 0.2 and k in keys), None)
        if t is None:
            continue
        txt = f"#{i} {name}"
        tw_ = f.getbbox(txt)[2]
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        px, py, ph = round(W * .035), round(H * .14), round(W * .095)
        x0 = (W - tw_) // 2 - px
        d.rounded_rectangle((x0, py, x0 + tw_ + 2 * px, py + ph), radius=ph // 2, fill=(255, 255, 255, 255))
        d.text((W // 2, py + ph // 2), txt, font=f, fill=(17, 17, 16, 255), anchor="mm")
        png = work / f"pill-{W}x{H}-{i:02d}.png"
        im.save(png)
        if hdr:
            hlg_rgba(png)
        out.append((png, t, min(dur, t + 1.6))); after = t
    return out


def load_parts(work, edit):
    """One take, or an edit.json "parts" list mixing lines from several takes:
    [{"take": "../work2", "from": 30, "to": 44}, ...] (word numbers from that take's transcript.md)."""
    parts = edit.get("parts") or [{"take": ".", "from": 0, "to": 10 ** 9}]
    out = []
    for p in parts:
        take = (work / p["take"]).resolve()
        words = json.loads((take / "words.json").read_text())
        rng = [w for w in words if p["from"] <= w["i"] <= p["to"]]
        cuts = json.loads((take / "edit.json").read_text())["cut"] if take != work.resolve() else edit["cut"]
        out.append((take / "master.mkv", keep_segments(rng, {**edit, "cut": cuts})))
    return out


def make_covers(work, cut, out, stem, cover, hook, hdr=False):
    """Grab a frame, render the branded covers with cover.js. Returns {format: cover jpg} or {}."""
    if not cover or not (cover.get("headline") or hook):
        return {}
    frame = work / "cover-frame.png"
    sdr = (["-vf", "zscale=tin=arib-std-b67:t=bt709:pin=bt2020:p=bt709:min=bt2020nc:m=bt709:npl=203"]
           if hdr else [])
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(cover.get("at", 1.0)), "-i", str(cut), *sdr, "-frames:v", "1", str(frame)])
    variant = cover.get("variant", "blue")
    if variant not in ("blue", "yellow", "red"):  # cover.js styles; older edit.json files say "arch"
        variant = "blue"
    spec = work / "cover-spec.json"
    spec.write_text(json.dumps({"photo": str(frame), "headline": cover.get("headline") or hook,
                                "variant": variant, "out_dir": str(out)}))
    run(["node", str(HERE / "cover.js"), str(spec)])
    res = {}
    for name, kind in (("reel", "reel"), ("square", "square")):
        src = out / f"cover-{variant}-{kind}.jpg"
        dst = out / f"{stem}-cover-{name}.jpg"
        src.replace(dst); res[name] = dst
        if hdr:  # the posted file is HLG; the jpg in out/ stays standard for uploading as a cover
            hl = work / f"cover-hlg-{name}.png"
            from PIL import Image
            Image.open(dst).save(hl); hlg_image(hl); res[name] = hl
    return res


def cmd_render(work):
    work = Path(work)
    edit = json.loads((work / "edit.json").read_text())
    if edit.get("preset"):
        if edit["preset"] not in PRESETS:
            raise SystemExit(f"unknown preset {edit['preset']!r}, pick one of: {', '.join(PRESETS)}")
        edit.update(PRESETS[edit["preset"]])
    parts = load_parts(work, edit)
    tw, dur = remap_words([s for _, segs in parts for s in segs])
    pieces, part_starts, t = [], [], 0.0  # output-timeline pieces, for punch-ins and wipes
    for _, segs in parts:
        part_starts.append(t)
        for k, (a, b, _) in enumerate(segs):
            pieces.append((t, t + b - a, k == 0)); t += b - a
    print(f"{sum(len(s) for _, s in parts)} pieces from {len(parts)} part(s), {dur:.1f}s kept")
    graph, inputs = [], []
    for k, (master, segs) in enumerate(parts):
        inputs += ["-i", str(master)]
        expr = "+".join(f"between(t,{a:.4f},{b - 0.5 / FPS:.4f})" for a, b, _ in segs)
        aexpr = "+".join(f"between(t,{a:.4f},{b:.4f})" for a, b, _ in segs)
        # level each part on its own so takes from different rooms match
        graph.append(f"[{k}:v]select='{expr}',setpts=N/{FPS}/TB[v{k}];"
                     f"[{k}:a]aselect='{aexpr}',asetpts=N/SR/TB,loudnorm=I=-14:TP=-1.5:LRA=9,"
                     f"aresample=48000,afade=t=in:d=0.02[a{k}]")
    graph.append("".join(f"[v{k}][a{k}]" for k in range(len(parts))) +
                 f"concat=n={len(parts)}:v=1:a=1[v][a]")
    cut = work / "cut.mkv"
    (work / "cut.filter").write_text(";".join(graph))
    run(["ffmpeg", "-v", "error", "-y", *inputs,
         "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-c:a", "pcm_s16le", str(cut)])
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                       "stream=width,height", "-of", "json", str(cut)],
                                      capture_output=True, check=True).stdout)["streams"][0]
    sw, sh = probe["width"], probe["height"]
    out = work / "out"; out.mkdir(exist_ok=True)
    stem = edit.get("name") or Path(edit["source"]).stem
    hdr = bool(edit.get("hdr"))
    from pop import Pop, load_brand
    brand = load_brand(edit.get("brand", "open-frame"), hlg_hex if hdr else (lambda h: h))
    sdr_brand = load_brand(edit.get("brand", "open-frame"))
    edit["_brand"] = brand
    covers = make_covers(work, cut, out, stem, edit.get("cover"), edit.get("hook", "").replace("*", ""), hdr)
    PF = "yuv420p10le" if hdr else "yuv420p"
    # pass 2 (2026-10-21): cut the speaker out so titles and graphics sit behind the head
    from passes import matte, sfx_track
    mat = None
    if edit.get("pop") and edit.get("cutout", True):
        print("cutting the speaker out...")
        mat = matte(cut, work / "matte.mp4", sw, sh)
    cards = list_cards(work, edit["list"], tw, dur, hdr) if edit.get("list") else []
    sp = edit.get("split")
    edit["_split"] = split_segments(sp, tw, dur, edit["hook_seconds"] if edit.get("hook") else 1.0) if sp else []
    # stills and graphics are drawn in standard color; in HDR they are converted into the footage's HLG
    to_pf = (f"scale=out_color_matrix=bt2020:out_range=tv,format={PF}" if hdr else f"format={PF}")
    for name in edit["formats"]:
        W, H, focus, cap_y, rate = FORMATS[name]
        cap_y = edit.get("caption_y", cap_y)
        if sw / sh > W / H:
            cw, ch = int(sh * W / H) // 2 * 2, sh; cx, cy = (sw - cw) // 2, 0
        else:
            cw, ch = sw, int(sw * H / W) // 2 * 2; cx, cy = 0, int((sh - ch) * focus)
        ass = work / f"captions-{name}.ass"
        write_ass(ass, tw, W, H, cap_y, edit)
        vf = f"[0:v]crop={cw}:{ch}:{cx}:{cy},scale={W}:{H}:flags=lanczos,setsar=1,"
        inputs = ["-i", str(cut)]
        subs = f"subtitles=filename='{ass}':fontsdir='{brand['files']['head'].parent}'"
        cconv = ("scale=out_color_matrix=bt2020:out_range=tv,format=yuva420p10le" if hdr else "format=rgba")
        li = (3 if edit.get("endcard") else 1) + (1 if edit.get("pop") else 0) + (1 if mat else 0)
        lchain = lambda a, b: list_chain(cards, li, a, b, W, H, cconv)
        pills = item_pills(work, edit["items"], tw, dur, W, H, FONTS / "Inter-SemiBold.otf", hdr) if edit.get("items") else []
        pi = li + len(cards)
        ti = pi + len(pills)
        tbox = None
        if edit.get("title_box") and edit.get("hook"):
            tbox = work / f"title-{name}.png"
            title_png(tbox, W, H, edit["hook"], brand, hdr)
        si = ti + (1 if tbox else 0)
        tail = f";{list_chain(pills, pi, 'comp', 'compp', W, H, cconv)}"
        if tbox:  # static title, no motion: on for hook_seconds, then gone
            tail += (f";[{ti}:v]{cconv}[tbox];[compp][tbox]overlay=0:0:enable='lt(t,{edit['hook_seconds']:.3f})'"
                     f":format=auto[comptt]")
        top = "comptt" if tbox else "compp"
        if edit["_split"]:
            tail += f";{split_chain(edit['_split'], si, top, 'comps', W, H, PF, hdr, sp.get('face_y', 0.3))};[comps]{subs},format={PF}[main]"
        else:
            tail += f";[{top}]{subs},format={PF}[main]"
        if edit.get("pop"):
            fx = Pop(W, H, tw, pieces, part_starts, dur, brand, edit.get("hook", ""),
                     edit["hook_seconds"] if edit.get("hook") else 0, edit.get("keywords"), edit.get("beats"))
            gfx = work / f"pop-{name}.mov"
            print(f"drawing graphics for {name}...")
            fx.render(gfx, FPS)
            gi = 3 if edit.get("endcard") else 1
            gconv = ("scale=out_color_matrix=bt2020:out_range=tv,format=yuva420p10le" if hdr else "format=rgba")
            zp = f"zoompan=z='{fx.zoom_expr()}':x='iw/2-iw/zoom/2':y='(ih-ih/zoom)*0.35':d=1:s={W}x{H}:fps={FPS}"
            if mat:  # graphics go between the background and the speaker; captions stay on top
                AF = "yuva420p10le" if hdr else "yuva420p"
                vf += (f"{zp},split[bg][fg];[{gi + 1}:v]scale={sw}:{sh},crop={cw}:{ch}:{cx}:{cy},"
                       f"scale={W}:{H}:flags=bicubic,setsar=1,{zp},format=gray[mm];"
                       f"[fg][mm]alphamerge,format={AF}[person];[{gi}:v]{gconv}[gfx];"
                       f"[bg][gfx]overlay=eof_action=pass:format=auto[back0];{lchain('back0', 'back')};"
                       f"[back][person]overlay=format=auto[comp]{tail}")
            else:
                vf += (f"{zp},format={PF}[base];[{gi}:v]{gconv}[gfx];"
                       f"[base][gfx]overlay=eof_action=pass:format=auto[main0];{lchain('main0', 'comp')}{tail}")
        else:
            vf += f"format={PF}[main0];{lchain('main0', 'comp')}{tail}"
        if edit.get("endcard"):
            png = work / f"endcard-{name}.png"
            sb = sdr_brand["hex"]
            endcard_png(png, W, H, edit["endcard_lines"], sb["cream"], sb["ink"], brand["files"]["head"], hdr)
            inputs += ["-loop", "1", "-framerate", str(FPS), "-t", "2.5", "-i", str(png),
                       "-f", "lavfi", "-t", "2.5", "-i", "anullsrc=r=48000:cl=stereo"]
            fc = (vf + f";[1:v]{to_pf},setsar=1,fade=in:st=0:d=0.25:color=0x{brand['hex']['cream']}[card];"
                  "[main][0:a][card][2:a]concat=n=2:v=1:a=1[v][a]")
        else:
            fc = vf + ";[0:a]anull[a];[main]null[v]"
        if edit.get("pop"):
            inputs += ["-i", str(gfx)]
            if mat:
                inputs += ["-i", str(mat)]
        for png, _, _ in cards + pills:
            inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(png)]
        if tbox:
            inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(tbox)]
        if edit["_split"]:
            inputs += ["-stream_loop", "-1", "-i", str((work / sp["screen"]).resolve())]
        if covers:
            ci, one = inputs.count("-i"), f"{1 / FPS:.4f}"
            inputs += ["-loop", "1", "-framerate", str(FPS), "-t", one, "-i", str(covers[name]),
                       "-f", "lavfi", "-t", one, "-i", "anullsrc=r=48000:cl=stereo"]
            fc = (fc.replace("[v]", "[vb]").replace("[a]", "[ab]") +
                  f";[{ci}:v]scale={W}:{H}:flags=lanczos,{to_pf},setsar=1[cov];"
                  f"[cov][{ci + 1}:a][vb][ab]concat=n=2:v=1:a=1[v][a]")
        if edit.get("sfx", True):  # pass 5 (2026-10-21): whoosh on the hook and take changes, tap per graphic, chime to close
            lead = 1 / FPS if covers else 0.0
            cues = ([(lead, "whoosh")] if edit.get("hook") else [])
            if edit.get("pop"):
                cues += [(lead + s["t"], "tap") for s in fx.scenes]
                cues += [(lead + w["t"] - 0.25, "whoosh") for w in fx.wipes if w["t"] < dur - 0.1]
            cues += [(lead + a, "tap") for _, a, _ in pills]
            if edit.get("endcard"):
                cues.append((lead + dur, "chime"))
            wav = sfx_track(work / f"sfx-{name}.wav", lead + dur + (2.5 if edit.get("endcard") else 0) + 0.5, cues)
            si = inputs.count("-i")
            inputs += ["-i", str(wav)]
            fc = (fc.replace("[a]", "[av]") +
                  f";[av][{si}:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]")
        dst = out / f"{stem}-{name}-{W}x{H}.mp4"
        if hdr:  # HEVC 10-bit HLG, the same kind of file the iPhone records, so its color is untouched
            venc = ["-c:v", "libx265", "-pix_fmt", PF, "-profile:v", "main10", "-tag:v", "hvc1", "-preset", "medium",
                    "-b:v", rate, "-maxrate", rate, "-bufsize", "24M",
                    "-x265-params", "keyint=60:min-keyint=60:scenecut=0:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error",
                    "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"]
        else:  # encoder settings match automation/export/social-export.sh
            venc = ["-c:v", "libx264", "-profile:v", "high", "-level", "5.1", "-preset", "slow",
                    "-b:v", rate, "-maxrate", rate, "-bufsize", "24M", "-g", "60", "-keyint_min", "60",
                    "-sc_threshold", "0", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
        run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
             "-r", str(FPS), *venc,
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(dst)])
        print("wrote", dst)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "transcribe":
        cmd_transcribe(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 3 and sys.argv[1] == "render":
        cmd_render(sys.argv[2])
    else:
        sys.exit(__doc__)
