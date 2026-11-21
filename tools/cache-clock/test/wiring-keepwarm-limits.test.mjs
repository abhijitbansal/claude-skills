import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeepWarmStore } from "../extension/lib/config.mjs";
import { PING_DISPLAY, PING_PROMPT } from "../extension/lib/keepwarm.mjs";
import { usage, pingUsage, T0, MIN } from "./fixtures.mjs";
import { fakeHost, sonnet, iso, flush } from "./helpers/fake-host.mjs";

// The dollar and count bounds under hostile or confused hosts: what a session can spend whatever the events say.
const HOUR = 60 * MIN;
const KW = { mode: "refuse", minUsd: 0.1, headsUpMin: 5, keepWarmHours: 3, keepWarmMaxUsd: 0.5, keepWarmPayback: true, keepWarmDailyMaxUsd: 2 };
const lastLog = (h) => h.logs.at(-1).message;
const PING_MESSAGE = { content: PING_DISPLAY, transformedContent: PING_PROMPT, source: "system" };
// A ping that writes the whole 200k context again: $0.50 at Sonnet's $2.50/M write price.
const coldPing = (at) => usage({ model: "claude-sonnet-5.5", at, ttl: 300, input: 200_000, read: 0, write: 200_000, output: 0, nanoAiu: 5e10 });
const ledgerOf = (h) => createKeepWarmStore(h.dir, "s-1", { pid: 999, isAlive: () => true }).ledger(h.now);

// H1: a ping echo labelled as the user's must not restart the window, with or without a source.
for (const [label, message] of [['source "user"', { content: PING_DISPLAY, source: "user" }], ["no source", { content: PING_DISPLAY }],
  ["the marker prompt, source user", { content: PING_PROMPT, source: "user" }]]) {
  test(`a ping echo labelled ${label} restarts nothing: the unattributed ping ends keep-warm after one send`, async () => {
    const h = fakeHost({ config: KW });
    h.replyToPing = () => {
      h.emit("user.message", message);
      h.emit("assistant.turn_start", {});
      h.emit("assistant.usage", coldPing(iso(h.now)));
      h.emit("session.idle", {});
    };
    const { keepWarm } = await h.start();
    await h.turn();
    await h.run(24 * HOUR);
    assert.equal(h.sent.length, 1, "one cold ping at most, not one per restarted window");
    assert.equal(keepWarm.status().stopped, "send-failed");
  });
}

test("a user.message with no source confirms nothing, and one that arrives while a ping is awaited confirms nothing", async () => {
  const h = fakeHost({ config: KW });
  await h.start();
  h.emit("assistant.usage", sonnet({ at: iso(T0) }));
  h.emit("user.message", { content: "hello" });
  await h.command("");
  assert.match(lastLog(h), /keep-warm  on \(3h\) · starts after your next message/);
  h.emit("user.message", { content: "hello", source: "user" });
  await h.command("");
  assert.match(lastLog(h), /keep-warm  on · 3h00m left/, "an explicit source of user, with no ping awaited, confirms");
});

test("a send whose usage is never attributed is written to the ledger at the cold-rewrite cost", async () => {
  const h = fakeHost({ config: KW });
  h.autoReply = false;
  await h.start();
  await h.turn();
  await h.run(4 * MIN);
  assert.equal(h.sent.length, 1);
  const ledger = ledgerOf(h);
  assert.deepEqual([ledger.pings, ledger.usd], [1, 0.5], "$0.50, not the $0.02 warm estimate");
});

test("pings that report a cost of 0 cannot unbind the daily dollar limit", async () => {
  const h = fakeHost({ config: { ...KW, keepWarmHours: 12 } });
  h.replyToPing = () => {
    h.emit("user.message", PING_MESSAGE);
    h.emit("assistant.turn_start", {});
    h.emit("assistant.usage", pingUsage({ at: iso(h.now), nanoAiu: 0 }));
    h.emit("session.idle", {});
  };
  await h.start();
  await h.turn();
  for (let i = 0; i < 24; i += 1) {
    await h.run(HOUR);
    await h.turn("more");
  }
  const ledger = ledgerOf(h);
  assert.ok(h.sent.length <= 100, `$2.00 at $0.02 a ping is 100 pings, not ${h.sent.length}`);
  assert.ok(ledger.usd >= h.sent.length * 0.02 - 1e-9, "every ping counts for at least the estimate");
});

// With no user.message nothing tells the two apart while the ping is out, so its first record is the ping's;
// the typed prompt's own record, which follows, is the call (it was only the first that was handed over).
test("on a host with no user.message, a call typed during an awaited ping leaves the first record to the ping and books the next as a call", async () => {
  const h = fakeHost({ config: KW, emitUserMessage: false });
  h.autoReply = false;
  await h.start();
  h.emit("assistant.turn_start", {});
  h.emit("assistant.usage", sonnet({ at: iso(T0) }));
  h.emit("session.idle", {});
  await h.run(4 * MIN + 10_000);
  assert.equal(h.sent.length, 1);
  await h.prompt("real message");
  h.emit("assistant.turn_start", {});
  h.emit("assistant.usage", pingUsage({ at: iso(h.now) }));
  await h.command("");
  assert.match(lastLog(h), /session +1 model call/, "the first record, in flight, was the ping's");
  assert.match(lastLog(h), /1 ping/);
  h.emit("assistant.usage", sonnet({ at: iso(h.now), read: 190_000, write: 10_000, output: 400 }));
  h.emit("session.idle", {});
  await h.command("");
  assert.match(lastLog(h), /session +2 model calls/, "the prompt's own record is a call");
});

