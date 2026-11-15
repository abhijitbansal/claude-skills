import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach } from "../extension/lib/wiring.mjs";
import { createKeepWarmStore, loadConfig, saveConfig } from "../extension/lib/config.mjs";
import { PING_DISPLAY, PING_PROMPT } from "../extension/lib/keepwarm.mjs";
import { usage, pingUsage, T0, MIN } from "./fixtures.mjs";

const iso = (ms) => new Date(ms).toISOString();

// A stand-in for the CopilotSession an extension gets from joinSession().
// `answer` turns on in-chat questions: a value (or function of the question) for ui.select,
// "pending" for a question nobody answers, or an Error for a host that throws.
function fakeHost({ config = { mode: "refuse", minUsd: 0.1, headsUpMin: 5 }, dir = mkdtempSync(join(tmpdir(), "cc-wiring-")), env = {}, answer, pid = 1, alive = new Set([pid]), autoReply = true, emitUserMessage = true } = {}) {
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
    host.emit("user.message", { content: text });
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
const flush = () => new Promise((resolve) => setImmediate(resolve));

const sonnet = (o = {}) => usage({ model: "claude-sonnet-5.5", ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0, ...o });

test("registers a /cache-clock command and a prompt hook", async () => {
  const h = fakeHost();
  await h.start();
  assert.equal(h.joinConfig.commands[0].name, "cache-clock");
  assert.equal(typeof h.joinConfig.hooks.onUserPromptSubmitted, "function");
});

test("a costly cold send is refused once without awaiting abort, and the resend goes through", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  const first = await h.prompt("give me a recap");
  assert.equal(h.aborts, 1);
  assert.deepEqual(first, { suppressOutput: true });
  assert.match(h.logs.at(-1).message, /went cold 2m00s ago/);
  assert.equal(h.logs.at(-1).level, "warning");
  const second = await h.prompt("give me a recap");
  assert.equal(h.aborts, 1);
  assert.equal(second, undefined);
  assert.match(h.logs.at(-1).message, /sending cold/);
});

const goCold = async (h) => {
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
};

test("when the host can ask, a costly cold send becomes a question with the price", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await goCold(h);
  const result = await h.prompt("give me a recap");
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].message, /went cold 2m00s ago/);
  assert.match(h.asked[0].message, /\$0\.\d+/);
  assert.deepEqual(h.asked[0].options, ["Send anyway", "Don't send"]);
  assert.deepEqual(result, { suppressOutput: true });
  assert.equal(h.aborts, 1);
  assert.equal(h.logs.length, 0, "the question replaces the refusal message");
});

test("answering Send anyway lets the cold send through without an abort", async () => {
  const h = fakeHost({ answer: "Send anyway" });
  await goCold(h);
  assert.equal(await h.prompt("give me a recap"), undefined);
  assert.equal(h.aborts, 0);
});

test("after one question the same cold episode is not asked again", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.equal(await h.prompt("give me a recap"), undefined);
  assert.equal(h.asked.length, 1);
  assert.match(h.logs.at(-1).message, /sending cold/);
});

test("a dismissed question holds the send", async () => {
  const h = fakeHost({ answer: null });
  await goCold(h);
  assert.deepEqual(await h.prompt("give me a recap"), { suppressOutput: true });
  assert.equal(h.aborts, 1);
});

// VS Code cancels every extension question in autopilot mode, which reads as a dismissal.
test("a dismissed or cancelled question says the send was held", async () => {
  const h = fakeHost({ answer: null });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.match(h.logs.at(-1).message, /held/);
  assert.match(h.logs.at(-1).message, /Send it again/);
});

test("in VS Code the held note for a cancelled question reaches the chat", async () => {
  const h = fakeHost({ env: { VSCODE_CANVAS_DATA_DIR: "/tmp/x" }, answer: null });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.equal(h.logs.at(-1).level, "error");
});

test("choosing Don't send needs no extra note", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.equal(h.logs.length, 0);
});

test("a host that throws on the question falls back to the refuse-once message", async () => {
  const h = fakeHost({ answer: new Error("elicitation not supported") });
  await goCold(h);
  assert.deepEqual(await h.prompt("give me a recap"), { suppressOutput: true });
  assert.equal(h.aborts, 1);
  assert.match(h.logs.at(-1).message, /Send it again to pay it/);
});

test("an unanswered question times out and holds the send", async () => {
  const h = fakeHost({ answer: "pending" });
  await goCold(h);
  const pending = h.prompt("give me a recap");
  await flush();
  h.advance(10 * MIN);
  assert.deepEqual(await pending, { suppressOutput: true });
  assert.equal(h.aborts, 1);
});

test("Send anyway still counts as asked: the next send in the episode only gets the note", async () => {
  const h = fakeHost({ answer: "Send anyway" });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.equal(await h.prompt("again"), undefined);
  assert.equal(h.asked.length, 1);
  assert.match(h.logs.at(-1).message, /sending cold/);
});

test("an answered question clears its timeout", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await goCold(h);
  const before = h.timers.length;
  await h.prompt("give me a recap");
  const questionTimer = h.timers.slice(before).find((t) => t.due - h.now >= 4 * MIN);
  assert.ok(questionTimer, "a question timeout was set");
  assert.equal(questionTimer.cleared, true);
});

test("an unanswered question says the send was held", async () => {
  const h = fakeHost({ answer: "pending" });
  await goCold(h);
  const pending = h.prompt("give me a recap");
  await flush();
  h.advance(10 * MIN);
  await pending;
  assert.match(h.logs.at(-1).message, /no answer/i);
});

test("a prompt sent while a question is pending waits for the same answer", async () => {
  let release;
  const h = fakeHost({ answer: () => new Promise((resolve) => { release = resolve; }) });
  await goCold(h);
  const first = h.prompt("give me a recap");
  await flush();
  const second = h.prompt("and another thing");
  await flush();
  release("Don't send");
  assert.deepEqual(await first, { suppressOutput: true });
  assert.deepEqual(await second, { suppressOutput: true });
  assert.equal(h.asked.length, 1, "asked once");
  assert.equal(h.aborts, 2, "each held send is stopped, none goes out");
});

