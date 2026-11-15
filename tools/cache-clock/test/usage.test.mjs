import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage, pricesFrom, classifyCall, lostTokens, extraUsd, nextSendCosts, expiryOf } from "../extension/lib/usage.mjs";
import { usage, LUNA_PRICES, T0 } from "./fixtures.mjs";

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("pricesFrom converts nano-AIU per batch into dollars per token", () => {
  const p = pricesFrom(LUNA_PRICES);
  close(p.input, 0.10 / 1e6);
  close(p.read, 0.01 / 1e6);
  close(p.write, 0.125 / 1e6);
  close(p.output, 0.50 / 1e6);
});

test("pricesFrom returns null when the write or read price is missing", () => {
  assert.equal(pricesFrom(LUNA_PRICES.filter((p) => p.tokenType !== "cache_write")), null);
  assert.equal(pricesFrom(undefined), null);
  assert.equal(pricesFrom([]), null);
});

test("normalizeUsage keeps tokens, expiry, ttl and prices", () => {
  const n = normalizeUsage(usage(), "2026-10-10T08:15:56.769Z");
  assert.equal(n.model, "gpt-6-luna");
  assert.equal(n.displayName, "GPT-6 Luna");
  assert.equal(n.at, T0);
  assert.equal(n.inputTokens, 17117);
  assert.equal(n.readTokens, 9428);
  assert.equal(n.writeTokens, 7686);
  assert.equal(n.outputTokens, 112);
  assert.equal(n.expiresAt, T0 + 1800 * 1000);
  assert.equal(n.ttlSec, 1800);
  assert.ok(n.prices);
});

test("normalizeUsage tolerates missing cache fields and rejects payloads without a model", () => {
  const n = normalizeUsage(usage({ expiresAt: null, ttl: null, prices: [] }), T0);
  assert.equal(n.expiresAt, null);
  assert.equal(n.ttlSec, null);
  assert.equal(n.prices, null);
  assert.equal(normalizeUsage({}, T0), null);
  assert.equal(normalizeUsage(null, T0), null);
});

test("normalizeUsage falls back to now when no timestamp is given", () => {
  const before = Date.now();
  const n = normalizeUsage(usage());
  assert.ok(n.at >= before && n.at <= Date.now());
});

const call = (o) => normalizeUsage(usage(o), o.at);

test("classifyCall: first call has no previous", () => {
  assert.equal(classifyCall(null, call({ at: "2026-10-10T08:15:56.769Z" })), "first");
});

test("classifyCall: a call that reads the old context is warm", () => {
  const prev = call({ at: "2026-10-10T08:15:56.769Z", input: 17117 });
  const cur = call({ at: "2026-10-10T08:16:00.475Z", input: 17384, read: 17114, write: 267 });
  assert.equal(classifyCall(prev, cur), "warm");
});

test("classifyCall: rewriting the context after expiry is cold-idle", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 100_000, read: 99_000, write: 1000 });
  const cur = call({ at: "2026-10-10T08:31:00.000Z", input: 100_500, read: 10_000, write: 90_500 });
  assert.equal(classifyCall(prev, cur), "cold-idle");
});

test("classifyCall: rewriting the context inside the ttl is cold-break", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 100_000, read: 99_000, write: 1000 });
  const cur = call({ at: "2026-10-10T08:05:00.000Z", input: 100_500, read: 10_000, write: 90_500 });
  assert.equal(classifyCall(prev, cur), "cold-break");
});

test("classifyCall: unknown expiry falls back to the reported ttl, then to warm-or-break", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 100_000, expiresAt: null });
  const cur = call({ at: "2026-10-10T08:31:00.000Z", input: 100_000, read: 0, write: 100_000 });
  assert.equal(classifyCall(prev, cur), "cold-idle");
  const prevNoTtl = call({ at: "2026-10-10T08:00:00.000Z", input: 100_000, expiresAt: null, ttl: null });
  assert.equal(classifyCall(prevNoTtl, cur), "cold-break");
});

