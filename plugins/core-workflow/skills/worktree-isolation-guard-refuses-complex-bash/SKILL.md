---
name: worktree-isolation-guard-refuses-complex-bash
description: "In a Claude worktree-isolated session a guard (e.g. worktree isolation) refuses Bash calls it cannot prove stay inside the worktree ('redirects git to the shared checkout via -C', 'too complex to verify', 'runs a string through .', 'command whose name is computed at runtime'), including heredoc appends and a sqlite3 call inside a construct too complex to verify. Use when a Bash call is refused in a worktree session or when writing commands for a session that runs in .claude/worktrees."
---

# Worktree isolation guard: write commands it can verify

## Symptom

Refusals that end `Refusing to run it`:

- `this command redirects git to the shared checkout via -C`
- `this command is too complex to verify that it stays inside the worktree`
- `runs a string through ., which can't be verified to stay inside the worktree`
- a command whose name is computed at runtime (`$cmd ...`)

Triggers seen: `git -C <main checkout>`, `&&` chains, `eval`, `source`,
heredoc appends (a `KNOWN_ISSUES.md` append), and a `sqlite3` call wrapped
in a construct too complex to verify. A user's own `!` command then failed
with `The command failed and the error text was withheld.`

## Root cause

A worktree isolation hook statically parses each Bash command and rejects anything
it cannot prove touches only the worktree. Agents reach for habitual
compound forms; advice also conflicted across sessions (some said use
`git -C`, which is exactly what the guard forbids).

## Fix

1. One plain command per call, run from the worktree cwd, literal command
   names. No pipes, `&&` chains, `eval`, `source` or heredocs.
2. Never `git -C <other path>` and never touch the shared checkout.
3. File content goes through Write/Edit, not shell appends or heredocs.
4. To act on the main checkout, ask the user to run single commands (one
   per `!` line), or to use a separate Terminal window. A `cd … && git …`
   chain failed in practice and contradicts rule 1.
5. A `!` command that fails with withheld output: have it write a log file
   inside the worktree, then Read the log.
   ```bash
   some-command > .scratch/out.log 2>&1
   ```
6. After a refusal, retry the simple form. Do not reword the same compound
   command, and do not try to evade the guard.

## Evidence

Mined from session digests; about 6 sessions across 3 projects found
independently: a private-project worktree `e9097288` (the `-C` refusal), doc-scan
`ea9bc432` (string through `.`), a private-bot worktree `bb35f1a6`
(too complex to verify), a private bot `c2a681f5` (withheld error text).

## Related skills

- `superpowers:using-git-worktrees` — how worktree sessions are set up.
- `core-workflow:xcode-license-blocks-git-exit-69` — another git failure
  that is environmental, not a code problem.
- `core-workflow:blast-radius-rm-hold-unattended-subagent-stall` — the
  sibling hook that holds `rm`.