// VS Code's agent host shows only error-level session messages in its chat (measured 11 Oct 2026),
// so command output goes into a question card there instead.
const VS_CODE = { VSCODE_CANVAS_DATA_DIR: "/tmp/agentHostCanvasData/x" };

test("in VS Code /cache-clock shows the card as a question with an OK button", async () => {
  const h = fakeHost({ env: VS_CODE, answer: "OK" });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  await h.command("");
  assert.match(h.asked.at(-1).message, /^cache-clock · /);
  assert.deepEqual(h.asked.at(-1).options, ["OK"]);
  assert.equal(h.logs.length, 0);
});

test("in VS Code /cache-clock returns without waiting for OK", async () => {
  const h = fakeHost({ env: VS_CODE, answer: "pending" });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  const outcome = await Promise.race([Promise.resolve(h.command("")).then(() => "returned"), new Promise((r) => setTimeout(() => r("waiting"), 20))]);
  assert.equal(outcome, "returned");
  assert.match(h.asked.at(-1).message, /^cache-clock · /);
});

test("in VS Code without questions, the card and the refusal fall back to error level so the chat shows them", async () => {
  const h = fakeHost({ env: VS_CODE });
  await goCold(h);
  await h.prompt("give me a recap");
  assert.match(h.logs.at(-1).message, /Send it again to pay it/);
  assert.equal(h.logs.at(-1).level, "error");
  await h.command("");
  assert.match(h.logs.at(-1).message, /^cache-clock · /);
  assert.equal(h.logs.at(-1).level, "error");
});

test("in the CLI /cache-clock prints the card at the default level, even when the host can ask", async () => {
  const h = fakeHost({ answer: "OK" });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  await h.command("");
  assert.equal(h.asked.length, 0);
  assert.match(h.logs.at(-1).message, /^cache-clock · /);
  assert.equal(h.logs.at(-1).level, undefined);
});

test("a warm send passes silently", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(2 * MIN);
  assert.equal(await h.prompt("next"), undefined);
  assert.equal(h.aborts, 0);
});

test("sub-agent and non-agent calls do not move the main clock", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  h.emit("assistant.usage", sonnet({ model: "gpt-6-luna", ttl: 1800 }), { agentId: "sub-1" });
  h.emit("assistant.usage", { ...sonnet({ ttl: 1800 }), interactionType: "conversation-background" });
  await h.prompt("recap");
  assert.equal(h.aborts, 1);
});

test("compaction makes the next send exempt", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.emit("session.compaction_complete", { success: true });
  h.advance(7 * MIN);
  await h.prompt("recap");
  assert.equal(h.aborts, 0);
});

test("a heads-up is logged before expiry when the cold price clears the threshold", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ ttl: 1800 }));
  h.advance(24 * MIN);
  assert.equal(h.logs.length, 0);
  h.advance(1 * MIN + 1);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0].message, /goes cold in 5m00s/);
  assert.equal(h.logs[0].ephemeral, true);
});

test("the heads-up lead never exceeds a fifth of a short ttl", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ ttl: 300 }));
  h.advance(3 * MIN);
  assert.equal(h.logs.length, 0);
  h.advance(1 * MIN + 1);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0].message, /goes cold in 1m00s/);
});

test("a new call reschedules the heads-up", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ ttl: 1800 }));
  h.advance(24 * MIN);
  h.emit("assistant.usage", sonnet({ ttl: 1800, at: new Date(h.now).toISOString() }));
  h.advance(2 * MIN);
  assert.equal(h.logs.length, 0);
  h.advance(23 * MIN + 1);
  assert.equal(h.logs.length, 1);
});

test("no heads-up for cheap caches or when disabled", async () => {
  const cheap = fakeHost();
  await cheap.start();
  cheap.emit("assistant.usage", usage({ ttl: 600 }));
  cheap.advance(10 * MIN);
  assert.equal(cheap.logs.length, 0);
  const off = fakeHost({ config: { mode: "refuse", minUsd: 0.1, headsUpMin: 0 } });
  await off.start();
  off.emit("assistant.usage", sonnet({ ttl: 600 }));
  off.advance(10 * MIN);
  assert.equal(off.logs.length, 0);
});

test("/cache-clock prints the card and changes settings", async () => {
  const h = fakeHost();
  await h.start();
  await h.command("");
  assert.match(h.logs.at(-1).message, /no model call yet/);
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  await h.command("");
  assert.match(h.logs.at(-1).message, /warm, 5m00s left/);
  await h.command("guard warn");
  assert.match(h.logs.at(-1).message, /guard: warn/);
  h.advance(7 * MIN);
  await h.prompt("recap");
  assert.equal(h.aborts, 0);
  await h.command("bogus");
  assert.equal(h.logs.at(-1).level, "error");
  await h.command("help");
  assert.match(h.logs.at(-1).message, /\/cache-clock guard refuse/);
});

test("a resumed session seeds the clock from persisted usage records", async () => {
  const h = fakeHost();
  const rec = (o, extra = {}) => ({ type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet(o) }, ...extra });
  h.history = [
    { type: "session.start", timestamp: new Date(T0).toISOString(), data: {} },
    rec({}),
    rec({ model: "gpt-6-luna", ttl: 1800 }, { agentId: "sub-1" }),
  ].map((e) => JSON.stringify(e)).join("\n") + "\n{truncated";
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("where were we");
  assert.equal(h.aborts, 1);
});

test("a compaction in the persisted history exempts the resumed send", async () => {
  const h = fakeHost();
  h.history = [
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
    { type: "session.compaction_complete", timestamp: new Date(T0).toISOString(), data: { success: true } },
  ].map((e) => JSON.stringify(e)).join("\n");
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("where were we");
  assert.equal(h.aborts, 0);
});

