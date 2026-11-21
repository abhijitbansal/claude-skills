import { test } from "node:test";
import assert from "node:assert/strict";
import { isPingPrompt, isPingMessage, createPingLedger, PING_DISPLAY, PING_PROMPT, leadMs, minGapMs, planPing, keepWarmEstimate, createKeepWarm } from "../extension/lib/keepwarm.mjs";
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

test("a record is the ping's only if it is the first root record after the ping message and before any later user message", () => {
  const ping = { content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" };
  const real = { content: "carry on" };
  const run = (steps) => {
    const l = createPingLedger();
    return steps.flatMap((s) => {
      if (s === "ping" || s === "real") { l.onMessage(s === "ping" ? ping : real); return []; }
      return [l.onUsage()];
    });
  };
  assert.deepEqual(run(["real", "u", "u", "ping", "u", "real", "u"]), [false, false, true, false]);
  assert.deepEqual(run(["ping", "u", "u"]), [true, false], "a ping has one record; a second is not a ping");
  assert.deepEqual(run(["ping", "real", "u", "u"]), [false, false], "a user message after the ping message ends its claim");
  assert.deepEqual(run(["real", "u", "ping", "real", "u"]), [false, false], "a ping message that got no record claims nothing");
  assert.deepEqual(run(["u"]), [false], "a record with no message before it is a real call");
  assert.deepEqual(run(["ping", "ping", "u", "u"]), [true, false], "two ping messages in a row are still one pending ping");
});

const HOUR = 60 * MIN;
const sonnetSnap = (now = T0) => { const c = createClock(); c.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), T0)); return c.snapshot(now, "claude-sonnet-5.5"); };
const S = { busy: false, pendingPrompt: false, questionOpen: false, selectedModel: "claude-sonnet-5.5" };
const C = { keepWarmHours: 3, keepWarmMaxUsd: 0.5, keepWarmPayback: true, keepWarmDailyMaxUsd: 2 };
const base = (o = {}) => ({ snapshot: sonnetSnap(), config: C, window: { endsAt: T0 + 3 * HOUR }, spend: { usd: 0, pings: 0 }, daily: { pings: 0, usd: 0 }, session: S, now: T0, ...o });

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

test("planPing refuses a send that would take the last 24 hours past the daily spend limit or twice a 12 hour window's ping cap", () => {
  assert.deepEqual(planPing(base({ daily: { pings: 10, usd: 1.97 } })), { at: T0 + 240_000 }, "1.97 + a $0.02 ping is under $2.00");
  assert.deepEqual(planPing(base({ daily: { pings: 10, usd: 1.99 } })), { skip: "daily-limit" });
  assert.deepEqual(planPing(base({ daily: { pings: 10, usd: 1.99 }, config: { ...C, keepWarmDailyMaxUsd: 5 } })), { at: T0 + 240_000 }, "the limit is a setting");
  assert.deepEqual(planPing(base({ daily: { pings: 361, usd: 0.1 } })), { at: T0 + 240_000 }, "2 x (ceil(12 h / 240 s) + 1) = 362 pings in 24 h");
  assert.deepEqual(planPing(base({ daily: { pings: 362, usd: 0.1 } })), { skip: "daily-limit" });
  assert.deepEqual(planPing(base({ daily: { pings: 5, usd: 1.9 }, spend: { usd: 0, pings: 0, lastUsd: 0.2 } })), { skip: "daily-limit" }, "the larger measured ping cost counts here too");
});

