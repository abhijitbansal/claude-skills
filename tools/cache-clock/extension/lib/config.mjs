// Settings shared by every session: guard mode, cost threshold, heads-up lead time,
// and the keep-warm window, budget and payback stop.

import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODES } from "./guard.mjs";

export const DEFAULTS = Object.freeze({
  mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 0, keepWarmMaxUsd: 0.5, keepWarmPayback: true,
});

export const KEEPWARM_ON_HOURS = 3;
export const KEEPWARM_MAX_HOURS = 12;
export const KEEPWARM_CONFIRM_ABOVE_HOURS = 6;
export const KEEPWARM_MAX_USD = 5;

const FILE = "config.json";

export function configDir(env = process.env) {
  if (env.CACHE_CLOCK_HOME) return env.CACHE_CLOCK_HOME;
  return join(env.COPILOT_HOME || join(homedir(), ".copilot"), "cache-clock");
}

const isAmount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// One entry per setting: the rule as shown to the user, and the check for it.
const RULES = {
  mode: { rule: `one of ${MODES.join(", ")}`, ok: (v) => MODES.includes(v) },
  minUsd: { rule: "a dollar amount of 0 or more", ok: isAmount },
  headsUpMin: { rule: "minutes, 0 or more", ok: isAmount },
  keepWarmHours: { rule: `hours from 0 to ${KEEPWARM_MAX_HOURS}`, ok: (v) => isAmount(v) && v <= KEEPWARM_MAX_HOURS },
  keepWarmMaxUsd: { rule: `dollars from 0 to ${KEEPWARM_MAX_USD}`, ok: (v) => isAmount(v) && v <= KEEPWARM_MAX_USD },
  keepWarmPayback: { rule: "true or false", ok: (v) => typeof v === "boolean" },
};
const KEYS = Object.keys(RULES);

function validated(raw) {
  return Object.fromEntries(KEYS.map((key) => [key, RULES[key].ok(raw?.[key]) ? raw[key] : DEFAULTS[key]]));
}

/** What is wrong with a parsed config.json, as sentences; an absent key is not wrong. */
function problemsIn(raw) {
  const bad = KEYS.filter((key) => Object.hasOwn(raw, key) && !RULES[key].ok(raw[key]))
    .map((key) => `config.json: ${key} must be ${RULES[key].rule}`);
  const unknown = Object.keys(raw).filter((key) => !KEYS.includes(key))
    .map((key) => `config.json: unknown setting "${key}"; accepted: ${KEYS.join(", ")}`);
  return [...bad, ...unknown];
}

/**
 * The parsed config.json: { raw, error }. A missing file is { raw: null, error: null };
 * a file that cannot be read as a settings object has an `error` sentence and no `raw`.
 */
function readRaw(dir) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { raw: null, error: null };
    const error = err instanceof SyntaxError ? `config.json is not valid JSON (${err.message})` : `config.json could not be read (${err.message})`;
    return { raw: null, error };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { raw: null, error: "config.json must hold a JSON object" };
  return { raw: parsed, error: null };
}

/**
 * Reads config.json without writing it: { config, problem, unusable }. `problem` is null when
 * nothing is wrong. `unusable` means the file itself cannot be read as settings, so a save would
 * destroy it; a bad value for one key is a problem but not unusable.
 */
export function loadConfigResult(dir) {
  const { raw, error } = readRaw(dir);
  if (error) return { config: { ...DEFAULTS }, problem: error, unusable: true };
  if (!raw) return { config: { ...DEFAULTS }, problem: null, unusable: false };
  const found = problemsIn(raw);
  return { config: validated(raw), problem: found.length ? found.join("; ") : null, unusable: false };
}

export function loadConfig(dir) {
  return loadConfigResult(dir).config;
}

/**
 * Writes the settings: each known key from `config` (the default when absent), then the file's
 * unknown keys untouched. Callers validate first: an invalid value for a known key throws, and so
 * does a file that is not a settings object, rather than replacing either with a default.
 */
export function saveConfig(dir, config) {
  const invalid = KEYS.filter((key) => config?.[key] !== undefined && !RULES[key].ok(config[key]));
  if (invalid.length) throw new Error(invalid.map((key) => `config.json: ${key} must be ${RULES[key].rule}`).join("; "));
  const { raw, error } = readRaw(dir);
  if (error) throw new Error(`${error}; not overwritten`);
  const known = Object.fromEntries(KEYS.map((key) => [key, config?.[key] === undefined ? DEFAULTS[key] : config[key]]));
  const unknown = Object.fromEntries(Object.entries(raw ?? {}).filter(([key]) => !KEYS.includes(key)));
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${FILE}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ ...known, ...unknown }, null, 2) + "\n");
    renameSync(tmp, join(dir, FILE));
  } finally {
    rmSync(tmp, { force: true });
  }
}

