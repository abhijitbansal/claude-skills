# cache-clock keep-warm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a Copilot session's prompt cache warm while the owner is away, inside three spend stops, and fix the review findings that affect correctness.

**Architecture:** A new `extension/lib/keepwarm.mjs` holds the ping marker, a pure planner (`planPing`) and a scheduler factory (`createKeepWarm`) that gets `send`, `read`, `store`, `now` and timers injected, so tests need no host. `wiring.mjs` builds the scheduler, files each usage event as a ping or a real call, and feeds it events. Pings refresh the clock through `clock.ingestPing` but stay out of the tally, the guard and the report's statistics; their cost is shown as keep-warm spend.

**Tech Stack:** Plain ESM JavaScript run by Copilot's runtime; `node:test` and `node:assert/strict`; POSIX `sh` installer (shellcheck in CI); no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-cache-clock-keepwarm-design.md`

## Global Constraints

- Ping prompt `[cache-clock:keepwarm] Reply with exactly: .`; marker `[cache-clock:keepwarm]`; display text `cache-clock keep-warm`.
- Send: `session.rpc.send({ prompt, displayPrompt, source: "system", mode: "enqueue", billable: false })` when `typeof session.rpc?.send === "function"`; else `session.send({ prompt, displayPrompt, source: "system", mode: "enqueue" })`. `session.send(options)` reads exactly those fields and has no `billable` (SDK `nodejs/src/session.ts`, commit f0b503a). The `rpc.send` accessor comes from the design and is checked live in Task 14.
- Settings: `keepWarmHours` default 0, `keepwarm on` sets 3, range 0 to 12, above 6 the command shows an estimated cost first. `keepWarmMaxUsd` default 0.50, range 0 to 5. `keepWarmPayback` default true.
- Lead = 20% of the cache lifetime, clamped to 30 s and 6 min (60 s on a 300 s cache, 6 min on 1800 s). Skip when the context is above 85% of `maxPromptTokens`. A reply is warm when cache read is at least 90% of the previous input (`COLD_READ_SHARE` in `usage.mjs:12`).
- Window: starts at the last real user turn and lasts `keepWarmHours`. A ping planned **at** the window end is allowed; one planned after it is skipped. That gives 45 pings in 3 h on a 300 s cache (`180 / 4`).
- Stops: payback, budget and window end; plus a cold ping reply, and two failed sends in a row. Money comparisons use `USD_EPSILON = 1e-9`. Spend is `totalNanoAiu / 1e11`.
- SDK field names (from `session-events.ts` at f0b503a): `assistant.usage` carries `duration` (ms), `maxPromptTokens` and `copilotUsage.totalNanoAiu`. The design's `durationMs` is the name on the normalized call only. `user.message` carries `content`, `transformedContent` and `source`, but no `displayPrompt`.
- No billed calls in tests. Write tests first. Files stay under 800 lines and new functions under 50. Prefer immutable data: new objects, not mutation, except the scheduler's private state.
- Commands run from the worktree root. Tests resolve paths from `import.meta.url`, so `node --test tools/cache-clock/test/<file>.test.mjs` works there. The full suite is `node --test "tools/cache-clock/test/*.test.mjs"`, the same as CI (`.github/workflows/test.yml:85-87`).
- Line numbers refer to the base commit. Earlier tasks shift them, so find the quoted symbol.
- Commits use `<type>: <description>`, end with the single trailer `Co-Authored-By: Claude <noreply@anthropic.com>` (`AGENTS.md:224-232`), and go on the session branch, never `main`. After Task 12, any edit under `extension/` needs `node tools/cache-clock/bin/checksums.mjs --write` in the same commit.

## Review Focus

1. **The extension reloads mid-window.** It must resume the window, its spend and its stop reason, not start a fresh budget. Pinned by Task 8 `a reload resumes the window, its spend and its stop` and Task 9 `a reload mid-window resumes the window and its spend`.
2. **Two processes are attached to one session.** Only the lock holder pings, and a crashed holder's lock is taken over. Pinned by Task 6 `a dead holder's lock is taken over` and Task 9 `two processes on one session: only the lock holder pings`.
3. **The laptop sleeps through several ping times.** One timer re-plans from a fresh snapshot, so a late wake onto a cold cache sends nothing. Pinned by Task 8 `a late wake after sleep sends nothing when the cache went cold`.
4. **The user types while a ping is in flight.** Their turn is a real call and restarts the window; only the ping's own usage is ping spend. Pinned by Task 9 `the user typing while a ping is in flight counts as a real turn`.
5. **A model switch to Auto happens during the window.** Pings stop with the skip reason `auto`. Pinned by Task 4 `planPing names every skip reason` and Task 9 `switching to Auto stops pings`.

### Task 1: Request start, duration, spend and prompt limit in usage

**Files:** Modify `tools/cache-clock/extension/lib/usage.mjs:7` (export the constant), `:45-48` (`plausibleExpiry`), `:51-69` (`normalizeUsage`), `:72-77` (`expiryOf`), `:80-86` (`classifyCall`); `tools/cache-clock/extension/lib/clock.mjs:70-83` (snapshot); `tools/cache-clock/test/fixtures.mjs:19-53`. Test: `tools/cache-clock/test/usage.test.mjs`, `tools/cache-clock/test/clock-guard.test.mjs`.

**Interfaces:** Produces `export const NANO_AIU_PER_USD = 1e11`. `normalizeUsage(data, timestamp)` adds `durationMs: number` (`data.duration`, 0 when absent), `startAt: number` (`at - durationMs`), `nanoAiu: number | null` (`data.copilotUsage.totalNanoAiu`) and `maxPromptTokens: number | null`. The clock snapshot adds `maxPromptTokens` from the last call (null on the unknown branch). Fixtures: `usage({ …, duration, nanoAiu = 111133000, maxPromptTokens })` writes `duration` and `maxPromptTokens` only when given. New `pingUsage({ at, input = 200_000, read = input, nanoAiu = 2e9, model = "claude-sonnet-5.5", ttl = 300 })` returns `usage({ model, at, ttl, input, read, write: 0, output: 0, nanoAiu })`.

These callers of `at` change to `startAt`: `usage.mjs:63` (`plausibleExpiry(…, startAt)`), `:75` (`startAt + ttlSec * 1000`) and `:85` (`cur.startAt > exp`). These stay on the event time `at`: `clock.mjs` `lastCallAt` (the switch episode id), and `history.mjs:64`, `:81` and `:100` (the `--since` window and idle minutes).

- [ ] Write the failing tests in `usage.test.mjs` (import `expiryOf`):

```js
test("normalizeUsage keeps request start, duration, spend and the prompt limit", () => {
  const n = normalizeUsage(usage({ duration: 4000, nanoAiu: 2e9, maxPromptTokens: 128_000 }), T0);
  assert.deepEqual([n.durationMs, n.startAt, n.nanoAiu, n.maxPromptTokens], [4000, T0 - 4000, 2e9, 128_000]);
  const bare = normalizeUsage({ model: "m" }, T0);
  assert.deepEqual([bare.durationMs, bare.startAt, bare.nanoAiu, bare.maxPromptTokens], [0, T0, null, null]);
});
test("expiry without a reported time counts from the request start", () => {
  assert.equal(expiryOf(normalizeUsage({ ...usage({ expiresAt: null, ttl: 300 }), duration: 4000 }, T0)), T0 - 4000 + 300_000);
});
test("a reported expiry is kept when the request ran longer than the ttl", () => {
  const exp = T0 - 400_000 + 300_000;
  assert.equal(normalizeUsage({ ...usage({ ttl: 300, expiresAt: new Date(exp).toISOString() }), duration: 400_000 }, T0).expiresAt, exp);
});
test("a call that started before the old expiry is a break, not idle", () => {
  const prev = normalizeUsage(usage({ ttl: 300, input: 100_000 }), T0);
  const cur = normalizeUsage({ ...usage({ input: 100_000, read: 0, write: 100_000 }), duration: 4000 }, T0 + 302_000);
  assert.equal(classifyCall(prev, cur), "cold-break");
});
```

  In `clock-guard.test.mjs`, add `the snapshot carries the last call's prompt limit`. It does `feed(c, { at: T0, maxPromptTokens: 128_000 })` and asserts `c.snapshot(T0).maxPromptTokens === 128_000`.
- [ ] Run `node --test tools/cache-clock/test/usage.test.mjs tools/cache-clock/test/clock-guard.test.mjs`. Expect failures such as `undefined !== 4000`, and `"cold-idle" !== "cold-break"`.
- [ ] Implement the fields and the three `startAt` call sites above. `num()` covers `duration` and `maxPromptTokens` (`maxPromptTokens` becomes null when 0).
- [ ] Run the same command and the full suite; all pass.
- [ ] `git add tools/cache-clock/extension/lib/usage.mjs tools/cache-clock/extension/lib/clock.mjs tools/cache-clock/test/fixtures.mjs tools/cache-clock/test/usage.test.mjs tools/cache-clock/test/clock-guard.test.mjs`, then commit `fix: count cache-clock expiry from the request start`.