test("planPing refuses numbers it cannot compare instead of letting a NaN fall through", () => {
  for (const [o, why] of [
    [{ config: { ...C, keepWarmMaxUsd: Number.NaN } }, "NaN budget"], [{ config: { ...C, keepWarmMaxUsd: undefined } }, "missing budget"],
    [{ spend: { usd: Number.NaN, pings: 0 } }, "NaN spend"], [{ spend: { usd: undefined, pings: 0 } }, "missing spend"],
    [{ daily: null }, "no ledger"], [{ daily: { pings: Number.NaN, usd: 0 } }, "NaN ledger pings"], [{ config: { ...C, keepWarmDailyMaxUsd: undefined } }, "missing daily limit"],
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
// A store in memory. `locked` makes another process hold the lock; the ledger is shared by whoever uses the store.
const memoryStore = ({ locked = false } = {}) => {
  let w = null;
  let n = 0;
  let noteAt = null;
  const entries = new Map();
  return {
    load: () => w, save: (x) => { w = x; }, lock: () => !locked, unlock() {},
    ledgerSend: (at, usd) => { n += 1; entries.set(n, { at, usd }); return n; },
    ledgerCost: (id, usd) => { if (entries.has(id)) entries.set(id, { ...entries.get(id), usd }); },
    ledgerNote: (at) => { noteAt = at; },
    ledger: (now) => {
      const live = [...entries.values()].filter((e) => e.at >= now - 24 * HOUR);
      return { pings: live.length, usd: live.reduce((sum, e) => sum + e.usd, 0), noteAt };
    },
  };
};
const ledgerOf = (store, now) => { const { pings, usd } = store.ledger(now); return { pings, usd: Math.round(usd * 1000) / 1000 }; };
function rig({ config = {}, reply = () => "warm", send, store = memoryStore(), session = {} } = {}) {
  const r = { now: T0, timers: [], sent: 0, logs: [], clock: createClock(), session: { ...S, ...session }, config: { ...C, ...config } };
  const answer = () => { const call = normalizeUsage(pingUsage({ at: iso(r.now), read: reply(r.sent) === "warm" ? 200_000 : 10_000 }), r.now);
    const { kind } = r.clock.ingestPing(call); r.kw.onPingUsage({ usd: call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" }); r.kw.onIdle(); };
  r.kw = createKeepWarm({ send: send ?? (async () => { r.sent += 1; queueMicrotask(answer); }),
    read: () => ({
      snapshot: r.clock.snapshot(r.now, r.session.selectedModel), config: r.config,
      session: { ...r.session, pendingPrompt: Boolean(r.session.pendingPrompt) || r.now < (r.session.pendingUntil ?? 0) },
    }),
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

test("a settings change can shorten a running window but never extend it; off and on again resumes the same window", async () => {
  const r = rig(); r.turn();
  r.config = { ...r.config, keepWarmHours: 5 }; r.kw.configChanged();
  assert.equal(r.kw.status().msLeft, 3 * HOUR, "raising the hours does not extend a window that already started");
  r.config = { ...r.config, keepWarmHours: 0 }; r.kw.configChanged();
  await r.run(10 * MIN);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().state, "off");
  r.config = { ...r.config, keepWarmHours: 2 }; r.kw.configChanged();
  assert.equal(r.kw.status().msLeft, 2 * HOUR - 10 * MIN, "on again keeps the window that was running, now capped by the new hours");
});

// A host's answer to a ping, as the wiring files it: clock first, then the scheduler.
const pingReply = (r, { usageOnly = false, ttl = 300, nanoAiu = 2e9 } = {}) => {
  const call = normalizeUsage(pingUsage({ at: iso(r.now), ttl, nanoAiu }), r.now);
  const { kind } = r.clock.ingestPing(call);
  r.kw.onPingUsage({ usd: call.nanoAiu === null ? null : call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" });
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

test("a cache lifetime under 5 minutes stops keep-warm before any ping: it would cost more than it saves", async () => {
  const r = rig({ send: async () => { r.sent += 1; queueMicrotask(() => pingReply(r, { ttl: 60 })); } });
  r.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(T0), ttl: 60, input: 200_000, read: 0, write: 200_000, output: 0 }), T0));
  r.kw.onUserTurn(T0);
  await r.run(10 * MIN, 1000);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().stopped, "lifetime-too-short");
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

test("a confirmed turn that reaches the scheduler while a ping is out is dropped, not deferred", async () => {
  let n = 0;
  const r = rig({ send: async () => { n += 1; r.sent += 1; if (n === 1) queueMicrotask(() => pingReply(r)); } }); r.turn();
  await r.run(8 * MIN);
  assert.deepEqual([r.kw.status().pings, r.kw.status().inFlight], [1, true]);
  r.kw.onUserTurn(r.now);
  r.clock.ingestPing(normalizeUsage(pingUsage({ at: iso(r.now) }), r.now));
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  const done = r.kw.status();
  assert.deepEqual([done.pings, Math.round(done.usd * 100), done.msLeft], [2, 4, 3 * HOUR - 8 * MIN], "the ping is booked on its own window, which nothing restarted");
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

test("the window records the measured cost of the last ping, for the next budget check", async () => {
  const store = memoryStore();
  const r = rig({ store }); r.turn();
  await r.run(4 * MIN);
  assert.ok(Math.abs(store.load().lastPingUsd - 0.02) < 1e-12);
});

// One store for two schedulers, with a lock that has an owner and can be abandoned.
function sharedStores() {
  const base = memoryStore();
  const state = { holder: null, dead: new Set() };
  const store = (id) => ({
    ...base,
    lock: () => {
      if (state.holder === null || state.holder === id || state.dead.has(state.holder)) { state.holder = id; return true; }
      return false;
    },
    unlock() { if (state.holder === id) state.holder = null; },
  });
  return { base, state, store };
}

test("only the process that holds the lock keeps keep-warm state; a new holder adopts the stored window and ledger as they are", async () => {
  const shared = sharedStores();
  const a = rig({ store: shared.store("A") }); a.turn();
  const b = rig({ store: shared.store("B") });
  await a.run(30 * MIN);
  assert.equal(a.sent, 7);
  // B sees the same session: the same calls, a later clock.
  b.now = a.now;
  b.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(T0), ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), T0));
  b.clock.ingestPing(normalizeUsage(pingUsage({ at: iso(T0 + 28 * MIN) }), T0 + 28 * MIN));
  b.kw.onUserTurn(b.now);
  b.kw.reschedule();
  assert.equal(b.kw.status().state, "elsewhere");
  assert.equal(shared.base.load().startedAt, T0, "B did not start a window of its own");
  await b.run(MIN);
  assert.equal(b.sent, 0, "B never pings while A holds the lock");
  shared.state.dead.add("A");
  b.kw.reschedule();
  const adopted = b.kw.status();
  assert.deepEqual([adopted.state, adopted.pings, Math.round(adopted.usd * 100), adopted.msLeft], ["on", 7, 14, 3 * HOUR - 31 * MIN], "the window, its spend and its count carry over");
  await b.run(2 * MIN);
  assert.ok(b.sent >= 1 && b.kw.status().pings === 7 + b.sent, "and the pings go on from them");
});

test("the 24-hour ledger stops pings when every window and budget has been reset", async () => {
  const store = memoryStore();
  const cfg = { keepWarmPayback: false, keepWarmMaxUsd: 5, keepWarmDailyMaxUsd: 0.1 };
  const r = rig({ store, config: cfg }); r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 5, "$0.02 each: the sixth would take the day past $0.10");
  assert.equal(r.kw.status().stopped, "daily-limit");
  r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 5, "a new window, with a new budget, does not clear the ledger");
  r.config = { ...r.config, keepWarmHours: 0 }; r.kw.configChanged();
  r.config = { ...r.config, keepWarmHours: 3 }; r.kw.configChanged();
  r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 5, "off then on does not either");
  const reloaded = rig({ store, config: cfg }); reloaded.turn();
  await reloaded.run(HOUR);
  assert.equal(reloaded.sent, 0, "nor does a reload, or another process");
  assert.equal(reloaded.kw.status().stopped, "daily-limit");
  r.now += 25 * HOUR;
  assert.equal(store.ledger(r.now).pings, 0, "only the passage of time removes entries");
});

test("a ping nobody answers is in the ledger at the cold-rewrite cost; measured usage replaces it, but never with less than the estimate", async () => {
  const store = memoryStore();
  const r = rig({ store, send: async () => { r.sent += 1; } }); r.turn();
  await r.run(4 * MIN);
  assert.deepEqual(ledgerOf(store, r.now), { pings: 1, usd: 0.5 }, "unattributed: the whole 200k context rewritten at $2.50/M");
  r.kw.stop("shutdown");
  assert.deepEqual(ledgerOf(store, r.now), { pings: 1, usd: 0.5 }, "and it stays there through a shutdown");
  for (const [nanoAiu, expected] of [[3e9, 0.03], [2e9, 0.02], [0, 0.02]]) {
    const s2 = memoryStore();
    const q = rig({ store: s2, send: async () => { q.sent += 1; queueMicrotask(() => pingReply(q, { nanoAiu })); } }); q.turn();
    await q.run(4 * MIN);
    assert.deepEqual(ledgerOf(s2, q.now), { pings: 1, usd: expected }, `measured ${nanoAiu}: the ledger holds max(estimate $0.02, measured)`);
  }
  const s3 = memoryStore();
  const n = rig({ store: s3, send: async () => { n.sent += 1; queueMicrotask(() => pingReply(n, { nanoAiu: null })); } }); n.turn();
  await n.run(4 * MIN);
  assert.equal(n.kw.status().stopped, "unmeasured");
  assert.deepEqual(ledgerOf(s3, n.now), { pings: 1, usd: 0.5 }, "a cost that was never reported keeps the cold-rewrite entry");
});

test("the window end is the earlier of the stored end and the start plus the current hours: lowering shortens a running window, raising never extends it", async () => {
  const r = rig({ config: { keepWarmHours: 12, keepWarmPayback: false, keepWarmMaxUsd: 5 } }); r.turn();
  await r.run(10 * MIN);
  r.config = { ...r.config, keepWarmHours: 1 };
  await r.run(3 * HOUR);
  assert.ok(r.sent <= 15, `one hour allows at most 15 pings, not ${r.sent}`);
  assert.equal(r.kw.status().stopped, "window-end");
  const q = rig({ config: { keepWarmHours: 1, keepWarmPayback: false, keepWarmMaxUsd: 5 } }); q.turn();
  q.config = { ...q.config, keepWarmHours: 12 };
  await q.run(3 * HOUR);
  assert.ok(q.sent <= 15 && q.kw.status().stopped === "window-end", "raising the hours does not extend a window that has started");
});

test("a skip for a prompt that has not started arms a timer for when that flag expires, and willPing is true only while a ping is planned", async () => {
  const r = rig({ session: { pendingUntil: T0 + 20_000 } }); r.turn();
  const held = r.kw.status();
  assert.deepEqual([held.lastSkip, held.armed, held.willPing], ["busy", true, false], "something is armed, but it is not a ping");
  await r.run(30_000);
  const planned = r.kw.status();
  assert.deepEqual([planned.lastSkip, planned.willPing], [null, true], "once the flag expires the ping is planned");
  await r.run(4 * MIN);
  assert.equal(r.sent, 1);
});

test("a ping's usage that arrives after its idle is still added to spend, though keep-warm stopped as unmeasured", async () => {
  const store = memoryStore();
  const r = rig({ store, send: async () => { r.sent += 1; queueMicrotask(() => r.kw.onIdle(true)); } }); r.turn();
  await r.run(4 * MIN);
  assert.equal(r.kw.status().stopped, "unmeasured");
  r.clock.ingestPing(normalizeUsage(pingUsage({ at: iso(r.now) }), r.now));
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  assert.deepEqual([r.kw.status().pings, r.kw.status().usd, r.kw.status().stopped], [1, 0.02, "unmeasured"]);
  assert.deepEqual(ledgerOf(store, r.now), { pings: 1, usd: 0.02 });
});

test("turning keep-warm off while a ping is out clears the watchdog and prints nothing afterwards", async () => {
  const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
  await r.run(4 * MIN);
  const logged = r.logs.length;
  r.config = { ...r.config, keepWarmHours: 0 };
  r.kw.configChanged();
  assert.equal(r.kw.status().inFlight, false);
  await r.run(10 * MIN);
  r.kw.onPingUsage({ usd: 0.02, warm: false });
  assert.equal(r.logs.length, logged, "no failure, stop or cold-reply line after it was turned off");
});

test("off then on after a budget stop is the same stopped window: a fresh one needs a confirmed user turn", async () => {
  const r = rig({ config: { keepWarmPayback: false, keepWarmMaxUsd: 0.04 } }); r.turn();
  await r.run(HOUR);
  assert.deepEqual([r.sent, r.kw.status().stopped], [2, "budget"]);
  r.config = { ...r.config, keepWarmHours: 0 }; r.kw.configChanged();
  r.config = { ...r.config, keepWarmHours: 3 }; r.kw.configChanged();
  const again = r.kw.status();
  assert.deepEqual([again.state, again.stopped, again.pings], ["stopped", "budget", 2], "no fresh window and no fresh budget");
  await r.run(HOUR);
  assert.equal(r.sent, 2);
  r.kw.onUserTurn(r.now);
  assert.deepEqual([r.kw.status().state, r.kw.status().pings], ["on", 0], "a confirmed user turn starts one");
});

test("a model change or compaction while a ping is out stops it with its own reason, and the late reply is still booked", async () => {
  for (const reason of ["model-changed", "compacted"]) {
    const r = rig({ send: async () => { r.sent += 1; } }); r.turn();
    await r.run(4 * MIN);
    r.kw.onContextChange(reason);
    assert.equal(r.kw.status().stopped, reason);
    assert.equal(r.kw.status().inFlight, false);
    r.kw.onPingUsage({ usd: 0.02, warm: true });
    assert.equal(r.kw.status().pings, 1, `${reason}: the reply to the ping that was out is still counted`);
  }
  const idle = rig({ send: async () => {} }); idle.turn();
  idle.kw.onContextChange("model-changed");
  assert.equal(idle.kw.status().stopped, null, "with no ping out a context change is just a replan");
});

test("a cache lifetime that changes between pings recomputes the gap and is not a refresh failure", async () => {
  const ttls = [1800, 300];
  const r = rig({ config: { keepWarmPayback: false, keepWarmMaxUsd: 5 }, send: async () => {
    r.sent += 1;
    const ttl = ttls[r.sent - 1] ?? 300;
    queueMicrotask(() => pingReply(r, { ttl }));
  } }); r.turn();
  await r.run(40 * MIN);
  assert.ok(r.sent >= 3, `pings went on across the change (${r.sent})`);
  assert.equal(r.kw.status().stopped, null);
});

test("a failed, unanswered or unattributed send holds until a confirmed user turn that arrives after the stop", async () => {
  const r = rig({ reply: () => "cold" }); r.turn();
  await r.run(HOUR);
  assert.equal(r.kw.status().stopped, "cold-reply");
  await r.run(HOUR);
  assert.equal(r.sent, 1, "nothing restarts it by itself");
  r.turn();
  assert.deepEqual([r.kw.status().state, r.kw.status().pings], ["on", 0], "a confirmed user turn after the stop starts a fresh window");
});

test("a lifetime reported under 5 minutes is refused before any ping, and the ping cap never assumes a gap under 4 minutes", () => {
  const snap = (ttl) => { const c = createClock(); c.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", ttl, input: 200_000, read: 0, write: 200_000, output: 0 }), T0)); return c.snapshot(T0, "claude-sonnet-5.5"); };
  assert.deepEqual(planPing(base({ snapshot: snap(299) })), { skip: "lifetime-too-short" });
  assert.deepEqual(planPing(base({ snapshot: snap(75) })), { skip: "lifetime-too-short" });
  assert.deepEqual(planPing(base({ snapshot: snap(300) })), { at: T0 + 240_000 });
});

test("the daily-limit note is shown once per 24 hours, not on every turn", async () => {
  const store = memoryStore();
  store.ledgerSend(T0 + 20 * HOUR, 1.99);
  const r = rig({ store });
  r.turn(); r.turn(); r.turn();
  const notes = () => r.logs.filter((l) => /daily limit/.test(l.text)).length;
  assert.equal(notes(), 1);
  r.now += 25 * HOUR;
  r.turn(); r.turn();
  assert.equal(notes(), 2, "a new day, a new note");
  assert.equal(r.kw.status().stopped, "daily-limit", "and the stop itself is still there every time");
});

test("a ledger that cannot be read fails closed with one note that says how to reset it", async () => {
  const unreadable = { ...memoryStore(), ledger: () => { throw new Error("the ping ledger /x/y.ledger cannot be read as a ledger; delete it to reset it"); } };
  const r = rig({ store: unreadable }); r.turn();
  await r.run(HOUR);
  assert.equal(r.sent, 0);
  assert.equal(r.kw.status().stopped, "ledger-failed");
  assert.equal(r.logs.filter((l) => /delete it to reset it/.test(l.text)).length, 1);
});

test("the window file and the ledger are written only while the lock is still ours, checked live", async () => {
  const base = memoryStore();
  let locks = 0;
  let saves = 0;
  const store = { ...base, lock: () => { locks += 1; return locks <= 1; }, save: (w) => { saves += 1; base.save(w); } };
  const r = rig({ store });
  r.turn();
  assert.equal(saves, 0, "the lock was lost before the first write, so nothing was written");
  assert.equal(r.kw.status().state, "elsewhere");
  await r.run(10 * MIN);
  assert.equal(r.sent, 0);
});

test("with no stored window keep-warm waits for a confirmed user turn: no window is made from an earlier call", async () => {
  const r = rig({ config: { keepWarmHours: 0 } });
  r.clock.ingest(normalizeUsage(usage({ model: "claude-sonnet-5.5", at: iso(T0), ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 }), T0));
  r.config = { ...r.config, keepWarmHours: 3 };
  r.kw.configChanged();
  assert.equal(r.kw.status().state, "waiting");
  await r.run(10 * MIN);
  assert.equal(r.sent, 0);
});

// A store whose lock another process can take away mid-run; `saves` counts the windows written.
const lockableStore = () => {
  const inner = memoryStore();
  const store = { ...inner, held: true, saves: 0 };
  store.lock = () => store.held;
  store.save = (w) => { store.saves += 1; inner.save(w); };
  return store;
};

for (const kind of ["late", "tail"]) {
  test(`releaseOwnership clears late and tail attribution (${kind})`, async () => {
    const store = lockableStore();
    const r = rig({ store, send: kind === "late"
      ? async () => { r.sent += 1; }
      : async () => { r.sent += 1; queueMicrotask(() => pingReply(r, { usageOnly: true })); } });
    r.turn();
    await r.run(kind === "late" ? 6 * MIN + 10_000 : 4 * MIN + 10_000);
    assert.equal(r.kw.status().awaitingReply, true, `a ${kind} reply is still expected`);
    store.held = false;
    r.kw.configChanged(); // saving the window finds the lock gone and lets go of everything
    assert.equal(r.kw.status().state, "elsewhere");
    assert.equal(r.kw.status().awaitingReply, false, "a process that lost the lock expects no ping's record");
  });
}

test("bookPing with no window books nothing and persists nothing", async () => {
  const store = lockableStore();
  const r = rig({ store, send: async () => { r.sent += 1; } }); r.turn();
  await r.run(6 * MIN + 10_000);
  assert.equal(r.kw.status().awaitingReply, true);
  const saves = store.saves;
  const ledger = ledgerOf(store, r.now);
  store.held = false; // lost, and not yet noticed: the late reply finds the window gone while booking
  r.kw.onPingUsage({ usd: 0.02, warm: true });
  const s = r.kw.status();
  assert.deepEqual([s.usd, s.pings], [0, 0], "no window was made up to hold the cost");
  assert.equal(store.saves, saves, "nothing was written");
  assert.deepEqual(ledgerOf(store, r.now), ledger, "and the ledger is untouched by a process without the lock");
});
