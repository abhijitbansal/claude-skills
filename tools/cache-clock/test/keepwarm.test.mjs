import { test } from "node:test";
import assert from "node:assert/strict";
import { isPingText, isPingMessage, PING_DISPLAY, PING_PROMPT, leadMs, planPing, keepWarmEstimate } from "../extension/lib/keepwarm.mjs";
import { createClock } from "../extension/lib/clock.mjs";
import { normalizeUsage } from "../extension/lib/usage.mjs";
import { usage, T0, MIN } from "./fixtures.mjs";

test("ping text and ping messages are recognised by the marker", () => {
  assert.ok(isPingText("  [cache-clock:keepwarm] Reply with exactly: ."));
  assert.ok(!isPingText("explain [cache-clock:keepwarm] to me"));
  assert.ok(isPingMessage({ content: PING_DISPLAY, transformedContent: PING_PROMPT }));
  assert.ok(isPingMessage({ content: PING_DISPLAY, source: "system" }));
  assert.ok(!isPingMessage({ content: PING_DISPLAY, source: "user" }));
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

test("keepWarmEstimate counts pings and their cost for a window", () => {
  const e = keepWarmEstimate(sonnetSnap(), 8);
  assert.equal(e.pings, 120);
  assert.ok(Math.abs(e.usd - 2.4) < 1e-9);
  assert.equal(keepWarmEstimate({ ...sonnetSnap(), ttlSec: null }, 8), null);
  assert.equal(keepWarmEstimate(null, 8), null, "no model call yet");
});
