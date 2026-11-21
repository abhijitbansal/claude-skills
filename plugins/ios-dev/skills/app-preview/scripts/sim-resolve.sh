#!/usr/bin/env bash
#
# app-preview: simulator targeting helpers. Source this file; it defines
# functions only and runs nothing.
#
# `xcrun simctl ... booted` silently picks one device when several are booted,
# so every app-preview script resolves a concrete UDID once and passes that
# UDID to simctl instead.
#
#   sim_resolve [<name|UDID>]   print one UDID, or return 1 with a message
#       <UDID>   accepted if that simulator exists
#       <name>   exact device name; the booted match wins, else the one on the
#                newest runtime
#       (none)   the only booted simulator; refuses when more than one is
#                booted; with none booted, the first iPhone of the newest iOS
#                runtime (the one launch.sh then boots)
#   sim_is_booted <UDID>        exit 0 when that simulator is Booted

_SIM_UDID_RE='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'

# Turn simctl device lines ("    iPhone 17 Pro (<UDID>) (Booted)") into
# "name|UDID|state" rows.
_sim_rows() {
  sed -nE "s/^[[:space:]]+(.+) \\((${_SIM_UDID_RE})\\) \\(([A-Za-z ]+)\\)[[:space:]]*\$/\\1|\\2|\\3/p"
}

_sim_table() { xcrun simctl list devices available 2>/dev/null | _sim_rows; }

# First iPhone listed under the last "-- iOS x --" section.
_sim_default_row() {
  xcrun simctl list devices available 2>/dev/null | awk '
    /^-- iOS /      { sec++; inios = 1; next }
    /^-- /          { inios = 0; next }
    inios && /^[[:space:]]+iPhone / && !(sec in first) { first[sec] = $0 }
    END             { if (sec in first) print first[sec] }
  ' | _sim_rows
}

sim_is_booted() {
  _sim_table | awk -F'|' -v u="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" \
    'tolower($2) == u && $3 == "Booted" { found = 1 } END { exit !found }'
}

sim_resolve() {
  local want="${1:-}" table row booted count
  table="$(_sim_table)"

  if [[ -n "${want}" && "${want}" =~ ^${_SIM_UDID_RE}$ ]]; then
    row="$(printf '%s\n' "${table}" | awk -F'|' -v u="$(printf '%s' "${want}" | tr '[:upper:]' '[:lower:]')" \
      'tolower($2) == u { print; exit }')"
    if [[ -z "${row}" ]]; then
      echo "No simulator with UDID '${want}'. List with: xcrun simctl list devices" >&2
      return 1
    fi
    printf '%s\n' "${want}"
    return 0
  fi

  if [[ -n "${want}" ]]; then
    row="$(printf '%s\n' "${table}" | awk -F'|' -v n="${want}" '$1 == n && $3 == "Booted" { print; exit }')"
    [[ -n "${row}" ]] || row="$(printf '%s\n' "${table}" | awk -F'|' -v n="${want}" '$1 == n { last = $0 } END { if (last != "") print last }')"
    if [[ -z "${row}" ]]; then
      echo "No simulator named '${want}' available. List with: xcrun simctl list devices" >&2
      return 1
    fi
    printf '%s\n' "${row}" | cut -d'|' -f2
    return 0
  fi

  booted="$(printf '%s\n' "${table}" | awk -F'|' '$3 == "Booted"')"
  count="$(printf '%s' "${booted}" | grep -c . || true)"
  if [[ "${count}" -gt 1 ]]; then
    echo "Refusing to guess: more than one simulator is booted; name one with --sim <name|UDID>:" >&2
    printf '%s\n' "${booted}" | awk -F'|' '{ printf "  %s (%s)\n", $1, $2 }' >&2
    return 1
  fi
  if [[ "${count}" -eq 1 ]]; then
    printf '%s\n' "${booted}" | cut -d'|' -f2
    return 0
  fi

  row="$(_sim_default_row)"
  if [[ -z "${row}" ]]; then
    echo "No iPhone simulator available. List with: xcrun simctl list devices" >&2
    return 1
  fi
  printf '%s\n' "${row}" | cut -d'|' -f2
}
