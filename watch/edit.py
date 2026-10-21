#!/usr/bin/env python3
"""Edit breakdown for a watched video: how it is cut, moves, looks and lands on the beat.

  edit.py <watch folder>      (watch.py runs this on its own unless --no-edit)

Free tools only: ffmpeg, OpenCV, numpy, Pillow, Apple Vision (text boxes and faces, macOS only).

Writes into the folder:
  edit.md          transitions, camera moves, zooms, text and graphic timing, layout, color, beat sync
  transitions.jpg  every transition frame by frame (0.3 s either side), so the effect can be seen
  timeline.jpg     a frame every second or so over bars for cuts, motion, text on screen and speech
"""
import difflib, json, re, subprocess, sys, tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import watch  # noqa: E402

FPS = 10          # analysis frame rate
W = 180           # analysis width
OCR_FPS = 3       # text and face checks per second (Mac only)
IG_BOTTOM, IG_RIGHT = 0.80, 0.86   # Instagram UI covers below 80% height and right of 86% width


def clock(t):
    return watch.clock(t)


# ---------- read the video ----------

def frames(video, meta, fps=FPS, width=W):
    h = int(round(width * meta["h"] / meta["w"] / 2)) * 2
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale={width}:{h}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, width, 3)


def per_frame(fr):
    """Brightness, saturation, sharpness, colour histogram and optical flow for every analysis frame."""
    import cv2
    n, h, w = fr.shape[:3]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rx, ry = xx - w / 2, yy - h / 2
    rr = np.sqrt(rx ** 2 + ry ** 2) + 1e-6
    out, prev, hprev = [], None, None
    for i in range(n):
        rgb = fr[i]
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
        hist /= hist.sum() + 1e-9
        m = {"luma": float(gray.mean() / 255), "sat": float(hsv[..., 1].mean() / 255),
             "contrast": float(gray.std() / 255), "sharp": float(cv2.Laplacian(gray, cv2.CV_32F).var()),
             "warm": float((rgb[..., 0].astype(int) - rgb[..., 2]).mean() / 255),
             "hdiff": float(np.abs(hist - hprev).sum()) if hprev is not None else 0.0,
             "pdiff": float(np.abs(gray.astype(int) - prev).mean() / 255) if prev is not None else 0.0}
        if prev is not None:
            f = cv2.calcOpticalFlowFarneback(prev.astype(np.uint8), gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            fx, fy = f[..., 0], f[..., 1]
            # what the motion can't explain = new picture coming in (dissolves, graphics, cuts)
            back = cv2.remap(prev.astype(np.uint8), xx + fx, yy + fy, cv2.INTER_LINEAR)
            m["novel"] = float(np.abs(back.astype(int) - gray).mean() / 255)
            m.update(dx=float(np.median(fx)), dy=float(np.median(fy)),
                     mag=float(np.sqrt(fx ** 2 + fy ** 2).mean()),
                     zoom=float(((fx * rx + fy * ry) / rr).mean() / rr.mean()))
        else:
            m.update(dx=0.0, dy=0.0, mag=0.0, zoom=0.0, novel=0.0)
        out.append(m)
        prev, hprev = gray.astype(int), hist
    return out


# ---------- transitions ----------

def scale_between(a, b):
    """How much b is zoomed relative to a (1.2 = punched in 20%), or None when they don't match."""
    import cv2
    ga, gb = (cv2.cvtColor(x, cv2.COLOR_RGB2GRAY) for x in (a, b))
    orb = cv2.ORB_create(400)
    ka, da = orb.detectAndCompute(ga, None)
    kb, db = orb.detectAndCompute(gb, None)
    if da is None or db is None or len(ka) < 12 or len(kb) < 12:
        return None
    ms = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db), key=lambda m: m.distance)[:80]
    if len(ms) < 12:
        return None
    pa = np.float32([ka[m.queryIdx].pt for m in ms]); pb = np.float32([kb[m.trainIdx].pt for m in ms])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=3)
    if M is None or inl is None or inl.sum() < 10:
        return None
    return float(np.sqrt(M[0, 0] ** 2 + M[1, 0] ** 2))


