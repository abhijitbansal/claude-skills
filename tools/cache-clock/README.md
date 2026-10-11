# Cache Clock for Copilot

**See your Copilot prompt cache expire, and get stopped once before a cold send.**

Cache Clock is a GitHub Copilot CLI extension modeled on
[cache-tax](https://github.com/karanb192/cache-tax) for Claude Code. Copilot bills
tokens in AI credits, and on Claude and newer GPT models a cache *write* costs far
more than a cache *read*: 25× on Claude Sonnet 5.5, 12.5× on GPT-6 Luna. When you
step away longer than the cache lives, the next message, even "give me a recap",
rewrites the whole conversation at the write price. Cache Clock shows that clock and
that price, and by default drops a costly cold send once so you can decide.

```
! cache-clock: the Claude Sonnet 5.5 prompt cache went cold 2s ago. Sending this rewrites
  about 37.2k tokens at $2.25/M = $0.08 (a warm send would read them for $0.003).
  Send it again to pay it, or /clear and start fresh.
```

That refusal is a real capture (Copilot CLI 1.0.95, 11 October 2026), taken with
`/cache-clock min 0.01`: at the default $0.10 threshold this $0.08 rewrite would pass
silently. The resend that followed read 0 cached tokens and wrote 44,388: the cache had
expired exactly when Copilot said it would.

## Install

Tested on Copilot CLI 1.0.95. The extension runs inside Copilot's own runtime, so it
needs no Node install; the optional report needs Node 18+.

```sh
git clone https://github.com/abhijitbansal/claude-skills
sh claude-skills/tools/cache-clock/install.sh          # links ~/.copilot/extensions/cache-clock
```

`--copy` copies instead of linking; `--uninstall` removes it. `COPILOT_HOME` moves
`~/.copilot`. The installer only replaces its own install. Link mode was tested on
1.0.95: Copilot resolves the `@github/copilot-sdk` import itself, wherever the files
live. Start a new `copilot` session. Copilot asks once whether the extension
may "register hooks": say yes (option 2 remembers it for that repo). Then run
`/cache-clock`.

## Commands

    /cache-clock                 the card
    /cache-clock guard refuse    drop a costly cold send once; the next send goes through (default)
    /cache-clock guard warn      send it and print the price
    /cache-clock guard off       no guard
    /cache-clock min 0.25        guard only cold sends whose extra cost is at least $0.25 (default $0.10)
    /cache-clock headsup 5       warn up to 5 minutes before expiry (off to disable)
    /cache-clock help

Settings live in `~/.copilot/cache-clock/config.json` and apply to every session
(`CACHE_CLOCK_HOME` moves that directory). The heads-up has its own switch: it keeps
running under `guard off` until you set `headsup off`.

The card, from a real resumed session:

```
cache-clock · Claude Sonnet 5.5
  cache      warm, 1m17s left (ttl 5m00s)
  context    37.2k tokens
  next send  warm $0.003 · cold $0.08 (25× per token)
  session    5 model calls · 0 cold after idle · 0 prefix breaks · $0 extra paid
  guard      refuse once above $0.10 · heads-up 5m before expiry
```

## How it works

- **The clock.** Every main-agent model call emits `assistant.usage` with
  `cacheReadTokens`, `cacheWriteTokens`, `cacheExpiresAt`, `cacheTtlSeconds` and
  per-token prices. Cache Clock keeps the last call per model. Nothing is guessed: the
  TTL, the expiry and the prices all come from Copilot.
- **The guard.** `onUserPromptSubmitted` checks the last model's clock. If the cache has
  expired and rewriting it would cost at least the threshold more than reading it, the
  guard prints the price and aborts the turn before any model call (0 AI credits).
  The next send in that cold episode goes through with a one-line note, even from a
  new process (`copilot --resume … -p`): the refusal is remembered per session in
  `~/.copilot/cache-clock/refused.json` for a week. Slash commands and `!` shell
  escapes are never guarded. A message queued while a turn is running only gets the
  note: aborting then would cancel the running turn. After a compaction the next send
  is exempt, since the context was rewritten anyway.
- **The heads-up.** One ephemeral line before expiry, only when a cold send would cost
  at least the threshold and no turn is running. The lead is the smaller of your setting and a fifth of the
  TTL, so a 5-minute Claude cache warns 1 minute ahead, not right after every call.
- **Resume.** `assistant.usage` is not replayed when you resume, so the extension seeds
  the clock from the session's own `~/.copilot/session-state/<id>/events.jsonl`.

### What Copilot reported, measured on 11 October 2026

| Model (via Copilot) | Reported TTL | Write ÷ read | Evidence |
|---|---|---|---|
| Claude Sonnet 5.5 | 300 s | 25× | Sent 20 s after `cacheExpiresAt`: read 0, wrote 44,388 |
| GPT-6 Luna | 1800 s | 12.5× | Every persisted call (198 on this machine) reports `cacheTtlSeconds: 1800`; gap test below |

Prices in the log already include discounts: through `auto`, Sonnet's write was
$2.25/M (list $2.50, auto's 10% off). 1 AI credit = $0.01.

Separate sessions share the cached system-prompt prefix: a brand-new session's first
call read 10,157 tokens from cache. The conversation itself is per session.

## Report: what cold sends already cost you

The extension only sees sessions it was loaded in. The report reads every session
Copilot has persisted, CLI and VS Code alike, and sends nothing anywhere:

```sh
node tools/cache-clock/bin/report.mjs              # last 30 days
node tools/cache-clock/bin/report.mjs --since 7d   # or 12h, all; --json for raw numbers
```

```
model                   calls  cold after idle  prefix breaks  rewritten  extra paid  total spent  idle before cold sends
GPT-6 Luna                198                0              1      19.6k      $0.002        $0.13  -
```

"Extra paid" is what each cold call cost above a warm read of the same tokens.
"Prefix breaks" are cold calls inside the TTL: something changed the prompt prefix
(tools, instructions, model routing), not idling.

## VS Code

VS Code's Copilot agent harness runs the same runtime and writes to the same
`~/.copilot/session-state` directory, so the **report covers VS Code sessions**.
Some VS Code sessions persist only totals, not per-call records; the report counts
them separately. Whether a user-installed CLI extension, and so the live guard, loads
inside VS Code's harness is not verified yet. For per-turn cache hit rates there,
VS Code's own Cache Explorer (Agent Debug Logs) is the built-in view.

## Limits

- **No keep-warm yet.** cache-tax pings to hold the cache during a break. An extension
  can only ping with `session.send`, which adds a user and an assistant turn to your
  conversation each time; the transcript-free fork lives on the server API, not the
  extension's session. Whether pings pay off depends on your own tax: run the report.
- **Auto routes per prompt.** With `auto`, the next prompt may go to a different model
  than the last. The guard prices the last model used.
- **The estimate is approximate.** It is the last call's input plus its answer. The
  real resend adds your new message and anything Copilot attaches (44.4k actual vs
  37.2k estimated in the capture above). Pulling the other way, Copilot's shared system
  prefix (~10k tokens) often stays cached, so on a long idle a little less is rewritten.
- **`-p` mode.** The guard works in `copilot -p`, but slash commands there go to the
  model as text, so `/cache-clock` needs the interactive CLI.
- Claude was measured through `auto` only; the seat used for testing could not pick
  Claude models directly. GPT-6 Luna's TTL boundary was measured with a 29- and
  31-minute gap test (below).

## Tests

```sh
cd tools/cache-clock && node --test "test/*.test.mjs"
```

The tests drive the extension through a fake Copilot session and a fake clock: the
refusal and resend, the non-awaited abort (awaiting it inside the hook deadlocks the
CLI), sub-agent and background calls, compaction, heads-up timing, seeding from a
session log, settings, the report over fixture logs, and the installer. They make no
network calls. Live checks are recorded above.
