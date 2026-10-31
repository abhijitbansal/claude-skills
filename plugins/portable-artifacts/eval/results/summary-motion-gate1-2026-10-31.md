# make-motion Gate 1 eval, 2026-10-31

Host claude, model haiku (reported `claude-haiku-5-5`). Task 3b (the Kenney sample pack) is deferred, so `item-cue-kenney` is not in this gate: 14 item prompts, bar = ceil(0.9 × 14) = 13 valid. Billed prompts: 14 + 2 = 16. No rerun was needed.

## Step 1: new items

Command: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set items`

Result: valid 14/14 (bar 13). The `validate runs` column counts `validate.mjs` calls per prompt: 6 of 14 validated on the first call (runs = 1); the other 8 fixed validator errors and ended valid, with output and check passing.

Spec written 14/14 · valid 14/14 · output ok 14/14 · check ok 14/14

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| item-cues-v2 | ✓ | ✓ | 2 | ✓ | 78 | claude-haiku-5-5 |  | ✓ |
| item-group | ✓ | ✓ | 2 | ✓ | 75 | claude-haiku-5-5 |  | ✓ |
| item-video | ✓ | ✓ | 2 | ✓ | 81 | claude-haiku-5-5 |  | ✓ |
| item-format-vertical | ✓ | ✓ | 1 | ✓ | 58 | claude-haiku-5-5 |  | ✓ |
| item-captions-srt | ✓ | ✓ | 1 | ✓ | 57 | claude-haiku-5-5 |  | ✓ |
| item-captions-karaoke | ✓ | ✓ | 2 | ✓ | 77 | claude-haiku-5-5 |  | ✓ |
| item-block-title-card | ✓ | ✓ | 3 | ✓ | 80 | claude-haiku-5-5 |  | ✓ |
| item-block-lower-third | ✓ | ✓ | 2 | ✓ | 84 | claude-haiku-5-5 |  | ✓ |
| item-block-kpi-counter | ✓ | ✓ | 1 | ✓ | 75 | claude-haiku-5-5 |  | ✓ |
| item-block-step-flow | ✓ | ✓ | 2 | ✓ | 51 | claude-haiku-5-5 |  | ✓ |
| item-block-quote-card | ✓ | ✓ | 1 | ✓ | 71 | claude-haiku-5-5 |  | ✓ |
| item-block-checklist | ✓ | ✓ | 2 | ✓ | 94 | claude-haiku-5-5 |  | ✓ |
| item-block-logo-outro | ✓ | ✓ | 1 | ✓ | 37 | claude-haiku-5-5 |  | ✓ |
| item-block-cta-close | ✓ | ✓ | 1 | ✓ | 66 | claude-haiku-5-5 |  | ✓ |

## Step 2: benchmark pair

Command: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set benchmark --only pr-walkthrough,captioned-social`

Result: both valid and output ok (and check ok).

Spec written 2/2 · valid 2/2 · output ok 2/2 · check ok 2/2

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| pr-walkthrough | ✓ | ✓ | 1 | ✓ | 120 | claude-haiku-5-5 |  | ✓ |
| captioned-social | ✓ | ✓ | 1 | ✓ | 50 | - |  | ✓ |

## Commands behind the other Gate 1 claims

Run from the repo root, 2026-10-31, before the review fixes. After them the make-motion suite and the bin tests were run again; see the task report.

- "188 pass 0 skipped" (Step 3): `env PA_REQUIRE_RENDER=1 node --test plugins/portable-artifacts/skills/make-motion/test/determinism.test.mjs plugins/portable-artifacts/skills/make-motion/test/cues-v2.test.mjs plugins/portable-artifacts/skills/make-motion/test/group.test.mjs plugins/portable-artifacts/skills/make-motion/test/video.test.mjs plugins/portable-artifacts/skills/make-motion/test/captions.test.mjs plugins/portable-artifacts/skills/make-motion/test/blocks.test.mjs plugins/portable-artifacts/skills/make-motion/test/formats.test.mjs`
- "full suites green" (Step 4), each exit 0:
  - `npm --prefix plugins/portable-artifacts/skills/make-motion test` (563 pass, 0 fail, 3 skipped: the Kokoro `voice CLI` tests, which need a cached model and `VOICE_TEST=1`)
  - `node --test "plugins/portable-artifacts/eval/test/**/*.test.mjs"` (57 pass)
  - `node plugins/portable-artifacts/bin/sync-shared.mjs --check`
  - `node --test "plugins/portable-artifacts/bin/test/*.test.mjs"` (119 pass)
  - `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (212 pass)
  - `python3 scripts/sweep_counts.py --check` (39 sites in sync)
- The brief's Step 3 also lists `test/kenney.test.mjs`. That file does not exist, because Task 3b (the Kenney sample pack) is deferred, so it is not in the command above.
