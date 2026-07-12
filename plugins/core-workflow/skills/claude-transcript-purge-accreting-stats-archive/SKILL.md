---
name: claude-transcript-purge-accreting-stats-archive
description: An "all-time" stats/telemetry dashboard built by mining `~/.claude/projects/**/*.jsonl` session transcripts shows its earliest date silently creeping forward between regenerations (e.g. date_min slid from 2026-05-22 to 2026-06-10 with nobody noticing), or a run with zero live transcripts emits `date_max: null` and a downstream `null.split('-')` crashes the site build — root cause is Claude Code purging local transcripts after `cleanupPeriodDays` (~30 days), so any pipeline that regenerates aggregates by re-mining transcripts is a sliding window masquerading as all-time and permanently loses history each run; use when building or reviewing any pipeline that parses Claude Code session transcripts for stats (foundry telemetry, cc-dashboard, similar dashboards), or any "regenerate aggregates from a rotating/retention-limited local source" pipeline (log rotation, retention-limited APIs) — same accretion shape applies.
---

# Claude Code Transcript Purge: Accreting Stats Archive Pattern

## Symptom

- An "all-time" dashboard's earliest date (`date_min`) creeps forward between
  regenerations — in one case from 2026-05-22 to 2026-06-10 across two runs,
  with nobody noticing until the "always everything since May 1st"
  requirement was reported broken, and it was already broken by then.
- Top-tools / model-mix / agents / skills cards keep shrinking even after a
  naive fix, because only per-day scalars were archived — the breakdowns
  behind percentage cards still re-derive from the live (purged) window.
- A run with zero live transcripts (idle month, wiped machine) emits
  `date_max: null`, and downstream date parsing (`null.split('-')`) crashes
  the site build — exactly the scenario an archive should protect against.

## Root cause

Claude Code purges local session transcripts after `cleanupPeriodDays`
(~30 days). Any pipeline that treats `~/.claude/projects/**/*.jsonl` as the
source of truth and regenerates aggregates by re-mining it on every run is
implicitly a sliding window, not an all-time archive — every regeneration
after the window closes over a day silently and permanently drops that day's
data (unless an old committed snapshot of the output happens to still carry
it).

## Fix

Accrete a committed per-day archive (e.g. `data/stats-archive.json`) merged
on every parse run, not a full re-derivation from live transcripts:

1. **Per-field max merge per day.** A completed past day's true counts never
   legitimately shrink — a recount over full data reproduces the same value,
   so a lower value can only mean purge loss mid-window. `merged[k] =
   max(old, live)` is the only safe merge rule.
2. **Delta-fold by day, not by day-boundary.** Fold archived totals in as
   `max(0, archived - live)` **per day/field** — not "add archived days
   strictly before live coverage". The boundary day is typically partially
   purged; a strict-before fold skips its surplus, and the daily series
   (rebuilt from archive) then exceeds the totals rendered beside it — a
   visible self-contradiction between two numbers on the same dashboard.
3. **Archive nested breakdowns too, not just scalars.** Archiving only
   per-day scalars leaves top-tools/model-mix/agents/skills cards shrinking —
   the same bug the archive exists to fix, just unfixed for those cards.
   Archive per-day Counters (tools/agents/skills/slash/mcp/models + per-model
   token fields) and delta-fold them into the same global aggregates, so
   numerator AND denominator of every percentage card stay consistent with
   each other.
4. **Backfill both `date_min` and `date_max` from the archive.** Otherwise a
   run with zero live transcripts emits `date_max: null` and crashes
   downstream date parsing — the exact scenario the archive exists to cover.
5. **Document what can't be merged, instead of silently faking it.**
   Percentiles/medians (e.g. prompt-size histograms) can't be reconstructed
   from merged aggregates. Say so explicitly in the archive's own notes
   rather than pretending they're all-time when they're really live-window.
6. **Recovery seeding for already-purged history.** Old committed snapshots
   of the *output* JSON are the only remaining source for days that already
   aged out. `git log --follow` the data file, extract the daily series from
   the oldest snapshot(s), and seed the archive with them — partial fields
   are fine, since the delta fold treats missing keys as 0.

## Evidence

- foundry telemetry: `date_min` slid from `2026-05-22` to `2026-06-10`
  between two regenerations of the same "all-time" dashboard, discovered only
  because a user reported the "always everything since May 1st" requirement
  as already broken.
- Review of the first archive fix caught that top-tools/model-mix/agents/skills
  cards still shrank after per-day scalars were archived — "the same bug the
  archive was built to fix, unfixed for those cards" — driving rule 3.

## Related skills

None identified as directly related in this catalog at authoring time; link
bidirectionally to any future skill covering Claude Code transcript mining,
retention-limited log pipelines, or dashboard data pipelines.