### Task 2: Ping marker; pings stay out of the tally and the guard

**Files:** Create `tools/cache-clock/extension/lib/keepwarm.mjs`. Modify `tools/cache-clock/extension/lib/clock.mjs:14-35` (move the bookkeeping into a private `remember(call)` and add `ingestPing`), `tools/cache-clock/extension/lib/guard.mjs:17-18`, and `tools/cache-clock/install.sh:15` (insert `lib/keepwarm.mjs` after `lib/history.mjs` in `FILES`; without it, `install.test.mjs:100` goes red). Test: create `tools/cache-clock/test/keepwarm.test.mjs`; modify `clock-guard.test.mjs`.

**Interfaces:** `keepwarm.mjs` exports `PING_MARKER`, `PING_PROMPT`, `PING_DISPLAY` (values in Global Constraints) and `isPingText(text) -> boolean`, which is true when `String(text ?? "").trimStart()` starts with the marker. It also exports `isPingMessage(data) -> boolean`, which is true when the marker is in `data.content` or `data.transformedContent`, or when `data.source === "system"` and `data.content === PING_DISPLAY`. `clock.ingestPing(call) -> { kind, call } | null` updates the per-model map, `lastModel`, `lastConversation` and the stale set like `ingest`, and leaves the tally alone. In `decide()`, a ping prompt returns `{ action: "allow" }` before any other check. `keepwarm.mjs` imports nothing from `guard`, `history` or `wiring`.

- [ ] Write the failing tests:

```js
// keepwarm.test.mjs
test("ping text and ping messages are recognised by the marker", () => {
  assert.ok(isPingText("  [cache-clock:keepwarm] Reply with exactly: ."));
  assert.ok(!isPingText("explain [cache-clock:keepwarm] to me"));
  assert.ok(isPingMessage({ content: PING_DISPLAY, transformedContent: PING_PROMPT }));
  assert.ok(isPingMessage({ content: PING_DISPLAY, source: "system" }));
  assert.ok(!isPingMessage({ content: PING_DISPLAY, source: "user" }));
});
// clock-guard.test.mjs
test("a ping refreshes the clock but is not tallied", () => {
  const c = createClock();
  feed(c, { at: T0, model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 });
  assert.equal(c.ingestPing(normalizeUsage(pingUsage({ at: at(T0 + 4 * MIN) }), T0 + 4 * MIN)).kind, "warm");
  assert.deepEqual(c.tally(), { calls: 1, coldIdle: 0, coldBreak: 0, coldSwitch: 0, extraUsd: 0, unpricedRewrites: 0 });
  assert.equal(c.snapshot(T0 + 8 * MIN, "claude-sonnet-5.5").state, "warm");
});
test("decide never guards a ping, even on a cold cache", () => {
  assert.equal(decide({ snap: coldSnap, prompt: PING_PROMPT, config: cfg }).action, "allow");
});
```

- [ ] Run `node --test tools/cache-clock/test/keepwarm.test.mjs tools/cache-clock/test/clock-guard.test.mjs`. Expect `ERR_MODULE_NOT_FOUND` for `keepwarm.mjs`, then `c.ingestPing is not a function`.
- [ ] Implement the module, `remember` and `ingestPing`, the guard line and the `FILES` entry.
- [ ] Run the full suite, including `install.test.mjs`; all pass.
- [ ] `git add tools/cache-clock/extension/lib/keepwarm.mjs tools/cache-clock/extension/lib/clock.mjs tools/cache-clock/extension/lib/guard.mjs tools/cache-clock/install.sh tools/cache-clock/test/keepwarm.test.mjs tools/cache-clock/test/clock-guard.test.mjs`, then commit `feat: recognise cache-clock keep-warm pings outside the tally and guard`.

### Task 3: Report: pings out of the statistics, keep-warm spend shown

**Files:** Modify `tools/cache-clock/extension/lib/history.mjs:11-43` (`parseSessionLog`), `:45-47` (`emptyModel`), `:76-102` (summarize loop), `:111-122` (totals) and `:128-148` (`formatReport`). Test: `tools/cache-clock/test/history.test.mjs`.

**Interfaces:** A root `user.message` sets `pingTurn = isPingMessage(event.data)`. Each `calls[]` entry gains `ping: boolean`, true for a root usage record that follows a ping turn. Each model gains `pings` and `keepWarmUsd`, and the summary gains `pings` and `keepWarmUsd`. `spentUsd` includes ping spend. A ping call still sets `prevByKey`, so the next real call is compared against it, but then it adds only to `pings`, `keepWarmUsd` and `spentUsd` and `continue`s before `m.calls += 1`. When `sum.pings > 0`, `formatReport` adds the line `keep-warm: ${n} ping(s), ${usd(x)} (in total spent; not counted as calls or cold sends)`.

- [ ] Write the failing test:

```js
test("pings are left out of calls and cold counts, and their cost is shown as keep-warm spend", () => {
  const msg = (o) => JSON.stringify({ type: "user.message", timestamp: iso(T0), data: o });
  const s = { model: "claude-sonnet-5.5", ttl: 300 };
  const log = [record(T0, { ...s, input: 100_000, read: 0, write: 100_000 }),
    msg({ content: "cache-clock keep-warm", transformedContent: "[cache-clock:keepwarm] Reply with exactly: ." }),
    record(T0 + 4 * MIN, { ...s, input: 100_000, read: 100_000, write: 0, nanoAiu: 2e9 }),
    msg({ content: "carry on" }), record(T0 + 8 * MIN, { ...s, input: 101_000, read: 100_000, write: 1000 })].join("\n");
  const sum = summarize([{ id: "kw", ...parseSessionLog(log) }]);
  const m = sum.models[0];
  assert.deepEqual([m.calls, m.coldIdle, m.coldBreak, m.pings, sum.pings], [2, 0, 0, 1, 1]);
  assert.ok(Math.abs(m.keepWarmUsd - 0.02) < 1e-12);
  assert.ok(Math.abs(m.spentUsd - (0.02 + 2 * 111133000 / 1e11)) < 1e-12);
  assert.match(formatReport(sum), /keep-warm: 1 ping\(s\), \$0\.02/);
});
```

- [ ] Run `node --test tools/cache-clock/test/history.test.mjs`. Expect `[3, …] !== [2, …]`.
- [ ] Implement.
- [ ] Run `node --test tools/cache-clock/test/history.test.mjs`; all pass, the CLI JSON test included.
- [ ] `git add tools/cache-clock/extension/lib/history.mjs tools/cache-clock/test/history.test.mjs`, then commit `feat: report keep-warm pings as spend, not calls`.

### Task 4: Pure planner

**Files:** Modify `tools/cache-clock/extension/lib/keepwarm.mjs`. Test: `tools/cache-clock/test/keepwarm.test.mjs`.

**Interfaces:** Produces `LEAD_SHARE = 0.2`, `LEAD_MIN_MS = 30_000`, `LEAD_MAX_MS = 360_000`, `CONTEXT_LIMIT_SHARE = 0.85`, `USD_EPSILON = 1e-9` and `leadMs(lifetimeMs) -> number`. Also `planPing({ snapshot, config, window, spend, session, now }) -> { at: number } | { skip: string }` and `keepWarmEstimate(snapshot, hours) -> { pings: number, usd: number } | null`.

The inputs are:
- `snapshot`: a clock snapshot.
- `config`: `{ keepWarmHours, keepWarmMaxUsd, keepWarmPayback }`.
- `window`: `{ endsAt } | null`.
- `spend`: `{ usd, pings }`.
- `session`: `{ busy, pendingPrompt, questionOpen, selectedModel }`, where `selectedModel` is the raw selection, so Auto is `"auto"`.

Checks run in this order, and the first hit is returned:
1. `"off"`: hours is 0.
2. `"no-window"`.
3. `"auto"`: `selectedModel === "auto"`. This runs before the warm check, because an unresolved Auto snapshot is also "unknown" and the card must say `auto`.
4. `"not-warm"`: the snapshot is null or not warm.
5. `"model-switch"`: `selectedModel !== snapshot.model`.
6. `"busy"`: any of the three session flags is set.
7. `"context-full"`: `maxPromptTokens` is set and `contextTokens > 0.85 × maxPromptTokens`.
8. Then compute `at = max(now, expiresAt − leadMs(lifetime))`, where `lifetime` is `ttlSec × 1000` when `ttlSec` is set, else `expiresAt − lastCallAt`.
9. `"window-ended"`: `at > window.endsAt`.
10. `"unpriced"`: `warmUsd` or `extraUsd` is null.
11. `"budget"`: `spend.usd + warmUsd > keepWarmMaxUsd + USD_EPSILON`.
12. `"payback"`: payback is on and `spend.usd + warmUsd > extraUsd + USD_EPSILON`.
13. Otherwise return `{ at }`.

