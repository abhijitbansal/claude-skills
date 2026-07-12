---
name: launchd-git-automation-self-heal
description: A launchd (or cron) job that pulls a git clone, generates/commits/pushes, and repeats on a schedule dies silently for weeks — "local changes would be overwritten" from `git pull --ff-only` after a prior run left dirty tracked files, a bootstrap block that never runs because the script it lives in only exists inside the clone it's supposed to create, or "branch already exists" on retrying a `git checkout -b` after a prior push-then-fail. Use when writing or reviewing any launchd plist/script pair (or cron job) that does git pull → generate → commit → push from a long-lived clone, or when auditing `set -euo pipefail` automation for what the NEXT run sees after THIS run dies mid-script.
---

# launchd Git Automation in a Persistent Clone: Three Silent Death Modes

## Symptom

A persistent automation clone that "just pulls and runs" on a launchd/cron
schedule (weekly stats, digest, publish jobs) dies silently in one of three
ways — and because nobody watches launchd logs, it stays dead for weeks:

1. **Dirty-clone wedge:** a failed run leaves modified tracked files behind
   (e.g. generated data the pipeline itself committed). Every subsequent
   `git pull --ff-only` refuses with "local changes would be overwritten,"
   `set -e` aborts before any work happens, and the job never self-heals.
2. **Unreachable bootstrap (chicken-egg):** self-bootstrap code written
   *inside* the automation script can never run when the clone is missing —
   the script only exists inside the clone it's supposed to create. A launcher
   like `cd "$W" || true; exec "$W/script.sh"` execs a nonexistent path;
   launchd logs an exit code and nothing else.
3. **Stale retry branch:** `git checkout -b work-branch-<week>` dies with
   "branch already exists" when a prior attempt pushed the branch but failed
   later in the pipeline (e.g. `gh pr create` hit a network error). Retrying
   the same week can never succeed.

None of these show up as a crash you'd notice interactively — they only show
up as "the weekly digest didn't run again" three weeks later.

## Root cause

The script is written as if every run starts from a clean, existing clone.
That assumption breaks in exactly the ways a scheduled, unattended job
actually fails: a previous run can die mid-write (dirty tree), the clone can
be absent on first run or after manual cleanup (bootstrap), and a previous run
can die *after* partial success (stale branch). `set -euo pipefail` makes
each of these a hard stop with no recovery path, because the recovery logic
either doesn't exist or lives somewhere unreachable.

## Fix

- **Put the bootstrap in the plist's command string, not the script.** The
  script can't create the clone it lives inside; the launcher invocation can:

  ```bash
  if [[ ! -d "$W/.git" ]]; then git clone <url> "$W" || exit 1; fi
  ```

- **Hard-reset before exec, also in the plist**, not just a plain pull inside
  the script:

  ```bash
  cd "$W" && git fetch origin && git checkout -f main && \
    git reset --hard origin/main; exec "$W/script.sh"
  ```

  This does two jobs at once: it self-heals any dirty state left by a prior
  failed run (fixes death mode 1), and it guarantees each run executes the
  *latest committed* version of the script — a plain `pull` from inside the
  script only ever runs last week's copy of itself, since the currently
  executing process was already loaded from disk before the pull completes.
  This is safe **only** because nothing in a dedicated automation clone is
  ever hand-edited — never apply `checkout -f` + `reset --hard` to a working
  checkout a human edits.

- **Mirror the same fetch/checkout -f/reset sequence inside the script too**
  (belt and braces for manual/local runs of the same script).

- **Use `git checkout -B`, not `-b`, for the work branch** — `-B` resets the
  branch if it already exists instead of erroring, making retries idempotent.
  Delete the branch after the PR opens (`git branch -D "$BRANCH"`) so the
  next run starts clean regardless of outcome (fixes death mode 3).

- Keep the other operational bits that make unattended scheduled git jobs
  reliable: wrap the whole command in `caffeinate -i` (a battery-powered
  machine drops back to sleep mid-run otherwise — `-s` is a no-op on
  battery), stagger schedules across repos so they don't collide, and keep
  the plist **template committed to the repo** separate from the **installed
  copy** in `~/Library/LaunchAgents` (so plist changes go through review, not
  silent `launchctl` edits on the box).

When reviewing shell automation that combines `set -e` with persistent state
across runs, ask explicitly: **"what does the next scheduled run see after
this run dies at each line?"** Each of the three death modes above answers
that question with "a wedge, not a retry."

## Evidence

Source pattern observed in the `sift-publish` / `foundry-weekly` launchd
automation clones:

- `git pull --ff-only` failing with "local changes would be overwritten" after
  a run left generated data committed-then-modified in the tracked tree.
- A launcher of the shape `cd "$W" || true; exec "$W/script.sh"` where `$W`
  did not yet exist — the exec target never resolved, and launchd's log
  showed only an exit code with no further diagnostic.
- `git checkout -b work-branch-<week>` failing with "branch already exists"
  after a prior week's run had pushed the branch and then died inside
  `gh pr create` on a network error, leaving no PR and no way to retry that
  week's job under the original branch name.

## Related skills

- `core-workflow:commit` — the commit/push conventions this kind of
  automation should follow once it successfully produces a change.
- `core-workflow:contribute` — branch-then-PR pattern this automation's
  `checkout -B` → push → `gh pr create` flow parallels for human-triggered
  contributions.
