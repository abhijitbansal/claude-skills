import { test } from "node:test";
import assert from "node:assert/strict";
import { isPingPrompt, isPingMessage, createPingLedger, PING_DISPLAY, PING_PROMPT, leadMs, planPing, keepWarmEstimate, createKeepWarm } from "../extension/lib/keepwarm.mjs";
import { createClock } from "../extension/lib/clock.mjs";
import { normalizeUsage, NANO_AIU_PER_USD } from "../extension/lib/usage.mjs";
import { usage, pingUsage, T0, MIN } from "./fixtures.mjs";

test("only the exact ping prompt and ping messages are recognised, not a pasted marker", () => {
  assert.ok(isPingPrompt(PING_PROMPT));
  assert.ok(!isPingPrompt("[cache-clock:keepwarm] summarise the repo"), "marker at the start of a real prompt");
  assert.ok(!isPingPrompt("explain [cache-clock:keepwarm] to me"), "marker in the middle");
  assert.ok(!isPingPrompt(` ${PING_PROMPT}`), "not even a padded copy");
  assert.ok(!isPingPrompt(undefined));
  assert.ok(isPingMessage({ content: PING_DISPLAY, transformedContent: PING_PROMPT }));
  assert.ok(isPingMessage({ content: PING_PROMPT }));
  assert.ok(isPingMessage({ content: PING_DISPLAY, source: "system" }));
  assert.ok(!isPingMessage({ content: PING_DISPLAY, source: "user" }));
  assert.ok(!isPingMessage({ content: PING_PROMPT, source: "user" }), "a user-sourced message is never a ping");
  assert.ok(!isPingMessage({ content: "[cache-clock:keepwarm] summarise the repo" }));
  assert.ok(!isPingMessage({ content: "explain [cache-clock:keepwarm] to me", transformedContent: "ctx explain [cache-clock:keepwarm] to me" }));
  assert.ok(!isPingMessage({ content: PING_DISPLAY }), "the display text alone, with no system source, is not enough");
});