Rewrite-cost formula: the payback stop compares spend plus the next ping (`warmUsd = contextTokens × prices.read`) with the rewrite it avoids, `extraUsd = contextTokens × (prices.write − prices.read)` (`usage.mjs` `nextSendCosts`, already in the snapshot). `keepWarmEstimate` returns null for a null snapshot, or one without `ttlSec` or `warmUsd`. Otherwise `interval = lifetime − lead`, `pings = floor(hours × 3_600_000 / interval)` and `usd = pings × warmUsd`.

- [ ] Write the failing tests:

```js
const HOUR = 60 * MIN;
const sonnetSnap = (now = T0) => { const c = createClock(); c.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), T0)); return c.snapshot(now, "claude-sonnet-5.5"); };
const S = { busy: false, pendingPrompt: false, questionOpen: false, selectedModel: "claude-sonnet-5.5" };
const C = { keepWarmHours: 3, keepWarmMaxUsd: 0.5, keepWarmPayback: true };
const base = (o = {}) => ({ snapshot: sonnetSnap(), config: C, window: { endsAt: T0 + 3 * HOUR }, spend: { usd: 0, pings: 0 }, session: S, now: T0, ...o });
test("leadMs is 20% of the lifetime within 30 s and 6 min", () => {
  assert.deepEqual([300_000, 1_800_000, 60_000].map(leadMs), [60_000, 360_000, 30_000]);
});
test("planPing fires at expiry minus lead, or now when that has passed", () => {
  assert.deepEqual(planPing(base()), { at: T0 + 240_000 });
  assert.deepEqual(planPing(base({ now: T0 + 270_000, snapshot: sonnetSnap(T0 + 270_000) })), { at: T0 + 270_000 });
  assert.deepEqual(planPing(base({ window: { endsAt: T0 + 240_000 } })), { at: T0 + 240_000 }, "a ping at the window end is allowed");
  assert.deepEqual(planPing(base({ spend: { usd: 0.46, pings: 23 } })), { at: T0 + 240_000 }, "the 24th ping still pays back");
});
test("planPing names every skip reason", () => {
  for (const [o, skip] of [[{ config: { ...C, keepWarmHours: 0 } }, "off"], [{ window: null }, "no-window"],
    [{ snapshot: null }, "not-warm"], [{ snapshot: sonnetSnap(T0 + 6 * MIN), now: T0 + 6 * MIN }, "not-warm"],
    [{ session: { ...S, selectedModel: "auto" } }, "auto"], [{ session: { ...S, selectedModel: "gpt-6-luna" } }, "model-switch"],
    [{ session: { ...S, busy: true } }, "busy"], [{ session: { ...S, pendingPrompt: true } }, "busy"], [{ session: { ...S, questionOpen: true } }, "busy"],
    [{ snapshot: { ...sonnetSnap(), maxPromptTokens: 230_000 } }, "context-full"], [{ window: { endsAt: T0 + 239_999 } }, "window-ended"],
    [{ snapshot: { ...sonnetSnap(), warmUsd: null } }, "unpriced"],
    [{ spend: { usd: 0.49, pings: 0 }, config: { ...C, keepWarmPayback: false } }, "budget"], [{ spend: { usd: 0.47, pings: 0 } }, "payback"],
  ]) assert.deepEqual(planPing(base(o)), { skip }, skip);
});
test("keepWarmEstimate counts pings and their cost for a window", () => {
  const e = keepWarmEstimate(sonnetSnap(), 8);
  assert.equal(e.pings, 120);
  assert.ok(Math.abs(e.usd - 2.4) < 1e-9);
  assert.equal(keepWarmEstimate({ ...sonnetSnap(), ttlSec: null }, 8), null);
  assert.equal(keepWarmEstimate(null, 8), null, "no model call yet");
});
```

- [ ] Run `node --test tools/cache-clock/test/keepwarm.test.mjs`. Expect `leadMs is not a function`, from the import.
- [ ] Implement `leadMs` as `Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, LEAD_SHARE * lifetimeMs))`, and the other two functions as specified.
- [ ] Run the same command; all pass.
- [ ] `git add tools/cache-clock/extension/lib/keepwarm.mjs tools/cache-clock/test/keepwarm.test.mjs`, then commit `feat: add the cache-clock keep-warm planner`.

### Task 5: Settings, validation and keepwarm subcommands

**Files:** Modify `tools/cache-clock/extension/lib/config.mjs:9` (`DEFAULTS`), `:18-26` (`validated`), `:28-34` (`loadConfig`) and `:97-117` (`parseCommand`). Test: `tools/cache-clock/test/format-config.test.mjs`. Update the existing test at `:87-93`: both `deepEqual` checks now expect `{ ...DEFAULTS, ...cfg }`.

**Interfaces:** `DEFAULTS = Object.freeze({ mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 0, keepWarmMaxUsd: 0.5, keepWarmPayback: true })`. Constants: `KEEPWARM_ON_HOURS = 3`, `KEEPWARM_MAX_HOURS = 12`, `KEEPWARM_CONFIRM_ABOVE_HOURS = 6`, `KEEPWARM_MAX_USD = 5`.

`loadConfigResult(dir) -> { config, problem: string | null }`, and `loadConfig(dir)` returns its `.config`. A missing file or a missing key is not a problem. A present but invalid key falls back to its default and adds `config.json: <key> must be <rule>` to `problem`; parts are joined with `; `.

The rules:
- `mode`: `one of refuse, warn, off`.
- `minUsd`: `a dollar amount of 0 or more`.
- `headsUpMin`: `minutes, 0 or more`.
- `keepWarmHours`: `hours from 0 to 12`.
- `keepWarmMaxUsd`: `dollars from 0 to 5`.
- `keepWarmPayback`: `true or false`.

An unknown key adds `config.json: unknown setting "<key>"; accepted: mode, minUsd, headsUpMin, keepWarmHours, keepWarmMaxUsd, keepWarmPayback`. Bad JSON gives `config.json is not valid JSON (<err.message>)`. `loadConfig` never writes.

`parseCommand` splits off `verb` and the rest. Every verb except `keepwarm` keeps today's rule: more than one value is the error `too many arguments: ${args}`. The `keepwarm` forms:
- `on` gives `{ kind: "set", patch: { keepWarmHours: 3 } }`.
- `off` gives hours 0.
- `<h>` from 0 to 6 gives a set. Above 6, up to 12, it gives `{ kind: "confirm", patch: { keepWarmHours: h } }`.
- `budget <usd>` from 0 to 5 gives `{ keepWarmMaxUsd }`.
- `payback on|off` gives `{ keepWarmPayback: true|false }`.

The errors, which `runCommand` already wraps in `cache-clock: … Try /cache-clock help.`:
- `keepwarm takes on, off, hours from 0 to 12, budget <dollars 0 to 5>, or payback on|off`
- `keepwarm budget takes dollars from 0 to 5, e.g. 0.50`
- `keepwarm payback takes on or off`

- [ ] Write the failing tests:

```js
test("parseCommand understands keepwarm and rejects values outside the ranges", () => {
  assert.deepEqual(parseCommand("keepwarm on"), { kind: "set", patch: { keepWarmHours: 3 } });
  assert.deepEqual(parseCommand("keepwarm off"), { kind: "set", patch: { keepWarmHours: 0 } });
  assert.deepEqual(parseCommand("keepwarm 6"), { kind: "set", patch: { keepWarmHours: 6 } });
  assert.deepEqual(parseCommand("keepwarm 8"), { kind: "confirm", patch: { keepWarmHours: 8 } });
  assert.deepEqual(parseCommand("keepwarm budget $0.25"), { kind: "set", patch: { keepWarmMaxUsd: 0.25 } });
  assert.deepEqual(parseCommand("keepwarm payback off"), { kind: "set", patch: { keepWarmPayback: false } });
  assert.match(parseCommand("keepwarm 13").message, /on, off, hours from 0 to 12/);
  assert.match(parseCommand("keepwarm budget 6").message, /dollars from 0 to 5/);
  assert.match(parseCommand("keepwarm payback maybe").message, /on or off/);
  assert.equal(parseCommand("guard warn now").kind, "error");
});
test("loadConfigResult reports bad and unknown settings and leaves the file alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  const text = JSON.stringify({ keepWarmHours: 20, keepWarmPayback: "yes", colour: "red" });
  writeFileSync(join(dir, "config.json"), text);
  const { config, problem } = loadConfigResult(dir);
  assert.deepEqual(config, DEFAULTS);
  assert.match(problem, /keepWarmHours must be hours from 0 to 12/);
  assert.match(problem, /keepWarmPayback must be true or false/);
  assert.match(problem, /unknown setting "colour"; accepted: mode, minUsd/);
  assert.equal(readFileSync(join(dir, "config.json"), "utf8"), text);
  assert.equal(loadConfigResult(mkdtempSync(join(tmpdir(), "cc-"))).problem, null);
});
```