test("an unreadable session log leaves the clock empty instead of breaking startup", async () => {
  const h = fakeHost();
  h.history = new Error("ENOENT");
  await h.start();
  assert.equal(await h.prompt("hi"), undefined);
});

const coldHost = async (opts) => {
  const h = fakeHost(opts);
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  return h;
};

test("a synchronously throwing abort still returns from the hook", async () => {
  const h = fakeHost();
  h.session.abort = () => { throw new Error("sync abort"); };
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  assert.deepEqual(await h.prompt("recap"), { suppressOutput: true });
});

test("a synchronously throwing log never breaks the hook", async () => {
  const h = await coldHost();
  h.session.log = () => { throw new Error("sync log"); };
  await h.prompt("recap");
  assert.equal(h.aborts, 1);
});

test("a null line in the session log is skipped", async () => {
  const h = fakeHost();
  h.history = ["null", "42", JSON.stringify({ type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } })].join("\n");
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("recap");
  assert.equal(h.aborts, 1);
});

test("a refusal is remembered for the session across processes", async () => {
  const first = await coldHost();
  await first.prompt("recap");
  assert.equal(first.aborts, 1);
  const second = fakeHost({ dir: first.dir });
  second.now = first.now; // A resumed process cannot precede the refusal it loads.
  second.history = JSON.stringify({ type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } });
  await second.start();
  await second.prompt("recap");
  assert.equal(second.aborts, 0);
  assert.match(second.logs.at(-1).message, /sending cold/);
});

test("a prompt queued while a turn runs is warned about, never aborted", async () => {
  const h = await coldHost();
  h.emit("assistant.turn_start", { turnId: "1" });
  await h.prompt("queued follow-up");
  assert.equal(h.aborts, 0);
  assert.match(h.logs.at(-1).message, /sending cold/);
  h.emit("session.idle", {});
  await h.prompt("now idle");
  assert.equal(h.aborts, 1);
});

test("no heads-up fires mid-turn", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ ttl: 1800 }));
  h.emit("assistant.turn_start", { turnId: "1" });
  h.advance(26 * MIN);
  assert.equal(h.logs.length, 0);
});

test("a heads-up missed during a turn comes when the session goes idle, once", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ ttl: 1800 }));
  h.emit("assistant.turn_start", { turnId: "1" });
  h.advance(26 * MIN);
  assert.equal(h.logs.length, 0);
  h.emit("session.idle", {});
  h.advance(0);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0].message, /goes cold in/);
  h.emit("assistant.turn_start", { turnId: "2" });
  h.emit("session.idle", {});
  h.advance(0);
  assert.equal(h.logs.length, 1, "not repeated for the same cache");
});

test("a failed compaction does not exempt the next send", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.emit("session.compaction_complete", { success: false });
  h.advance(7 * MIN);
  await h.prompt("recap");
  assert.equal(h.aborts, 1);
});

test("a throwing session.log never breaks the prompt hook", async () => {
  const h = fakeHost();
  await h.start();
  h.session.log = async () => { throw new Error("host gone"); };
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  await h.prompt("recap");
  assert.equal(h.aborts, 1);
});

test("an unseen selected model never inherits the old warm clock or its price", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet());
  h.emit("session.model_change", { newModel: "new-model" });
  await h.command("");
  assert.match(h.logs.at(-1).message, /new-model/);
  assert.match(h.logs.at(-1).message, /unknown/);
  assert.doesNotMatch(h.logs.at(-1).message, /warm,|\$0\.50/);
  await h.prompt("continue");
  assert.equal(h.aborts, 0);
  assert.match(h.logs.at(-1).message, /new-model.*price.*unknown/i);
});

test("switch confirmation uses destination prices and the current conversation size", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await h.start();
  h.emit("assistant.usage", sonnet({ input: 10_000, write: 10_000 }));
  h.advance(MIN);
  h.emit("session.model_change", { newModel: "gpt-6-luna" });
  h.emit("assistant.usage", usage({ input: 200_000, output: 0 }));
  h.emit("session.model_change", { newModel: "claude-sonnet-5.5" });
  await h.prompt("continue");
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].message, /switch.*Claude Sonnet 5\.5/i);
  assert.match(h.asked[0].message, /200\.0k.*\$0\.50/);
  assert.doesNotMatch(h.asked[0].message, /went cold/);
});

test("pre-send RPC catches a selection change with no event", async () => {
  const h = await coldHost();
  h.selected = { modelId: "new-model" };
  await h.prompt("continue");
  assert.equal(h.aborts, 0, "must not refuse using the old model's cold price");
  assert.match(h.logs.at(-1).message, /new-model/);
});

test("changing selection while a confirmation is open holds the old quoted send", async () => {
  let release;
  const h = fakeHost({ answer: () => new Promise((resolve) => { release = resolve; }) });
  await goCold(h);
  const pending = h.prompt("continue");
  await flush();
  h.selected = { modelId: "new-model" }; // RPC catches even a missing event
  release("Send anyway");
  assert.deepEqual(await pending, { suppressOutput: true });
  assert.match(h.logs.at(-1).message, /selection changed/i);
});

test("Auto and provider-qualified selections do not borrow unqualified prices", async () => {
  const h = await coldHost();
  for (const selected of [{ modelId: "auto" }, { modelId: "claude-sonnet-5.5", providerId: "other" }, { modelId: "claude-sonnet-5.5", contextTier: "long_context" }]) {
    h.selected = selected;
    await h.command("");
    assert.match(h.logs.at(-1).message, /unknown/);
    assert.doesNotMatch(h.logs.at(-1).message, /\$0\.50/);
    await h.prompt("continue");
    assert.equal(h.aborts, 0);
  }
});

