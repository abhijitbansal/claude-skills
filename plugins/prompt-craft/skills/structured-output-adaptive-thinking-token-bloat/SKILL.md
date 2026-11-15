---
name: structured-output-adaptive-thinking-token-bloat
description: A Claude API call using output_config.format (json_schema structured outputs) with adaptive thinking can spend most of its output budget on thinking (observed ~21k of ~24k tokens) without improving the JSON; one such run cost $0.39 against about $0.12 for a thinking-omitted run on another model. Use when calling the Messages API with a json_schema output format for extraction, ranking, classification or summarization, or when a schema-constrained call's usage.output_tokens is far larger than the returned JSON.
---

# Structured Output + Adaptive Thinking: A Hidden Cost Multiplier

## Symptom

A single Claude call returning JSON via `output_config.format` (type
`json_schema`) — extraction, ranking, classification, summarization to a
schema — costs far more than expected. `usage.output_tokens` is much larger
than the size of the returned JSON.

## Root cause

Adaptive thinking was on for a schema-constrained call. The schema already
fully determines the response shape, so most of what the model spends thinking
tokens on is reasoning about *form* the schema already fixed — not improving
the actual content. Observed (single run, 2026-07-12): **~21k of ~24k output
tokens were thinking, vs ~3k for the JSON itself.** That run cost $0.39,
against ~$0.12 for the same task with the `thinking` key omitted (a 3.25x
ratio), but the comparison changed both the model and the thinking setting
(Sonnet 4.6 thinking-on vs Opus 4.8 thinking-off), so the ratio is confounded
and is not a clean thinking-only figure.

Cost on these calls is dominated by `output_tokens`; with thinking off,
output tokens ≈ the JSON itself.

## Fix: the lever depends on the model

"Omit `thinking`" only means "no thinking" on the old models. Check the
thinking table in the `claude-api` skill before you copy a setting; as of its
2026-11-03 cache:

| Model | What omitting `thinking` does | How to cut thinking spend |
|---|---|---|
| Opus 4.8, Opus 4.7 | No thinking (the measured case) | Omit `thinking` |
| Opus 5.5 | Runs adaptive; `{type: "disabled"}` is a 400 at every effort level | Set `output_config.effort` to `low` (the default is `medium`) |
| Opus 5, Haiku 5.5 | Runs adaptive; `disabled` is accepted only at effort `high` or below | Lower `output_config.effort`, or `disabled` at `high` or below |
| Sonnet 5.5 | Runs adaptive; `{type: "disabled"}` is a 400 | Lower effort, or `thinking: {type: "between_tools"}` (effort `high` or below, no other field) |
| Sonnet 5, Sonnet 4.6 | Sonnet 5 runs adaptive; Sonnet 4.6 runs without thinking unless `{type: "adaptive"}` is set | Lower effort; on Sonnet 5 `disabled` is accepted; on Sonnet 4.6 omit `thinking` |
| Fable 5 family | Thinking is always on | Lower effort only |

Structured output already prevents prose leaking into the JSON, so there is
no correctness downside to cutting thinking on a schema-constrained task.

- Only keep thinking on when the task needs genuine reasoning over ambiguous
  input (judgment calls, multi-step inference), not merely to get
  well-formatted output. The schema already guarantees the format.
- Measure on a sample: compare `usage.output_tokens` before and after, and
  check the JSON quality. The measurement above is for one model; a current
  model needs its own call.
- Counter-intuitive payoff: a *better* model with thinking cut can be both
  cheaper and higher quality than a cheaper model with thinking on, because
  the cheaper model's savings are wiped out by the thinking-token multiplier.

```python
MODEL = "<model-id>"   # from config; ids are in the claude-api skill
# 5.x models (the rows of the table above that run adaptive thinking by default)
IS_5X = MODEL.startswith(("claude-opus-5", "claude-sonnet-5", "claude-haiku-5",
                          "claude-fable-5", "claude-mythos-5"))

output_config = {"format": {"type": "json_schema", "schema": SCHEMA}}
if IS_5X:
    output_config["effort"] = config.effort or "low"   # the lever on 5.x models
# Opus 4.8 / 4.7 and Sonnet 4.6: no effort is set here; thinking is controlled below.

kwargs = {
    "model": MODEL,
    "max_tokens": 16000,     # non-streaming: stay near 16000 or the SDK demands streaming
    "system": ...,
    "messages": [...],
    "output_config": output_config,
}
if config.thinking == "adaptive":           # an explicit request always wins, on every model
    kwargs["thinking"] = {"type": "adaptive"}
# Otherwise leave the key out: that means "no thinking" on Opus 4.8 / 4.7 and
# Sonnet 4.6, and "adaptive at the effort set above" on the 5.x models.
```

A larger `max_tokens` (up to 128K) needs streaming: use the SDK's `.stream()`
with `.get_final_message()` instead of a plain `.create()`.

## Evidence

- Source run (observed 2026-07-12): a schema-constrained extraction/classification
  call on Sonnet 4.6 with `thinking: {type:"adaptive"}` produced ~21k of ~24k
  output tokens as thinking (~3k as the actual JSON) — run cost $0.39.
- The same task on Opus 4.8 with the `thinking` key omitted cost ~$0.12 —
  thinking off, better result quality, lower total cost (3.25x, model and
  thinking both changed).
- Diagnostic: compare `usage.output_tokens` against the byte size of the
  returned JSON — a large gap between the two is thinking spend, not JSON
  spend.
- Not re-measured on the current models: the per-model table above comes from
  the `claude-api` skill's reference, not from a new run. Each row was checked
  against that skill's thinking table (cache dated 2026-11-03) on 2026-11-15,
  including the Fable row ("thinking is always on", lower effort only) and the
  Opus 5.5 default effort (`medium`); no billed call was made, so the table is
  documented behavior, not a measurement.

## Related skills

- `claude-api` — the model ids, thinking and effort table, streaming rules and
  structured-output parameters this skill's table is read from.
- Provider-level Anthropic API cost guidance, orthogonal to prompt-craft's
  Claude Code ask-sharpening lenses.
