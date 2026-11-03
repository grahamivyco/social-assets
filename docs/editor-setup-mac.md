# Mac editor setup notes

Checked and installed 2026-11-03. Free and local tools only, no sudo.

## Machine

- macOS 26.7.1 (build 25G241), Darwin 25.6.0
- Apple M1 Pro (arm64), 10 cores, 16 GB

## Result

| Tool | Status | Version | Path |
| --- | --- | --- | --- |
| ffmpeg | PASS | 9.0.2 (martin-riedl.de build) | ~/.local/bin/ffmpeg |
| ffprobe | PASS | 9.0.2 | ~/.local/bin/ffprobe |
| python3 (default) | PASS | 3.15.0 | /opt/homebrew/bin/python3 |
| python3.12 (for WhisperX) | PASS | 3.12 | /opt/homebrew/bin/python3.12 |
| uv | PASS | 0.12.23 | ~/.local/bin/uv |
| node | PASS | v24.15.0 | /usr/local/bin/node |
| npm / npx | PASS | 11.12.1 | /usr/local/bin |
| yt-dlp | PASS | 2026.10.26 (uv tool) | ~/.local/bin/yt-dlp |
| HyperFrames CLI | PASS | 0.9.9, telemetry disabled | ~/social-assets/reels/hyperframes (npm, project-local) |
| HyperFrames skills | PASS | hyperframes, hyperframes-cli, hyperframes-registry, media-use | ~/.claude/skills (also ~/.agents/skills) |
| HyperFrames sound effects | PASS | 19 mp3 + manifest.json + CREDITS.md | ~/.claude/skills/media-use/audio/assets/sfx |
| HyperFrames test render | PASS | 1080x1920, 10.0 s, h264 + aac, 3 SFX audible at 0.2/2.1/4.4 s | ~/social-assets/reels/hyperframes/smoke-test/ |
| WhisperX | PASS | 3.8.6, torch 2.8.0 CPU | Setup/tools/whisperx-venv |
| WhisperX word timestamps | PASS | base.en + wav2vec2 alignment, word start/end/score | test clip: Parakeet test_wavs/0.wav |
| Parakeet (sherpa-onnx) | PASS | nemo-parakeet-tdt-0.6b-v2-int8 (631 MB) | ~/.cache/thedit/ |
| Playwright | PARTIAL | playwright-core 1.56.1 only, chromium_headless_shell-1194 | ~/social-assets/reels/node_modules, ~/Library/Caches/ms-playwright |
| Chrome for HyperFrames | PASS | uses system Google Chrome | /Applications/Google Chrome.app |

`npx hyperframes doctor` also lists optional extras that are not installed: whisper-cpp (HyperFrames' own transcription; Parakeet and WhisperX cover this), Kokoro TTS, MusicGen and Docker. None are needed for Reels.

## Sound effects

- 19 files: chime, click, click-soft, error, glitch-1/2/3, impact-bass-1/2, key-press, notification, ping, pop, riser (10.03 s), sparkle, typing, whoosh, whoosh-short, whoosh-cinematic. All 19 decode cleanly in ffmpeg.
- Licence: Pixabay Content License. Commercial use is allowed, attribution is not required. A copy of the credits is saved as Setup/hyperframes-sfx-CREDITS.md.
- The media-use skill can also fetch CC0/CC BY sounds from Openverse online. For a local-only workflow, use `--local-only`. CC BY sounds need the credit line in the post.

## WhisperX

- Lives in its own venv on Python 3.12 (WhisperX needs Python 3.10 to 3.13), separate from everything else.
- CPU mode on the Mac: `"<venv>/bin/whisperx" clip.wav --model base.en --language en --compute_type int8 --device cpu --output_format json`
- Models download on first use: Whisper base.en and the wav2vec2 alignment model (360 MB, ~/.cache/torch/hub). A 7.5 s clip took about 3 minutes on the first run, mostly the download.
- Parakeet still does the main transcription for Reels. WhisperX is the backup and the option for speaker diarization (that needs a free Hugging Face token).

## Folders

Under ~/Downloads/Open Frame LLC & Clients/: Raw, Signature Style and Setup were created. Reels already existed and is used as Projects, one folder per video. Nothing was moved or deleted.

## How it was installed

Claude Code's auto-mode safety check blocked package downloads until Graham said "yes install". The installs are in one script that is safe to run again:

```
zsh ~/Downloads/"Open Frame LLC & Clients"/Setup/install-editor-tools.sh
```

It installs yt-dlp (`uv tool install yt-dlp`), HyperFrames (`npm i -D hyperframes` then `npx hyperframes skills update`) and WhisperX (`uv venv --python python3.12`, then `uv pip install whisperx`, reusing the venv if it already exists), and logs to Setup/install-log.txt.

Checks used afterwards:

```
cd ~/social-assets/reels/hyperframes
npx hyperframes telemetry disable
npx hyperframes doctor
npx hyperframes init smoke-test --example blank --resolution portrait --non-interactive --skip-skills
cd smoke-test && npx hyperframes render -o smoke-test-sfx.mp4
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name -of compact smoke-test-sfx.mp4
ffmpeg -i smoke-test-sfx.mp4 -af silencedetect=n=-45dB:d=0.3 -vn -f null -
for f in ~/.claude/skills/media-use/audio/assets/sfx/*.mp3; do ffmpeg -v error -i "$f" -f null -; done
```

Note: reels/.gitignore only ignores node_modules/, so reels/hyperframes/ (package.json, smoke-test) shows as untracked in git.
