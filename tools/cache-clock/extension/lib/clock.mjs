// Per-model cache clock for one session, fed by normalized usage records.
// Pure: no timers, no I/O; every query takes `now`.

import { classifyCall, expiryOf, extraUsd, lostTokens, nextSendCosts } from "./usage.mjs";

export function createClock() {
  const lastByModel = new Map();
  let lastModel = null;
  // Models whose last call predates a compaction: their next call starts a new context.
  let staleModels = new Set();
  let tally = { calls: 0, coldIdle: 0, coldBreak: 0, extraUsd: 0 };

  function ingest(call) {
    if (!call) return null;
    // After a compaction the context is new: its first write is not a cold rewrite.
    const prev = staleModels.has(call.model) ? null : (lastByModel.get(call.model) ?? null);
    const kind = classifyCall(prev, call);
    const isCold = kind === "cold-idle" || kind === "cold-break";
    const lost = isCold ? lostTokens(prev, call) : 0;
    const extra = isCold ? extraUsd(prev, call) : 0;
    tally = {
      calls: tally.calls + 1,
      coldIdle: tally.coldIdle + (kind === "cold-idle" ? 1 : 0),
      coldBreak: tally.coldBreak + (kind === "cold-break" ? 1 : 0),
      extraUsd: tally.extraUsd + extra,
    };
    lastByModel.set(call.model, call);
    lastModel = call.model;
    staleModels = new Set([...staleModels].filter((m) => m !== call.model));
    return { kind, lostTokens: lost, extraUsd: extra, call };
  }

  /** The context was rewritten (compaction): the next send's cost is not an idle tax. */
  function invalidate() {
    staleModels = new Set(lastByModel.keys());
  }

  function snapshot(now, model = lastModel) {
    const last = model ? lastByModel.get(model) : undefined;
    if (!last) return null;
    const expiresAt = expiryOf(last);
    const costs = nextSendCosts(last);
    let state = "unknown";
    if (!staleModels.has(last.model) && expiresAt !== null) state = now < expiresAt ? "warm" : "cold";
    return {
      model: last.model,
      displayName: last.displayName,
      state,
      expiresAt,
      msLeft: expiresAt === null ? null : expiresAt - now,
      ttlSec: last.ttlSec,
      lastCallAt: last.at,
      prices: last.prices,
      contextTokens: costs?.contextTokens ?? last.inputTokens + last.outputTokens,
      coldUsd: costs?.coldUsd ?? null,
      warmUsd: costs?.warmUsd ?? null,
      extraUsd: costs?.extraUsd ?? null,
    };
  }

  return {
    ingest,
    invalidate,
    snapshot,
    tally: () => ({ ...tally }),
    get lastModel() {
      return lastModel;
    },
  };
}
