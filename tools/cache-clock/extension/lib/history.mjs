// Reads Copilot's persisted session logs (~/.copilot/session-state/<id>/events.jsonl)
// and totals what cold sends cost. Pure: callers pass file contents in.

import { classifyCall, extraUsd, lostTokens, normalizeUsage } from "./usage.mjs";
import { tokens, usd } from "./format.mjs";

const NANO_AIU_PER_USD = 1e11;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Usage records (keyed by agent), the last checkpoint and the last event time of one log. */
export function parseSessionLog(text) {
  const calls = [];
  let checkpoint = null;
  let badLines = 0;
  let lastAt = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    const at = Date.parse(event.timestamp);
    if (Number.isFinite(at)) lastAt = Math.max(lastAt ?? at, at);
    if (event.type === "session.usage_checkpoint") checkpoint = event.data ?? null;
    if (event.type !== "session.usage_record") continue;
    const raw = event.data?.usage;
    const call = normalizeUsage(raw, event.timestamp);
    if (!call) continue;
    calls.push({ agentKey: event.agentId ?? "main", call, nanoAiu: raw.copilotUsage?.totalNanoAiu ?? 0 });
  }
  return { calls, checkpoint, badLines, lastAt };
}

function emptyModel(call) {
  return { model: call.model, displayName: call.displayName, calls: 0, coldIdle: 0, coldBreak: 0, lostTokens: 0, extraUsd: 0, spentUsd: 0, idleMinutes: [] };
}

/**
 * sessions: [{ id, client, calls, checkpoint, lastAt }] from parseSessionLog.
 * Calls before `since` still seed the previous-call state, so the first counted
 * call is classified against its real predecessor.
 */
export function summarize(sessions, { since = 0 } = {}) {
  const models = new Map();
  const surfaces = {};
  let withCalls = 0;
  let checkpointOnly = 0;
  let checkpointOnlyUsd = 0;
  let firstAt = null;
  let lastAt = null;

  for (const s of sessions) {
    const counted = s.calls.filter(({ call }) => call.at >= since);
    if (!counted.length) {
      if (!s.calls.length && s.checkpoint && (s.lastAt ?? 0) >= since) {
        checkpointOnly += 1;
        checkpointOnlyUsd += (s.checkpoint.totalNanoAiu ?? 0) / NANO_AIU_PER_USD;
        surfaces[s.client ?? "unknown"] = (surfaces[s.client ?? "unknown"] ?? 0) + 1;
      }
      continue;
    }
    withCalls += 1;
    surfaces[s.client ?? "unknown"] = (surfaces[s.client ?? "unknown"] ?? 0) + 1;
    const prevByKey = new Map();
    for (const { agentKey, call, nanoAiu } of s.calls) {
      const key = `${agentKey}:${call.model}`;
      const prev = prevByKey.get(key) ?? null;
      prevByKey.set(key, call);
      if (call.at < since) continue;
      firstAt = Math.min(firstAt ?? call.at, call.at);
      lastAt = Math.max(lastAt ?? call.at, call.at);
      const m = models.get(call.model) ?? emptyModel(call);
      models.set(call.model, m);
      const kind = classifyCall(prev, call);
      m.calls += 1;
      m.spentUsd += nanoAiu / NANO_AIU_PER_USD;
      if (kind !== "cold-idle" && kind !== "cold-break") continue;
      m.lostTokens += lostTokens(prev, call);
      m.extraUsd += extraUsd(prev, call);
      if (kind === "cold-break") m.coldBreak += 1;
      else {
        m.coldIdle += 1;
        m.idleMinutes.push(Math.round((call.at - prev.at) / 60_000));
      }
    }
  }

  const list = [...models.values()].sort((a, b) => b.extraUsd - a.extraUsd);
  const extraUsdTotal = list.reduce((t, m) => t + m.extraUsd, 0);
  const days = firstAt === null ? 0 : Math.max(1, (lastAt - firstAt) / DAY_MS);
  return {
    since,
    firstAt,
    lastAt,
    models: list,
    extraUsd: extraUsdTotal,
    spentUsd: list.reduce((t, m) => t + m.spentUsd, 0),
    perWeekUsd: days ? (extraUsdTotal / days) * 7 : 0,
    sessions: { withCalls, checkpointOnly, checkpointOnlyUsd },
    surfaces,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function formatReport(sum) {
  const out = [];
  const span = sum.firstAt === null ? "no model calls" : `${new Date(sum.firstAt).toISOString().slice(0, 10)} to ${new Date(sum.lastAt).toISOString().slice(0, 10)}`;
  out.push(`cache-clock report · ${span} · ${sum.sessions.withCalls} sessions with per-call records`);
  out.push("");
  out.push(`${pad("model", 22)}${lpad("calls", 7)}${lpad("cold after idle", 17)}${lpad("prefix breaks", 15)}${lpad("rewritten", 11)}${lpad("extra paid", 12)}${lpad("total spent", 13)}  idle before cold sends`);
  for (const m of sum.models) {
    const idle = m.idleMinutes.length ? m.idleMinutes.slice(0, 8).map((x) => `${x}m`).join(", ") + (m.idleMinutes.length > 8 ? ", …" : "") : "-";
    out.push(`${pad(m.displayName.slice(0, 21), 22)}${lpad(m.calls, 7)}${lpad(m.coldIdle, 17)}${lpad(m.coldBreak, 15)}${lpad(tokens(m.lostTokens), 11)}${lpad(usd(m.extraUsd), 12)}${lpad(usd(m.spentUsd), 13)}  ${idle}`);
  }
  out.push("");
  out.push(`extra paid for cold rewrites: ${usd(sum.extraUsd)} of ${usd(sum.spentUsd)} spent · about ${usd(sum.perWeekUsd)} per week at this rate`);
  if (sum.sessions.checkpointOnly) {
    const n = sum.sessions.checkpointOnly;
    out.push(`${n} ${n === 1 ? "session" : "sessions"} (${usd(sum.sessions.checkpointOnlyUsd)}) kept only totals, no per-call records; not in the table.`);
  }
  out.push(`surfaces: ${Object.entries(sum.surfaces).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  return out.join("\n");
}

/** "7d" | "12h" | "all" -> epoch ms lower bound, or null when unparseable. */
export function parseSince(text, now = Date.now()) {
  if (text === "all") return 0;
  const m = /^(\d+)([dh])$/.exec(String(text));
  if (!m) return null;
  return now - Number(m[1]) * (m[2] === "d" ? DAY_MS : 60 * 60 * 1000);
}
