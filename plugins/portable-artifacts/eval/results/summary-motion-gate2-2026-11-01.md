# make-motion Gate 2 eval, 2026-11-01

Host claude, model haiku (reported `claude-haiku-5-5`). Task 3b (the Kenney sample pack) landed after Gate 1, so `item-cue-kenney` runs here: 14 item prompts (13 planned plus it), bar = ceil(0.9 × 14) = 13 valid. Billed prompts: 14 + 10 = 24, no rerun. Running total with Gate 1: 16 + 24 = 40 of 75. The `validate runs` column counts `validate.mjs` calls per prompt.

## Step 2: items (Tasks 3b, 11-16)

Command: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set items --only item-hold,item-viral,item-block-cta-soft,item-block-story-beats,item-block-listicle,item-block-before-after-swipe,item-transition-push,item-camera,item-code,item-block-code-typing,item-block-code-diff,item-block-terminal-run,item-vars,item-cue-kenney`

Result: valid 14/14 (bar 13); 8 of 14 validated on the first call (runs = 1), the other 6 fixed validator errors and ended valid.

Spec written 14/14 · valid 14/14 · output ok 14/14 · check ok 14/14

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| item-block-cta-soft | ✓ | ✓ | 1 | ✓ | 39 | claude-haiku-5-5 |  | ✓ |
| item-block-story-beats | ✓ | ✓ | 2 | ✓ | 58 | claude-haiku-5-5 |  | ✓ |
| item-block-listicle | ✓ | ✓ | 1 | ✓ | 52 | claude-haiku-5-5 |  | ✓ |
| item-block-before-after-swipe | ✓ | ✓ | 1 | ✓ | 40 | claude-haiku-5-5 |  | ✓ |
| item-cue-kenney | ✓ | ✓ | 1 | ✓ | 113 | claude-haiku-5-5 |  | ✓ |
| item-hold | ✓ | ✓ | 2 | ✓ | 50 | claude-haiku-5-5 |  | ✓ |
| item-viral | ✓ | ✓ | 2 | ✓ | 102 | claude-haiku-5-5 |  | ✓ |
| item-transition-push | ✓ | ✓ | 1 | ✓ | 54 | claude-haiku-5-5 |  | ✓ |
| item-camera | ✓ | ✓ | 3 | ✓ | 69 | claude-haiku-5-5 |  | ✓ |
| item-code | ✓ | ✓ | 2 | ✓ | 66 | claude-haiku-5-5 |  | ✓ |
| item-block-code-typing | ✓ | ✓ | 1 | ✓ | 62 | claude-haiku-5-5 |  | ✓ |
| item-block-code-diff | ✓ | ✓ | 2 | ✓ | 82 | claude-haiku-5-5 |  | ✓ |
| item-block-terminal-run | ✓ | ✓ | 1 | ✓ | 55 | claude-haiku-5-5 |  | ✓ |
| item-vars | ✓ | ✓ | 1 | ✓ | 78 | claude-haiku-5-5 |  | ✓ |

## Step 3: benchmark subset (10 of 12)

`chart-race` needs the race block (Task 23) and `map-regions` needs the bundled atlases (Task 22), both Phase 3, so the full 12 run at Gate 3.

Command: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set benchmark --only launch-teaser,launch-feature-trio,pr-walkthrough,pr-code-diff,captioned-social,captioned-vertical,docs-steps,docs-faq,batch-welcome,batch-kpi-cards`

Result: valid 10/10 (bar 9), `check` ✓ for all ten, median validate runs 2 (sorted 1, 1, 1, 1, 2, 2, 2, 2, 2, 3; bar ≤ 2).

