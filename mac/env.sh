# The PATH every Open Frame tool on this Mac needs: static ffmpeg, Homebrew, LM Studio's lms, node, pm2.
# Login shells (~/.zprofile), the login agent and the keeper all source this, so pm2 and friends are always found.
OF_REPO="${OF_REPO:-$HOME/social-assets}"
for d in /usr/local/bin /opt/homebrew/bin "$HOME/.lmstudio/bin" "$OF_REPO/mac/node_modules/.bin" "$HOME/.local/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
# node from nvm, if that's how node got installed (newest version)
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  PATH="$(ls -d "$HOME"/.nvm/versions/node/*/bin | sort -V | tail -1):$PATH"
fi
# npm's global bin (where `npm i -g pm2` put pm2)
if command -v npm >/dev/null 2>&1; then
  g="$(npm prefix -g 2>/dev/null)/bin"; [ -d "$g" ] && case ":$PATH:" in *":$g:"*) ;; *) PATH="$PATH:$g" ;; esac
fi
export PATH OF_REPO
