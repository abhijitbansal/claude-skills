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
  if (snap.reason === "model-switch") {
    return `${NAME}: switching to ${snap.displayName} may rewrite about ${tokens(snap.contextTokens)} tokens. ` +
      `At its last reported prices, a cold send would cost about ${usd(snap.coldUsd)} (warm: ${usd(snap.warmUsd)}). Cache reuse is unknown.`;
  }
  return (
    `${NAME}: the ${snap.displayName} prompt cache went cold ${duration(snap.msLeft)} ago. ` +
    `Sending this rewrites about ${tokens(snap.contextTokens)} tokens at ${perM(snap.prices.write)} = ${usd(snap.coldUsd)} ` +
    `(a warm send would read them for ${usd(snap.warmUsd)}).`
  );
}

export function coldWarn(snap) {
  if (snap.reason && snap.extraUsd === null) return `${NAME}: ${snap.displayName}: next-send cache state and price are unknown (${selectionReason(snap)}). Sending without a price-based guard.`;
  if (snap.reason === "model-switch") return coldQuestion(snap);
  return `${NAME}: sending cold, rewriting about ${tokens(snap.contextTokens)} tokens for ${usd(snap.coldUsd)} (warm: ${usd(snap.warmUsd)}).`;
}

export function headsUp(snap) {
  return (
    `${NAME}: the ${snap.displayName} cache (${tokens(snap.contextTokens)} tokens) goes cold in ${duration(snap.msLeft)}. ` +
    `A send after that rewrites it for about ${usd(snap.coldUsd)} instead of ${usd(snap.warmUsd)}.`
  );
}

/** `1 ping` or `n pings`. */
export const pings = (n) => (n === 1 ? "1 ping" : `${n} pings`);

const STOP_TEXT = {
  payback: "pings have cost as much as the cold rewrite they avoid",
  budget: "the keep-warm budget is spent",
  "window-end": "the keep-warm window ended",
  "cold-reply": "a ping came back cold, so pinging is not keeping this cache warm",
  "send-failed": "a ping failed to send or got no reply, and may have gone out",
  "not-refreshing": "a ping did not move the cache expiry forward, so pinging is not keeping this cache warm",
  "ping-cap": "the ping limit for this window was reached",
  "too-late": "the cache was about to expire before a ping could refresh it",
  unmeasured: "a ping's cost was not reported, so the budget cannot be enforced",
};

/** The note logged when keep-warm stops itself. `spend` is this window's { usd, pings }. */
export function keepWarmStopped(reason, spend) {
  return `${NAME}: keep-warm stopped: ${STOP_TEXT[reason] ?? reason} (${pings(spend.pings)}, ${usd(spend.usd)} this window).`;
}

// Why keep-warm is idle right now, in words, for the card.
const SKIP_TEXT = {
  busy: "a turn is running or about to start",
  "question-open": "waiting on an open question",
  auto: "the selection is Auto",
  "context-full": "the context is above 85% of the prompt limit",
  unpriced: "the model's price is unknown",
  locked: "another process holds this session's keep-warm lock",
  "model-switch": "the selected model is not the one that was warmed",
  "not-warm": "the cache is cold",
  invalid: "a setting or the window is not a usable number",
};

const GLOBAL_NOTE = "the setting is global: every open session runs its own window and budget";

/** The reply after the keep-warm settings were saved. */
export function keepWarmSaved(config) {
  if (!(config.keepWarmHours > 0)) return `${NAME}: keep-warm: off (saved for all sessions)`;
  return `${NAME}: keep-warm: ${config.keepWarmHours}h after your last message · budget ${usd(config.keepWarmMaxUsd)} · payback stop ${config.keepWarmPayback ? "on" : "off"} (saved for all sessions; each open session runs its own window and budget)`;
}

/** The cost question shown before a long keep-warm window is saved. `estimate` is keepWarmEstimate's result. */
export function keepWarmQuote(snap, hours, estimate) {
  if (!snap || !estimate) return `${NAME}: keep-warm for ${hours}h: cost unknown until a priced model call. This setting is global: every open session gets its own window and budget. Turn it on?`;
  return `${NAME}: keep-warm for ${hours}h on ${snap.displayName} (${tokens(snap.contextTokens)} tokens) sends about ${estimate.pings} pings, ` +
    `about ${usd(estimate.usd)} at the last reported prices; the budget and payback stop end it sooner. This setting is global, so every open session gets its own window and budget; this estimate is for one session. Turn it on?`;
}

