#!/bin/sh
# Second Wind installer — places wind into ~/.wind and (optionally) onto PATH.
# Usage: curl -fsSL <raw-url>/install.sh | sh        (download mode)
#        sh tools/second-wind/install.sh             (local-clone mode)
# Flags: --no-modify-path    never touch the shell rc
# Env:   WIND_HOME (default ~/.wind), WIND_RC (rc file override),
#        WIND_ASSUME_YES=1 (skip the PATH y/N prompt), WIND_RAW_BASE.
set -eu

RAW_BASE="${WIND_RAW_BASE:-https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind}"
WIND_HOME="${WIND_HOME:-$HOME/.wind}"
MODIFY_PATH=1
for arg in "$@"; do
  case "$arg" in
    --no-modify-path) MODIFY_PATH=0 ;;
    *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

say ""
say "  ◢◤ second wind installer"
say ""

mkdir -p "$WIND_HOME/bin"

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P) || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/wind.py" ] && [ -f "$SCRIPT_DIR/dashboard.html" ]; then
  cp "$SCRIPT_DIR/wind.py" "$WIND_HOME/wind.py"
  cp "$SCRIPT_DIR/dashboard.html" "$WIND_HOME/dashboard.html"
  say "  ✓ copied wind.py + dashboard.html from local clone"
else
  curl -fsSL "$RAW_BASE/wind.py" -o "$WIND_HOME/wind.py"
  curl -fsSL "$RAW_BASE/dashboard.html" -o "$WIND_HOME/dashboard.html"
  say "  ✓ downloaded wind.py + dashboard.html"
fi

head -1 "$WIND_HOME/wind.py" | grep -q python || {
  say "  ✗ wind.py looks broken — inspect $WIND_HOME/wind.py"; exit 1; }

cat > "$WIND_HOME/bin/wind" <<'SHIM'
#!/bin/sh
exec python3 "${WIND_HOME:-$HOME/.wind}/wind.py" "$@"
SHIM
chmod +x "$WIND_HOME/bin/wind" "$WIND_HOME/wind.py"
say "  ✓ shim at $WIND_HOME/bin/wind"

# shellcheck disable=SC2016  # intentional: $HOME/$PATH must expand in the user's shell, not here
PATH_LINE='export PATH="$HOME/.wind/bin:$PATH"'
RC="${WIND_RC:-}"
if [ -z "$RC" ]; then
  case "$(basename "${SHELL:-sh}")" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) RC="$HOME/.bashrc" ;;
    *)    RC="$HOME/.profile" ;;
  esac
fi

if grep -qsF '.wind/bin' "$RC"; then
  say "  ✓ PATH already set in $RC"
elif [ "$MODIFY_PATH" = 0 ]; then
  say "  → add to PATH yourself:  $PATH_LINE"
else
  ans=""
  if [ "${WIND_ASSUME_YES:-}" = "1" ]; then
    ans=y
  elif [ -t 0 ]; then
    printf '  add %s to %s? [y/N] ' "$PATH_LINE" "$RC"
    read -r ans || ans=""
  elif [ -r /dev/tty ]; then
    printf '  add %s to %s? [y/N] ' "$PATH_LINE" "$RC"
    read -r ans < /dev/tty || ans=""
  fi
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    printf '\n%s\n' "$PATH_LINE" >> "$RC"
    say "  ✓ PATH line added to $RC"
  else
    say "  → add to PATH yourself:  $PATH_LINE"
  fi
fi

say ""
say "  Next:  exec \$SHELL   then   wind init"
say ""
