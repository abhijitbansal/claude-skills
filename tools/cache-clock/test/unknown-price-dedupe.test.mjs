import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach } from "../extension/lib/wiring.mjs";
import { saveConfig } from "../extension/lib/config.mjs";
import { usage, T0, MIN } from "./fixtures.mjs";

// CAT-93: the unknown-price warning repeated on every send for an unpriced
// selection that is not Auto (an error box per prompt in VS Code). It must
// warn once per selection, the way Auto already does.

function host() {
  const dir = mkdtempSync(join(tmpdir(), "cc-dedupe-"));
  saveConfig(dir, { mode: "refuse", minUsd: 0.1, headsUpMin: 5 });
  const h = { now: T0, logs: [], aborts: 0, handlers: new Map(), joinConfig: null, selected: { modelId: "claude-sonnet-5.5" } };
  h.session = {
    sessionId: "s-1",
    rpc: { model: { getCurrent: async () => h.selected } },
    log: async (message, options = {}) => { h.logs.push({ message, ...options }); },
    abort: () => { h.aborts += 1; return new Promise(() => {}); },
    on: (type, fn) => { h.handlers.set(type, [...(h.handlers.get(type) ?? []), fn]); return () => {}; },
  };
  h.emit = (type, data) => {
    if (type === "session.model_change") h.selected = { modelId: data.newModel, providerId: data.providerId, contextTier: data.contextTier };
    for (const fn of h.handlers.get(type) ?? []) fn({ type, data, timestamp: new Date(h.now).toISOString() });
  };
  const timers = { setTimeout: () => ({ unref() {} }), clearTimeout: () => {} };
  h.prompt = (prompt) => h.joinConfig.hooks.onUserPromptSubmitted({ prompt, timestamp: new Date(h.now), workingDirectory: "/" });
  h.start = () => attach({
    joinSession: async (cfg) => { h.joinConfig = cfg; return h.session; },
    now: () => h.now, timers, dir, readHistory: () => "", env: {},
  });
  return h;
}

const sonnet = () => usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0 });
const unknownWarnings = (h) => h.logs.filter((l) => /price.*unknown/i.test(l.message)).length;

async function warmThenSelect(h, selection) {
  await h.start();
  h.emit("assistant.usage", sonnet());
  h.emit("session.model_change", selection);
}

test("an unpriced non-Auto selection warns once across two prompts", async () => {
  const h = host();
  await warmThenSelect(h, { newModel: "never-seen-model" });
  h.now += MIN;
  assert.equal(await h.prompt("one"), undefined);
  assert.equal(await h.prompt("two"), undefined);
  assert.equal(h.aborts, 0);
  assert.equal(unknownWarnings(h), 1, `expected one warning, got: ${JSON.stringify(h.logs.map((l) => l.message))}`);
});

test("a provider-qualified selection warns once across two prompts", async () => {
  const h = host();
  await warmThenSelect(h, { newModel: "claude-sonnet-5.5", providerId: "other" });
  h.now += MIN;
  await h.prompt("one");
  await h.prompt("two");
  assert.equal(unknownWarnings(h), 1);
});

const unpricedSonnet = () => usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0, prices: [] });
const unpricedColdWarnings = (h) => h.logs.filter((l) => /no price-based guard was possible/.test(l.message)).length;

test("two prompts in one cold unpriced episode warn once", async () => {
  const h = host();
  await h.start();
  h.emit("assistant.usage", unpricedSonnet());
  h.now += 10 * MIN;
  assert.equal(await h.prompt("one"), undefined);
  assert.equal(await h.prompt("two"), undefined);
  assert.equal(h.aborts, 0);
  assert.equal(unpricedColdWarnings(h), 1, `got: ${JSON.stringify(h.logs.map((l) => l.message))}`);
});

test("two cold unpriced episodes on one selection warn twice", async () => {
  const h = host();
  await h.start();
  h.emit("assistant.usage", unpricedSonnet());
  h.now += 10 * MIN;
  await h.prompt("one");
  h.emit("assistant.usage", { ...unpricedSonnet(), cacheExpiresAt: new Date(h.now + 300_000).toISOString() });
  h.now += 10 * MIN;
  await h.prompt("two");
  assert.equal(unpricedColdWarnings(h), 2, `got: ${JSON.stringify(h.logs.map((l) => l.message))}`);
});

test("moving to a different unpriced selection warns again", async () => {
  const h = host();
  await warmThenSelect(h, { newModel: "never-seen-model" });
  await h.prompt("one");
  h.emit("session.model_change", { newModel: "another-unseen-model" });
  await h.prompt("two");
  await h.prompt("three");
  assert.equal(unknownWarnings(h), 2, "one warning per distinct selection");
});
