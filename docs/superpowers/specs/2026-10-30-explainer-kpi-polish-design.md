# Explainer KPI polish: even rows, a wide-window check, a stale-copy warning

Date: 2026-10-30. Branch: `worktree-skills-improvement`. Shares one branch and one
PR with the harness-learnings and make-motion parity specs (same date).

## Intent

The owner saw KPI values break across lines in a make-explainer page ("39 / ms",
"10 / / 10") in a showcase page from another repo, theme
`dusk`, built 2026-10-26.

What recon established (measured this session):

- The bug is already fixed in portable-artifacts 1.0.0 (PR #47). Rebuilding the
  same `explainer.json` with today's code keeps every value on one line, and
  `check.mjs` passes. The old page wraps only in a wide window: it is fine at
  820, 1000 and 1280 px and wraps at 1800 px. The flavored themes size
  `.kpi-value` with `1.6rem + 2.2vw`, so the type grows with the window while
  the tiles do not.
- The page came from a stale copy of the plugin. The session that built it ran
  `~/.claude/plugins/cache/claude-skills/portable-artifacts/0.8.0/...` 58 times,
  while `installed_plugins.json` already pointed at `1.0.0` (installed
  2026-10-25). The `1.0.0` cache has no `node_modules`; the likely reason the
  agent used the older folder is that its deps were installed. This is a guess.
- The fixed version has a visible leftover. Each tile shrinks its own value to
  fit, so one row mixes sizes: "20" renders large and "10 / 10" small
  (screenshot at 1800 px).
- `check.mjs` measures two viewports, and neither is wide enough to catch the
  old bug. So the guard that should have caught this regression is unproven at
  the width where it happened.

## Goals

1. **Even rows.** All values in one KPI row render at one font size: the size
   that fits the tightest value in that row. This applies to explainer pages and
   explainer slide decks, in every theme.
2. **Wide-window check.** `check.mjs` adds a wide viewport (around 1800 px) to
   its set. Run against the old page, or a trimmed fixture made from it,
   it must fail. This is the RED step. A pass on the rebuilt page proves nothing
   on its own.
3. **Stale-copy warning.** When a portable-artifacts script runs from a plugin
   cache folder (under `~/.claude/plugins/cache/`) that is not the `installPath`
   recorded for `portable-artifacts@claude-skills` in
   `~/.claude/plugins/installed_plugins.json`, it prints one warning line. The
   line names both paths and the fix (`npm ci` in the installed folder, or the
   doctor). It compares paths only and parses no versions. It stays silent when
   that file is missing or unreadable (Codex, Copilot and Gemini hosts), and
   whenever the script runs from outside the plugin cache. It never fails a
   build.

## Non-goals

- make-dashboard KPI tiles. They have their own sizing and were not reported.
- Changing the 1.0.0 one-line rule, the `KPI_WIDE_CHARS` / `KPI_LONG_CHARS`
  thresholds, or `kpi-long` wrapping for values over 16 characters.
- Auto-switching to the installed copy, or auto-installing its deps. The warning
  informs; it does not act.
- Rebuilding the old page. That is outside this repo, and the owner did not
  pick it.

## Constraints

- Tests first (repo rule): a failing test for row sizing, the RED run of the
  wide check on the old page, and a warning test with a fake
  `installed_plugins.json`, before each implementation.
- `shared/` code is synced into every skill with `node bin/sync-shared.mjs`.
  Edit it there once, never per skill.
- Any user-visible behavior change updates the explainer SKILL.md / README /
  USAGE wording, the plugin CHANGELOG and the feature page. The per-line
  copy-button rule in CLAUDE.md applies to any command shown on a site page.

## Decided

- Scope: the three follow-ups above (owner's pick). "Rebuild the old page" was
  offered and not picked.
- The warning compares paths. A version comparison would misfire on repo
  checkouts and other hosts (this session's own call, from the evidence above).
- **A "row" is the whole KPI group** (this session's call, after the builder
  check). A `kpis` section is a CSS grid, or flex-wrap when a wide tile is
  present, so which tiles share a visual row depends on the window width.
  `kpis.mjs` takes the largest `--n` over the group's non-`kpi-long` items and
  sets it once on the `.kpis` container. This needs no JavaScript and builds the
  same way every time. A per-visual-row resize script was rejected.
- **When the warning fires** (this session's call). It fires only when the
  running script sits under `~/.claude/plugins/cache/` and is not the recorded
  `installPath`. That is exactly the stale-cache case seen in that
  session. Repo checkouts, worktrees, eval temp copies and `npx skills` copies
  stay silent, so tests and the eval need no stderr tolerance.

## Left to the builder

- **Row sizing details.** How `kpi-wide` tiles behave under the group size:
  share it, or keep their own because they are wider. Screenshot both before
  choosing, and state the choice.
- **Wide-check value.** The exact wide viewport width, and whether the deck
  check gets one too.
- **Warning scope.** Which scripts print the warning: build only, or also
  validate and check. Wiring it into all five skills through `shared/` is the
  default.
