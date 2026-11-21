---
name: launchd-git-automation-self-heal
description: "A launchd (or cron) job that pulls a git clone, generates, commits and pushes on a schedule dies silently for weeks: \"local changes would be overwritten\" from git pull --ff-only after a prior run left dirty tracked files, a bootstrap block that never runs because it lives in the script it is meant to create, or \"branch already exists\" on retrying git checkout -b after a push-then-fail. Use when writing or reviewing a launchd plist and script pair, or a cron job, that does git pull, generate, commit, push from a long-lived clone, or when auditing set -euo pipefail automation for what the NEXT run sees after THIS run dies mid-script."
---

# launchd Git Automation in a Persistent Clone: Four Silent Death Modes

## Symptom

A persistent automation clone that "just pulls and runs" on a launchd/cron
schedule (weekly stats, digest, publish jobs) dies silently in one of four
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
4. **Missed run:** the Mac was powered off or crashed at the fire time, so the
   run never happened. launchd runs a calendar job it missed while the Mac
   slept once the Mac wakes, but not one missed while it was off. Nothing
   reports the gap, and the next fire is a whole period away.

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
    git reset --hard origin/main && git clean -fd && exec "$W/script.sh"
  ```

  Chain with `&&`, never `;` before the `exec`: after a failed fetch or reset a
  `;` still runs the script, against a clone in an unknown state. `reset --hard`
  leaves untracked files behind (a leftover `generated.json` wedges the next
  run), so `git clean -fd` finishes the job. It keeps ignored files, so a
  `.env`, credentials or a cache kept in the clone survive every run. Make it
  `git clean -fdx` only when the clone is dedicated and ignored build output is
  what wedges the job: `-x` also deletes ignored files, which is unrecoverable
  for a `.env` or local credentials. Copy-paste readers: the snippet above is
  the safe default; `-x` is the opt-in.

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

- **Give every attempt its own work branch, and ask GitHub before creating a
  PR** (fixes death mode 3). `git checkout -B` only helps when the earlier
  attempt never pushed: after a push-then-fail it resets the branch and the
  next push is rejected as non-fast-forward, and `git branch -D` on the branch
  you are standing on aborts. Suffix the branch with the run time
  (`work-branch-<week>-<timestamp>`), or run `gh pr view <branch>` first and
  stop when a PR for that week already exists; do not retry with
  `--force-with-lease`. Check out `main` before deleting the work branch, and
  delete it after the PR opens so the next run starts clean.

- **Catch up a missed run** (death mode 4). Add `RunAtLoad` to the plist so the
  job also fires at login or boot, and make the script idempotent: it exits 0
  at once when this period's run already succeeded (a stamp file, or the PR
  that already exists for the week), so firing twice is harmless. To see what
  happened, read the last exit code from `launchctl print gui/$(id -u)/<label>`,
  the tail of the job's log, and the last PR with `gh pr list`. To recover by
  hand, name the missed window explicitly (a date range, not "this week"), start
  the job with `launchctl kickstart gui/$(id -u)/<label>`, retry the merge call
  if it failed, and keep watching until the PR is merged.

- Keep the other operational bits that make unattended scheduled git jobs
  reliable: wrap the whole command in `caffeinate -i` (a battery-powered
  machine drops back to sleep mid-run otherwise — `-s` is a no-op on
  battery), stagger schedules across repos so they don't collide, and keep
  the plist **template committed to the repo** separate from the **installed
  copy** in `~/Library/LaunchAgents` (so plist changes go through review, not
  silent `launchctl` edits on the box).

When reviewing shell automation that combines `set -e` with persistent state
across runs, ask explicitly: **"what does the next scheduled run see after
this run dies at each line?"** Each of the four death modes above answers
that question with "a wedge, not a retry."

## Evidence

Source pattern observed in the launchd automation clones behind a private
publish job and a private weekly job:

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

- `core-workflow:unattended-claude-p-launchd-auth-status-truthfulness` —
  unattended `claude -p` jobs: OAuth expiry, false status text, live-checkout
  and plist-env hygiene.
- `core-workflow:commit` — the commit/push conventions this kind of
  automation should follow once it successfully produces a change.
- `core-workflow:contribute` — branch-then-PR pattern this automation's
  `checkout -B` → push → `gh pr create` flow parallels for human-triggered
  contributions.
