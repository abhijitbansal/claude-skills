// Reads Copilot's persisted session logs (~/.copilot/session-state/<id>/events.jsonl)
// and totals what cold sends cost. Pure: callers pass file contents in.

import { classifyCall, extraUsd, isMainInteraction, lostTokens, normalizeUsage } from "./usage.mjs";
import { tokens, usd } from "./format.mjs";

const NANO_AIU_PER_USD = 1e11;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Usage records (keyed by agent), the last checkpoint and the last event time of one log. */
export function parseSessionLog(text) {
  const calls = [];
  let checkpoint = null;
  let badLines = 0;
  let lastAt = null;
  // Calls in different epochs are never compared: a compaction rewrote the context in between.
  const epochs = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (!event || typeof event !== "object") {
      badLines += 1;
      continue;
    }
    const at = Date.parse(event.timestamp);
    if (Number.isFinite(at)) lastAt = Math.max(lastAt ?? at, at);
    if (event.type === "session.usage_checkpoint") checkpoint = event.data ?? null;
    const agentKey = event.agentId ?? "main";
    if (event.type === "session.compaction_complete" && event.data?.success !== false) epochs.set(agentKey, (epochs.get(agentKey) ?? 0) + 1);
    if (event.type !== "session.usage_record") continue;
    const raw = event.data?.usage;
    const call = normalizeUsage(raw, event.timestamp);
    if (!call) continue;
    calls.push({ agentKey, call, epoch: epochs.get(agentKey) ?? 0, nanoAiu: raw.copilotUsage?.totalNanoAiu ?? 0 });
  }
  return { calls, checkpoint, badLines, lastAt };
}

function emptyModel(call) {
  return { model: call.model, displayName: call.displayName, calls: 0, coldIdle: 0, coldBreak: 0, coldSwitch: 0, lostTokens: 0, extraUsd: 0, unpricedRewrites: 0, spentUsd: 0, idleMinutes: [] };
}

/**
 * sessions: [{ id, client, calls, checkpoint, lastAt }] from parseSessionLog.
 * Calls before `since` still seed the previous-call state, so the first counted
 * call is classified against its real predecessor.
 */
export function summarize(sessions, { since = 0, now = Date.now() } = {}) {
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
    for (const { agentKey, call, epoch, nanoAiu } of s.calls) {
      const key = agentKey;
      const last = isMainInteraction(call) ? prevByKey.get(key) : undefined;
      const prev = last && last.epoch === epoch ? last.call : null;
      if (isMainInteraction(call)) prevByKey.set(key, { call, epoch });
      if (call.at < since) continue;
      firstAt = Math.min(firstAt ?? call.at, call.at);
      lastAt = Math.max(lastAt ?? call.at, call.at);
      const m = models.get(call.model) ?? emptyModel(call);
      models.set(call.model, m);
      m.calls += 1;
      m.spentUsd += nanoAiu / NANO_AIU_PER_USD;
      // Background calls (titles, summaries) cost money but keep their own cache.
      if (!isMainInteraction(call)) continue;
      const kind = classifyCall(prev, call);
      if (!kind.startsWith("cold-")) continue;
      m.lostTokens += lostTokens(prev, call);
      const extra = extraUsd(prev, call);
      m.extraUsd += extra ?? 0;
      if (extra === null) m.unpricedRewrites += 1;
      if (kind === "cold-switch") m.coldSwitch += 1;
      else if (kind === "cold-break") m.coldBreak += 1;
      else {
        m.coldIdle += 1;
        m.idleMinutes.push(Math.round((call.at - prev.at) / 60_000));
      }
    }
  }

  const list = [...models.values()].sort((a, b) => b.extraUsd - a.extraUsd);
  const extraUsdTotal = list.reduce((t, m) => t + m.extraUsd, 0);
  const unpricedRewrites = list.reduce((t, m) => t + m.unpricedRewrites, 0);
  // A bounded window spreads over the whole window, not just the hours that had calls.
  const spanMs = firstAt === null ? 0 : Math.max(lastAt - firstAt, since > 0 ? now - since : 0);
  const days = firstAt === null ? 0 : Math.max(1, spanMs / DAY_MS);
  return {
    since,
    firstAt,
    lastAt,
    models: list,
    extraUsd: extraUsdTotal,
    unpricedRewrites,
    spentUsd: list.reduce((t, m) => t + m.spentUsd, 0),
    perWeekUsd: unpricedRewrites ? null : days ? (extraUsdTotal / days) * 7 : 0,
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
  out.push(`${pad("model", 22)}${lpad("calls", 7)}${lpad("cold after idle", 17)}${lpad("prefix breaks", 15)}${lpad("switch rewrites", 17)}${lpad("rewritten", 11)}${lpad("extra est.", 12)}${lpad("total spent", 13)}  idle before cold sends`);
  for (const m of sum.models) {
    const idle = m.idleMinutes.length ? m.idleMinutes.slice(0, 8).map((x) => `${x}m`).join(", ") + (m.idleMinutes.length > 8 ? ", …" : "") : "-";
    out.push(`${pad(m.displayName.slice(0, 21), 22)}${lpad(m.calls, 7)}${lpad(m.coldIdle, 17)}${lpad(m.coldBreak, 15)}${lpad(m.coldSwitch, 17)}${lpad(tokens(m.lostTokens), 11)}${lpad(usd(m.extraUsd) + (m.unpricedRewrites ? "*" : ""), 12)}${lpad(usd(m.spentUsd), 13)}  ${idle}`);
  }
  out.push("");
  out.push(`estimated extra for cold rewrites: ${usd(sum.extraUsd)} of ${usd(sum.spentUsd)} spent` +
    (sum.unpricedRewrites ? ` (priced subtotal only; ${sum.unpricedRewrites} rewrite(s) missing prices; * marks incomplete rows)` : ` · about ${usd(sum.perWeekUsd)} per week at this rate`));
  out.push("Switch rewrites describe observed read loss, not proof the model switch caused it. Extra cost is estimated against a warm read, not measured savings.");
  if (sum.sessions.checkpointOnly) {
    const n = sum.sessions.checkpointOnly;
    out.push(`${n} ${n === 1 ? "session" : "sessions"} (${usd(sum.sessions.checkpointOnlyUsd)}) kept only totals, no per-call records; not in the table. These are whole-session totals, which may include spending before this window.`);
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
