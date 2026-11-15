// Keep-warm: an occasional tiny request that refreshes the provider prompt cache
// while the owner is away. This module owns the ping marker, the pure planner and the
// scheduler. It imports nothing from guard, history or wiring.

import { keepWarmStopped } from "./format.mjs";

export const PING_MARKER = "[cache-clock:keepwarm]";
export const PING_PROMPT = `${PING_MARKER} Reply with exactly: .`;
export const PING_DISPLAY = "cache-clock keep-warm";

/**
 * True only for the exact ping prompt. A user can type or paste the marker, so the marker alone
 * proves nothing: callers also require their own ping to be in flight before they trust this.
 */
export const isPingPrompt = (text) => text === PING_PROMPT;

/**
 * True for a `user.message` payload that is one of our pings: its content or transformed content
 * is the exact ping prompt, or it is the system-sourced display text. A message from any other
 * source (a user) never is, whatever it says.
 */
export function isPingMessage(data) {
  if (!data || typeof data !== "object") return false;
  const source = data.source ?? null;
  if (source !== null && source !== "system") return false;
  if (data.content === PING_PROMPT || data.transformedContent === PING_PROMPT) return true;
  return source === "system" && data.content === PING_DISPLAY;
}

/**
 * Tells which usage records of a session log belong to pings, by the order of its user messages:
 * a ping has one record, and a message typed while it ran must not take it. Feed every root user
 * message to `onMessage` and every main-conversation usage record to `onUsage`, in log order.
 */
