import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP, usd, perM, duration, tokens, card, refusal, coldWarn, headsUp, keepWarmStopped, keepWarmSaved, keepWarmQuote, pings } from "../extension/lib/format.mjs";
import { DEFAULTS, configDir, loadConfig, loadConfigResult, saveConfig, parseCommand } from "../extension/lib/config.mjs";
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

test("the card shows keep-warm state, time left, pings, spend and the last skip", () => {
  const tally = { calls: 3, coldIdle: 0, coldBreak: 0, extraUsd: 0 };
  const warm = { ...snap, state: "warm", msLeft: 192_000 };
  assert.match(card(warm, tally, DEFAULTS), /keep-warm  off \(\/cache-clock keepwarm on\)/);
  const on = { ...DEFAULTS, keepWarmHours: 3 };
  const status = { state: "on", msLeft: 9_000_000, pings: 7, usd: 0.14, lastSkip: "busy", stopped: null, inFlight: false };
  assert.match(card(warm, tally, on, status), /keep-warm  on · 2h30m left · 7 pings · \$0\.14 · last skip: busy/);
  assert.match(card(warm, tally, on, { ...status, lastSkip: null, pings: 1 }), /keep-warm  on · 2h30m left · 1 ping · \$0\.14(\n|$)/);
  assert.match(card(warm, tally, on, { state: "waiting" }), /keep-warm  on \(3h\) · starts after your next message/);
  assert.match(card(warm, tally, on), /keep-warm  on \(3h\) · starts after your next message/);
  assert.match(card(warm, tally, on, { ...status, state: "stopped", stopped: "payback" }), /keep-warm  stopped \(payback\) · 7 pings · \$0\.14/);
  assert.equal(pings(1), "1 ping");
  assert.equal(pings(0), "0 pings");
});

test("stop notes name the stop and the spend", () => {
  assert.match(keepWarmStopped("payback", { usd: 0.48, pings: 24 }), /stopped: pings have cost as much as the cold rewrite they avoid \(24 pings, \$0\.48 this window\)/);
  assert.match(keepWarmStopped("budget", { usd: 0.1, pings: 1 }), /the keep-warm budget is spent \(1 ping, \$0\.10 this window\)/);
  for (const reason of ["window-end", "cold-reply", "send-failed", "unmeasured"]) {
    assert.match(keepWarmStopped(reason, { usd: 0, pings: 0 }), /^cache-clock: keep-warm stopped: [a-z]/, reason);
  }
});

