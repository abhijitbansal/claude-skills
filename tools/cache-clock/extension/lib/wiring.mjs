// Connects the pure clock and guard to a Copilot session. `joinSession`, the
// clock and the timers are injected so tests can drive it without Copilot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClock } from "./clock.mjs";
import { configDir, loadConfig, loadRefusal, parseCommand, saveConfig, saveRefusal } from "./config.mjs";
import { HELP, card, coldWarn, headsUp, refusal, usd } from "./format.mjs";
import { decide } from "./guard.mjs";
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
function seed(clock, readHistory, session) {
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
    if (event.type === "session.compaction_complete" && compacted(event)) clock.invalidate();
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

export async function attach({ joinSession, now = Date.now, timers = globalThis, dir = configDir(), readHistory = readSessionLog }) {
  const clock = createClock();
  const state = { session: null, refusedKey: null, busy: false, headsUpTimer: null };
  const say = (message, options) => quietly(() => state.session?.log(message, options));
  const scheduleHeadsUp = () => headsUpScheduler({ state, clock, now, timers, dir, say });

  function onPrompt(input) {
    try {
      const snap = clock.snapshot(now());
      const verdict = decide({ snap, prompt: input?.prompt, config: loadConfig(dir), refusedKey: state.refusedKey, busy: state.busy });
      if (verdict.action === "refuse") {
        state.refusedKey = verdict.key;
        quietly(() => saveRefusal(dir, state.session?.sessionId, verdict.key, now()));
        say(refusal(snap), { level: "warning" });
        // Not awaited: abort() waits for this hook to return, so awaiting it deadlocks.
        quietly(() => state.session.abort());
        return { suppressOutput: true };
      }
      if (verdict.action === "warn") say(coldWarn(snap), { level: "warning" });
    } catch {
      // never block the user's message on our own failure
    }
    return undefined;
  }

  const onCommand = (context) => runCommand({ context, clock, now, dir, say, scheduleHeadsUp });

  state.session = await joinSession({
    commands: [{ name: "cache-clock", description: "Prompt-cache clock: cold-send price, guard settings", handler: onCommand }],
    hooks: { onUserPromptSubmitted: onPrompt },
  });

  seed(clock, readHistory, state.session);
  state.refusedKey = loadRefusal(dir, state.session.sessionId);
  scheduleHeadsUp();

  state.session.on("assistant.turn_start", () => {
    state.busy = true;
  });
  state.session.on("session.idle", () => {
    state.busy = false;
  });
  state.session.on("assistant.usage", (event) => {
    const call = mainCall(event);
    if (call && clock.ingest(call)) scheduleHeadsUp();
  });
  state.session.on("session.compaction_complete", (event) => {
    if (!compacted(event)) return;
    clock.invalidate();
    scheduleHeadsUp();
  });

  return { session: state.session, clock };
}

function headsUpScheduler({ state, clock, now, timers, dir, say }) {
  timers.clearTimeout(state.headsUpTimer);
  state.headsUpTimer = null;
  const config = loadConfig(dir);
  const snap = clock.snapshot(now());
  if (config.headsUpMin <= 0 || snap?.state !== "warm") return;
  // A 5-minute lead on a 5-minute cache would fire right after every call.
  const leadMs = Math.min(config.headsUpMin * 60_000, snap.ttlSec ? (snap.ttlSec * 1000) / HEADS_UP_TTL_SHARE : Infinity);
  state.headsUpTimer = timers.setTimeout(() => {
    state.headsUpTimer = null;
    const live = clock.snapshot(now());
    // Mid-turn the next model call refreshes the cache on its own.
    if (state.busy || live?.state !== "warm" || live.extraUsd === null) return;
    if (live.extraUsd >= loadConfig(dir).minUsd) say(headsUp(live), { ephemeral: true });
  }, Math.max(0, snap.msLeft - leadMs));
  state.headsUpTimer?.unref?.();
}

function runCommand({ context, clock, now, dir, say, scheduleHeadsUp }) {
  const parsed = parseCommand(context?.args);
  if (parsed.kind === "status") return say(card(clock.snapshot(now()), clock.tally(), loadConfig(dir)));
  if (parsed.kind === "help") return say(HELP);
  if (parsed.kind === "error") return say(`cache-clock: ${parsed.message}. Try /cache-clock help.`, { level: "error" });
  const next = { ...loadConfig(dir), ...parsed.patch };
  try {
    saveConfig(dir, next);
  } catch (err) {
    return say(`cache-clock: could not save settings to ${dir}: ${err.message}`, { level: "error" });
  }
  scheduleHeadsUp();
  const heads = next.headsUpMin > 0 ? `${next.headsUpMin}m` : "off";
  return say(`cache-clock: guard: ${next.mode} · min ${usd(next.minUsd)} · heads-up ${heads} (saved for all sessions)`);
}
