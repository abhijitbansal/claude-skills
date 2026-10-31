// Settings shared by every session: guard mode, cost threshold, heads-up lead time.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODES } from "./guard.mjs";

export const DEFAULTS = Object.freeze({ mode: "refuse", minUsd: 0.1, headsUpMin: 5 });

const FILE = "config.json";

export function configDir(env = process.env) {
  if (env.CACHE_CLOCK_HOME) return env.CACHE_CLOCK_HOME;
  return join(env.COPILOT_HOME || join(homedir(), ".copilot"), "cache-clock");
}

const isAmount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function validated(raw) {
  return {
    mode: MODES.includes(raw?.mode) ? raw.mode : DEFAULTS.mode,
    minUsd: isAmount(raw?.minUsd) ? raw.minUsd : DEFAULTS.minUsd,
    headsUpMin: isAmount(raw?.headsUpMin) ? raw.headsUpMin : DEFAULTS.headsUpMin,
  };
}

export function loadConfig(dir) {
  try {
    return validated(JSON.parse(readFileSync(join(dir, FILE), "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(dir, config) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(validated(config), null, 2) + "\n");
  renameSync(tmp, join(dir, FILE));
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

function amount(text) {
  const v = Number(String(text).replace(/^\$/, ""));
  return text !== undefined && text !== "" && isAmount(v) ? v : null;
}

/** Parses the argument string of `/cache-clock`. */
export function parseCommand(args) {
  const [verb = "", value, ...rest] = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  if (rest.length) return { kind: "error", message: `too many arguments: ${args}` };
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
