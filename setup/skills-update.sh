#!/usr/bin/env bash
# Weekly job body: update globally installed npx skills (vercel-labs "skills" CLI).
# Run by the launchd agent that setup.sh's `skills_schedule` step installs; safe to
# run by hand too. Appends a timestamped log and a before/after summary of
# ~/.agents/.skill-lock.json (skill name + updatedAt) to
# ~/Library/Logs/claude-skills/skills-update.log, and exits with npx's exit code.
#
# Env (all optional):
#   SKILLS_NPX          absolute path to npx (the plist sets it at install time)
#   SKILLS_LOCK_FILE    lock file to diff (default ~/.agents/.skill-lock.json)
#   SKILLS_NPX_TIMEOUT  seconds before a hung npx is killed (default 900 = 15 min)
#   SKILLS_EXTRA_PATH   dirs put on PATH after npx's own (default
#                       /opt/homebrew/bin:/usr/local/bin); the one place PATH is set
set -uo pipefail

LOCK="${SKILLS_LOCK_FILE:-${HOME}/.agents/.skill-lock.json}"
LOG_DIR="${HOME}/Library/Logs/claude-skills"
LOG="${LOG_DIR}/skills-update.log"
DEFAULT_TIMEOUT=900
TIMEOUT="${SKILLS_NPX_TIMEOUT:-${DEFAULT_TIMEOUT}}"
MAX_LOG_BYTES=1048576
KEEP_LOG_LINES=2000

mkdir -p "${LOG_DIR}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "${LOG}"; }

# Keep the log under ~1 MB: when it is bigger, keep only its last lines.
if [[ -f "${LOG}" ]]; then
  log_bytes="$(wc -c < "${LOG}")"
  if [[ "${log_bytes}" -gt "${MAX_LOG_BYTES}" ]]; then
    if tail -n "${KEEP_LOG_LINES}" "${LOG}" > "${LOG}.trim" && mv "${LOG}.trim" "${LOG}"; then
      log "log trimmed to its last ${KEEP_LOG_LINES} lines (was ${log_bytes} bytes)"
    else
      rm -f "${LOG}.trim"
    fi
  fi
fi

if ! [[ "${TIMEOUT}" =~ ^[1-9][0-9]*$ ]]; then
  log "SKILLS_NPX_TIMEOUT '${TIMEOUT}' is not a positive integer; using ${DEFAULT_TIMEOUT}"
  TIMEOUT="${DEFAULT_TIMEOUT}"
fi

BASE_PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
NPX="${SKILLS_NPX:-$(command -v npx 2>/dev/null || echo /opt/homebrew/bin/npx)}"

# launchd starts jobs with a near-empty PATH. npx is a node script, so node must
# be reachable: put npx's own directory first, then the usual install prefixes.
set_path() {
  local extra="${SKILLS_EXTRA_PATH-/opt/homebrew/bin:/usr/local/bin}"
  PATH="$(dirname "${NPX}")${extra:+:${extra}}:${BASE_PATH}"
  export PATH
}
set_path

if [[ ! -x "${NPX}" ]]; then
  # The pinned path can go stale (node upgrade, moved prefix): look on PATH.
  found="$(command -v npx 2>/dev/null || true)"
  if [[ -n "${found}" && -x "${found}" ]]; then
    log "SKILLS_NPX ${NPX} is not executable; falling back to ${found}"
    NPX="${found}"
    set_path
  else
    log "FAILED: npx not executable at ${NPX}"
    exit 126
  fi
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
BEFORE="${TMP_DIR}/before.json"
OUT="${TMP_DIR}/npx.out"
TIMED_OUT="${TMP_DIR}/timed-out"

if [[ -f "${LOCK}" ]]; then cp "${LOCK}" "${BEFORE}"; else echo '{}' > "${BEFORE}"; fi

log "start: ${NPX} -y skills update -g -y"
# Job control gives npx its own process group (pgid == npx_pid), so a timeout
# can take down npx and everything it spawned, grandchildren included.
set -m
"${NPX}" -y skills update -g -y < /dev/null > "${OUT}" 2>&1 &
npx_pid=$!
set +m
# Watchdog (macOS has no timeout binary): TERM npx's whole group after
# ${TIMEOUT}s, KILL whatever is left after a 5 s grace. Ends by itself once the
# group is gone.
(
  waited=0
  while kill -0 "${npx_pid}" 2>/dev/null; do
    if [[ "${waited}" -ge "${TIMEOUT}" ]]; then
      : > "${TIMED_OUT}"
      kill -TERM -- "-${npx_pid}" 2>/dev/null
      grace=0
      while kill -0 -- "-${npx_pid}" 2>/dev/null; do
        if [[ "${grace}" -ge 50 ]]; then
          kill -KILL -- "-${npx_pid}" 2>/dev/null
          break
        fi
        sleep 0.1
        grace=$((grace + 1))
      done
      exit 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
) > /dev/null 2>&1 &
watchdog_pid=$!
# launchd's TERM (bootout) reaches this script only; pass it on to npx's group.
trap 'kill "${watchdog_pid}" 2>/dev/null; kill -TERM -- "-${npx_pid}" 2>/dev/null; exit 143' TERM INT HUP
{ wait "${npx_pid}"; } 2>/dev/null
rc=$?
# After a timeout let the watchdog finish its grace-period KILL; otherwise stop it.
# The braces keep bash's job-status ("Terminated") line out of stderr.
if [[ -e "${TIMED_OUT}" ]]; then
  { wait "${watchdog_pid}"; } 2>/dev/null
else
  { kill "${watchdog_pid}"; wait "${watchdog_pid}"; } 2>/dev/null
fi
while IFS= read -r line; do log "npx: ${line}"; done < "${OUT}"

if [[ -e "${TIMED_OUT}" ]]; then
  rc=124
  log "FAILED: npx killed after ${TIMEOUT}s timeout"
elif [[ "${rc}" -ne 0 ]]; then
  log "FAILED (exit ${rc})"
fi

# Lock-file diff. Never fails the job: a diff problem is logged, not fatal.
diff_summary="$(python3 - "${BEFORE}" "${LOCK}" <<'PY' 2>&1
import json, sys

def load(path):
    try:
        with open(path) as f:
            return json.load(f).get("skills", {})
    except (OSError, ValueError):
        return {}

before, after = load(sys.argv[1]), load(sys.argv[2])
lines = []
for name in sorted(after):
    new = after[name].get("updatedAt")
    if name not in before:
        lines.append(f"added {name}: {new}")
    elif before[name].get("updatedAt") != new:
        lines.append(f"updated {name}: {before[name].get('updatedAt')} -> {new}")
for name in sorted(before):
    if name not in after:
        lines.append(f"removed {name}")
print("\n".join(lines) if lines else "no skill changes")
PY
)" || diff_summary="lock diff unavailable: ${diff_summary}"
while IFS= read -r line; do log "lock: ${line}"; done <<< "${diff_summary}"

[[ "${rc}" -eq 0 ]] && log "done"
exit "${rc}"
