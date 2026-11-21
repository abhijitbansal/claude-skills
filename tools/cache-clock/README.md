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
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.2.0/tools/cache-clock/install.sh | sh
```

That downloads a copy into `~/.copilot/extensions/cache-clock` (`COPILOT_HOME` moves
`~/.copilot`). Install once per machine; every Copilot session loads it.

The one-line install is pinned to a release tag, not to `main`, and checks a SHA-256 for
every file it downloads against the list inside the script. A file that does not match
stops the install and leaves nothing behind. The piped install
works once the tag `cache-clock-v1.2.0` exists; the owner creates it on the merge commit,
and until then every curl line here answers 404. Install from a clone (below) meanwhile.
After any edit under `extension/`, run `node tools/cache-clock/bin/checksums.mjs --write`;
the tests fail on a stale list.

- **Copilot CLI:** start a new `copilot` session. Copilot asks once whether the extension
  may "register hooks": allow it (option 2 remembers it for that repo). Then run
  `/cache-clock help`.
- **VS Code Copilot chat:** VS Code loads the extension from the project, not from
  `~/.copilot/extensions`. Install it into each repo you use it in, from that repo:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.2.0/tools/cache-clock/install.sh | sh -s -- --project
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
    /cache-clock keepwarm on     keep warm 3 hours after your last message
    /cache-clock keepwarm 6      0 to 12 hours; above 6 shows the estimated cost first
    /cache-clock keepwarm 8 yes  confirm a window above 6 hours where the host cannot ask
    /cache-clock keepwarm off
    /cache-clock keepwarm budget 0.50   stop after $0.50 of pings in one window, 0 to 5
    /cache-clock keepwarm payback off   keep pinging after pings cost more than one cold rewrite
    /cache-clock keepwarm daily 2.00    most the pings of one session may cost in any 24 hours, 0.10 to 20

Settings live in `~/.copilot/cache-clock/config.json` and apply to every session
(`CACHE_CLOCK_HOME` moves that directory). The heads-up has its own switch: it keeps
running under `guard off` until you set `headsup off`. A settings command never
overwrites a `config.json` it cannot read as settings (bad JSON, or not an object): it
says so and saves nothing. Keys it does not know are kept as they are, and a bad value is
reported once and replaced by its default while the file stays untouched.

Sample card from `format.mjs` with sample numbers, not a live capture:

```
cache-clock · Claude Sonnet 5.5
  cache      warm, 1m17s left (ttl 5m00s)
  context    37.2k tokens
  next send  warm $0.003 · cold $0.08 (25× per token)
  session    5 model calls · 0 cold after idle · 0 prefix breaks · 0 switch rewrites · $0 estimated extra
  guard      ask before a cold send above $0.10 · heads-up 5m before expiry
  keep-warm  on · 2h44m left · 2 pings · $0.007
