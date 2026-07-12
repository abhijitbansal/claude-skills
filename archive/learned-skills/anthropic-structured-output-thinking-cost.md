# Anthropic structured outputs: default thinking OFF (it's a hidden cost multiplier)

**Extracted:** 2026-06-28
**Context:** A single Claude call returning JSON via `output_config.format`
(json_schema) — extraction, ranking, classification, summarization to a schema.

## Problem
With `thinking: {type:"adaptive"}` on a schema-constrained task, the model
produced **~21k of ~24k output tokens as thinking**, vs ~3k for the JSON itself —
making the run ~5× more expensive (observed: $0.39 on Sonnet 4.6 vs ~$0.12 on
Opus 4.8 with thinking off). The schema already constrains the output shape, so
most of that reasoning is wasted spend, not quality.

## Solution
For json_schema-constrained tasks, **default adaptive thinking OFF** and make it
configurable. Omit the `thinking` parameter entirely on Opus 4.8 / 4.7 (both
accept omission); structured output prevents prose leak even with thinking off,
so there's no downside. Turn thinking/effort on only when the task needs genuine
reasoning, not just well-formatted output. Counter-intuitive payoff: thinking-off
on a *better* model (Opus) can be both cheaper and higher quality than
thinking-on on a cheaper model (Sonnet).

## Example
```python
output_config = {"format": {"type": "json_schema", "schema": SCHEMA}}
if config.effort:
    output_config["effort"] = config.effort
kwargs = {"model": "claude-opus-4-8", "max_tokens": 32000,
          "system": ..., "messages": [...], "output_config": output_config}
if config.thinking == "adaptive":          # default "off" -> key omitted
    kwargs["thinking"] = {"type": "adaptive"}
# Cost is dominated by output_tokens; with thinking off, output ≈ the JSON.
```

## When to Use
Any Anthropic call using `output_config.format` / structured outputs where the
schema fully determines the response shape and cost matters. Check
`usage.output_tokens` against the JSON size — a large gap means thinking is the
spend.
