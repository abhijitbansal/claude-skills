# make-explainer eval — 2026-10-13

8 prompts: recap from a gathered fixture repo, test checklist, concept with a diagram, slides deck, chart from an inline CSV, an edit of `seeds/explainer.json`, and two mixed prompts.
Measured with `env -u NODE_USE_SYSTEM_CA node eval/run-eval.mjs --skill explainer --host <host> --model <model> --timeout 900`.

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **8/8** | 1 | 36 | `explainer-haiku-2026-10-13-r2/` |
| claude / sonnet | **8/8** | 1 | 34 | `explainer-sonnet-2026-10-13/` |
| codex-oss / gemma4 (local) | 0/8 | — | 198 | `explainer-2026-10-13/` |

## Gate

- Haiku ≥ 7/8 valid builds with median validate runs ≤ 2: **pass** (8/8, 1). SKILL.md now pins `model: haiku` and `effort: low`.
- `node scripts/check.mjs` passed on all 8 Haiku pages (1280 and 390 px, the deck's last slide, diagram Present overlays).
- The first Haiku run (`explainer-haiku-2026-10-13/`) also built 8/8, but its validate-run counts were inflated: `build.mjs`, `gather.mjs` and `scaffold.mjs` also wrote to `EVAL_LOG`. Fixed in `62dda42` (only `validate.mjs` logs, as in the sibling skills); the Haiku and Sonnet rows above are from runs after the fix.

## gemma4 failures

The gemma4 run happened before `62dda42` and alongside the first Haiku run, so its validate-run counts are not comparable.

- Two runs ended before writing a spec (56–126 s), the same early turn-ending seen in the dashboard and diagram evals.
- Two specs were not valid JSON (a missing `,` or `]` inside an array).
- One deck kept the scaffold's `TODO:` placeholders (19 errors).
- One text section was given `points` (the error names the allowed fields: type, id, title, text).
- One plan left out required item titles.
- The edit prompt ended with the seed unchanged.
