import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSessionLog, summarize, formatReport, parseSince } from "../extension/lib/history.mjs";
import { usage, T0, MIN } from "./fixtures.mjs";

const REPORT = fileURLToPath(new URL("../bin/report.mjs", import.meta.url));
const iso = (ms) => new Date(ms).toISOString();

function record(ms, o = {}, extra = {}) {
  return JSON.stringify({ type: "session.usage_record", timestamp: iso(ms), data: { usage: usage({ at: iso(ms), ...o }) }, ...extra });
}

// A Sonnet session: first call, warm follow-up, a cold send after a 40-minute break,
// and a prefix break two minutes later.
const sonnetLog = [
  JSON.stringify({ type: "session.start", timestamp: iso(T0), data: {} }),
  record(T0, { model: "claude-sonnet-5.5", ttl: 300, input: 100_000, read: 0, write: 100_000 }),
  record(T0 + MIN, { model: "claude-sonnet-5.5", ttl: 300, input: 101_000, read: 100_000, write: 1000 }),
  "{not json",
  record(T0 + 41 * MIN, { model: "claude-sonnet-5.5", ttl: 300, input: 102_000, read: 10_000, write: 92_000 }),
  record(T0 + 43 * MIN, { model: "claude-sonnet-5.5", ttl: 300, input: 103_000, read: 10_000, write: 93_000 }),
].join("\n");

test("parseSessionLog extracts usage records and skips bad lines", () => {
  const s = parseSessionLog(sonnetLog);
  assert.equal(s.calls.length, 4);
  assert.equal(s.calls[0].call.model, "claude-sonnet-5.5");
  assert.equal(s.calls[0].agentKey, "main");
  assert.equal(s.badLines, 1);
});

test("parseSessionLog separates sub-agent calls and reads the final checkpoint", () => {
  const log = [
    record(T0, {}, { agentId: "sub-7" }),
    JSON.stringify({ type: "session.usage_checkpoint", timestamp: iso(T0), data: { totalNanoAiu: 5e9 } }),
  ].join("\n");
  const s = parseSessionLog(log);
  assert.equal(s.calls[0].agentKey, "sub-7");
  assert.equal(s.checkpoint.totalNanoAiu, 5e9);
});

test("summarize counts cold-after-idle, prefix breaks, extra dollars and idle gaps per model", () => {
  const sum = summarize([{ id: "a", client: "github/cli", ...parseSessionLog(sonnetLog) }], { since: 0 });
  const m = sum.models.find((x) => x.model === "claude-sonnet-5.5");
  assert.equal(m.calls, 4);
  assert.equal(m.coldIdle, 1);
  assert.equal(m.coldBreak, 1);
  assert.deepEqual(m.idleMinutes, [40]);
  // cold-idle lost 91k, cold-break lost 92k; Sonnet write - read = $2.40/M
  assert.ok(Math.abs(m.extraUsd - (91_000 + 92_000) * 2.4e-6) < 1e-9);
  assert.equal(sum.sessions.withCalls, 1);
  assert.deepEqual(sum.surfaces, { "github/cli": 1 });
});

test("summarize honours --since and counts checkpoint-only sessions", () => {
  const old = { id: "old", client: "github/cli", ...parseSessionLog(sonnetLog) };
  const vscode = {
    id: "v", client: "vscode-agent-host", calls: [], badLines: 0,
    checkpoint: { totalNanoAiu: 7e8 }, lastAt: T0 + 100 * MIN,
  };
  const sum = summarize([old, vscode], { since: T0 + 42 * MIN });
  const m = sum.models.find((x) => x.model === "claude-sonnet-5.5");
  assert.equal(m.calls, 1);
  assert.equal(m.coldIdle, 0);
  assert.equal(m.coldBreak, 1);
  assert.equal(sum.sessions.checkpointOnly, 1);
  assert.ok(Math.abs(sum.sessions.checkpointOnlyUsd - 0.007) < 1e-12);
});

test("formatReport prints a row per model and a weekly rate", () => {
  const sum = summarize([{ id: "a", client: "github/cli", ...parseSessionLog(sonnetLog) }], { since: 0 });
  const text = formatReport(sum);
  assert.match(text, /Claude Sonnet 5\.5/);
  assert.match(text, /cold after idle/);
  assert.match(text, /per week/);
});

test("parseSince reads days, hours and all", () => {
  const now = T0;
  assert.equal(parseSince("7d", now), T0 - 7 * 24 * 60 * MIN);
  assert.equal(parseSince("12h", now), T0 - 12 * 60 * MIN);
  assert.equal(parseSince("all", now), 0);
  assert.equal(parseSince("soon", now), null);
});

test("report CLI reads a session-state directory and prints JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "cc-report-"));
  mkdirSync(join(root, "sess-1"));
  writeFileSync(join(root, "sess-1", "events.jsonl"), sonnetLog);
  writeFileSync(join(root, "sess-1", "workspace.yaml"), "id: sess-1\nclient_name: github/cli\n");
  mkdirSync(join(root, "empty"));
  const r = spawnSync(process.execPath, [REPORT, "--dir", root, "--since", "all", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.models[0].coldIdle, 1);
  assert.deepEqual(out.surfaces, { "github/cli": 1 });
});

test("report CLI fails clearly on a missing directory or bad flag", () => {
  const missing = spawnSync(process.execPath, [REPORT, "--dir", "/nonexistent/cc"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no session logs/);
  const bad = spawnSync(process.execPath, [REPORT, "--since", "soon"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