def transitions(fr, pf, hard_cuts, dur):
    """Label each hard cut and find gradual ones (dissolves, fades, flashes) ffmpeg's cut finder misses."""
    n = len(pf)
    out = []
    for t in hard_cuts:
        i = min(max(int(round(t * FPS)), 1), n - 1)
        a, b = max(i - 2, 0), min(i + 1, n - 1)
        kind = "hard cut"
        blur = np.mean([pf[k]["sharp"] for k in range(max(i - 2, 0), min(i + 2, n))])
        base = np.median([p["sharp"] for p in pf[max(i - 15, 0):i + 15]]) or 1
        fast = max(pf[k]["mag"] for k in range(max(i - 2, 1), min(i + 2, n)))
        if pf[i]["hdiff"] < 0.45:
            s = scale_between(fr[a], fr[b])
            kind = ("punch-in" if s and s > 1.07 else "punch-out" if s and s < 0.93 else "jump cut")
            if s:
                kind += f" ({s:.2f}x)"
        if fast > 4 and blur < 0.5 * base:
            kind = "whip / blur transition"
        if any(pf[k]["luma"] > 0.9 for k in range(max(i - 1, 0), min(i + 2, n))) and pf[i]["luma"] > 2 * pf[a]["luma"]:
            kind = "flash"
        out.append({"t": t, "kind": kind})
    # fades and flashes: the picture dips to black or white and comes back
    lum = np.array([p["luma"] for p in pf])
    used = set()
    for dark, test in ((True, lambda v: v < 0.07), (False, lambda v: v > 0.9)):
        i = 0
        while i < n:
            if not test(lum[i]) or i in used:
                i += 1; continue
            a = i
            while a > 0 and (lum[a - 1] > lum[a] + 0.01 if dark else lum[a - 1] < lum[a] - 0.01):
                a -= 1
            b = i
            while b < n - 1 and (test(lum[b + 1]) or (lum[b + 1] > lum[b] + 0.01 if dark else lum[b + 1] < lum[b] - 0.01)):
                b += 1
            around = np.concatenate([lum[max(a - 5, 0):a], lum[b + 1:b + 6]])
            if len(around) and (around.mean() > 0.15 if dark else around.mean() < 0.75):
                span = (b - a + 1) / FPS
                kind = ("fade through black" if dark else "fade through white") if span > 0.25 else \
                       ("cut to black" if dark else "flash")
                out = [t for t in out if not (a - 1) / FPS <= t["t"] <= (b + 1) / FPS]
                out.append({"t": round((a + b) / 2 / FPS, 2), "kind": kind, "len": round(span, 1)})
                used.update(range(a - 1, b + 2))
            i = b + 1
    # gradual: the picture changes a lot over 0.3-1.2 s without one big jump (dissolves, morphs, slides)
    cut_frames = {int(round(t["t"] * FPS)) for t in out}
    i = 1
    while i < n - 3:
        if i in used or any(abs(i - c) <= 4 for c in cut_frames):
            i += 1; continue
        for span in range(3, 13):
            j = i + span
            if j >= n or j in used:
                break
            steps = [pf[k]["hdiff"] for k in range(i + 1, j + 1)]
            nov = [pf[k]["novel"] for k in range(i + 1, j + 1)]
            total = float(np.abs(np.array(hist_at(fr, i)) - np.array(hist_at(fr, j))).sum())
            if total > 0.3 and max(steps) < 0.5 and min(nov) > 0.025 and sum(nov) > 0.2:
                if np.mean([pf[k]["mag"] for k in range(i + 1, j + 1)]) > 2.5:
                    kind = "camera move / reframe (see the strip)"
                elif is_blend(fr[i], fr[(i + j) // 2], fr[j]):
                    kind = "dissolve"
                else:
                    kind = "gradual (slide, morph or animated, see the strip)"
                prev = out[-1] if out and out[-1].get("len") and out[-1]["t"] + out[-1]["len"] / 2 >= i / FPS - 0.3 else None
                if prev and not prev["kind"].startswith(("fade", "flash", "cut to")):   # one long transition, not two
                    start = prev["t"] - prev["len"] / 2
                    prev.update(t=round((start + j / FPS) / 2, 2), len=round(j / FPS - start, 1),
                                kind=next((k for k in ("camera move / reframe (see the strip)", "dissolve") if k in (kind, prev["kind"])), kind))
                    i = j
                    break
                out.append({"t": round((i + j) / 2 / FPS, 2), "kind": kind, "len": round(span / FPS, 1)})
                i = j
                break
        i += 1
    return sorted(out, key=lambda x: x["t"])


def is_blend(a, m, b):
    """True when the middle frame looks like a see-through mix of the two ends (blurred, so motion matters less)."""
    import cv2
    f = lambda x: cv2.resize(cv2.GaussianBlur(x, (0, 0), 3), (24, 42)).astype(float).ravel()
    A, M, B = f(a), f(m), f(b)
    d = A - B
    alpha = float(np.clip(np.dot(M - B, d) / (np.dot(d, d) + 1e-9), 0, 1))
    err = np.abs(M - (alpha * A + (1 - alpha) * B)).mean()
    return 0.1 < alpha < 0.9 and err < 0.9 * min(np.abs(M - A).mean(), np.abs(M - B).mean())


def hist_at(fr, i):
    import cv2
    hsv = cv2.cvtColor(fr[i], cv2.COLOR_RGB2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
    return h / (h.sum() + 1e-9)


# ---------- shots ----------

def camera(pf, a, b):
    """What the camera (or the edit) does inside one shot."""
    seg = pf[a + 1:b] if b - a > 2 else pf[a:b]
    if not seg:
        return "too short", 0.0
    dx = np.array([p["dx"] for p in seg]); dy = np.array([p["dy"] for p in seg])
    z = np.array([p["zoom"] for p in seg]); mag = np.mean([p["mag"] for p in seg])
    pd = np.mean([p["pdiff"] for p in seg])
    moves = []
    if pd < 0.004 and mag < 0.08:
        return "frozen / still image", 0.0
    zs = z.mean() * FPS * 100          # % zoom per second
    if abs(zs) > 2.5:
        moves.append(f"{'zoom in' if zs > 0 else 'zoom out'} {abs(zs):.0f}%/s")
    px, py = dx.mean() * FPS / W * 100, dy.mean() * FPS / W * 100   # % of width per second
    if abs(px) > 6:
        moves.append(f"pan {'left' if px > 0 else 'right'}")
    if abs(py) > 6:
        moves.append(f"tilt {'up' if py > 0 else 'down'}")
    jitter = float(np.std(dx - np.convolve(dx, np.ones(5) / 5, "same"))) if len(dx) > 5 else 0
    if jitter > 0.35:
        moves.append("handheld shake")
    if not moves:
        moves.append("locked off" if mag < 0.4 else "subject moves (camera still)")
    return ", ".join(moves), round(float(mag), 2)


def shot_size(face_h):
    if face_h is None:
        return "no face"
    return ("extreme close-up" if face_h > 0.5 else "close-up" if face_h > 0.3 else
            "medium close-up" if face_h > 0.15 else "medium" if face_h > 0.07 else "wide")


def palette(imgs, k=6):
    from PIL import Image
    strip = np.concatenate([i.reshape(-1, 3) for i in imgs])[::7]
    im = Image.fromarray(strip.reshape(1, -1, 3)).quantize(k, method=Image.Quantize.MEDIANCUT)
    pal = im.getpalette()[:k * 3]
    counts = sorted(im.getcolors(), reverse=True)
    tot = sum(c for c, _ in counts)
    return [("#%02x%02x%02x" % tuple(pal[i * 3:i * 3 + 3]), c / tot) for c, i in counts]


# ---------- text, graphics and faces (Apple Vision) ----------

def vision(video, meta):
    """{time: {"text": [...], "faces": [...]}} at OCR_FPS, or {} off a Mac."""
    if sys.platform != "darwin":
        return {}
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={OCR_FPS},scale=720:-2", "-q:v", "3",
                        f"{d}/f%04d.jpg"], check=True)
        r = subprocess.run(["swift", str(HERE / "ocr.swift"), d, "--boxes"], capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
    except ValueError:
        print("vision skipped:", r.stderr.strip()[-300:], file=sys.stderr)
        return {}
    return {round((int(re.sub(r"\D", "", k)) - 1) / OCR_FPS + 0.5 / OCR_FPS, 2): v for k, v in j.items()}


def faces_cv(fr, i):
    import cv2
    if not hasattr(cv2, "CascadeClassifier"):  # OpenCV 5 dropped it; Apple Vision covers faces on the Mac
        return []
    cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    g = cv2.cvtColor(fr[i], cv2.COLOR_RGB2GRAY)
    h, w = g.shape
    fs = cc.detectMultiScale(g, 1.1, 5, minSize=(12, 12))
    return [{"x": x / w, "y": y / h, "w": fw / w, "h": fh / h} for x, y, fw, fh in fs]


def text_events(vis, words):
    """Group text seen frame to frame into on-screen events with time, place and size."""
    ev = []
    for t in sorted(vis):
        for line in vis[t]["text"]:
            s = line["s"].strip()
            if len(s) < 2:
                continue
            hit = next((e for e in ev if e["end"] >= t - 1.5 / OCR_FPS and
                        difflib.SequenceMatcher(None, e["s"].lower(), s.lower()).ratio() > 0.7 and
                        abs(e["y"] - line["y"]) < 0.08), None)
            if hit:
                hit["end"] = t; hit["n"] += 1
            else:
                ev.append({"s": s, "start": t, "end": t, "n": 1, **{k: line[k] for k in "xywh"}})
    spoken = [(w["start"], re.sub(r"\W", "", w["w"].lower())) for w in words]
    for e in ev:
        e["start"] = round(max(e["start"] - 0.5 / OCR_FPS, 0), 2); e["end"] = round(e["end"] + 0.5 / OCR_FPS, 2)
        toks = [re.sub(r"\W", "", x.lower()) for x in e["s"].split()]
        near = {w for t, w in spoken if e["start"] - 1.5 <= t <= e["end"] + 1.5}
        e["caption"] = bool(toks) and sum(x in near for x in toks) / len(toks) >= 0.6
        e["zone"] = ("top" if e["y"] + e["h"] / 2 < 0.33 else "middle" if e["y"] + e["h"] / 2 < 0.66 else "bottom") + \
                    ("-left" if e["x"] + e["w"] / 2 < 0.36 else "-right" if e["x"] + e["w"] / 2 > 0.64 else "")
        e["covered"] = e["y"] + e["h"] > IG_BOTTOM or e["x"] + e["w"] > IG_RIGHT
    return [e for e in ev if e["n"] >= 1]


# ---------- sound ----------

def onsets(video):
    """Strong audio hits (beats, sound effects, stressed syllables) and a tempo guess."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
                        "-f", "s16le", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768
    if len(a) < 16000:
        return [], None
    hop, win = 256, 1024
    n = (len(a) - win) // hop
    spec = np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(a, win)[::hop][:n] * np.hanning(win), axis=1))
    flux = np.maximum(np.diff(np.log1p(spec), axis=0), 0).sum(1)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    thr = np.percentile(flux, 92)
    hits, last = [], -1
    for i in range(1, len(flux) - 1):
        if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1] and i - last > 6:
            hits.append(round((i + 1) * hop / 16000, 3)); last = i
    env = flux - flux.mean()
    ac = np.correlate(env, env, "full")[len(env) - 1:]
    fps = 16000 / hop
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 70)
    bpm = 60 * fps / (lo + int(np.argmax(ac[lo:hi]))) if hi < len(ac) else None
    strength = ac[lo:hi].max() / (ac[0] + 1e-9) if hi < len(ac) else 0
    return hits, (round(bpm) if bpm and strength > 0.25 else None)


# ---------- pictures ----------

def transition_sheet(video, trans, path, meta):
    from PIL import Image, ImageDraw, ImageFont
    rows = trans[:14]
    if not rows:
        return False
    tw = 120
    th = int(tw * meta["h"] / meta["w"])
    font = ImageFont.truetype(str(watch.FONT), 13) if watch.FONT.exists() else ImageFont.load_default()
    offs = [-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3]
    sheet = Image.new("RGB", (8 + len(offs) * (tw + 4) + 4, 8 + len(rows) * (th + 26)), "#111110")
    d = ImageDraw.Draw(sheet)
    with tempfile.TemporaryDirectory() as tmp:
        for r, tr in enumerate(rows):
            t0 = max(tr["t"] - 0.3 - (tr.get("len", 0) / 2), 0)
            span = 0.6 + tr.get("len", 0)
            subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0:.2f}", "-t", f"{span + 0.05:.2f}", "-i", str(video),
                            "-vf", f"fps={len(offs) / span:.3f},scale={tw}:{th}", "-frames:v", str(len(offs)),
                            f"{tmp}/r{r:02d}_%02d.jpg"], check=True)
            y = 8 + r * (th + 26)
            d.text((8, y), f"{clock(tr['t'])}  {tr['kind']}", fill="#f4bf3a", font=font)
            for c in range(len(offs)):
                p = Path(f"{tmp}/r{r:02d}_{c + 1:02d}.jpg")
                if p.exists():
                    sheet.paste(Image.open(p), (8 + c * (tw + 4), y + 18))
    sheet.save(path, quality=80)
    return True


def timeline(video, meta, pf, trans, ev, words, hits, path):
    from PIL import Image, ImageDraw, ImageFont
    dur = meta["dur"]
    step = max(1.0, dur / 20)
    n = int(dur // step) + 1
    tw = 80
    th = int(tw * meta["h"] / meta["w"])
    font = ImageFont.truetype(str(watch.FONT), 11) if watch.FONT.exists() else ImageFont.load_default()
    Wd = 70 + n * tw
    bars = [("cuts", 14), ("motion", 30), ("text", 14), ("captions", 14), ("speech", 14), ("hits", 14)]
    Ht = th + 20 + sum(h + 4 for _, h in bars) + 8
    im = Image.new("RGB", (Wd, Ht), "#111110")
    d = ImageDraw.Draw(im)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps=1/{step:.3f},scale={tw}:{th}",
                        f"{tmp}/t%03d.jpg"], check=True)
        for k in range(n):
            p = Path(f"{tmp}/t{k + 1:03d}.jpg")
            if p.exists():
                im.paste(Image.open(p), (70 + k * tw, 0))
            if k % max(1, int(5 / step)) == 0:
                d.text((70 + k * tw + 2, th + 3), clock(k * step), fill="#f3f1ea", font=font)
    X = lambda t: 70 + t / step * tw
    y = th + 20
    mags = np.array([p["mag"] for p in pf]); mmax = max(mags.max(), 1e-6)
    for name, h in bars:
        d.text((4, y + h / 2 - 6), name, fill="#f3f1ea", font=font)
        d.rectangle([70, y, Wd - 1, y + h], fill="#222220")
        if name == "cuts":
            for tr in trans:
                x = X(tr["t"]); d.rectangle([x - 1, y, x + 1, y + h], fill="#f4bf3a" if "cut" in tr["kind"] else "#e0569b")
        elif name == "motion":
            for i, m in enumerate(mags):
                x = X(i / FPS); d.line([x, y + h, x, y + h - h * m / mmax], fill="#58b4e8")
        elif name in ("text", "captions"):
            for e in ev:
                if e["caption"] == (name == "captions"):
                    d.rectangle([X(e["start"]), y + 2, X(e["end"]), y + h - 2], fill="#9bd17a")
        elif name == "speech":
            for w in words:
                d.rectangle([X(w["start"]), y + 3, X(w["end"]), y + h - 3], fill="#f3f1ea")
        elif name == "hits":
            for t in hits:
                x = X(t); d.line([x, y, x, y + h], fill="#ff8a3d")
        y += h + 4
    im.save(path, quality=82)


# ---------- write ----------

def run(work, video=None):
    work = Path(work)
    video = Path(video) if video else work / "video.mp4"
    if not video.exists():
        video = Path(json.loads((work / "info.json").read_text()).get("source_file", ""))
    meta = watch.probe(video)
    words = json.loads((work / "words.json").read_text()) if (work / "words.json").exists() else []
    fr = frames(video, meta)
    pf = per_frame(fr)
    dur = meta["dur"]
    hard = watch.cuts(video, dur)
    trans = transitions(fr, pf, hard, dur)
    vis = vision(video, meta)
    ev = text_events(vis, words) if vis else []
    hits, bpm = onsets(video) if meta["audio"] else ([], None)

    edges = [0.0] + [t["t"] for t in trans] + [dur]
    shots = []
    for s, e in zip(edges, edges[1:]):
        if e - s < 0.15:
            continue
        a, b = int(s * FPS), max(int(e * FPS), int(s * FPS) + 1)
        b = min(b, len(pf))
        mid = min((a + b) // 2, len(fr) - 1)
        move, mag = camera(pf, a, b)
        near = [v for t, v in vis.items() if s <= t < e] if vis else []
        fl = [f for v in near for f in v["faces"]] if near else faces_cv(fr, mid)
        face = max(fl, key=lambda f: f["h"]) if fl else None
        seg = pf[a:b] or pf[a:a + 1]
        shots.append({"start": round(s, 2), "end": round(e, 2), "move": move, "mag": mag,
                      "size": shot_size(face["h"] if face else None),
                      "face": face, "luma": np.mean([p["luma"] for p in seg]), "sat": np.mean([p["sat"] for p in seg]),
                      "warm": np.mean([p["warm"] for p in seg])})
    pal = palette([fr[min(int((s["start"] + s["end"]) / 2 * FPS), len(fr) - 1)] for s in shots] or [fr[0]])
    lens = [s["end"] - s["start"] for s in shots]
    sync = [t for t in trans if any(abs(t["t"] - h) <= 0.08 for h in hits)]

    has_sheet = transition_sheet(video, trans, work / "transitions.jpg", meta)
    timeline(video, meta, pf, trans, ev, words, hits, work / "timeline.jpg")

    kinds = {}
    for t in trans:
        k = re.sub(r" \(.*\)", "", t["kind"]); kinds[k] = kinds.get(k, 0) + 1
    caps = [e for e in ev if e["caption"]]
    titles = [e for e in ev if not e["caption"]]
    windows = [sum(1 for t in trans if w <= t["t"] < w + 5) for w in np.arange(0, dur, 5)]
    L = ["# Edit breakdown", "", "Pictures: `timeline.jpg` (frames across the video over cut, motion, text, caption, "
         "speech and audio-hit bars)" + (", `transitions.jpg` (each transition frame by frame)" if has_sheet else "") + ".", "",
         "## Summary", "", "| | |", "|---|---|",
         f"| Transitions | {len(trans)}: " + (", ".join(f"{v} {k}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])) or "none") + " |",
         f"| Shot length | avg {np.mean(lens):.1f}s, shortest {min(lens):.1f}s, longest {max(lens):.1f}s |" if lens else "| Shot length | one shot |",
         "| Cut pace by 5 s | " + " · ".join(str(w) for w in windows) + " |",
         f"| Camera | " + ", ".join(sorted({re.sub(r" \d+%/s", "", m) for s in shots for m in s['move'].split(', ')})) + " |",
         f"| Framing | " + ", ".join(f"{v}× {k}" for k, v in sorted({s['size']: sum(1 for x in shots if x['size'] == s['size']) for s in shots}.items(), key=lambda x: -x[1])) + " |",
         f"| Palette | " + " ".join(f"{c} ({p:.0%})" for c, p in pal) + " |",
         f"| Look | brightness {np.mean([p['luma'] for p in pf]):.0%}, saturation {np.mean([p['sat'] for p in pf]):.0%}, "
         f"contrast {np.mean([p['contrast'] for p in pf]):.0%}, {'warm' if np.mean([p['warm'] for p in pf]) > 0.03 else 'cool' if np.mean([p['warm'] for p in pf]) < -0.03 else 'neutral'} |"]
    if hits:
        L.append(f"| Sound | {len(hits)} strong hits{f', steady beat about {bpm} BPM' if bpm else ', no steady beat (speech or free-time music)'}; "
                 f"{len(sync)} of {len(trans)} transitions land on a hit |")
    if vis:
        if caps:
            wpc = np.mean([len(e["s"].split()) for e in caps])
            L.append(f"| Captions | {len(caps)} shown, {wpc:.1f} words each, {np.mean([e['end'] - e['start'] for e in caps]):.1f}s on screen, "
                     f"mostly {max(set(e['zone'] for e in caps), key=[e['zone'] for e in caps].count)}, text height {np.mean([e['h'] for e in caps]):.0%} of frame |")
        L.append(f"| Titles / graphic text | {len(titles)} |")
        cov = [e for e in ev if e["covered"]]
        if cov:
            L.append(f"| Under the IG buttons | {len(cov)} text items sit where Instagram's UI covers them |")
    else:
        L.append("| Text | not checked (needs Apple Vision on the Mac) |")
    L += ["", "## Transitions", "", "| Time | Type | Lands on a hit |", "|---|---|---|"]
    for t in trans:
        L.append(f"| {clock(t['t'])} | {t['kind']}{f' over {t[chr(108)+chr(101)+chr(110)]}s' if t.get('len') else ''} | "
                 f"{'yes' if t in sync else ''} |")
    if not trans:
        L.append("| | one continuous shot | |")
    L += ["", "## Shots", "", "| # | Time | Length | Camera / motion | Framing | Subject position | Light, colour |",
          "|---|---|---|---|---|---|---|"]
    for i, s in enumerate(shots, 1):
        f = s["face"]
        pos = (f"face at {f['x'] + f['w'] / 2:.0%} across, top {f['y']:.0%} from the top" if f else "")
        L.append(f"| {i} | {clock(s['start'])} | {s['end'] - s['start']:.1f}s | {s['move']} | {s['size']} | {pos} | "
                 f"{s['luma']:.0%} bright, {s['sat']:.0%} sat, {'warm' if s['warm'] > 0.03 else 'cool' if s['warm'] < -0.03 else 'neutral'} |")
    if ev:
        L += ["", "## Text on screen", "", "| In | Out | Kind | Text | Where | Size |", "|---|---|---|---|---|---|"]
        for e in ev[:80]:
            L.append(f"| {clock(e['start'])} | {clock(e['end'])} | {'caption' if e['caption'] else 'title/graphic'} | "
                     f"{e['s'].replace('|', '/')} | {e['zone']}{' (under IG UI)' if e['covered'] else ''} | {e['h']:.0%} tall |")
    L += ["", "_Measured by machine: zoom/pan read the picture's motion, so a moving subject can read as a camera move. "
          "Check the pictures before copying a technique._", ""]
    (work / "edit.md").write_text("\n".join(L))
    return work / "edit.md"


if __name__ == "__main__":
    print(run(sys.argv[1]))
