#!/bin/bash
# Copies this checkout into the cPanel Node.js app and restarts Passenger.
# Application root in Setup Node.js App must be ~/talex-backend and the
# startup file must be app.js. Environment variables stay in that cPanel screen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${HOME}/talex-backend"

mkdir -p "$APP/tmp"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/app.js" "$APP/"
rm -rf "$APP/src"
cp -R "$ROOT/src" "$APP/src"

shopt -s nullglob
matches=("$HOME"/nodevenv/talex-backend/*/bin/activate)
if [[ ${#matches[@]} -eq 0 ]]; then
  echo "No existe ~/nodevenv/talex-backend. Crea la aplicacion en cPanel → Setup Node.js App con raiz talex-backend y Node 20." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${matches[-1]}"
cd "$APP"
npm ci --omit=dev
mkdir -p tmp
touch tmp/restart.txt
echo "TaleX API actualizada en $APP"