test("the card names why keep-warm is idle, and says the setting is global", () => {
  const tally = { calls: 3, coldIdle: 0, coldBreak: 0, extraUsd: 0 };
  const warm = { ...snap, state: "warm", msLeft: 192_000 };
  const on = { ...DEFAULTS, keepWarmHours: 3 };
  const status = { state: "on", msLeft: 9_000_000, pings: 7, usd: 0.14, lastSkip: null, stopped: null, inFlight: false };
  for (const [skip, text] of [["auto", /the selection is Auto/], ["context-full", /above 85% of the prompt limit/], ["unpriced", /price is unknown/],
    ["locked", /another process holds this session's keep-warm lock/], ["busy", /a turn is running or about to start/], ["question-open", /waiting on an open question/]]) {
    assert.match(card(warm, tally, on, { ...status, lastSkip: skip }), new RegExp(`last skip: ${skip} \\(`), skip);
    assert.match(card(warm, tally, on, { ...status, lastSkip: skip }), text, skip);
  }
  assert.match(card(warm, tally, on, { ...status, waitingOnQuestion: true }), /waiting on an open question/);
  assert.match(card(warm, tally, on, status), /the setting is global: every open session runs its own window and budget/);
  assert.doesNotMatch(card(warm, tally, DEFAULTS), /the setting is global/, "nothing to explain while it is off");
});

test("every stop reason has its own line, and the new ones say what happened", () => {
  const spend = { usd: 0.1, pings: 2 };
  for (const [reason, text] of [["not-refreshing", /did not move the cache expiry forward/], ["ping-cap", /ping limit for this window was reached/],
    ["too-late", /about to expire before a ping could refresh it/], ["send-failed", /a ping failed to send/], ["unmeasured", /ping's cost was not reported/]]) {
    assert.match(keepWarmStopped(reason, spend), text, reason);
  }
});

test("saved and quote lines say what was saved and what it may cost", () => {
  assert.equal(keepWarmSaved({ ...DEFAULTS, keepWarmHours: 3 }), "cache-clock: keep-warm: 3h after your last message · budget $0.50 · payback stop on · daily limit $2.00 (saved for all sessions; each open session runs its own window and budget)");
  assert.equal(keepWarmSaved({ ...DEFAULTS, keepWarmHours: 8, keepWarmPayback: false, keepWarmMaxUsd: 2 }), "cache-clock: keep-warm: 8h after your last message · budget $2.00 · payback stop off · daily limit $2.00 (saved for all sessions; each open session runs its own window and budget)");
  assert.equal(keepWarmSaved(DEFAULTS), "cache-clock: keep-warm: off (saved for all sessions)");
  assert.equal(keepWarmQuote(snap, 8, { pings: 120, usd: 2.4 }),
    "cache-clock: keep-warm for 8h on Claude Sonnet 5.5 (200.0k tokens) sends about 120 pings, about $2.40 at the last reported prices; the budget and payback stop end it sooner. This setting is global, so every open session gets its own window and budget; this estimate is for one session. Turn it on?");
  assert.equal(keepWarmQuote(null, 8, null), "cache-clock: keep-warm for 8h: cost unknown until a priced model call. This setting is global: every open session gets its own window and budget. Turn it on?");
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
  assert.deepEqual(loadConfig(dir), { ...DEFAULTS, ...cfg });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), { ...DEFAULTS, ...cfg });
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

test("loadConfigResult reports unparseable and non-object files, and keeps valid keys beside bad ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  writeFileSync(join(dir, "config.json"), "{not json");
  const bad = loadConfigResult(dir);
  assert.deepEqual(bad.config, DEFAULTS);
  assert.match(bad.problem, /^config\.json is not valid JSON \(/);
  writeFileSync(join(dir, "config.json"), "[1]");
  assert.match(loadConfigResult(dir).problem, /config\.json must hold a JSON object/);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ mode: "warn", minUsd: -1 }));
  const mixed = loadConfigResult(dir);
  assert.deepEqual(mixed.config, { ...DEFAULTS, mode: "warn" });
  assert.equal(mixed.problem, "config.json: minUsd must be a dollar amount of 0 or more");
  assert.deepEqual(loadConfig(dir), mixed.config);
});

test("keepwarm daily sets the 24-hour spend limit, 0.10 to 20 dollars", () => {
  assert.deepEqual(parseCommand("keepwarm daily 1.50"), { kind: "set", patch: { keepWarmDailyMaxUsd: 1.5 } });
  assert.deepEqual(parseCommand("keepwarm daily $0.10"), { kind: "set", patch: { keepWarmDailyMaxUsd: 0.1 } });
  assert.deepEqual(parseCommand("keepwarm daily 20"), { kind: "set", patch: { keepWarmDailyMaxUsd: 20 } });
  for (const bad of ["keepwarm daily", "keepwarm daily 0.09", "keepwarm daily 20.01", "keepwarm daily 1 2", "keepwarm daily 1e1", "keepwarm daily 0x2", "keepwarm daily -1"]) {
    const r = parseCommand(bad);
    assert.equal(r.kind, "error", bad);
    assert.match(r.message, /daily takes dollars from 0\.10 to 20/, bad);
  }
  assert.equal(DEFAULTS.keepWarmDailyMaxUsd, 2);
});

test("the daily limit is validated like the other settings, and saved and loaded with them", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ keepWarmDailyMaxUsd: 0.05 }));
  const bad = loadConfigResult(dir);
  assert.equal(bad.config.keepWarmDailyMaxUsd, 2);
  assert.match(bad.problem, /keepWarmDailyMaxUsd must be dollars from 0\.10 to 20/);
  saveConfig(dir, { ...DEFAULTS, keepWarmDailyMaxUsd: 5 });
  assert.equal(loadConfig(dir).keepWarmDailyMaxUsd, 5);
  assert.throws(() => saveConfig(dir, { ...DEFAULTS, keepWarmDailyMaxUsd: 21 }), /keepWarmDailyMaxUsd must be dollars from 0\.10 to 20/);
});

test("the card says another process owns keep-warm, and every new stop reason has its own line", () => {
  const tally = { calls: 3, coldIdle: 0, coldBreak: 0, extraUsd: 0 };
  const warm = { ...snap, state: "warm", msLeft: 192_000 };
  const on = { ...DEFAULTS, keepWarmHours: 3 };
  assert.match(card(warm, tally, on, { state: "elsewhere", lastSkip: "locked" }), /keep-warm  handled by another process of this session/);
  for (const [reason, text] of [["daily-limit", /daily limit for this session/], ["model-changed", /selected model changed while a ping was out/],
    ["compacted", /conversation was compacted while a ping was out/], ["ledger-failed", /ping ledger could not be read or written.*delete the ledger file to reset it/],
    ["lifetime-too-short", /cache lifetime is under 5 minutes/]]) {
    assert.match(keepWarmStopped(reason, { usd: 0.1, pings: 2 }), text, reason);
  }
});

test("keepwarm <hours> yes is the confirmation for a long window, and only for that form", () => {
  assert.deepEqual(parseCommand("keepwarm 8 yes"), { kind: "set", patch: { keepWarmHours: 8 } });
  assert.deepEqual(parseCommand("keepwarm 12 yes"), { kind: "set", patch: { keepWarmHours: 12 } });
  for (const bad of ["keepwarm 6 yes", "keepwarm 3 yes", "keepwarm on yes", "keepwarm off yes", "keepwarm 13 yes", "keepwarm 8 no", "keepwarm 8 yes now", "keepwarm budget 1 yes", "keepwarm payback on yes"]) {
    assert.equal(parseCommand(bad).kind, "error", bad);
  }
});

