---
name: subagent-report-truncation-delivery-contract
description: "A subagent or teammate final report is cut off mid-finding (the lead has to ask for a resend from finding N onward plus the assessment), SendMessage relays never arrive, or the tool is disabled in subagents ('No such tool available: SendMessage'). Use when writing any reviewer, verifier or implementer dispatch prompt, or when a returned report ends without its verdict."
---

# Subagent report truncation: give every dispatch a delivery contract

## Symptom

- A reviewer returns 20-30 findings in long prose and the report stops
  mid-sentence. The tail (verdict, remaining findings, DEVIATIONS / OPEN
  ISSUES) is exactly what the lead needed. Typical lead follow-up: "resend
  from finding N onward plus the overall assessment, compactly".
- Reports said "Your report was truncated after finding 1.4".
- Teammate SendMessage relays never reach the lead, or the tool is absent:
  `No such tool available: SendMessage. SendMessage is disabled for this
  session, in subagents as well as here.`

## Root cause

The subagent's final assistant message has a length cap. Prompts asked for
exhaustive prose with the verdict written LAST, so truncation drops the most
important part. No dispatch said how long the report may be or which channel
is authoritative, so agents guessed at a channel, and SendMessage is not always available.

## Fix

Put this block verbatim in every reviewer / verifier / implementer prompt:

```text
REPORT DELIVERY CONTRACT
- Channel: if you are a background subagent, your FINAL ASSISTANT MESSAGE is
  the report. If you are an agent-team teammate, send the report to the lead
  with SendMessage (the only channel the lead sees). Use the final message
  only if SendMessage is unavailable.
- Line 1: VERDICT (pass / fail / blocked) and a count of findings by severity.
- Then findings ranked most-severe first, ONE or TWO lines each, in this form:
  `file:line | severity | confidence | problem -> fix`.
- Hard cap: 40 lines total (30 for a re-review). Overflow goes to a scratch
  file whose path you cite ("N more in <scratch path>").
- Long evidence, logs and full prose go in that scratch file; cite its path
  instead of pasting it.
- Last line: "END OF REPORT" so the lead can tell the message is complete.
```

Orchestrator side:

1. Check the last line says `END OF REPORT` and the last finding is complete.
2. If cut off, re-ask ONLY for the missing tail ("findings N onward and the
   verdict, same format, under 20 lines"), or read the subagent transcript.
   Never rerun the whole review.
3. For machine-consumed results, ask for a schema'd JSON array: truncation
   then fails parsing loudly instead of silently dropping a sentence.
4. Verdict-first ordering means even a truncated report keeps the decision.

## Evidence

Mined from Claude Code session digests; 15 sessions across 6 projects.
Representative sessions: claude-skills `c33995d6`, a private-project worktree
`8edde5a5`, two private iOS app sessions `52367698` and `9e25d11a` (the
`SendMessage` error text above). In about ten of them the lead asked for a
resend of the tail.

## Related skills

- `core-workflow:subagent-buildverify-tool-grant-check` — the other way a
  dispatched agent silently fails to deliver: a missing tool grant.
- `core-workflow:team` (the `/team` command) — when parallel agents are worth
  it at all.
- `superpowers:dispatching-parallel-agents` — dispatch prompts that should
  all carry the contract above.
