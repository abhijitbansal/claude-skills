# make-motion Phase 4 eval summary (2026-11-02)

Host claude, model haiku (claude-haiku-5-5). Billed runs: 2 (one per prompt), no rerun; 70 of 75 in all.

Commands (measured):
- `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set items --only item-block-text-behind-subject` (results `2026-11-02T17-54-09`)
- `node plugins/portable-artifacts/eval/run-eval.mjs --skill motion --host claude --model haiku --set items --only item-transition-gl` (results `2026-11-02T19-17-25`)

| id | spec | valid | validate runs | output | seconds | check |
|---|---|---|---|---|---|---|
| item-block-text-behind-subject | ✓ | ✓ | 1 | ✓ | 50 | ✓ |
| item-transition-gl | ✓ | ✓ | 2 | ✓ | 104 | ✓ |

Bar: `ceil(0.9 × 1)` = valid on the first build for each; both valid (`item-transition-gl` after one validator round).