test("a failed model lookup is bounded and keeps the known selection and its guard", async () => {
  const h = await coldHost();
  h.session.rpc.model.getCurrent = () => new Promise(() => {});
  const pending = h.prompt("continue");
  await flush();
  h.advance(1000);
  assert.deepEqual(await pending, { suppressOutput: true });
  assert.equal(h.aborts, 1, "a lookup that never answers is not evidence the selection changed");
  assert.match(h.logs.at(-1).message, /went cold/);
});

// A lookup that fails after the question was asked must not read as a selection change.
for (const [name, fail] of [["hangs", () => new Promise(() => {})], ["throws", () => { throw new Error("rpc gone"); }]]) {
  test(`Send anyway still sends when the post-answer model lookup ${name}`, async () => {
    let release;
    const h = fakeHost({ answer: () => new Promise((resolve) => { release = resolve; }) });
    await goCold(h);
    const pending = h.prompt("continue");
    await flush();
    h.session.rpc.model.getCurrent = fail;
    release("Send anyway");
    await flush();
    h.advance(1000); // the bounded lookup gives up
    assert.equal(await pending, undefined);
    assert.equal(h.aborts, 0);
    assert.equal(h.logs.length, 0, "no 'selection changed' hold");
  });
}

test("a model-change event wins over an older in-flight RPC result", async () => {
  const h = await coldHost();
  let release;
  h.session.rpc.model.getCurrent = () => new Promise((resolve) => { release = resolve; });
  const pending = h.prompt("continue");
  await flush();
  h.emit("session.model_change", { newModel: "new-model" });
  release({ modelId: "claude-sonnet-5.5" });
  await pending;
  assert.equal(h.aborts, 0);
  assert.match(h.logs.at(-1).message, /new-model/);
});

test("switching cancels the old model's scheduled heads-up", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet());
  h.emit("session.model_change", { newModel: "new-model" });
  h.advance(4 * MIN + 1);
  assert.equal(h.logs.length, 0);
});

test("subagent idle and compaction cannot reset the main guard", async () => {
  const h = await coldHost();
  h.emit("assistant.turn_start", {});
  h.emit("session.idle", {}, { agentId: "sub" });
  await h.prompt("queued");
  assert.equal(h.aborts, 0);
  h.emit("session.idle", {});
  h.emit("session.compaction_complete", { success: true }, { agentId: "sub" });
  await h.prompt("continue");
  assert.equal(h.aborts, 1);
});

test("clearing a provider selection cannot revive cached prices from another provider", async () => {
  const h = await coldHost();
  h.emit("session.model_change", { newModel: "claude-sonnet-5.5", providerId: "other" });
  h.emit("assistant.usage", sonnet({ at: new Date(h.now).toISOString() }));
  h.emit("session.model_change", { newModel: "claude-sonnet-5.5" });
  await h.command("");
  assert.match(h.logs.at(-1).message, /unknown/);
  assert.doesNotMatch(h.logs.at(-1).message, /\$0\.50/);
});

test("subagent model/start events and recoverable errors cannot change main lifecycle", async () => {
  const h = await coldHost();
  h.emit("session.model_change", { newModel: "new-model" }, { agentId: "sub" });
  h.emit("assistant.turn_start", {}, { agentId: "sub" });
  await h.prompt("continue");
  assert.equal(h.aborts, 1);
  const running = await coldHost();
  running.emit("assistant.turn_start", {});
  running.emit("session.error", { errorType: "rate_limit", recoverable: true });
  running.emit("abort", { reason: "abort requested" });
  await running.prompt("queued");
  assert.equal(running.aborts, 0, "only a root idle event establishes the end of processing");
});

test("a turn starting during an open question is never aborted by its answer", async () => {
  let release;
  const h = fakeHost({ answer: () => new Promise((resolve) => { release = resolve; }) });
  await goCold(h);
  const pending = h.prompt("continue");
  await flush();
  h.emit("assistant.turn_start", {});
  release("Don't send");
  assert.equal(await pending, undefined);
  assert.equal(h.aborts, 0);
});

test("old hosts use persisted selection events, but never infer selection from usage", async () => {
  const h = fakeHost();
  delete h.session.rpc;
  h.history = [
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
    { type: "session.model_change", data: { newModel: "new-model" } },
  ].map(JSON.stringify).join("\n");
  await h.start();
  await h.command("");
  assert.match(h.logs.at(-1).message, /new-model/);
  h.emit("session.model_deselected", {});
  await h.command("");
  assert.match(h.logs.at(-1).message, /unknown selection/);
});

test("old hosts restore explicit selection from session.start without a model-change event", async () => {
  const h = fakeHost();
  delete h.session.rpc;
  h.history = [
    { type: "session.start", data: { selectedModel: "claude-sonnet-5.5" } },
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
  ].map(JSON.stringify).join("\n");
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("continue");
  assert.equal(h.aborts, 1);
  assert.match(h.logs.at(-1).message, /Claude Sonnet 5\.5.*went cold/);
});

test("a root resume snapshot supersedes older model-change events on old hosts", async () => {
  const h = fakeHost();
  delete h.session.rpc;
  h.history = [
    { type: "session.model_change", data: { newModel: "claude-sonnet-5.5" } },
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
    { type: "session.resume", data: { selectedModel: "new-model", providerId: "provider-b", contextTier: "long_context" } },
    { type: "session.resume", agentId: "sub", data: { selectedModel: "claude-sonnet-5.5" } },
  ].map(JSON.stringify).join("\n");
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("continue");
  assert.equal(h.aborts, 0);
  assert.match(h.logs.at(-1).message, /new-model.*provider\/context tier/);
});

test("unknown-selection warnings reach VS Code chat without aborting the send", async () => {
  const h = await coldHost({ env: { VSCODE_CANVAS_DATA_DIR: "/tmp/x" } });
  h.selected = { modelId: "new-model" };
  await h.prompt("continue");
  assert.equal(h.aborts, 0);
  assert.match(h.logs.at(-1).message, /price.*unknown/i);
  assert.equal(h.logs.at(-1).level, "error", "the VS Code host renders only error-level session logs in chat");
});

