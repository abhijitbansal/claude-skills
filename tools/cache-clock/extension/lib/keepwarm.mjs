// Keep-warm: an occasional tiny request that refreshes the provider prompt cache
// while the owner is away. This module owns the ping marker, the pure planner and the
// scheduler. It imports nothing from guard, history or wiring.
//
// Principle: fail closed. Anything keep-warm cannot measure or recognise stops it for the window,
// with one clear line; it never keeps going on a guess.

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
 * True for hook text that is, or wraps, our ping: it contains the marker or equals the display
 * text. Looser than `isPingPrompt` on purpose, because a host may hand the hook the display text,
 * a trailing newline or a transformed prompt. Only ever trust it while our own ping is in flight.
 */
export function looksLikePingText(text) {
  const s = String(text ?? "");
  return s.includes(PING_MARKER) || s.trim() === PING_DISPLAY;
}

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

// The ping asks for one character back, so its record has almost no output. A record with more
// is a real call, whatever message order says.
export const PING_MAX_OUTPUT_TOKENS = 30;
export const looksLikePing = (call) => call.outputTokens <= PING_MAX_OUTPUT_TOKENS;

/**
 * Tells which usage records of a session log belong to pings, by the order of its user messages
 * and the size of the record: a ping has one small record, a message typed while it ran must not
 * take it, and a ping message that never got a record must not claim the next user call.
 * Feed every root user message to `onMessage` and every main-conversation usage record to
 * `onUsage(looksLikePing(call))`, in log order.
 */
export function createPingLedger() {
  const turns = []; // oldest first: { ping, used }
  return {
    onMessage(data) {
      turns.push({ ping: isPingMessage(data), used: false });
    },
    /** True when this record is a ping's. */
    onUsage(pingSized) {
      // A real turn that has had its records and has a newer message behind it is over.
      while (turns.length > 1 && !turns[0].ping && turns[0].used) turns.shift();
      if (pingSized) {
        const at = turns.findIndex((turn) => turn.ping);
        if (at >= 0) {
          turns.splice(at, 1);
          return true;
        }
      }
      const real = turns.find((turn) => !turn.ping);
      if (real) real.used = true;
      return false;
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
// Pings are never closer together than this, whatever the cache lifetime says.
export const MIN_GAP_FLOOR_MS = 60_000;
// With less than this left on the cache, a ping cannot land before it expires.
export const TOO_LATE_MS = 15_000;
const HOUR_MS = 3_600_000;

const isAmount = (v) => typeof v === "number" && Number.isFinite(v);
const messageOf = (err) => err?.message ?? String(err);

/** How long before expiry a ping fires: 20% of the cache lifetime, within 30 s and 6 min. */
export const leadMs = (lifetimeMs) => Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, LEAD_SHARE * lifetimeMs));

/** The least time between two pings: the cache lifetime minus the lead, never under 60 s. */
export const minGapMs = (lifetimeMs) => Math.max(MIN_GAP_FLOOR_MS, lifetimeMs - leadMs(lifetimeMs));

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
  if (session.busy || session.pendingPrompt) return "busy";
  if (session.questionOpen) return "question-open";
  const limit = snapshot.maxPromptTokens;
  if (limit && snapshot.contextTokens > CONTEXT_LIMIT_SHARE * limit) return "context-full";
  return null;
}

/** The first reason not to send the next ping once its time and price are known, or null. */
function priceSkip({ snapshot, config, spend }) {
  // Without a numeric budget and spend, "over budget" is never true: refuse rather than ping unbounded.
  if (!isAmount(config.keepWarmMaxUsd) || !isAmount(spend.usd)) return "invalid";
  if (!isAmount(snapshot.warmUsd) || !isAmount(snapshot.extraUsd)) return "unpriced";
  // A ping that cost more than the estimate says what the next one will cost.
  const perPing = Math.max(snapshot.warmUsd, isAmount(spend.lastUsd) ? spend.lastUsd : 0);
  const after = spend.usd + perPing;
  if (after > config.keepWarmMaxUsd + USD_EPSILON) return "budget";
  // Pings must stay cheaper than the one cold rewrite they exist to avoid.
  if (config.keepWarmPayback && after > snapshot.extraUsd + USD_EPSILON) return "payback";
  return null;
}

/**
 * Decides whether and when to send the next keep-warm ping.
 * Returns { at } (ms) or { skip } naming the first reason not to. Limits that do not depend on
 * cost: a minimum gap since the last send, no ping with under 15 s left, and a cap on pings per window.
 */
