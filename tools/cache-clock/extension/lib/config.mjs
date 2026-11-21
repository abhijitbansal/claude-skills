// Settings shared by every session: guard mode, cost threshold, heads-up lead time,
// and the keep-warm window, budget and payback stop.

import { appendFileSync, chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MODES } from "./guard.mjs";

export const DEFAULTS = Object.freeze({
  mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 0, keepWarmMaxUsd: 0.5, keepWarmPayback: true,
  keepWarmDailyMaxUsd: 2,
});

export const KEEPWARM_ON_HOURS = 3;
export const KEEPWARM_MAX_HOURS = 12;
export const KEEPWARM_CONFIRM_ABOVE_HOURS = 6;
export const KEEPWARM_MAX_USD = 5;
// The most a session may spend on pings in any 24 hours, whatever its windows and budgets do.
export const KEEPWARM_DAILY_MIN_USD = 0.1;
export const KEEPWARM_DAILY_MAX_USD = 20;

const FILE = "config.json";

export function configDir(env = process.env) {
  if (env.CACHE_CLOCK_HOME) return env.CACHE_CLOCK_HOME;
  return join(env.COPILOT_HOME || join(homedir(), ".copilot"), "cache-clock");
}

const OWN_SUBDIRS = ["refusals", "keepwarm"];

/**
 * Sets an existing directory of cache-clock's own to 0700: the default `<copilot home>/cache-clock`
 * and its `refusals` and `keepwarm` subdirectories, which an earlier version may have left at 0755.
 * A directory the user chose with CACHE_CLOCK_HOME (it may be $HOME) is never touched; its files
 * are still private. A symlink, a directory someone else owns, or a chmod that fails is left alone.
 */
export function tightenOwnDir(dir) {
  const defaultDir = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "cache-clock");
  if (resolve(dir) !== resolve(defaultDir) && !OWN_SUBDIRS.includes(basename(dir))) return;
  try {
    const info = lstatSync(dir);
    if (!info.isDirectory() || info.uid !== process.getuid?.()) return;
    if ((info.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  } catch {
    // Not ours to change (EPERM) or already gone; the write that follows decides what is an error.
  }
}

/** Creates `dir` (0700) and tightens it and its parent where they are cache-clock's own. */
function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tightenOwnDir(dir);
  if (OWN_SUBDIRS.includes(basename(dir))) tightenOwnDir(dirname(dir));
}

/**
 * Writes `<dir>/<name>` owner-only (0600) and atomically: a fresh temp file, created exclusively,
 * is renamed into place, so a reader never sees half a file and an old 0644 file is replaced by a 0600 one.
 */