for (const flag of ["sessionWasActive", "continuePendingWork"]) {
  test(`resume with ${flag} cannot abort work that started before attachment`, async () => {
    const h = fakeHost();
    h.history = [
      { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
      { type: "session.resume", data: { selectedModel: "claude-sonnet-5.5", [flag]: true } },
    ].map(JSON.stringify).join("\n");
    await h.start();
    h.advance(7 * MIN);
    h.emit("session.idle", {}, { agentId: "sub" });
    assert.equal(await h.prompt("queued"), undefined);
    assert.equal(h.aborts, 0);
    h.emit("session.idle", {});
    assert.deepEqual(await h.prompt("continue"), { suppressOutput: true });
    assert.equal(h.aborts, 1);
  });
}

test("cold resumes and recorded root idle events clear historical busy state", async () => {
  for (const tail of [
    [{ type: "session.resume", data: { selectedModel: "claude-sonnet-5.5", sessionWasActive: false } }],
    [{ type: "session.resume", data: { sessionWasActive: true } }, { type: "session.idle", data: {} }],
  ]) {
    const h = fakeHost();
    h.history = [
      { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
      { type: "assistant.turn_start", data: {} },
      ...tail,
    ].map(JSON.stringify).join("\n");
    await h.start();
    h.advance(7 * MIN);
    assert.deepEqual(await h.prompt("continue"), { suppressOutput: true });
    assert.equal(h.aborts, 1);
  }
});

test("an unfinished recorded root turn stays busy across subagent lifecycle events", async () => {
  const h = fakeHost();
  h.history = [
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } },
    { type: "assistant.turn_start", data: {} },
    { type: "session.resume", agentId: "sub", data: { sessionWasActive: false } },
    { type: "session.idle", agentId: "sub", data: {} },
  ].map(JSON.stringify).join("\n");
  await h.start();
  h.advance(7 * MIN);
  assert.equal(await h.prompt("queued"), undefined);
  assert.equal(h.aborts, 0);
});

test("lookup failures never block commands, sends, or startup", async () => {
  for (const getCurrent of [() => { throw new Error("unsupported"); }, async () => null, async () => ({ modelId: 42 })]) {
    const h = fakeHost();
    h.session.rpc.model.getCurrent = getCurrent;
    await h.start();
    h.emit("assistant.usage", sonnet());
    h.advance(7 * MIN);
    await h.command("");
    assert.match(h.logs.at(-1).message, /unknown selection/);
    assert.equal(await h.prompt("continue"), undefined);
    assert.equal(h.aborts, 0);
  }
});

test("simultaneous prompts share the selection lookup and one question", async () => {
  const h = await coldHost({ answer: "Don't send" });
  let release;
  let lookups = 0;
  h.session.rpc.model.getCurrent = () => { lookups += 1; return new Promise((resolve) => { release = resolve; }); };
  const first = h.prompt("first");
  const second = h.prompt("second");
  await flush();
  release(h.selected);
  assert.deepEqual(await first, { suppressOutput: true });
  assert.deepEqual(await second, { suppressOutput: true });
  assert.equal(lookups, 1);
  assert.equal(h.asked.length, 1);
});

test("a repeated selection event still supersedes an in-flight RPC snapshot", async () => {
  const h = await coldHost();
  let release;
  h.session.rpc.model.getCurrent = () => new Promise((resolve) => { release = resolve; });
  const pending = h.prompt("continue");
  await flush();
  h.emit("session.model_change", { newModel: "claude-sonnet-5.5" });
  release({ modelId: "new-model" });
  assert.deepEqual(await pending, { suppressOutput: true });
  assert.match(h.logs.at(-1).message, /Claude Sonnet 5\.5/);
});

const AUTO_LUNA = { chosenModel: "gpt-6-luna", reasoningEffort: "medium" };

test("Auto resolved to a priced model asks about a cold cache like any other selection", async () => {
  const h = fakeHost({ answer: "Don't send" });
  await h.start();
  h.emit("assistant.usage", usage({ at: new Date(T0).toISOString(), ttl: 300, input: 2_000_000, read: 0, write: 2_000_000, output: 0 }));
  h.selected = { modelId: "auto" };
  h.emit("session.model_change", { newModel: "auto" });
  h.emit("session.auto_mode_resolved", AUTO_LUNA);
  h.advance(7 * MIN);
  assert.deepEqual(await h.prompt("continue"), { suppressOutput: true });
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].message, /GPT-6 Luna.*went cold/);
  assert.equal(h.logs.length, 0, "no unknown-state warning");
});

test("Auto resolution seeded from history prices the cold send, and a sub-agent resolution is ignored", async () => {
  const h = fakeHost({ answer: "Don't send" });
  h.history = [
    { type: "session.model_change", data: { newModel: "auto" } },
    { type: "session.auto_mode_resolved", data: AUTO_LUNA },
    { type: "session.auto_mode_resolved", agentId: "sub", data: { chosenModel: "claude-sonnet-5.5" } },
    { type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: usage({ at: new Date(T0).toISOString(), ttl: 300, input: 2_000_000, read: 0, write: 2_000_000, output: 0 }) } },
  ].map(JSON.stringify).join("\n");
  h.selected = { modelId: "auto" };
  await h.start();
  h.advance(7 * MIN);
  await h.prompt("continue");
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].message, /GPT-6 Luna/);
});

test("Auto that has not resolved warns once, not on every prompt", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.selected = { modelId: "auto" };
  h.emit("session.model_change", { newModel: "auto" });
  h.advance(7 * MIN);
  assert.equal(await h.prompt("one"), undefined);
  assert.equal(await h.prompt("two"), undefined);
  assert.equal(h.aborts, 0);
  assert.equal(h.logs.filter((l) => /Auto has not resolved/.test(l.message)).length, 1);
});

