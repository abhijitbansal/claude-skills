import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { usage, T0, MIN } from "./fixtures.mjs";
import { fakeHost, flush, sonnet, goCold } from "./helpers/fake-host.mjs";

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
