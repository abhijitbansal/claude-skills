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
merge_base="$(git merge-base "$BASE_REF" HEAD)"
git log --name-only "$merge_base"..HEAD
# (equivalently: git diff --name-only "$BASE_REF"...HEAD — three-dot form)
```

**2. Command regex — anchor to statement position, widen the boundary:**

```bash
# WRONG: no statement anchor, boundary is whitespace-only.
# Misses "git push;" and "cd r && git push"; matches inside quoted strings.
[[ "$cmd" =~ git\ push ]]

# RIGHT: anchor to start-of-string or after a statement separator
# (;  &&  ||  |), and terminate on a boundary that includes metacharacters,
# not just whitespace/end-of-string.
[[ "$cmd" =~ (^|[\;\&\|]) *git\ push([[:space:]]|[\;\&\|]|$) ]]
```

Statement-anchoring alone doesn't fix the quoted-string false positive —
if the hook payload gives you the parsed argv (not just the raw string), match
against that instead of the raw command text. If only the raw string is
available, tightening the regex reduces false positives but cannot eliminate
them; treat a match as advisory, not authoritative.

**3. Sentinel — fail-open on infra failure:**

```bash
sentinel="$SENTINEL_DIR/${session_id}-${command_hash}"
if ! mkdir -p "$SENTINEL_DIR" 2>/dev/null || ! : > "$sentinel" 2>/dev/null; then
  exit 0   # can't record the nudge -> don't block; advisory gates must
           # degrade to "never block," never to "always block."
fi
[[ -f "$sentinel.acked" ]] && exit 0   # already nudged this (session, command)
```

Combine the sentinel with `stop_hook_active` (Claude Code sets this on the
*second* Stop-hook invocation in a turn) so the nudge fires once and the
re-invocation after the user acts doesn't loop.

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
