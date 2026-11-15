import { test } from "node:test";
import assert from "node:assert/strict";
import { isPingPrompt, isPingMessage, createPingLedger, looksLikePing, PING_MAX_OUTPUT_TOKENS, PING_DISPLAY, PING_PROMPT, leadMs, minGapMs, planPing, keepWarmEstimate, createKeepWarm } from "../extension/lib/keepwarm.mjs";
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
  // "p" is a usage record that looks like a ping's (tiny output), "u" one that does not.
  const run = (steps) => {
    const l = createPingLedger();
    return steps.flatMap((s) => {
      if (s === "ping" || s === "real") { l.onMessage(s === "ping" ? ping : real); return []; }
      return [l.onUsage(s === "p")];
    });
  };
  assert.deepEqual(run(["real", "u", "u", "ping", "p", "real", "u"]), [false, false, true, false]);
  assert.deepEqual(run(["ping", "real", "p", "u"]), [true, false], "a message typed while the ping ran does not steal its record");
  assert.deepEqual(run(["u"]), [false], "a record with no message before it is a real call");
  assert.deepEqual(run(["ping", "p", "u"]), [true, false], "a ping has one record; a second is not a ping");
  assert.deepEqual(run(["real", "u", "ping", "real", "u", "u"]), [false, false, false], "a ping message with no usage does not turn the next user call into a ping");
  assert.deepEqual(run(["ping", "real", "u"]), [false], "a big record after a ping message and a user message is the user's");
  assert.deepEqual(run(["real", "p"]), [false], "a ping-sized record with no ping message before it is a real call");
});

test("a ping-sized usage record has almost no output", () => {
  assert.equal(PING_MAX_OUTPUT_TOKENS, 30);
  assert.ok(looksLikePing({ outputTokens: 1 }) && looksLikePing({ outputTokens: 30 }));
  assert.ok(!looksLikePing({ outputTokens: 31 }) && !looksLikePing({ outputTokens: 112 }));
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
    [{ session: { ...S, busy: true } }, "busy"], [{ session: { ...S, pendingPrompt: true } }, "busy"], [{ session: { ...S, questionOpen: true } }, "question-open"],
    [{ snapshot: { ...sonnetSnap(), maxPromptTokens: 230_000 } }, "context-full"], [{ window: { endsAt: T0 + 239_999 } }, "window-ended"],
    [{ snapshot: { ...sonnetSnap(), warmUsd: null } }, "unpriced"],
    [{ spend: { usd: 0.49, pings: 0 }, config: { ...C, keepWarmPayback: false } }, "budget"], [{ spend: { usd: 0.47, pings: 0 } }, "payback"],
  ]) assert.deepEqual(planPing(base(o)), { skip }, skip);
});

test("minGapMs is the cache lifetime minus the lead, never under 60 s", () => {
  assert.deepEqual([300_000, 1_800_000, 60_000, 20_000].map(minGapMs), [240_000, 1_440_000, 60_000, 60_000]);
});

test("planPing never pings again inside the minimum gap", () => {
  const w = (lastSendAt) => ({ startedAt: T0, endsAt: T0 + 3 * HOUR, lastSendAt });
  assert.deepEqual(planPing(base({ window: w(T0 - 10_000) })), { at: T0 + 240_000 }, "a send 10 s before the turn is old enough");
  assert.deepEqual(planPing(base({ window: w(T0 + 10_000) })), { at: T0 + 250_000 }, "10 s after the start pushes the next ping to 250 s");
  assert.deepEqual(planPing(base({ window: w(T0 + 100_000) })), { skip: "too-late" }, "a gap that runs past the expiry leaves no time to refresh it");
});

test("planPing does not ping with less than 15 s left on the cache", () => {
  assert.deepEqual(planPing(base({ now: T0 + 284_000, snapshot: sonnetSnap(T0 + 284_000) })), { at: T0 + 284_000 });
  assert.deepEqual(planPing(base({ now: T0 + 285_001, snapshot: sonnetSnap(T0 + 285_001) })), { skip: "too-late" });
});

