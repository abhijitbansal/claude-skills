// Connects the pure clock and guard to a Copilot session. `joinSession`, the
// clock and the timers are injected so tests can drive it without Copilot.

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { attributeUsage } from "./attribution.mjs";
import { createClock } from "./clock.mjs";
import { configDir, createKeepWarmStore, loadConfigResult, loadRefusal, parseCommand, saveConfig, saveRefusal } from "./config.mjs";
import { HELP, card, coldQuestion, coldWarn, headsUp, keepWarmQuote, keepWarmSaved, refusal, usd } from "./format.mjs";
import { classifyPrompt, decide, episodeKey } from "./guard.mjs";
import { PING_DISPLAY, PING_PROMPT, createKeepWarm, createPingLedger, isPingMessage, keepWarmEstimate, looksLikePingText } from "./keepwarm.mjs";
import { NANO_AIU_PER_USD, isMainInteraction, normalizeUsage } from "./usage.mjs";

// The heads-up comes at most a fifth of the ttl before expiry.
const HEADS_UP_TTL_SHARE = 5;

/** Main-agent conversation calls only: sub-agents and background calls have their own caches. */
const mainCall = (event) => {
  if (event.agentId) return null;
  const call = normalizeUsage(event.data, event.timestamp);
  return call && isMainInteraction(call) ? call : null;
};

/** A failed compaction leaves the context as it was. */
const compacted = (event) => event.data?.success !== false;

// A session log can reach hundreds of megabytes; only its tail is needed to seed the clock.
export const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/**
 * The text of `file`, or its last `maxBytes` when it is larger: { text, truncated }. A cut file
 * starts mid-line, so everything up to and including the first newline is dropped.
 */
export function readTail(file, maxBytes) {
  const size = statSync(file).size;
  if (size <= maxBytes) return { text: readFileSync(file, "utf8"), truncated: false };
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    let filled = 0;
    // readSync may return fewer bytes than asked.
    while (filled < maxBytes) {
      const got = readSync(fd, buffer, filled, maxBytes - filled, size - maxBytes + filled);
      if (got === 0) break;
      filled += got;
    }
    const text = buffer.toString("utf8", 0, filled);
    const firstLine = text.indexOf("\n");
    return { text: firstLine === -1 ? "" : text.slice(firstLine + 1), truncated: true };
  } finally {
    closeSync(fd);
  }
}

const readSessionLog = (session) => readTail(join(session.workspacePath, "events.jsonl"), MAX_HISTORY_BYTES);

// `assistant.usage` is ephemeral and not replayed on resume, and getEvents()
// leaves out `session.usage_record`. The session's own events.jsonl keeps every
// record with prices, so a resumed session starts with a known clock.
function seed(clock, readHistory, session, select, resolveAuto, { onTruncated, onUnreadable, onUserMessage }) {
  let text;
  try {
    // A string (test fakes) or { text, truncated } from readTail.
    const history = readHistory(session);
    text = typeof history === "string" ? history : history.text;
    if (history?.truncated) onTruncated();
  } catch (err) {
    // A new session has no log yet, which is normal; anything else is worth saying.
    if (err?.code !== "ENOENT") onUnreadable(err);
    return false; // the clock starts at the next call
  }
  let busy = false;
  // Ties each usage record to the user message whose turn it belongs to.
  const ledger = createPingLedger();
  for (const line of text.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    if (!event.agentId && (event.type === "session.start" || event.type === "session.resume")) {
      select({ ...event.data, modelId: event.data?.selectedModel });
      // Joining a live session does not replay its earlier turn-start callback.
      busy = event.data?.sessionWasActive === true || event.data?.continuePendingWork === true;
    }
    if (!event.agentId && event.type === "assistant.turn_start") busy = true;
    if (!event.agentId && event.type === "user.message") {
      ledger.onMessage(event.data);
      if (!isPingMessage(event.data)) onUserMessage();
    }
    // `session.idle` is ephemeral and never persisted: a finished turn ends with
    // `assistant.turn_end`, and a closed session with `session.shutdown`.
    if (!event.agentId && (event.type === "session.idle" || event.type === "assistant.turn_end" || event.type === "session.shutdown")) busy = false;
    if (!event.agentId && event.type === "session.auto_mode_resolved") resolveAuto(event.data);
    if (!event.agentId && event.type === "session.model_change") select(event.data);
    if (!event.agentId && event.type === "session.model_deselected") select(null);
    if (!event.agentId && event.type === "session.compaction_complete" && compacted(event)) clock.invalidate();
    if (event.type !== "session.usage_record") continue;
    const call = mainCall({ ...event, data: event.data?.usage });
    if (!call) continue;
    if (ledger.onUsage()) clock.ingestPing(call);
    else clock.ingest(call);
  }
  return busy;
}

