#!/usr/bin/env node
// cache-clock report — what cold prompt-cache rewrites cost across your Copilot sessions.
// Reads ~/.copilot/session-state/*/events.jsonl (COPILOT_HOME overrides ~/.copilot). Sends nothing.
//
//   node bin/report.mjs [--since 30d|12h|all] [--dir <session-state dir>] [--json]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatReport, parseSessionLog, parseSince, summarize } from "../extension/lib/history.mjs";

const USAGE = "usage: report.mjs [--since 30d|12h|all] [--dir <session-state dir>] [--json]";

function parseArgs(argv) {
  const opts = { since: "30d", dir: join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "session-state"), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === "-h" || flag === "--help") return { help: true };
    if (flag === "--json" && inline === undefined) opts.json = true;
    else if (flag === "--since" || flag === "--dir") {
      const value = inline ?? argv[(i += 1)];
      if (value === undefined || value === "") return null;
      opts[flag.slice(2)] = value;
    } else return null;
  }
  return opts;
}

function clientOf(dir) {
  try {
    return /^client_name:\s*(.+)$/m.exec(readFileSync(join(dir, "workspace.yaml"), "utf8"))?.[1]?.trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

function loadSessions(root) {
  const sessions = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const file = join(dir, "events.jsonl");
    if (!existsSync(file)) continue;
    try {
      sessions.push({ id: entry.name, client: clientOf(dir), ...parseSessionLog(readFileSync(file, "utf8")) });
    } catch (err) {
      process.stderr.write(`cache-clock: skipped ${file}: ${err.message}\n`);
    }
  }
  return sessions;
}

const opts = parseArgs(process.argv.slice(2));
if (opts?.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
const since = opts ? parseSince(opts.since) : null;
if (!opts || since === null) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
if (!existsSync(opts.dir)) {
  process.stderr.write(`cache-clock: no session logs at ${opts.dir}\n`);
  process.exit(1);
}

let sessions;
try {
  sessions = loadSessions(opts.dir);
} catch (err) {
  process.stderr.write(`cache-clock: cannot read ${opts.dir}: ${err.message}\n`);
  process.exit(1);
}
const summary = summarize(sessions, { since });
process.stdout.write(opts.json ? JSON.stringify(summary, null, 2) + "\n" : formatReport(summary) + "\n");
