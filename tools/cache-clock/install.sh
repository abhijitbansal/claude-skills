#!/bin/sh
# Cache Clock installer — puts the extension in Copilot's user extensions dir.
# Usage: curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/install.sh | sh
#        sh tools/cache-clock/install.sh            from a checkout: link (updates follow git pull)
#        sh tools/cache-clock/install.sh --copy     copy instead of link
#        sh tools/cache-clock/install.sh --uninstall
# Env:   COPILOT_HOME (default ~/.copilot), CACHE_CLOCK_BASE_URL (download source)
set -eu

DEST_DIR="${COPILOT_HOME:-$HOME/.copilot}/extensions"
DEST="$DEST_DIR/cache-clock"
BASE_URL="${CACHE_CLOCK_BASE_URL:-https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/extension}"
# Every file the extension ships; a test keeps this list in step with extension/.
# extension.mjs comes last, so an interrupted download never looks like an extension.
FILES="report.mjs lib/clock.mjs lib/config.mjs lib/format.mjs lib/guard.mjs lib/history.mjs lib/usage.mjs lib/wiring.mjs extension.mjs"
MODE="link"

# A checkout only when this script is a real file next to extension/. Piped (curl | sh),
# $0 is the shell, and an extension/ folder in the current directory must not count.
SRC=""
if [ -f "$0" ] && [ -f "$(dirname "$0")/extension/extension.mjs" ]; then
  SRC="$(cd "$(dirname "$0")" && pwd)/extension"
fi

for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --uninstall) MODE="uninstall" ;;
    *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

# Only ever replace our own install: one with cache-clock's own lib files (a link to a
# checkout or a copy), or a dangling link left by a deleted checkout. Another tool's
# folder that happens to be called cache-clock is left alone.
if [ -e "$DEST" ] && { [ ! -f "$DEST/lib/wiring.mjs" ] || [ ! -f "$DEST/lib/clock.mjs" ]; }; then
  printf 'cache-clock: %s exists and is not a cache-clock install; leaving it alone\n' "$DEST" >&2
  exit 1
fi
case "$SRC/" in
  "$DEST"/*)
    printf 'cache-clock: run install.sh from a checkout outside %s\n' "$DEST" >&2
    exit 1 ;;
esac

if [ "$MODE" = uninstall ]; then
  rm -rf "$DEST" "$DEST_DIR"/.cache-clock.*
  printf 'cache-clock: removed %s\n' "$DEST"
  exit 0
fi

mkdir -p "$DEST_DIR"
if [ -n "$SRC" ]; then
  rm -rf "$DEST"
  if [ "$MODE" = copy ]; then
    cp -R "$SRC" "$DEST"
  else
    ln -s "$SRC" "$DEST"
  fi
else
  # No checkout next to the script: download a copy into a stage dir, then swap it in.
  if ! command -v curl >/dev/null 2>&1; then
    printf 'cache-clock: the one-line install needs curl\n' >&2
    exit 1
  fi
  MODE="download"
  STAGE="$(mktemp -d "$DEST_DIR/.cache-clock.XXXXXX")"
  OLD="$DEST_DIR/.cache-clock.old.$$"
  trap 'rm -rf "$STAGE"' EXIT
  trap 'rm -rf "$STAGE"; exit 130' INT TERM HUP
  for f in $FILES; do
    if ! curl -fsSL --create-dirs "$BASE_URL/$f" -o "$STAGE/$f"; then
      printf 'cache-clock: download failed: %s/%s\n' "$BASE_URL" "$f" >&2
      exit 1
    fi
  done
  # Keep the old install until the new one is in place.
  if [ -e "$DEST" ] || [ -L "$DEST" ]; then mv "$DEST" "$OLD"; fi
  if mv "$STAGE" "$DEST"; then
    rm -rf "$OLD"
  else
    if [ -e "$OLD" ] || [ -L "$OLD" ]; then mv "$OLD" "$DEST"; fi
    printf 'cache-clock: could not move the download into %s\n' "$DEST" >&2
    exit 1
  fi
  trap - EXIT INT TERM HUP
fi

printf 'cache-clock: installed (%s) at %s\n' "$MODE" "$DEST"
printf 'Copilot CLI: start a new copilot session, allow the extension to register hooks, then run /cache-clock help.\n'
printf 'VS Code Copilot chat: this same install works in every workspace. In VS Code User settings (not .vscode/settings.json) add\n'
printf '  "chat.canvases.enabled": true and "chat.defaultToCopilotHarness": true, reload, start a new chat on the Copilot\n'
printf '  harness (not Local), and type /cache-clock in full: VS Code does not list it in the / menu, but it works.\n'
printf 'Report: node %s/report.mjs --since 7d\n' "$DEST"
