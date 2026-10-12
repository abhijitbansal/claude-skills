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

/** The refuse-once message, for hosts that cannot ask a question. */
export function refusal(snap) {
  return `${coldQuestion(snap)} Send it again to pay it, or /clear and start fresh.`;
}

/** The cold-send price as an in-chat question, for hosts that can ask one. */
export function coldQuestion(snap) {
  return (
    `${NAME}: the ${snap.displayName} prompt cache went cold ${duration(snap.msLeft)} ago. ` +
    `Sending this rewrites about ${tokens(snap.contextTokens)} tokens at ${perM(snap.prices.write)} = ${usd(snap.coldUsd)} ` +
    `(a warm send would read them for ${usd(snap.warmUsd)}).`
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
  const guard = config.mode === "off" ? "off" : `${config.mode === "refuse" ? "ask before a cold send" : "warn"} above ${usd(config.minUsd)}`;
  const heads = config.headsUpMin > 0 ? `heads-up ${config.headsUpMin}m before expiry` : "no heads-up";
  return `${guard} · ${heads}`;
}

export function card(snap, tally, config) {
  if (!snap) return `${NAME}: no model call yet in this session.`;
  const ratio = snap.prices?.read > 0 ? `${Math.round(snap.prices.write / snap.prices.read)}× per token` : "prices not reported";
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
  `${NAME}: a clock for Copilot's prompt cache.`,
  "",
  "How it works",
  "  Every model call reports when its prompt cache expires and what a cache read and write cost.",
  "  On Claude a write costs 25x a read and the cache lives 5 minutes; on GPT-6 Luna 12.5x and 30 minutes.",
  "  After the cache expires, your next message rewrites the whole conversation at the write price.",
  "",
  "What happens on a costly cold send (guard refuse, the default)",
  "  If the cache has expired and the rewrite costs at least the threshold more than a warm send,",
  "  Cache Clock asks before sending: Send anyway, or Don't send (no model call, 0 AI credits).",
  "  It asks once per cold cache; after that your sends go through with a price note.",
  "  Where it cannot ask (copilot -p), it refuses the send once instead; send it again to pay.",
  "  It never stops slash commands, ! shell commands, or a message typed while a turn is running.",
  "",
  "Commands",
  "  /cache-clock                 the card: cache state, time left, next-send prices, session tally",
  "  /cache-clock guard refuse    ask (or refuse once) before a costly cold send (default)",
  "  /cache-clock guard warn      send it and print the price",
  "  /cache-clock guard off       no guard",
  "  /cache-clock min 0.25        only guard cold sends whose extra cost is at least $0.25 (default $0.10)",
  "  /cache-clock headsup 5       warn 5 minutes before the cache expires (off to disable)",
  "  /cache-clock help            this text",
  "",
  "What cold sends already cost you, across every saved session:",
  "  node ~/.copilot/extensions/cache-clock/report.mjs --since 7d",
  "",
  "VS Code Copilot chat: the same ~/.copilot/extensions install works in every workspace. In your VS Code",
  "User settings (not a workspace's .vscode/settings.json) set \"chat.canvases.enabled\": true and",
  "\"chat.defaultToCopilotHarness\": true, or pick Copilot (not Local) in each new chat's harness picker:",
  "the Local harness never loads extensions. Type /cache-clock in full (it is not listed in the / menu).",
  "The heads-up and price notes reach only VS Code's log there.",
  "VS Code's autopilot mode cancels extension questions: a costly cold send is then held, with a note.",
].join("\n");