export function planPing({ snapshot, config, window, spend, session, now }) {
  const early = sessionSkip({ snapshot, config, window, session });
  if (early) return { skip: early };
  const lifetime = lifetimeOf(snapshot);
  if (!(lifetime > 0)) return { skip: "invalid" };
  const gap = minGapMs(lifetime);
  const earliest = isAmount(window.lastSendAt) ? window.lastSendAt + gap : now;
  const at = Math.max(now, snapshot.expiresAt - leadMs(lifetime), earliest);
  if (snapshot.expiresAt - at < TOO_LATE_MS) return { skip: "too-late" };
  if (at > window.endsAt) return { skip: "window-ended" };
  const cap = isAmount(window.startedAt) ? Math.ceil((window.endsAt - window.startedAt) / gap) + 1 : Infinity;
  if (spend.pings >= cap) return { skip: "ping-cap" };
  const priced = priceSkip({ snapshot, config, spend });
  return priced ? { skip: priced } : { at };
}

export const IN_FLIGHT_TIMEOUT_MS = 120_000;
// One send that fails (or never answers) ends keep-warm for the window: it may have gone out.
export const MAX_FAILED_SENDS = 1;
// A ping the watchdog gave up on may still be answered; its cost counts if it is, within this time.
export const LATE_REPLY_MS = 10 * 60_000;
// After a ping's first usage, further calls inside the same turn still count toward spend.
const TAIL_MS = IN_FLIGHT_TIMEOUT_MS;
// A timer that wakes this much early still sends; one that finds the plan further out re-plans.
const FIRE_TOLERANCE_MS = 1000;
// With no known cache lifetime, an open question is called a stall after this long.
const QUESTION_STALL_FALLBACK_MS = 5 * 60_000;
// Stops that mean something is wrong, not just that the window is over.
const WARN_STOPS = new Set(["cold-reply", "send-failed", "unmeasured", "not-refreshing"]);
// Planner skips that end the window, and the stop reason each is recorded as.
const SKIP_STOPS = {
  payback: "payback", budget: "budget", "window-ended": "window-end", "too-late": "too-late", "ping-cap": "ping-cap",
};

/**
 * The keep-warm scheduler. Everything outside is injected: `send()` sends one ping,
 * `read()` returns { snapshot, config, session }, `store` keeps the window and the lock,
 * `now`, `setTimer`, `clearTimer` and `log(text, "info" | "warn")` are the host's, and
 * `onPlanChange()` hears when whether it will ping has changed. It holds at most one plan timer;
 * every re-plan starts from a fresh `read()`.
 */
