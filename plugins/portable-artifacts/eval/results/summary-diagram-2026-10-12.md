# make-diagram eval — 2026-10-12

8 prompts: two per type (architecture, flow, sequence, state), one of them an edit of `seeds/diagram.json`.
Measured with `node eval/run-eval.mjs --skill diagram --host <host> --model <model> --timeout 900`.

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **8/8** | 1 | 21 | `diagram-haiku-2026-10-12/` |
| claude / sonnet | **8/8** | 1 | 24 | `diagram-sonnet-2026-10-12/` |
| codex-oss / gemma4 (local) | 5/8 | 1 | 73 | `diagram-2026-10-12/` |

## Gate

- Haiku ≥ 7/8 valid builds with median validate runs ≤ 2: **pass** (8/8, 1). SKILL.md now pins `model: haiku` and `effort: low`.
- gemma4 failures:
  - Two runs ended before writing a spec (37–73 s). This is the same early turn-ending seen in the dashboard eval.
  - One state spec left out `title` (`title: required`).
  - All passing gemma4 runs needed at most 3 validate rounds.