const messageOf = (err) => err?.message ?? String(err);

/**
 * Calls fn so that a failure never escapes into the host: a sync throw or an async rejection goes
 * to `onError(err)`. Without a handler it is dropped, which only the log itself may do: a
 * failing log cannot report its own failure.
 */
function quietly(fn, onError = null) {
  const report = (err) => onError?.(err);
  try {
    Promise.resolve(fn()).catch(report);
  } catch (err) {
    report(err);
  }
}

// VS Code's agent host sets this for the extensions it launches. Its chat shows only
// error-level session messages, as a failure box; info and warning go to its log file
// (measured 11 Oct 2026). A question card renders cleanly in both VS Code and the CLI.
const isVsCode = (env) => Boolean(env?.VSCODE_CANVAS_DATA_DIR);

const SEND = "Send anyway";
const HOLD = "Don't send";
const OK = "OK";
// A prompt that has been submitted but whose turn has not started counts as busy for this long.
const PROMPT_PENDING_MS = 30_000;
// A keep-warm note about something that went wrong: a warning, never an error box in VS Code.
const KEEPWARM_WARN = { level: "warning" };
// An unanswered question holds the send; the next send in the episode goes through.
const QUESTION_TIMEOUT_MS = 5 * 60_000;
const MODEL_LOOKUP_TIMEOUT_MS = 250;
const UNASKED = Symbol("unasked");
const FAILED = Symbol("failed");
const EXPIRED = Symbol("expired");
const EXPIRED_NOTE = "cache-clock: no answer in 5 minutes, so that send was held. Send it again to send it.";
// VS Code cancels every extension question in autopilot mode; that arrives as a dismissal.
const DISMISSED_NOTE = "cache-clock: the question was dismissed or cancelled, so that send was held (0 AI credits). Send it again to send it.";

// No reliable `-p` signal is known (`canAsk` tests for question UI, not `-p`), so treat the host as
// interactive. Unverified against a real host.
const HOST_IS_INTERACTIVE = true;

const canAsk = (session) => Boolean(session?.capabilities?.ui?.elicitation) && typeof session?.ui?.select === "function";

/**
 * Asks an in-chat question. UNASKED when the host cannot ask or the call fails (`onError` hears of
 * a failure); EXPIRED on timeout; null when dismissed.
 */
async function ask(session, timers, message, options, onError = null) {
  if (!canAsk(session)) return UNASKED;
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(EXPIRED), QUESTION_TIMEOUT_MS);
      timer?.unref?.();
    });
    return await Promise.race([session.ui.select(message, options), timeout]);
  } catch (err) {
    onError?.(err);
    return UNASKED;
  } finally {
    timers.clearTimeout(timer);
  }
}

const closeOnHostGone = (fn) => {
  process.stdin.once("end", fn);
  process.once("exit", fn);
};

