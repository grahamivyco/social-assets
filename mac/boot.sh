#!/bin/bash
# Runs at login and every 5 minutes (login agent design.openframe.keeper). Brings pm2 back with everything saved,
# and makes sure the keeper is running. The keeper does the rest (LM Studio, n8n, restarts).
source "$(dirname "$0")/env.sh"
cd "$OF_REPO" || exit 0
PM2="$(command -v pm2 || echo "$OF_REPO/mac/node_modules/.bin/pm2")"
[ -x "$PM2" ] || { echo "$(date) pm2 not found"; exit 0; }
"$PM2" ping >/dev/null 2>&1
if ! "$PM2" jlist 2>/dev/null | grep -q '"name"'; then
  echo "$(date) pm2 empty, resurrecting"
  "$PM2" resurrect >/dev/null 2>&1
fi
if ! "$PM2" jlist 2>/dev/null | grep -q '"name":"keeper"'; then
  echo "$(date) starting keeper"
  "$PM2" start mac/keeper.js --name keeper >/dev/null 2>&1 && "$PM2" save >/dev/null 2>&1
fi
exit 0
