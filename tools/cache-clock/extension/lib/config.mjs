// Settings shared by every session: guard mode, cost threshold, heads-up lead time.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
