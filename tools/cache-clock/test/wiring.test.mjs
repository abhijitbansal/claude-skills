import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach } from "../extension/lib/wiring.mjs";
import { saveConfig } from "../extension/lib/config.mjs";
import { usage, T0, MIN } from "./fixtures.mjs";

// A stand-in for the CopilotSession an extension gets from joinSession().
function fakeHost({ config = { mode: "refuse", minUsd: 0.1, headsUpMin: 5 }, dir = mkdtempSync(join(tmpdir(), "cc-wiring-")), env = {} } = {}) {
  saveConfig(dir, config);
  const host = { now: T0, logs: [], aborts: 0, handlers: new Map(), timers: [], joinConfig: null };
  host.session = {
    sessionId: "s-1",
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
  host.start = () => attach({ joinSession: host.joinSession, now: () => host.now, timers: host.timerApi, dir, readHistory, env });
  host.dir = dir;
  return host;
}

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

// VS Code's agent host shows only error-level session messages in the chat (measured 11 Oct 2026).
const VS_CODE = { VSCODE_CANVAS_DATA_DIR: "/tmp/agentHostCanvasData/x" };

test("in VS Code the refusal, the resend note and the card are logged at error level so the chat shows them", async () => {
  const h = fakeHost({ env: VS_CODE });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  await h.prompt("give me a recap");
  assert.match(h.logs.at(-1).message, /went cold/);
  assert.equal(h.logs.at(-1).level, "error");
  await h.prompt("give me a recap");
  assert.match(h.logs.at(-1).message, /sending cold/);
  assert.equal(h.logs.at(-1).level, "error");
  h.command("");
  assert.match(h.logs.at(-1).message, /^cache-clock · /);
  assert.equal(h.logs.at(-1).level, "error");
});

test("in VS Code the heads-up is logged at error level and not ephemeral", async () => {
  const h = fakeHost({ env: VS_CODE });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(4.5 * MIN);
  const line = h.logs.at(-1);
  assert.match(line.message, /goes cold in/);
  assert.equal(line.level, "error");
  assert.equal(line.ephemeral, undefined);
});

test("in the CLI the card keeps the default level", async () => {
  const h = fakeHost();
  await h.start();
  h.command("");
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
  second.history = JSON.stringify({ type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } });
  await second.start();
  second.advance(7 * MIN);
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