- [ ] Run `node --test tools/cache-clock/test/format-config.test.mjs`. Expect `loadConfigResult` to be missing from the import.
- [ ] Implement it, replacing `isAmount`-only validation with a per-key rule table.
- [ ] Run the same command and the full suite; all pass.
- [ ] `git add tools/cache-clock/extension/lib/config.mjs tools/cache-clock/test/format-config.test.mjs`, then commit `feat: add cache-clock keep-warm settings and subcommands`.

### Task 6: Keep-warm store: window, spend, stop reason and one lock per session

**Files:** Modify `tools/cache-clock/extension/lib/config.mjs` (append after `saveRefusal`, `:90`). Test: create `tools/cache-clock/test/keepwarm-store.test.mjs`.

**Interfaces:** `createKeepWarmStore(dir, sessionId, { pid = process.pid, isAlive = pidAlive } = {}) -> { load(): Window | null, save(window): void, lock(): boolean, unlock(): void }`. A `Window` is `{ startedAt: number, endsAt: number, usd: number, pings: number, stopped: string | null }`. The files are `join(dir, "keepwarm", <sha256 hex of sessionId>)` with `.json` and `.lock`, hashed as in `config.mjs:58`. `save` writes atomically (temp file plus rename, mode `0o600`, directory `0o700`), like `saveRefusal`. `load` returns null for a missing file, bad JSON, or invalid fields: they must be finite numbers, `endsAt >= startedAt`, `usd >= 0`, `pings` an integer of 0 or more, and `stopped` a string or null.

Lock rule: write `{ pid }` with flag `"wx"`. On `EEXIST`, return true when the holder is this pid. When the holder is not alive, or the lock is unreadable, remove it and retry once. Otherwise return false. `unlock` removes the lock only when this pid holds it. `pidAlive(pid)` is `process.kill(pid, 0)` returning true, false on `ESRCH`, and true on `EPERM`. An invalid session id makes `load` return null, `save` do nothing and `lock` return false.

- [ ] Write the failing tests:

```js
const W = { startedAt: NOW, endsAt: NOW + 3 * HOUR, usd: 0.2, pings: 10, stopped: null };
test("window, spend and stop reason round-trip per session", (t) => {
  const dir = sandbox(t);
  createKeepWarmStore(dir, "s-1").save(W);
  assert.deepEqual(createKeepWarmStore(dir, "s-1").load(), W);
  assert.equal(createKeepWarmStore(dir, "s-2").load(), null);
});
test("a corrupt or invalid window loads as null", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  for (const bad of [{ ...W, usd: -1 }, { ...W, endsAt: NOW - 1 }, { ...W, pings: 1.5 }, { ...W, stopped: 3 }]) { s.save(bad); assert.equal(s.load(), null); }
});
test("a live holder keeps the lock; a second process is refused", (t) => {
  const dir = sandbox(t);
  const [a, b] = [1, 2].map((pid) => createKeepWarmStore(dir, "s-1", { pid, isAlive: () => true }));
  assert.deepEqual([a.lock(), b.lock(), a.lock()], [true, false, true]);
  b.unlock();
  assert.equal(b.lock(), false, "unlock only removes your own lock");
});
test("a dead holder's lock is taken over", (t) => {
  const dir = sandbox(t);
  createKeepWarmStore(dir, "s-1", { pid: 1, isAlive: () => true }).lock();
  assert.equal(createKeepWarmStore(dir, "s-1", { pid: 2, isAlive: (p) => p !== 1 }).lock(), true);
});
```

  `sandbox` is the `refusal.test.mjs:14-18` helper, copied. Use `NOW = 1_800_000_000_000` and `HOUR = 3_600_000`. `save` writes `bad` as given (only `load` validates). Also add `no session id: no lock and no file`: `createKeepWarmStore(dir, null)` gives `lock() === false`, `load() === null`, and `save(W)` leaves `readdirSync(dir)` empty.
- [ ] Run `node --test tools/cache-clock/test/keepwarm-store.test.mjs`. Expect `createKeepWarmStore` to be missing from the import.
- [ ] Implement.
- [ ] Run the same command; all pass.
- [ ] `git add tools/cache-clock/extension/lib/config.mjs tools/cache-clock/test/keepwarm-store.test.mjs`, then commit `feat: persist the cache-clock keep-warm window with a per-session lock`.

### Task 7: Card line, help, replies and stop notes

**Files:** Modify `tools/cache-clock/extension/lib/format.mjs:86-99` (`card`) and `:101-136` (`HELP`), and add functions after `headsUp` (`:63`). Test: `tools/cache-clock/test/format-config.test.mjs`.

**Interfaces:** `card(snap, tally, config, keepWarm = null)` appends the line `  keep-warm  ${keepWarmLine(config, keepWarm)}`. `keepWarm` is the scheduler's `status()` (Task 8): `{ state: "off" | "waiting" | "on" | "stopped", msLeft, pings, usd, lastSkip, stopped, inFlight }`. `pings(n)` renders `1 ping` or `n pings`.

`keepWarmLine` gives, exactly:
- hours 0: `off (/cache-clock keepwarm on)`.
- waiting: `on (3h) · starts after your next message`.
- on: `on · ${duration(msLeft)} left · ${pings(n)} · ${usd(x)}`, plus ` · last skip: ${lastSkip}` when `lastSkip` is set.
- stopped: `stopped (${stopped}) · ${pings(n)} · ${usd(x)}`.

`keepWarmSaved(config)` gives `cache-clock: keep-warm: ${h}h after your last message · budget ${usd} · payback stop ${on|off} (saved for all sessions)`, or `cache-clock: keep-warm: off (saved for all sessions)` when hours is 0.

`keepWarmStopped(reason, { usd, pings })` gives `cache-clock: keep-warm stopped: ${STOP_TEXT[reason]} (${pings(n)}, ${usd(x)} this window).` `STOP_TEXT` is:
- `payback`: `pings have cost as much as the cold rewrite they avoid`
- `budget`: `the keep-warm budget is spent`
- `window-end`: `the keep-warm window ended`
- `cold-reply`: `a ping came back cold, so pinging is not keeping this cache warm`
- `send-failed`: `two pings in a row failed to send`
- `unmeasured`: `a ping's cost was not reported, so the budget cannot be enforced`

`keepWarmQuote(snap, hours, estimate)` gives `cache-clock: keep-warm for ${hours}h on ${snap.displayName} (${tokens} tokens) sends about ${n} pings, about ${usd} at the last reported prices; the budget and payback stop end it sooner. Turn it on?`. When `estimate` is null it gives `cache-clock: keep-warm for ${hours}h: cost unknown until a priced model call. Turn it on?`.

`HELP` gains a `Keep-warm (off until you turn it on; it costs money)` paragraph and these command lines:
- `/cache-clock keepwarm on`: keep warm 3 hours after your last message.
- `/cache-clock keepwarm 6`: 0 to 12 hours; above 6 shows the estimated cost first.
- `/cache-clock keepwarm off`.
- `/cache-clock keepwarm budget 0.50`: stop after $0.50 of pings in one window, 0 to 5.
- `/cache-clock keepwarm payback off`: keep pinging after pings cost more than one cold rewrite.

- [ ] Write the failing tests: `the card shows keep-warm state, time left, pings, spend and the last skip` (assert `card(warm, tally, DEFAULTS)` matches `/keep-warm  off \(\/cache-clock keepwarm on\)/`, and that `card(warm, tally, { ...DEFAULTS, keepWarmHours: 3 }, { state: "on", msLeft: 9_000_000, pings: 7, usd: 0.14, lastSkip: "busy", stopped: null, inFlight: false })` matches `/keep-warm  on · 2h30m left · 7 pings · \$0\.14 · last skip: busy/`); `stop notes name the stop and the spend` (`keepWarmStopped("payback", { usd: 0.48, pings: 24 })` matches `/stopped: pings have cost as much as the cold rewrite they avoid \(24 pings, \$0\.48 this window\)/`); and extend the help test's list with `/\/cache-clock keepwarm on/`, `/keepwarm budget /`, `/keepwarm payback off/`.
- [ ] Run `node --test tools/cache-clock/test/format-config.test.mjs`. Expect `keepWarmStopped` to be missing from the import.
- [ ] Implement.
- [ ] Run the same command; all pass.
- [ ] `git add tools/cache-clock/extension/lib/format.mjs tools/cache-clock/test/format-config.test.mjs`, then commit `feat: show cache-clock keep-warm on the card and in help`.

