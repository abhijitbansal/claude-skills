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
- The user asks "is it stuck", "no report came", "why so slow" or "still
  running?": the same family, a report that is not arriving. Run
  `/agents-info` (from the savvy-progress plugin, if it is installed) for
  elapsed time and context per agent, then use the Recovery section below.

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
  the report. If you are an agent-team teammate and SendMessage is available,
  send the report to the lead with SendMessage, once. Use the final message
  if SendMessage is unavailable.
- Line 1: VERDICT (pass / fail / blocked) and a count of findings by severity.
- Then findings ranked most-severe first, ONE or TWO lines each, in this form:
  `file:line | severity | confidence | problem -> fix`.
- Hard cap: 40 lines AND about 2,500 characters, whichever comes first (30
  lines for a re-review). Overflow goes to a scratch file under the session
  scratchpad (never into the repo) whose path you cite ("N more in <scratch
  path>").
- Long evidence, logs and full prose go in that scratch file; cite its path
  instead of pasting it.
- Every number names the command and target that produced it (for example
  "146 passed: bats tests/bats"), or is labelled "estimated". Write
  "approved" or "passed" only for a gate that actually ran in this task.
- Last line: "END OF REPORT" so the lead can tell the message is complete.
```

The character cap is an estimate from transcripts, not a measured limit:
reports were cut off at roughly 3,000 to 4,000 characters in about 40 sessions
across five projects, and the 40-line cap alone let a long-lined report run past
that. Worked example: a finding line of about 120 characters
(`file:line | severity | confidence | problem -> fix`) means roughly 20
findings fit in 2,500 characters. A reviewer with 30 findings reports the top
15 and cites the scratch file for the other 15; it does not squeeze 30 into
shorter lines.

Orchestrator side:

1. Check the last line says `END OF REPORT` and the last finding is complete.
2. If cut off, re-ask ONLY for the missing tail ("findings N onward and the
   verdict, same format, under 20 lines"), or read the subagent transcript.
   Never rerun the whole review.
3. For machine-consumed results, ask for a schema'd JSON array: truncation
   then fails parsing loudly instead of silently dropping a sentence.
4. Verdict-first ordering means even a truncated report keeps the decision.
5. For a review round with several finders, prefer a Workflow whose agents
   return a StructuredOutput schema over free-prose reports: the schema fixes
   the size and one result arrives per agent, so there is nothing to resend.

## Recovery: the agent finished but no report arrived

Symptom: only idle notifications come back, and pinging with SendMessage
produces more idle notifications, not a verdict. Do not ping-pong. Rebuild the
report from the transcript:

1. Find the transcript under `~/.claude/projects/<slug>/`. Search the top-level
   `*.jsonl` files (pane teammates) and the `<session>/subagents/` tree
   (ordinary subagents as `agent-*.jsonl`; Workflow agents one level deeper under
   `subagents/workflows/<workflow id>/`). Pick the file by grepping for a
   distinctive token from the dispatch prompt in its first ~20 KB, and take the
   newest match.
2. The report is the last assistant `text` block longer than about 300
   characters (`type` is `assistant`, text in `message.content[]`). Print that
   one block, not the whole file.
3. For a Workflow, the output file `<session>/workflows/<id>.json` has the
   finished result under its `result` key; read that instead.
4. Prevent a repeat: use `run_in_background: false`, or an agent type whose tool
   grant includes SendMessage, for any result-critical review. An agent type
   with no SendMessage in its grant cannot deliver by message at all.
5. When you take over a stalled task, tell the old agent to STAND DOWN, so its
   later wake-up does not commit stale work.

Checked on a finished Workflow in a current session: the transcript path
pattern above and the `result` key held, and assistant `text` blocks sit in
`message.content[]`. The top-level pane-teammate location and the plain
`subagents/agent-*.jsonl` location come from earlier notes and were not
re-checked this time.

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