test("Auto resolved to an unpriced model falls back to the unknown-state warning, once", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.selected = { modelId: "auto" };
  h.emit("session.model_change", { newModel: "auto" });
  h.emit("session.auto_mode_resolved", { chosenModel: "never-seen-model" });
  h.advance(7 * MIN);
  await h.prompt("one");
  await h.prompt("two");
  assert.equal(h.aborts, 0);
  assert.equal(h.logs.filter((l) => /unknown/.test(l.message)).length, 1);
});

test("a persisted turn that ended (turn_end, no session.idle) does not leave the guard busy", async () => {
  const h = fakeHost({ answer: "Don't send" });
  const at = new Date(T0).toISOString();
  h.history = [
    { type: "session.start", data: { selectedModel: "claude-sonnet-5.5" } },
    { type: "session.model_change", data: { newModel: "claude-sonnet-5.5" } },
    { type: "assistant.turn_start", data: {} },
    { type: "session.usage_record", timestamp: at, data: { usage: sonnet({ at }) } },
    { type: "assistant.turn_end", data: {} },
  ].map(JSON.stringify).join("\n");
  await h.start();
  h.advance(7 * MIN);
  assert.deepEqual(await h.prompt("continue"), { suppressOutput: true });
  assert.equal(h.asked.length, 1);
});

test("a persisted session.shutdown clears busy state from an earlier unfinished turn", async () => {
  const h = fakeHost({ answer: "Don't send" });
  const at = new Date(T0).toISOString();
  h.history = [
    { type: "session.usage_record", timestamp: at, data: { usage: sonnet({ at }) } },
    { type: "assistant.turn_start", data: {} },
    { type: "session.shutdown", data: {} },
  ].map(JSON.stringify).join("\n");
  await h.start();
  h.advance(7 * MIN);
  assert.deepEqual(await h.prompt("continue"), { suppressOutput: true });
});

test("Auto resolving again while the question is open does not hold Send anyway", async () => {
  let release;
  const h = fakeHost({ answer: () => new Promise((resolve) => { release = resolve; }) });
  await h.start();
  h.emit("assistant.usage", usage({ at: new Date(T0).toISOString(), ttl: 300, input: 2_000_000, read: 0, write: 2_000_000, output: 0 }));
  h.selected = { modelId: "auto" };
  h.emit("session.model_change", { newModel: "auto" });
  h.emit("session.auto_mode_resolved", AUTO_LUNA);
  h.advance(7 * MIN);
  const pending = h.prompt("continue");
  await flush();
  h.emit("session.auto_mode_resolved", { chosenModel: "claude-sonnet-5.5" }); // Auto picks for the pending send
  release("Send anyway");
  assert.equal(await pending, undefined);
  assert.equal(h.aborts, 0);
});

test("returning to Auto forgets the old pick and warns again", async () => {
  const h = fakeHost();
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  const choose = (modelId) => { h.selected = { modelId }; h.emit("session.model_change", { newModel: modelId }); };
  const unknownWarnings = () => h.logs.filter((l) => /Auto has not resolved/.test(l.message)).length;
  choose("auto");
  h.emit("session.auto_mode_resolved", { chosenModel: "claude-sonnet-5.5" });
  await h.prompt("one");
  assert.equal(unknownWarnings(), 0, "a priced pick is guarded normally");
  choose("gpt-6-luna");
  choose("auto");
  await h.prompt("two");
  assert.equal(unknownWarnings(), 1, "the earlier pick is not reused");
  choose("claude-sonnet-5.5");
  choose("auto");
  await h.prompt("three");
  assert.equal(unknownWarnings(), 2, "each return to Auto warns once");
});

// Keep-warm: the scheduler wired to a fake host that answers each ping like Copilot does.
const HOUR = 60 * MIN;
const KW = { mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 3, keepWarmMaxUsd: 0.5, keepWarmPayback: true };
const lastLog = (h) => h.logs.at(-1).message;
const record = (type, ms, data) => JSON.stringify({ type, timestamp: iso(ms), data });
const sessionLockFile = (dir, id) => join(dir, "keepwarm", `${createHash("sha256").update(id).digest("hex")}.lock`);
const PING_MESSAGE = { content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" };

test("keep-warm is off by default: no ping in an hour", async () => {
  const h = fakeHost();
  await h.start();
  await h.turn();
  await h.run(HOUR);
  assert.equal(h.sent.length, 0);
});

test("a ping goes through rpc.send with the fixed prompt and flags", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.deepEqual(h.sent[0], { prompt: PING_PROMPT, displayPrompt: PING_DISPLAY, source: "system", mode: "enqueue", billable: false });
});

test("without rpc.send the ping falls back to session.send", async () => {
  const h = fakeHost({ config: KW });
  delete h.session.rpc.send;
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.deepEqual(h.sent[0], { prompt: PING_PROMPT, displayPrompt: PING_DISPLAY, source: "system", mode: "enqueue" });
});

test("pings are not model calls, never ask, and show on the card", async () => {
  const h = fakeHost({ config: KW, answer: "Don't send" });
  await h.start();
  await h.turn();
  await h.run(30 * MIN);
  await h.command("");
  assert.match(lastLog(h), /session +1 model calls/);
  assert.match(lastLog(h), /keep-warm  on · 2h30m left · 7 pings · \$0\.14/);
  assert.equal(h.asked.length, 0);
});

test("a host without user.message still files pings by the in-flight flag", async () => {
  const h = fakeHost({ config: KW, emitUserMessage: false });
  await h.start();
  await h.turn();
  await h.run(30 * MIN);
  await h.command("");
  assert.match(lastLog(h), /session +1 model calls/);
});

test("no heads-up line while keep-warm is on", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  await h.turn();
  await h.run(30 * MIN);
  assert.ok(h.logs.every((l) => !/goes cold in/.test(l.message)));
});