export function writePrivate(dir, name, text) {
  ensurePrivateDir(dir);
  const file = join(dir, name);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
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
  keepWarmDailyMaxUsd: {
    rule: `dollars from ${KEEPWARM_DAILY_MIN_USD.toFixed(2)} to ${KEEPWARM_DAILY_MAX_USD}`,
    ok: (v) => isAmount(v) && v >= KEEPWARM_DAILY_MIN_USD && v <= KEEPWARM_DAILY_MAX_USD,
  },
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
  writePrivate(dir, FILE, JSON.stringify({ ...known, ...unknown }, null, 2) + "\n");
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
  // Different sessions never share a read/modify/write operation. Same-session
  // writers are last-rename-wins; this is advisory memory, not a locking protocol.
  writePrivate(join(dir, "refusals"), basename(refusalFile(dir, sessionId)), JSON.stringify({ key, at }) + "\n");
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
const LEDGER_KEEP_MS = 24 * 60 * 60 * 1000;

/** One ledger line as { t, id?, at?, usd? }, or null when it is not a valid send, cost or note. */
function parseLedgerLine(line) {
  try {
    const { t, id, at, usd } = JSON.parse(line);
    const amount = Number.isFinite(usd) && usd >= 0;
    if (t === "send" && typeof id === "string" && Number.isFinite(at) && amount) return { t, id, at, usd };
    if (t === "cost" && typeof id === "string" && amount) return { t, id, usd };
    if (t === "note" && Number.isFinite(at)) return { t, at };
    return null;
  } catch {
    return null;
  }
}

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

/** Who holds a lock file: { pid, instance } (instance null for an old lock), or null when it is unreadable. */
function lockHolder(file) {
  try {
    const { pid, instance } = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(pid) ? { pid, instance: typeof instance === "string" ? instance : null } : null;
  } catch {
    return null; // an unreadable lock has no live holder
  }
}

/**
 * Per-session keep-warm state under `<dir>/keepwarm/<sha256(sessionId)>.{json,lock}`.
 * `save` and `lock` can throw on a filesystem error; the scheduler decides what that means.
 */
export function createKeepWarmStore(dir, sessionId, { pid = process.pid, instance = randomUUID(), isAlive = pidAlive, beforeLedgerRename = null } = {}) {
  const valid = validSessionId(sessionId);
  const isMine = (holder) => holder !== null && holder.pid === pid && holder.instance === instance;

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
    writePrivate(join(dir, KEEPWARM_DIR), basename(keepWarmFile(dir, sessionId, "json")), JSON.stringify(window) + "\n");
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
    ensurePrivateDir(join(dir, KEEPWARM_DIR));
    const file = keepWarmFile(dir, sessionId, "lock");
    const mine = `${file}.${pid}.${randomUUID()}.tmp`;
    writeFileSync(mine, JSON.stringify({ pid, instance }) + "\n", { flag: "wx", mode: 0o600 });
    try {
      try {
        linkSync(mine, file);
        return true;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
      const holder = lockHolder(file);
      if (isMine(holder)) return true;
      // Another instance in this very process counts as a live holder too: it is not us.
      if (holder !== null && isAlive(holder.pid)) return false;
      renameSync(mine, file);
      return isMine(lockHolder(file));
    } finally {
      rmSync(mine, { force: true });
    }
  }

  function unlock() {
    if (valid && isMine(lockHolder(keepWarmFile(dir, sessionId, "lock")))) rmSync(keepWarmFile(dir, sessionId, "lock"), { force: true });
  }

  // The ping ledger: one JSON line per send ("send": id, at, estimate), per measured cost ("cost": id,
  // usd) and per daily-limit note ("note": at). Every append starts with a newline, so a write cut
  // short ends at the next one instead of swallowing it. Only time removes entries: a new window, off
  // and on, a reload or another process leave it alone; compaction runs only at start-up, under the lock.
  const ledgerFile = () => keepWarmFile(dir, sessionId, "ledger");
  let ledgerSeq = 0;
  const ledgerAppend = (entry) => {
    ensurePrivateDir(join(dir, KEEPWARM_DIR));
    // An append cannot be an atomic rename, so the ledger gets its mode when it is created.
    appendFileSync(ledgerFile(), "\n" + JSON.stringify(entry), { mode: 0o600 });
  };
  const ledgerUnreadable = (why) => new Error(`the ping ledger ${ledgerFile()} cannot be read as a ledger (${why}); delete it to reset it`);

  /** The ledger's sends (id to { at, usd }, costs applied) and the last note time. A file with no valid line fails closed. */
  function readLedger() {
    let text = "";
    try {
      text = readFileSync(ledgerFile(), "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return { sends: new Map(), noteAt: null };
      throw ledgerUnreadable(err.message);
    }
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const parsed = lines.map(parseLedgerLine);
    // The last line may be a write that was cut short; it is ignored, and the earlier entries stand.
    if (parsed.length > 0 && parsed.at(-1) === null) parsed.pop();
    if (parsed.length > 0 && parsed.every((entry) => entry === null)) throw ledgerUnreadable("no line in it is a ledger entry");
    const sends = new Map();
    let noteAt = null;
    for (const entry of parsed) {
      if (!entry) continue;
      if (entry.t === "send") sends.set(entry.id, { at: entry.at, usd: entry.usd });
      else if (entry.t === "cost" && sends.has(entry.id)) sends.set(entry.id, { ...sends.get(entry.id), usd: entry.usd });
      else if (entry.t === "note") noteAt = Math.max(noteAt ?? entry.at, entry.at);
    }
    return { sends, noteAt };
  }

  // An entry dated after `now` (a clock that moved back) counts as now: never hidden, never dropped.
  // An entry dated in the future (the clock moved back) is still counted, and kept until it is itself 24 h old.
  const alive = (at, now) => at >= now - LEDGER_KEEP_MS;

  /** { pings, usd, noteAt } of the last 24 hours before `now`. Throws when the ledger cannot be read as one. */
  function ledger(now) {
    if (!valid) return { pings: 0, usd: 0, noteAt: null };
    const { sends, noteAt } = readLedger();
    const live = [...sends.values()].filter((entry) => alive(entry.at, now));
    return { pings: live.length, usd: live.reduce((sum, entry) => sum + entry.usd, 0), noteAt: noteAt === null ? null : Math.min(noteAt, now) };
  }

  /** Records a send at its estimate and returns its id (null for a session with no id). */
  function ledgerSend(at, usd) {
    if (!valid) return null;
    ledgerSeq += 1;
    const id = `${at}.${instance}.${ledgerSeq}`;
    ledgerAppend({ t: "send", id, at, usd });
    return id;
  }

  const ledgerCost = (id, usd) => {
    if (valid && id !== null && id !== undefined) ledgerAppend({ t: "cost", id, usd });
  };
  const ledgerNote = (at) => {
    if (valid) ledgerAppend({ t: "note", at });
  };

  /** Drops the entries that are 24 hours old. Atomic, and it leaves the file alone if a write raced it. */
  function compactLedger(now) {
    if (!valid) return;
    let size;
    try {
      size = statSync(ledgerFile()).size;
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    const { sends, noteAt } = readLedger();
    const kept = [...sends].filter(([, entry]) => alive(entry.at, now)).map(([id, entry]) => ({ t: "send", id, at: entry.at, usd: entry.usd }));
    if (noteAt !== null && alive(noteAt, now)) kept.push({ t: "note", at: noteAt });
    const tmp = `${ledgerFile()}.${pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, kept.map((entry) => "\n" + JSON.stringify(entry)).join(""), { flag: "wx", mode: 0o600 });
      beforeLedgerRename?.();
      if (statSync(ledgerFile()).size !== size) return;
      renameSync(tmp, ledgerFile());
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  return { load, save, lock, unlock, ledger, ledgerSend, ledgerCost, ledgerNote, compactLedger };
}

// Plain decimals only: Number() would also take 0x2, 1e-1 and Infinity.
const PLAIN_DECIMAL = /^\$?\d+(\.\d+)?$/;

function amount(text) {
  if (!PLAIN_DECIMAL.test(String(text ?? ""))) return null;
  const v = Number(String(text).replace(/^\$/, ""));
  return isAmount(v) ? v : null;
}

const KEEPWARM_USAGE = `keepwarm takes on, off, hours from 0 to ${KEEPWARM_MAX_HOURS}, budget <dollars 0 to ${KEEPWARM_MAX_USD}>, daily <dollars>, or payback on|off`;
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
  if (first === "daily") {
    const v = amount(second);
    return extra.length || v === null || v < KEEPWARM_DAILY_MIN_USD || v > KEEPWARM_DAILY_MAX_USD
      ? { kind: "error", message: `keepwarm daily takes dollars from ${KEEPWARM_DAILY_MIN_USD.toFixed(2)} to ${KEEPWARM_DAILY_MAX_USD}, e.g. 2.00` }
      : { kind: "set", patch: { keepWarmDailyMaxUsd: v } };
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
