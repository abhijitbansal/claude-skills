---
name: hook-merge-base-diff-command-regex-anchoring
description: A Stop hook's "was file X touched since branch point" check silently never fires even though the file WAS touched — because a two-dot `git diff <ref>..HEAD` against a moving branch ref (e.g. `main`) diffs full trees, not commit history, so once `main` has advanced independently the diff leaks main-only files/commits into the result and drowns out the real signal; separately, a PreToolUse regex meant to match `git push` in a Bash command either misses metachar-terminated invocations (`git push;`, `cd repo && git push`) or false-positives on `git push` appearing inside a quoted string (`git commit -m "…git push…"`); and a sentinel-file "nudge once per session" gate can harden into a permanent block if its sentinel write fails. Use when writing a PreToolUse Bash-command-matching hook, a Stop-hook check that gates on git history since branch point, or any block-once/nudge-once advisory hook.
---

# Robust hooks: merge-base diffs, anchored command regexes, fail-open sentinels

## Symptom

- A Stop hook meant to remind "you touched file X but didn't do Y" **never
  fires**, even on sessions where X was genuinely touched — the reminder is
  silently and intermittently suppressed depending on how far `main` has
  moved.
- A PreToolUse hook meant to catch `git push` in a Bash command **misses real
  invocations** like `git push;` or `cd repo && git push` (regex boundary too
  narrow), **or** it **fires on commands that never push**, e.g.
  `git commit -m "fixed the git push bug"` (regex matched inside a quoted
  string).
- An advisory "nudge once per session" hook **starts blocking permanently**
  after some unrelated infra hiccup (temp dir unwritable, disk full) — instead
  of degrading to "never block."

## Root cause

**Diff range:** `git diff A..B` and `git diff A B` are identical — a direct
tree-to-tree comparison, not a walk of the commits unique to `B`. Using this
form with `A` = a branch ref that keeps moving (`main`) is *not* the same as
"what changed since I branched." As `main` advances independently, the direct
tree diff increasingly reflects `main`'s own unrelated commits too, and the
signal the hook actually wants (files touched *on this branch*, since it
diverged) gets diluted or replaced. This is a range-accuracy bug, not a syntax
typo — three-dot (`A...B`) or an explicit merge-base fixes it because both
pin the base to the point of divergence instead of to `main`'s current tip.

**Command regex:** matching `git push` by simple substring or a
loosely-anchored regex has two independent failure modes: (1) no statement
boundary — matching only start-of-string or trailing whitespace misses
`git push;` and misses `git push` after `&&` or `|` in a compound command; (2)
no quote-awareness — `git push` appearing inside a quoted argument (a commit
message, a comment) matches the same as a real invocation.

**Sentinel fail-open:** a "have I already nudged this session" gate that
writes a sentinel file to detect repeats will, if the write itself fails
(unwritable temp dir, disk full, sandboxing), either crash the hook or — worse
— treat the unwritable state as "never nudged," causing the block to reappear
every single time with no way to satisfy it. An advisory gate must never let
its own bookkeeping failure become a harder failure mode than having no gate
at all.

## Fix

**1. Diff range — pin to merge-base, not to a moving ref:**

```bash
# WRONG: direct tree diff against main's *current* tip — leaks main-only
# changes into the result once main has advanced past the branch point.
git diff --name-only "$BASE_REF"..HEAD

# RIGHT: pin the base to the actual divergence point first.
merge_base="$(git merge-base "$BASE_REF" HEAD)" || exit 0   # no base (shallow clone, unknown ref): fail open
git log --name-only "$merge_base"..HEAD
# (same file set: git diff --name-only "$BASE_REF"...HEAD — three-dot form;
# log output also carries commit headers)
```

**2. Command regex — anchor to statement position, widen the boundary:**

```bash
# WRONG: no statement anchor, boundary is whitespace-only.
# Misses "git push;" and "cd r && git push"; matches inside quoted strings.
[[ "$cmd" =~ git\ push ]]

# RIGHT: anchor to start-of-string or after a statement separator
# (;  &&  ||  |  or a NEWLINE), allow any whitespace (tabs too) after the
# separator, and terminate on a boundary that includes metacharacters,
# not just whitespace/end-of-string.
#
# Keep the regex in a variable: written inline, the bracket and space rules
# are easy to get wrong. $'...' puts a real newline in the separator class;
# `^` alone only matches the start of the whole string, so a command on
# line 2 is invisible without it. Verified in bash 3.2 (macOS /bin/bash).
re=$'(^|[;&|\n])[[:space:]]*git[[:space:]]+push([[:space:]]|[;&|]|$)'
[[ "$cmd" =~ $re ]]
```

Case table (probed in `/bin/bash` 3.2; the older regex
`(^|[;&|]) *git[[:space:]]+push(...)` missed the two rows marked MISS-before):

