// Text for the timeline: money, durations, the card, the refusal and the heads-up.

const NAME = "cache-clock";

export function usd(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "?";
  if (x === 0) return "$0";
  if (x >= 0.01) return `$${x.toFixed(2)}`;
  if (x >= 0.001) return `$${x.toFixed(3)}`;
  return "<$0.001";
}

/** Dollars per token shown per million tokens: $2.50/M, $0.125/M. */
export function perM(perToken) {
  const v = perToken * 1e6;
  const s = v.toFixed(3).replace(/0$/, "");
  return `$${s}/M`;
}

export function duration(ms) {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function tokens(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}

export function refusal(snap) {
  return (
    `${NAME}: the ${snap.displayName} prompt cache went cold ${duration(snap.msLeft)} ago. ` +
    `Sending this rewrites about ${tokens(snap.contextTokens)} tokens at ${perM(snap.prices.write)} = ${usd(snap.coldUsd)} ` +
    `(a warm send would read them for ${usd(snap.warmUsd)}). ` +
    `Send it again to pay it, or /clear and start fresh.`
  );
}

export function coldWarn(snap) {
  return `${NAME}: sending cold, rewriting about ${tokens(snap.contextTokens)} tokens for ${usd(snap.coldUsd)} (warm: ${usd(snap.warmUsd)}).`;
}

export function headsUp(snap) {
  return (
    `${NAME}: the ${snap.displayName} cache (${tokens(snap.contextTokens)} tokens) goes cold in ${duration(snap.msLeft)}. ` +
    `A send after that rewrites it for about ${usd(snap.coldUsd)} instead of ${usd(snap.warmUsd)}.`
  );
}

function stateLine(snap) {
  const ttl = snap.ttlSec === null ? "" : ` (ttl ${duration(snap.ttlSec * 1000)})`;
  if (snap.state === "warm") return `warm, ${duration(snap.msLeft)} left${ttl}`;
  if (snap.state === "cold") return `cold for ${duration(snap.msLeft)}${ttl}`;
  return "unknown (no expiry reported, or the context was compacted)";
}

function guardLine(config) {
  const guard = config.mode === "off" ? "off" : `${config.mode === "refuse" ? "refuse once" : "warn"} above ${usd(config.minUsd)}`;
  const heads = config.headsUpMin > 0 ? `heads-up ${config.headsUpMin}m before expiry` : "no heads-up";
  return `${guard} · ${heads}`;
}

export function card(snap, tally, config) {
  if (!snap) return `${NAME}: no model call yet in this session.`;
  const ratio = snap.prices ? `${Math.round(snap.prices.write / snap.prices.read)}× per token` : "prices not reported";
  const lines = [
    `${NAME} · ${snap.displayName}`,
    `  cache      ${stateLine(snap)}`,
    `  context    ${tokens(snap.contextTokens)} tokens`,
    `  next send  warm ${usd(snap.warmUsd)} · cold ${usd(snap.coldUsd)} (${ratio})`,
    `  session    ${tally.calls} model calls · ${tally.coldIdle} cold after idle · ${tally.coldBreak} prefix breaks · ${usd(tally.extraUsd)} extra paid`,
    `  guard      ${guardLine(config)}`,
  ];
  return lines.join("\n");
}

export const HELP = [
  `${NAME} commands:`,
  "  /cache-clock                 the card: cache state, next-send prices, session tally",
  "  /cache-clock guard refuse    drop a costly cold send once; the resend goes through (default)",
  "  /cache-clock guard warn      send it and print the price",
  "  /cache-clock guard off       no guard",
  "  /cache-clock min 0.25        only guard cold sends whose extra cost is at least $0.25",
  "  /cache-clock headsup 5       warn 5 minutes before the cache expires (off to disable)",
].join("\n");
