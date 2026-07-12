---
name: structured-output-adaptive-thinking-token-bloat
description: A Claude API call using output_config.format (json_schema structured outputs) with thinking:{type:"adaptive"} burns most of its output budget on thinking (observed ~21k of ~24k tokens) without improving JSON quality, making the run up to ~5x more expensive than the same call with thinking omitted — use when calling the Messages API with a json_schema output format for extraction, ranking, classification, or summarization tasks, or when a schema-constrained call's usage.output_tokens is far larger than the returned JSON.
---

# Structured Output + Adaptive Thinking: A Hidden Cost Multiplier

## Symptom

A single Claude call returning JSON via `output_config.format` (type
`json_schema`) — extraction, ranking, classification, summarization to a
schema — costs far more than expected. `usage.output_tokens` is much larger
than the size of the returned JSON.

## Root cause

`thinking: {type: "adaptive"}` was left on for a schema-constrained call. The
schema already fully determines the response shape, so most of what the
model spends thinking tokens on is reasoning about *form* the schema already
fixed — not improving the actual content. Observed: **~21k of ~24k output
tokens were thinking, vs ~3k for the JSON itself** — the run was ~5x more
expensive than the same call with thinking off ($0.39 on Sonnet 4.6 with
thinking on vs ~$0.12 on Opus 4.8 with thinking off, despite Opus being the
pricier model per token).

Cost on these calls is dominated by `output_tokens`; with thinking off,
output tokens ≈ the JSON itself.

## Fix

For `json_schema`-constrained tasks, **default adaptive thinking OFF** and
make it opt-in/configurable rather than opt-out:

- Omit the `thinking` parameter entirely by default — both Opus 4.8 and 4.7
  accept omission. Structured output already prevents prose leak even with
  thinking off, so there is no correctness downside to leaving it out.
- Only set `thinking: {type: "adaptive"}` when the task needs genuine
  reasoning over ambiguous input (e.g., judgment calls, multi-step inference)
  — not merely to get well-formatted output. The schema already guarantees
  the format.
- Counter-intuitive payoff: thinking-off on a *better* model (Opus) can be
  simultaneously cheaper and higher quality than thinking-on on a cheaper
  model (Sonnet), because the cheaper model's savings are wiped out by the
  thinking-token multiplier.

```python
output_config = {"format": {"type": "json_schema", "schema": SCHEMA}}
if config.effort:
    output_config["effort"] = config.effort

kwargs = {
    "model": "claude-opus-4-8",
    "max_tokens": 32000,
    "system": ...,
    "messages": [...],
    "output_config": output_config,
}
if config.thinking == "adaptive":   # default is "off" -> key omitted entirely
    kwargs["thinking"] = {"type": "adaptive"}
```

## Evidence

- Source run: a schema-constrained extraction/classification call on Sonnet
  4.6 with `thinking: {type:"adaptive"}` produced ~21k of ~24k output tokens
  as thinking (~3k as the actual JSON) — run cost $0.39.
- The same task on Opus 4.8 with the `thinking` key omitted cost ~$0.12 —
  cheaper per-token model input, thinking off, better result quality, lower
  total cost.
- Diagnostic: compare `usage.output_tokens` against the byte size of the
  returned JSON — a large gap between the two is thinking spend, not JSON
  spend.

## Related skills

None identified in this catalog at authoring time — this is provider-level
Anthropic API cost guidance, orthogonal to prompt-craft's Claude Code
ask-sharpening lenses. Link bidirectionally to any future skill covering
Claude API usage, cost, or SDK reference.
