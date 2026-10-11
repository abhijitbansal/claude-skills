// Decides what to do with a prompt the user just submitted.
//   allow  — send it, say nothing
//   warn   — send it, print the cold-rewrite price
//   refuse — drop it once; the next send in the same cold episode goes through

export const MODES = ["refuse", "warn", "off"];

/** One cold episode = one model's cache that expired at one instant. */
export const episodeKey = (snap) => `${snap.model}@${snap.expiresAt}`;

// A slash command (`/name`, `/name args`) or a `!` shell escape never calls the
// model with the conversation, so it is never guarded. A pasted path like
// `/etc/hosts is broken` is a prompt.
const NOT_A_PROMPT = /^(\/[A-Za-z][\w-]*(\s|$)|!)/;

export function decide({ snap, prompt, config, refusedKey = null, busy = false }) {
  if (NOT_A_PROMPT.test(String(prompt ?? "").trimStart())) return { action: "allow" };
  if (config.mode === "off" || !snap || snap.state !== "cold") return { action: "allow" };
  if (snap.extraUsd === null || snap.extraUsd < config.minUsd) return { action: "allow" };
  const key = episodeKey(snap);
  // A prompt queued while a turn runs must not abort that turn: warn only.
  if (config.mode === "refuse" && refusedKey !== key && !busy) return { action: "refuse", key };
  return { action: "warn", key };
}
