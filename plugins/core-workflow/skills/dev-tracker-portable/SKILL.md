---
name: dev-tracker-portable
description: Set up or run a lightweight in-repo dev tracker (features / issues / tasks as one markdown ledger + archive) in ANY project — the proven Cubby tracker system, genericized. Use when a project wants issue/feature/backlog tracking inside the repo ("set up a tracker", "log bugs in the repo", "I want a backlog file"), or when running tracker operations (capture / list / fix / learn) in a repo that has adopted this system. Upstream: Cubby's .claude/skills/tracker/SKILL.md (dogfooded across 20+ sessions, 90+ items, plus an archive-pipeline fix learned the hard way) — mirror structural changes both ways.
---

# dev-tracker (portable starter kit)

One markdown ledger + dated archives + four modes. Proven shape: capture is instant
(no research), fixing is full ceremony (plan → approve → TDD → review), learning is
suggest-only. Two hard-won pipeline rules are baked in: **shipped-archive** (items
must not depend on manual device-verification to leave the active file — the origin
project hit 64 stuck items / 48× file growth before this rule) and the
**last-learn marker** (a stateless learn-mode never runs unless something nudges it).

## Files

```
docs/tracker/
  TRACKER.md            # active items — one ## section each
  screenshots/          # <ID>-<n>.png, transient
  archive/YYYY-MM.md    # archived items, keyed by merge month
```

`TRACKER.md` header carries two standing lines:
- the status-flow line (below), and
- `last-learn: <sNN · date | never>` — updated by LEARN, read by the session-end nudge.

## Item format

```markdown
## BUG-045 · Keyboard won't dismiss on capture review
- type: issue   status: open   severity: med   screen: CaptureReview
- logged: s32 · 2026-07-13   branch: feature/foo
- fixed: —   verified: —   attempts: 0
- related: —   screenshots: [BUG-045-1.png]

One-line intent. Expected vs actual for issues.
```

- **ID** — `FEAT-NNN` / `BUG-NNN` / `TASK-NNN`, per-prefix counters, never reused.
  Next ID = max across `TRACKER.md` + all `archive/` files + 1; scan only real `##`
  item headings (never IDs inside code fences or templates).
- **type** — `feature` (new capability) | `issue` (defect/regression) | `task`
  (ops/deploy/verify/chore/tech-debt/docs — not a defect, not a capability).
- **status** — `open → planned → in-progress → fixed → verified → closed`, plus
  `wont-fix`, `duplicate` (with `duplicate-of:`).
- **attempts** — +1 when a fixed/closed item is re-logged (recurrence) or a fix needed
  ≥2 materially different attempts in one pass. This is the signal LEARN reads —
  never file a recurrence as a plain duplicate.

## Modes

**CAPTURE** (cheap, instant — no source reads, no diagnosis): split prompt into items;
dedup against open items + last ~20 closed on title/screen/family (high match bar —
when in doubt log new); on a strong match offer {duplicate / added-scope / related /
new} for open matches, {recurred / duplicate / related / new} for fixed-or-closed
(including shipped-archived) matches; assign ID; append; commit
`chore(tracker): log <IDs>`.

**LIST**: render filtered table (`ID · type · status · screen · attempts · title`),
no writes. Filters: open/features/issues/tasks/all/screen:/severity:.

**FIX** (full ceremony): resolve target set → group into a coherent wave → **plan
first and WAIT for approval** (no code before approval, ever) → TDD for logic changes,
manual-step confirmation for ops tasks → per-task review gate → update statuses +
`fixed:` stamps → sync user-facing changelog surfaces before the wave-end checklist →
archive at merge. Route plan authoring + adversarial plan review to your top-tier
model by dispatch; implementation at mid tier.

**LEARN** (suggest-only): collect `attempts ≥ 2` items + cross-screen `related`
clusters; cross-reference session logs for the why; emit a prose report of patterns
+ recommendations (each tagged: skill / conventions amendment / hook / memory).
Draft no files EXCEPT the bookkeeping exception: update the `last-learn:` marker and
commit it.

## Archive pipeline (the part everyone gets wrong)

1. **Terminal-status archive:** `verified`/`closed`/`wont-fix`/`duplicate` items move
   to `archive/YYYY-MM.md` at wave merge; their screenshots are deleted.
2. **Shipped-archive:** a `status: fixed` item ALSO archives — without `verified` —
   once its wave merged AND a release containing the fix shipped ≥1 release ago with
   no regression reported. Keep `status: fixed`, append
   `archived: shipped v<N> unverified — no regression reported as of s<#>`. Sweep the
   item's screenshots on shipped-archive too. Verification becomes opportunistic
   (upgrade in place later). Without this rule the active file grows monotonically
   because manual verification never closes.
3. **Session-end hygiene:** at every wave boundary, archive what qualifies, REPORT
   (don't auto-archive) stale `fixed` items older than the current wave, and nudge
   LEARN if `last-learn:` is absent or ≥3 waves old.

## Thin command files (optional)

Create `.claude/commands/{feature,issue,task,backlog,fix,tracker-learn}.md`, each a
2-line delegate, e.g.:

```markdown
Log the following as a feature (type=feature) in the dev tracker.
Follow the tracker skill (CAPTURE mode) exactly. Input: $ARGUMENTS
```

(`/fix` delegates to FIX mode, `/backlog` to LIST, `/tracker-learn` to LEARN.)

## Project bindings — FILL THIS IN per project

- **Session-# source:** <e.g. docs/sessions/README.md last row, or omit sessions>
- **Plan-doc home:** <e.g. docs/plans/>
- **Reviewer:** <e.g. ecc:swift-reviewer / your review command> + the exact
  whole-suite test invocation (with any required flags)
- **Device/manual-checklist home + slug rule:** <path convention, or n/a>
- **Screenshot grab:** <MCP/tool, or manual paths only>
- **Wave/branch + model-routing rules:** <pointer to the repo's conventions doc>
- **Release detection for shipped-archive:** <how to tell a fix shipped — release
  tags, TestFlight builds, deploy log>

## Token discipline

Grep item headings, read single items by offset; never read `archive/` unless LEARN
or deep dedup needs history; no pre-emptive file splits (revisit only if the OPEN set
hits hundreds).
