"""Pop layer for talking heads: brand-styled title on a shape, small animated scenes on key words,
shape wipes between takes, punch-in jump cuts. Drawing is pop.js (canvas), rendered by pop-render.js.
Every client's Reel uses that client's brand fonts and colors from /mnt/project-files/brands/<id>/brand.json.
"""
import json, os, re, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRANDS = Path(os.environ.get("THEDIT_BRANDS", "/mnt/project-files/brands"))
PW_CORE = os.environ.get("PW_CORE", "/tmp/pwnode/node_modules/playwright-core")
# spoken word -> (scene, label). Only the first time each scene comes up.
KEYWORDS = {
    "brand": ("brand", "Brand"), "branding": ("brand", "Brand"),
    "website": ("website", "Website"), "websites": ("website", "Website"),
    "social": ("social", "Social"), "socials": ("social", "Social"),
    "design": ("design", "Design"), "marketing": ("marketing", "Marketing"),
    "product": ("product", "Product"), "newsletter": ("newsletter", "Newsletter"),
    "talk": ("send", "Done"),
}
# a named service shows its real logo (Graham, 2026-11-03), kind = the logo name in assets/logos/logos.json
for _k, _t in {"instagram": "Instagram", "tiktok": "TikTok", "facebook": "Facebook", "linkedin": "LinkedIn",
               "youtube": "YouTube", "threads": "Threads", "pinterest": "Pinterest", "mailchimp": "Mailchimp",
               "gmail": "Gmail", "substack": "Substack", "brevo": "Brevo", "canva": "Canva", "shopify": "Shopify",
               "squarespace": "Squarespace", "wix": "Wix", "wordpress": "WordPress", "calendly": "Calendly",
               "whatsapp": "WhatsApp", "google": "Google"}.items():
    KEYWORDS[_k] = (_k, _t)
WIPES = [("circle", "r"), ("square", "b"), ("circle", "y"), ("square", "g")]


# System folders searched when a brand font isn't in a fonts/ folder (Helvetica Neue ships with macOS and isn't free
# to copy, so it is never put in a repo). Liberation Sans has Helvetica's metrics and stands in on Linux previews.
SYSTEM_FONT_DIRS = [Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library" / "Fonts",
                    Path("/usr/share/fonts"), Path.home() / ".fonts"]
FALLBACK = {"helveticaneue": ["Helvetica Neue", "Helvetica", "Arial", "Liberation Sans"],
            "helvetica": ["Helvetica", "Helvetica Neue", "Arial", "Liberation Sans"]}
FONT_INDEX = {}  # path -> face index inside a .ttc collection
SYSTEM_FONTS = set()  # paths found outside a fonts/ folder: loaded by name, never copied