test("a ping's own prompt hook is never guarded, on a cache that has just gone cold", async () => {
  const h = fakeHost({ config: KW, answer: "Don't send" });
  h.autoReply = false;
  await h.start();
  await h.turn();
  // The ping goes out at 240 s and gets no reply; the cache expires at 300 s; the watchdog fires at 360 s.
  await h.run(5 * MIN + 10_000);
  assert.equal(h.sent.length, 1);
  assert.equal(await h.prompt(PING_PROMPT), undefined);
  assert.deepEqual([h.aborts, h.asked.length], [0, 0]);
});

// A user can type or paste the marker. Only our own in-flight ping is exempt; anything else is a prompt.
test("a user prompt that carries the marker is an ordinary prompt: guarded, and it restarts the window", async () => {
  for (const text of [PING_PROMPT, "[cache-clock:keepwarm] summarise the repo", "explain [cache-clock:keepwarm] to me"]) {
    const h = fakeHost({ config: KW, answer: "Don't send" });
    await goCold(h);
    assert.deepEqual(await h.prompt(text), { suppressOutput: true }, text);
    assert.deepEqual([h.aborts, h.asked.length], [1, 1], text);
    await h.command("");
    assert.match(lastLog(h), /keep-warm  on · 3h00m left/, `${text}: a real prompt restarts the window`);
  }
});

test("a ping whose prompt reaches the hook does not restart the window", async () => {
  const h = fakeHost({ config: KW });
  h.autoReply = false;
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  assert.equal(await h.prompt(PING_PROMPT), undefined);
  await h.command("");
  assert.match(lastLog(h), /2h56m left/, "only a real prompt restarts the window");
});

test("a resumed session books a pasted marker as a real prompt", async () => {
  for (const content of ["[cache-clock:keepwarm] summarise the repo", "explain [cache-clock:keepwarm] to me"]) {
    const h = fakeHost({ config: KW });
    h.now = T0 + 4 * MIN;
    h.history = [record("session.usage_record", T0, { usage: sonnet() }), record("user.message", T0 + 4 * MIN, { content }),
      record("session.usage_record", T0 + 4 * MIN, { usage: sonnet({ at: iso(T0 + 4 * MIN), input: 201_000, read: 200_000, write: 1000 }) })].join("\n");
    await h.start();
    await h.command("");
    assert.match(lastLog(h), /session +2 model calls/, content);
  }
});

test("a message typed while a ping runs does not take the ping's usage", async () => {
  const h = fakeHost({ config: KW });
  h.autoReply = false;
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  h.emit("user.message", PING_MESSAGE);
  h.emit("user.message", { content: "typed while the ping ran" });
  h.emit("assistant.usage", pingUsage({ at: iso(h.now) }));
  h.emit("assistant.usage", sonnet({ at: iso(h.now), read: 200_000, write: 0 }));
  h.emit("session.idle", {});
  await h.command("");
  assert.match(lastLog(h), /session +2 model calls/);
  assert.match(lastLog(h), /1 ping · \$0\.02/);
});

test("a resumed session seeds pings as pings", async () => {
  const h = fakeHost({ config: KW });
  h.now = T0 + 4 * MIN;
  h.history = [record("session.usage_record", T0, { usage: sonnet() }), record("user.message", T0 + 4 * MIN, PING_MESSAGE),
    record("session.usage_record", T0 + 4 * MIN, { usage: pingUsage({ at: iso(T0 + 4 * MIN) }) })].join("\n");
  await h.start();
  await h.command("");
  assert.match(lastLog(h), /session +1 model calls/);
});

// RF 1: the extension reloads mid-window and must resume its window, spend and stop.
test("a reload mid-window resumes the window and its spend", async () => {
  const alive = new Set([1, 2]);
  const h1 = fakeHost({ config: KW, alive });
  await h1.start();
  await h1.turn();
  await h1.run(40 * MIN);
  assert.equal(h1.sent.length, 10);
  alive.delete(1);
  const h2 = fakeHost({ config: KW, dir: h1.dir, pid: 2, alive });
  h2.now = h1.now;
  h2.history = [record("session.usage_record", T0, { usage: sonnet() }), record("user.message", h2.now, PING_MESSAGE),
    record("session.usage_record", h2.now, { usage: pingUsage({ at: iso(h2.now) }) })].join("\n");
  await h2.start();
  await h2.run(3 * HOUR);
  assert.equal(h1.sent.length + h2.sent.length, 24);
  await h2.command("");
  assert.match(lastLog(h2), /stopped \(payback\) · 24 pings · \$0\.48/);
});

// RF 2: two processes attached to one session: only the lock holder pings.
test("two processes on one session: only the lock holder pings", async () => {
  const alive = new Set([1, 2]);
  const h1 = fakeHost({ config: KW, alive });
  const h2 = fakeHost({ config: KW, dir: h1.dir, pid: 2, alive });
  await h1.start();
  await h2.start();
  await h1.turn();
  await h2.turn();
  for (let i = 0; i < 180; i += 1) {
    await h1.run(10_000);
    await h2.run(10_000);
  }
  assert.deepEqual([h1.sent.length, h2.sent.length], [7, 0]);
});

// RF 4: the user types while a ping is in flight; their turn is real and restarts the window.
test("the user typing while a ping is in flight counts as a real turn", async () => {
  const h = fakeHost({ config: KW });
  h.autoReply = false;
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  h.emit("user.message", PING_MESSAGE);
  h.emit("assistant.turn_start", {});
  await h.prompt("one more thing");
  h.emit("assistant.usage", pingUsage({ at: iso(h.now) }));
  h.emit("user.message", { content: "one more thing" });
  h.emit("assistant.usage", sonnet({ at: iso(h.now), read: 200_000, write: 0 }));
  h.emit("session.idle", {});
  await h.command("");
  assert.match(lastLog(h), /session +2 model calls/);
  assert.match(lastLog(h), /1 ping · \$0\.02/);
  assert.match(lastLog(h), /3h00m left/);
});

