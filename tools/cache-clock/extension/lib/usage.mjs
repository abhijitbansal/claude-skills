// Pure helpers over Copilot `assistant.usage` / `session.usage_record` payloads.
//
// Prices come from the payload itself: `copilotUsage.tokenDetails[].costPerBatch`
// is nano-AIU per `batchSize` tokens, and 1 AI credit (1 AIU) = $0.01, so
// dollars = nano-AIU / 1e11. Nothing here ships a price table.

const NANO_AIU_PER_USD = 1e11;

// A call is "cold" when it read back less than this share of the previous
// call's context. Real calls are bimodal: a warm call reads ~100% of it, a cold
// one only Copilot's shared system prefix (~10k tokens, ~50% of a small context).
export const COLD_READ_SHARE = 0.9;

// A reported expiry further than this from its call is not believed.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

const TYPE_KEYS = { input: "input", cache_read: "read", cache_write: "write", output: "output" };

/** Dollars per token by type, or null when read or write pricing is missing. */
export function pricesFrom(tokenDetails) {
  if (!Array.isArray(tokenDetails)) return null;
  const prices = {};
  for (const d of tokenDetails) {
    const key = TYPE_KEYS[d?.tokenType];
    if (!key || !(d.batchSize > 0) || !Number.isFinite(d.costPerBatch)) continue;
    prices[key] = d.costPerBatch / d.batchSize / NANO_AIU_PER_USD;
  }
  if (prices.read === undefined || prices.write === undefined) return null;
  return {
    input: prices.input ?? prices.write,
    read: prices.read,
    write: prices.write,
    output: prices.output ?? 0,
  };
}

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

function toMs(value) {
  if (value === undefined || value === null) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** An expiry outside [at, at + 24h] is a unit or clock error: fall back to the ttl. */
function plausibleExpiry(expiresAt, at) {
  return expiresAt !== null && expiresAt >= at && expiresAt - at <= MAX_TTL_MS ? expiresAt : null;
}

/** Flattens one usage payload; `timestamp` is the event's time (ISO or ms). */
export function normalizeUsage(data, timestamp) {
  if (!data || typeof data.model !== "string" || !data.model) return null;
  const ttl = Number.isFinite(data.cacheTtlSeconds) && data.cacheTtlSeconds > 0 ? data.cacheTtlSeconds : null;
  const at = toMs(timestamp) ?? Date.now();
  return {
    model: data.model,
    displayName: data.modelDisplayName || data.model,
    at,
    inputTokens: num(data.inputTokens),
    readTokens: num(data.cacheReadTokens),
    writeTokens: num(data.cacheWriteTokens),
    outputTokens: num(data.outputTokens),
    expiresAt: plausibleExpiry(toMs(data.cacheExpiresAt), at),
    ttlSec: ttl,
    prices: pricesFrom(data.copilotUsage?.tokenDetails),
    initiator: data.initiator ?? null,
    interactionType: data.interactionType ?? null,
  };
}

/** When the cache from `call` expires: reported expiry, else call time + ttl, else null. */
export function expiryOf(call) {
  if (!call) return null;
  if (call.expiresAt !== null) return call.expiresAt;
  if (call.ttlSec !== null) return call.at + call.ttlSec * 1000;
  return null;
}

/** Compare consecutive conversation calls. A switch rewrite is not evidence of idle time. */
export function classifyCall(prev, cur) {
  if (!prev) return "first";
  if (cur.readTokens >= COLD_READ_SHARE * prev.inputTokens) return "warm";
  if (prev.model !== cur.model) return "cold-switch";
  const exp = expiryOf(prev);
  return exp !== null && cur.at > exp ? "cold-idle" : "cold-break";
}

/** Tokens of the previous context that had to be written again instead of read. */
export function lostTokens(prev, cur) {
  if (!prev) return 0;
  return Math.max(0, Math.min(prev.inputTokens, cur.inputTokens) - cur.readTokens);
}

/**
 * Dollars a cold call paid above what a warm read of the same tokens would cost.
 * Lost tokens it wrote to cache cost write - read each; any sent uncached, input - read.
 */
export function extraUsd(prev, cur) {
  if (!cur.prices) return null;
  const lost = lostTokens(prev, cur);
  const written = Math.min(lost, cur.writeTokens);
  const { write, read, input } = cur.prices;
  return written * (write - read) + (lost - written) * Math.max(0, input - read);
}

/** Main-agent conversation calls only: sub-agent and background calls keep their own caches. */
export const MAIN_INTERACTION = "conversation-agent";
export const isMainInteraction = (call) => (call.interactionType ?? MAIN_INTERACTION) === MAIN_INTERACTION;

/** What the next send costs to (re)load the context: cold rewrite vs warm read. */
export function nextSendCosts(last) {
  if (!last?.prices) return null;
  const contextTokens = last.inputTokens + last.outputTokens;
  const coldUsd = contextTokens * last.prices.write;
  const warmUsd = contextTokens * last.prices.read;
  return { contextTokens, coldUsd, warmUsd, extraUsd: coldUsd - warmUsd };
}