test("planPing stops a window at its ping cap, ceil(window / minimum gap) + 1", () => {
  const w = { startedAt: T0, endsAt: T0 + 3 * HOUR };
  assert.deepEqual(planPing(base({ window: w, spend: { usd: 0, pings: 45 } })), { at: T0 + 240_000 });
  assert.deepEqual(planPing(base({ window: w, spend: { usd: 0, pings: 46 } })), { skip: "ping-cap" });
  assert.deepEqual(planPing(base({ window: { startedAt: T0, endsAt: T0 + HOUR }, spend: { usd: 0, pings: 16 } })), { skip: "ping-cap" }, "a one-hour window allows ceil(15) + 1 = 16");
});

test("planPing budgets the larger of the estimate and the last measured ping cost", () => {
  assert.deepEqual(planPing(base({ spend: { usd: 0.4, pings: 20, lastUsd: 0.02 } })), { at: T0 + 240_000 });
  assert.deepEqual(planPing(base({ spend: { usd: 0.4, pings: 20, lastUsd: 0.09 } })), { skip: "payback" }, "pings turned out to cost more than the estimate");
  assert.deepEqual(planPing(base({ config: { ...C, keepWarmPayback: false }, spend: { usd: 0.4, pings: 20, lastUsd: 0.11 } })), { skip: "budget" });
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

test("a send that fails with no usage stops it once, after the watchdog, and is never retried", async () => {
  let tries = 0;
  const r = rig({ send: async () => { tries += 1; throw new Error("host gone"); } }); r.turn();
  await r.run(4 * MIN + 60_000);
  assert.equal(r.kw.status().inFlight, true, "a rejected send may still have gone out: it waits for a usage event");
  assert.ok(!r.logs.some((l) => /ping failed/.test(l.text)), "not a failure yet");
  await r.run(HOUR);
  assert.equal(tries, 1);
  assert.equal(r.kw.status().stopped, "send-failed");
  assert.ok(r.logs.some((l) => /keep-warm ping failed \(host gone\)/.test(l.text)));
});

test("a ping with no reply for 2 minutes counts as a failed send", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(4 * MIN);
  assert.equal(r.kw.status().inFlight, true);
  await r.run(2 * MIN);
  assert.equal(r.kw.status().inFlight, false);
  assert.ok(r.logs.some((l) => /keep-warm ping failed/.test(l.text)));
});

test("a ping reply that arrives after the watchdog still counts as spend, once", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  assert.deepEqual([r.kw.status().inFlight, r.kw.status().awaitingReply], [false, true]);
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  const s = r.kw.status();
  assert.deepEqual([s.pings, s.usd, s.awaitingReply], [1, 0.02, false]);
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  assert.equal(r.kw.status().pings, 1, "nothing is owed any more, so a second record is not a ping's");
});

test("a late reply is booked on the window that gave up on the ping: it already stopped as send-failed, with no second note", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  assert.equal(r.kw.status().stopped, "send-failed");
  const notes = r.logs.length;
  r.kw.onPingUsage({ usd: 0.02, warm: false });
  assert.deepEqual([r.kw.status().usd, r.kw.status().stopped, r.logs.length], [0.02, "send-failed", notes]);
});

test("a late reply after the window already stopped is booked, without a second stop note", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  r.kw.stop("budget");
  const notes = r.logs.length;
  r.kw.onPingUsage({ usd: 0.02, warm: false });
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  assert.deepEqual([r.kw.status().pings, r.kw.status().usd, r.kw.status().stopped, r.logs.length], [1, 0.02, "budget", notes]);
});

