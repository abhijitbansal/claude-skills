---
name: unattended-claude-p-launchd-auth-status-truthfulness
description: "An unattended launchd job that runs claude -p fails or lies: 'Failed to authenticate: OAuth session expired and could not be refreshed', a PushNotification skipped so no ping arrives, a status line saying 'auto-merge queued' after the merge request failed, a job running whatever branch the live repo folder has checked out, an offline failure because HF_HOME was set only in the interactive shell while the doctor check passed, or Full Disk Access lost after a Homebrew upgrade. Use when writing or reviewing any scheduled claude -p job, its status/notification text, its plist environment, or its deploy checkout."
---

# Unattended `claude -p` launchd jobs: auth, truthful status, live-checkout hygiene

## Symptom

- `Failed to authenticate: OAuth session expired and could not be refreshed`
  (two jobs one morning).
- A PushNotification is skipped because the terminal is active, so no ping
  arrives.
- A status line says "auto-merge queued" after the merge request failed.
- A job runs whatever branch the repo folder happens to have checked out.
- An offline failure because `HF_HOME` was set only in the interactive shell
  while the doctor check passed.
- Full Disk Access stops working after a Homebrew upgrade.

## Root cause

- `claude -p` needs a live OAuth session and an awake Mac.
- Status text was built before the call's result was known.
- launchd gives the job only the plist environment, while health checks run
  in the user's shell.
- The working tree doubles as dev checkout and deployed code.
- A plist that names a versioned Homebrew Cellar path ties the Full Disk
  Access grant to that exact path; an upgrade changes the path.

## Fix

Unattended `claude -p`:

- Preflight auth before the run. Run `claude auth status --text` as the first
  step of the job script, in the same environment the job runs in (the plist
  environment, not your shell), and treat anything other than a signed-in report
  as failure: write a durable marker file naming the failure and exit non-zero
  before `claude -p` starts. `claude auth status --help` does not document the
  exit code for a signed-out session, so check once on your machine whether it
  is non-zero, and match on the output if it is not.
- Prefer a long-lived credential over the interactive login for a job nobody
  watches: `claude setup-token` creates a long-lived token (needs a Claude
  subscription) that the job passes as `CLAUDE_CODE_OAUTH_TOKEN`, or use an API
  key. The token is a secret: keep it out of the plist in a repo, out of logs and
  out of the README.
- A scrubbed environment can fail the login with `Not logged in` even when your
  shell is signed in: a job that clears the environment (or a plist that sets
  only `PATH`) drops variables such as `USER`, and the headless run then cannot
  find its login. Run the preflight above under the plist environment, and pass
  `USER` (and `HOME`) through explicitly when you scrub.
- Use a non-terminal fallback channel (file, iMessage, gh issue) when
  PushNotification is skipped.
- Build status messages from each step's real exit code; exit non-zero on
  partial failure.

Deploy hygiene:

- Keep the live checkout on `main`; develop in worktrees.
- After a merge, pull the live folder and re-run doctor THERE.
- Make doctor probe under the plist's environment (or warn when shell-only
  vars differ); put required env vars in the plist.
- Use the stable Homebrew symlink path in a plist, not the versioned Cellar
  path. (Reported, not reproduced: the Full Disk Access grant is said to
  survive an upgrade when the plist names the symlink. Verify on your own
  machine after the next upgrade before relying on it.)

## Evidence

Mined, 10 sessions across 3 projects: a weekly launchd job `dc2223e6`
(OAuth text above), a web project `41c27adc` (status said queued after a
failed merge), a bot `c2a681f5` and a worktree `9c45683b` (live checkout on
another branch; plist set only PATH and $APP_HOME).

## Related skills

- `core-workflow:launchd-git-automation-self-heal` — the git pull / bootstrap
  / retry-branch death modes of the same kind of scheduled job.
- `core-workflow:github-solo-branch-protection-codeowners` — the merge step
  these jobs hand back to the user.
