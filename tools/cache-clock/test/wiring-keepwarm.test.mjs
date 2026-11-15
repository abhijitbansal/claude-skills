import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../extension/lib/config.mjs";
import { PING_DISPLAY, PING_PROMPT } from "../extension/lib/keepwarm.mjs";
import { usage, pingUsage, T0, MIN } from "./fixtures.mjs";
import { fakeHost, sonnet, iso, goCold } from "./helpers/fake-host.mjs";

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

test("a ping's reply that arrives after the watchdog is still booked as a ping and its spend", async () => {
  const h = fakeHost({ config: KW });
  h.autoReply = false;
  await h.start();
  await h.turn();
  await h.run(6 * MIN + 10_000);
  assert.ok(h.logs.some((l) => /keep-warm ping failed/.test(l.message)), "the watchdog gave up on it");
  h.emit("user.message", PING_MESSAGE);
  h.emit("assistant.turn_start", {});
  h.emit("assistant.usage", pingUsage({ at: iso(h.now) }));
  h.emit("session.idle", {});
  await h.command("");
  assert.match(lastLog(h), /session +1 model calls/);
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
