# make-diagram eval (stories) — 2026-10-14

10 prompts: the 8 from 2026-10-12 (two per type, one an edit of `seeds/diagram.json`) plus `order-story` (a diagram with a story of hop beats) and `emoji-map` (nodes with emoji).
Measured on branch `feat/diagram-stories` with `node eval/run-eval.mjs --skill diagram --host claude --model haiku --timeout 900`.

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **10/10** | 1 | 29.5 | `diagram-stories-haiku-2026-10-14/` |

Every prompt passed on its first validate run (19–33 s each).

The new fields were used, not just accepted:

- `order-story`: 2 stories, 6 beats, `detail` on all 7 nodes.
- `emoji-map`: `emoji` on all 5 nodes, plus a 5-beat story.

Neither spec used the older `steps` form.

## Gate

- Spec §4: the pin stays only at 10/10 valid builds with median validate runs ≤ 2. **Pass** (10/10, 1). SKILL.md keeps `model: haiku` and `effort: low`.
- Sonnet and gemma4 were not re-run on this branch.
