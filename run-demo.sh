#!/usr/bin/env bash
set -e

# Find Node runtime (system node, Cursor bundled node, or NVM)
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -x "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node" ]; then
  NODE_BIN="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
elif [ -d "$HOME/.nvm/versions/node" ] && [ -n "$(ls "$HOME/.nvm/versions/node" 2>/dev/null)" ]; then
  LATEST_NVM=$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)
  NODE_BIN="$HOME/.nvm/versions/node/$LATEST_NVM/bin/node"
else
  echo "Error: Node.js binary not found." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
"$NODE_BIN" scripts/display-demo.mjs "$@"