| Command | Result |
|---|---|
| `git push` | match |
| `cd x; git push origin` | match |
| `cd r && git push` | match |
| `cd repo` + newline + `git push` | match (MISS-before) |
| `cd repo;` + tab + `git push` | match (MISS-before) |
| `git` + tab + `push` | match |
| `echo git push` | no match |
| `git pushx` | no match |
| `git commit -m "git push"` | no match |
| `(git push)` | no match (documented gap, below) |

This regex still misses `git -C <dir> push`, `git -c foo=bar push`,
`FOO=1 git push` (anything between `git` and `push`, or an env prefix before
`git`) and the subshell form `(git push)`; widen it if those matter.

The Bash hook payload carries the raw command string only, with no parsed
argv, so a match is advisory, never authoritative. Statement-anchoring cannot
remove the quoted-string false positive (`git commit -m "fix; git push bug"`
still matches). Design the hook so a wrong match costs a harmless nudge, not a
block.

**3. Sentinel — fail-open on infra failure:**

```bash
sentinel="$SENTINEL_DIR/${session_id}-${command_hash}"
[[ -f "$sentinel" ]] && exit 0   # already nudged this (session, command)
if ! mkdir -p "$SENTINEL_DIR" 2>/dev/null || ! : > "$sentinel" 2>/dev/null; then
  exit 0   # can't record the nudge -> don't block; advisory gates must
           # degrade to "never block," never to "always block."
fi
# first call only: sentinel now exists, so the next call exits above
echo "Nudge: ..." >&2
exit 2     # block once
```

Check for the sentinel BEFORE creating it. With the order reversed, the
sentinel always exists by the time it is checked, so the check always
passes and the nudge never fires.

When the gate is a Stop hook, combine the sentinel with `stop_hook_active`
(Claude Code sets this on the *second* Stop-hook invocation in a turn) so
the nudge fires once and the re-invocation after the user acts doesn't
loop.

## Checklist for authoring a guard hook (one that blocks or nudges on a command)

Guard hooks keep failing in the same few ways; Cubby's own guards took dozens
of fix commits (about 36 to 38 guard fixes measured by commit subject, 55 in the
wider regex cluster). Run this list before shipping one, in addition to the
anchoring rules above:

1. Anchor every match to command position, never to a bare substring. A
   command-position false positive reproduced eight times in the session that
   fixed one; test each deny rule with the word in an argument, a path, a quoted
   string and a filename.
2. Strip a heredoc body only when it is provably data (the delimiter is quoted
   and nothing evaluates it). A body that reaches `sh`, `eval` or `source` is
   code; stripping it hides a real command.
3. Resolve `git -C <dir>` and a preceding `cd <dir> &&` before judging what a
   command touches, and normalise quotes and flags (`-c k=v`, `--git-dir`).
4. Chained commands are the bypass: a guard that checks only the first command
   let a chained delete through (a critical fix). Split on `;`, `&&`, `||`, `|`
   and newlines and judge each part.
5. Bound the statement splitter. A quadratic splitter took 27.6 s on a 40 KB
   command against a 10 s hook timeout, so the hard check silently never ran.
   Test with a command near the size you expect, against the real timeout, and
   decide what a timeout means (fail open for a nudge, fail closed for a deny).
6. Under `set -o pipefail`, `printf '%s' "$cmd" | grep -q …` can return 141
   (SIGPIPE) and read as "no match". Use a herestring: `grep -q … <<< "$cmd"`.
7. Fixtures come first and from another author: one should-block and one
   should-allow set, written by an agent or person who has not seen the regex.
   A guard has not been proven until it has been seen blocking the bad input.
8. Warn only about what ran. A gate that warned on a chained command that never
   executed trained people to ignore it.
9. Keep the user-facing deny text naming the lesson and the plain form to use
   instead, so the refusal teaches (see
   `core-workflow:worktree-isolation-guard-refuses-complex-bash`).

## Evidence

From Cubby's compliance-hooks session (0010-2026-07-05):

> (HIGH) the Stop hook used a two-dot git diff "$RANGE" that leaks main-only
> session-log files into the "was the log touched" check... switched to a
> range-accurate `git log --name-only` [merge-base..HEAD]; (MEDIUM) the push
> regex missed metachar-terminated real pushes (`git push;`, `cd r && git
> push`) and false-positived on `git push` inside quoted args... re-anchored
> git to statement position and widened the trailing boundary; plus...
> sentinel-write fail-open (an unwritable tmp must not harden an advisory gate
> into a permanent block).

## Related skills

- `learn-lesson` — the pipeline this lesson was mined through.
- `gateguard` (ecc) — a related first-Write/Edit-per-file gate with its own
  sentinel/retry semantics; compare fail-open design if extending either.
