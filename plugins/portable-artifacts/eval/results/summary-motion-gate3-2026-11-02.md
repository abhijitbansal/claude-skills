# make-motion Gate 3 eval summary (2026-11-02)

Host claude, model haiku (claude-haiku-5-5). Billed runs: 16 items + 12 benchmark = 28; no rerun.

Commands (measured):
- Items: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set items --only <16 ids>` (results `2026-11-02T15-35-59`)
- Benchmark: `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set benchmark` (results `2026-11-02T15-54-24`)
- Rehash: `node .scratch/gate3-rehash.mjs 2026-11-02T15-54-24` (not committed): each saved benchmark spec rendered twice at `--fps 10 --size 320x180` with `SOURCE_DATE_EPOCH=1793318400`.

## Items (Tasks 18-26)

Spec written 16/16 · valid 16/16 · output ok 16/16 · check ok 15/16

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| item-beats | ✓ | ✓ | 1 | ✓ | 60 | claude-haiku-5-5 |  | ✗ |
| item-grade | ✓ | ✓ | 2 | ✓ | 55 | claude-haiku-5-5 |  | ✓ |
| item-lottie | ✓ | ✓ | 1 | ✓ | 43 | claude-haiku-5-5 |  | ✓ |
| item-map | ✓ | ✓ | 2 | ✓ | 60 | claude-haiku-5-5 |  | ✓ |
| item-block-map-highlight | ✓ | ✓ | 1 | ✓ | 58 | claude-haiku-5-5 |  | ✓ |
| item-block-flow-map | ✓ | ✓ | 1 | ✓ | 51 | claude-haiku-5-5 |  | ✓ |
| item-block-race | ✓ | ✓ | 2 | ✓ | 78 | claude-haiku-5-5 |  | ✓ |
| item-block-comparison-split | ✓ | ✓ | 2 | ✓ | 95 | claude-haiku-5-5 |  | ✓ |
| item-block-before-after | ✓ | ✓ | 1 | ✓ | 46 | claude-haiku-5-5 |  | ✓ |
| item-block-notification-stack | ✓ | ✓ | 3 | ✓ | 126 | claude-haiku-5-5 |  | ✓ |
| item-block-chat-thread | ✓ | ✓ | 1 | ✓ | 60 | claude-haiku-5-5 |  | ✓ |
| item-block-timeline | ✓ | ✓ | 3 | ✓ | 49 | claude-haiku-5-5 |  | ✓ |
| item-block-testimonial | ✓ | ✓ | 2 | ✓ | 66 | claude-haiku-5-5 |  | ✓ |
| item-block-lower-third-tag | ✓ | ✓ | 1 | ✓ | 43 | claude-haiku-5-5 |  | ✓ |
| item-block-lower-third-social | ✓ | ✓ | 2 | ✓ | 58 | claude-haiku-5-5 |  | ✓ |
| item-block-lower-third-ticker | ✓ | ✓ | 1 | ✓ | 79 | claude-haiku-5-5 |  | ✓ |

Note: item-beats failed check.mjs on a dead stretch (a static 10 s scene after 3.5 s), the audit working as designed on the model's spec; check is not a gate for items. First-validate-call valid: 8 of 16 (valid after the run's own fixes: 16 of 16).

## Benchmark

Spec written 12/12 · valid 12/12 · output ok 12/12 · check ok 12/12

| id | spec | valid | validate runs | output | seconds | model reported | notes | check |
|---|---|---|---|---|---|---|---|---|
| launch-teaser | ✓ | ✓ | 2 | ✓ | 99 | claude-haiku-5-5 |  | ✓ |
| launch-feature-trio | ✓ | ✓ | 3 | ✓ | 114 | claude-haiku-5-5 |  | ✓ |
| pr-walkthrough | ✓ | ✓ | 2 | ✓ | 101 | claude-haiku-5-5 |  | ✓ |
| pr-code-diff | ✓ | ✓ | 3 | ✓ | 107 | claude-haiku-5-5 |  | ✓ |
| chart-race | ✓ | ✓ | 3 | ✓ | 147 | claude-haiku-5-5 |  | ✓ |
| map-regions | ✓ | ✓ | 3 | ✓ | 127 | claude-haiku-5-5 |  | ✓ |
| captioned-social | ✓ | ✓ | 2 | ✓ | 48 | claude-haiku-5-5 |  | ✓ |
| captioned-vertical | ✓ | ✓ | 2 | ✓ | 85 | claude-haiku-5-5 |  | ✓ |
| docs-steps | ✓ | ✓ | 1 | ✓ | 131 | - |  | ✓ |
| docs-faq | ✓ | ✓ | 2 | ✓ | 92 | claude-haiku-5-5 |  | ✓ |
| batch-welcome | ✓ | ✓ | 2 | ✓ | 315 | claude-haiku-5-5 |  | ✓ |
| batch-kpi-cards | ✓ | ✓ | 1 | ✓ | 65 | - |  | ✓ |

Median validate runs: 2 (sorted 1,1,2,2,2,2,2,2,3,3,3,3).

## Determinism (render twice, SHA-256 prefix)

```
batch-kpi-cards  2ad1308a289899d7  2ad1308a289899d7  true
batch-welcome  b5c82b55d82255b8  b5c82b55d82255b8  true
captioned-social  76d03a837d5e267a  76d03a837d5e267a  true
captioned-vertical  1539a3da45a40527  1539a3da45a40527  true
chart-race  0ca6b5efa0f04c8d  0ca6b5efa0f04c8d  true
docs-faq  f7828bbca54c5d8e  f7828bbca54c5d8e  true
docs-steps  2cdca1ec49bb702f  2cdca1ec49bb702f  true
launch-feature-trio  9154474ce09a3314  9154474ce09a3314  true
launch-teaser  e69d3569556482b7  e69d3569556482b7  true
map-regions  31969d92a95cf1c7  31969d92a95cf1c7  true
pr-code-diff  2c28ff3867c4f7d7  2c28ff3867c4f7d7  true
pr-walkthrough  2042ce55f4bbfbd7  2042ce55f4bbfbd7  true
ALL 12 EQUAL

[exited with code 0]
```