Spec written 10/10 · valid 10/10 · output ok 10/10 · check ok 10/10

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| launch-teaser | ✓ | ✓ | 2 | ✓ | 92 | claude-haiku-5-5 |  | ✓ |
| launch-feature-trio | ✓ | ✓ | 2 | ✓ | 110 | claude-haiku-5-5 |  | ✓ |
| pr-walkthrough | ✓ | ✓ | 2 | ✓ | 138 | claude-haiku-5-5 |  | ✓ |
| pr-code-diff | ✓ | ✓ | 2 | ✓ | 119 | claude-haiku-5-5 |  | ✓ |
| captioned-social | ✓ | ✓ | 2 | ✓ | 91 | claude-haiku-5-5 |  | ✓ |
| captioned-vertical | ✓ | ✓ | 1 | ✓ | 81 | claude-haiku-5-5 |  | ✓ |
| docs-steps | ✓ | ✓ | 1 | ✓ | 83 | claude-haiku-5-5 |  | ✓ |
| docs-faq | ✓ | ✓ | 3 | ✓ | 98 | claude-haiku-5-5 |  | ✓ |
| batch-welcome | ✓ | ✓ | 1 | ✓ | 242 | claude-haiku-5-5 |  | ✓ |
| batch-kpi-cards | ✓ | ✓ | 1 | ✓ | 107 | claude-haiku-5-5 |  | ✓ |

## Step 1: speed

Command: `node .scratch/gate2-speed.mjs` on an Apple M4 Pro, 14 logical cores, darwin arm64, node v24.7.0. The script is gitignored, so here is all it does, to rerun from a clone: four runs in order (`w1-1`, `w1-2` with `--workers 1`, then `w4-1`, `w4-2` with `--workers 4`), each `env SOURCE_DATE_EPOCH=1793318400 node plugins/portable-artifacts/skills/make-motion/scripts/render.mjs plugins/portable-artifacts/skills/make-motion/test/fixtures/benchmark-30s.json --out .scratch/gate2/<run>.mp4 --workers <n>` started with `spawnSync` after removing any old output; `seconds` is the wall-clock of that whole process (`performance.now()` before and after), and the SHA-256 is of the MP4 it wrote. The speedup is the slower one-worker time over the faster four-worker time; the bar is 2x with all four SHA-256 values equal.

| run | workers | seconds | SHA-256 |
|---|---|---|---|
| w1-1 | 1 | 30.35 | a9363289c86517cdb3fbafe3a6354431b63cde0071d5364d56170c4d15e23909 |
| w1-2 | 1 | 30.53 | a9363289c86517cdb3fbafe3a6354431b63cde0071d5364d56170c4d15e23909 |
| w4-1 | 4 | 13.37 | a9363289c86517cdb3fbafe3a6354431b63cde0071d5364d56170c4d15e23909 |
| w4-2 | 4 | 13.57 | a9363289c86517cdb3fbafe3a6354431b63cde0071d5364d56170c4d15e23909 |

Slower one-worker run over faster four-worker run: 30.53 / 13.37 = 2.28x (bar 2x). All four SHA-256 values are equal. Before the timed runs, `validate.mjs` printed `valid` and `check.mjs` printed `check: ok (8 scenes, 79 moments)` with no warnings for the fixture.

## Commands behind the other Gate 2 claims

Run from the repo root, 2026-11-01.

- Backward-compat hash step: `node .scratch/gate2-hash.mjs` (`renderHash` on `references/examples/q3-revenue.json` and `test/fixtures/ok-crossfade.json`, `--fps 10 --size 320x180`, twice each): q3-revenue `cb304e5d1b200a7c6cf97f643e0828ee1f2bbd43d6106bd82f102264e59f9f74`, ok-crossfade `ac06834348317903722a7b1b4057b941ba226e961648b2bf138cad607ebe919a`; each pair is equal and both match the Task 15 baselines.
- Render-twice files, 515 pass, 0 skipped: `env PA_REQUIRE_RENDER=1 node --test` over `determinism`, `cues-v2`, `kenney`, `group`, `video`, `captions`, `blocks`, `formats`, `audits`, `viral`, `viral-blocks`, `transitions`, `camera`, `code`, `workers` and `vars` (`plugins/portable-artifacts/skills/make-motion/test/<name>.test.mjs`).
- Full suites, each exit 0:
  - `env PA_REQUIRE_RENDER=1 npm --prefix plugins/portable-artifacts/skills/make-motion test` (904 pass, 0 fail, 3 skipped: the Kokoro `voice CLI` tests, which need a cached model and `VOICE_TEST=1`)
  - `node --test "plugins/portable-artifacts/eval/test/**/*.test.mjs"` (57 pass)
  - `node --test "plugins/portable-artifacts/bin/test/*.test.mjs"` (120 pass)
  - `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (212 pass)
  - `node plugins/portable-artifacts/bin/sync-shared.mjs --check` (in sync)
  - `python3 scripts/sweep_counts.py --check` (39 sites in sync)