test("a late reply is only expected for ten minutes", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  await r.run(11 * MIN);
  assert.equal(r.kw.status().awaitingReply, false);
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  assert.equal(r.kw.status().pings, 0);
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

// A host's answer to a ping, as the wiring files it: clock first, then the scheduler.
const pingReply = (r, { usageOnly = false, ttl = 300 } = {}) => {
  const call = normalizeUsage(pingUsage({ at: iso(r.now), ttl }), r.now);
  const { kind } = r.clock.ingestPing(call);
  r.kw.onPingUsage({ usd: call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" });
  if (!usageOnly) r.kw.onIdle();
};

test("a ping's turn that ends with no usage stops keep-warm as unmeasured, after one send", async () => {
  const r = rig({ send: async () => { r.sent += 1; queueMicrotask(() => r.kw.onIdle(true)); } }); r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 1);
  assert.equal(r.kw.status().stopped, "unmeasured");
  assert.equal(r.logs.at(-1).severity, "warn");
});

test("an idle that is not the ping's own turn leaves the ping in flight", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(4 * MIN);
  r.kw.onIdle(false);
  assert.equal(r.kw.status().inFlight, true);
  r.kw.onIdle(true);
  assert.equal(r.kw.status().stopped, "unmeasured", "its own turn ended and no usage came");
});

test("a reply that does not move the expiry forward stops it as not-refreshing", async () => {
  const r = rig({ send: async () => {
    r.sent += 1;
    queueMicrotask(() => {
      const call = normalizeUsage({ ...pingUsage({ at: iso(r.now) }), cacheExpiresAt: iso(T0 + 5 * MIN) }, r.now);
      const { kind } = r.clock.ingestPing(call);
      r.kw.onPingUsage({ usd: call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" });
      r.kw.onIdle();
    });
  } }); r.turn();
  await r.run(HOUR, 1000);
  assert.equal(r.sent, 1);
  assert.equal(r.kw.status().stopped, "not-refreshing");
});

test("a 60 s cache is pinged once and then given up on: the gap leaves no time to refresh it", async () => {
  const r = rig({ send: async () => { r.sent += 1; queueMicrotask(() => pingReply(r, { ttl: 60 })); } });
  r.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(T0), ttl: 60, input: 200_000, read: 0, write: 200_000, output: 0 }), T0));
  r.kw.onUserTurn(T0);
  await r.run(10 * MIN, 1000);
  assert.equal(r.sent, 1);
  assert.equal(r.kw.status().stopped, "too-late");
});

test("a window stops at its ping cap", async () => {
  const store = memoryStore();
  store.save({ startedAt: T0, endsAt: T0 + 3 * HOUR, usd: 0.1, pings: 46, stopped: null });
  const r = rig({ store });
  r.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(T0), ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), T0));
  r.kw.reschedule();
  assert.equal(r.kw.status().stopped, "ping-cap");
  assert.match(r.logs.at(-1).text, /ping limit for this window/);
});

test("each send is recorded before it goes out, with its cost afterwards", async () => {
  const store = memoryStore();
  const r = rig({ store, send: async () => { throw new Error("rpc down"); } }); r.turn();
  await r.run(4 * MIN);
  assert.equal(store.load().lastSendAt, T0 + 4 * MIN, "the attempt is on record though the send rejected");
  const ok = rig({ store: memoryStore() }); ok.turn();
  await ok.run(4 * MIN);
  assert.ok(Math.abs(ok.kw.status().usd - 0.02) < 1e-12);
});

test("a rejected send whose usage still arrives is a ping, not a failure, and is never retried at once", async () => {
  const r = rig({ send: async () => { r.sent += 1; queueMicrotask(() => pingReply(r)); throw new Error("rpc timeout"); } }); r.turn();
  await r.run(30 * MIN);
  assert.equal(r.sent, 7);
  assert.equal(r.kw.status().pings, 7);
  assert.ok(!r.logs.some((l) => /ping failed/.test(l.text)));
});

