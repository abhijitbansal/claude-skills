---
description: Evaluate whether the current or specified task warrants a Claude Code agent team; propose a composition (or push back) and wait for explicit confirmation before spawning.
argument-hint: [optional task description; defaults to the current conversation task]
---

You are running the agent-team evaluation. This is the evaluation turn: do not
spawn a team in it. Spawning happens in a later turn, the confirmation turn,
after the user replies to your proposal.

**Task input:** `$ARGUMENTS`

If `$ARGUMENTS` is empty, evaluate the conversation's *current* task — the last
thing the user asked for, or the ticket the session is working from. State in
one line which task you're evaluating so the user can correct you.

## Step 0 — Check that teams can run here

Agent teams are experimental and disabled by default. Check
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` first (in the shell environment or the
`env` block of `settings.json`):

- Not set to `1`: stop here. Tell the user teams are off and how to enable them
  (set it to `1` in `settings.json` or the environment). Do not run Step 1.
- This session is non-interactive (`claude -p`, an Agent SDK session): teammates
  are not spawned there. Stop and say so.
- Enabled: say so in one line, and note that while teams are enabled any
  subagent Claude names launches as a teammate, so teams can form even when no
  one asked for one. Setting the variable to `0` turns that off.

## Step 1 — Apply the team-fit heuristic

A team is warranted **only if all four** hold:

1. The task splits into **≥3 independent workstreams** with
   **non-overlapping file ownership** — by directory, target, or review-lens
   (security / perf / tests), not by feature within the same module.
2. Each workstream is **read-heavy** (review / research / investigation) **OR
   owns a disjoint write surface**.
3. Doing it serially in one session would **fill >60% of the context window**
   OR involves **competing hypotheses** worth exploring in parallel.
4. The user has not capped scope to a quick fix.

If the current repo has an `AGENTS.md` with a section on agent-team mode
(typically titled "Evaluate agent-team mode..."), read it and apply any
project-specific tuning on top.

## Step 2 — Output exactly ONE of two blocks

### A. Task qualifies → proposal block

> **Team proposed.**
>
> **Why it fits:**
> - [criterion 1 in one line]
> - [criterion 2 in one line]
> - …
>
> **Teammates:**
> 1. `<name>` — [role]. Owns: `<directory or lens>`.
> 2. `<name>` — [role]. Owns: `<directory or lens>`.
> 3. `<name>` — [role]. Owns: `<directory or lens>`.
>
> **Cost:** token use scales linearly with the number of active teammates, each
> with its own context window. Each teammate also starts in the lead's current
> permission mode, including `bypassPermissions` if the lead is in it.
>
> Reply `yes` / `go` to spawn, or counter-propose.

Then **STOP**. Do not spawn. Wait for the user.

### B. Task does not qualify → pushback block

> **Team not warranted.**
>
> **Failing criterion:** [which one and why, one line]
> **Better fit:** [single session / one Explore subagent / plan mode / etc.]
>
> Override and spawn anyway? (`yes` to override)

Then **STOP**. Wait for the user.

## Step 3 — On confirmation

If the user confirms (or overrides a pushback) in the confirmation turn:
1. Spawn teammates via the Agent tool with a `name` for each, one Agent call
   per teammate, all in a single message so they start in parallel. A named
   call launches a teammate while teams are enabled; there is no separate team
   parameter.
2. Brief each teammate with: their owned directory or lens, the
   read-only-first preference, and the requirement to surface a plan before
   any writes outside their owned surface.
3. Tell the user how to reach teammates: the agent panel below the prompt lists
   them; Up and Down select one, Enter opens its transcript to message it,
   Escape clears the selection. `teammateMode` set to `"auto"` gives split
   panes under tmux or iTerm2.
4. Acknowledge in one line that the team is live and what each teammate is
   doing.

## Hard rules

- **Never spawn a team without explicit confirmation from the user in the
  confirmation turn** (their reply to your proposal, never the evaluation turn
  itself). Silence is not consent.
- **Never propose two teammates that write to the same directory** —
  file-collision is the #1 documented team failure mode.
- **One team at a time.** If a team appears to be already running, refuse
  and ask the user to clean it up first ("clean up the team").
- Once a team is live, the lead (you) **delegates and reviews — does not
  implement**.
- If the task is clearly a single-file edit, a sequential refactor, or
  same-module work, default straight to the pushback block — don't strain
  to invent a team-shaped justification.
