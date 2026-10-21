#!/bin/bash
# One paste in Terminal sets up the Mac so nothing needs Terminal again:
#   curl -fsSL https://raw.githubusercontent.com/grahamivyco/social-assets/main/mac/install.sh | HUB_KEY=<your Hub key> bash
# - pm2 + clasp installed inside ~/social-assets/mac (no sudo), PATH fixed for Terminal (~/.zprofile)
# - login agent: at login and every 5 min, pm2 comes back with everything saved, and the keeper runs
# - keeper (pm2): restarts stopped apps, starts LM Studio's server + model, pulls code, reports to the Studio page
# - n8n viral scout imported + published; Hub address + key saved for the loops and the keeper
# - Hub auto-update: one Google sign-in, then every Hub change deploys itself
# Safe to run again any time.
set -u
REPO="$HOME/social-assets"
HUB_URL="https://script.google.com/macros/s/AKfycbyBkDfWO-LghULYws9PCWUuqyga7kbGz2cat0w8tMIw09DmoEgtxBB7XprqRfCUyfGhpg/exec"
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

say "1/6 Getting the latest code"
[ -d "$REPO/.git" ] || git clone https://github.com/grahamivyco/social-assets "$REPO"
cd "$REPO" || exit 1
git pull --rebase --autostash -q || echo "  (pull failed, using what's here)"
source "$REPO/mac/env.sh"
command -v node >/dev/null || { echo "node isn't installed. Install it from https://nodejs.org and run this again."; exit 1; }

say "2/6 Installing pm2 and clasp in $REPO/mac"
npm install --prefix "$REPO/mac" --no-fund --no-audit --loglevel=error >/dev/null || echo "  npm install had a problem"
grep -q 'social-assets/mac/env.sh' "$HOME/.zprofile" 2>/dev/null || printf '\n# Open Frame tools (pm2, ffmpeg, lms)\nsource "$HOME/social-assets/mac/env.sh"\n' >> "$HOME/.zprofile"
mkdir -p "$REPO/mac/logs"

if [ -n "${HUB_KEY:-}" ]; then
  node -e 'const fs=require("fs"),f=process.argv[1];let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch{};c.hub=process.argv[2];c.hubKey=process.argv[3];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' \
    "$REPO/reels/config.json" "$HUB_URL" "$HUB_KEY"
  if curl -fsSL -X POST -H 'Content-Type: text/plain' -d "{\"key\":\"$HUB_KEY\",\"fn\":\"loops\",\"action\":\"list\",\"loop\":\"none\"}" "$HUB_URL" | grep -q '"rows"'; then
    echo "  Hub key works."
  else
    echo "  The Hub didn't accept that key (or the Hub needs its new version deployed). Status will show once it does."
  fi
fi

say "3/6 Login agent (brings everything back after a restart)"
PLIST="$HOME/Library/LaunchAgents/design.openframe.keeper.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>design.openframe.keeper</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/mac/boot.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>$REPO/mac/logs/boot.log</string>
  <key>StandardErrorPath</key><string>$REPO/mac/logs/boot.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

say "4/6 Starting the keeper"
bash "$REPO/mac/boot.sh"
PM2="$(command -v pm2 || echo "$REPO/mac/node_modules/.bin/pm2")"
"$PM2" restart keeper --update-env >/dev/null 2>&1
"$PM2" save >/dev/null 2>&1

say "5/6 Viral scout in n8n"
node "$REPO/mac/n8n-fix.js"

say "6/6 Hub auto-update (one Google sign-in)"
if [ ! -f "$HOME/.clasprc.json" ]; then
  open "https://script.google.com/home/usersettings"
  echo "  In the page that just opened, turn ON \"Google Apps Script API\"."
  read -r -p "  Then press Return here... " _ </dev/tty
  "$REPO/mac/node_modules/.bin/clasp" login </dev/tty || echo "  Sign-in didn't finish. Run this again to retry."
else
  echo "  Already signed in."
fi

say "Done. Checking everything once:"
node "$REPO/mac/keeper.js" once | grep -E '"(label|status|detail)"' | paste - - - | sed 's/  */ /g'
echo
echo "Status lights: https://openframe.design/studio/?tab=reels"