test("the ledger ties each usage record to the turn it belongs to, by message order", () => {
  const ping = { content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" };
  const real = { content: "carry on" };
  const run = (steps) => { const l = createPingLedger(); return steps.map((s) => (s === "ping" || s === "real" ? l.onMessage(s === "ping" ? ping : real) : l.onUsage())).filter((x) => typeof x === "boolean"); };
  assert.deepEqual(run(["real", "u", "u", "ping", "u", "real", "u"]), [false, false, true, false]);
  assert.deepEqual(run(["ping", "real", "u", "u"]), [true, false], "a message typed while the ping ran does not steal its record");
  assert.deepEqual(run(["u"]), [false], "a record with no message before it is a real call");
  assert.deepEqual(run(["ping", "u", "u"]), [true, false], "a ping has one record; a second is not a ping");
});

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

test("planPing boundaries: context at exactly 85% still pings, one token over does not", () => {
  const snap = (contextTokens) => ({ ...sonnetSnap(), contextTokens, maxPromptTokens: 200_000 });
  assert.deepEqual(planPing(base({ snapshot: snap(170_000) })), { at: T0 + 240_000 });
  assert.deepEqual(planPing(base({ snapshot: snap(170_001) })), { skip: "context-full" });
});

test("planPing boundaries: spend that lands exactly on the budget is allowed, a cent over is not", () => {
  const noPayback = { ...C, keepWarmPayback: false };
  assert.deepEqual(planPing(base({ config: noPayback, spend: { usd: 0.48, pings: 24 } })), { at: T0 + 240_000 });
  assert.deepEqual(planPing(base({ config: noPayback, spend: { usd: 0.49, pings: 24 } })), { skip: "budget" });
  assert.deepEqual(planPing(base({ config: { ...noPayback, keepWarmMaxUsd: 0 } })), { skip: "budget" }, "a zero budget never pings");
});

test("planPing refuses numbers it cannot compare instead of letting a NaN fall through", () => {
  for (const [o, why] of [
    [{ config: { ...C, keepWarmMaxUsd: Number.NaN } }, "NaN budget"], [{ config: { ...C, keepWarmMaxUsd: undefined } }, "missing budget"],
    [{ spend: { usd: Number.NaN, pings: 0 } }, "NaN spend"], [{ spend: { usd: undefined, pings: 0 } }, "missing spend"],
    [{ window: { endsAt: Number.NaN } }, "NaN window end"], [{ window: {} }, "missing window end"],
    [{ snapshot: { ...sonnetSnap(), ttlSec: null, startAt: undefined } }, "no cache lifetime to size the lead from"],
  ]) assert.deepEqual(planPing(base(o)), { skip: "invalid" }, why);
});

test("the lifetime fallback counts the reported expiry from the request start", () => {
  // No ttl: the lifetime is expiry minus the request start (304 s), so the lead is 60.8 s.
  const snapshot = { ...sonnetSnap(), ttlSec: null, startAt: T0 - 4000, expiresAt: T0 + 300_000 };
  assert.deepEqual(planPing(base({ snapshot })), { at: T0 + 300_000 - 60_800 });
});

test("keepWarmEstimate counts pings and their cost for a window", () => {
  const e = keepWarmEstimate(sonnetSnap(), 8);
  assert.equal(e.pings, 120);
  assert.ok(Math.abs(e.usd - 2.4) < 1e-9);
  assert.equal(keepWarmEstimate({ ...sonnetSnap(), ttlSec: null }, 8), null);
  assert.equal(keepWarmEstimate(null, 8), null, "no model call yet");
});

test("keepWarmEstimate stops where the budget and payback stop would, and has no answer for a ttl it cannot ping", () => {
  const capped = keepWarmEstimate(sonnetSnap(), 8, C);
  assert.deepEqual([capped.pings, Math.round(capped.usd * 100)], [24, 48], "payback ends it first at 200k tokens");
  const budget = keepWarmEstimate(sonnetSnap(), 8, { ...C, keepWarmPayback: false, keepWarmMaxUsd: 0.1 });
  assert.deepEqual([budget.pings, Math.round(budget.usd * 100)], [5, 10]);
  const short = keepWarmEstimate(sonnetSnap(), 1, C);
  assert.equal(short.pings, 15, "a short window is the limit when it is shorter than the caps");
  assert.equal(keepWarmEstimate(sonnetSnap(), 8, { ...C, keepWarmMaxUsd: 0 }).pings, 0);
  assert.equal(keepWarmEstimate({ ...sonnetSnap(), ttlSec: 20 }, 8), null, "a 20 s cache leaves no room for a ping interval");
  assert.equal(keepWarmEstimate({ ...sonnetSnap(), warmUsd: 0 }, 1, C).pings, 15, "a free ping is limited by the window only");
});

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

test("a ping with no reply for 2 minutes counts as a failed send", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(4 * MIN);
  assert.equal(r.kw.status().inFlight, true);
  await r.run(2 * MIN);
  assert.equal(r.kw.status().inFlight, false);
  assert.ok(r.logs.some((l) => /keep-warm ping failed/.test(l.text)));
});

test("an unmeasured ping stops it, because the budget cannot be enforced", async () => {
  const q = rig({ send: async () => { q.sent += 1; queueMicrotask(() => { q.kw.onPingUsage({ usd: null, warm: true }); q.kw.onIdle(); }); } }); q.turn();
  await q.run(HOUR);
  assert.equal(q.sent, 1);
  assert.equal(q.kw.status().stopped, "unmeasured");
  assert.equal(q.logs.at(-1).severity, "warn");
});