export async function attach({
  joinSession, now = Date.now, timers = globalThis, dir = configDir(), readHistory = readSessionLog, env = process.env,
  keepWarmStore = createKeepWarmStore, onHostGone = closeOnHostGone,
}) {
  const clock = createClock();
  const state = {
    session: null, refusedKey: null, busy: false, headsUpTimer: null, headsUpShown: null, pendingPrompt: null,
    selection: null, selectionRevision: 0, autoModel: null, unknownWarnedFor: null,
    // Who started the turn now running: "ping" (ours), "user", or null when unknown.
    turnSource: null, openRequests: new Set(),
    // A ping message was seen and its usage record has not arrived yet.
    pingOwed: false,
    // This turn is the ping's own (a ping message or a ping record was seen in it).
    ownTurn: false,
    // Until when a submitted prompt, whose turn has not started yet, counts as busy.
    promptPendingUntil: 0,
    // The host sends user.message for real turns: then a turn_start is never taken for a user's.
    hostReportsUserMessage: false,
    // A prompt reached the hook since our last send: a record that follows is the user's, not a late ping's.
    promptSinceSend: false,
  };
  // Built once the session id is known; every use before then is a no-op.
  let keepWarm = null;
  const vsCode = isVsCode(env);
  const say = (message, options) => quietly(() => state.session?.log(message, options));
  // In VS Code only error-level messages reach the chat.
  const warnLevel = vsCode ? { level: "error" } : { level: "warning" };
  const rescheduleKeepWarm = () => keepWarm?.reschedule();
  // Keep-warm replans first, so the heads-up sees whether a ping is really coming.
  const replan = () => {
    rescheduleKeepWarm();
    scheduleHeadsUp();
  };
  // A failure worth knowing about once, not on every prompt. Dropped until a session can log it.
  const logged = new Set();
  const logOnce = (key, text, options) => {
    if (!state.session || logged.has(key)) return;
    logged.add(key);
    say(text, options);
  };
  const askUser = (message, options) => ask(state.session, timers, message, options, (err) => {
    logOnce("ask", `cache-clock: could not show the question (${messageOf(err)}); used the refuse-once note instead.`);
  });
  // Every config read goes through here, so a broken file is reported once and the defaults apply.
  const getConfig = () => {
    const { config, problem } = loadConfigResult(dir);
    if (problem) logOnce(`config:${problem}`, `cache-clock: ${problem}; using defaults for those settings. The file was left as it is.`, warnLevel);
    return config;
  };
  // Command output: a card with OK in VS Code, where a plain log line never reaches the chat.
  // Not awaited, so the command returns while the card waits for OK.
  const show = (message, options) => {
    if (vsCode && canAsk(state.session)) return quietly(() => askUser(message, [OK]));
    return say(message, vsCode ? { level: "error" } : options);
  };
  // A process that does not hold the session lock stays quiet only while the lock holder says it will ping;
  // a holder that has stopped or has nothing planned leaves this process's heads-up as the only warning.
  const keepWarmWillPing = () => {
    const status = keepWarm?.status();
    return status?.willPing === true || (status?.passive === true && status?.holderWillPing === true);
  };
  const scheduleHeadsUp = () => headsUpScheduler({ state, selection: effectiveSelection, clock, now, timers, getConfig, say, keepWarmWillPing });
  // While the selection is Auto, the model Copilot last resolved it to stands in for it.
  const effectiveSelection = () => state.selection?.modelId === "auto" && state.autoModel ? { ...state.selection, modelId: state.autoModel } : state.selection;
  const snapshot = () => clock.snapshot(now(), effectiveSelection());
  const select = (raw, fromEvent = false) => {
    const next = raw && typeof (raw.modelId ?? raw.newModel) === "string" ? {
      modelId: raw.modelId ?? raw.newModel, providerId: raw.providerId ?? null,
      contextTier: raw.contextTier ?? null, reasoningEffort: raw.reasoningEffort ?? null,
    } : null;
    if ((next?.providerId ?? null) !== (state.selection?.providerId ?? null) ||
        (next?.contextTier ?? null) !== (state.selection?.contextTier ?? null)) clock.invalidate({ forgetPrices: true });
    if (fromEvent || JSON.stringify(next) !== JSON.stringify(state.selection)) state.selectionRevision += 1;
    // Entering Auto starts fresh: an earlier pick may be long out of date, and the warning may repeat.
    if (next?.modelId === "auto" && state.selection?.modelId !== "auto") {
      state.autoModel = null;
      state.unknownWarnedFor = null;
    }
    state.selection = next;
  };
  /** Records the model Auto chose; true when it differs from the last one. */
  const resolveAuto = (data) => {
    const chosen = typeof data?.chosenModel === "string" && data.chosenModel ? data.chosenModel : null;
    if (!chosen || chosen === state.autoModel) return false;
    state.autoModel = chosen;
    return true;
  };
  let lookup = null;
  const refreshSelection = () => {
    // Older hosts can still supply selection snapshots/events. Without either source,
    // selection stays unknown rather than silently substituting the last call.
    if (!state.session?.rpc?.model?.getCurrent) return Promise.resolve();
    if (lookup) return lookup;
    const revision = state.selectionRevision;
    lookup = (async () => {
      let timer;
      let current = FAILED;
      try {
        current = await Promise.race([
          state.session.rpc.model.getCurrent(),
          new Promise((resolve) => {
            timer = timers.setTimeout(() => resolve(FAILED), MODEL_LOOKUP_TIMEOUT_MS);
            timer?.unref?.();
          }),
        ]);
      } catch {
        // Unknown is advisory, never a reason to stop the user's prompt.
      } finally {
        timers.clearTimeout(timer);
      }
      // A lookup that failed or timed out says nothing about the selection: keep what is
      // known, so it cannot read as a change. Only a reply or an event moves the selection.
      if (current !== FAILED && current != null && revision === state.selectionRevision) select(current);
      scheduleHeadsUp();
      rescheduleKeepWarm();
    })().finally(() => { lookup = null; });
    return lookup;
  };

  // Send anyway lets the send through; anything else stops it before any model call.
  const settle = (answer) => {
    if (answer === SEND) return undefined;
    if (state.busy) {
      say("cache-clock: a turn started while the question was open; leaving the queued send untouched.", warnLevel);
      return undefined;
    }
    // Not awaited: abort() waits for this hook to return, so awaiting it deadlocks. A send that
    // could not be stopped goes out, so the hook must not claim it was held.
    if (!abortSend()) return undefined;
    // The send is held, so no turn will start for it.
    state.promptPendingUntil = 0;
    rescheduleKeepWarm();
    return { suppressOutput: true };
  };
  const abortSend = () => {
    const report = (err) => say(`cache-clock: could not stop the send (${messageOf(err)}); it may have gone out.`, warnLevel);
    try {
      Promise.resolve(state.session.abort()).catch(report);
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  };

  async function onPrompt(input) {
    const text = String(input?.prompt ?? "");
    const kw = keepWarm?.status();
    // Our own keep-warm ping may fire this hook: never guard it, never count it as the user. The text
    // alone proves nothing, since a user can type it: it counts only while a ping we sent is out, and
    // then loosely, because the host may pass the display text or a transformed prompt. In a process
    // that does not hold the session lock the ping is the other process's, so it always counts there.
    if (looksLikePingText(text) && (kw?.inFlight || kw?.passive)) return undefined;
    // Shell escapes and built-in commands never reach the model: no turn follows, so nothing is pending.
    if (classifyPrompt(text, { interactive: HOST_IS_INTERACTIVE }) !== "prompt") return undefined;
    // From this moment a turn is about to start, on every host, before any timer is armed. Hook text
    // never starts or restarts a keep-warm window: only a confirmed user turn does (confirmUserTurn).
    state.promptPendingUntil = now() + PROMPT_PENDING_MS;
    state.promptSinceSend = true;
    // Share the whole check, including asynchronous selection resolution.
    if (state.pendingPrompt) {
      const result = await state.pendingPrompt;
      return result?.suppressOutput ? settle(HOLD) : result;
    }
    state.pendingPrompt = checkPrompt(input);
    try {
      return await state.pendingPrompt;
    } finally {
      state.pendingPrompt = null;
    }
  }

  // A selection with no price to guard on (Auto with no priced stand-in, an unseen model,
  // a provider- or tier-qualified one) is warned about once per selection and reason, not on every send.
  // A cold unpriced send has no `reason`, so it is keyed on its cold episode: once per selection and episode.
  const alreadyWarnedUnknown = (snap) => {
    if (snap.extraUsd !== null) return false;
    const key = `${JSON.stringify(state.selection)}|${snap.reason ?? episodeKey(snap)}`;
    if (state.unknownWarnedFor === key) return true;
    state.unknownWarnedFor = key;
    return false;
  };

  async function checkPrompt(input) {
    let snap;
    let verdict;
    let question;
    try {
      await refreshSelection();
      snap = snapshot();
      verdict = decide({ snap, prompt: input?.prompt, config: getConfig(), refusedKey: state.refusedKey, busy: state.busy, interactive: HOST_IS_INTERACTIVE });
      if (verdict.action === "refuse") question = coldQuestion(snap);
    } catch (err) {
      // Never block the user's message on our own failure, but say that the guard did not run.
      logOnce("check", `cache-clock: could not check this send (${messageOf(err)}); sending without a guard.`);
      return undefined;
    }
    if (verdict.action === "warn" && !alreadyWarnedUnknown(snap)) say(coldWarn(snap), warnLevel);
    if (verdict.action !== "refuse") return undefined;
    state.refusedKey = verdict.key;
    quietly(() => saveRefusal(dir, state.session?.sessionId, verdict.key, now()), (err) => {
      logOnce("refusal", `cache-clock: could not save the refusal memory (${messageOf(err)}); a resumed session may ask again.`);
    });
    const revision = state.selectionRevision;
    const answer = await askUser(question, [SEND, HOLD]);
    if (answer === SEND) {
      await refreshSelection();
      if (revision !== state.selectionRevision) {
        say("cache-clock: model selection changed while the question was open; that quote no longer applies. Send again to check the new selection.", warnLevel);
        return settle(HOLD);
      }
    }
    const result = settle(answer);
    // Say the send was held only when it was: a failed abort lets it through.
    if (result?.suppressOutput) {
      if (answer === UNASKED) say(refusal(snap), warnLevel);
      if (answer === EXPIRED) say(EXPIRED_NOTE, warnLevel);
      if (answer === null) say(DISMISSED_NOTE, warnLevel);
    }
    return result;
  }

  const onCommand = async (context) => {
    const { kind } = parseCommand(context?.args);
    // The status card and the keep-warm cost estimate both need the live selection.
    if (kind === "status" || kind === "confirm") await refreshSelection();
    return runCommand({ context, clock, snapshot, dir, getConfig, show, scheduleHeadsUp, keepWarm, askUser });
  };

  state.session = await joinSession({
    commands: [{ name: "cache-clock", description: "Prompt-cache clock: cold-send price, guard settings", handler: onCommand }],
    hooks: { onUserPromptSubmitted: onPrompt },
  });

  state.busy = seed(clock, readHistory, state.session, select, resolveAuto, {
    onTruncated: () => logOnce("history", `cache-clock: the session log is larger than ${MAX_HISTORY_BYTES / 1024 / 1024} MiB; read only its last ${MAX_HISTORY_BYTES / 1024 / 1024} MiB, so older calls are not in this session's tally.`),
    onUnreadable: (err) => logOnce("history-read", `cache-clock: could not read the session log (${messageOf(err)}); the clock starts at the next model call.`),
    onUserMessage: () => { state.hostReportsUserMessage = true; },
  });
  state.refusedKey = loadRefusal(dir, state.session.sessionId, now());
  // Started only now, so a resumed session's clock is already in place when it first plans.
  // In VS Code the chat shows only error boxes and question cards, so a keep-warm note (a stop, or a
  // stalled question) reaches it as a card; where nothing can ask, it is a plain note in the log.
  const notifyKeepWarm = (text, severity) => {
    if (vsCode && canAsk(state.session)) show(text);
    else say(text, severity === "warn" ? KEEPWARM_WARN : (vsCode ? undefined : { ephemeral: true }));
  };
  keepWarm = buildKeepWarm({
    state, snapshot, getConfig, now, timers, notify: notifyKeepWarm,
    onPlanChange: () => scheduleHeadsUp(),
    store: keepWarmStore(dir, state.session.sessionId, { now, timers }),
  });
  keepWarm.start();
  onHostGone(() => keepWarm.stop("shutdown"));
  scheduleHeadsUp();

  /** A ping's usage refreshes the clock but is not a model call; the scheduler gets its cost if it sent it. */
  const fileKeepWarmPing = (call, awaiting) => {
    const { kind } = clock.ingestPing(call);
    if (!awaiting) return;
    keepWarm.onPingUsage({ usd: call.nanoAiu === null ? null : call.nanoAiu / NANO_AIU_PER_USD, warm: kind === "warm" });
  };
  /** A confirmed real user turn: the only thing that starts or restarts a keep-warm window. */
  const confirmUserTurn = () => quietly(() => keepWarm.onUserTurn(now()), (err) => {
    logOnce("keepwarm-turn", `cache-clock: keep-warm could not start its window (${messageOf(err)}).`);
  });
  /** The selected model or the conversation changed: a ping that is out stops with its own reason. */
  const contextChanged = (reason) => {
    keepWarm.onContextChange(reason);
    scheduleHeadsUp();
  };
  const trackRequest = (event, opened) => {
    const id = event.data?.requestId;
    if (event.agentId || id === undefined) return;
    if (opened) state.openRequests.add(id);
    else state.openRequests.delete(id);
    keepWarm.reschedule();
  };

  state.session.on("session.model_change", (event) => {
    if (event.agentId) return;
    select(event.data, true);
    contextChanged("model-changed");
  });
  state.session.on("session.model_deselected", (event) => {
    if (event.agentId) return;
    select(null, true);
    contextChanged("model-changed");
  });
  state.session.on("session.auto_mode_resolved", (event) => {
    // Not a selection change: Auto may resolve for the very send a question is open on.
    if (event.agentId || !resolveAuto(event.data)) return;
    replan();
  });
  state.session.on("user.message", (event) => {
    if (event.agentId) return;
    const ping = isPingMessage(event.data);
    state.turnSource = ping ? "ping" : "user";
    if (ping) {
      state.pingOwed = true;
      state.ownTurn = true;
      return;
    }
    state.hostReportsUserMessage = true;
    // Only a message whose source is explicitly the user, that carries no ping text, and that arrives
    // while no ping is awaited is a confirmed real turn. No source, or anything else, confirms nothing.
    const explicitUser = event.data?.source === "user";
    if (explicitUser && !carriesPingText(event.data) && !keepWarm.status().awaitingReply) confirmUserTurn();
  });
  state.session.on("assistant.turn_start", (event) => {
    if (event.agentId) return;
    state.busy = true;
    // The user's turn has started; a ping's turn starting says nothing about a prompt still queued.
    if (state.turnSource !== "ping") state.promptPendingUntil = 0;
    // A host that reports no user.message: a turn that is not our own send's is the user's turn.
    if (!state.hostReportsUserMessage) {
      const sent = keepWarm.status();
      if (!sent.awaitingReply && !sent.pingRecent && !sent.passive) confirmUserTurn();
    }
    keepWarm.onBusy();
  });
  state.session.on("session.idle", (event) => {
    if (event.agentId) return;
    // Only the ping's own idle ends the ping; a user turn's idle leaves it in flight.
    const own = state.ownTurn;
    state.busy = false;
    state.turnSource = null;
    state.pingOwed = false;
    state.ownTurn = false;
    if (!own) state.promptPendingUntil = 0;
    keepWarm.onIdle(own);
    // A heads-up skipped because a turn was running gets another chance now.
    scheduleHeadsUp();
  });
  state.session.on("assistant.usage", (event) => {
    const call = mainCall(event);
    if (!call) return;
    // A ping in flight, or one the watchdog gave up on that may still be answered.
    const { awaitingReply: awaiting, inFlight } = keepWarm.status();
    const { owner, spendsTypedPrompt } = attributeUsage({
      awaiting, inFlight, pingOwed: state.pingOwed, turnSource: state.turnSource,
      promptSinceSend: state.promptSinceSend, hostReportsUserMessage: state.hostReportsUserMessage,
    });
    if (owner === "ping") {
      state.pingOwed = false;
      state.ownTurn = true;
      fileKeepWarmPing(call, awaiting);
      scheduleHeadsUp();
      return;
    }
    if (spendsTypedPrompt) state.promptSinceSend = false;
    clock.ingest(call);
    replan();
  });
  state.session.on("session.compaction_complete", (event) => {
    if (event.agentId || !compacted(event)) return;
    clock.invalidate();
    contextChanged("compacted");
  });
  state.session.on("session.shutdown", (event) => {
    if (!event.agentId) keepWarm.stop("shutdown");
  });
  // A question being open means the user is at the keyboard: no pings until it is answered.
  for (const prefix of ["user_input", "elicitation"]) {
    state.session.on(`${prefix}.requested`, (event) => trackRequest(event, true));
    state.session.on(`${prefix}.completed`, (event) => trackRequest(event, false));
  }

  await refreshSelection();
  return { session: state.session, clock, keepWarm };
}

/** The keep-warm scheduler wired to this session's host, config and clock. */
function buildKeepWarm({ state, snapshot, getConfig, now, timers, notify, onPlanChange, store }) {
  const send = () => {
    state.turnSource = null;
    state.promptSinceSend = false;
    const options = { prompt: PING_PROMPT, displayPrompt: PING_DISPLAY, source: "system", mode: "enqueue" };
    const { rpc } = state.session;
    // The rpc form can mark the request non-billable; the plain form has no such flag.
    return typeof rpc?.send === "function" ? rpc.send({ ...options, billable: false }) : state.session.send(options);
  };
  return createKeepWarm({
    send,
    store,
    now,
    read: () => ({
      snapshot: snapshot(),
      config: getConfig(),
      session: {
        busy: state.busy,
        pendingPrompt: Boolean(state.pendingPrompt) || now() < state.promptPendingUntil,
        pendingUntil: state.promptPendingUntil,
        questionOpen: state.openRequests.size > 0,
        selectedModel: state.selection?.modelId ?? null,
      },
    }),
    setTimer: (fn, ms) => {
      const timer = timers.setTimeout(fn, ms);
      timer?.unref?.();
      return timer;
    },
    clearTimer: (timer) => timers.clearTimeout(timer),
    log: notify,
    onPlanChange,
  });
}

/** True when a user.message payload's text is, or wraps, our ping, whatever source it claims. */
const carriesPingText = (data) => looksLikePingText(data?.content) || looksLikePingText(data?.transformedContent);

function headsUpScheduler({ state, selection, clock, now, timers, getConfig, say, keepWarmWillPing }) {
  timers.clearTimeout(state.headsUpTimer);
  state.headsUpTimer = null;
  // While pings will really keep the cache warm, a heads-up would fire next to every one of them.
  if (keepWarmWillPing()) return;
  const config = getConfig();
  const snap = clock.snapshot(now(), selection());
  if (config.headsUpMin <= 0 || snap?.state !== "warm") return;
  const key = `${snap.model}@${snap.expiresAt}`;
  if (state.headsUpShown === key) return; // once per cache
  // A 5-minute lead on a 5-minute cache would fire right after every call.
  const leadMs = Math.min(config.headsUpMin * 60_000, snap.ttlSec ? (snap.ttlSec * 1000) / HEADS_UP_TTL_SHARE : Infinity);
  state.headsUpTimer = timers.setTimeout(() => {
    state.headsUpTimer = null;
    const live = clock.snapshot(now(), selection());
    // Mid-turn the next model call refreshes the cache on its own.
    if (state.busy || live?.state !== "warm" || live.extraUsd === null || keepWarmWillPing()) return;
    if (live.extraUsd < getConfig().minUsd) return;
    state.headsUpShown = key;
    say(headsUp(live), { ephemeral: true });
  }, Math.max(0, snap.msLeft - leadMs));
  state.headsUpTimer?.unref?.();
}

const KEEPWARM_KEYS = ["keepWarmHours", "keepWarmMaxUsd", "keepWarmPayback", "keepWarmDailyMaxUsd"];
const TURN_ON = "Turn on";
const CANCEL = "Cancel";

/** Saves a settings patch and tells the scheduler; returns the saved settings, or null after showing the failure. */
function saveSettings({ patch, dir, getConfig, show, scheduleHeadsUp, keepWarm }) {
  const next = { ...getConfig(), ...patch };
  // saveConfig throws rather than overwrite a file it cannot read, or write an invalid value.
  try {
    saveConfig(dir, next);
  } catch (err) {
    show(`cache-clock: could not save settings to ${dir}: ${err.message}`, { level: "error" });
    return null;
  }
  if (KEEPWARM_KEYS.some((key) => key in patch)) keepWarm?.configChanged();
  scheduleHeadsUp();
  return next;
}

function savedLine(next, patch) {
  if (KEEPWARM_KEYS.some((key) => key in patch)) return keepWarmSaved(next);
  const heads = next.headsUpMin > 0 ? `${next.headsUpMin}m` : "off";
  return `cache-clock: guard: ${next.mode} · min ${usd(next.minUsd)} · heads-up ${heads} (saved for all sessions)`;
}

/** A long keep-warm window costs real money: show the estimate and ask before saving it. */
async function confirmKeepWarm(ctx, patch) {
  const hours = patch.keepWarmHours;
  const snap = ctx.snapshot();
  // The budget and payback stops end a long window early, so the quote counts only the pings they allow.
  const quote = keepWarmQuote(snap, hours, keepWarmEstimate(snap, hours, ctx.getConfig()));
  const answer = await ctx.askUser(quote, [TURN_ON, CANCEL]);
  // Nothing could ask the user (or the question failed), so nothing is saved: repeating the command
  // with `yes` is the confirmation.
  if (answer === UNASKED) return ctx.show(`${quote}\ncache-clock: not saved. To confirm, repeat it as /cache-clock keepwarm ${hours} yes`);
  if (answer !== TURN_ON) return ctx.show("cache-clock: keep-warm unchanged.");
  const next = saveSettings({ ...ctx, patch });
  return next ? ctx.show(savedLine(next, patch)) : undefined;
}

async function runCommand(ctx) {
  const { context, clock, snapshot, dir, getConfig, show, keepWarm } = ctx;
  const parsed = parseCommand(context?.args);
  if (parsed.kind === "status") return show(card(snapshot(), clock.tally(), getConfig(), keepWarm?.status()));
  if (parsed.kind === "help") return show(HELP);
  if (parsed.kind === "error") return show(`cache-clock: ${parsed.message}. Try /cache-clock help.`, { level: "error" });
  // A settings file that cannot be read as settings is never overwritten, and nothing is asked about it.
  const { problem, unusable } = loadConfigResult(dir);
  if (unusable) return show(`cache-clock: not saved: ${problem}. Fix or delete ${join(dir, "config.json")} first.`, { level: "error" });
  if (parsed.kind === "confirm") return confirmKeepWarm(ctx, parsed.patch);
  const next = saveSettings({ ...ctx, patch: parsed.patch });
  return next ? show(savedLine(next, parsed.patch)) : undefined;
}