// Pins a known limit, not a fix: with no user.message nothing separates the two records while the ping is out,
// so a user record that beats the ping's reply is booked as ping spend, and the ping's reply, which follows in
// its tail, is booked as the user's call. The user's record carries a large cost ($0.50) so that it is told apart
// from the ping estimate ($0.02): it is the cost that lands in the window and the ledger. What is observable of the
// ping's reply is its count in the user's tally (the card shows no per-call cost, so "at the ping's cost" is pinned
// only as: none of that cost is added to the ping spend). A cold-looking user record stops keep-warm at once; a warm
// one spends the whole $0.50 keep-warm budget, so keep-warm stops as "budget" at the next plan.
const USER_COST_USD = 0.5;
for (const [label, record, stopped, stoppedAfterReply] of [
  ["warm", { read: 190_000, write: 10_000, output: 400, nanoAiu: 5e10 }, null, "budget"],
  ["cold", { read: 10_000, write: 190_000, output: 400, nanoAiu: 5e10 }, "cold-reply", "cold-reply"],
]) {
  test(`documented trade-off: without user.message, a ${label} user record that beats the ping's reply is booked as ping spend`, async () => {
    const h = fakeHost({ config: KW, emitUserMessage: false });
    h.autoReply = false;
    const { keepWarm } = await h.start();
    h.emit("assistant.turn_start", {});
    h.emit("assistant.usage", sonnet({ at: iso(T0) }));
    h.emit("session.idle", {});
    await h.run(4 * MIN + 10_000);
    assert.equal(h.sent.length, 1);
    await h.prompt("real message");
    h.emit("assistant.turn_start", {});
    h.emit("assistant.usage", sonnet({ at: iso(h.now), ...record }));
    assert.deepEqual([keepWarm.status().pings, keepWarm.status().inFlight, keepWarm.status().stopped], [1, false, stopped],
      "the user's record answered the ping: it is the window's one ping, and the cold one stops keep-warm");
    const bookedUsd = keepWarm.status().usd;
    assert.ok(Math.abs(bookedUsd - USER_COST_USD) < 1e-6, `the user's cost is the window's ping spend: ${bookedUsd}`);
    h.emit("assistant.usage", pingUsage({ at: iso(h.now) }));
    h.emit("session.idle", {});
    await h.command("");
    assert.match(lastLog(h), /session +2 model calls/, "the first turn and the ping's reply, booked as the user's call; the user's own record is not in the tally");
    assert.deepEqual([keepWarm.status().pings, keepWarm.status().stopped], [1, stoppedAfterReply], "the ping's reply adds no second ping");
    assert.equal(keepWarm.status().usd, bookedUsd, "and none of its own cost is added to the ping spend: the costs swapped");
    const ledger = ledgerOf(h);
    assert.equal(ledger.pings, 1);
    assert.ok(Math.abs(ledger.usd - USER_COST_USD) < 1e-6, `the ledger holds the user's cost for the ping's send: ${ledger.usd}`);
  });
}

test("in VS Code the daily-limit note is one card per 24 hours, however many turns follow", async () => {
  const h = fakeHost({
    env: { VSCODE_CANVAS_DATA_DIR: "/x" }, answer: "OK",
    config: { ...KW, keepWarmHours: 12, keepWarmMaxUsd: 5, keepWarmPayback: false, keepWarmDailyMaxUsd: 0.1 },
  });
  await h.start();
  await h.turn();
  await h.run(HOUR);
  for (let i = 0; i < 8; i += 1) {
    await h.run(10 * MIN);
    await h.turn("more");
  }
  assert.equal(h.asked.filter((q) => /daily limit/.test(q.message)).length, 1);
});

test("two keep-warm instances in one process for one session: only one owns the lock and pings", async () => {
  const alive = new Set([7]);
  const A = fakeHost({ config: KW, pid: 7, alive });
  const B = fakeHost({ config: KW, dir: A.dir, pid: 7, alive });
  const ka = (await A.start()).keepWarm;
  const kb = (await B.start()).keepWarm;
  await A.turn();
  await B.turn();
  for (const end = A.now + 3 * HOUR; A.now < end;) {
    A.advance(10_000);
    B.advance(10_000);
    await flush();
  }
  assert.deepEqual([A.sent.length, B.sent.length], [24, 0]);
  assert.equal(kb.status().state, "elsewhere");
  assert.equal(ka.status().stopped, "payback");
  assert.equal(ledgerOf(A).pings, 24);
});