test("no pings while busy or on Auto, and they resume on idle", async () => {
  const r = rig({ session: { busy: true } }); r.turn(); await r.run(3 * MIN);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().lastSkip, "busy");
  r.session.busy = false; r.kw.onIdle(); await r.run(2 * MIN);
  assert.equal(r.sent, 1);
  const a = rig({ session: { selectedModel: "auto" } }); a.turn(); await a.run(10 * MIN);
  assert.equal(a.sent, 0);
  assert.equal(a.kw.status().lastSkip, "auto");
});

test("shutdown clears every timer", async () => {
  const r = rig(); r.turn(); await r.run(5 * MIN);
  r.kw.stop("shutdown"); await r.run(HOUR);
  assert.equal(r.sent, 1);
  assert.ok(r.timers.every((t) => t.cleared || t.fired));
});

test("a late wake after sleep sends nothing when the cache went cold", async () => {
  const r = rig(); r.turn(); await r.run(4 * MIN);
  assert.equal(r.sent, 1);
  await r.run(40 * MIN, 40 * MIN);
  assert.equal(r.sent, 1);
  assert.equal(r.kw.status().lastSkip, "not-warm");
  r.now += 3 * HOUR;
  const s = r.kw.status();
  assert.deepEqual([s.state, s.stopped, s.msLeft], ["stopped", "window-end", 0]);
});

test("a store that cannot save never breaks keep-warm", async () => {
  const r = rig({ store: { ...memoryStore(), save: () => { throw new Error("EACCES"); } } });
  assert.doesNotThrow(() => r.turn());
  await r.run(9 * MIN);
  assert.equal(r.sent, 2);
  assert.equal(r.logs.filter((l) => /could not save the keep-warm window \(EACCES\)/.test(l.text)).length, 1);
});

test("a reload resumes the window, its spend and its stop", async () => {
  const store = memoryStore();
  const r1 = rig({ store, config: { keepWarmMaxUsd: 5 } }); r1.turn(); await r1.run(40 * MIN);
  assert.equal(r1.sent, 10);
  const r2 = rig({ store, config: { keepWarmMaxUsd: 5 } });
  r2.now = r1.now; r2.clock.ingest(normalizeUsage(pingUsage({ at: iso(r2.now) }), r2.now)); r2.kw.reschedule();
  await r2.run(3 * HOUR);
  assert.equal(r1.sent + r2.sent, 24);
  const r3 = rig({ store, config: { keepWarmMaxUsd: 5 } }); r3.now = r2.now;
  await r3.run(HOUR);
  assert.equal(r3.sent, 0);
});

test("a lock held by another process means no ping", async () => {
  const r = rig({ store: memoryStore({ locked: true }) }); r.turn(); await r.run(4 * MIN);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().lastSkip, "locked");
  await r.run(30 * MIN);
  assert.equal(r.sent, 0);
});

test("a lock that throws counts as held", async () => {
  const r = rig({ store: { ...memoryStore(), lock: () => { throw new Error("EROFS"); } } }); r.turn(); await r.run(4 * MIN);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().lastSkip, "locked");
});

test("with keep-warm off the store is never touched", async () => {
  const calls = [];
  const spy = Object.fromEntries(["load", "save", "lock", "unlock"].map((k) => [k, () => { calls.push(k); throw new Error("touched"); }]));
  const r = rig({ store: spy, config: { keepWarmHours: 0 } }); r.turn(); await r.run(10 * MIN);
  r.kw.stop("shutdown");
  assert.deepEqual(calls, []);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().state, "off");
});

test("a settings change recomputes the window end, and turning it off clears the window", async () => {
  const r = rig(); r.turn();
  r.config = { ...r.config, keepWarmHours: 5 }; r.kw.configChanged();
  assert.equal(r.kw.status().msLeft, 5 * HOUR);
  r.config = { ...r.config, keepWarmHours: 0 }; r.kw.configChanged();
  await r.run(10 * MIN);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().state, "off");
  r.config = { ...r.config, keepWarmHours: 2 }; r.kw.configChanged();
  assert.equal(r.kw.status().msLeft, 2 * HOUR - 10 * MIN, "restarts from the last model call");
});