### Task 8: Scheduler

**Files:** Modify `tools/cache-clock/extension/lib/keepwarm.mjs`, which imports `keepWarmStopped` from `format.mjs`. Test: `tools/cache-clock/test/keepwarm.test.mjs`.

**Interfaces:** Consumes `planPing` and `leadMs` (Task 4), a store with Task 6's shape, and `keepWarmStopped` (Task 7). Produces `createKeepWarm({ send, read, store, now, setTimer, clearTimer, log }) -> { start(), onUserTurn(at), onPingUsage({ usd, warm }), onIdle(), onBusy(), reschedule(), configChanged(), stop(reason), status() }`. The dependencies:
- `send(): Promise`.
- `read(): { snapshot, config, session }`, in the shapes Task 4 uses.
- `log(text, severity)`, where severity is `"info"` or `"warn"`.

Constants: `RETRY_MS = 15_000`, `IN_FLIGHT_TIMEOUT_MS = 120_000`, `MAX_FAILED_SENDS = 2`, `HOUR_MS = 3_600_000`. The scheduler keeps one timer at most; every `reschedule()` clears it first.

Behaviour:
- `start()` loads `store.load()` and then reschedules.
- `onUserTurn(at)` sets the window to `{ startedAt: at, endsAt: at + hours × HOUR_MS, usd: 0, pings: 0, stopped: null }`, saves it, resets the failure count and reschedules.
- `configChanged()` keeps `startedAt` (or, with no window, uses `read().snapshot?.lastCallAt ?? null`), recomputes `endsAt` and saves. When hours is 0 it clears the timer and the window.
- `reschedule()` returns early while a ping is in flight or the window is stopped. Otherwise it runs `planPing` with `spend = { usd, pings }`. `{ at }` arms a timer for `at − now`. `{ skip }` stores `lastSkip`. The skips `payback`, `budget` and `window-ended` call `stop()` with `payback`, `budget` or `window-end`.
- The timer callback re-plans from a fresh `read()`. When the plan's `at` is more than 1000 ms away it reschedules. Otherwise it calls `store.lock()`; a refusal sets `lastSkip = "locked"`, re-arms the timer for `leadMs(lifetime)` later, and sends nothing. With the lock, it sets in-flight, arms the `IN_FLIGHT_TIMEOUT_MS` watchdog and calls `send()`.
- A rejection or the watchdog counts as one failed send and logs `cache-clock: keep-warm ping failed (<message>).` at `"info"`. At 2 in a row it stops with `send-failed`; otherwise it re-arms for `RETRY_MS`.
- `onPingUsage({ usd, warm })` does nothing unless a ping is in flight. A null `usd` stops with `unmeasured`. Otherwise it adds to spend and pings, resets failures and saves the window. When `!warm` it stops with `cold-reply`.
- `onIdle()` clears in-flight and the watchdog, then reschedules. `onBusy()` clears the timer.
- `stop(reason)` clears every timer and in-flight. `"shutdown"` also calls `store.unlock()` and does not persist. Every other reason persists `stopped`, saves, and logs `keepWarmStopped(reason, spend)`: `"warn"` for `cold-reply`, `send-failed` and `unmeasured`, `"info"` for the rest.
- `status()` returns the Task 7 shape, with `msLeft = Math.max(0, endsAt − now())`. The state is `"off"` when hours is 0, `"waiting"` with no window, and `"stopped"` when stopped. A window that has passed with no stop recorded (it ended during a skip, with no timer armed) reports `state: "stopped", stopped: "window-end"` without logging, so the card never shows time left after the end.
- Store failures never escape:
  - With hours 0, the scheduler never touches the store. `onUserTurn` records `startedAt` in memory only.
  - `store.lock()` returning false or throwing counts as `"locked"`.
  - A throwing `store.save` is caught and logged once at `"info"` as `cache-clock: could not save the keep-warm window (<message>); a reload may restart its budget.` Keep-warm keeps running on its in-memory state.

- [ ] Write the rig once in `keepwarm.test.mjs`, then the failing tests:

```js
const flush = () => new Promise((resolve) => setImmediate(resolve));
const iso = (ms) => new Date(ms).toISOString();
const memoryStore = ({ locked = false } = {}) => { let w = null; return { load: () => w, save: (x) => { w = x; }, lock: () => !locked, unlock() {} }; };
function rig({ config = {}, reply = () => "warm", send, store = memoryStore(), session = {} } = {}) {
  const r = { now: T0, timers: [], sent: 0, logs: [], clock: createClock(), session: { ...S, ...session }, config: { ...C, ...config } };
  const answer = () => { const call = normalizeUsage(pingUsage({ at: iso(r.now), read: reply(r.sent) === "warm" ? 200_000 : 10_000 }), r.now);
    const { kind } = r.clock.ingestPing(call); r.kw.onPingUsage({ usd: call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" }); r.kw.onIdle(); };
  r.kw = createKeepWarm({ send: send ?? (async () => { r.sent += 1; queueMicrotask(answer); }),
    read: () => ({ snapshot: r.clock.snapshot(r.now, r.session.selectedModel), config: r.config, session: r.session }),
    store, now: () => r.now, log: (text, severity) => r.logs.push({ text, severity }),
    setTimer: (fn, ms) => { const t = { fn, due: r.now + ms }; r.timers.push(t); return t; }, clearTimer: (t) => { if (t) t.cleared = true; } });
  r.turn = () => { r.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(r.now), ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), r.now)); r.kw.onUserTurn(r.now); };
  r.run = async (ms, step = 10_000) => { for (const end = r.now + ms; r.now < end;) { r.now += step;
    for (const t of [...r.timers]) if (!t.cleared && !t.fired && t.due <= r.now) { t.fired = true; t.fn(); } await flush(); } };
  r.kw.start();
  return r;
}
test("45 pings in 3 hours on a 5-minute cache with payback off", async () => {
  const r = rig({ config: { keepWarmPayback: false, keepWarmMaxUsd: 5 } }); r.turn(); await r.run(4 * HOUR);
  assert.equal(r.sent, 45);
  assert.match(r.logs.at(-1).text, /window ended/);
});
test("payback stops after 24 pings at 200k tokens", async () => {
  const r = rig({ config: { keepWarmMaxUsd: 5 } }); r.turn(); await r.run(3 * HOUR);
  assert.equal(r.sent, 24);
  assert.equal(r.kw.status().stopped, "payback");
});
test("the budget stops it", async () => {
  const r = rig({ config: { keepWarmPayback: false, keepWarmMaxUsd: 0.1 } }); r.turn(); await r.run(3 * HOUR);
  assert.equal(r.sent, 5);
  assert.match(r.logs.at(-1).text, /budget is spent \(5 pings, \$0\.10/);
});
test("a cold reply stops it", async () => {
  const r = rig({ reply: (n) => (n === 2 ? "cold" : "warm") }); r.turn(); await r.run(2 * HOUR);
  assert.equal(r.sent, 2);
  assert.equal(r.logs.at(-1).severity, "warn");
});
test("two failed sends in a row stop it", async () => {
  let tries = 0;
  const r = rig({ send: async () => { tries += 1; throw new Error("host gone"); } }); r.turn(); await r.run(HOUR);
  assert.equal(tries, 2);
  assert.equal(r.kw.status().stopped, "send-failed");
});
```

  Also write these tests:
  - `a ping with no reply for 2 minutes counts as a failed send`: a `send` that resolves without answering. After `run(4 * MIN)`, `status().inFlight` is true. After `run(2 * MIN)` more, which passes the watchdog at 360 s, `status().inFlight` is false and a log matches `/keep-warm ping failed/`.
  - `no pings while busy or on Auto, and they resume on idle`: `session.busy = true`, run 3 min, `sent === 0` and `lastSkip === "busy"`. Then `busy = false; kw.onIdle()`, run 2 min, `sent === 1`. A second rig with `selectedModel: "auto"` gives `sent === 0` and `lastSkip === "auto"`.
  - `shutdown clears every timer`: run 5 min, `kw.stop("shutdown")`, run 1 h. Then `sent === 1` and every timer is `cleared || fired`.
  - `a late wake after sleep sends nothing when the cache went cold`: run 4 min, so `sent` is 1, then `await r.run(40 * MIN, 40 * MIN)`. `sent` is still 1, and `lastSkip === "not-warm"`. Then set `r.now += 3 * HOUR`: `status()` gives `state: "stopped"`, `stopped: "window-end"` and `msLeft: 0`.
  - `a store that cannot save never breaks keep-warm`: use `store = { ...memoryStore(), save: () => { throw new Error("EACCES") } }`. `turn()` does not throw, `run(9 * MIN)` gives `sent === 2`, and exactly one log matches `/could not save the keep-warm window \(EACCES\)/`.
  - `a reload resumes the window, its spend and its stop`: `r1` with `keepWarmMaxUsd: 5` runs 40 min, which is 10 pings. `r2` shares the store, takes `r2.now = r1.now`, gets `r2.clock.ingest(normalizeUsage(pingUsage({ at: iso(r2.now) }), r2.now))`, then `r2.kw.reschedule()` and runs 3 h. `r1.sent + r2.sent === 24`. A third rig on the same store sends 0.
  - `a lock held by another process means no ping`: with `memoryStore({ locked: true })`, after `run(4 * MIN)`, `sent === 0` and `lastSkip === "locked"`. After `run(30 * MIN)` more, `sent` is still 0.
