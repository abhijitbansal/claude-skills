#!/bin/sh
# Cache Clock installer — puts the extension in Copilot's user extensions dir.
# Usage: curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/install.sh | sh
#        sh tools/cache-clock/install.sh            from a checkout: link (updates follow git pull)
#        sh tools/cache-clock/install.sh --copy     copy instead of link
#        sh tools/cache-clock/install.sh --uninstall
# Env:   COPILOT_HOME (default ~/.copilot), CACHE_CLOCK_BASE_URL (download source)
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)/extension"
DEST_DIR="${COPILOT_HOME:-$HOME/.copilot}/extensions"
DEST="$DEST_DIR/cache-clock"
BASE_URL="${CACHE_CLOCK_BASE_URL:-https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/extension}"
# Every file the extension ships; a test keeps this list in step with extension/.
FILES="extension.mjs report.mjs lib/clock.mjs lib/config.mjs lib/format.mjs lib/guard.mjs lib/history.mjs lib/usage.mjs lib/wiring.mjs"
MODE="link"

for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --uninstall) MODE="uninstall" ;;
    *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

# Only ever replace our own install: a link, or a directory holding extension.mjs.
if [ -e "$DEST" ] && [ ! -L "$DEST" ] && [ ! -f "$DEST/extension.mjs" ]; then
  printf 'cache-clock: %s exists and is not a cache-clock install; leaving it alone\n' "$DEST" >&2
  exit 1
fi
case "$SRC/" in
  "$DEST"/*)
    printf 'cache-clock: run install.sh from a checkout outside %s\n' "$DEST" >&2
    exit 1 ;;
esac

if [ "$MODE" = uninstall ]; then
  rm -rf "$DEST"
  printf 'cache-clock: removed %s\n' "$DEST"
  exit 0
fi

mkdir -p "$DEST_DIR"
if [ -f "$SRC/extension.mjs" ]; then
  rm -rf "$DEST"
  if [ "$MODE" = copy ]; then
    cp -R "$SRC" "$DEST"
  else
    ln -s "$SRC" "$DEST"
  fi
else
  # No checkout next to the script (curl | sh): download a copy, then swap it in whole.
  MODE="download"
  STAGE="$(mktemp -d "$DEST_DIR/.cache-clock.XXXXXX")"
  trap 'rm -rf "$STAGE"' EXIT
  mkdir -p "$STAGE/lib"
  for f in $FILES; do
    if ! curl -fsSL "$BASE_URL/$f" -o "$STAGE/$f"; then
      printf 'cache-clock: download failed: %s/%s\n' "$BASE_URL" "$f" >&2
      exit 1
    fi
  done
  rm -rf "$DEST"
  mv "$STAGE" "$DEST"
  trap - EXIT
fi

printf 'cache-clock: installed (%s) at %s\n' "$MODE" "$DEST"
printf 'Copilot CLI: start a new copilot session, allow the extension to register hooks, then run /cache-clock help.\n'
printf 'VS Code Copilot chat: add "chat.canvases.enabled": true to your VS Code settings, reload, start a new chat.\n'
printf 'Report: node %s/report.mjs --since 7d\n' "$DEST"
