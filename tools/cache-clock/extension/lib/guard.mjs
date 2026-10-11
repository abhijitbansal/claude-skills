// Decides what to do with a prompt the user just submitted.
//   allow  — send it, say nothing
//   warn   — send it, print the cold-rewrite price
//   refuse — drop it once; the identical resend in the same cold episode goes through

export const MODES = ["refuse", "warn", "off"];

/** One cold episode = one model's cache that expired at one instant. */
export const episodeKey = (snap) => `${snap.model}@${snap.expiresAt}`;

export function decide({ snap, prompt, config, refusedKey = null }) {
  if (String(prompt ?? "").trimStart().startsWith("/")) return { action: "allow" };
  if (config.mode === "off" || !snap || snap.state !== "cold") return { action: "allow" };
  if (snap.extraUsd === null || snap.extraUsd < config.minUsd) return { action: "allow" };
  const key = episodeKey(snap);
  if (config.mode === "refuse" && refusedKey !== key) return { action: "refuse", key };
  return { action: "warn", key };
}
