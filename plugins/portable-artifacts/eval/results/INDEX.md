# Eval results index

One row per committed summary in this folder. **Every summary predates 1.2.0** (hand-drawn films, Simple English,
cloud icons) and the 1.3.0 changes, so none of them says anything about the current code. The version column is
the `plugin.json` version at the commit that added the summary; a run may have used an earlier working copy
of that release. No run on 1.2.0 or later has a committed summary.

The prompt files now carry a feature-used check (`feature` column), the edit prompts a path limit, and the summary a
`first try` column; summaries below have none of them, so their "valid" counts overstate what a prompt asked for.
A run on 1.2.0 for comparison can be made from a checkout of `153711dd` (the 1.2.0 merge) and the same command
lines. Results folders (`eval/results/<timestamp>/`) are gitignored; only the `summary-*.md` files and this index are kept.

| Summary | Added in | Skill and host | What it covers | Status |
|---|---|---|---|---|
| [`summary-2026-10-10.md`](summary-2026-10-10.md) | 0.1.0 (a54e0063) | dashboard and motion; claude, codex, local gemma4 | Smoke subset, 2 prompts per skill per host | Historical. Superseded by `summary-full-2026-10-10.md`. |
| [`summary-full-2026-10-10.md`](summary-full-2026-10-10.md) | 0.1.0 (a54e0063) | dashboard and motion; claude (Sonnet), codex, copilot, local gemma4 | Full 10-prompt sets | Historical, 0.1.0 only. Codex motion "6/10" counts a no-op edit that the scorer now fails (see below). |
| [`summary-dashboard-v2-2026-10-12.md`](summary-dashboard-v2-2026-10-12.md) | 0.4.0 (648e0300) | dashboard; claude haiku and sonnet, local gemma4 | 14 prompts | Historical. Predates themes 5 to 9 and the full-stage validate. |
| [`summary-diagram-2026-10-12.md`](summary-diagram-2026-10-12.md) | 0.4.0 (648e0300) | diagram; claude haiku and sonnet, local gemma4 | 8 prompts | Historical. Superseded by the stories run for claude haiku. |
| [`summary-diagram-stories-2026-10-14.md`](summary-diagram-stories-2026-10-14.md) | 0.4.0 (648e0300) | diagram; claude haiku | 10 prompts, with stories and emoji | Historical. No cloud-icon prompt then. |
| [`summary-explainer-2026-10-13.md`](summary-explainer-2026-10-13.md) | 0.4.0 (648e0300) | explainer; claude haiku and sonnet, local gemma4 | 8 prompts | Historical. Local gemma4 scored 0/8. No plan, Simple English, embed-by-file, edit-add or diff prompt then. |
| [`summary-install-targets-2026-10-15.md`](summary-install-targets-2026-10-15.md) | 0.4.0 (648e0300) | install paths for Codex, Copilot, Gemini | Audit against each host's docs, accessed 2026-10-15; not an eval run | Re-check the host docs before relying on it. |
| [`summary-portability-copilot-2026-10-15.md`](summary-portability-copilot-2026-10-15.md) | 0.4.0 (648e0300) | all skills then; Copilot CLI 1.0.98 | One non-interactive run per skill | Historical. make-scene was not in this release. |
| [`summary-scene-2026-10-19.md`](summary-scene-2026-10-19.md) | 0.7.0 (eb0c3df3) | scene; claude haiku | 10 prompts, one billed run | Historical. Results folder was never committed. |
| [`summary-routing-2026-10-21.md`](summary-routing-2026-10-21.md) | 1.0.0 (3cf1e861) | all skills; Copilot CLI 1.0.98 with the `artifact-builder` agent | 10 motion prompts plus 9 runs on the other four, and one hand-off trial | Historical for motion (before 1.1.0). The Claude Code `model: haiku` frontmatter path is still unmeasured. |
| [`summary-motion-gate1-2026-10-31.md`](summary-motion-gate1-2026-10-31.md) | 1.1.0 (1fdb1e6f) | motion items; claude haiku | 14 item prompts | Historical. Before the 1.2.0 blocks. |
| [`summary-motion-gate2-2026-11-01.md`](summary-motion-gate2-2026-11-01.md) | 1.1.0 (1fdb1e6f) | motion items; claude haiku | 14 item prompts | Historical. Before the 1.2.0 blocks. |
| [`summary-motion-gate3-2026-11-02.md`](summary-motion-gate3-2026-11-02.md) | 1.1.0 (1fdb1e6f) | motion items and benchmark; claude haiku | 16 item prompts and 12 benchmark prompts | Historical. Its render-hash table came from a script that was not committed. |
| [`summary-motion-phase4-2026-11-02.md`](summary-motion-phase4-2026-11-02.md) | 1.1.0 (1fdb1e6f) | motion items; claude haiku | 2 item prompts | Historical. |
| [`summary-director-operator-2026-11-18.md`](summary-director-operator-2026-11-18.md) | unreleased (make-motion version 2, 67802e6e) | motion; `claude-director` (director Opus 5.5, `artifact-builder` operator Haiku 5.5) | 10 version 2 prompts, one billed run, `--budget 2` per case | Current. 10/10 valid, 10/10 delegated, total cost $4.66, read from the session stream. Codex and Copilot not run live. |

## What no summary measured

- Simple English, the plan round trip, embeds by file, `diff` sections and cloud diagrams. Prompts for them exist
  (`explainer-features`, `diagram-cloud`); no run of them has a committed summary. (The make-motion 1.2.0 blocks were
  removed with version 1.)
- The director and operator scheme on the four page skills (dashboard, diagram, explainer, scene): only make-motion
  was run (2026-11-18).
- Chart kinds `area`, `scatter`, `bubble`, `heatmap`, `histogram` and `boxplot` (`prompts/dashboard-kinds.json`).
- Gemini CLI, and Codex since 2026-10-10 (CLI 0.145.0).
- Prose and visual quality: every gate above counts valid builds and passing checks, not whether the text or the picture is good.

## Corrections to older numbers

- **Codex motion, 2026-10-10:** `summary-full` and the README said six of ten valid. Reading `full-2026-10-10/codex-motion/results.json`:
  5 prompts built, 4 hit the account's usage limit in 2 to 8 s, and `edit-existing` left the seed untouched (0 validate runs,
  0 changed paths) and counted as valid. The current scorer fails that row, so the figure is 5/10, and 5 of the 5 prompts that ran.
- **Local gemma4:** dashboard 10/10 after the SKILL.md fix (4/10 valid before it, and 10/14 on the 14-prompt set), motion 4/10 to 7/10
  across three runs, diagram 5/8, explainer 0/8. The README used to say weak and local models work; for motion and explainer they did not.

## Reproducibility

Numbers in the summaries that came from a command line in the file (`run-eval.mjs --skill … --set …`) can be rerun, though
the host CLI versions are only recorded where the summary says so. Three things cannot be regenerated from this repo:

- the medians and per-row tables in the older summaries were built by hand from `results.json` files that are gitignored;
- the render-hash table in `summary-motion-gate3-2026-11-02.md` came from `.scratch/gate3-rehash.mjs`, which was never committed,
  and the CHANGELOG's "measured" hash, time and size claims (1.1.0, and 1.2.0 where no summary exists at all) have no committed script behind them;
- a billed run of one cell is `n = 1`: no prompt was run three times, so a pass is one sample.

Label any of those figures "not reproducible" when quoting them.

## Adding a row

After a run, copy its `summary.md` to `summary-<name>-<date>.md`, add the plugin version, the host CLI version and the exact
command line at the top, and add a row here. A new release makes every row above it historical until its prompts are rerun.
