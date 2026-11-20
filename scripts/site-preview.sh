#!/usr/bin/env bash
# Preview the public site locally, staged exactly as .github/workflows/pages.yml
# deploys it: site/ + docs/ flattened into .scratch/_site with the cross-links
# rewritten. Serves it on a free loopback port in the background, checks that
# index.html and assets/site.css answer 200, then prints the page URLs and the
# stop command.
#
# Usage:
#   scripts/site-preview.sh              stage, serve, check, print URLs
#   scripts/site-preview.sh --port 8800  serve on this port instead of a free one
#   scripts/site-preview.sh --stage-only stage into .scratch/_site, do not serve
#   scripts/site-preview.sh --stop       stop the server this script started
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${ROOT}/.scratch"
OUT="${SCRATCH}/_site"
PIDFILE="${SCRATCH}/site-preview.pid"
LOG="${SCRATCH}/site-preview.log"
ACCEPTED="--port <n>, --stage-only, --stop, -h/--help"
READY_TRIES=50          # x 0.1s

usage() { sed -n '8,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

PORT=""
MODE="serve"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || { echo "--port needs a number" >&2; exit 2; }
      PORT="$2"; shift ;;
    --stage-only) MODE="stage" ;;
    --stop)       MODE="stop" ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "unknown argument: $1 (accepted: ${ACCEPTED})" >&2; exit 2 ;;
  esac
  shift
done

stop_server() {
  if [[ -f "${PIDFILE}" ]]; then
    local pid
    pid="$(cat "${PIDFILE}")"
    if kill "${pid}" 2>/dev/null; then echo "stopped site preview (pid ${pid})"; else echo "no running preview (stale pid ${pid})"; fi
    rm -f "${PIDFILE}"
  else
    echo "no site preview running (no ${PIDFILE})"
  fi
}

if [[ "${MODE}" == "stop" ]]; then stop_server; exit 0; fi

# --- stage (mirrors the "Stage site" step of pages.yml) ---
case "${OUT}" in */.scratch/_site) rm -rf "${OUT}" ;; *) echo "refusing to clear ${OUT}" >&2; exit 1 ;; esac
mkdir -p "${OUT}/features" "${OUT}/second-wind"
cp "${ROOT}/site/index.html" "${OUT}/index.html"
cp "${ROOT}/site/og.png" "${OUT}/og.png"
cp "${ROOT}/site/favicon.ico" "${OUT}/favicon.ico"
cp "${ROOT}/site/apple-touch-icon.png" "${OUT}/apple-touch-icon.png"
cp -r "${ROOT}/site/assets" "${OUT}/assets"
cp "${ROOT}"/docs/*.html "${OUT}/" 2>/dev/null || true
cp "${ROOT}"/docs/features/*.html "${OUT}/features/" 2>/dev/null || true
cp -r "${ROOT}/docs/features/showcase" "${OUT}/features/showcase" 2>/dev/null || true
cp "${ROOT}/docs/second-wind/index.html" "${OUT}/second-wind/index.html" 2>/dev/null || true
# perl -pi works the same on macOS and Linux (sed -i does not).
find "${OUT}" -name '*.html' -print0 | xargs -0 perl -pi -e '
  s#\.\./docs/##g;
  s#\.\./site/index\.html#index.html#g;
  s#\.\./site/assets/#assets/#g;
  s#\.\./site/favicon\.ico#favicon.ico#g;
  s#\.\./site/apple-touch-icon\.png#apple-touch-icon.png#g;'
echo "staged ${OUT}"
[[ "${MODE}" == "stage" ]] && exit 0

# --- serve ---
[[ -f "${PIDFILE}" ]] && stop_server
if [[ -z "${PORT}" ]]; then
  PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
nohup python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${OUT}" >"${LOG}" 2>&1 &
echo $! > "${PIDFILE}"
BASE="http://127.0.0.1:${PORT}"

status_of() { curl -s -o /dev/null -w '%{http_code}' "$1" || true; }
for _ in $(seq "${READY_TRIES}"); do
  [[ "$(status_of "${BASE}/index.html")" == "200" ]] && break
  sleep 0.1
done
for path in index.html assets/site.css; do
  code="$(status_of "${BASE}/${path}")"
  if [[ "${code}" != "200" ]]; then
    echo "preview check failed: ${BASE}/${path} answered ${code:-nothing}; see ${LOG}" >&2
    stop_server >&2
    exit 1
  fi
  echo "200 ${BASE}/${path}"
done

echo
echo "Site preview running (pid $(cat "${PIDFILE}")):"
echo "  ${BASE}/index.html"
for page in "${OUT}"/*.html "${OUT}"/features/*.html "${OUT}"/second-wind/index.html; do
  [[ -f "${page}" ]] || continue
  rel="${page#"${OUT}"/}"
  [[ "${rel}" == "index.html" ]] && continue
  echo "  ${BASE}/${rel}"
done
echo
echo "Stop it with: ${ROOT}/scripts/site-preview.sh --stop"