def _system_font(family, weight, italic):
    from PIL import ImageFont
    names = {300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold"}
    style = names.get(weight, "regular") + (" italic" if italic else "")
    for fam in FALLBACK.get(family.replace(" ", "").lower(), [family]):
        for d in SYSTEM_FONT_DIRS:
            if not d.exists():
                continue
            for f in sorted(d.rglob("*")):
                if f.suffix.lower() not in (".ttf", ".otf", ".ttc") or fam.replace(" ", "").lower() not in f.name.replace(" ", "").lower():
                    continue
                for i in range(64 if f.suffix.lower() == ".ttc" else 1):
                    try:
                        fam_n, sty = ImageFont.truetype(str(f), 20, index=i).getname()
                    except OSError:
                        break
                    sty = sty.lower().replace("oblique", "italic")
                    if fam_n.lower() == fam.lower() and (sty == style or (style == "regular italic" and sty == "italic")):
                        FONT_INDEX[f], _ = i, SYSTEM_FONTS.add(f)
                        return f
    return None


def _find_font(brand_dir, family, weight, italic=False):
    want = family.replace(" ", "").lower()
    names = {300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold"}
    for d in (brand_dir / "fonts", HERE / "fonts"):
        for f in sorted(d.glob("*.[ot]tf")) if d.exists() else []:
            n = f.stem.replace("-", "").replace("_", "").lower()
            if want in n and names.get(weight, "") in n and (("italic" in n) == italic):
                return f
    f = _system_font(family, weight, italic)
    if f:
        return f
    raise SystemExit(f"missing font file: {family} {weight}{' italic' if italic else ''} (put it in {brand_dir / 'fonts'})")


def pil_font(path, size):
    """PIL font for a path from _find_font, picking the right face inside a .ttc."""
    from PIL import ImageFont
    return ImageFont.truetype(str(path), size, index=FONT_INDEX.get(Path(path), 0))


def font_name(path):
    """(family, style) as the font file names itself, e.g. ("Helvetica Neue", "Bold")."""
    return pil_font(path, 20).getname()


def font_spec(family, weight, style, path):
    """A font for pop-render.js: system fonts load by name (local()), others from the file."""
    p = Path(path)
    if p in SYSTEM_FONTS:
        fam, sty = font_name(p)
        return {"family": family, "weight": weight, "style": style, "local": [f"{fam} {sty}", fam.replace(" ", "") + "-" + sty.replace(" ", "")]}
    return {"family": family, "weight": weight, "style": style, "path": str(p)}


def load_brand(brand_id, color_fn=lambda h: h):
    """Palette + fonts for a client. color_fn maps a hex color into the footage's color space (HDR)."""
    d = BRANDS / brand_id
    b = json.loads((d / "brand.json").read_text())
    col = {c["token"]: c["hex"].lstrip("#").lower() for c in b["colors"]}
    roles = b.get("roles", {})
    ink = col.get("ink") or col[roles.get("text", "ink")]
    light = col.get("cream") or col.get("white") or "ffffff"
    accents = [col[k] for k in ("red", "blue", "yellow", "green") if k in col]
    if len(accents) < 4:  # brands without a four-accent set: accent, band, heading, then the rest
        for k in (roles.get("accent"), roles.get("band"), roles.get("heading")) + tuple(col):
            if k in col and col[k] not in accents + [ink, light] and k not in ("hairline", "muted", "white"):
                accents.append(col[k])
    accents = (accents * 4)[:4]
    head = b["fonts"]["head"]
    pal = {"ink": ink, "cream": light, "r": accents[0], "b": accents[1], "y": accents[2], "g": accents[3]}
    return {
        "pal": {k: "#" + color_fn(v) for k, v in pal.items()},
        "hex": {k: color_fn(v) for k, v in pal.items()},
        # "italic": false in brand.json (Open Frame since the Helvetica switch): the accent word is a color, never italic
        "head": {"family": head["family"], "weight": head.get("weight", 500), "italic": head.get("italic", True)},
        # brand.json fonts.caption: the Reel caption font (Open Frame: Manrope ExtraBold, Graham's pick 2026-11-03)
        "caption": b["fonts"].get("caption"),
        "site": b.get("site", ""),  # the website glyph's address bar shows this
        "dir": d,
        "files": {"head": _find_font(d, head["family"], head.get("weight", 500)),
                  "head_italic": _find_font(d, head["family"], head.get("weight", 500), head.get("italic", True))},
    }


class Pop:
    def __init__(self, W, H, words, pieces, part_starts, dur, brand, title="", title_until=0, keywords=None, beats=None):
        self.W, self.H, self.dur, self.brand = W, H, dur, brand
        # edit.json "keywords" adds or overrides triggers per video, e.g. {"stitch": ["design", "Stitch"]}
        self.keywords = {**KEYWORDS, **{k.lower(): tuple(v) for k, v in (keywords or {}).items()}}
        self.title_until = title_until if title else 0
        self.scenes = self._beats(words, beats) if beats else self._scenes(words)
        self.wipes = [{"t": t, "shape": s, "color": c} for t, (s, c) in
                      zip(part_starts[1:], WIPES * 10)] + [{"t": dur, "shape": "circle", "color": "cream"}]
        self.frame_intro = False  # edit.json "frame_intro": true brings back the frame around the screen
        self.title = {"text": title, "until": title_until, "field": "r", "accent": "y", "dot": "y"} if title else None
        # punch in on every other jump cut inside a take, back out at each new take
        self.zooms, z = [], 1.0
        for a, b, new_part in pieces:
            z = 1.0 if new_part else (1.12 if z == 1.0 else 1.0)
            self.zooms.append((a, b, z))

    def _scenes(self, words):
        seen, out = set(), []
        words = [{**w, "_prev": words[k - 1]["w"] if k else ""} for k, w in enumerate(words)]
        for w in words:
            key = re.sub(r"[^a-z]", "", w["w"].lower())
            prev = re.sub(r"[^a-z']", "", out_prev.lower()) if (out_prev := w.get("_prev")) else ""
            if key == "talk" and prev not in ("let's", "lets"):  # only "let's talk", not "I talk to"
                continue
            if w["start"] < self.title_until + 0.2:  # never stack a graphic under the hook title
                continue
            if key in self.keywords and self.keywords[key][0] not in seen:
                seen.add(self.keywords[key][0])
                out.append({"t": w["start"], "kind": self.keywords[key][0], "label": self.keywords[key][1]})
        for k, s in enumerate(out):  # the next scene slides in over the last one
            nxt = out[k + 1]["t"] + 0.3 if k + 1 < len(out) else 1e9
            s["end"] = min(s["t"] + (2.0 if s["kind"] == "send" else 1.7), nxt)
        return out

    def _beats(self, words, beats):
        """edit.json "beats" (2026-10-22): graphics picked by hand, one per idea, each on the word that says it.
        [{"w": word#, "kind": "pdfs", "label": "Old PDFs", "dur": 2.4, "data": {...}}], word numbers from transcript.md.
        data "at_w": [word#, ...] times parts of a graphic (e.g. menu items) to the words that name them."""
        at = {w["i"]: w["start"] for w in words}
        out = []
        for b in beats:
            if b["w"] not in at:  # the word was cut from the edit
                continue
            t, data = at[b["w"]], dict(b.get("data") or {})
            if "at_w" in data:
                data["at"] = [max(0.0, at.get(i, t) - t) for i in data.pop("at_w")]
            out.append({"t": t, "kind": b["kind"], "label": b.get("label", ""), "data": data, "dur": b.get("dur", 2.4),
                        **{k: b[k] for k in ("src", "size") if k in b}})  # kind "image": file + inset/full/behind
        out.sort(key=lambda s: s["t"])
        for k, s in enumerate(out):  # the next graphic slides in over the last one
            nxt = out[k + 1]["t"] + 0.3 if k + 1 < len(out) else self.dur
            s["end"] = min(s["t"] + s.pop("dur"), nxt)
        return out

    def zoom_expr(self):
        terms = [f"between(it,{a:.3f},{b:.3f})*{z - 1:.3f}" for a, b, z in self.zooms if z != 1.0]
        return "1+" + "+".join(terms) if terms else "1"

    def has_front(self):
        return any(s["kind"] == "image" and s.get("size") == "full" for s in self.scenes)

    def render(self, path, fps, layer=None):
        f = self.brand["files"]
        spec = {"W": self.W, "H": self.H, "fps": fps, "dur": self.dur, "pal": self.brand["pal"],
                "head": self.brand["head"], "scenes": self.scenes, "wipes": self.wipes, "title": self.title,
                "intro": self.title["until"] if self.title else 0,
                "frame_intro": self.frame_intro, "layer": layer, "site": self.brand.get("site", ""),
                "title_style": getattr(self, "title_style", None),
                "fonts": [font_spec(self.brand["head"]["family"], self.brand["head"]["weight"], "normal", f["head"])]
                + ([font_spec(self.brand["head"]["family"], self.brand["head"]["weight"], "italic", f["head_italic"])]
                   if self.brand["head"]["italic"] else [])}
        sp = Path(path).with_suffix(".json")
        sp.write_text(json.dumps(spec))
        subprocess.run(["node", str(HERE / "pop-render.js"), str(sp), str(path)], check=True,
                       env={**os.environ, "PW_CORE": PW_CORE})