/** The card's keep-warm line from the settings and the scheduler's status(). */
function keepWarmLine(config, keepWarm) {
  if (!(config.keepWarmHours > 0)) return "off (/cache-clock keepwarm on)";
  const { state, msLeft, usd: spent, pings: count, lastSkip, stopped, waitingOnQuestion } = keepWarm ?? {};
  if (state === "on") {
    const why = SKIP_TEXT[lastSkip] ? ` (${SKIP_TEXT[lastSkip]})` : "";
    const idle = lastSkip ? ` · last skip: ${lastSkip}${why}` : "";
    return `on · ${duration(msLeft)} left · ${pings(count)} · ${usd(spent)}${idle}${waitingOnQuestion ? " · waiting on an open question" : ""}`;
  }
  if (state === "stopped") return `stopped (${stopped}) · ${pings(count)} · ${usd(spent)}`;
  return `on (${config.keepWarmHours}h) · starts after your next message`;
}

function selectionReason(snap) {
  if (snap.reason === "auto") return "Auto has not resolved the next model";
  if (snap.reason === "qualified-selection") return "usage cannot verify the selected provider/context tier";
  if (snap.reason === "model-switch") return "model switched; previous cache may not cover this context";
  return "selected model unavailable";
}

function stateLine(snap) {
  if (snap.reason) return `unknown (${selectionReason(snap)})`;
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

export function card(snap, tally, config, keepWarm = null) {
  if (!snap) return `${NAME}: no model call yet in this session.`;
  const ratio = snap.prices?.read > 0 ? `${Math.round(snap.prices.write / snap.prices.read)}× per token` : "prices not reported";
  const lines = [
    `${NAME} · ${snap.displayName}`,
    `  cache      ${stateLine(snap)}`,
    `  context    ${tokens(snap.contextTokens)} tokens`,
    `  next send  warm ${usd(snap.warmUsd)} · cold ${usd(snap.coldUsd)} (${ratio})`,
    `  session    ${tally.calls} model calls · ${tally.coldIdle} cold after idle · ${tally.coldBreak} prefix breaks · ${tally.coldSwitch ?? 0} switch rewrites · ${usd(tally.extraUsd)} estimated extra` +
      (tally.unpricedRewrites ? ` (priced subtotal; ${tally.unpricedRewrites} rewrite(s) missing prices)` : ""),
    `  guard      ${guardLine(config)}`,
    `  keep-warm  ${keepWarmLine(config, keepWarm)}`,
    ...(config.keepWarmHours > 0 ? [`             ${GLOBAL_NOTE}`] : []),
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
  "  Model switches use the selected model's observed prices and the latest conversation size.",
  "  Cache reuse after a switch is unknown; with known prices, it asks about a possible rewrite.",
  "  Auto is priced as the model it last resolved to. Unresolved or unpriced Auto warns once and sends.",
  "  Unknown selection/prices or unverified provider/context tier: warn and send, never borrow another model's price.",
  "",
  "Keep-warm (off until you turn it on; it costs money)",
  "  While you are away, Cache Clock can send a tiny ping before the cache expires, so your next message",
  "  reads the conversation at the warm price instead of rewriting it. Each ping is a small model call.",
  "  It starts from your last message and stops by itself when pings cost as much as one cold rewrite,",
  "  when the budget is spent, when the window ends, or when a ping fails or comes back cold.",
  "  The setting is global: every open session gets its own window and its own budget.",
  "",
  "Commands",
  "  /cache-clock                 the card: cache state, time left, next-send prices, session tally",
  "  /cache-clock guard refuse    ask (or refuse once) before a costly cold send (default)",
  "  /cache-clock guard warn      send it and print the price",
  "  /cache-clock guard off       no guard",
  "  /cache-clock min 0.25        only guard cold sends whose extra cost is at least $0.25 (default $0.10)",
  "  /cache-clock headsup 5       warn 5 minutes before the cache expires (off to disable)",
  "  /cache-clock keepwarm on     keep warm 3 hours after your last message",
  "  /cache-clock keepwarm 6      0 to 12 hours; above 6 shows the estimated cost first",
  "  /cache-clock keepwarm 8 yes  confirm a window above 6 hours where the host cannot ask",
  "  /cache-clock keepwarm off",
  "  /cache-clock keepwarm budget 0.50   stop after $0.50 of pings in one window, 0 to 5",
  "  /cache-clock keepwarm payback off   keep pinging after pings cost more than one cold rewrite",
  "  /cache-clock help            this text",
  "",
  "What cold sends already cost you, across every saved session:",
  "  node ~/.copilot/extensions/cache-clock/report.mjs --since 7d",
  "",
  "VS Code Copilot chat: install into each repo (install.sh --project: .github/extensions/cache-clock)",
  "and set \"chat.canvases.enabled\": true in VS Code settings. Type /cache-clock in full",
  "(it is not listed in the / menu). The heads-up and price notes reach only VS Code's log there.",
  "VS Code's autopilot mode cancels extension questions: a costly cold send is then held, with a note.",
].join("\n");