- [ ] Run `node --test tools/cache-clock/test/keepwarm.test.mjs`. Expect `createKeepWarm is not a function`.
- [ ] Implement `createKeepWarm` as specified, with private helpers each under 50 lines (`arm`, `fire`, `failed`, `persist`).
- [ ] Run the same command; all pass.
- [ ] Guardrail proof, one stop at a time. Change only the named line, run the test, see the named assertion fail, then restore the line and see it pass:
  - Payback: set `keepWarmPayback: false` in the payback test's config. `sent` becomes 45 (the window end), `!== 24`.
  - Budget: set `keepWarmMaxUsd: 5` in the budget test. `sent` becomes 45, `!== 5`.
  - Window end: set `keepWarmHours: 12` in the 45-ping test. `sent` becomes 60, `!== 45`.
  - Cold reply: no setting turns this stop off, so comment out the `if (!warm) stop("cold-reply")` line in `keepwarm.mjs`. `sent > 2`.
  - Failed sends: set `MAX_FAILED_SENDS = Infinity`. Retries every `RETRY_MS` until the cache goes cold, so `tries > 2`.
- [ ] `git add tools/cache-clock/extension/lib/keepwarm.mjs tools/cache-clock/test/keepwarm.test.mjs`, then commit `feat: add the cache-clock keep-warm scheduler with its stops`.

### Task 9: Wire keep-warm into the session

**Files:** Modify `tools/cache-clock/extension/lib/wiring.mjs`: `seed` (`:30-64`), `attach` (`:112-300`), `headsUpScheduler` (`:302-322`), and `runCommand` (`:324-338`), which becomes async. Test: `tools/cache-clock/test/wiring.test.mjs`; extend `fakeHost` (`:13-60`).

**Interfaces:** `attach({ …, keepWarmStore = createKeepWarmStore, onHostGone = (fn) => { process.stdin.once("end", fn); process.once("exit", fn); } })` returns `{ session, clock, keepWarm }`. Build `keepWarm` with `store = keepWarmStore(dir, state.session.sessionId)`, and call `start()` only after `seed` and `loadRefusal` (`:259-261`), so a resumed clock is in place first. New state: `turnSource: "ping" | "user" | null`, `openRequests: Set`. The rules, each written as a short helper:
- **Send:** `sendPing()` sets `state.turnSource = null`, then sends as in Global Constraints.
- **Scheduler dependencies:** `now` is attach's `now`. `setTimer(fn, ms)` is `timers.setTimeout(fn, ms)` followed by `?.unref?.()`, and `clearTimer` is `timers.clearTimeout`. `log(text, severity)` maps `"warn"` to `say(text, warnLevel)` (error level in VS Code, `wiring.mjs:118`), and `"info"` to `say(text, vsCode ? { level: "error" } : { ephemeral: true })`, so a stop note reaches the VS Code chat too.
- **Filing:** a root `user.message` sets `turnSource` to `isPingMessage(data) ? "ping" : "user"`. A root `session.idle` resets it to `null`. A main usage call is a ping when `turnSource === "ping" || (keepWarm.status().inFlight && turnSource !== "user")`. A ping goes to `clock.ingestPing(call)`; if in flight it is followed by `keepWarm.onPingUsage({ usd: call.nanoAiu === null ? null : call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" })`. A real call goes to `clock.ingest` and then `keepWarm.reschedule()`.
- **Seed:** `seed` tracks root `user.message` the same way and calls `ingestPing` for ping records.
- **Prompt hook:** `onPrompt` returns `undefined` for `isPingText(prompt)` before anything else. For any other prompt that is not a slash command or `!` escape, it calls `keepWarm.onUserTurn(now())` and then guards as today.
- **read():** returns `{ snapshot: snapshot(), config: loadConfig(dir), session: { busy, pendingPrompt: Boolean(state.pendingPrompt), questionOpen: state.openRequests.size > 0, selectedModel: state.selection?.modelId ?? null } }`.
- **Events:** root `user_input.requested` and `elicitation.requested` add `data.requestId`; their `.completed` events delete it. `assistant.turn_start` calls `onBusy()`. `session.idle` sets `busy = false` and calls `onIdle()`. Model change, deselect and Auto resolution call `reschedule()`. `session.shutdown` and `onHostGone` call `stop("shutdown")`.
- **Heads-up:** `headsUpScheduler` returns early while `keepWarm.status().state === "on"`. The heads-up key changes with every ping and its lead equals the ping lead on a 5-minute cache, so a heads-up would fire next to every ping.
- **Commands:** `runCommand` passes `keepWarm.status()` to `card`. A patch with a keep-warm key saves, calls `configChanged()` and replies `keepWarmSaved(next)`. `"confirm"` builds `keepWarmQuote(snapshot(), h, keepWarmEstimate(snapshot(), h))`. When the host can ask, it asks with `["Turn on", "Cancel"]`; "Turn on" saves, anything else replies `cache-clock: keep-warm unchanged.`. When it cannot ask, it saves and replies with the quote line plus the saved line.

`fakeHost` gains:
- `pid = 1`, `alive = new Set([pid])`, `sent = []`, `autoReply = true`, `emitUserMessage = true`.
- `session.rpc.send` and `session.send`: push the params, return a message id, and when `autoReply` is set, call `host.replyToPing()` on the next microtask.
- `replyToPing()`: emits `user.message` (`{ content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" }`) unless `emitUserMessage` is false, then `assistant.turn_start`, `assistant.usage` with `pingUsage({ at: iso(host.now) })`, and `session.idle`.
- `turn(text = "carry on", o = {})`: `await host.prompt(text)`, then emits `user.message`, `turn_start`, `sonnet({ at: iso(host.now), ...o })` usage and idle.
- `run(ms, step = 10_000)`: advance and flush.
- `start` passes `keepWarmStore: (d, id) => createKeepWarmStore(d, id, { pid: host.pid, isAlive: (p) => host.alive.has(p) })` and `onHostGone: (fn) => { host.hostGone = fn; }`.

Use `const KW = { mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 3, keepWarmMaxUsd: 0.5, keepWarmPayback: true }`.

- [ ] Write the failing tests. Review Focus tests are marked RF.
  - `keep-warm is off by default: no ping in an hour`: `fakeHost()`, `turn()`, `run(HOUR)`, `sent.length === 0`.
  - `a ping goes through rpc.send with the fixed prompt and flags`: after `run(4 * MIN)`, `sent[0]` deep-equals `{ prompt: PING_PROMPT, displayPrompt: PING_DISPLAY, source: "system", mode: "enqueue", billable: false }`.
  - `without rpc.send the ping falls back to session.send`: `delete h.session.rpc.send`. The same deep-equal without `billable`.
  - `pings are not model calls, never ask, and show on the card`: with `answer: "Don't send"`, `run(30 * MIN)`, then `command("")`. The card matches `/1 model calls/` and `/keep-warm  on · 2h30m left · 7 pings · \$0\.14/`, and `asked.length === 0`.
  - `a host without user.message still files pings by the in-flight flag`: with `emitUserMessage = false`, the same `/1 model calls/`.
  - `no heads-up line while keep-warm is on`: after `run(30 * MIN)`, no log matches `/goes cold in/`.
  - `a ping's own prompt hook is never guarded`: go cold, `prompt(PING_PROMPT)` returns `undefined`, with `aborts === 0` and `asked.length === 0`.
  - `a resumed session seeds pings as pings`: history is a real record, a ping `user.message`, then a ping record. The card matches `/1 model calls/`.
  - RF `a reload mid-window resumes the window and its spend`: `alive = new Set([1, 2])`. `h1` (pid 1) turns and runs 40 min, so `h1.sent.length === 10`. Then `alive.delete(1)`. `h2` is `fakeHost({ config: KW, dir: h1.dir, pid: 2, alive })` with `h2.now = h1.now`. Its history is the real record at T0, a ping `user.message`, and a ping record at `h2.now`. Start it and run 3 h. `h1.sent.length + h2.sent.length === 24`, and the `h2` card matches `/stopped \(payback\) · 24 pings · \$0\.48/`.
  - RF `two processes on one session: only the lock holder pings`: both hosts are alive with the same dir. Both `turn()`, then advance them step by step together for 30 min. Expect `[h1.sent.length, h2.sent.length]` to deep-equal `[7, 0]`.
  - RF `the user typing while a ping is in flight counts as a real turn`: set `autoReply = false` and `run(4 * MIN)`. Emit the ping `user.message` and `turn_start`, then `await h.prompt("one more thing")`. Emit `pingUsage` usage, `user.message` with "one more thing", `sonnet({ at, read: 200_000, write: 0 })` usage, and idle. The card matches `/2 model calls/`, `/1 ping · \$0\.02/` and `/3h00m left/`.
  - RF `switching to Auto stops pings`: after `run(4 * MIN)`, `sent` is 1. Set `selected = { modelId: "auto" }`, emit `model_change auto` and run 30 min. `sent` is still 1, and the card matches `/last skip: auto/`.
  - `session shutdown clears keep-warm timers and frees the lock`: emit `session.shutdown`, run 1 h, so `sent` stays 1, and `existsSync(<dir>/keepwarm/<sha256("s-1")>.lock)` is false. Also check that `h.hostGone()` does the same on a second host.
  - `a stop note reaches the session log`: with `{ ...KW, keepWarmMaxUsd: 0.04, keepWarmPayback: false }`, after `run(30 * MIN)` the sends number 2 and a log matches `/keep-warm stopped: the keep-warm budget is spent \(2 pings, \$0\.04/`.
  - `an unwritable keep-warm folder never breaks the prompt hook`: `writeFileSync(join(dir, "keepwarm"), "")` before `start()`. `await h.turn()` resolves, and `h.prompt("hi")` returns `undefined`.
  - `/cache-clock keepwarm 8 asks with the estimated cost first`: with `answer: "Turn on"`, the question matches `/about 120 pings, about \$2\.40/`, the options are `["Turn on", "Cancel"]`, and `loadConfig(dir).keepWarmHours === 8`. With `"Cancel"`, the config stays at 3 and the reply matches `/unchanged/`.