// The last refused cold episode per session, so a resend from a new process
// (`copilot --resume … -p`, or quit and resume) goes through instead of being refused again.
const REFUSALS = "refused.json";
const REFUSAL_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function readRefusals(dir) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, REFUSALS), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

const validSessionId = (id) => typeof id === "string" && id.length > 0;
const refusalFile = (dir, id) => join(dir, "refusals", `${createHash("sha256").update(id).digest("hex")}.json`);

function refusalKey(entry, now) {
  return typeof entry?.key === "string" && entry.key.length > 0 && Number.isFinite(entry.at) &&
    entry.at <= now && now - entry.at < REFUSAL_KEEP_MS ? entry.key : null;
}

export function loadRefusal(dir, sessionId, now = Date.now()) {
  if (!validSessionId(sessionId)) return null;
  try {
    return refusalKey(JSON.parse(readFileSync(refusalFile(dir, sessionId), "utf8")), now);
  } catch (err) {
    // A corrupt or expired new entry must not resurrect a legacy refusal.
    if (err.code !== "ENOENT") return null;
  }
  const legacy = readRefusals(dir);
  return Object.hasOwn(legacy, sessionId) ? refusalKey(legacy[sessionId], now) : null;
}

export function saveRefusal(dir, sessionId, key, at) {
  if (!validSessionId(sessionId) || !refusalKey({ key, at }, at)) return;
  mkdirSync(join(dir, "refusals"), { recursive: true, mode: 0o700 });
  const file = refusalFile(dir, sessionId);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  // Different sessions never share a read/modify/write operation. Same-session
  // writers are last-rename-wins; this is advisory memory, not a locking protocol.
  try {
    writeFileSync(tmp, JSON.stringify({ key, at }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// The keep-warm window and a one-process-per-session lock, so a reloaded extension resumes
// its window and spend instead of restarting a budget, and two processes never both ping.
const KEEPWARM_DIR = "keepwarm";

const keepWarmFile = (dir, id, ext) => join(dir, KEEPWARM_DIR, `${createHash("sha256").update(id).digest("hex")}.${ext}`);

/** True unless the OS says the pid does not exist (EPERM means it exists, owned by someone else). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isOptionalAmount = (v) => v === undefined || v === null || (Number.isFinite(v) && v >= 0);

/** The stored window with only its known fields, or null when any field is invalid. */
function validWindow(w) {
  if (!w || typeof w !== "object") return null;
  const { startedAt, endsAt, usd, pings, stopped, lastSendAt, lastPingUsd } = w;
  const ok = Number.isFinite(startedAt) && Number.isFinite(endsAt) && endsAt >= startedAt &&
    Number.isFinite(usd) && usd >= 0 && isCount(pings) && (stopped === null || typeof stopped === "string") &&
    isOptionalAmount(lastSendAt) && isOptionalAmount(lastPingUsd);
  if (!ok) return null;
  // The time of the last send and the cost of the last ping are kept only when known.
  return {
    startedAt, endsAt, usd, pings, stopped,
    ...(lastSendAt == null ? {} : { lastSendAt }),
    ...(lastPingUsd == null ? {} : { lastPingUsd }),
  };
}

function lockHolder(file) {
  try {
    const { pid } = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null; // an unreadable lock has no live holder
  }
}

/**
 * Per-session keep-warm state under `<dir>/keepwarm/<sha256(sessionId)>.{json,lock}`.
 * `save` and `lock` can throw on a filesystem error; the scheduler decides what that means.
 */
export function createKeepWarmStore(dir, sessionId, { pid = process.pid, isAlive = pidAlive } = {}) {
  const valid = validSessionId(sessionId);

  function load() {
    if (!valid) return null;
    try {
      return validWindow(JSON.parse(readFileSync(keepWarmFile(dir, sessionId, "json"), "utf8")));
    } catch {
      return null; // missing or corrupt: the window starts again at the next real turn
    }
  }

  function save(window) {
    if (!valid) return;
    mkdirSync(join(dir, KEEPWARM_DIR), { recursive: true, mode: 0o700 });
    const file = keepWarmFile(dir, sessionId, "json");
    const tmp = `${file}.${pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(window) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(tmp, file);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /**
   * The lock is a file holding the holder's pid, and it appears whole or not at all: a hard link to
   * a finished temp file is atomic and fails when the lock exists. A stale lock is taken over by
   * renaming a finished temp file over it, then re-reading it to confirm the pid is ours. Callers
   * confirm again with `lock()` before every ping, so of two processes that raced for a stale lock
   * only the last writer keeps pinging.
   */
  function lock() {
    if (!valid) return false;
    mkdirSync(join(dir, KEEPWARM_DIR), { recursive: true, mode: 0o700 });
    const file = keepWarmFile(dir, sessionId, "lock");
    const mine = `${file}.${pid}.${randomUUID()}.tmp`;
    writeFileSync(mine, JSON.stringify({ pid }) + "\n", { flag: "wx", mode: 0o600 });
    try {
      try {
        linkSync(mine, file);
        return true;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
      const holder = lockHolder(file);
      if (holder === pid) return true;
      if (holder !== null && isAlive(holder)) return false;
      renameSync(mine, file);
      return lockHolder(file) === pid;
    } finally {
      rmSync(mine, { force: true });
    }
  }

  function unlock() {
    if (valid && lockHolder(keepWarmFile(dir, sessionId, "lock")) === pid) rmSync(keepWarmFile(dir, sessionId, "lock"), { force: true });
  }

  /** Forgets the stored window, as when keep-warm is turned off: the next on is a fresh start. */
  function clear() {
    if (valid) rmSync(keepWarmFile(dir, sessionId, "json"), { force: true });
  }

  return { load, save, lock, unlock, clear };
}

// Plain decimals only: Number() would also take 0x2, 1e-1 and Infinity.
const PLAIN_DECIMAL = /^\$?\d+(\.\d+)?$/;

function amount(text) {
  if (!PLAIN_DECIMAL.test(String(text ?? ""))) return null;
  const v = Number(String(text).replace(/^\$/, ""));
  return isAmount(v) ? v : null;
}

const KEEPWARM_USAGE = `keepwarm takes on, off, hours from 0 to ${KEEPWARM_MAX_HOURS}, budget <dollars 0 to ${KEEPWARM_MAX_USD}>, or payback on|off`;
const hoursPatch = (keepWarmHours) => ({ kind: "set", patch: { keepWarmHours } });

/** `keepwarm` forms: on | off | <hours> | budget <usd> | payback on|off. `rest` is what follows the verb. */
function parseKeepWarm(rest) {
  const [first, second, ...extra] = rest;
  if (first === "budget") {
    const v = amount(second);
    return extra.length || v === null || v > KEEPWARM_MAX_USD
      ? { kind: "error", message: `keepwarm budget takes dollars from 0 to ${KEEPWARM_MAX_USD}, e.g. 0.50` }
      : { kind: "set", patch: { keepWarmMaxUsd: v } };
  }
  if (first === "payback") {
    return extra.length || !["on", "off"].includes(second)
      ? { kind: "error", message: "keepwarm payback takes on or off" }
      : { kind: "set", patch: { keepWarmPayback: second === "on" } };
  }
  // `keepwarm <hours> yes` confirms a window above the threshold, for hosts that cannot ask.
  if (second === "yes" && extra.length === 0 && /^\d+(\.\d+)?$/.test(first ?? "")) {
    const hours = Number(first);
    return hours > KEEPWARM_CONFIRM_ABOVE_HOURS && hours <= KEEPWARM_MAX_HOURS ? hoursPatch(hours) : { kind: "error", message: KEEPWARM_USAGE };
  }
  if (second !== undefined || first === undefined) return { kind: "error", message: KEEPWARM_USAGE };
  if (first === "on") return hoursPatch(KEEPWARM_ON_HOURS);
  if (first === "off") return hoursPatch(0);
  const hours = /^\d+(\.\d+)?$/.test(first) ? Number(first) : null;
  if (hours === null || hours > KEEPWARM_MAX_HOURS) return { kind: "error", message: KEEPWARM_USAGE };
  // Long windows cost real money: the caller shows an estimate and asks first.
  return hours > KEEPWARM_CONFIRM_ABOVE_HOURS ? { kind: "confirm", patch: { keepWarmHours: hours } } : hoursPatch(hours);
}

/** Parses the argument string of `/cache-clock`. */
export function parseCommand(args) {
  const [verb = "", ...rest] = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  if (verb === "keepwarm") return parseKeepWarm(rest);
  const [value, ...surplus] = rest;
  if (surplus.length) return { kind: "error", message: `too many arguments: ${args}` };
  if (verb === "" || verb === "status") return { kind: "status" };
  if (verb === "help") return { kind: "help" };
  if (verb === "guard") {
    return MODES.includes(value)
      ? { kind: "set", patch: { mode: value } }
      : { kind: "error", message: `guard takes ${MODES.join(", ")}` };
  }
  if (verb === "min") {
    const v = amount(value);
    return v === null ? { kind: "error", message: "min takes a dollar amount, e.g. 0.25" } : { kind: "set", patch: { minUsd: v } };
  }
  if (verb === "headsup") {
    const v = value === "off" ? 0 : amount(value);
    return v === null ? { kind: "error", message: "headsup takes minutes, or off" } : { kind: "set", patch: { headsUpMin: v } };
  }
  return { kind: "error", message: `unknown subcommand: ${verb}` };
}
