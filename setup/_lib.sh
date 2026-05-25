#!/usr/bin/env bash
# Shared helpers for setup.sh / capture.sh / contribute.sh. Source only — do not exec.

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
info()  { printf "  → %s\n" "$*"; }
warn()  { printf "  ! %s\n" "$*" >&2; }
fail()  { printf "  ✗ %s\n" "$*" >&2; return 1; }

# safe_symlink <src> <dst>
# Create dst as symlink to src, but never silently clobber existing state.
safe_symlink() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "${dst}")"
  if [[ -L "${dst}" ]]; then
    local current
    current="$(readlink "${dst}")"
    if [[ "${current}" == "${src}" ]]; then
      info "symlink ${dst} already correct"
      return 0
    fi
    warn "foreign symlink at ${dst} → ${current}; leaving it alone"
    return 0
  fi
  if [[ -e "${dst}" ]]; then
    fail "regular file or directory at ${dst}; refusing to clobber"
    return 1
  fi
  ln -s "${src}" "${dst}"
  info "linked ${dst} → ${src}"
}

ensure_path() {
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) export PATH="${HOME}/.local/bin:${PATH}" ;;
  esac
}

python_check() {
  if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 not found; install Python 3.11+" || return 1
  fi
  local v
  v="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  awk -v v="${v}" 'BEGIN{ if (v+0 < 3.11) exit 1 }' || {
    fail "python3 ${v} too old; need 3.11+" || return 1
  }
}

gh_auth_check() {
  command -v gh >/dev/null 2>&1 || { fail "gh CLI not installed" || return 1; }
  gh auth status >/dev/null 2>&1 || { fail "gh not authenticated; run 'gh auth login'" || return 1; }
}
