# Claude Code Transcript Mining Loses History — Accreting Archive Pattern

**Extracted:** 2026-07-11
**Context:** Any stats/telemetry pipeline that mines `~/.claude/projects/**/*.jsonl` session transcripts (foundry telemetry, cc-dashboard, similar dashboards).

## Problem

Claude Code purges local transcripts after ~30 days (`cleanupPeriodDays`). Any pipeline that regenerates aggregates by re-mining transcripts silently loses history each run — a sliding window that *looks* all-time. In foundry, `date_min` slid from 2026-05-22 to 2026-06-10 between two regenerations with nobody noticing; the "always everything since May 1st" requirement was already broken when the user reported it. Data that ages past the purge without being archived is **permanently unrecoverable** (unless an old committed snapshot happens to carry it).

## Solution

Accrete a committed per-day archive (`data/stats-archive.json`) merged on every parse run:

1. **Per-field max merge** per day. A completed past day's true counts never legitimately shrink — a recount of full data is identical, so a lower value can only mean purge loss mid-window. `merged[k] = max(old, live)` is the only safe rule.
2. **Delta fold, not day-boundary fold.** Fold the archive back into totals as `max(0, archived - live)` per day/field — NOT "add archived days strictly before live coverage". The boundary day is partially purged: strict-before skips its surplus and the daily series (rebuilt from archive) then exceeds the totals rendered beside it — a visible self-contradiction.
3. **Archive nested breakdowns too, not just scalars.** First version archived only per-day scalars; review caught that top-tools/model-mix/agents/skills cards still shrank — "the same bug the archive was built to fix, unfixed for those cards". Archive per-day Counters (tools/agents/skills/slash/mcp/models + per-model token fields) and delta-fold them into the same global aggregates, so numerator AND denominator of percentage cards stay consistent.
4. **Backfill BOTH `date_min` and `date_max`** from the archive. A run with zero live transcripts (idle month, wiped machine) otherwise emits `date_max: null` and downstream date parsing (`null.split('-')`) crashes the site build — exactly the scenario the archive exists for.
5. **Non-mergeable stats stay live-window by design, documented**: percentiles/medians (prompt-size histograms) can't be merged from aggregates — say so in the archive's note instead of pretending.
6. **Recovery seeding:** old committed snapshots of the output JSON are the only source for already-purged days — `git log --follow` the data file, extract daily series from the oldest snapshot, seed the archive (partial fields are fine; delta fold treats missing keys as 0).

## When to Use

- Building/reviewing anything that parses Claude Code session transcripts for stats.
- Any "regenerate aggregates from a rotating local data source" pipeline (log rotation, retention-limited APIs) — same accretion + max-merge + delta-fold shape.
- Symptom trigger: an "all-time" dashboard whose earliest date creeps forward between regenerations.
