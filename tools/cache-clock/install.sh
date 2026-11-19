#!/bin/sh
# Cache Clock installer — puts the extension in Copilot's user extensions dir, or a project's.
# Usage: curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/<REF>/tools/cache-clock/install.sh | sh
#        (<REF> is the tag named by REF below; the one-line install works once that tag exists)
#        curl -fsSL …/install.sh | sh -s -- --project    into this repo's .github/extensions (VS Code)
#        sh tools/cache-clock/install.sh            from a checkout: link (updates follow git pull)
#        sh tools/cache-clock/install.sh --copy     copy instead of link
#        sh tools/cache-clock/install.sh --project [DIR]   copy into DIR's git root (default: here)
#        sh tools/cache-clock/install.sh --uninstall [--project [DIR]]
# Env:   COPILOT_HOME (default ~/.copilot), CACHE_CLOCK_BASE_URL (download source)
set -eu

# The release tag the one-line install downloads from, so a push to main changes nothing for it.
# The only place the tag is spelled; the README's curl lines name it too, and a test checks they agree.
REF="cache-clock-v1.1.0"
BASE_URL="${CACHE_CLOCK_BASE_URL:-https://raw.githubusercontent.com/abhijitbansal/claude-skills/$REF/tools/cache-clock/extension}"
# Every file the extension ships; a test keeps this list in step with extension/.
# extension.mjs comes last, so an interrupted download never looks like an extension.
FILES="report.mjs lib/clock.mjs lib/config.mjs lib/format.mjs lib/guard.mjs lib/history.mjs lib/keepwarm.mjs lib/usage.mjs lib/wiring.mjs extension.mjs"
# BEGIN SHA256 (generated: node tools/cache-clock/bin/checksums.mjs --write)
SUMS='1acecfbc1bde5c37c350f7bcfa4d88bdea028c7dd06ec6fede2c9100c491fee4  report.mjs
2911b54a5a81da269e31cde0651963d28dfd65f426e7c9e0d3c3d2b65c7bc567  lib/clock.mjs
13ed66afd118607dfe672c468b868a087a09428e619b502d186e2c809a13ccd3  lib/config.mjs
a8922ba08307dd846e02df2a24a344651fc096d5b3ce7ad513c4c6aa934fc7a6  lib/format.mjs
9ef37ae0ada40d427aac12b9e24736f60ed1a1015901b3052d24bb75bd343d86  lib/guard.mjs
4a29370f5e6ef4abb3d1002a503a26729249178cffbd7e661d018b9525d2424c  lib/history.mjs
90b6c392b2f4eff2bdbbf94f390b09425e0eac472ab6ea6f2af234ba40848f63  lib/keepwarm.mjs
817b122f5026b3e7c7bb79284120907f92a7f051f2afe62eeaf4ebc9ad7746b2  lib/usage.mjs
db7a6158320a368b6eab5a4e2aede0dd007b188562862f4762914378727b215a  lib/wiring.mjs
f65bff6539a71bbe20054aa169ab7a8cd8c38e1883c715738676d859349153bc  extension.mjs
'
# END SHA256
MODE="link"
PROJECT=""

# Prints the SHA-256 (hex) of the file in $1.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'
}

# A checkout only when this script is a real file next to extension/. Piped (curl | sh),
# $0 is the shell, and an extension/ folder in the current directory must not count.
SRC=""
if [ -f "$0" ] && [ -f "$(dirname "$0")/extension/extension.mjs" ]; then
  SRC="$(cd "$(dirname "$0")" && pwd)/extension"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy" ;;
    --uninstall) UNINSTALL=1 ;;
    --project)
      PROJECT="$PWD"
      case "${2-}" in ""|-*) ;; *) PROJECT="$2"; shift ;; esac ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
if [ -n "${UNINSTALL-}" ]; then MODE="uninstall"; fi

if [ -n "$PROJECT" ]; then
  if [ ! -d "$PROJECT" ]; then
    printf 'cache-clock: no such folder: %s\n' "$PROJECT" >&2
    exit 1
  fi
  # Copilot reads project extensions from the git root's .github/extensions.
  PROJECT="$(git -C "$PROJECT" rev-parse --show-toplevel 2>/dev/null || (cd "$PROJECT" && pwd))"
  DEST_DIR="$PROJECT/.github/extensions"
  # A link into a checkout would break for anyone else using the project: always copy.
  [ "$MODE" = link ] && MODE="copy"
else
  DEST_DIR="${COPILOT_HOME:-$HOME/.copilot}/extensions"
fi
DEST="$DEST_DIR/cache-clock"

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
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    printf 'cache-clock: the one-line install needs sha256sum or shasum\n' >&2
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
    # Nothing is installed from a file that is not the one this script was published with.
    want=$(printf '%s\n' "$SUMS" | awk -v f="$f" '$2 == f { print $1 }')
    if [ -z "$want" ]; then
      printf 'cache-clock: no checksum listed for %s\n' "$f" >&2
      exit 1
    fi
    if [ "$(sha256_of "$STAGE/$f")" != "$want" ]; then
      printf 'cache-clock: checksum mismatch: %s\n' "$f" >&2
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
if [ -n "$PROJECT" ]; then
  printf 'VS Code Copilot chat: open %s, add "chat.canvases.enabled": true to your VS Code settings,\n' "$PROJECT"
  printf '  reload, start a new chat, and type /cache-clock in full: VS Code does not list it in the / menu.\n'
else
  printf 'VS Code Copilot chat: loads cache-clock from a project, not from this install. In each repo, run\n'
  printf '  this installer with --project (curl ... | sh -s -- --project), then see the README.\n'
fi
printf 'Report: node %s/report.mjs --since 7d\n' "$DEST"
