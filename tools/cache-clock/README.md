# Cache Clock for Copilot

**See your Copilot prompt cache expire, and get asked before a costly cold send.**

Cache Clock is an extension for GitHub Copilot CLI and VS Code's Copilot chat, modeled on
[cache-tax](https://github.com/karanb192/cache-tax) for Claude Code. Copilot bills
tokens in AI credits, and on Claude and newer GPT models a cache *write* costs far
more than a cache *read*: 25× on Claude Sonnet 5.5, 12.5× on GPT-6 Luna. When you
step away longer than the cache lives, the next message, even "give me a recap",
rewrites the whole conversation at the write price. Cache Clock shows that clock and
that price, and by default asks before a costly cold send goes out.

See it first: the [guide](../../docs/features/cache-clock.html), the
[visual explainer](../../docs/features/showcase/cache-clock/how-it-works.html), the
[architecture diagram](../../docs/features/showcase/cache-clock/diagram/cache-clock-architecture.html)
and a [17-second video](../../docs/features/showcase/cache-clock/video.mp4).

## Install

One line, no clone and no Node needed (the extension runs inside Copilot's own runtime):

```sh
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/install.sh | sh
```

That downloads a copy into `~/.copilot/extensions/cache-clock` (`COPILOT_HOME` moves
`~/.copilot`). Install once per machine; every Copilot session loads it.

- **Copilot CLI:** start a new `copilot` session. Copilot asks once whether the extension
  may "register hooks": allow it (option 2 remembers it for that repo). Then run
  `/cache-clock help`.
- **VS Code Copilot chat:** VS Code loads the extension from the project, not from
  `~/.copilot/extensions`. Install it into each repo you use it in, from that repo:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/cache-clock/install.sh | sh -s -- --project
  ```

  That copies it into `<git root>/.github/extensions/cache-clock`; commit it to share it
  with the repo, or add `.github/extensions/cache-clock/` to `.git/info/exclude` to keep it
  local. Then add `"chat.canvases.enabled": true` to your VS Code settings, reload the
  window and start a new chat. VS Code loads extensions only when that (experimental)
  setting is on. Type `/cache-clock` in full: VS Code does not list it in the `/` menu.

> [!WARNING]
> **If `/cache-clock` does nothing after install:** Copilot CLI may still need experimental
> mode before it loads the extension. Run `/experimental on`, reload Copilot CLI, and accept
> the permission prompts when it asks.

From a clone, `sh tools/cache-clock/install.sh` links the extension instead, so a
`git pull` updates it; `--copy` copies, `--uninstall` removes it. `--project [DIR]` copies
into DIR's git root (default: the current folder's) instead of `~/.copilot`, and
`--uninstall --project [DIR]` removes that copy. A project copy is always a copy, never a
link, and wins over the user install in that repo. The installer replaces
only its own install (one with cache-clock's own files) or a dangling link at that path, and
a failed download leaves nothing behind. Tested on Copilot CLI 1.0.95 and VS Code's Copilot agent host
(runtime 1.0.92-4.unstable).

## What happens on a cold send

When the cache has expired and rewriting it would cost at least $0.10 more than a warm
send, Cache Clock asks in the chat before anything is sent (the choices appear as
Copilot's own buttons; the layout differs by host):

```
cache-clock: the Claude Sonnet 5.5 prompt cache went cold 2s ago. Sending this rewrites
about 37.2k tokens at $2.25/M = $0.08 (a warm send would read them for $0.003).
  [ Send anyway ]  [ Don't send ]
```

**Send anyway** sends it. **Don't send** stops it before any model call, so it costs
0 AI credits; so does dismissing the question or leaving it for 5 minutes. It asks once
per cold cache: after that, sends go through with a one-line price note. Where Copilot
cannot show a question (`copilot -p`), it refuses the send once instead, and sending it
again pays:

```
! cache-clock: the Claude Sonnet 5.5 prompt cache went cold 2s ago. Sending this rewrites
  about 37.2k tokens at $2.25/M = $0.08 (a warm send would read them for $0.003).
  Send it again to pay it, or /clear and start fresh.
```

That refusal is a real capture (Copilot CLI 1.0.95, 11 October 2026), taken with
`/cache-clock min 0.01`: at the default $0.10 threshold this $0.08 rewrite would pass
silently. The resend that followed read 0 cached tokens and wrote 44,388: the cache had
expired exactly when Copilot said it would. The question form was checked live on
12 October 2026 in both Copilot CLI and VS Code: the prompt waits for your answer, and
**Don't send** ended the turn with no model call.

## Commands

    /cache-clock                 the card
    /cache-clock help            how it works, what a cold send triggers, every command
    /cache-clock guard refuse    ask (or refuse once) before a costly cold send (default)
    /cache-clock guard warn      send it and print the price
    /cache-clock guard off       no guard
    /cache-clock min 0.25        guard only cold sends whose extra cost is at least $0.25 (default $0.10)
    /cache-clock headsup 5       warn up to 5 minutes before expiry (off to disable)

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
  guard      ask before a cold send above $0.10 · heads-up 5m before expiry
```

## How it works

- **The clock.** Every main-agent model call emits `assistant.usage` with
  `cacheReadTokens`, `cacheWriteTokens`, `cacheExpiresAt`, `cacheTtlSeconds` and
  per-token prices. Cache Clock keeps the last call per model. Nothing is guessed: the
  TTL, the expiry and the prices all come from Copilot.
- **The guard.** `onUserPromptSubmitted` checks the last model's clock. If the cache has
  expired and rewriting it would cost at least the threshold more than reading it, the
  hook asks with `session.ui.select` and waits for the answer. To stop the send it calls
  `session.abort()` without awaiting it (awaiting inside the hook deadlocks), so no model
  call happens. The episode is remembered per session in
  `~/.copilot/cache-clock/refused.json` for a week, even across processes
  (`copilot --resume … -p`). Slash commands and `!` shell escapes are never guarded. A
  message queued while a turn is running only gets the note: stopping it then would
  cancel the running turn. After a compaction the next send is exempt, since the context
  was rewritten anyway.
- **The heads-up.** One ephemeral line before expiry, only when a cold send's extra cost
  is at least the threshold and no turn is running. The lead is the smaller of your
  setting and a fifth of the TTL, so a 5-minute Claude cache warns 1 minute ahead, not
  right after every call.
- **Resume.** `assistant.usage` is not replayed when you resume, so the extension seeds
  the clock from the session's own `~/.copilot/session-state/<id>/events.jsonl`.

### What Copilot reported, measured on 11 October 2026

| Model (via Copilot) | Reported TTL | Write ÷ read | Evidence |
|---|---|---|---|
| Claude Sonnet 5.5 | 300 s | 25× | Sent 20 s after `cacheExpiresAt`: read 0, wrote 44,388 |
| GPT-6 Luna | 1800 s | 12.5× | Every persisted call (201 on this machine) reports `cacheTtlSeconds: 1800`; gap test below |

**Gap test, GPT-6 Luna.** Two sessions were warmed at 14:55Z, then resumed with
`copilot --resume <id> -p`, with the guard threshold at $0:

| Resumed | vs reported expiry | Cache read | Cache written | What Cache Clock did |
|---|---|---|---|---|
| after 29 min | 1 min before | 0 | 20,771 | allowed it (clock said warm) |
| after 31 min | 1 min after | (refused, no model call) | | refused, 0 AI credits |
| resend, new process | 1 min after | 10,157 | 10,653 | let it through with the cold note |

So the reported expiry is an upper bound on Luna, not a guarantee: the 29-minute send
was already fully cold. On Claude the reported expiry held to the second. The
refused-then-resent pair also shows the refusal memory working across processes.

Prices in the log already include discounts: through `auto`, Sonnet's write was
$2.25/M (list $2.50) and Luna's $0.1125/M (list $0.125), auto's 10% off.
1 AI credit = $0.01.

Separate sessions share the cached system-prompt prefix: a brand-new session's first
call read 10,157 tokens from cache. The conversation itself is per session.

## Report: what cold sends already cost you

The extension only sees sessions it was loaded in. The report reads every session
Copilot has persisted, CLI and VS Code alike, and sends nothing anywhere. It needs
Node 18+ and ships with every install:

```sh
node ~/.copilot/extensions/cache-clock/report.mjs              # last 30 days
node ~/.copilot/extensions/cache-clock/report.mjs --since 7d   # or 12h, all; --json for raw numbers
```

From a clone, `node tools/cache-clock/bin/report.mjs` runs the same report.

```
model                   calls  cold after idle  prefix breaks  rewritten  extra paid  total spent  idle before cold sends
Claude Sonnet 5.5           5                1              0      37.1k       $0.08        $0.16  5m
GPT-6 Luna                201                1              2      44.9k      $0.005        $0.14  31m

extra paid for cold rewrites: $0.08 of $0.29 spent · about $0.46 per week at this rate
```

That is the test machine after this README's experiments: the Sonnet row is the
refusal capture's resend, the Luna rows include the gap test.

"Extra paid" is what each cold call cost above a warm read of the same tokens.
"Prefix breaks" are cold calls inside the reported TTL: something changed the prompt
prefix (tools, instructions, model routing), or the provider served it cold early
(eviction or a different backend), as in the Luna gap test above.

## VS Code

Measured on 11–12 October 2026 with VS Code's Copilot agent host (bundled runtime
`1.0.92-4.unstable`):

- **It loads only with `"chat.canvases.enabled": true`.** VS Code asks its runtime for
  extensions only in canvas-enabled sessions.
- **It loads from the project, not `~/.copilot/extensions`.** In testing, VS Code's chat
  loaded a copy in the repo's `.github/extensions/cache-clock`, and on a second machine
  the user install did not load. Install it per repo with `--project`. A project
  copy does not update itself: rerun the `--project` install to pick up a new version.
- **`/cache-clock` works typed in full**, but VS Code's `/` menu does not list it.
- **Output comes as a question card.** VS Code's chat shows plain extension messages only
  as error boxes, so in VS Code the card, the help and setting changes appear as a card
  with an OK button, and the cold-send question works as in the CLI.
- **Autopilot holds instead of asking.** VS Code's autopilot mode cancels extension
  questions (read from VS Code's code, not tested live); Cache Clock treats that as
  Don't send and says the send was held.
- **The heads-up and the "sending cold" note reach only VS Code's log**, since VS Code
  has no plain-message channel outside a question.
- **The report counts VS Code sessions as totals.** They land in the same
  `~/.copilot/session-state` directory (`client_name: vscode-agent-host`) but persist
  only `session.usage_checkpoint` totals, not per-call records. For per-turn cache hit
  rates there, VS Code's own Cache Explorer (Agent Debug Logs) is the built-in view.

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
- **`-p` mode.** The guard works in `copilot -p` as a refuse-once, but slash commands
  there go to the model as text, so `/cache-clock` needs the interactive CLI.
- **Early eviction is invisible to the guard.** It trusts Copilot's `cacheExpiresAt`.
  When a provider serves a cache cold sooner (Luna at 29 of 30 minutes, once), the send is
  billed cold and the guard stays quiet; the report counts it as a prefix break.
- **Refusal memory is one shared file.** Two Copilot sessions refusing in the same instant
  can overwrite each other's entry in `refused.json`; the losing session is asked again.
- **VS Code depends on an experimental setting** (`chat.canvases.enabled`), which VS Code
  may rename or remove, and needs a copy in every repo (`--project`).
- Claude was measured through `auto` only; the seat used for testing could not pick
  Claude models directly. Each boundary result above is a single run.

## Tests

```sh
cd tools/cache-clock && node --test "test/*.test.mjs"
```

The tests drive the extension through a fake Copilot session and a fake clock: the
cold-send question and every answer (send, don't send, dismissed, timed out, host
without questions), the refuse-once fallback and resend, the non-awaited abort,
sub-agent and background calls, compaction, heads-up timing, seeding from a session
log, settings and help, the VS Code card, the report over fixture logs, and the
installer (link, copy, piped download, failed download). They make no network calls.
Live checks are recorded above.
