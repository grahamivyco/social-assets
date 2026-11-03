# Mac editor setup notes

Checked 2026-11-03. Free and local tools only, no sudo.

## Machine

- macOS 26.7.1 (build 25G241), Darwin 25.6.0
- Apple M1 Pro (arm64)

## Tools

| Tool | Status | Version | Path |
| --- | --- | --- | --- |
| ffmpeg | PASS | 9.0.2 (martin-riedl.de build) | ~/.local/bin/ffmpeg |
| ffprobe | PASS | 9.0.2 | ~/.local/bin/ffprobe |
| python3 | PASS | 3.15.0 | /opt/homebrew/bin/python3 |
| pip3 | PASS | 26.2.1 | /opt/homebrew/lib/python3.15/site-packages/pip |
| node | PASS | v24.15.0 (HyperFrames needs >= 22) | /usr/local/bin/node |
| npm | PASS | 11.12.1 | /usr/local/bin/npm |
| npx | PASS | 11.12.1 | /usr/local/bin/npx |
| yt-dlp | MISSING | not on PATH, not found under ~ (depth 4) | none |
| Playwright | PARTIAL | playwright-core 1.56.1, project-local only | ~/social-assets/reels/node_modules/playwright-core |
| Playwright browser | PARTIAL | chromium_headless_shell-1194 only (no full Chromium) | ~/Library/Caches/ms-playwright/ |
| Parakeet (sherpa-onnx) | PASS | nemo-parakeet-tdt-0.6b-v2-int8 (631 MB: encoder/decoder/joiner int8 .onnx, tokens.txt) | ~/.cache/thedit/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 |
| RVM matting model | PRESENT | rvm_mobilenetv3_fp32.onnx (14 MB) | ~/.cache/thedit/ |
| whisperx | MISSING (expected) | not installed, by choice | none |
| HyperFrames | NOT INSTALLED | blocked, see below | planned: ~/social-assets/reels/hyperframes |

Notes:
- There is no global `playwright` CLI. `npx --no-install playwright --version` fails because only `playwright-core` is installed in reels/.
- The headless shell is enough for scripted screenshots. HyperFrames drives its own headless Chrome through Puppeteer, so it may download its own browser on first render.

## HyperFrames

Status: not installed. The project-local `npm i -D hyperframes` was blocked by Claude Code's auto-mode permission check, so nothing was downloaded.

From the current README (github.com/heygen-com/hyperframes):
- Apache 2.0, needs Node 22+ and FFmpeg (both present).
- CLI: `npx hyperframes init <name>`, `npx hyperframes preview`, `npx hyperframes render`.
- Skills: `npx hyperframes skills update` installs the core set (/hyperframes, /hyperframes-cli, /hyperframes-registry, /media-use) matched to the CLI version. Run it from the video project folder for a project-local install.
- Claude Code plugin alternative: `claude plugin marketplace add heygen-com/hyperframes` then `claude plugin install hyperframes@hyperframes`.
- Sound effects: the README points to the `/media-use` skill ("HeyGen or free local tools"). Whether actual audio files ship on disk is unconfirmed until the install runs.

Planned commands once approved:

```
mkdir -p ~/social-assets/reels/hyperframes && cd ~/social-assets/reels/hyperframes
npm init -y
npm i -D hyperframes@latest
npx hyperframes --version
npx hyperframes skills update
npx hyperframes init smoke-test
cd smoke-test && npx hyperframes render
ffprobe -v error -show_entries format=duration -of csv=p=0 <output.mp4>
```

Note: reels/.gitignore only ignores node_modules/, so a hyperframes/ folder in reels/ would show as untracked in git until it is ignored or committed.

## WhisperX (not installed)

- `python3 -m venv` works (venv and ensurepip import fine), so an isolated venv is possible: `python3 -m venv ~/.venvs/whisperx`.
- What it would need: PyTorch + torchaudio (about 1-2 GB, runs on CPU or Apple MPS), the whisperx package, faster-whisper/CTranslate2 (CPU only on Mac), a Whisper model download (about 1.5 GB for large-v3), and a wav2vec2 alignment model. Speaker diarization needs a free Hugging Face token plus accepting the pyannote model terms.
- Risk: Python 3.15 is very new and PyTorch wheels may not exist for it yet. A venv on Python 3.11 or 3.12 would be safer, which would mean another Python install.
- Parakeet already gives word-level timings, so this stays on hold.

## Folders

Under ~/Downloads/Open Frame LLC & Clients/:
- Raw: created
- Signature Style: created
- Setup: created
- Reels: already there, unchanged (used as Projects, one folder per video)

Nothing was moved or deleted.

## Commands used

```
sw_vers; uname -m; sysctl -n machdep.cpu.brand_string
command -v ffmpeg ffprobe python3 node npm npx yt-dlp
ffmpeg -version; ffprobe -version; python3 --version; node --version; npm --version; npx --version
ls ~/.cache/thedit; du -sh ~/.cache/thedit/*
ls ~/Library/Caches/ms-playwright
cd ~/social-assets/reels && npx --no-install playwright --version   # fails: only playwright-core
node -p "require('~/social-assets/reels/node_modules/playwright-core/package.json').version"
python3 -c "import venv, ensurepip"; python3 -m venv --help
curl -sL https://raw.githubusercontent.com/heygen-com/hyperframes/main/README.md
mkdir "~/Downloads/Open Frame LLC & Clients/{Raw,Signature Style,Setup}"
```
