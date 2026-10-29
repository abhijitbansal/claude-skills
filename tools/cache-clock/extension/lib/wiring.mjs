// Connects the pure clock and guard to a Copilot session. `joinSession`, the
// clock and the timers are injected so tests can drive it without Copilot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClock } from "./clock.mjs";
import { configDir, loadConfig, loadRefusal, parseCommand, saveConfig, saveRefusal } from "./config.mjs";
import { HELP, card, coldQuestion, coldWarn, headsUp, refusal, usd } from "./format.mjs";
import { NOT_A_PROMPT, decide } from "./guard.mjs";
import { isMainInteraction, normalizeUsage } from "./usage.mjs";

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

const readSessionLog = (session) => readFileSync(join(session.workspacePath, "events.jsonl"), "utf8");

// `assistant.usage` is ephemeral and not replayed on resume, and getEvents()
// leaves out `session.usage_record`. The session's own events.jsonl keeps every
// record with prices, so a resumed session starts with a known clock.
function seed(clock, readHistory, session, select) {
  let text;
  try {
    text = readHistory(session);
  } catch {
    return; // no log yet (new session) or unreadable: the clock starts at the next call
  }
  for (const line of text.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    if (!event.agentId && event.type === "session.model_change") select(event.data);
    if (!event.agentId && event.type === "session.model_deselected") select(null);
    if (!event.agentId && event.type === "session.compaction_complete" && compacted(event)) clock.invalidate();
    if (event.type !== "session.usage_record") continue;
    const call = mainCall({ ...event, data: event.data?.usage });
    if (call) clock.ingest(call);
  }
}

/** Calls fn, swallowing sync throws and async rejections: the host may be gone. */
function quietly(fn) {
  try {
    Promise.resolve(fn()).catch(() => {});
  } catch {
    // nothing to do
  }
}

// VS Code's agent host sets this for the extensions it launches. Its chat shows only
// error-level session messages, as a failure box; info and warning go to its log file
// (measured 11 Oct 2026). A question card renders cleanly in both VS Code and the CLI.
const isVsCode = (env) => Boolean(env?.VSCODE_CANVAS_DATA_DIR);

const SEND = "Send anyway";
const HOLD = "Don't send";
const OK = "OK";
// An unanswered question holds the send; the next send in the episode goes through.
const QUESTION_TIMEOUT_MS = 5 * 60_000;
const MODEL_LOOKUP_TIMEOUT_MS = 250;
const UNASKED = Symbol("unasked");
const EXPIRED = Symbol("expired");
const EXPIRED_NOTE = "cache-clock: no answer in 5 minutes, so that send was held. Send it again to send it.";
// VS Code cancels every extension question in autopilot mode; that arrives as a dismissal.
const DISMISSED_NOTE = "cache-clock: the question was dismissed or cancelled, so that send was held (0 AI credits). Send it again to send it.";

const canAsk = (session) => Boolean(session?.capabilities?.ui?.elicitation) && typeof session?.ui?.select === "function";

/** Asks an in-chat question. UNASKED when the host cannot ask or the call fails; EXPIRED on timeout; null when dismissed. */
async function ask(session, timers, message, options) {
  if (!canAsk(session)) return UNASKED;
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(EXPIRED), QUESTION_TIMEOUT_MS);
      timer?.unref?.();
    });
    return await Promise.race([session.ui.select(message, options), timeout]);
  } catch {
    return UNASKED;
  } finally {
    timers.clearTimeout(timer);
  }
}

