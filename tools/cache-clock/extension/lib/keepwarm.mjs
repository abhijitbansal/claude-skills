// Keep-warm: an occasional tiny request that refreshes the provider prompt cache
// while the owner is away. This module owns the ping marker, the pure planner and,
// later, the scheduler. It imports nothing from guard, history or wiring.

export const PING_MARKER = "[cache-clock:keepwarm]";
export const PING_PROMPT = `${PING_MARKER} Reply with exactly: .`;
export const PING_DISPLAY = "cache-clock keep-warm";

/** True when the text opens with the marker. A prompt that merely mentions it is a real prompt. */
export const isPingText = (text) => String(text ?? "").trimStart().startsWith(PING_MARKER);

/**
 * True for a `user.message` payload that carries a ping: the marker opens its content or its
 * transformed content, or it is the system-sourced display text.
 */
export function isPingMessage(data) {
  if (!data || typeof data !== "object") return false;
  if (isPingText(data.content) || isPingText(data.transformedContent)) return true;
  return data.source === "system" && data.content === PING_DISPLAY;
}

// A ping fires this share of the cache lifetime before expiry, within these bounds.
export const LEAD_SHARE = 0.2;
export const LEAD_MIN_MS = 30_000;
export const LEAD_MAX_MS = 360_000;
// Pinging stops once the context fills this share of the model's prompt limit.
export const CONTEXT_LIMIT_SHARE = 0.85;
// Money comparisons tolerate float noise of this size.
export const USD_EPSILON = 1e-9;
const HOUR_MS = 3_600_000;

const isAmount = (v) => typeof v === "number" && Number.isFinite(v);

/** How long before expiry a ping fires: 20% of the cache lifetime, within 30 s and 6 min. */
export const leadMs = (lifetimeMs) => Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, LEAD_SHARE * lifetimeMs));

/** Cache lifetime in ms: the reported ttl, else the span of the last call's own expiry. */
const lifetimeOf = (snapshot) => (snapshot.ttlSec ? snapshot.ttlSec * 1000 : snapshot.expiresAt - snapshot.lastCallAt);

/** The first reason not to ping before any timing is computed, or null. Order matters. */
function sessionSkip({ snapshot, config, window, session }) {
  if (!(config.keepWarmHours > 0)) return "off";
  if (!window) return "no-window";
  // Auto runs before the warm check: an unresolved Auto snapshot is also "unknown".
  if (session.selectedModel === "auto") return "auto";
  if (!snapshot || snapshot.state !== "warm") return "not-warm";
  if (session.selectedModel !== snapshot.model) return "model-switch";
  if (session.busy || session.pendingPrompt || session.questionOpen) return "busy";
  const limit = snapshot.maxPromptTokens;
  if (limit && snapshot.contextTokens > CONTEXT_LIMIT_SHARE * limit) return "context-full";
  return null;
}

/** The first reason not to send the next ping once its time and price are known, or null. */
function priceSkip({ snapshot, config, spend }) {
  if (!isAmount(snapshot.warmUsd) || !isAmount(snapshot.extraUsd)) return "unpriced";
  const after = spend.usd + snapshot.warmUsd;
  if (after > config.keepWarmMaxUsd + USD_EPSILON) return "budget";
  // Pings must stay cheaper than the one cold rewrite they exist to avoid.
  if (config.keepWarmPayback && after > snapshot.extraUsd + USD_EPSILON) return "payback";
  return null;
}

/**
 * Decides whether and when to send the next keep-warm ping.
 * Returns { at } (ms) or { skip } naming the first reason not to.
 */
export function planPing({ snapshot, config, window, spend, session, now }) {
  const early = sessionSkip({ snapshot, config, window, session });
  if (early) return { skip: early };
  const at = Math.max(now, snapshot.expiresAt - leadMs(lifetimeOf(snapshot)));
  if (at > window.endsAt) return { skip: "window-ended" };
  const priced = priceSkip({ snapshot, config, spend });
  return priced ? { skip: priced } : { at };
}

/** Rough pings and dollars for `hours` of keep-warm at the snapshot's prices, or null if unknown. */
export function keepWarmEstimate(snapshot, hours) {
  if (!snapshot || !snapshot.ttlSec || !isAmount(snapshot.warmUsd)) return null;
  const lifetime = snapshot.ttlSec * 1000;
  const pings = Math.floor((hours * HOUR_MS) / (lifetime - leadMs(lifetime)));
  return { pings, usd: pings * snapshot.warmUsd };
}
