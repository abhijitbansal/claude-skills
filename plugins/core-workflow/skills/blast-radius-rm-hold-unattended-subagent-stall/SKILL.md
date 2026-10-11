---
name: blast-radius-rm-hold-unattended-subagent-stall
description: "A Bash call containing rm -rf or rm -f (test loop, staging script, cleanup) is held by a safety hook (e.g. Blast Radius) for 10 minutes and never runs, with 'no answer within 10 minutes' or a denial for an unresolved shell variable target. Use when writing any agent-authored script, test harness or cleanup step, or when dispatching a report-only subagent that may run shell commands."
---

# Agent scripts with `rm`: the approval hold that stalls unattended agents

## Symptom

- `Blast Radius held this command and did not run it: no answer within 10
  minutes. It would have: delete nothing: no file matches $O.`
- `Safety check blocked the rm -rf in my test loop.` The agent rewrites
  the script to use a fresh temp dir.
- Unattended subagents tried to delete reviewer probe files they did not
  own. A report-only sweep reviewer sat blocked for 10 minutes; the next
  dispatch needed a warning that a previous sweeper hung on a blocked call.

## Root cause

An approval hook (e.g. Blast Radius) asks for confirmation on every delete and cannot resolve
computed paths (`$O`, loop variables). A subagent has no human to answer, so
the hold runs to its timeout. Reviewer briefs did not forbid destructive
commands, so agents reached for `rm` as routine tidy-up.

## Fix

1. **Never put `rm` in agent-written scripts or loops.** Make deletion
   unnecessary:
   ```bash
   OUT="$(mktemp -d "${TMPDIR:-/tmp}/scenarios.XXXXXX")"   # fresh dir per run
# (or use the session scratch dir)
   run_scenario "$OUT/case-1"    # nothing to clean up afterwards
   ```
2. Write harnesses to a file with the Write tool and run the file, rather
   than long inline `zsh -c '...'` one-liners: files are reviewable and
   re-runnable. This is NOT a way around the hook. If a delete is genuinely
   required, stop and hand the user the exact command; never move `rm` into
   a file to get past the hook.
3. Never delete files you did not create. Leave cleanup to the user or a
   scratch-dir TTL.
4. If a command is held, rewrite it without the delete. Do not retry it
   unchanged and do not wait out the timeout.
5. Dispatch prompts for reviewers and verifiers (paste this):
   ```text
   COMMAND LIMITS: report-only. Do not run rm, mv, network or install
   commands. Use a fresh mktemp -d "${TMPDIR:-/tmp}/<name>.XXXXXX" for scratch output. Tool-call budget:
   25. If any command is held or blocked by a hook, STOP and report it as
   blocked; do not retry or work around it.
   ```

## Evidence

Mined from session digests; 8 sessions across 3 projects. claude-skills
`094ecb81` (the Blast Radius hold text above), a private web project `41c27adc` (safety
check blocked an `rm -rf` in a test loop; rewritten to a temp dir per
scenario), a private-bot worktree `60710e29` (a report-only sweeper
hung on a blocked call).

## Related skills

- `core-workflow:subagent-report-truncation-delivery-contract` — also paste
  its report block into the same reviewer dispatches.
- `core-workflow:subagent-buildverify-tool-grant-check` — the grant check to
  run before dispatching shell-running agents.
- `core-workflow:worktree-isolation-guard-refuses-complex-bash` — the other
  hook that refuses agent shell commands.
