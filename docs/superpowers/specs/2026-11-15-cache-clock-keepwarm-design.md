# cache-clock keep-warm design

Date: 2026-11-15. Status: awaiting owner approval. A separate topic from the portable-artifacts 2.0 work, built as its own commits on the session's branch (`worktree-New-Motion`) unless the owner asks for a second branch.

Paths are relative to `tools/cache-clock/`. `L/` is `extension/lib/`.

## 1. Intent

cache-clock is a GitHub Copilot CLI and VS Code extension. It tracks the model's prompt cache for a session, warns before a costly cold send, and reports what cold sends cost. It does not prevent them. The owner wants it to keep the cache warm automatically while they are away: 3 hours by default, configurable up to 6 to 12 hours, and the tool reviewed and improved in the same pass.

The owner decided: Copilot only. No Claude Code component.

## 2. What the review found

Measured in this tool's own code and recorded data unless marked.

- Copilot reports a cache lifetime per model: 300 s for Sonnet 5.5 and Haiku 5.5, 1800 s for Luna (`README.md:161-164`).
- A cache read refreshes the expiry, and expiry is counted from the **start** of the request. In a recorded session, twenty consecutive calls each moved `cacheExpiresAt` to their own start time plus 300 s.
- An extension can send a message into the session, and nothing else reaches the main cache. A sub-agent has its own context; a fork is not available to an extension; a direct provider call has no credentials.
- The experimental `session.rpc.send` accepts `displayPrompt`, `source: "system"`, `mode: "enqueue"` and `billable: false`. From the SDK types only; whether the host hides such a turn, and what `billable: false` does under token billing, are unconfirmed.
- A ping is a real request. It is billed as one cache read of the whole context plus a few new tokens.

### The cost, plainly

List prices from `test/fixtures.mjs`, a 200,000-token context. Estimated from those prices, not measured on a bill.

| Model | Cache lifetime | One ping | One cold rewrite (extra cost) | Pings in 3 h | 3 h of pings | Break-even idle time |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 5 min | about $0.020 | about $0.48 | 45 | about $0.90 | about 96 min |
| Luna | 30 min | about $0.002 | about $0.023 | 8 | about $0.016 | about 4.8 h |

So keep-warm saves money when the idle gap is shorter than the break-even time and loses money after it. On a 5-minute cache, three hours of pings cost about twice one rewrite. Keep-warm also buys something a cost table does not show: the first reply after a break is not slowed by a cold rewrite. The design lets the owner choose between the two.

## 3. Goals, non-goals, anti-goals

**Goals**

1. While a session is idle and its cache is warm, send a minimal ping shortly before expiry so the next real turn is a warm read.
2. On for a window after the last real turn: 3 hours by default, configurable from 0 (off) to 12.
3. Never spend more than the owner allowed, and say what was spent.
4. Fix the review's findings that affect correctness.

**Non-goals**

- Keep-warm for Claude Code or any other host.
- Warming a cache that is already cold. That is a full rewrite, which the guard already asks about.
- Removing ping turns from history (`history.truncate` is experimental and would erase billed rows from the log).

**Anti-goals**

- Pings that run after the session is closed, or without a stop.
- Silent spend: a ping the report does not count, or a default that costs money the owner did not choose.
- A ping that triggers the guard's own question, or that is counted as a user turn in the statistics.

## 4. Approaches

| Approach | Trade-off | Outcome |
|---|---|---|
| A. Ping through `session.rpc.send` with `displayPrompt`, `source: "system"` and `mode: "enqueue"`, falling back to `session.send` | The only route to the main cache. The ping may show as a short turn | **Chosen** |
| B. A, then `history.truncate` to remove the ping | Clean transcript; experimental, races with a real turn, hides billed requests | Rejected |
| C. A second client, a fork, or a direct provider call | No access or no credentials from an extension | Not possible |

The owner picked the host; within it there is one workable mechanism, so this choice is mine.

## 5. Design

### 5.1 Parts

- `L/keepwarm.mjs` (new): a pure planner (`nextPing(state, config, now)` returns a time or a reason to skip) and a scheduler that is handed `send`, `now` and timers, so tests need no host.
- `L/wiring.mjs`: starts and stops the scheduler, marks the in-flight ping, and feeds it usage events.
- `L/usage.mjs`: keeps `durationMs`, `totalNanoAiu` and `maxPromptTokens` from the usage event.
- `L/config.mjs`, `L/format.mjs`: settings, the `/cache-clock` card and help.
- `L/history.mjs`, `L/clock.mjs`, `L/guard.mjs`: recognise pings and keep them out of user-turn statistics and the guard.

### 5.2 The ping

Prompt: `[cache-clock:keepwarm] Reply with exactly: .` The marker is fixed so every part of the tool can recognise it. Sent with `displayPrompt: "cache-clock keep-warm"`, `source: "system"`, `mode: "enqueue"`. `billable: false` is passed because the SDK offers it for extension-originated sends; the design does not rely on it, and spend is always taken from the usage event that follows.

### 5.3 When a ping fires

