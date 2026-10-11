// Connects the pure clock and guard to a Copilot session. `joinSession`, the
// clock and the timers are injected so tests can drive it without Copilot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClock } from "./clock.mjs";
import { configDir, loadConfig, parseCommand, saveConfig } from "./config.mjs";
import { HELP, card, coldWarn, headsUp, refusal, usd } from "./format.mjs";
import { decide } from "./guard.mjs";
import { normalizeUsage } from "./usage.mjs";

const MAIN_INTERACTION = "conversation-agent";
// The heads-up comes at most a fifth of the ttl before expiry.
const HEADS_UP_TTL_SHARE = 5;

/** Main-agent conversation calls only: sub-agents and background calls have their own caches. */
const isMainCall = (event) => !event.agentId && (event.data?.interactionType ?? MAIN_INTERACTION) === MAIN_INTERACTION;

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
    if (event.type === "session.compaction_complete") clock.invalidate();
    if (event.type !== "session.usage_record") continue;
    const replay = { ...event, data: event.data?.usage };
    if (isMainCall(replay)) clock.ingest(normalizeUsage(replay.data, event.timestamp));
  }
}

export async function attach({ joinSession, now = Date.now, timers = globalThis, dir = configDir(), readHistory = readSessionLog }) {
  const clock = createClock();
  let refusedKey = null;
  let headsUpTimer = null;
  let session = null;

  // Fire and forget: a failing or slow timeline must never block a prompt.
  const say = (message, options) => {
    try {
      Promise.resolve(session?.log(message, options)).catch(() => {});
    } catch {
      // the host is gone; nothing to tell
    }
  };

  function scheduleHeadsUp() {
    timers.clearTimeout(headsUpTimer);
    headsUpTimer = null;
    const config = loadConfig(dir);
    const snap = clock.snapshot(now());
    if (config.headsUpMin <= 0 || snap?.state !== "warm") return;
    // A 5-minute lead on a 5-minute cache would fire right after every call.
    const leadMs = Math.min(config.headsUpMin * 60_000, snap.ttlSec ? (snap.ttlSec * 1000) / HEADS_UP_TTL_SHARE : Infinity);
    const delay = snap.msLeft - leadMs;
    headsUpTimer = timers.setTimeout(() => {
      headsUpTimer = null;
      const live = clock.snapshot(now());
      if (live?.state === "warm" && live.extraUsd !== null && live.extraUsd >= loadConfig(dir).minUsd) {
        say(headsUp(live), { ephemeral: true });
      }
    }, Math.max(0, delay));
    headsUpTimer?.unref?.();
  }

  function onPrompt(input) {
    const snap = clock.snapshot(now());
    const verdict = decide({ snap, prompt: input?.prompt, config: loadConfig(dir), refusedKey });
    if (verdict.action === "refuse") {
      refusedKey = verdict.key;
      say(refusal(snap), { level: "warning" });
      // Not awaited: abort() waits for this hook to return, so awaiting it deadlocks.
      Promise.resolve(session.abort()).catch(() => {});
      return { suppressOutput: true };
    }
    if (verdict.action === "warn") say(coldWarn(snap), { level: "warning" });
    return undefined;
  }

  function onCommand(context) {
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
    return say(`cache-clock: guard: ${next.mode} · min ${usd(next.minUsd)} · heads-up ${next.headsUpMin > 0 ? `${next.headsUpMin}m` : "off"} (saved for all sessions)`);
  }

  session = await joinSession({
    commands: [{ name: "cache-clock", description: "Prompt-cache clock: cold-send price, guard settings", handler: onCommand }],
    hooks: { onUserPromptSubmitted: onPrompt },
  });

  seed(clock, readHistory, session);
  scheduleHeadsUp();

  session.on("assistant.usage", (event) => {
    if (!isMainCall(event)) return;
    if (!clock.ingest(normalizeUsage(event.data, event.timestamp))) return;
    scheduleHeadsUp();
  });
  session.on("session.compaction_complete", () => {
    clock.invalidate();
    scheduleHeadsUp();
  });

  return { session, clock };
}