export function createPingLedger() {
  const turns = []; // oldest first: { ping, used }
  return {
    onMessage(data) {
      turns.push({ ping: isPingMessage(data), used: false });
    },
    /** True when this record is a ping's. */
    onUsage() {
      // A real turn that has had its records and has a newer message behind it is over.
      while (turns.length > 1 && !turns[0].ping && turns[0].used) turns.shift();
      const turn = turns[0];
      if (!turn) return false;
      turn.used = true;
      if (turn.ping) turns.shift();
      return turn.ping;
    },
  };
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

/** Cache lifetime in ms: the reported ttl, else the span from the request start to its expiry. */
const lifetimeOf = (snapshot) => (snapshot.ttlSec ? snapshot.ttlSec * 1000 : snapshot.expiresAt - snapshot.startAt);

/** The first reason not to ping before any timing is computed, or null. Order matters. */
function sessionSkip({ snapshot, config, window, session }) {
  if (!(config.keepWarmHours > 0)) return "off";
  if (!window) return "no-window";
  // A window end that is not a number would make every later comparison false.
  if (!isAmount(window.endsAt)) return "invalid";
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
  // Without a numeric budget and spend, "over budget" is never true: refuse rather than ping unbounded.
  if (!isAmount(config.keepWarmMaxUsd) || !isAmount(spend.usd)) return "invalid";
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
  const lifetime = lifetimeOf(snapshot);
  if (!(lifetime > 0)) return { skip: "invalid" };
  const at = Math.max(now, snapshot.expiresAt - leadMs(lifetime));
  if (at > window.endsAt) return { skip: "window-ended" };
  const priced = priceSkip({ snapshot, config, spend });
  return priced ? { skip: priced } : { at };
}

export const RETRY_MS = 15_000;
export const IN_FLIGHT_TIMEOUT_MS = 120_000;
export const MAX_FAILED_SENDS = 2;
// A timer that wakes this much early still sends; one that finds the plan further out re-plans.
const FIRE_TOLERANCE_MS = 1000;
// Stops that mean something is wrong, not just that the window is over.
const WARN_STOPS = new Set(["cold-reply", "send-failed", "unmeasured"]);
// Planner skips that end the window, and the stop reason each is recorded as.
const SKIP_STOPS = { payback: "payback", budget: "budget", "window-ended": "window-end" };

/**
 * The keep-warm scheduler. Everything outside is injected: `send()` sends one ping,
 * `read()` returns { snapshot, config, session }, `store` keeps the window and the lock,
 * `now`, `setTimer`, `clearTimer` and `log(text, "info" | "warn")` are the host's.
 * It holds at most one plan timer; every re-plan starts from a fresh `read()`.
 */
export function createKeepWarm({ send, read, store, now, setTimer, clearTimer, log }) {
  let window = null;
  let timer = null;
  let watchdog = null;
  let inFlight = false;
  let sendId = 0;
  let failures = 0;
  let lastSkip = null;
  let saveWarned = false;
  let lockWarned = false;
  let holdsLock = false;
  let closed = false;

  const spend = () => ({ usd: window?.usd ?? 0, pings: window?.pings ?? 0 });
  const planNow = ({ snapshot, config, session }) => planPing({ snapshot, config, window, spend: spend(), session, now: now() });
  const clearAll = () => {
    clearTimer(timer);
    clearTimer(watchdog);
    timer = null;
    watchdog = null;
  };

  /** Writes the window; a failing store is reported once and keep-warm carries on from memory. */
  function persist() {
    if (!window || !(read().config.keepWarmHours > 0)) return;
    try {
      store.save(window);
    } catch (err) {
      if (saveWarned) return;
      saveWarned = true;
      log(`cache-clock: could not save the keep-warm window (${err.message}); a reload may restart its budget.`, "info");
    }
  }

  const arm = (at) => {
    clearTimer(timer);
    timer = setTimer(onTimer, Math.max(0, at - now()));
  };

  function reschedule() {
    clearTimer(timer);
    timer = null;
    if (closed || inFlight || window?.stopped) return;
    const plan = planNow(read());
    if ("at" in plan) {
      lastSkip = null;
      arm(plan.at);
      return;
    }
    lastSkip = plan.skip;
    if (SKIP_STOPS[plan.skip]) stop(SKIP_STOPS[plan.skip]);
  }

  function tryLock() {
    try {
      const held = store.lock() === true;
      holdsLock = holdsLock || held;
      return held;
    } catch (err) {
      if (!lockWarned) {
        lockWarned = true;
        log(`cache-clock: could not take the keep-warm lock (${err.message}); not pinging.`, "info");
      }
      return false;
    }
  }

  function onTimer() {
    timer = null;
    if (closed) return;
    const fresh = read();
    const plan = planNow(fresh);
    if (!("at" in plan) || plan.at - now() > FIRE_TOLERANCE_MS) {
      reschedule();
      return;
    }
    if (!tryLock()) {
      lastSkip = "locked";
      arm(now() + leadMs(lifetimeOf(fresh.snapshot)));
      return;
    }
    fire();
  }

  function fire() {
    inFlight = true;
    sendId += 1;
    const id = sendId;
    clearTimer(watchdog);
    watchdog = setTimer(() => failed(id, new Error(`no reply in ${IN_FLIGHT_TIMEOUT_MS / 1000}s`)), IN_FLIGHT_TIMEOUT_MS);
    try {
      Promise.resolve(send()).catch((err) => failed(id, err));
    } catch (err) {
      failed(id, err);
    }
  }

  /** One failed send, from a rejection or the watchdog. Stale ids (already answered or stopped) are ignored. */
  function failed(id, err) {
    if (!inFlight || id !== sendId) return;
    clearTimer(watchdog);
    watchdog = null;
    inFlight = false;
    failures += 1;
    log(`cache-clock: keep-warm ping failed (${err?.message ?? err}).`, "info");
    if (failures >= MAX_FAILED_SENDS) stop("send-failed");
    else arm(now() + RETRY_MS);
  }

  function releaseLock() {
    if (!holdsLock) return;
    holdsLock = false;
    try {
      store.unlock();
    } catch (err) {
      log(`cache-clock: could not release the keep-warm lock (${err.message}).`, "info");
    }
  }

  function stop(reason) {
    clearAll();
    inFlight = false;
    sendId += 1;
    if (reason === "shutdown") {
      closed = true;
      releaseLock();
      return;
    }
    if (window) {
      window = { ...window, stopped: reason };
      persist();
    }
    log(keepWarmStopped(reason, spend()), WARN_STOPS.has(reason) ? "warn" : "info");
  }

  function start() {
    if (read().config.keepWarmHours > 0) {
      try {
        window = store.load();
      } catch (err) {
        log(`cache-clock: could not read the keep-warm window (${err.message}); starting a new one.`, "info");
      }
    }
    reschedule();
  }

  function onUserTurn(at) {
    if (closed) return;
    const hours = read().config.keepWarmHours;
    window = { startedAt: at, endsAt: at + Math.max(0, hours) * HOUR_MS, usd: 0, pings: 0, stopped: null };
    failures = 0;
    persist();
    reschedule();
  }

  function configChanged() {
    if (closed) return;
    const { snapshot, config } = read();
    if (!(config.keepWarmHours > 0)) {
      clearTimer(timer);
      timer = null;
      window = null;
      return;
    }
    const startedAt = window?.startedAt ?? snapshot?.lastCallAt ?? null;
    if (startedAt === null) return; // no real turn yet: the window starts with the first one
    window = { usd: 0, pings: 0, stopped: null, ...window, startedAt, endsAt: startedAt + config.keepWarmHours * HOUR_MS };
    persist();
    reschedule();
  }

  function onPingUsage({ usd, warm }) {
    if (!inFlight || closed) return;
    if (usd === null || usd === undefined) {
      stop("unmeasured");
      return;
    }
    const base = window ?? { startedAt: now(), endsAt: now(), usd: 0, pings: 0, stopped: null };
    window = { ...base, usd: base.usd + usd, pings: base.pings + 1 };
    failures = 0;
    persist();
    if (!warm) stop("cold-reply");
  }

  function onIdle() {
    if (closed) return;
    inFlight = false;
    clearTimer(watchdog);
    watchdog = null;
    reschedule();
  }

  function onBusy() {
    clearTimer(timer);
    timer = null;
  }

  function status() {
    const hours = read().config.keepWarmHours;
    const base = { msLeft: window ? Math.max(0, window.endsAt - now()) : 0, ...spend(), lastSkip, stopped: window?.stopped ?? null, inFlight };
    if (!(hours > 0)) return { ...base, state: "off" };
    if (!window) return { ...base, state: "waiting" };
    if (window.stopped) return { ...base, state: "stopped" };
    // The window ran out while no timer was armed: say so without waiting for a re-plan.
    if (now() > window.endsAt) return { ...base, state: "stopped", stopped: "window-end", msLeft: 0 };
    return { ...base, state: "on" };
  }

  return { start, onUserTurn, onPingUsage, onIdle, onBusy, reschedule, configChanged, stop, status };
}

/** Pings the budget and the payback stop allow at the snapshot's price; Infinity when no cap applies. */
function affordablePings(snapshot, caps) {
  if (!caps || !(snapshot.warmUsd > 0)) return Infinity;
  const limits = [];
  if (isAmount(caps.keepWarmMaxUsd)) limits.push(caps.keepWarmMaxUsd);
  if (caps.keepWarmPayback && isAmount(snapshot.extraUsd)) limits.push(snapshot.extraUsd);
  return Math.min(Infinity, ...limits.map((usd) => Math.floor((usd + USD_EPSILON) / snapshot.warmUsd)));
}

/**
 * Rough pings and dollars for `hours` of keep-warm at the snapshot's prices, or null if unknown or
 * if the cache is too short to ping. `caps` ({ keepWarmMaxUsd, keepWarmPayback }) stops the
 * estimate where the budget and payback stops would, so a long window is not overstated.
 */
export function keepWarmEstimate(snapshot, hours, caps = null) {
  if (!snapshot || !snapshot.ttlSec || !isAmount(snapshot.warmUsd)) return null;
  const lifetime = snapshot.ttlSec * 1000;
  const interval = lifetime - leadMs(lifetime);
  if (!(interval > 0)) return null;
  const pings = Math.min(Math.floor((hours * HOUR_MS) / interval), affordablePings(snapshot, caps));
  return { pings, usd: pings * snapshot.warmUsd };
}