// RF 5: a model switch to Auto during the window stops pings.
test("switching to Auto stops pings", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  h.emit("session.model_change", { newModel: "auto" });
  await h.run(30 * MIN);
  assert.equal(h.sent.length, 1);
  await h.command("");
  assert.match(lastLog(h), /last skip: auto/);
});

test("session shutdown clears keep-warm timers and frees the lock", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  assert.ok(existsSync(sessionLockFile(h.dir, "s-1")), "the pinging process holds the lock");
  h.emit("session.shutdown", {});
  await h.run(HOUR);
  assert.equal(h.sent.length, 1);
  assert.equal(existsSync(sessionLockFile(h.dir, "s-1")), false);
  const gone = fakeHost({ config: KW });
  await gone.start();
  await gone.turn();
  await gone.run(4 * MIN);
  assert.ok(existsSync(sessionLockFile(gone.dir, "s-1")));
  gone.hostGone();
  assert.equal(existsSync(sessionLockFile(gone.dir, "s-1")), false);
  await gone.run(HOUR);
  assert.equal(gone.sent.length, 1);
});

test("a stop note reaches the session log", async () => {
  const h = fakeHost({ config: { ...KW, keepWarmMaxUsd: 0.04, keepWarmPayback: false } });
  await h.start();
  await h.turn();
  await h.run(30 * MIN);
  assert.equal(h.sent.length, 2);
  assert.ok(h.logs.some((l) => /keep-warm stopped: the keep-warm budget is spent \(2 pings, \$0\.04/.test(l.message)));
});

test("an unwritable keep-warm folder never breaks the prompt hook", async () => {
  const h = fakeHost({ config: KW });
  writeFileSync(join(h.dir, "keepwarm"), "");
  await h.start();
  await assert.doesNotReject(h.turn());
  assert.equal(await h.prompt("hi"), undefined);
});

test("/cache-clock keepwarm 8 asks with the estimated cost first", async () => {
  const yes = fakeHost({ config: KW, answer: "Turn on" });
  await yes.start();
  yes.emit("assistant.usage", sonnet({ at: iso(T0) }));
  await yes.command("keepwarm 8");
  // Payback ends 8 hours of pings after 24 (24 x $0.02 = the $0.48 a cold rewrite costs), so the quote says 24, not 120.
  assert.match(yes.asked[0].message, /about 24 pings, about \$0\.48/);
  assert.deepEqual(yes.asked[0].options, ["Turn on", "Cancel"]);
  assert.equal(loadConfig(yes.dir).keepWarmHours, 8);
  assert.match(lastLog(yes), /keep-warm: 8h after your last message/);
  const no = fakeHost({ config: KW, answer: "Cancel" });
  await no.start();
  no.emit("assistant.usage", sonnet({ at: iso(T0) }));
  await no.command("keepwarm 8");
  assert.equal(loadConfig(no.dir).keepWarmHours, 3);
  assert.match(lastLog(no), /unchanged/);
});

test("a host that cannot ask saves a long keep-warm window and prints the estimate with it", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: iso(T0) }));
  await h.command("keepwarm 8");
  assert.equal(loadConfig(h.dir).keepWarmHours, 8);
  assert.match(lastLog(h), /about 24 pings, about \$0\.48.*keep-warm: 8h after your last message/s);
});

test("no keep-warm window above 6 hours is saved unless the user turns it on", async () => {
  for (const answer of ["Cancel", null, "Turn off", ""]) {
    const h = fakeHost({ config: KW, answer });
    await h.start();
    h.emit("assistant.usage", sonnet({ at: iso(T0) }));
    await h.command("keepwarm 8");
    assert.equal(h.asked.length, 1, `answer ${JSON.stringify(answer)}`);
    assert.equal(loadConfig(h.dir).keepWarmHours, 3, `answer ${JSON.stringify(answer)} left the setting alone`);
    assert.match(lastLog(h), /unchanged/);
  }
  const edge = fakeHost({ config: KW, answer: "Cancel" });
  await edge.start();
  await edge.command("keepwarm 6");
  assert.deepEqual([edge.asked.length, loadConfig(edge.dir).keepWarmHours], [0, 6], "6 hours is saved without a question");
  await edge.command("keepwarm 12");
  assert.deepEqual([edge.asked.length, loadConfig(edge.dir).keepWarmHours], [1, 6], "12 hours asks, and Cancel keeps the 6");
});

test("a corrupt config.json is never overwritten: a settings command refuses and says why", async () => {
  for (const text of ["{not json", "[1]", "null"]) {
    const h = fakeHost({ answer: "Turn on" });
    await h.start();
    writeFileSync(join(h.dir, "config.json"), text);
    for (const cmd of ["guard warn", "min 0.5", "keepwarm on", "keepwarm 8"]) {
      await h.command(cmd);
      assert.match(lastLog(h), /not saved: config\.json/, `${text} / ${cmd}`);
      assert.equal(h.logs.at(-1).level, "error");
      assert.equal(readFileSync(join(h.dir, "config.json"), "utf8"), text, `${text} / ${cmd} left the file alone`);
    }
    assert.equal(h.asked.length, 0, "no question is asked about a setting that cannot be saved");
  }
});

test("keepwarm on starts a window from the last model call, and keepwarm off ends it", async () => {
  const h = fakeHost();
  await h.start();
  await h.turn();
  await h.command("keepwarm on");
  assert.equal(loadConfig(h.dir).keepWarmHours, 3);
  assert.match(lastLog(h), /keep-warm: 3h after your last message · budget \$0\.50 · payback stop on/);
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  await h.command("keepwarm off");
  assert.match(lastLog(h), /keep-warm: off/);
  await h.run(HOUR);
  assert.equal(h.sent.length, 1);
});
