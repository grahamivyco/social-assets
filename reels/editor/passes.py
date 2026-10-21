"""Extra passes for the talking head editor (Graham, 2026-10-21, from the 5-pass Reel method).
Pass 2, cut-out: a soft-edged matte of the speaker on every frame, so titles and graphics sit behind the head.
Pass 5, sound: small sound effects made in code (nothing to license) on the hook, each graphic, each take change
and the end card, mixed under the voice. Free and local: RobustVideoMatting (onnx, CPU) and numpy.
"""
import os, subprocess, urllib.request, wave
from pathlib import Path
import numpy as np

RVM_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx"
CACHE = Path(os.environ.get("THEDIT_MODELS", Path.home() / ".cache" / "thedit"))
SR = 48000


def _rvm():
    path = CACHE / "rvm_mobilenetv3_fp32.onnx"
    if not path.exists():
        print("downloading cut-out model (once, about 15 MB)...")
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(RVM_URL, path.with_suffix(".part"))
        path.with_suffix(".part").replace(path)
    import onnxruntime as ort
    return ort.InferenceSession(str(path), providers=ort.get_available_providers())


def matte(cut, dst, sw, sh, width=720):
    """Speaker matte for every frame of cut.mkv, as a gray video (white = person). Made at `width` px wide
    for speed and scaled back up in the render, so edges stay soft."""
    w = width // 2 * 2
    h = int(sh * w / sw) // 2 * 2
    sess = _rvm()
    rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4
    ds = np.array([min(1.0, 512 / max(w, h))], np.float32)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(cut), "-vf", f"scale={w}:{h},format=rgb24",
                            "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}",
                            "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(dst)],
                           stdin=subprocess.PIPE)
    n = 0
    while True:
        b = dec.stdout.read(w * h * 3)
        if len(b) < w * h * 3:
            break
        x = np.frombuffer(b, np.uint8).reshape(h, w, 3).transpose(2, 0, 1)[None].astype(np.float32) / 255
        _, pha, *rec = sess.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3],
                                       "downsample_ratio": ds})
        enc.stdin.write((np.clip(pha[0, 0], 0, 1) * 255).astype(np.uint8).tobytes())
        n += 1
        if n % 150 == 0:
            print(f"  cut-out {n} frames")
    enc.stdin.close()
    if enc.wait() or dec.wait():
        raise SystemExit("cut-out pass failed")
    return dst


# ---------- sound ----------
def _env(n, attack, tau):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / tau)


def _whoosh(rng):
    n = int(0.5 * SR)
    noise = rng.standard_normal(n)
    out, y = np.zeros(n), 0.0
    cut = np.concatenate([np.linspace(0.02, 0.35, n // 2), np.linspace(0.35, 0.03, n - n // 2)])
    for i in range(n):  # one-pole lowpass sweeping open then closed
        y += cut[i] * (noise[i] - y); out[i] = y
    env = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out / (np.abs(out).max() + 1e-9) * env * 0.16


def _tap(rng):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 1700 * t) * 0.6 + np.sin(2 * np.pi * 820 * t) * 0.4
    click = rng.standard_normal(n) * _env(n, 0.0005, 0.004)
    return (tone * _env(n, 0.001, 0.014) + click * 0.3) * 0.22


def _chime(rng):
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d)
            for f, a, d in ((880, 1, .7), (1318.5, .55, .5), (1760, .3, .35), (2637, .12, .2)))
    return s * np.minimum(1, t / 0.004) * 0.12


SOUNDS = {"whoosh": _whoosh, "tap": _tap, "chime": _chime}


def sfx_track(dst, total, cues, seed=7):
    """cues: [(seconds, kind)] on the output timeline. Writes a stereo 48 kHz wav as long as the video."""
    rng = np.random.default_rng(seed)
    track = np.zeros(int(total * SR) + SR)
    for t, kind in cues:
        s = SOUNDS[kind](rng)
        i = max(0, int(t * SR))
        j = min(len(track), i + len(s))
        track[i:j] += s[:j - i]
    track = np.clip(track[:int(total * SR)], -1, 1)
    pcm = (np.repeat(track[:, None], 2, axis=1) * 32767).astype("<i2")
    with wave.open(str(dst), "wb") as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())
    return dst
