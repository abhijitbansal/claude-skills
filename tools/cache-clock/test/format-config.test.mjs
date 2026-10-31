import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP, usd, perM, duration, tokens, card, refusal, coldWarn, headsUp } from "../extension/lib/format.mjs";
import { DEFAULTS, configDir, loadConfig, saveConfig, parseCommand } from "../extension/lib/config.mjs";
import { T0, MIN } from "./fixtures.mjs";

test("usd picks precision by size", () => {
  assert.equal(usd(null), "?");
  assert.equal(usd(0), "$0");
  assert.equal(usd(6.613), "$6.61");
  assert.equal(usd(0.48), "$0.48");
  assert.equal(usd(0.0034), "$0.003");
  assert.equal(usd(0.0002), "<$0.001");
});

test("perM shows a per-token price per million tokens", () => {
  assert.equal(perM(2.5e-6), "$2.50/M");
  assert.equal(perM(0.125e-6), "$0.125/M");
  assert.equal(perM(0.01e-6), "$0.01/M");
});

test("duration and tokens are compact", () => {
  assert.equal(duration(45_000), "45s");
  assert.equal(duration(29 * MIN + 5000), "29m05s");
  assert.equal(duration(62 * MIN), "1h02m");
  assert.equal(duration(-130_000), "2m10s");
  assert.equal(tokens(512), "512");
  assert.equal(tokens(27_043), "27.0k");
  assert.equal(tokens(1_204_000), "1.20M");
});

const prices = { input: 2e-6, read: 0.1e-6, write: 2.5e-6, output: 10e-6 };
const snap = {
  model: "claude-sonnet-5.5", displayName: "Claude Sonnet 5.5", state: "cold",
  expiresAt: T0, msLeft: -130_000, ttlSec: 300, prices,
  contextTokens: 200_000, coldUsd: 0.5, warmUsd: 0.02, extraUsd: 0.48,
};

test("refusal names the model, the idle time, the tokens and both prices", () => {
  const text = refusal(snap);
  assert.match(text, /Claude Sonnet 5\.5 prompt cache went cold 2m10s ago/);
  assert.match(text, /rewrites about 200\.0k tokens at \$2\.50\/M = \$0\.50/);
  assert.match(text, /warm send would read them for \$0\.02/);
  assert.match(text, /Send it again to pay it/);
});

test("coldWarn and headsUp carry the prices", () => {
  assert.match(coldWarn(snap), /rewriting about 200\.0k tokens for \$0\.50 \(warm: \$0\.02\)/);
  const warm = { ...snap, state: "warm", msLeft: 5 * MIN };
  assert.match(headsUp(warm), /goes cold in 5m00s/);
  assert.match(headsUp(warm), /about \$0\.50 instead of \$0\.02/);
});

test("card covers state, context, prices, tally and guard", () => {
  const tally = { calls: 3, coldIdle: 1, coldBreak: 0, extraUsd: 0.12 };
  const warmCard = card({ ...snap, state: "warm", msLeft: 192_000 }, tally, DEFAULTS);
  assert.match(warmCard, /Claude Sonnet 5\.5/);
  assert.match(warmCard, /warm, 3m12s left \(ttl 5m00s\)/);
  assert.match(warmCard, /200\.0k tokens/);
  assert.match(warmCard, /warm \$0\.02 · cold \$0\.50 \(25× per token\)/);
  assert.match(warmCard, /3 model calls · 1 cold after idle · 0 prefix breaks · 0 switch rewrites · \$0\.12 estimated extra/);
  assert.match(warmCard, /ask before a cold send above \$0\.10 · heads-up 5m before expiry/);
  assert.match(card(snap, tally, DEFAULTS), /cold for 2m10s/);
  assert.match(card({ ...snap, state: "unknown" }, tally, DEFAULTS), /unknown/);
  assert.match(card(null, tally, DEFAULTS), /no model call yet/);
  assert.match(card({ ...snap, prices: { ...prices, read: 0 } }, tally, DEFAULTS), /prices not reported/);
});

test("configDir honours CACHE_CLOCK_HOME, then COPILOT_HOME", () => {
  assert.equal(configDir({ CACHE_CLOCK_HOME: "/x" }), "/x");
  assert.equal(configDir({ COPILOT_HOME: "/c" }), join("/c", "cache-clock"));
  assert.match(configDir({}), /\.copilot[\\/]cache-clock$/);
});

test("loadConfig falls back to defaults for missing, invalid or out-of-range files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  assert.deepEqual(loadConfig(dir), DEFAULTS);
  writeFileSync(join(dir, "config.json"), "{not json");
  assert.deepEqual(loadConfig(dir), DEFAULTS);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ mode: "nuke", minUsd: -1, headsUpMin: "x" }));
  assert.deepEqual(loadConfig(dir), DEFAULTS);
});

test("saveConfig round-trips through loadConfig and creates the directory", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "cc-")), "nested");
  const cfg = { mode: "warn", minUsd: 0.25, headsUpMin: 0 };
  saveConfig(dir, cfg);
  assert.deepEqual(loadConfig(dir), cfg);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), cfg);
});

test("parseCommand understands status, guard, min, headsup and help", () => {
  assert.deepEqual(parseCommand(""), { kind: "status" });
  assert.deepEqual(parseCommand("  status "), { kind: "status" });
  assert.deepEqual(parseCommand("guard warn"), { kind: "set", patch: { mode: "warn" } });
  assert.deepEqual(parseCommand("min $0.25"), { kind: "set", patch: { minUsd: 0.25 } });
  assert.deepEqual(parseCommand("min 1"), { kind: "set", patch: { minUsd: 1 } });
  assert.deepEqual(parseCommand("headsup 10"), { kind: "set", patch: { headsUpMin: 10 } });
  assert.deepEqual(parseCommand("headsup off"), { kind: "set", patch: { headsUpMin: 0 } });
  assert.equal(parseCommand("help").kind, "help");
  assert.equal(parseCommand("guard sometimes").kind, "error");
  assert.equal(parseCommand("min -3").kind, "error");
  assert.equal(parseCommand("headsup soon").kind, "error");
  assert.equal(parseCommand("explode").kind, "error");
});

test("help explains what the clock does, what a cold send triggers, every command and the report", () => {
  for (const want of [
    /prompt cache/i, /Send anyway/, /Don't send/, /refuse/i,
    /\/cache-clock guard refuse/, /\/cache-clock guard warn/, /\/cache-clock guard off/,
    /\/cache-clock min /, /\/cache-clock headsup /, /\/cache-clock help/,
    /report\.mjs --since 7d/, /VS Code/, /chat\.canvases\.enabled/, /--project/,
  ]) assert.match(HELP, want);
});