export async function attach({ joinSession, now = Date.now, timers = globalThis, dir = configDir(), readHistory = readSessionLog, env = process.env }) {
  const clock = createClock();
  const state = { session: null, refusedKey: null, busy: false, headsUpTimer: null, headsUpShown: null, pendingPrompt: null, selection: null, selectionRevision: 0 };
  const vsCode = isVsCode(env);
  const say = (message, options) => quietly(() => state.session?.log(message, options));
  // In VS Code only error-level messages reach the chat.
  const warnLevel = vsCode ? { level: "error" } : { level: "warning" };
  // Command output: a card with OK in VS Code, where a plain log line never reaches the chat.
  // Not awaited, so the command returns while the card waits for OK.
  const show = (message, options) => {
    if (vsCode && canAsk(state.session)) return quietly(() => ask(state.session, timers, message, [OK]));
    return say(message, vsCode ? { level: "error" } : options);
  };
  const scheduleHeadsUp = () => headsUpScheduler({ state, clock, now, timers, dir, say });
  const snapshot = () => clock.snapshot(now(), state.selection);
  const select = (raw, fromEvent = false) => {
    const next = raw && typeof (raw.modelId ?? raw.newModel) === "string" ? {
      modelId: raw.modelId ?? raw.newModel, providerId: raw.providerId ?? null,
      contextTier: raw.contextTier ?? null, reasoningEffort: raw.reasoningEffort ?? null,
    } : null;
    if ((next?.providerId ?? null) !== (state.selection?.providerId ?? null) ||
        (next?.contextTier ?? null) !== (state.selection?.contextTier ?? null)) clock.invalidate({ forgetPrices: true });
    if (fromEvent || JSON.stringify(next) !== JSON.stringify(state.selection)) state.selectionRevision += 1;
    state.selection = next;
  };
  let lookup = null;
  const refreshSelection = () => {
    // Older hosts can still supply model-change events. Without either source,
    // selection stays unknown rather than silently substituting the last call.
    if (!state.session?.rpc?.model?.getCurrent) return Promise.resolve();
    if (lookup) return lookup;
    const revision = state.selectionRevision;
    lookup = (async () => {
      let timer;
      let current = null;
      try {
        current = await Promise.race([
          state.session.rpc.model.getCurrent(),
          new Promise((resolve) => { timer = timers.setTimeout(() => resolve(null), MODEL_LOOKUP_TIMEOUT_MS); }),
        ]);
      } catch {
        // Unknown is advisory, never a reason to stop the user's prompt.
      } finally {
        timers.clearTimeout(timer);
      }
      if (revision === state.selectionRevision) select(current);
      scheduleHeadsUp();
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
    // Not awaited: abort() waits for this hook to return, so awaiting it deadlocks.
    quietly(() => state.session.abort());
    return { suppressOutput: true };
  };

  async function onPrompt(input) {
    if (NOT_A_PROMPT.test(String(input?.prompt ?? "").trimStart())) return undefined;
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

  async function checkPrompt(input) {
    let snap;
    let verdict;
    let question;
    try {
      await refreshSelection();
      snap = snapshot();
      verdict = decide({ snap, prompt: input?.prompt, config: loadConfig(dir), refusedKey: state.refusedKey, busy: state.busy });
      if (verdict.action === "refuse") question = coldQuestion(snap);
    } catch {
      return undefined; // never block the user's message on our own failure
    }
    if (verdict.action === "warn") say(coldWarn(snap), { level: "warning" });
    if (verdict.action !== "refuse") return undefined;
    state.refusedKey = verdict.key;
    quietly(() => saveRefusal(dir, state.session?.sessionId, verdict.key, now()));
    const revision = state.selectionRevision;
    const answer = await ask(state.session, timers, question, [SEND, HOLD]);
    if (answer === SEND) {
      await refreshSelection();
      if (revision !== state.selectionRevision) {
        say("cache-clock: model selection changed while the question was open; that quote no longer applies. Send again to check the new selection.", warnLevel);
        return settle(HOLD);
      }
    }
    if (answer === UNASKED) say(refusal(snap), warnLevel);
    if (answer === EXPIRED) say(EXPIRED_NOTE, warnLevel);
    if (answer === null) say(DISMISSED_NOTE, warnLevel);
    return settle(answer);
  }

  const onCommand = async (context) => {
    if (parseCommand(context?.args).kind === "status") await refreshSelection();
    return runCommand({ context, clock, snapshot, dir, show, scheduleHeadsUp });
  };

  state.session = await joinSession({
    commands: [{ name: "cache-clock", description: "Prompt-cache clock: cold-send price, guard settings", handler: onCommand }],
    hooks: { onUserPromptSubmitted: onPrompt },
  });

  seed(clock, readHistory, state.session, select);
  state.refusedKey = loadRefusal(dir, state.session.sessionId, now());
  scheduleHeadsUp();

  state.session.on("session.model_change", (event) => {
    if (event.agentId) return;
    select(event.data, true);
    scheduleHeadsUp();
  });
  state.session.on("session.model_deselected", (event) => {
    if (event.agentId) return;
    select(null, true);
    scheduleHeadsUp();
  });
  state.session.on("assistant.turn_start", (event) => {
    if (event.agentId) return;
    state.busy = true;
  });
  state.session.on("session.idle", (event) => {
    if (event.agentId) return;
    state.busy = false;
    // A heads-up skipped because a turn was running gets another chance now.
    scheduleHeadsUp();
  });
  state.session.on("assistant.usage", (event) => {
    const call = mainCall(event);
    if (call && clock.ingest(call)) scheduleHeadsUp();
  });
  state.session.on("session.compaction_complete", (event) => {
    if (event.agentId || !compacted(event)) return;
    clock.invalidate();
    scheduleHeadsUp();
  });

  await refreshSelection();
  return { session: state.session, clock };
}

function headsUpScheduler({ state, clock, now, timers, dir, say }) {
  timers.clearTimeout(state.headsUpTimer);
  state.headsUpTimer = null;
  const config = loadConfig(dir);
  const snap = clock.snapshot(now(), state.selection);
  if (config.headsUpMin <= 0 || snap?.state !== "warm") return;
  const key = `${snap.model}@${snap.expiresAt}`;
  if (state.headsUpShown === key) return; // once per cache
  // A 5-minute lead on a 5-minute cache would fire right after every call.
  const leadMs = Math.min(config.headsUpMin * 60_000, snap.ttlSec ? (snap.ttlSec * 1000) / HEADS_UP_TTL_SHARE : Infinity);
  state.headsUpTimer = timers.setTimeout(() => {
    state.headsUpTimer = null;
    const live = clock.snapshot(now(), state.selection);
    // Mid-turn the next model call refreshes the cache on its own.
    if (state.busy || live?.state !== "warm" || live.extraUsd === null) return;
    if (live.extraUsd < loadConfig(dir).minUsd) return;
    state.headsUpShown = key;
    say(headsUp(live), { ephemeral: true });
  }, Math.max(0, snap.msLeft - leadMs));
  state.headsUpTimer?.unref?.();
}

function runCommand({ context, clock, snapshot, dir, show, scheduleHeadsUp }) {
  const parsed = parseCommand(context?.args);
  if (parsed.kind === "status") return show(card(snapshot(), clock.tally(), loadConfig(dir)));
  if (parsed.kind === "help") return show(HELP);
  if (parsed.kind === "error") return show(`cache-clock: ${parsed.message}. Try /cache-clock help.`, { level: "error" });
  const next = { ...loadConfig(dir), ...parsed.patch };
  try {
    saveConfig(dir, next);
  } catch (err) {
    return show(`cache-clock: could not save settings to ${dir}: ${err.message}`, { level: "error" });
  }
  scheduleHeadsUp();
  const heads = next.headsUpMin > 0 ? `${next.headsUpMin}m` : "off";
  return show(`cache-clock: guard: ${next.mode} · min ${usd(next.minUsd)} · heads-up ${heads} (saved for all sessions)`);
}
