# Robust block-once Claude Code hooks: sentinel/fail-open design and git-diff range accuracy

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0010-2026-07-05-compliance-hooks); adversarially verified.

## Problem
Writing PreToolUse/Stop hooks that nudge-once (not nag repeatedly) and detect real conditions is deceptively easy to get subtly wrong: a `git diff` two-dot range in a Stop hook leaked *main-only* commits into the 'was file X touched' check, wrongly suppressing the reminder whenever `main` had advanced with unrelated commits (the repo's normal state) — a false negative that would silently defeat the hook. Separately, a regex meant to detect `git push` in a Bash command missed metachar-terminated invocations (`git push;`, `cd r && git push`) and false-positived on `git push` appearing inside a quoted string (`git commit -m "…git push…"`).

## Solution
For a 'has X happened since branch point' Stop-hook check, use `git log --name-only <merge-base>..HEAD` (or an equivalent range-accurate query) rather than a two-dot `git diff` against a moving ref — two-dot diffs against a ref that advances independently silently include unrelated changes. For matching a shell command by name in a hook payload, anchor the pattern to statement position (start-of-string or after `;`/`&&`/`|`) and use a trailing boundary that includes common metacharacters, not just whitespace — otherwise both false negatives (real invocations missed) and false positives (matches inside quoted strings) occur. For 'must-acknowledge once' semantics, combine a per-(session, command-hash) sentinel file with `stop_hook_active`, and make the sentinel write itself fail-open (an unwritable temp dir must degrade to 'never block' — the advisory gate must not harden into a permanent block on infrastructure failure).

## Evidence
Session 0010: '(HIGH) the Stop hook used a two-dot git diff "$RANGE" that leaks main-only session-log files into the "was the log touched" check... switched to a range-accurate git log --name-only; (MEDIUM) the push regex missed metachar-terminated real pushes (git push;, cd r && git push) and false-positived on git push inside quoted args... re-anchored git to statement position and widened the trailing boundary; plus... sentinel-write fail-open (an unwritable tmp must not harden an advisory gate into a permanent block).'

## When to Use
This is generic Claude Code / shell hook-engineering, independent of iOS or Cubby: any project writing PreToolUse Bash-matching hooks or Stop-hook diff-based checks will hit the same two bugs (git range choice, command-string regex anchoring) and the same nag-loop design requirement.
