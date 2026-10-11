import { test } from "node:test";
import assert from "node:assert/strict";
import { createClock } from "../extension/lib/clock.mjs";
import { decide } from "../extension/lib/guard.mjs";
import { normalizeUsage } from "../extension/lib/usage.mjs";
import { usage, T0, MIN } from "./fixtures.mjs";

const at = (ms) => new Date(ms).toISOString();
const feed = (clock, o) => clock.ingest(normalizeUsage(usage({ ...o, at: at(o.at) }), o.at));

test("snapshot is null before any call", () => {
  assert.equal(createClock().snapshot(T0), null);
});

test("snapshot reports warm with time left inside the ttl", () => {
  const c = createClock();
  feed(c, { at: T0, input: 200_000, output: 0, model: "claude-sonnet-5.5", ttl: 300 });
  const s = c.snapshot(T0 + 2 * MIN);
  assert.equal(s.state, "warm");
  assert.equal(s.model, "claude-sonnet-5.5");
  assert.equal(s.msLeft, 3 * MIN);
  assert.equal(s.contextTokens, 200_000);
  assert.ok(Math.abs(s.extraUsd - 0.48) < 1e-9);
});

test("snapshot reports cold after expiry", () => {
  const c = createClock();
  feed(c, { at: T0, ttl: 300 });
  const s = c.snapshot(T0 + 6 * MIN);
  assert.equal(s.state, "cold");
  assert.equal(s.msLeft, -1 * MIN);
});

test("snapshot is unknown when no expiry is known or after compaction", () => {
  const c = createClock();
  feed(c, { at: T0, expiresAt: null, ttl: null });
  assert.equal(c.snapshot(T0).state, "unknown");
  const d = createClock();
  feed(d, { at: T0 });
  d.invalidate();
  assert.equal(d.snapshot(T0).state, "unknown");
  feed(d, { at: T0 + MIN });
  assert.equal(d.snapshot(T0 + MIN).state, "warm");
});

test("snapshot follows the most recently used model", () => {
  const c = createClock();
  feed(c, { at: T0, model: "gpt-6-luna" });
  feed(c, { at: T0 + MIN, model: "claude-sonnet-5.5", ttl: 300 });
  assert.equal(c.snapshot(T0 + 2 * MIN).model, "claude-sonnet-5.5");
  assert.equal(c.snapshot(T0 + 2 * MIN, "gpt-6-luna").model, "gpt-6-luna");
});

test("ingest classifies calls and tallies cold writes per session", () => {
  const c = createClock();
  assert.equal(feed(c, { at: T0, input: 100_000, read: 0, write: 100_000 }).kind, "first");
  assert.equal(feed(c, { at: T0 + MIN, input: 100_500, read: 100_000, write: 500 }).kind, "warm");
  const cold = feed(c, { at: T0 + 40 * MIN, input: 101_000, read: 10_000, write: 91_000 });
  assert.equal(cold.kind, "cold-idle");
  assert.equal(cold.lostTokens, 90_500);
  const t = c.tally();
  assert.equal(t.calls, 3);
  assert.equal(t.coldIdle, 1);
  assert.equal(t.coldBreak, 0);
  assert.ok(Math.abs(t.extraUsd - 90_500 * (0.125 - 0.01) / 1e6) < 1e-12);
});

test("the first call after a compaction is not tallied as a cold rewrite", () => {
  const c = createClock();
  feed(c, { at: T0, input: 100_000, read: 0, write: 100_000 });
  c.invalidate();
  assert.equal(feed(c, { at: T0 + MIN, input: 20_000, read: 0, write: 20_000 }).kind, "first");
  assert.equal(c.tally().coldBreak, 0);
  assert.equal(c.tally().extraUsd, 0);
});

const cfg = { mode: "refuse", minUsd: 0.1 };

test("decide guards prompts that merely start with a path, but not commands or shell escapes", () => {
  assert.equal(decide({ snap: coldSnap, prompt: "/etc/hosts is broken, fix it", config: cfg }).action, "refuse");
  assert.equal(decide({ snap: coldSnap, prompt: "/model claude-sonnet-5.5", config: cfg }).action, "allow");
  assert.equal(decide({ snap: coldSnap, prompt: "/compact", config: cfg }).action, "allow");
  assert.equal(decide({ snap: coldSnap, prompt: "!git status", config: cfg }).action, "allow");
});

test("decide only warns while a turn is running", () => {
  assert.equal(decide({ snap: coldSnap, prompt: "queued follow-up", config: cfg, busy: true }).action, "warn");
});

test("after one refusal any prompt in the same cold episode goes through", () => {
  const first = decide({ snap: coldSnap, prompt: "recap please", config: cfg });
  assert.equal(decide({ snap: coldSnap, prompt: "something else", config: cfg, refusedKey: first.key }).action, "warn");
});
const coldSnap = { model: "claude-sonnet-5.5", state: "cold", expiresAt: T0, extraUsd: 0.48 };

test("decide allows slash commands, warm caches and cheap cold sends", () => {
  assert.equal(decide({ snap: coldSnap, prompt: "  /cache-clock", config: cfg }).action, "allow");
  assert.equal(decide({ snap: { ...coldSnap, state: "warm" }, prompt: "hi", config: cfg }).action, "allow");
  assert.equal(decide({ snap: { ...coldSnap, state: "unknown" }, prompt: "hi", config: cfg }).action, "allow");
  assert.equal(decide({ snap: { ...coldSnap, extraUsd: 0.05 }, prompt: "hi", config: cfg }).action, "allow");
  assert.equal(decide({ snap: { ...coldSnap, extraUsd: null }, prompt: "hi", config: cfg }).action, "allow");
  assert.equal(decide({ snap: null, prompt: "hi", config: cfg }).action, "allow");
  assert.equal(decide({ snap: coldSnap, prompt: "hi", config: { ...cfg, mode: "off" } }).action, "allow");
});

test("decide refuses a costly cold send once, then lets the resend through with a warning", () => {
  const first = decide({ snap: coldSnap, prompt: "recap please", config: cfg });
  assert.equal(first.action, "refuse");
  const second = decide({ snap: coldSnap, prompt: "recap please", config: cfg, refusedKey: first.key });
  assert.equal(second.action, "warn");
});

test("decide refuses again for a new cold episode", () => {
  const first = decide({ snap: coldSnap, prompt: "a", config: cfg });
  const later = decide({ snap: { ...coldSnap, expiresAt: T0 + 60 * MIN }, prompt: "b", config: cfg, refusedKey: first.key });
  assert.equal(later.action, "refuse");
});

test("decide in warn mode never refuses", () => {
  assert.equal(decide({ snap: coldSnap, prompt: "a", config: { ...cfg, mode: "warn" } }).action, "warn");
});
