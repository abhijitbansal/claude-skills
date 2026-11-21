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

/**
 * Tells which usage records of a session log belong to pings, by the order of events alone: a
 * record is a ping's only if it is the first root record after the ping message and before any
 * later user message. A ping message that never got a record claims nothing. Feed every root user
 * message to `onMessage` and every main-conversation usage record to `onUsage`, in log order.
 */
export function createPingLedger() {
  let armed = false; // a ping message was seen, with no record and no later user message since
  return {
    onMessage(data) {
      armed = isPingMessage(data);
    },
    /** True when this record is a ping's. */
    onUsage() {
      const ping = armed;
      armed = false;
      return ping;
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
// A reported lifetime under this is refused: a ping would cost more than the rewrite it avoids.
export const MIN_LIFETIME_MS = 300_000;
// The ping caps never assume pings closer together than this, whatever lifetime the host reports.
export const CAP_GAP_FLOOR_MS = 240_000;
const HOUR_MS = 3_600_000;
// The daily ping cap is this many times the cap of a 12 hour window, for the current cache lifetime.
const DAILY_CAP_WINDOWS = 2;
const DAILY_CAP_BASE_HOURS = 12;

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
function priceSkip({ snapshot, config, spend, daily, gap }) {
  // Without a numeric budget, spend and ledger, "over budget" is never true: refuse rather than ping unbounded.
  if (!isAmount(config.keepWarmMaxUsd) || !isAmount(spend.usd)) return "invalid";
  if (!isAmount(config.keepWarmDailyMaxUsd) || !isAmount(daily?.pings) || !isAmount(daily?.usd)) return "invalid";
  if (!isAmount(snapshot.warmUsd) || !isAmount(snapshot.extraUsd)) return "unpriced";
  // A ping that cost more than the estimate says what the next one will cost.
  const perPing = Math.max(snapshot.warmUsd, isAmount(spend.lastUsd) ? spend.lastUsd : 0);
  const after = spend.usd + perPing;
  if (after > config.keepWarmMaxUsd + USD_EPSILON) return "budget";
  // Pings must stay cheaper than the one cold rewrite they exist to avoid.
  if (config.keepWarmPayback && after > snapshot.extraUsd + USD_EPSILON) return "payback";
  // The backstop no window, setting or event can reset: the last 24 hours of this session's pings.
  const dailyCap = DAILY_CAP_WINDOWS * (Math.ceil((DAILY_CAP_BASE_HOURS * HOUR_MS) / Math.max(gap, CAP_GAP_FLOOR_MS)) + 1);
  if (daily.pings >= dailyCap || daily.usd + perPing > config.keepWarmDailyMaxUsd + USD_EPSILON) return "daily-limit";
  return null;
}

/**
 * Decides whether and when to send the next keep-warm ping.
 * Returns { at } (ms) or { skip } naming the first reason not to. Limits that do not depend on
 * cost: a minimum gap since the last send, no ping with under 15 s left, a cap on pings per window,
 * and `daily` ({ pings, usd } of the last 24 hours, from the ledger) against the daily limits.
 */
export function planPing({ snapshot, config, window, spend, daily, session, now }) {
  const early = sessionSkip({ snapshot, config, window, session });
  if (early) return { skip: early };
  const lifetime = lifetimeOf(snapshot);
  if (!(lifetime > 0)) return { skip: "invalid" };
  if (lifetime < MIN_LIFETIME_MS) return { skip: "lifetime-too-short" };
  const gap = minGapMs(lifetime);
  const earliest = isAmount(window.lastSendAt) ? window.lastSendAt + gap : now;
  const at = Math.max(now, snapshot.expiresAt - leadMs(lifetime), earliest);
  if (snapshot.expiresAt - at < TOO_LATE_MS) return { skip: "too-late" };
  if (at > window.endsAt) return { skip: "window-ended" };
  const cap = isAmount(window.startedAt) ? Math.ceil((window.endsAt - window.startedAt) / Math.max(gap, CAP_GAP_FLOOR_MS)) + 1 : Infinity;
  if (spend.pings >= cap) return { skip: "ping-cap" };
  const priced = priceSkip({ snapshot, config, spend, daily, gap });
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
// A process that does not hold the session lock looks again this often, so a dead holder is replaced.
const OWNER_RETRY_MS = 60_000;
// With no known cache lifetime, an open question is called a stall after this long.
const QUESTION_STALL_FALLBACK_MS = 5 * 60_000;
// A ping sent less than a cache lifetime ago explains a turn start that nobody typed.
const RECENT_FALLBACK_MS = 5 * 60_000;
// Stops that mean something is wrong, not just that the window is over.
const WARN_STOPS = new Set(["cold-reply", "send-failed", "unmeasured", "not-refreshing", "ledger-failed", "model-changed", "compacted"]);
// Planner skips that end the window, and the stop reason each is recorded as.
const SKIP_STOPS = {
  payback: "payback", budget: "budget", "window-ended": "window-end", "too-late": "too-late", "ping-cap": "ping-cap",
  "daily-limit": "daily-limit", "lifetime-too-short": "lifetime-too-short",
};
const DAY_MS = 24 * HOUR_MS;

/** The window's end under the current hours: lowering the hours shortens a running window, raising never extends it. */
const windowEnd = (w, hours) => (isAmount(w?.startedAt) ? Math.min(w.endsAt, w.startedAt + hours * HOUR_MS) : w?.endsAt);

/**
 * The keep-warm scheduler. Everything outside is injected: `send()` sends one ping,
 * `read()` returns { snapshot, config, session }, `store` keeps the window, the lock and the ping
 * ledger, `now`, `setTimer`, `clearTimer` and `log(text, "info" | "warn")` are the host's, and
 * `onPlanChange()` hears when whether it will ping has changed.
 *
 * Only the process that holds the session's lock keeps any state: another process plans nothing,
 * starts no window and sends nothing, and a process that takes over a dead holder's lock adopts the
 * stored window and ledger as they are. It holds at most one plan timer; every re-plan starts from
 * a fresh `read()`. A window starts only through `onUserTurn`, which callers invoke for a confirmed
 * real user turn and for nothing else.
 */
export function createKeepWarm({ send, read, store, now, setTimer, clearTimer, log, onPlanChange = null }) {
  let window = null;
  let owner = false;
  let timer = null;
  // What the plan timer is for: "ping" (a ping is planned), "retry" (look for the lock again),
  // "pending" (a submitted prompt's flag expires) or "stall" (an open question is called a stall).
  let timerKind = null;
  let watchdog = null;
  // The ping that is out: { id, sentAt, expiryBefore, ttlBefore, rejected }. Ends with its usage, a failure or a stop.
  let flight = null;
  let sendId = 0;
  let failures = 0;
  // Send times of pings the watchdog gave up on, and until when a reply to them is still believed.
  let lateQueue = [];
  let lateUntil = 0;
  // The latest ping whose turn may still add calls: { at, usd }, and until when.
  let lastPing = null;
  let tailUntil = 0;
  let lastSkip = null;
  let questionSince = null;
  let stalled = false;
  const warned = new Set();
  let holdsLock = false;
  let closed = false;

  const hoursOn = () => read().config.keepWarmHours > 0;
  const spend = () => ({ usd: window?.usd ?? 0, pings: window?.pings ?? 0, lastUsd: window?.lastPingUsd ?? null });
  const changed = () => onPlanChange?.();
  const lateReplyOpen = () => lateQueue.length > 0 && now() < lateUntil;
  const tailOpen = () => now() < tailUntil;
  let ledgerDown = false;
  const warnOnce = (key, text) => {
    if (warned.has(key)) return;
    warned.add(key);
    log(text, "info");
  };

  // The ledger lives in the store; a store with none (a test double) gets one in memory.
  const memoryLedger = new Map();
  let memorySeq = 0;
  let memoryNoteAt = null;
  const ledgerSend = (at, usd) => {
    if (store.ledgerSend) return store.ledgerSend(at, usd);
    memorySeq += 1;
    memoryLedger.set(memorySeq, { at, usd });
    return memorySeq;
  };
  /** Sets a ping's ledger cost, checking the lock live: a process that lost it writes nothing. */
  const ledgerCost = (id, usd) => {
    if (!stillOwner()) return;
    try {
      if (store.ledgerCost) store.ledgerCost(id, usd);
      else if (memoryLedger.has(id)) memoryLedger.set(id, { ...memoryLedger.get(id), usd });
    } catch (err) {
      warnOnce("ledger-cost", `cache-clock: could not record a ping's cost in the keep-warm ledger (${err.message}); it stays at what it was.`);
    }
  };
  /** { pings, usd, noteAt } of the last 24 hours. Throws when the ledger cannot be read: the caller stops. */
  function dailySummary() {
    if (store.ledger) return store.ledger(now());
    const live = [...memoryLedger.values()].filter((entry) => Math.min(entry.at, now()) >= now() - DAY_MS);
    return { pings: live.length, usd: live.reduce((sum, entry) => sum + entry.usd, 0), noteAt: memoryNoteAt };
  }
  /** The daily-limit note is shown once per 24 hours per session, not once per turn. */
  function dailyNoteDue() {
    try {
      const { noteAt } = dailySummary();
      return noteAt === null || now() - noteAt >= DAY_MS;
    } catch {
      return true;
    }
  }
  function recordDailyNote() {
    try {
      if (store.ledgerNote) store.ledgerNote(now());
      else memoryNoteAt = now();
    } catch (err) {
      warnOnce("ledger-note", `cache-clock: could not record the daily-limit note in the keep-warm ledger (${err.message}).`);
    }
  }

  const planNow = ({ snapshot, config, session }) => planPing({
    snapshot, config, session, now: now(), spend: spend(), daily: dailySummary(),
    window: window && { ...window, endsAt: windowEnd(window, config.keepWarmHours) },
  });

  /** The plan, or null after a ledger that cannot be read has stopped keep-warm (fail closed, one note). */
  function planSafely(fresh) {
    try {
      const plan = planNow(fresh);
      ledgerDown = false;
      return plan;
    } catch (err) {
      if (!ledgerDown || (window && !window.stopped)) {
        ledgerDown = true; // one stop per window while the ledger stays unreadable, not one per plan
        warnOnce("ledger-read", `cache-clock: ${err.message}`);
        stop("ledger-failed");
      }
      return null;
    }
  }

  const clearPlanTimer = () => {
    clearTimer(timer);
    timer = null;
    timerKind = null;
  };
  const setPlanTimer = (at, kind) => {
    clearTimer(timer);
    timer = setTimer(onTimer, Math.max(0, at - now()));
    timerKind = kind;
  };
  const clearAll = () => {
    clearPlanTimer();
    clearTimer(watchdog);
    watchdog = null;
  };

  // Whether a ping is planned or out right now. The window file carries it so a process that does not
  // hold the lock knows whether its heads-up would be redundant.
  const willPingNow = () => flight !== null || timerKind === "ping";
  let savedWillPing = null;

  /** Writes the window (the owner only); a failing store is reported once and keep-warm carries on from memory. */
  function persist() {
    if (!owner || !window || window.placeholder || !hoursOn() || !stillOwner()) return;
    try {
      const willPing = willPingNow();
      store.save({ ...window, willPing });
      savedWillPing = willPing;
    } catch (err) {
      warnOnce("save", `cache-clock: could not save the keep-warm window (${err.message}); a reload may restart its budget.`);
    }
  }

  const verifyOwner = () => {
    try {
      return store.lock() === true;
    } catch (err) {
      warnOnce("lock", `cache-clock: could not take the keep-warm lock (${err.message}); not pinging.`);
      return false;
    }
  };

  /** True while this process still holds the lock, checked live; a process that finds it lost lets go of everything. */
  function stillOwner() {
    if (!owner) return false;
    if (verifyOwner()) return true;
    releaseOwnership();
    return false;
  }

  /**
   * True when this process holds the session lock. Taking it over also adopts what the previous holder
   * stored (its window and its ledger), as they are. With no stored window there is none: a window
   * starts only at a confirmed user turn, never from an earlier call, so a missing file grants no budget.
   */
  function ensureOwner() {
    if (owner) return true;
    if (!hoursOn() || !verifyOwner()) return false;
    owner = true;
    holdsLock = true;
    window = null;
    savedWillPing = null; // what the previous holder wrote says nothing about this process
    try {
      window = store.load();
    } catch (err) {
      log(`cache-clock: could not read the keep-warm window (${err.message}); starting a new one.`, "info");
    }
    try {
      store.compactLedger?.(now());
    } catch (err) {
      warnOnce("ledger-compact", `cache-clock: could not compact the keep-warm ledger (${err.message}).`);
    }
    return true;
  }

  function releaseOwnership() {
    clearAll();
    owner = false;
    holdsLock = false;
    window = null;
    savedWillPing = null;
    flight = null;
    sendId += 1;
    // A process that lost the lock expects no ping's record: its late and tail claims go with it.
    lateQueue = [];
    lastPing = null;
    tailUntil = 0;
  }

  function startWindow(at) {
    const hours = read().config.keepWarmHours;
    window = {
      startedAt: at, endsAt: at + Math.max(0, hours) * HOUR_MS, usd: 0, pings: 0, stopped: null,
      lastSendAt: null, lastPingUsd: null, ...(hours > 0 ? {} : { placeholder: true }),
    };
    failures = 0;
    persist();
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
      if (timer === null) setPlanTimer(due, "stall");
      return;
    }
    stalled = true;
    log("cache-clock: keep-warm is waiting on an open question; it resumes when the question is answered.", "info");
  }

  function reschedule() {
    clearPlanTimer();
    if (closed) return;
    if (hoursOn() && !ensureOwner()) {
      lastSkip = "locked";
      setPlanTimer(now() + OWNER_RETRY_MS, "retry");
      changed();
      return;
    }
    if (flight || window?.stopped) return;
    const fresh = read();
    const plan = planSafely(fresh);
    if (!plan) return;
    lastSkip = "at" in plan ? null : plan.skip;
    trackQuestion(fresh);
    if ("at" in plan) setPlanTimer(plan.at, "ping");
    else if (SKIP_STOPS[plan.skip]) {
      stop(SKIP_STOPS[plan.skip]);
      return;
    } else if (plan.skip === "busy" && !fresh.session.busy && fresh.session.pendingUntil > now()) {
      // Only a submitted prompt that has not started holds it: look again when that flag expires.
      setPlanTimer(fresh.session.pendingUntil, "pending");
    }
    if (window && willPingNow() !== savedWillPing) persist(); // the plan changed what the lock holder promises
    changed();
  }

  function onTimer() {
    timer = null;
    timerKind = null;
    if (closed) return;
    if (!owner) {
      reschedule();
      return;
    }
    const fresh = read();
    const plan = planSafely(fresh);
    if (!plan) return;
    if (!("at" in plan) || plan.at - now() > FIRE_TOLERANCE_MS) {
      reschedule();
      return;
    }
    // The gap is strict: a timer that fires a little early waits out the rest of it.
    const sent = window.lastSendAt;
    const gap = minGapMs(lifetimeOf(fresh.snapshot));
    if (isAmount(sent) && now() < sent + gap) {
      setPlanTimer(sent + gap, "ping");
      return;
    }
    // The pid is confirmed again before every ping: a process that lost the lock stops here.
    if (!verifyOwner()) {
      releaseOwnership();
      reschedule();
      return;
    }
    fire(fresh.snapshot);
  }

  /**
   * Sends one ping. It is in the ledger, and the attempt on record, before the send, whether or not it
   * rejects: at the cold-rewrite cost, since until its usage is attributed to it the ping may have cost that.
   */
  function fire(snapshot) {
    const sentAt = now();
    const warm = Math.max(snapshot.warmUsd, window.lastPingUsd ?? 0);
    const unattributed = isAmount(snapshot.coldUsd) ? Math.max(snapshot.coldUsd, warm) : warm;
    let ledgerId;
    try {
      ledgerId = ledgerSend(sentAt, unattributed);
    } catch (err) {
      warnOnce("ledger-write", `cache-clock: could not write the keep-warm ledger (${err.message}).`);
      stop("ledger-failed");
      return;
    }
    sendId += 1;
    const id = sendId;
    flight = { id, ledgerId, warm, sentAt, expiryBefore: snapshot.expiresAt, ttlBefore: snapshot.ttlSec, rejected: null };
    lastPing = { ledgerId, warm, at: sentAt, usd: 0 };
    tailUntil = 0;
    window = { ...window, lastSendAt: sentAt };
    persist();
    if (!owner) return; // the lock was lost while writing: nothing is sent
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

  /** A ping nobody answered may still be answered later: its reply is expected, and counted, for a while. */
  function openLate(ping) {
    lateQueue.push({ ledgerId: ping.ledgerId, warm: ping.warm });
    lateUntil = now() + LATE_REPLY_MS;
  }

  /** The watchdog: no usage came for the ping in time. A late reply, if one comes, is still counted. */
  function failed(id) {
    if (!flight || flight.id !== id) return;
    const reason = flight.rejected ?? `no reply in ${IN_FLIGHT_TIMEOUT_MS / 1000}s`;
    openLate(flight);
    clearTimer(watchdog);
    watchdog = null;
    flight = null;
    failures += 1;
    log(`cache-clock: keep-warm ping failed (${reason}).`, "info");
    if (failures >= MAX_FAILED_SENDS) {
      stop("send-failed");
      return;
    }
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
    if (reason !== "daily-limit" || dailyNoteDue()) {
      log(keepWarmStopped(reason, spend()), WARN_STOPS.has(reason) ? "warn" : "info");
      if (reason === "daily-limit") recordDailyNote();
    }
    changed();
  }

  function start() {
    if (hoursOn()) ensureOwner();
    reschedule();
  }

  /** A confirmed real user turn: the only thing that starts or restarts a window. */
  function onUserTurn(at) {
    if (closed) return;
    if (hoursOn() && !ensureOwner()) return;
    // A real message ends any claim on a timed-out ping's late reply.
    lateQueue = [];
    tailUntil = 0;
    // Nothing is reset or restarted while a ping is out. Callers do not confirm a turn then, but a
    // turn that does arrive is dropped, never held: a stop is lifted only by a turn that follows it.
    if (flight) return;
    startWindow(at);
    reschedule();
  }

  function configChanged() {
    if (closed) return;
    if (!hoursOn()) {
      // Off: nothing is planned, nothing is printed afterwards, and the stored window stays as it is.
      clearPlanTimer();
      clearTimer(watchdog);
      watchdog = null;
      flight = null;
      sendId += 1;
      lateQueue = [];
      tailUntil = 0;
      return;
    }
    if (!ensureOwner()) {
      reschedule();
      return;
    }
    if (window && !window.placeholder) {
      // A window that started keeps its start, its spend and any stop; the hours can only shorten it.
      window = { ...window, endsAt: windowEnd(window, read().config.keepWarmHours) };
      persist();
    } else {
      window = null; // a bare window, or none: the next confirmed user turn starts one
    }
    reschedule();
  }

  /**
   * Did the ping's reply move the cache expiry forward? Under an unchanged lifetime the expiry must
   * be later than before; when the lifetime changed, the new expiry must be at least half a new
   * lifetime past the send.
   */
  function expiryMoved() {
    const snapshot = read().snapshot;
    const after = snapshot?.expiresAt;
    if (!isAmount(after) || !isAmount(flight.expiryBefore)) return false;
    const ttlAfter = snapshot.ttlSec;
    const lifetimeChanged = isAmount(ttlAfter) && isAmount(flight.ttlBefore) && ttlAfter !== flight.ttlBefore;
    return lifetimeChanged ? after - flight.sentAt >= 0.5 * ttlAfter * 1000 : after > flight.expiryBefore;
  }

  /**
   * Adds a ping's cost to the window and the ledger: the first record of a ping counts it, later ones in
   * its turn only add cost. The ledger holds the larger of the estimate and the measured cost, so a host
   * that reports 0 cannot unbind the daily limit.
   */
  function bookPing(phase, usd, ping) {
    // No window (never made, or let go with the lock): nothing is booked and no window is made up for it.
    if (!window) return null;
    const base = window;
    const tail = phase === "tail";
    if (tail) lastPing = { ...lastPing, usd: lastPing.usd + usd };
    else if (phase === "flight") lastPing = { ledgerId: ping.ledgerId, warm: ping.warm, at: ping.sentAt, usd };
    const pingUsd = tail ? lastPing.usd : usd;
    ledgerCost(ping.ledgerId, Math.max(ping.warm, pingUsd));
    // Writing the ledger checks the lock live: finding it gone let go of the window.
    if (!window) return null;
    return { ...base, usd: base.usd + usd, pings: base.pings + (tail ? 0 : 1), lastPingUsd: pingUsd };
  }

  function onPingUsage({ usd, warm }) {
    if (closed || !owner || !hoursOn()) return;
    // A ping in flight owns the record; then the late reply of a timed-out ping; then the rest of an answered ping's turn.
    const phase = flight ? "flight" : lateReplyOpen() ? "late" : tailOpen() ? "tail" : null;
    if (!phase) return;
    const ping = phase === "flight" ? flight : phase === "tail" ? lastPing : lateQueue.shift();
    if (usd === null || usd === undefined) {
      if (phase === "flight") stop("unmeasured");
      return;
    }
    const refreshed = phase !== "flight" || expiryMoved();
    window = bookPing(phase, usd, ping);
    persist();
    if (!window) {
      // Nothing was booked (no window, or the lock was lost: another process keeps it now). The ping was
      // still answered, so its flight ends and the watchdog must not report "no reply" for it.
      if (phase === "flight") {
        clearTimer(watchdog);
        watchdog = null;
        flight = null;
      }
      return;
    }
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
    reschedule();
  }

  /** `own`: this idle ends the ping's own turn, not a user's. A ping's turn that ends with no usage is unmeasured. */
  function onIdle(own = true) {
    if (closed) return;
    if (!owner) {
      reschedule();
      return;
    }
    if (flight && own) {
      // Its usage may still arrive after the idle: it is then counted, though keep-warm has stopped.
      openLate(flight);
      stop("unmeasured");
      return;
    }
    if (own) tailUntil = 0;
    reschedule();
  }

  /** The model or the context changed: a ping that was out is stopped with its own reason, its reply still counted. */
  function onContextChange(reason) {
    if (closed || !owner) return;
    if (flight) {
      openLate(flight);
      stop(reason);
      return;
    }
    reschedule();
  }

  function onBusy() {
    if (timerKind === "ping") clearPlanTimer();
  }

  function status() {
    const hours = read().config.keepWarmHours;
    const recent = read().snapshot;
    const recentLifetime = recent && lifetimeOf(recent) > 0 ? lifetimeOf(recent) : RECENT_FALLBACK_MS;
    const end = window ? windowEnd(window, hours) : null;
    const ranOut = Boolean(window) && !window.stopped && now() > end;
    let state = "off";
    if (hours > 0) state = !owner ? "elsewhere" : !window || window.placeholder ? "waiting" : window.stopped || ranOut ? "stopped" : "on";
    const { usd, pings } = spend();
    return {
      state,
      msLeft: window && !ranOut && (state === "on" || state === "stopped") ? Math.max(0, end - now()) : 0,
      usd,
      pings,
      lastSkip,
      // The window ran out while no timer was armed: say so without waiting for a re-plan.
      stopped: window?.stopped ?? (ranOut && state === "stopped" ? "window-end" : null),
      inFlight: flight !== null,
      awaitingReply: flight !== null || lateReplyOpen() || tailOpen(),
      // A ping went out within a cache lifetime: a turn that starts now may be its own.
      pingRecent: flight !== null || (isAmount(window?.lastSendAt) && now() - window.lastSendAt < recentLifetime),
      armed: timer !== null,
      waitingOnQuestion: stalled,
      // Another process of this session holds the lock and keeps the window.
      passive: state === "elsewhere",
      // What that holder wrote in the shared window file: whether it has a ping planned or out.
      holderWillPing: state === "elsewhere" && store.holderWillPing?.() === true,
      // Whether the heads-up should stay quiet: keep-warm is on and a ping is really planned or out.
      willPing: state === "on" && (flight !== null || timerKind === "ping"),
    };
  }

  return { start, onUserTurn, onPingUsage, onIdle, onBusy, onContextChange, reschedule, configChanged, stop, status };
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