```

## How it works

- **The clock.** Every main-agent model call emits `assistant.usage` with
  `cacheReadTokens`, `cacheWriteTokens`, `cacheExpiresAt`, `cacheTtlSeconds` and
  per-token prices. Cache Clock keeps cache observations per model and the latest
  conversation context separately. TTL, expiry and prices come from Copilot; context
  size and possible rewrite cost are estimates, not cache-reuse guarantees. Expiry counts
  from the **start** of the request (the event time minus its `duration`, when Copilot
  reports one up to 30 minutes; a reported expiry is kept as is). That is a small visible
  change for everyone, even with keep-warm off: a call that took 4 s and reported no
  expiry now expires 4 s earlier than before, and a send that started before the old
  expiry but finished after it counts as a prefix break, not as idle time.
- **Selected model.** At startup, before a prompt, and on status, a bounded (250 ms)
  `session.rpc.model.getCurrent()` lookup resolves the selection. Main-agent
  `session.model_change` and `session.model_deselected` events keep it current between
  lookups; a newer event wins over an older in-flight reply. Missing/failed lookups
  keep the last known selection (only a reply or an event changes it), so a switch with
  neither can leave a stale selection priced. Older hosts without the RPC can use
  explicit selection from the session log's start/resume snapshots and model-change
  events; usage alone is not treated as a selection.
- **The guard.** `onUserPromptSubmitted` checks the selected model's clock. If the cache has
  expired and rewriting it would cost at least the threshold more than reading it, the
  hook asks with `session.ui.select` and waits for the answer. To stop the send it calls
  `session.abort()` without awaiting it (awaiting inside the hook deadlocks), so no model
  call happens. The episode is remembered per session in
  `~/.copilot/cache-clock/refusals/<session-hash>.json` for a week, even across processes
  (`copilot --resume … -p`). Local commands (`/model`, `/clear`, …) and `!` shell escapes are never guarded; skill commands are. A
  message queued while a turn is running only gets the note: stopping it then would
  cancel the running turn. After a compaction the next send is exempt, since the context
  was rewritten anyway.
- **Model switches.** The destination model's previous clock cannot prove that it cached
  the current conversation. The card says unknown; with destination prices previously
  observed in this session, the guard asks about a *possible* rewrite of the latest
  context. Without those prices it warns and allows the send, never borrows the old
  model's price. A confirmation is rechecked before sending and held if the selection
  changed. Concurrent prompts share one check/question. A turn that starts while the
  question is open is not aborted by its answer.
- **The heads-up.** One ephemeral line before expiry, only when a cold send's extra cost
  is at least the threshold and no turn is running. The lead is the smaller of your
  setting and a fifth of the TTL, so a 5-minute Claude cache warns 1 minute ahead, not
  right after every call.
- **Resume.** `assistant.usage` is not replayed when you resume, so the extension seeds
  the clock from the session's own `~/.copilot/session-state/<id>/events.jsonl`.
  An unfinished root turn (`assistant.turn_start` with no later `assistant.turn_end`
  or `session.shutdown`) and the active/pending-work resume flags also restore the busy
  state, so joining a session already running work does not let the guard abort it.
  `session.idle` is never persisted, so the log alone ends a turn with `turn_end`. A cold
  resume or a later root idle event clears historical busy state.

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

## Keep-warm

**Off until you turn it on, and it costs money.** Tested against a fake Copilot host only.
A live check is pending; this section changes with its result (see "Live check" below).

- **What a ping is.** A tiny message sent into your session shortly before the cache would
  expire, so your next message reads the conversation at the warm price. The prompt is
  `[cache-clock:keepwarm] Reply with exactly: .`, shown as `cache-clock keep-warm`. It goes
  out through `session.rpc.send` (`source: "system"`, `mode: "enqueue"`, `billable: false`)
  when the host has it, else `session.send`, which has no billable flag. A ping refreshes
  the clock but is not a model call: it stays out of the card's tally, the guard and the
  report's statistics, and its cost shows as keep-warm spend. While a ping is in flight, the
  prompt hook treats text that contains the marker (or equals the display text) as the ping,
  because the host may hand the hook either; at any other time the same text is an ordinary
  prompt that you typed or pasted, and it is guarded like any other.
- **A window starts only on a confirmed real user turn.** That is a `user.message` event whose
  `source` is explicitly `"user"`, whose text does not carry our ping marker or display text, and
  that arrives while no ping is awaited. A message with no `source` confirms nothing. On a host that
  sends no `user.message` at all, it is a `turn_start` that our own send does not explain (no ping
  out, none sent within the last cache lifetime). Prompt-hook text alone never starts or restarts a
  window, whatever it says. A turn that arrives while a ping is out is dropped, not held: nothing is
  ever reset by a ping, and a window stopped for a failed, unanswered, unmeasured, cold or
  non-refreshing ping stays stopped until a confirmed turn that arrives after the stop. On a host with
  no `user.message` that keeps pinging, the window therefore restarts only after pinging has stopped
  or the session has been idle for a cache lifetime.
- **Turning it on.** `/cache-clock keepwarm on` keeps warm for 3 hours after your last real
  message. `keepwarm <hours>` takes 0 to 12. Above 6 it shows the estimated cost and asks
  first; where the host cannot ask, or the question fails, nothing is saved and the reply says
  to repeat it as `/cache-clock keepwarm <hours> yes` (that form is accepted only above 6
  hours). Turning it off keeps the stored window as it is: turning it on again resumes that same
  window, and a stopped window (budget, failure, daily limit) stays stopped until a confirmed user turn.
- **The setting is global; the window is not.** The setting is saved for every session. Each
  open session gets its own window, its own budget and its own pings, so two open sessions
  cost twice. The card, the help and the confirmation all say so. Only one process per session
  keeps keep-warm state (the one holding the session's lock); another process of the same session
  shows "handled by another process" on its card, plans nothing, starts no window and sends nothing.
  If the holder dies, the next process to look takes over its stored window and ledger as they are,
  not a new window or budget.
- **When it stops, by itself, for the rest of the window.** Each stop is one line with the
  spend; a confirmed user turn starts a new window. The stops are: payback (pings have cost
  as much as the cold rewrite they avoid; `keepwarm payback off` turns this one off), the
  budget (`keepwarm budget`, $0.50 by default, 0 to 5), the window end, the ping limit for the
  window, and the daily limit (below). Anything keep-warm cannot measure or recognise also stops it:
  a ping that came back cold, a reply that did not move the cache expiry forward, a ping's turn that
  ended with no usage for it, a send that failed or got no reply in 2 minutes (it may have gone out,
  so it is not retried), a cache with under 15 seconds left, a model change or a compaction while a
  ping was out, a reported cache lifetime under 5 minutes (pings would cost more than they save),
  and a ledger that cannot be read or written (delete the ledger file to reset it).
- **Hard limits that do not depend on cost, events or windows.** Pings are never closer together
  than the cache lifetime minus the lead (at least 60 s), and a window never sends more than
  ceil(window length / that gap, taken as at least 240 s) + 1 pings. The window's end is the earlier of its stored end and its
  start plus the current `keepWarmHours`, read at every plan: lowering the hours (here or in the
  file) shortens a running window; raising them applies from the next window. The budget check uses
  the larger of the estimate and the cost of the last ping that was measured.
- **The daily ledger: what bounds a session whatever the host sends.** Every ping is written to a
  per-session ledger in the shared store at send time, at the cold-rewrite cost, since until its usage
  is attributed to it the ping may have cost that. When usage arrives the entry is set to the larger of
  the estimate and the measured cost, so a host that reports 0 cannot unbind the limit; a ping nobody
  answered stays at the cold cost. Before any send, keep-warm refuses when the session's pings in the
  last 24 hours reach twice the ping cap of a 12-hour window for the current lifetime (362 at a
  5-minute cache), or when their cost plus the next ping would pass `keepWarmDailyMaxUsd` (default
  $2.00; `/cache-clock keepwarm daily 2.00`, 0.10 to 20). It stops with `daily-limit` and says so once
  per 24 hours per session. Only the passage of time removes entries: a new window, off and on, a
  reload or another process do not. The lock holder compacts the file when it grows past 64 KiB. A ledger file that exists but cannot be parsed stops keep-warm
  with `ledger-failed` (one note, delete the file to reset it); a half-written last line is ignored.
- **When it holds off (it does not stop; it waits).** A turn is running, or you just submitted
  a prompt whose turn has not started (it looks again when that flag expires); a question card is open
  (after one cache lifetime the log, and in VS Code a card, say keep-warm is waiting on an open
  question); the context is above 85% of the model's prompt limit; the selected model is not the one
  that was warmed; the selection is Auto; the model's price is unknown; another process holds this
  session's lock; the cache is cold or its state unknown. The card shows the last reason in words.
- **Heads-up.** The heads-up before expiry stays quiet only while a ping is really planned or out.
  When keep-warm is on but nothing will ping (any hold above, a stop, a question open), the heads-up
  works as before. A process that does not hold the session lock follows the same rule through the
  holder: the holder writes `willPing` in the shared window file whenever it plans, and the other
  process stays quiet only while that says a ping is planned or out. If the holder has stopped or
  has nothing planned, the other process's heads-up shows.
- **Spend.** Read from the ping's own usage event, `copilotUsage.totalNanoAiu` (nano-AIU
  ÷ 1e11 = dollars); every model call inside the ping's turn counts, and the ping itself once.
  A ping whose usage still arrives within 10 minutes of the 2-minute watchdog, or after its idle,
  has its cost added to the total. A ping whose cost is not reported stops keep-warm. A usage record
  that arrives after a prompt was typed since the last send is booked as a call, not a late ping.
- **Reloads and two processes.** The window, its spend, the time of the last send and any stop
  are stored in `~/.copilot/cache-clock/keepwarm/<sha256 of the session id>.json`, so a reloaded
  extension resumes them instead of starting a fresh budget. A `.lock` file beside it lets only
  one keep-warm instance per session ping. It records the pid and an instance id, so two instances in
  one process cannot both own it. It is created whole (a hard link to a finished file), a crashed
  holder's lock is replaced by renaming a finished file over it, and ownership is confirmed again
  before every ping and every write. The holder touches the lock file every 10 minutes, and a lock
  untouched for 30 minutes is taken over even when its pid is alive (a reused pid or a suspended
  process). With no stored window, keep-warm waits for your next confirmed
  message: a missing file never grants a fresh budget.
- **Notes.** Stop notes and the stalled-question note reach VS Code's chat as a card where the host
  can ask; where it cannot they are warnings in its log, never error boxes. The card shows the state
  either way.
- **The limits, exactly.** Per session, at most 362 pings in any 24 hours at a 5-minute cache (62 at
  30 minutes), and at most the daily limit in dollars, counting each ping as the measured or the
  estimated cost, whichever is higher. The ceiling is per session, so several open sessions each have
  their own. Deleting the ledger file resets it. None of this has been checked against a real Copilot host yet.
- **Estimated cost, 200,000-token context.** Computed from `keepWarmEstimate` with the list
  prices in `test/fixtures.mjs`, not measured on a bill:

  | Model | Cache lifetime | One ping | One cold rewrite (extra cost) | Pings in 3 h | 3 h of pings | Break-even idle time |
  |---|---|---|---|---|---|---|
  | Sonnet 5.5 | 5 min | about $0.020 | about $0.48 | 45 | about $0.90 | about 96 min |
  | Luna | 30 min | about $0.002 | about $0.023 | 7 | about $0.014 | about 4.6 h |

  The pings column is floor(3 h / (lifetime − lead)); break-even is the rewrite cost divided by
  the ping cost, times the gap between pings. Keep-warm saves money when the idle gap is shorter
  than the break-even time and loses money after it. With payback on (the default), Sonnet stops
  after 24 pings at this size and the budget is $0.50, so the 3-hour figure above needs
  `payback off` and a higher budget.

### Live check (owner-run, billed): what to look at

Nothing above has run against a real host. Before trusting keep-warm, run it on a small context
on GPT-6 Luna (`/cache-clock keepwarm 1`, `keepwarm payback off`, about three pings) and record,
from `~/.copilot/session-state/<id>/events.jsonl` and the screen:

1. The text the prompt hook receives for a ping (`input.prompt`): the exact prompt, the display
   text, or something wrapped? Whether `onUserPromptSubmitted` fires at all. The `source` and
   content of the ping's own `user.message`, and the `source` of your own typed `user.message`
   (the confirmed-turn rule needs it to be exactly `"user"`).
2. Whether the ping's `assistant.usage` arrives with no `agentId`, with the conversation
   interaction type (`conversation-agent`) and a nonzero `copilotUsage.totalNanoAiu`, and whether
   `billable: false` changed that cost. Whether each record carries `duration`.
3. Whether `session.idle` follows each ping, and whether `cacheExpiresAt` moves forward to the
   ping's start plus the lifetime (the `not-refreshing` stop depends on it).
4. Whether a ping triggers reasoning, tool calls or more than one model call in its turn (the
   cost counts every call in the turn, but a ping that thinks is not "tiny").
5. Whether the provider cache really stays warm: `cacheReadTokens` on the ping and on your next
   real message is at least 90% of the previous input, and the next real message does not
   rewrite the context.
6. How the ping's turn shows in Copilot CLI and in VS Code (and that the stop note is a plain
   note there).
7. Whether `/clear` changes the session id (the window, budget and lock are keyed by it).
8. Where the marker lands on `user.message` (`content` or `transformedContent`) and its
   `source`, and whether `session.rpc.send` existed or the `session.send` fallback ran.
9. Whether our own card (the stop note or stalled-question card in VS Code) raises an elicitation
   request that blocks pinging, and when it clears.
10. Whether a reload replays `user.message` events (a replayed message must not start a window).
11. Whether one process can attach to the same session twice (the lock then relies on its instance id).
12. Whether `billable: false` makes the reported cost 0 (the ledger then still counts the estimate).
13. The real cache lifetime values reported (`ttl`), including whether any is under 5 minutes.

Record the results as a dated, measured table here. If pings did not keep the provider cache
warm, say keep-warm is not recommended.

Tested against a fake Copilot host only. A live check is pending; this section changes with its result.

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

The example above is a historical capture. Current reports label the counterfactual
as **estimated extra**, add a **switch rewrites** column, and compare consecutive
conversation calls within each agent rather than stitching together only same-model
calls. Returning to a model after using another is not counted as idle time. A switch
with sufficient observed cache reads still counts as warm. Successful compaction
starts a new context; the first call after it is not a rewrite.

Estimated extra compares rewritten tokens with a warm read at the destination call's
reported prices; it is not measured savings or proof that a switch caused read loss.
Missing prices are counted as `unpricedRewrites`, not zero-cost evidence. In JSON,
`extraUsd` is the priced subtotal; `perWeekUsd` is null if any rewrite is unpriced.
Text reports mark incomplete rows and omit the weekly extrapolation in that case.

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
- **The heads-up reaches only VS Code's log.** Cold-send and unknown-selection warnings
  now use the existing error-level chat fallback so they are visible without another
  question. Those warnings still allow the send; the box is not a refusal. This change
  has synthetic regression coverage, not a new live VS Code capture.
- **The report counts VS Code sessions as totals.** They land in the same
  `~/.copilot/session-state` directory (`client_name: vscode-agent-host`) but persist
  only `session.usage_checkpoint` totals, not per-call records. For per-turn cache hit
  rates there, VS Code's own Cache Explorer (Agent Debug Logs) is the built-in view.

## Limits

- **Keep-warm adds a turn per ping.** An extension can only ping through the session, so
  the host may show each ping as a short turn in your conversation; the transcript-free
  fork lives on the server API, not the extension's session. Whether pings pay off depends
  on your own idle gaps: see the cost table above, and run the report.
- **Keep-warm trusts the next usage event.** A ping's cost and whether it kept the cache
  warm come from the usage event that follows it. A ping that goes unreported counts as a
  failed send, and an unreported cost stops keep-warm because the budget cannot be enforced.
- **Auto routes per prompt.** Copilot reports each pick as `session.auto_mode_resolved`
  (`chosenModel`). While the selection is `auto`, Cache Clock prices and guards the
  next send as the last model Auto resolved to since you chose Auto, using that model's
  observed prices; the next pick may differ. A pick made while a question is open does
  not hold a "Send anyway". Before Auto has resolved a model, or when it resolved one
  with no observed prices, the state is unknown: Cache Clock warns once each time you
  choose Auto and does not hold the send. Provider/context-tier-qualified selections
  also remain unpriced:
  usage records do not bind prices to that selection identity. Changing provider or
  context tier discards previous price estimates. Reports still group by model ID,
  not provider, and cannot fully attribute provider/configuration changes.
- **The estimate is approximate.** It is the last call's input plus its answer. The
  real resend adds your new message and anything Copilot attaches (44.4k actual vs
  37.2k estimated in the capture above). Pulling the other way, Copilot's shared system
  prefix (~10k tokens) often stays cached, so on a long idle a little less is rewritten.
- **`-p` mode.** The guard works in `copilot -p` as a refuse-once, but slash commands
  there go to the model as text, so `/cache-clock` needs the interactive CLI. `-p` follows
  the same rule as the interactive CLI: local commands are exempt, other slash text is
  guarded. How the host treats slash text in `-p` is unverified.
- **Early eviction is invisible to the guard.** It trusts Copilot's `cacheExpiresAt`.
  When a provider serves a cache cold sooner (Luna at 29 of 30 minutes, once), the send is
  billed cold and the guard stays quiet; the report counts it as a prefix break.
- **Refusal memory is advisory.** Each session has its own atomically replaced file, so
  concurrent sessions cannot erase each other's entries. Existing `refused.json` entries
  are read only when no session file exists; migration never rewrites the shared file.
  Entries expire after seven days (including legacy entries); expired/malformed new
  entries never fall back to legacy state. Files are not automatically deleted. Two
  processes writing the *same session* are last-rename-wins, not an exactly-once
  guarantee. A write failure can cause another question on resume.
- **VS Code depends on an experimental setting** (`chat.canvases.enabled`), which VS Code
  may rename or remove, and needs a copy in every repo (`--project`).
- Claude was measured through `auto` only; the seat used for testing could not pick
  Claude models directly. Each boundary result above is a single run.
- Model-selection handling is covered by synthetic tests against the public
  [SDK v1.0.19 RPC contract](https://github.com/github/copilot-sdk/blob/f0b503aae1ba151d29d117088de4238d1983e33e/nodejs/src/generated/rpc.ts)
  and [event definitions](https://github.com/github/copilot-sdk/blob/f0b503aae1ba151d29d117088de4238d1983e33e/nodejs/src/generated/session-events.ts),
  not a new live CLI/VS Code verification. Selection checks are best-effort snapshots,
  not atomic locks on routing. `session.error` and an abort request do not prove a turn
  ended; while attached, only a main-session idle event clears the busy flag. A host
  that omits it can leave the guard in warn-only behavior until a cold resume or
  reattachment, where a recorded root `turn_end` or `session.shutdown` clears it.
  Restoring busy state also depends on readable history; incomplete host history can miss work that predates attachment.

## Tests

Node 21+ (the quoted glob is expanded by `node --test` itself, which older versions do not do; CI uses 24):

```sh
node --test "tools/cache-clock/test/*.test.mjs"
```

That is the command CI runs, from the repository root. The shared fake Copilot host lives
in `test/helpers/fake-host.mjs`; the wiring tests are split by topic across
`wiring*.test.mjs`. Keep-warm has its own planner and scheduler tests (`keepwarm.test.mjs`),
a store and lock test (`keepwarm-store.test.mjs`), and wiring tests against the fake host
(`wiring-keepwarm.test.mjs`); none of them sends a billed request.

The tests drive the extension through a fake Copilot session and a fake clock: the
cold-send question and every answer (send, don't send, dismissed, timed out, host
without questions), the refuse-once fallback and resend, the non-awaited abort,
sub-agent and background calls, compaction, heads-up timing, seeding from a session
log, settings and help, the VS Code card, the report over fixture logs, and the
installer (link, copy, piped download, failed download). They make no network calls.
Regression coverage also includes selected-model lookups, missing prices, selection
changes during confirmation, stale RPC replies, concurrent prompts, switch attribution
across `--since`, agent-isolated compaction, and legacy refusal migration/expiry. A
12-process test forces the old shared-file lost-update interleaving and verifies that
session-isolated writes retain every entry. No paid model call is needed to run it.
Start/resume selection snapshots, attachment during active/pending work, cold-resume
busy-state reset, and VS Code warning visibility have dedicated regression tests.
Historical live checks are recorded above; they do not validate the new transition paths.
