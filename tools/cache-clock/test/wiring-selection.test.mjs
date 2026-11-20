import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { usage, T0, MIN } from "./fixtures.mjs";
import { fakeHost, flush, sonnet, goCold } from "./helpers/fake-host.mjs";

const coldHost = async (opts) => {
  const h = fakeHost(opts);
  await h.start();
  h.emit("assistant.usage", sonnet({ at: new Date(T0).toISOString() }));
  h.advance(7 * MIN);
  return h;
};

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