test("a real message typed while a ping is in flight neither zeroes the spend nor restarts the window until the ping is done", async () => {
  let n = 0;
  const r = rig({ send: async () => { n += 1; r.sent += 1; if (n === 1) queueMicrotask(() => pingReply(r)); } }); r.turn();
  await r.run(8 * MIN);
  assert.deepEqual([r.kw.status().pings, r.kw.status().inFlight], [1, true]);
  const spent = r.kw.status().usd;
  r.kw.onUserTurn(r.now);
  const mid = r.kw.status();
  assert.deepEqual([mid.pings, mid.usd, mid.msLeft], [1, spent, 3 * HOUR - 8 * MIN], "no restart, no reset while the ping is out");
  r.clock.ingestPing(normalizeUsage(pingUsage({ at: iso(r.now) }), r.now));
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  const done = r.kw.status();
  assert.deepEqual([done.pings, done.usd, done.msLeft], [0, 0, 3 * HOUR], "the real message's window starts when the ping is done");
});

test("a real turn clears the late-reply debt, so a later record is not booked as a late ping", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  assert.equal(r.kw.status().awaitingReply, true);
  r.kw.onUserTurn(r.now);
  assert.equal(r.kw.status().awaitingReply, false);
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  assert.equal(r.kw.status().pings, 0);
});

test("a ping that ends with its usage, and no idle, is not a failed send; later records in its turn add spend", async () => {
  const r = rig({ send: async () => { r.sent += 1; queueMicrotask(() => pingReply(r, { usageOnly: true })); } }); r.turn();
  await r.run(4 * MIN + 60_000);
  assert.equal(r.kw.status().inFlight, false);
  assert.ok(!r.logs.some((l) => /ping failed/.test(l.text)), "the watchdog does not fire for a ping that was answered");
  r.kw.onPingUsage({ usd: 0.01, warm: true });
  assert.deepEqual([r.kw.status().pings, Math.round(r.kw.status().usd * 100)], [1, 3], "a second call inside the ping's turn adds its cost, not a ping");
  r.kw.onIdle(true);
  r.kw.onPingUsage({ usd: 0.01, warm: true });
  assert.equal(Math.round(r.kw.status().usd * 100), 3, "after the turn ends nothing more is the ping's");
  await r.run(10 * MIN);
  assert.ok(r.sent >= 3 && !r.logs.some((l) => /ping failed/.test(l.text)), "no watchdog failure for pings that were answered, with or without an idle");
});

test("an open question that blocks pinging for a whole cache lifetime is said out loud, once", async () => {
  const r = rig({ session: { questionOpen: true } }); r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 0);
  assert.equal(r.logs.filter((l) => /waiting on an open question/.test(l.text)).length, 1);
  assert.equal(r.kw.status().waitingOnQuestion, true);
  r.session.questionOpen = false;
  r.kw.reschedule();
  assert.equal(r.kw.status().waitingOnQuestion, false);
});

test("turning keep-warm on with an old last call waits for the next message instead of reporting an ended window", async () => {
  const r = rig({ config: { keepWarmHours: 0 } }); r.turn();
  r.now += 4 * HOUR;
  r.config = { ...r.config, keepWarmHours: 3 };
  r.kw.configChanged();
  assert.equal(r.kw.status().state, "waiting");
  assert.ok(!r.logs.some((l) => /window ended/.test(l.text)));
});

test("turning keep-warm off clears the stored window, so off then on is a fresh start with or without a reload", async () => {
  let cleared = 0;
  const r = rig({ store: { ...memoryStore(), clear() { cleared += 1; } } }); r.turn();
  r.config = { ...r.config, keepWarmHours: 0 };
  r.kw.configChanged();
  assert.equal(cleared, 1);
});

test("the window records the measured cost of the last ping, for the next budget check", async () => {
  const store = memoryStore();
  const r = rig({ store }); r.turn();
  await r.run(4 * MIN);
  assert.ok(Math.abs(store.load().lastPingUsd - 0.02) < 1e-12);
});
