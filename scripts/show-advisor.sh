#!/usr/bin/env bash
# Print the text of every advisor() reply found in a Claude Code transcript.
#
# Claude Code's VSCode UI doesn't yet render `advisor_tool_result` content
# blocks — they show up as "Unsupported content type" placeholders. The
# reply text is in the JSONL transcript though, and this script extracts
# it.
#
# Usage:
#   .claude/scripts/show-advisor.sh                  # newest transcript for cwd
#   .claude/scripts/show-advisor.sh --session <id>   # specific session id
#   .claude/scripts/show-advisor.sh --last           # most recent reply only
#   .claude/scripts/show-advisor.sh --list           # list sessions w/ IDs + snippets
#   .claude/scripts/show-advisor.sh <path-to-jsonl>  # explicit transcript path
#
# Session ID = the transcript filename without `.jsonl`. Claude Code's
# VSCode UI doesn't surface it directly; use --list to pick one.
#
# Repo-local — meant to be lifted into a shared plugin once proven.

set -uo pipefail

LAST_ONLY=0
LIST_ONLY=0
TRANSCRIPT=""

while (( $# > 0 )); do
  case "$1" in
    --last)
      LAST_ONLY=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --session)
      shift
      [[ $# -gt 0 ]] || { echo "missing argument for --session" >&2; exit 2; }
      SESSION_ID="$1"
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown flag: $1" >&2
      exit 2
      ;;
    *)
      TRANSCRIPT="$1"
      shift
      ;;
  esac
done

# Resolve the project transcript directory: Claude Code uses
# ~/.claude/projects/<cwd-with-slashes-as-dashes>/<session>.jsonl
CWD_SLUG="$(pwd | sed 's|/|-|g')"
TX_DIR="$HOME/.claude/projects/$CWD_SLUG"

if (( LIST_ONLY )); then
  if [[ ! -d "$TX_DIR" ]]; then
    echo "no transcript directory: $TX_DIR" >&2
    exit 1
  fi
  /usr/bin/python3 - "$TX_DIR" <<'PY'
import json, os, sys, glob, time

tx_dir = sys.argv[1]
rows = []
for path in glob.glob(os.path.join(tx_dir, "*.jsonl")):
    session_id = os.path.basename(path)[:-len(".jsonl")]
    mtime = os.path.getmtime(path)
    size = os.path.getsize(path)
    first_user = ""
    advisor_count = 0
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if rec.get("type") == "user" and not first_user:
                    msg = rec.get("message", {}) or {}
                    c = msg.get("content")
                    if isinstance(c, str):
                        first_user = c
                    elif isinstance(c, list):
                        for b in c:
                            if isinstance(b, dict) and b.get("type") == "text":
                                first_user = b.get("text", "")
                                break
                if rec.get("type") == "assistant":
                    for b in (rec.get("message", {}) or {}).get("content", []) or []:
                        if isinstance(b, dict) and b.get("type") == "advisor_tool_result":
                            advisor_count += 1
    except OSError:
        continue
    rows.append((mtime, session_id, size, advisor_count, first_user.strip().split("\n")[0]))

rows.sort(reverse=True)
print(f"{'updated':<20} {'session id':<38} {'kb':>6} {'advs':>5}  first user message")
for mtime, sid, size, advs, snippet in rows:
    ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime))
    snip = (snippet[:60] + "…") if len(snippet) > 60 else snippet
    print(f"{ts:<20} {sid:<38} {size//1024:>6} {advs:>5}  {snip}")
PY
  exit 0
fi

if [[ -z "$TRANSCRIPT" ]]; then
  if [[ ! -d "$TX_DIR" ]]; then
    echo "no transcript directory: $TX_DIR" >&2
    exit 1
  fi
  if [[ -n "${SESSION_ID:-}" ]]; then
    TRANSCRIPT="$TX_DIR/$SESSION_ID.jsonl"
  else
    # newest jsonl in dir
    TRANSCRIPT="$(/bin/ls -t "$TX_DIR"/*.jsonl 2>/dev/null | head -n1)"
  fi
fi

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  echo "transcript not found: ${TRANSCRIPT:-<none>}" >&2
  exit 1
fi

LAST_ONLY="$LAST_ONLY" /usr/bin/python3 - "$TRANSCRIPT" <<'PY'
import json, os, sys

path = sys.argv[1]
last_only = os.environ.get("LAST_ONLY") == "1"

# Map server_tool_use id -> (line_no, name) so we can correlate.
calls = {}
# Replies as a list of (line_no, call_line_no, tool_name, text).
replies = []

with open(path, "r", encoding="utf-8", errors="ignore") as fh:
    for ln, line in enumerate(fh, 1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        msg = rec.get("message", {}) or {}
        for b in msg.get("content", []) or []:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "server_tool_use":
                calls[b.get("id")] = (ln, b.get("name", ""))
            elif t == "advisor_tool_result":
                use_id = b.get("tool_use_id")
                call_ln, name = calls.get(use_id, (None, "advisor"))
                content = b.get("content")
                text = ""
                if isinstance(content, dict):
                    text = content.get("text", "") or ""
                elif isinstance(content, list):
                    for cc in content:
                        if isinstance(cc, dict) and cc.get("type") == "text":
                            text = cc.get("text", "") or ""
                            break
                elif isinstance(content, str):
                    text = content
                replies.append((ln, call_ln, name, text))

if not replies:
    print(f"no advisor replies in {path}", file=sys.stderr)
    sys.exit(0)

print(f"# {len(replies)} advisor repl{'y' if len(replies)==1 else 'ies'} in {os.path.basename(path)}")
print()

to_show = replies[-1:] if last_only else replies
for i, (ln, call_ln, name, text) in enumerate(to_show, 1):
    header = f"## reply {i}"
    if not last_only:
        header += f" (call line {call_ln}, reply line {ln}, tool={name})"
    else:
        header = f"## last reply (call line {call_ln}, reply line {ln}, tool={name})"
    print(header)
    print()
    print(text.rstrip())
    print()
    if i < len(to_show):
        print("---")
        print()
PY