test("numbers are plain decimals: no hex, no exponent, no signs", () => {
  for (const bad of ["min 0x2", "min 1e-1", "min +1", "min -0", "headsup 0x10", "keepwarm budget 1e0", "keepwarm budget 0x1", "keepwarm 1e1", "keepwarm 0x3", "keepwarm +3"]) {
    assert.equal(parseCommand(bad).kind, "error", bad);
  }
  assert.deepEqual(parseCommand("min 0.25"), { kind: "set", patch: { minUsd: 0.25 } });
  assert.deepEqual(parseCommand("min $1"), { kind: "set", patch: { minUsd: 1 } });
});

test("keepwarm range edges, confirmation threshold and extra arguments", () => {
  assert.deepEqual(parseCommand("keepwarm 12"), { kind: "confirm", patch: { keepWarmHours: 12 } });
  assert.deepEqual(parseCommand("keepwarm 6.5"), { kind: "confirm", patch: { keepWarmHours: 6.5 } });
  assert.deepEqual(parseCommand("keepwarm 0"), { kind: "set", patch: { keepWarmHours: 0 } });
  assert.deepEqual(parseCommand("keepwarm 6.0"), { kind: "set", patch: { keepWarmHours: 6 } });
  assert.deepEqual(parseCommand("keepwarm budget 5"), { kind: "set", patch: { keepWarmMaxUsd: 5 } });
  assert.deepEqual(parseCommand("keepwarm budget 0"), { kind: "set", patch: { keepWarmMaxUsd: 0 } });
  assert.deepEqual(parseCommand("keepwarm payback on"), { kind: "set", patch: { keepWarmPayback: true } });
  for (const bad of ["keepwarm", "keepwarm -1", "keepwarm 12.5", "keepwarm 13", "keepwarm budget", "keepwarm budget 5.01", "keepwarm budget -1",
    "keepwarm payback", "keepwarm on now", "keepwarm off 1", "keepwarm 6 7", "keepwarm budget 1 2", "keepwarm payback on now", "keepwarm maybe"]) {
    assert.equal(parseCommand(bad).kind, "error", bad);
  }
});

test("saveConfig round-trips the keep-warm keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  const cfg = { ...DEFAULTS, keepWarmHours: 6, keepWarmMaxUsd: 2.5, keepWarmPayback: false };
  saveConfig(dir, cfg);
  assert.deepEqual(loadConfig(dir), cfg);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), cfg);
});

test("saveConfig keeps unknown keys and throws on an invalid value instead of replacing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ colour: "red", mode: "warn", keepWarmHours: 2 }));
  saveConfig(dir, { ...loadConfig(dir), minUsd: 0.2 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), { ...DEFAULTS, mode: "warn", keepWarmHours: 2, minUsd: 0.2, colour: "red" });
  const before = readFileSync(join(dir, "config.json"), "utf8");
  for (const [bad, rule] of [[{ keepWarmHours: 20 }, /keepWarmHours must be hours from 0 to 12/], [{ mode: "nuke" }, /mode must be one of/],
    [{ minUsd: -1 }, /minUsd must be a dollar amount/], [{ keepWarmPayback: "yes" }, /keepWarmPayback must be true or false/],
    [{ keepWarmMaxUsd: 6 }, /keepWarmMaxUsd must be dollars from 0 to 5/]]) {
    assert.throws(() => saveConfig(dir, { ...DEFAULTS, ...bad }), rule);
  }
  assert.equal(readFileSync(join(dir, "config.json"), "utf8"), before, "a refused save writes nothing");
});

test("saveConfig will not overwrite a file that is not a settings object", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  for (const text of ["{not json", "[1]", "null"]) {
    writeFileSync(join(dir, "config.json"), text);
    assert.throws(() => saveConfig(dir, { ...DEFAULTS }), /config\.json/, text);
    assert.equal(readFileSync(join(dir, "config.json"), "utf8"), text);
  }
});

test("loadConfigResult marks a file that cannot be read as settings, but not a file with a bad value", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  assert.equal(loadConfigResult(dir).unusable, false, "no file");
  for (const text of ["{not json", "[1]", "null"]) {
    writeFileSync(join(dir, "config.json"), text);
    assert.equal(loadConfigResult(dir).unusable, true, text);
  }
  writeFileSync(join(dir, "config.json"), JSON.stringify({ minUsd: -1, colour: 1 }));
  assert.equal(loadConfigResult(dir).unusable, false);
});

test("help explains what the clock does, what a cold send triggers, every command and the report", () => {
  for (const want of [
    /prompt cache/i, /Send anyway/, /Don't send/, /refuse/i,
    /\/cache-clock guard refuse/, /\/cache-clock guard warn/, /\/cache-clock guard off/,
    /\/cache-clock min /, /\/cache-clock headsup /, /\/cache-clock help/,
    /report\.mjs --since 7d/, /VS Code/, /chat\.canvases\.enabled/, /--project/,
    /\/cache-clock keepwarm on/, /keepwarm budget /, /keepwarm payback off/, /Keep-warm \(off until you turn it on; it costs money\)/, /every open session gets its own window and its own budget/,
  ]) assert.match(HELP, want);
});