test("classifyCall: a small context that only reads the shared system prefix is cold", () => {
  const prev = call({ at: "2026-10-11T14:55:22.482Z", input: 17_743 });
  const cur = call({ at: "2026-10-11T15:26:31.000Z", input: 17_900, read: 10_157, write: 7_743 });
  assert.equal(classifyCall(prev, cur), "cold-idle");
});

test("extraUsd prices lost tokens sent uncached at input minus read", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 1_000_000 });
  const cur = call({ at: "2026-10-10T08:31:00.000Z", input: 1_000_000, read: 0, write: 400_000 });
  close(extraUsd(prev, cur), 0.4 * (0.125 - 0.01) + 0.6 * (0.10 - 0.01), 1e-9);
});

test("normalizeUsage ignores an implausible expiry and keeps interactionType", () => {
  const seconds = normalizeUsage({ ...usage(), cacheExpiresAt: 1_791_731_000 }, T0);
  assert.equal(seconds.expiresAt, null);
  const farFuture = normalizeUsage({ ...usage(), cacheExpiresAt: "2099-01-01T00:00:00Z" }, T0);
  assert.equal(farFuture.expiresAt, null);
  assert.equal(normalizeUsage({ ...usage(), interactionType: "conversation-background" }, T0).interactionType, "conversation-background");
});

test("lostTokens counts the old context that was not read back", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 100_000 });
  const cur = call({ at: "2026-10-10T08:31:00.000Z", input: 100_500, read: 10_000, write: 90_500 });
  assert.equal(lostTokens(prev, cur), 90_000);
  const shrunk = call({ at: "2026-10-10T08:31:00.000Z", input: 40_000, read: 0, write: 40_000 });
  assert.equal(lostTokens(prev, shrunk), 40_000);
  assert.equal(lostTokens(null, cur), 0);
});

test("extraUsd prices lost tokens at write minus read", () => {
  const prev = call({ at: "2026-10-10T08:00:00.000Z", input: 1_000_000 });
  const cur = call({ at: "2026-10-10T08:31:00.000Z", input: 1_000_000, read: 0, write: 1_000_000 });
  close(extraUsd(prev, cur), 0.125 - 0.01, 1e-9);
  assert.equal(extraUsd(prev, { ...cur, prices: null }), null);
});

test("nextSendCosts estimates a cold rewrite and a warm read of the context", () => {
  const last = call({ at: "2026-10-10T08:00:00.000Z", input: 200_000, output: 0, model: "claude-sonnet-5.5" });
  const c = nextSendCosts(last);
  assert.equal(c.contextTokens, 200_000);
  close(c.coldUsd, 0.5, 1e-9);
  close(c.warmUsd, 0.02, 1e-9);
  close(c.extraUsd, 0.48, 1e-9);
  assert.equal(nextSendCosts({ ...last, prices: null }), null);
});

test("nextSendCosts counts the last answer as part of the next context", () => {
  const last = call({ at: "2026-10-10T08:00:00.000Z", input: 1000, output: 500 });
  assert.equal(nextSendCosts(last).contextTokens, 1500);
});

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

test("a duration beyond 30 minutes is not believed: the clock counts from the event time", () => {
  const edge = normalizeUsage({ ...usage(), duration: 30 * 60_000 }, T0);
  assert.deepEqual([edge.durationMs, edge.startAt], [30 * 60_000, T0 - 30 * 60_000]);
  const absurd = normalizeUsage({ ...usage(), duration: 30 * 60_000 + 1 }, T0);
  assert.deepEqual([absurd.durationMs, absurd.startAt], [0, T0]);
  assert.equal(normalizeUsage({ ...usage(), duration: -5000 }, T0).startAt, T0);
  assert.equal(normalizeUsage({ ...usage(), duration: "4000" }, T0).startAt, T0);
});

test("a negative or non-numeric spend is not a measurement", () => {
  assert.equal(normalizeUsage(usage({ nanoAiu: -1 }), T0).nanoAiu, null);
  assert.equal(normalizeUsage(usage({ nanoAiu: Number.NaN }), T0).nanoAiu, null);
  assert.equal(normalizeUsage(usage({ nanoAiu: 0 }), T0).nanoAiu, 0);
});
