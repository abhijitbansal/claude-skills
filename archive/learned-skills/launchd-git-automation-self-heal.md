# launchd Git Automation in a Persistent Clone — Three Silent Death Modes

**Extracted:** 2026-07-11
**Context:** macOS launchd job running scheduled git automation (weekly stats/digest/publish) from a dedicated clone (sift-publish / foundry-weekly pattern), `set -euo pipefail` scripts.

## Problem

A persistent automation clone that "just pulls and runs" dies silently in three independent ways, each unnoticed for weeks because nobody watches launchd logs:

1. **Dirty-clone wedge:** a failed run leaves modified tracked files (generated data committed by the pipeline). Every later `git pull --ff-only` refuses ("local changes would be overwritten"), `set -e` aborts before any work. Never self-heals.
2. **Unreachable bootstrap (chicken-egg):** self-bootstrap code inside the script can't run when the clone is missing — the script only exists inside the clone it would create. `cd || true; exec script` then execs a nonexistent path; launchd logs an exit code and nothing else.
3. **Stale retry branch:** `git checkout -b work-branch-<week>` dies on "branch already exists" when a prior attempt pushed but failed later (e.g. `gh pr create` network error). Same-week retry can never succeed.

## Solution

- **Bootstrap lives in the plist command string**, not the script: `if [[ ! -d "$W/.git" ]]; then git clone <url> "$W" || exit 1; fi`.
- **Hard reset before exec, in the plist:** `cd "$W" && git fetch origin && git checkout -f main && git reset --hard origin/main; exec "$W/script.sh"` — simultaneously self-heals dirty state AND guarantees each run executes the latest committed script version (plain pull-inside-script runs last week's copy of itself). Safe because nothing in a dedicated automation clone is ever hand-edited — never do this in a working checkout.
- **Script mirrors the same fetch/checkout -f/reset** (belt and braces for manual runs).
- **`git checkout -B` (not `-b`)** for the work branch; `git branch -D "$BRANCH"` after the PR opens.
- Keep sift's proven bits: `caffeinate -i` wrapper (battery machines drop back to sleep mid-run otherwise; `-s` is a no-op on battery), staggered schedules across repos, plist template committed + installed copy separate.

## When to Use

- Writing or reviewing any launchd/cron job that does git pull → generate → commit → push from a long-lived clone.
- Reviewing shell automation with `set -e` + persistent state: ask "what does the NEXT run see after this run dies at each line?"