- [ ] Run `node --test tools/cache-clock/test/wiring.test.mjs`. The new tests fail on `sent.length` (no keep-warm yet); the old tests still pass.
- [ ] Implement.
- [ ] Run the full suite; all pass.
- [ ] `git add tools/cache-clock/extension/lib/wiring.mjs tools/cache-clock/test/wiring.test.mjs`, then commit `feat: wire cache-clock keep-warm into the Copilot session`.

### Task 10: No more silently swallowed errors

**Files:** Modify `tools/cache-clock/extension/lib/wiring.mjs`: `quietly` (`:66-73`), `ask`'s catch (`:105`), `settle` (`:183-192`), `checkPrompt` (`:233-246`), the config reads and `runCommand`. Test: `tools/cache-clock/test/wiring.test.mjs`. Rewrite the existing test at `:399-406`: a synchronously throwing abort now returns `undefined` and logs the abort failure, because the send cannot be stopped.

**Interfaces:** `quietly(fn, onError = null)` passes a sync throw or an async rejection to `onError(err)`. `say` keeps no handler, because a failing log cannot log. `logOnce(key, text)` logs at info through `say` and only once per key per process. Each site and its exact line:
- `ask` catch: `cache-clock: could not show the question (<message>); used the refuse-once note instead.`
- Abort, sync throw: `settle` returns `undefined`, the hold note is never logged, and it logs `cache-clock: could not stop the send (<message>); it may have gone out.` An async rejection logs the same line when it arrives. The hold note says "held" before that and is not taken back; the hook cannot await `abort()`.
- `saveRefusal`: `cache-clock: could not save the refusal memory (<message>); a resumed session may ask again.`
- Config: every config read goes through a `getConfig()` that calls `loadConfigResult(dir)` and reports `problem` once, as `cache-clock: ${problem}; using defaults for those settings. The file was left as it is.` at `warnLevel`. On a set command while `problem` is set, `runCommand` saves nothing and replies `cache-clock: not saved: ${problem}. Fix or delete ${join(dir, "config.json")} first.` at `{ level: "error" }`.

In `checkPrompt`, the `UNASKED`, `EXPIRED` and `null` notes move after `settle` and are said only when `settle` returned `{ suppressOutput: true }`.

- [ ] Write the failing tests:
  - `a corrupt config is reported once and the file is left as it is`: write `{not json`. Two prompts and `command("")` give exactly one log matching `/config\.json is not valid JSON/`. `command("guard warn")` replies `/not saved/`, and the file text is unchanged.
  - `a failed abort never says the send was held`: with `answer: null` and an abort that throws synchronously, the result is `undefined`, no log matches `/held/`, and one matches `/could not stop the send/`.
  - `an async abort failure is logged`: the abort returns `Promise.reject(new Error("gone"))`; after `flush()` a log matches `/could not stop the send \(gone\)/`.
  - `a failing question is logged once`: `answer: new Error("no ui")` gives one log matching `/could not show the question \(no ui\)/`.
  - `a failing refusal save is logged`: `writeFileSync(join(dir, "refusals"), "")` before the cold prompt gives a log matching `/could not save the refusal memory/`.
- [ ] Run `node --test tools/cache-clock/test/wiring.test.mjs`. Expect these and the rewritten `:399` test to fail.
- [ ] Implement.
- [ ] Run the full suite; all pass.
- [ ] `git add tools/cache-clock/extension/lib/wiring.mjs tools/cache-clock/test/wiring.test.mjs`, then commit `fix: log cache-clock errors that were swallowed and stop claiming a failed abort held`.

### Task 11: Bounded read of the session log

**Files:** Modify `tools/cache-clock/extension/lib/wiring.mjs:25` (`readSessionLog`) and `:30-36` (`seed`). Test: `tools/cache-clock/test/wiring.test.mjs`.

**Interfaces:** `export const MAX_HISTORY_BYTES = 8 * 1024 * 1024`. `export function readTail(file, maxBytes) -> { text: string, truncated: boolean }`: when `statSync(file).size <= maxBytes` it returns the whole file. Otherwise it reads the last `maxBytes` with `openSync` and `readSync`, drops everything up to and including the first `"\n"`, and returns `truncated: true`. `readSessionLog(session)` returns `readTail(join(session.workspacePath, "events.jsonl"), MAX_HISTORY_BYTES)`. `seed` accepts a string (test fakes) or `{ text, truncated }`. When truncated it calls `logOnce("history", "cache-clock: the session log is larger than 8 MiB; read only its last 8 MiB, so older calls are not in this session's tally.")`. The rest of seeding is unchanged; selection comes from the RPC lookup when the start event was cut off.

- [ ] Write the failing tests:
  - `readTail returns whole lines from the end of a large file`: write 1000 JSON lines to a temp file and call `readTail(file, 200)`. `truncated` is true, every line passes `JSON.parse`, and the last line equals the file's last line. Also `readTail(file, 1e9).truncated === false`.
  - `a truncated session log is reported once`: `h.history = { text: <one usage record>, truncated: true }`. One log matches `/larger than 8 MiB/`, and the clock is seeded (the cold prompt aborts).
- [ ] Run `node --test tools/cache-clock/test/wiring.test.mjs`. Expect `readTail` to be missing from the import.
- [ ] Implement.
- [ ] Run the full suite; all pass.
- [ ] `git add tools/cache-clock/extension/lib/wiring.mjs tools/cache-clock/test/wiring.test.mjs`, then commit `fix: read only the tail of a large cache-clock session log`.

### Task 12: Pinned installer with a checksum per file

**Files:** Create `tools/cache-clock/bin/checksums.mjs`. Modify `tools/cache-clock/install.sh`: the header (`:3`), `BASE_URL` (`:12`), and the download loop (`:92-97`). Every surface that prints the one-line install also changes, with the visible `<code class="ct">` and `data-copy` updated together (a cross-surface edit, `AGENTS.md:83-89`):
- `tools/cache-clock/README.md:23` and `:36`;
- `docs/features/cache-clock.html:93` and `:95`;
- root `README.md:125-126`;
- `site/index.html:119` (two commands) and `:253`;
- `docs/features/showcase/cache-clock/how-it-works.html:499`.

The generated diagram pages and `motion.json` under `docs/features/showcase/cache-clock/` are recorded artifacts and are out of scope. Test: `tools/cache-clock/test/install.test.mjs`. This task runs after every `extension/` edit.

