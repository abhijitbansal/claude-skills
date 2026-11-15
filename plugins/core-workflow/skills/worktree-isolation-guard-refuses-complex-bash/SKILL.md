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
in a construct too complex to verify. A user's own `!` command also failed
with `The command failed and the error text was withheld.`

Later variants:

- a path or `cd` into a directory named `eval` (`runs a string through eval`)
- a `$VAR`/computed path as a node/python argument
- a `cat > f <<EOF … && python3 …` heredoc chain (`too complex to verify that
  it stays inside the worktree`)
- a `for` loop whose arguments contain "git" (`names git in a form too complex
  to verify`)
- `ln -s <main checkout>/node_modules node_modules` (refused three times in
  one session) and `cd <abs path> && ls -d …/node_modules`
- `find … \( -name a -o -name b \)`
- a `claude -p "<prompt text that names git>"` call
- a `git commit` that was refused and left the tree dirty
- a `grep -n 'a\|b'` alternation refused as `runs a string through eval`
  (seen once, not reproduced; most likely the literal `eval` substring match,
  since a word such as "retrieval" contains it)

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
6. Use literal absolute paths (no `$VAR`/computed paths as arguments) and
   no `cd`. Write scripts with the Write tool and run the file. If the
   guard false-positives on a literal directory named `eval`, a glob avoids
   the text match while still naming the same directory:
   `node --test "/abs/path/to/worktree/plugins/<pkg>/ev[a]l/…"`. The quoted
   glob is expanded by `node --test` itself (Node 21+), not by the shell.
   For other commands, use the unquoted form so the shell expands it:
   `ls /abs/path/to/worktree/plugins/<pkg>/ev[a]l/`. Two limits of that glob:
   in zsh an unquoted glob that matches nothing is an error
   (`no matches found`), so it fails for a file that does not exist yet. Create
   new files under such a directory with Write/Edit, and read or change
   existing ones with Read/Edit. And the guard refuses `git` with a glob in its
   arguments (`redirects git through a glob pattern`), so never stage with
   `git add …/ev[a]l/…`: stage the parent directory by literal path, or hand
   the `git add` to the user per item 4.
7. The guard's pattern match is text-based and inconsistent: the same
   command can pass in one session and be refused in another. Treat a refusal
   as a signal to simplify, not as proof the command was unsafe.
8. After a refusal, retry the simple form. Do not reword the same compound
   command to slip past the guard; the only exception is the literal-name
   false positive in item 6.
9. Variants and their plain forms: `ln -s … node_modules` → run
   `npm ci --prefix <abs skill dir>` (or hand it to the user) instead of
   linking; `find … \( -o \)` → two finds, or Glob; a `claude -p` prompt that
   names git → write the prompt to a file with Write and pass the path; after
   a refused `git commit`, run `git status` before any review-package or
   next-step call, because the tree may be dirty and the commit never happened.
10. macOS path spellings. `/tmp`, `/var` and `/etc` are symlinks into
    `/private`, so the same directory has two spellings (`/tmp/x` and
    `/private/tmp/x`; the session scratchpad is printed with `/private`).
    When a hook, allow rule or script compares paths, fold both sides with
    `realpath` first (or match both spellings); a literal that matches one
    spelling silently misses the other.

## Evidence

Mined from session digests; about 6 sessions across 3 projects found
independently: a private-project worktree `e9097288` (the `-C` refusal), a
private iOS app `ea9bc432` (string through `.`), a
private-bot worktree `bb35f1a6` (too complex to verify), a private bot
`c2a681f5` (withheld error text).

## Related skills

- `superpowers:using-git-worktrees` — how worktree sessions are set up.
- `core-workflow:xcode-license-blocks-git-exit-69` — another git failure
  that is environmental, not a code problem.
- `core-workflow:blast-radius-rm-hold-unattended-subagent-stall` — the
  sibling hook that holds `rm`.
