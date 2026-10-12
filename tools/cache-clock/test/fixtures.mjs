// Shared fixtures shaped like real Copilot CLI 1.0.95 `assistant.usage` payloads
// (trimmed copies of a persisted gpt-6-luna record).

export const LUNA_PRICES = [
  { batchSize: 1_000_000, costPerBatch: 10_000_000_000, tokenType: "input", model: "gpt-6-luna" },
  { batchSize: 1_000_000, costPerBatch: 1_000_000_000, tokenType: "cache_read", model: "gpt-6-luna" },
  { batchSize: 1_000_000, costPerBatch: 12_500_000_000, tokenType: "cache_write", model: "gpt-6-luna" },
  { batchSize: 1_000_000, costPerBatch: 50_000_000_000, tokenType: "output", model: "gpt-6-luna" },
];

// Claude Sonnet 5.5 list prices on Copilot: $2 / $0.10 / $2.50 / $10 per M tokens.
export const SONNET_PRICES = [
  { batchSize: 1_000_000, costPerBatch: 200_000_000_000, tokenType: "input", model: "claude-sonnet-5.5" },
  { batchSize: 1_000_000, costPerBatch: 10_000_000_000, tokenType: "cache_read", model: "claude-sonnet-5.5" },
  { batchSize: 1_000_000, costPerBatch: 250_000_000_000, tokenType: "cache_write", model: "claude-sonnet-5.5" },
  { batchSize: 1_000_000, costPerBatch: 1_000_000_000_000, tokenType: "output", model: "claude-sonnet-5.5" },
];

export function usage({
  model = "gpt-6-luna",
  at = "2026-10-10T08:15:56.769Z",
  input = 17117,
  read = 9428,
  write = 7686,
  output = 112,
  ttl = 1800,
  expiresAt,
  prices = model.startsWith("claude") ? SONNET_PRICES : LUNA_PRICES,
  initiator = "user",
  interactionType = "conversation-agent",
  display = model === "gpt-6-luna" ? "GPT-6 Luna" : "Claude Sonnet 5.5",
} = {}) {
  const exp = expiresAt === undefined ? new Date(Date.parse(at) + ttl * 1000).toISOString() : expiresAt;
  return {
    model,
    modelDisplayName: display,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    ...(exp === null ? {} : { cacheExpiresAt: exp }),
    ...(ttl === null ? {} : { cacheTtlSeconds: ttl }),
    initiator,
    interactionType,
    copilotUsage: {
      tokenDetails: prices.map((p) => ({
        ...p,
        tokenCount: { input: input - read - write, cache_read: read, cache_write: write, output }[p.tokenType],
      })),
      totalNanoAiu: 111133000,
    },
  };
}

export const T0 = Date.parse("2026-10-10T08:15:56.769Z");
export const MIN = 60_000;