export function createKeepWarm({ send, read, store, now, setTimer, clearTimer, log, onPlanChange = null }) {
  let window = null;
  let timer = null;
  let watchdog = null;
  // The ping that is out: { id, expiryBefore, rejected }. Ends with its usage, a failure or a stop.
  let flight = null;
  let sendId = 0;
  let failures = 0;
  // Pings the watchdog gave up on, and until when a reply to them is still believed.
  let lateOwed = 0;
  let lateUntil = 0;
  // Until when further calls inside the answered ping's turn still count toward its spend.
  let tailUntil = 0;
  // A real message typed while a ping was out: its window starts when the ping is done.
  let pendingTurnAt = null;
  let lastSkip = null;
  // Until when a refused lock is not retried: a replan in between keeps saying why it is idle.
  let lockedUntil = 0;
  let questionSince = null;
  let stalled = false;
  let saveWarned = false;
  let lockWarned = false;
  let holdsLock = false;
  let closed = false;

  const spend = () => ({ usd: window?.usd ?? 0, pings: window?.pings ?? 0, lastUsd: window?.lastPingUsd ?? null });
  const planNow = ({ snapshot, config, session }) => planPing({ snapshot, config, window, spend: spend(), session, now: now() });
  const changed = () => onPlanChange?.();
  const lateReplyOpen = () => lateOwed > 0 && now() < lateUntil;
  const tailOpen = () => now() < tailUntil;
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

  /** Drops the window and its stored copy: turning keep-warm off is a fresh start, not a pause. */
  function forget() {
    window = null;
    try {
      store.clear?.();
    } catch (err) {
      log(`cache-clock: could not clear the stored keep-warm window (${err.message}).`, "info");
    }
  }

  const arm = (at) => {
    clearTimer(timer);
    timer = setTimer(onTimer, Math.max(0, at - now()));
  };

  function startWindow(at) {
    const hours = read().config.keepWarmHours;
    window = { startedAt: at, endsAt: at + Math.max(0, hours) * HOUR_MS, usd: 0, pings: 0, stopped: null, lastSendAt: null, lastPingUsd: null };
    failures = 0;
    persist();
  }

  /** Starts the window a real message deferred while a ping was out; true when it did. */
  function applyPendingTurn() {
    if (pendingTurnAt === null) return false;
    const at = pendingTurnAt;
    pendingTurnAt = null;
    startWindow(at);
    return true;
  }

  /** An open question that blocks pinging for a whole cache lifetime is said out loud, once. */
  function trackQuestion({ snapshot, session }) {
    if (!session.questionOpen) {
      questionSince = null;
      stalled = false;
      return;
    }
    questionSince ??= now();
    if (stalled) return;
    const lifetime = snapshot ? lifetimeOf(snapshot) : Number.NaN;
    const due = questionSince + (lifetime > 0 ? lifetime : QUESTION_STALL_FALLBACK_MS);
    if (now() < due) {
      if (timer === null) arm(due);
      return;
    }
    stalled = true;
    log("cache-clock: keep-warm is waiting on an open question; it resumes when the question is answered.", "info");
  }

  function reschedule() {
    clearTimer(timer);
    timer = null;
    if (closed || flight || window?.stopped) return;
    const fresh = read();
    const plan = planNow(fresh);
    lastSkip = "at" in plan ? null : plan.skip;
    trackQuestion(fresh);
    if ("at" in plan && now() < lockedUntil) {
      lastSkip = "locked";
      arm(Math.max(plan.at, lockedUntil));
    } else if ("at" in plan) arm(plan.at);
    else if (SKIP_STOPS[plan.skip]) {
      stop(SKIP_STOPS[plan.skip]);
      return;
    }
    changed();
  }

  function tryLock() {
    try {
      const held = store.lock() === true;
      holdsLock = holdsLock || held;
      if (held) lockedUntil = 0;
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
    // The gap is strict: a timer that fires a little early waits out the rest of it.
    const sent = window.lastSendAt;
    const gap = minGapMs(lifetimeOf(fresh.snapshot));
    if (isAmount(sent) && now() < sent + gap) {
      arm(sent + gap);
      return;
    }
    if (!tryLock()) {
      lastSkip = "locked";
      lockedUntil = now() + leadMs(lifetimeOf(fresh.snapshot));
      arm(lockedUntil);
      changed();
      return;
    }
    fire(fresh.snapshot.expiresAt);
  }

  /** Sends one ping. The attempt is on record before the send, whether or not it rejects. */
  function fire(expiryBefore) {
    sendId += 1;
    const id = sendId;
    flight = { id, expiryBefore, rejected: null };
    tailUntil = 0;
    window = { ...window, lastSendAt: now() };
    persist();
    clearTimer(watchdog);
    watchdog = setTimer(() => failed(id), IN_FLIGHT_TIMEOUT_MS);
    const rejected = (err) => {
      // A rejected send may still have gone out: wait for a usage event before calling it failed.
      if (flight?.id === id) flight.rejected = messageOf(err);
    };
    try {
      Promise.resolve(send()).catch(rejected);
    } catch (err) {
      rejected(err);
    }
    changed();
  }

  /** The watchdog: no usage came for the ping in time. A late reply, if one comes, is still counted. */
  function failed(id) {
    if (!flight || flight.id !== id) return;
    const reason = flight.rejected ?? `no reply in ${IN_FLIGHT_TIMEOUT_MS / 1000}s`;
    clearTimer(watchdog);
    watchdog = null;
    flight = null;
    lateOwed += 1;
    lateUntil = now() + LATE_REPLY_MS;
    failures += 1;
    log(`cache-clock: keep-warm ping failed (${reason}).`, "info");
    if (failures >= MAX_FAILED_SENDS) {
      stop("send-failed");
      return;
    }
    applyPendingTurn();
    reschedule();
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
    flight = null;
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
    // A real message typed while the ping was out starts its own, fresh window now.
    if (applyPendingTurn()) reschedule();
    else changed();
  }

  /** A window derived from the last real message, when it is still running: the same fresh start live or on load. */
  function adoptLastCall() {
    const { snapshot, config } = read();
    const startedAt = snapshot?.lastRealCallAt ?? null;
    if (startedAt === null) return;
    const endsAt = startedAt + config.keepWarmHours * HOUR_MS;
    if (endsAt <= now()) return; // too old: the window starts at the next message
    window = { startedAt, endsAt, usd: 0, pings: 0, stopped: null };
    persist();
  }

  function start() {
    if (read().config.keepWarmHours > 0) {
      try {
        window = store.load();
      } catch (err) {
        log(`cache-clock: could not read the keep-warm window (${err.message}); starting a new one.`, "info");
      }
      if (!window) adoptLastCall();
    }
    reschedule();
  }

  function onUserTurn(at) {
    if (closed) return;
    // A real message ends any claim on a timed-out ping's late reply.
    lateOwed = 0;
    tailUntil = 0;
    // While a ping is out nothing is reset or restarted: its window starts once the ping is done.
    if (flight) {
      pendingTurnAt = at;
      return;
    }
    startWindow(at);
    reschedule();
  }

  /** A window that has pinged, stopped or sent keeps its record; a bare one is derived afresh. */
  const hasHistory = () => window && (window.pings > 0 || window.stopped || isAmount(window.lastSendAt));

  function configChanged() {
    if (closed) return;
    const { config } = read();
    if (!(config.keepWarmHours > 0)) {
      clearTimer(timer);
      timer = null;
      lateOwed = 0;
      tailUntil = 0;
      if (window) forget();
      return;
    }
    if (hasHistory()) {
      window = { ...window, endsAt: window.startedAt + config.keepWarmHours * HOUR_MS };
      persist();
    } else {
      window = null;
      adoptLastCall();
    }
    reschedule();
  }

  const expiryMoved = () => {
    const after = read().snapshot?.expiresAt;
    return isAmount(after) && isAmount(flight.expiryBefore) && after > flight.expiryBefore;
  };

  /** Adds a ping's cost to the window: the first record of a ping counts it, later ones in its turn only add cost. */
  function bookPing(phase, usd) {
    const base = window ?? { startedAt: now(), endsAt: now(), usd: 0, pings: 0, stopped: null };
    const tail = phase === "tail";
    return { ...base, usd: base.usd + usd, pings: base.pings + (tail ? 0 : 1), lastPingUsd: tail ? (base.lastPingUsd ?? 0) + usd : usd };
  }

  function onPingUsage({ usd, warm }) {
    if (closed) return;
    // A ping in flight owns the record; then the late reply of a timed-out ping; then the rest of an answered ping's turn.
    const phase = flight ? "flight" : lateReplyOpen() ? "late" : tailOpen() ? "tail" : null;
    if (!phase) return;
    if (phase === "late") lateOwed -= 1;
    if (usd === null || usd === undefined) {
      if (phase === "flight") stop("unmeasured");
      return;
    }
    const refreshed = phase !== "flight" || expiryMoved();
    window = bookPing(phase, usd);
    persist();
    if (phase === "flight") {
      // A host that sends usage but no idle: the ping ends with its usage.
      clearTimer(watchdog);
      watchdog = null;
      flight = null;
      failures = 0;
      tailUntil = now() + TAIL_MS;
    }
    if (!window.stopped && !warm) {
      stop("cold-reply");
      return;
    }
    if (!window.stopped && !refreshed) {
      stop("not-refreshing");
      return;
    }
    applyPendingTurn();
    reschedule();
  }

  /** `own`: this idle ends the ping's own turn, not a user's. A ping's turn that ends with no usage is unmeasured. */
  function onIdle(own = true) {
    if (closed) return;
    if (flight && own) {
      stop("unmeasured");
      return;
    }
    if (own) tailUntil = 0;
    reschedule();
  }

  function onBusy() {
    clearTimer(timer);
    timer = null;
  }

  function status() {
    const hours = read().config.keepWarmHours;
    const ranOut = Boolean(window) && !window.stopped && now() > window.endsAt;
    const state = !(hours > 0) ? "off" : !window ? "waiting" : window.stopped || ranOut ? "stopped" : "on";
    const { usd, pings } = spend();
    return {
      state,
      msLeft: window && !ranOut ? Math.max(0, window.endsAt - now()) : 0,
      usd,
      pings,
      lastSkip,
      // The window ran out while no timer was armed: say so without waiting for a re-plan.
      stopped: window?.stopped ?? (ranOut ? "window-end" : null),
      inFlight: flight !== null,
      awaitingReply: flight !== null || lateReplyOpen() || tailOpen(),
      armed: timer !== null,
      waitingOnQuestion: stalled,
      // Whether the heads-up should stay quiet: keep-warm is on and a ping is really coming.
      willPing: state === "on" && lastSkip !== "locked" && (flight !== null || timer !== null || lastSkip === "busy"),
    };
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
