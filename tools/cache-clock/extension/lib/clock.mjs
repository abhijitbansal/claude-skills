// Per-model cache clock for one session, fed by normalized usage records.
// Pure: no timers, no I/O; every query takes `now`.

import { classifyCall, expiryOf, extraUsd, lostTokens, nextSendCosts } from "./usage.mjs";

export function createClock() {
  const lastByModel = new Map();
  let lastModel = null;
  let lastConversation = null;
  // Observations from before compaction/configuration changes cannot prove cache warmth.
  let staleModels = new Set();
  let tally = { calls: 0, coldIdle: 0, coldBreak: 0, coldSwitch: 0, extraUsd: 0, unpricedRewrites: 0 };

  function ingest(call) {
    if (!call) return null;
    // After a compaction the context is new: its first write is not a cold rewrite.
    const prev = lastConversation;
    const kind = classifyCall(prev, call);
    const isCold = kind.startsWith("cold-");
    const lost = isCold ? lostTokens(prev, call) : 0;
    const extra = isCold ? extraUsd(prev, call) : 0;
    tally = {
      calls: tally.calls + 1,
      coldIdle: tally.coldIdle + (kind === "cold-idle" ? 1 : 0),
      coldBreak: tally.coldBreak + (kind === "cold-break" ? 1 : 0),
      coldSwitch: tally.coldSwitch + (kind === "cold-switch" ? 1 : 0),
      extraUsd: tally.extraUsd + (extra ?? 0),
      unpricedRewrites: tally.unpricedRewrites + (isCold && extra === null ? 1 : 0),
    };
    lastByModel.set(call.model, call);
    lastModel = call.model;
    lastConversation = call;
    staleModels = new Set([...staleModels].filter((m) => m !== call.model));
    return { kind, lostTokens: lost, extraUsd: extra, call };
  }

  /** The context was rewritten (compaction): the next send's cost is not an idle tax. */
  function invalidate({ forgetPrices = false } = {}) {
    staleModels = new Set(lastByModel.keys());
    lastConversation = null;
    if (forgetPrices) {
      for (const [model, call] of lastByModel) lastByModel.set(model, { ...call, prices: null });
    }
  }

  function snapshot(now, selection = lastModel) {
    if (!lastModel) return null;
    const model = typeof selection === "string" ? selection : selection?.modelId;
    const last = model ? lastByModel.get(model) : undefined;
    const context = lastConversation ?? lastByModel.get(lastModel);
    const contextTokens = context.inputTokens + context.outputTokens;
    // Usage has no provider/tier identity. Never attach its prices to a qualified
    // selection (or Auto, whose next concrete model has not been resolved).
    const unqualified = !selection?.providerId && !selection?.contextTier;
    if (!model || model === "auto" || !unqualified || model !== lastModel) {
      const priced = model && model !== "auto" && unqualified && lastConversation ? last?.prices : null;
      const costs = nextSendCosts({ ...context, prices: priced });
      return {
        model: model ?? "unknown", displayName: last?.displayName ?? model ?? "unknown selection",
        state: "unknown", reason: !model ? "selection-unavailable" : model === "auto" ? "auto" : !unqualified ? "qualified-selection" : "model-switch",
        expiresAt: null, msLeft: null, ttlSec: null, lastCallAt: context.at,
        contextTokens, prices: priced ?? null, coldUsd: costs?.coldUsd ?? null,
        warmUsd: costs?.warmUsd ?? null, extraUsd: costs?.extraUsd ?? null,
      };
    }
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
