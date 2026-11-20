import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach } from "../../extension/lib/wiring.mjs";
import { createKeepWarmStore, saveConfig } from "../../extension/lib/config.mjs";
import { PING_DISPLAY, PING_PROMPT } from "../../extension/lib/keepwarm.mjs";
import { usage, pingUsage, T0, MIN } from "../fixtures.mjs";

export const iso = (ms) => new Date(ms).toISOString();

// A stand-in for the CopilotSession an extension gets from joinSession().
// `answer` turns on in-chat questions: a value (or function of the question) for ui.select,
// "pending" for a question nobody answers, or an Error for a host that throws.
export function fakeHost({ config = { mode: "refuse", minUsd: 0.1, headsUpMin: 5 }, dir = mkdtempSync(join(tmpdir(), "cc-wiring-")), env = {}, answer, pid = 1, alive = new Set([pid]), autoReply = true, emitUserMessage = true } = {}) {
  saveConfig(dir, config);
  const host = { now: T0, logs: [], aborts: 0, handlers: new Map(), timers: [], joinConfig: null, asked: [], selected: { modelId: "claude-sonnet-5.5" }, pid, alive, sent: [], autoReply, emitUserMessage, hostGone: null };
  // Both send paths record the request and, like the host, answer with a ping turn.
  const recordSend = (params) => {
    host.sent.push(params);
    if (host.autoReply) queueMicrotask(() => host.replyToPing());
    return `msg-${host.sent.length}`;
  };
  const ui = answer === undefined ? {} : {
    capabilities: { ui: { elicitation: true } },
    ui: {
      select: async (message, options) => {
        host.asked.push({ message, options });
        if (answer instanceof Error) throw answer;
        if (answer === "pending") return new Promise(() => {});
        return typeof answer === "function" ? answer(message, options) : answer;
      },
    },
  };
  host.session = {
    ...ui,
    sessionId: "s-1",
    rpc: { model: { getCurrent: async () => host.selected }, send: async (params) => recordSend(params) },
    send: async (params) => recordSend(params),
    log: async (message, options = {}) => { host.logs.push({ message, ...options }); },
    // Never resolves: the real abort() waits for the prompt hook, so awaiting it deadlocks.
    abort: () => { host.aborts += 1; return new Promise(() => {}); },
    on: (type, fn) => {
      host.handlers.set(type, [...(host.handlers.get(type) ?? []), fn]);
      return () => {};
    },
  };
  host.joinSession = async (cfg) => { host.joinConfig = cfg; return host.session; };
  host.emit = (type, data, extra = {}) => {
    if (type === "session.model_change" && !extra.agentId) host.selected = { modelId: data.newModel, providerId: data.providerId, contextTier: data.contextTier };
    if (type === "session.model_deselected" && !extra.agentId) host.selected = {};
    for (const fn of host.handlers.get(type) ?? []) fn({ type, data, timestamp: new Date(host.now).toISOString(), ...extra });
  };
  host.timerApi = {
    setTimeout: (fn, ms) => { const t = { fn, due: host.now + ms, cleared: false, unref() {} }; host.timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  };
  host.advance = (ms) => {
    host.now += ms;
    for (const t of host.timers) if (!t.cleared && !t.fired && t.due <= host.now) { t.fired = true; t.fn(); }
  };
  host.prompt = (prompt) => host.joinConfig.hooks.onUserPromptSubmitted({ prompt, timestamp: new Date(host.now), workingDirectory: "/" });
  host.command = (args) => host.joinConfig.commands.find((c) => c.name === "cache-clock").handler({ sessionId: "s-1", command: `/cache-clock ${args}`, commandName: "cache-clock", args });
  host.history = "";
  const readHistory = () => { if (host.history instanceof Error) throw host.history; return host.history; };
  host.replyToPing = () => {
    if (host.emitUserMessage) host.emit("user.message", { content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" });
    host.emit("assistant.turn_start", {});
    host.emit("assistant.usage", pingUsage({ at: iso(host.now) }));
    host.emit("session.idle", {});
  };
  host.turn = async (text = "carry on", o = {}) => {
    await host.prompt(text);
    host.emit("user.message", { content: text, source: "user" });
    host.emit("assistant.turn_start", {});
    host.emit("assistant.usage", sonnet({ at: iso(host.now), ...o }));
    host.emit("session.idle", {});
  };
  host.run = async (ms, step = 10_000) => { for (const end = host.now + ms; host.now < end;) { host.advance(step); await flush(); } };
  host.start = () => attach({
    joinSession: host.joinSession, now: () => host.now, timers: host.timerApi, dir, readHistory, env,
    keepWarmStore: (d, id) => createKeepWarmStore(d, id, { pid: host.pid, isAlive: (p) => host.alive.has(p) }),
    onHostGone: (fn) => { host.hostGone = fn; },
  });
  host.dir = dir;
  return host;
}

// Let bounded RPCs and question promises settle without depending on microtask depth.
export const flush = () => new Promise((resolve) => setImmediate(resolve));

export const sonnet = (o = {}) => usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0, ...o });

export const goCold = async (h) => {
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
};
