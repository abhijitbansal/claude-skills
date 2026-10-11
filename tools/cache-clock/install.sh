#!/bin/sh
# Cache Clock installer — links the extension into Copilot CLI's user extensions dir.
# Usage: sh tools/cache-clock/install.sh            link (updates follow the checkout)
#        sh tools/cache-clock/install.sh --copy     copy instead of link
#        sh tools/cache-clock/install.sh --uninstall
# Env:   COPILOT_HOME (default ~/.copilot)
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)/extension"
DEST_DIR="${COPILOT_HOME:-$HOME/.copilot}/extensions"
DEST="$DEST_DIR/cache-clock"
MODE="link"

for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --uninstall) MODE="uninstall" ;;
    *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = uninstall ]; then
  rm -rf "$DEST"
  printf 'cache-clock: removed %s\n' "$DEST"
  exit 0
fi

if [ ! -f "$SRC/extension.mjs" ]; then
  printf 'cache-clock: %s/extension.mjs not found\n' "$SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST"
if [ "$MODE" = copy ]; then
  cp -R "$SRC" "$DEST"
else
  ln -s "$SRC" "$DEST"
fi
printf 'cache-clock: installed (%s) at %s\n' "$MODE" "$DEST"
printf 'Start a new copilot session, then run /cache-clock.\n'
