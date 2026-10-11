# Cache Clock — plan

A port of [cache-tax](https://github.com/karanb192/cache-tax) for GitHub Copilot CLI
(and the VS Code Copilot harness, which runs the same runtime). It shows when a
session's prompt cache goes cold, what the next send will cost cold vs warm, and
stops a cold send once so the user can choose.

Companion test plan (Claude Docs): "Copilot cache-tax: test plan".

## What the probe settled (2026-10-11, Copilot CLI 1.0.95, SDK 1.0.19)

| Question | Answer | Evidence |
|---|---|---|
| Q1 Does an extension see the cache fields? | Yes. `assistant.usage` (ephemeral, live) carries `cacheReadTokens`, `cacheWriteTokens`, `cacheExpiresAt`, `cacheTtlSeconds` and per-token prices in `copilotUsage.tokenDetails`. | probe extension event dump |
| Q2 What TTL is reported? | GPT-6 Luna: 1800 s on every call (195 persisted calls + live). Claude: not testable on this seat (only `auto` is enabled; premium entitlement 0). | `session.usage_record` across 23 sessions |
| Q3 Does a resend hit? | Yes: second call read 17,114 of 17,384 input tokens. | persisted record |
| Q7 Real tax paid | Measurable for free from `~/.copilot/session-state/*/events.jsonl`, which persists `session.usage_record` per call. | the `report` command |
| Can a prompt hook stop a send? | Yes. `onUserPromptSubmitted` firing `session.abort()` **without awaiting it** cancels the turn before any model call (0 AI credits, no usage event). Awaiting it inside the hook deadlocks. | probe runs A and the hung run |
| Do extensions load in `-p` mode? | Yes, without `--experimental`. | probe |
| VS Code | The Copilot harness writes to the same `session-state` dir (`client_name: vscode-agent-host`) but persisted only checkpoints, no per-call records. Whether user extensions load there is unverified. | one session on disk |

Prices: `costPerBatch` is nano-AIU per `batchSize` tokens; 1 AI credit = $0.01, so
USD = nano-AIU / 1e11. No price table ships with the tool.

## Scope

Ships:

1. `tools/cache-clock/extension/` — the Copilot CLI extension.
   - Tracks every main-agent `assistant.usage` per model: expiry, TTL, context size, prices.
   - Guard on `onUserPromptSubmitted`: when the last model's cache has expired and the
     estimated extra cost of a cold rewrite is at least the threshold (default $0.10),
     `refuse` mode drops the send once (resend goes through); `warn` mode only logs; `off`.
   - Heads-up line a few minutes before expiry when a cold send would cost at least the threshold.
   - `/cache-clock` card; `/cache-clock guard refuse|warn|off`; `/cache-clock min <usd>`.
2. `tools/cache-clock/bin/report.mjs` — reads persisted session logs; per model:
   calls, cold-after-idle writes, prefix breaks inside the TTL, extra dollars paid.
3. `install.sh` — symlinks the extension into `~/.copilot/extensions/cache-clock`.

Deferred, gated on measurement (test plan Phase 3):

- **Keep-warm pings.** An extension can reach `session.send` only, which adds a user and
  an assistant turn to the main transcript per ping. `sessions.fork` is a server RPC, not
  on the extension's session object. With Luna's 30-minute TTL and a 12.5× write/read
  ratio a ping only pays back after a short idle; build it only if `report` shows the
  idle tax is material.

## Module layout

- `lib/usage.mjs` — pure: normalize a usage payload, prices from `tokenDetails`, cost helpers, call classification.
- `lib/clock.mjs` — pure: per-model state machine fed by normalized usage; snapshot at time `now`.
- `lib/guard.mjs` — pure: decide allow / warn / refuse for a prompt given a snapshot and config.
- `lib/format.mjs` — pure: money, durations, card, refusal and heads-up text.
- `lib/config.mjs` — config file read/write under `~/.copilot/cache-clock/`.
- `lib/history.mjs` — pure: parse a session `events.jsonl` into calls; aggregate a report.
- `extension.mjs` — wiring only.

## Tests

`node --test` in `tools/cache-clock/test/`, no network, no Copilot:
unit tests for each lib module; a fake-session test that drives `extension.mjs`
wiring (hooks, commands, events, abort not awaited); a report test over fixture
logs; an install test against a temp `COPILOT_HOME`. Added to the CI `node` job.

Live checks (manual, recorded in the README): extension loads; card shows real values;
a cold send is refused once at ~31 minutes idle on Luna.