**Interfaces:**
- `install.sh` gains `REF="cache-clock-v1.1.0"` before `BASE_URL`. The default becomes `https://raw.githubusercontent.com/abhijitbansal/claude-skills/$REF/tools/cache-clock/extension`, and `CACHE_CLOCK_BASE_URL` still overrides it.
- After `FILES`, a generated block: `# BEGIN SHA256 (generated: node tools/cache-clock/bin/checksums.mjs --write)`, then `SUMS='` with one `<64 hex>  <path>` line per `FILES` entry in `FILES` order, then `'` and `# END SHA256`.
- `sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }`.
- Before downloading, if neither tool is present, it fails with `cache-clock: the one-line install needs sha256sum or shasum`.
- After each file downloads: `want=$(printf '%s\n' "$SUMS" | awk -v f="$f" '$2 == f { print $1 }')`. An empty `want` gives `cache-clock: no checksum listed for %s`; a mismatch gives `cache-clock: checksum mismatch: %s`. Both exit 1, and the existing trap removes the stage.
- `checksums.mjs` reads `FILES` from `install.sh`, hashes `extension/<file>` with `node:crypto`, and handles exactly `--write` (rewrite the block) and `--check` (exit 1 with `cache-clock: install.sh checksums are stale; run node tools/cache-clock/bin/checksums.mjs --write`). Anything else exits 2 with `usage: checksums.mjs --write | --check`.
- The README and site curl lines use `https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.1.0/tools/cache-clock/install.sh`.

- [ ] Write the failing tests in `install.test.mjs`:
  - `install.sh checksums match the extension files`: `spawnSync(process.execPath, [join(ROOT, "bin", "checksums.mjs"), "--check"])` exits 0.
  - `checksums.mjs rejects unknown arguments and lists the accepted ones`: `--force` exits 2 and stderr matches `/--write \| --check/`.
  - `a piped install refuses a file whose checksum does not match`: `cpSync` `extension` to a temp dir, append `// x` to its `lib/clock.mjs`, then run `piped(pathToFileURL(tmp).href).run()`. It exits 1, stderr matches `/checksum mismatch: lib\/clock\.mjs/`, `dest` does not exist, and no `.cache-clock*` folder is left.
  - `the one-line install is pinned to a tag`: the script matches `/^REF="cache-clock-v1\.1\.0"$/m`. The `BASE_URL=` line contains `$REF` and not `/main/`. Each of the five surfaces above contains `/cache-clock-v1.1.0/tools/cache-clock/install.sh` and not `/main/tools/cache-clock/install.sh`. Resolve the paths from `ROOT` (`../..` reaches the worktree root).
- [ ] Run `node --test tools/cache-clock/test/install.test.mjs`. Expect the four new tests to fail: missing script, no mismatch check, no `REF`.
- [ ] Implement, then run `node tools/cache-clock/bin/checksums.mjs --write`.
- [ ] Run `node --test tools/cache-clock/test/install.test.mjs`, then `shellcheck tools/cache-clock/install.sh`; both are clean.
- [ ] Guardrail proof: comment out the `exit 1` after the mismatch message and run the test. `a piped install refuses…` fails with status 0. Restore it.
- [ ] `git add tools/cache-clock/bin/checksums.mjs tools/cache-clock/install.sh tools/cache-clock/test/install.test.mjs tools/cache-clock/README.md docs/features/cache-clock.html README.md site/index.html docs/features/showcase/cache-clock/how-it-works.html`, then commit `fix: pin the cache-clock one-line install to a tag with per-file checksums`.

### Task 13: Docs

**Files:** Modify `tools/cache-clock/README.md`: Commands (`:90-102`), the card sample (`:104-113`), a new "Keep-warm" section after "How it works" (`:115`), the "No keep-warm yet" limit (`:256-259`), and Tests (`:301-320`). Modify `docs/features/cache-clock.html`: the stat band (`:51`), the card sample (`:112-122`), a new usability `gitem` after `:126`, Architecture (`:137`), the Limits `gitem` (`:185`) and the inventory (`:196-197`).

**Interfaces:** None (prose). Every keep-warm claim in the README says "tested against a fake host only" until Task 14's result is recorded.

- [ ] Commands: add the five `keepwarm` lines from Task 7's `HELP`, word for word.
- [ ] Card: use the Write tool to create `.scratch/card-sample.mjs` (gitignored; never committed). It imports `card` from `../tools/cache-clock/extension/lib/format.mjs` and `DEFAULTS` from `../tools/cache-clock/extension/lib/config.mjs`, and runs `console.log(card({ model: "claude-sonnet-5.5", displayName: "Claude Sonnet 5.5", state: "warm", msLeft: 77_000, ttlSec: 300, prices: { input: 2.25e-6, read: 0.09e-6, write: 2.25e-6, output: 9e-6 }, contextTokens: 37_200, coldUsd: 0.0837, warmUsd: 0.0033, extraUsd: 0.0804 }, { calls: 5, coldIdle: 0, coldBreak: 0, coldSwitch: 0, extraUsd: 0 }, { ...DEFAULTS, keepWarmHours: 3 }, { state: "on", msLeft: 9_840_000, pings: 2, usd: 0.0066, lastSkip: null, stopped: null, inFlight: false }))`. Run it with `node .scratch/card-sample.mjs` and paste the output in place of the "Historical card", labelled "Sample card from `format.mjs` with sample numbers, not a live capture". Put the same text in the site's `.code-body` and its `data-copy`.
- [ ] README "Keep-warm" section. It covers:
  - what a ping is, with the prompt text and the display text;
  - that it is off until `/cache-clock keepwarm on` (3 h), with the range 0 to 12 and the confirmation above 6;
  - the three stops, the cold-reply stop and the failed-send stop;
  - that spend is read from `totalNanoAiu`;
  - the lock file and the stored window under `~/.copilot/cache-clock/keepwarm/`;
  - the cost table from the spec's section 2, labelled "estimated from list prices, not measured on a bill";
  - the line "Tested against a fake Copilot host only. A live check is pending; this section changes with its result."
- [ ] Replace the "No keep-warm yet" limit in the README and the site with "Keep-warm adds a turn per ping" (the host may show each ping as a short turn) and "Keep-warm trusts the next usage event": a ping that goes unreported counts as a failed send.
- [ ] Site: add a `gitem` titled `/cache-clock keepwarm on | off | <hours>` with per-line copy buttons for `/cache-clock keepwarm on`, `/cache-clock keepwarm off`, `/cache-clock keepwarm budget 0.50` and `/cache-clock keepwarm payback off`. Each is its own `<div class="cl">`, and no `data-copy` contains `#`. Change "Seven small modules" to "Eight", add `keepwarm` to the lib lists at `:137` and `:196`, and set both test counts (`:51` `data-count` and the text, `:197`) to the `# tests` number printed by `node --test "tools/cache-clock/test/*.test.mjs"`.
- [ ] Check: `grep -n 'data-copy="[^"]*#' docs/features/cache-clock.html` prints nothing. `grep -n "No keep-warm yet" tools/cache-clock/README.md docs/features/cache-clock.html` prints nothing.
- [ ] `git add tools/cache-clock/README.md docs/features/cache-clock.html`, then commit `docs: describe cache-clock keep-warm and regenerate the card sample`.

### Task 14: Owner-run live check (billed) and release tag

**Files:** None until the result is in. Then `tools/cache-clock/README.md`: the Keep-warm section, and the "What Copilot reported" section (`:159`). This cannot be automated: it sends real, billed requests. The owner approved one run of three pings on Luna, and only the owner or a session the owner starts runs it.

- [ ] Install from the branch checkout (`sh tools/cache-clock/install.sh`) and start a new `copilot` session on GPT-6 Luna with a small context (under 20k tokens).
- [ ] Run `/cache-clock keepwarm 1` and `/cache-clock keepwarm payback off`. Send one real message and note its `cacheExpiresAt` from `/cache-clock` (time left). Stay idle about 75 minutes, which gives three pings at about 24-minute spacing, then send one real message.
- [ ] Record, per ping, from `~/.copilot/session-state/<id>/events.jsonl` and the screen:
  - whether `cacheExpiresAt` advanced to the ping's start plus 1800 s;
  - `cacheReadTokens` on the ping and on the next real turn (warm means at least 90% of the previous input);
  - `copilotUsage.totalNanoAiu` on each ping, and whether `billable: false` changed it;
  - whether the records carry `duration`;
  - how the ping renders in the CLI;
  - where the marker lands on `user.message` (`content` or `transformedContent`) and its `source`;
  - whether `onUserPromptSubmitted` fired for the ping and what `input.prompt` held;
  - whether `session.rpc.send` existed, or the `session.send` fallback ran.
- [ ] Repeat one ping in VS Code (`install.sh --project`, `"chat.canvases.enabled": true`) and record how it renders there.
- [ ] Write the results into the README as a dated, measured table. If pings did not keep the provider cache warm, set `keepWarmHours` back to off in the README advice, say that keep-warm is not recommended, and record the finding; the design's rule is not to ship it. Commit `docs: record the cache-clock keep-warm live check`.
- [ ] After merge, the owner creates the tag `cache-clock-v1.1.0` on the merge commit. It is a publish step, and the README and site curl lines 404 until it exists. Then `curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.1.0/tools/cache-clock/install.sh | sh` must install cleanly.