At `expiresAt - lead`, where `lead` is 20% of the cache lifetime, at least 30 s and at most 6 min: 60 s before expiry on a 5-minute cache, 6 min on a 30-minute one (which covers the early eviction recorded at 29 of 30 minutes).

A ping is skipped, with the reason kept for the card, when any of these holds:

- the clock's state is not "warm";
- the selected model is Auto, or differs from the model of the last call;
- the session is busy, has a pending prompt or an open question;
- the context is above 85% of the model's prompt limit (a ping there can trigger compaction);
- the window has ended;
- a spend limit has been reached (5.5).

### 5.4 The window

The window starts at the last real (non-marker) user turn and lasts `keepWarmHours`. Each real turn restarts it. Its end is stored under `~/.copilot/cache-clock/` so a reload of the extension resumes it. When the session shuts down, the extension's input closes, or the window ends, all timers are cleared. One lock file per session id prevents two extension processes from pinging the same session.

### 5.5 Spend limits

Three stops, whichever comes first:

1. **Payback** (`keepWarmPayback`, on by default): stop when the pings in this window have cost as much as the cold rewrite they are avoiding. With this on, keep-warm can never cost more than doing nothing, and the effective window on a 5-minute cache is about 96 minutes at 200,000 tokens. Turning it off gives the full window, for an owner who values the fast first reply over the money.
2. **Budget** (`keepWarmMaxUsd`, default 0.50 per window).
3. **The window end.**

Spend is read from `totalNanoAiu` on each ping's usage event. When a stop is reached, the heads-up line says which one and what was spent.

### 5.6 After each ping

The reply's usage must show a warm read (cache read at least 90% of the previous input). If it shows a cold rewrite, keep-warm stops for the window and prints one line, since the assumption it runs on has failed. Two failed sends in a row also stop it.

### 5.7 Settings

| Field | Default | Range | Command |
|---|---|---|---|
| `keepWarmHours` | 0 until enabled; `keepwarm on` sets 3 | 0 to 12 | `/cache-clock keepwarm on`, `off`, or `<hours>` |
| `keepWarmMaxUsd` | 0.50 | 0 to 5 | `/cache-clock keepwarm budget <usd>` |
| `keepWarmPayback` | true | true or false | `/cache-clock keepwarm payback on` or `off` |

Keep-warm is **off until the owner turns it on** (my call): it spends money, and a tool should not start spending on install. `/cache-clock keepwarm on` gives the 3-hour default the owner asked for. The maximum is 12 hours as asked; above 6 the command prints the estimated cost for the current context before accepting.

The `/cache-clock` card gains one line: keep-warm state, time left in the window, pings sent, spend, and the last skip reason.

## 6. Fixes shipped with it

| Finding | Where | Fix |
|---|---|---|
| Expiry is computed from the event time, which is the end of the request, not its start | `L/usage.mjs:54`, `:75`, `:85` | Use the event time minus the request duration. Keep-warm timing depends on this |
| The whole `events.jsonl` is read synchronously at attach, unbounded | `L/wiring.mjs:25`, `:38` | Read the tail up to a size limit |
| Errors swallowed without a trace | `L/wiring.mjs:66-73`, `:105`, `:190`, `:233`; `L/config.mjs:28-41` | Log each once through the extension log; a failed abort no longer reports "held"; a corrupt config is reported, not silently replaced |
| Installer pipes `main` to `sh`, unpinned, file by file | `install.sh:12`, `:93`; `README.md:23` | Install from a tagged release with a checksum for each file; `keepwarm.mjs` added to the file list |
| README card sample is stale | `README.md:104-113` | Regenerate from `L/format.mjs` |

## 7. Testing

No billed calls in the test suite. The existing `fakeHost` (`test/wiring.test.mjs:13-60`) gains `send` stubs that emit a turn start, a usage event and idle.

- Planner: fires at `expiry - lead`; every skip reason; window end; restart on a real turn.
- Scheduler with stepped fake time: 45 pings in 3 hours on the 5-minute fixture with payback off; none when cold, busy, Auto or switched; payback and budget each stop it; a cold reply stops it; shutdown clears timers; a reload resumes the window.
- Guardrails proven to fire: the runaway test is run once with each stop disabled and must fail.
- Pings are absent from user-turn tallies and the report, present in the spend total, and never raise the guard question.

**One live check, billed, needs the owner's yes:** three pings on Luna at 24-minute spacing in a real session (estimated under one cent at list price for a small context), to confirm that pings keep the provider cache alive, how the turn appears in the CLI and in VS Code, and what `billable: false` does. If pings do not refresh the provider cache, keep-warm is not shipped and the finding is written up. Until that check, the README describes keep-warm as tested against a fake host only.

## 8. Open risks

| Risk | Handling |
|---|---|
| The host shows every ping as a turn | Accepted; the display text is short. Reported after the live check |
| The extension's own send fires the prompt hook | The marker is exempt from the guard; covered by a test |
| The bundled SDK differs from the version read (1.0.19) | `rpc.send` is used only if present; `session.send` is the fallback |
| A ping collides with a real turn | Enqueue mode, and skip when busy |
| Early cache eviction by the provider | The lead margin, and the stop after a cold reply |
