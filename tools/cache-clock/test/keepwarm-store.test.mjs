import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeepWarmStore } from "../extension/lib/config.mjs";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const W = { startedAt: NOW, endsAt: NOW + 3 * HOUR, usd: 0.2, pings: 10, stopped: null };
const lockFile = (dir, id) => join(dir, "keepwarm", `${createHash("sha256").update(id).digest("hex")}.lock`);

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "cc-keepwarm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("window, spend and stop reason round-trip per session", (t) => {
  const dir = sandbox(t);
  createKeepWarmStore(dir, "s-1").save(W);
  assert.deepEqual(createKeepWarmStore(dir, "s-1").load(), W);
  assert.equal(createKeepWarmStore(dir, "s-2").load(), null);
});

test("a corrupt or invalid window loads as null", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  for (const bad of [{ ...W, usd: -1 }, { ...W, endsAt: NOW - 1 }, { ...W, pings: 1.5 }, { ...W, stopped: 3 }]) { s.save(bad); assert.equal(s.load(), null); }
  writeFileSync(join(dir, "keepwarm", `${createHash("sha256").update("s-1").digest("hex")}.json`), "{not json");
  assert.equal(s.load(), null);
});

test("a live holder keeps the lock; a second process is refused", (t) => {
  const dir = sandbox(t);
  const [a, b] = [1, 2].map((pid) => createKeepWarmStore(dir, "s-1", { pid, isAlive: () => true }));
  assert.deepEqual([a.lock(), b.lock(), a.lock()], [true, false, true]);
  b.unlock();
  assert.equal(b.lock(), false, "unlock only removes your own lock");
});

test("a dead holder's lock is taken over", (t) => {
  const dir = sandbox(t);
  createKeepWarmStore(dir, "s-1", { pid: 1, isAlive: () => true }).lock();
  assert.equal(createKeepWarmStore(dir, "s-1", { pid: 2, isAlive: (p) => p !== 1 }).lock(), true);
});

test("an unreadable lock is taken over, and unlock frees your own lock", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "keepwarm"), { recursive: true });
  writeFileSync(lockFile(dir, "s-1"), "garbage");
  const a = createKeepWarmStore(dir, "s-1", { pid: 7, isAlive: () => true });
  assert.equal(a.lock(), true);
  a.unlock();
  assert.equal(createKeepWarmStore(dir, "s-1", { pid: 8, isAlive: () => true }).lock(), true, "unlock freed it");
});

test("no session id: no lock and no file", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, null);
  assert.equal(s.lock(), false);
  assert.equal(s.load(), null);
  s.save(W);
  assert.deepEqual(readdirSync(dir), []);
});

test("the default liveness check sees this process as alive and an impossible pid as dead", (t) => {
  const dir = sandbox(t);
  const a = createKeepWarmStore(dir, "s-1", { pid: process.pid });
  assert.equal(a.lock(), true);
  const intruder = createKeepWarmStore(dir, "s-1", { pid: 2 ** 22 + 1 });
  assert.equal(intruder.lock(), false, "this live process holds it");
  a.unlock();
  writeFileSync(lockFile(dir, "s-1"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  assert.equal(intruder.lock(), true, "a pid that cannot exist is taken over");
});

test("the window keeps the time of the last send and the cost of the last ping, and drops nonsense for them", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  const full = { ...W, lastSendAt: NOW + 5, lastPingUsd: 0.02 };
  s.save(full);
  assert.deepEqual(s.load(), full);
  s.save({ ...W, lastSendAt: "yesterday" });
  assert.equal(s.load(), null, "a window with a non-numeric send time is invalid");
  s.save({ ...W, lastPingUsd: -1 });
  assert.equal(s.load(), null, "so is a negative ping cost");
});

test("two processes racing to take over a stale lock: one holds it after each confirms again, and no temp files are left", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "keepwarm"), { recursive: true });
  writeFileSync(lockFile(dir, "s-1"), JSON.stringify({ pid: 9 }));
  let raced = false;
  let b;
  // B takes the whole takeover inside A's check of the dead holder: A then acts on a stale decision.
  const a = createKeepWarmStore(dir, "s-1", { pid: 1, isAlive: (pid) => { if (pid === 9 && !raced) { raced = true; b.lock(); } return false; } });
  b = createKeepWarmStore(dir, "s-1", { pid: 2, isAlive: (pid) => pid !== 9 });
  a.lock();
  assert.deepEqual([a.lock(), b.lock()].sort(), [false, true], "confirming again before pinging leaves exactly one holder");
  assert.ok(JSON.parse(readFileSync(lockFile(dir, "s-1"), "utf8")).pid === 1 || JSON.parse(readFileSync(lockFile(dir, "s-1"), "utf8")).pid === 2, "the lock file is whole");
  assert.deepEqual(readdirSync(join(dir, "keepwarm")).filter((f) => !f.endsWith(".lock")), []);
});

test("a lock file is never seen empty: it appears whole or not at all, and names its holder's instance", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1", { pid: 42, instance: "i1", isAlive: () => true });
  assert.equal(s.lock(), true);
  assert.deepEqual(JSON.parse(readFileSync(lockFile(dir, "s-1"), "utf8")), { pid: 42, instance: "i1" });
  assert.deepEqual(readdirSync(join(dir, "keepwarm")).filter((f) => f.includes(".tmp")), []);
});

const MINUTE = 60_000;
const ledgerFile = (dir, id) => join(dir, "keepwarm", `${createHash("sha256").update(id).digest("hex")}.ledger`);

test("the ping ledger records each send, replaces its cost when measured, and sums the last 24 hours", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  const first = s.ledgerSend(NOW, 0.02);
  s.ledgerSend(NOW + 4 * MINUTE, 0.02);
  s.ledgerCost(first, 0.03);
  const sum = s.ledger(NOW + 5 * MINUTE);
  assert.equal(sum.pings, 2);
  assert.ok(Math.abs(sum.usd - 0.05) < 1e-12, "the first ping counts at its measured cost, the second at its estimate");
  assert.equal(s.ledger(NOW + 24 * HOUR + MINUTE).pings, 1, "an entry leaves the ledger only when it is 24 hours old");
  assert.equal(s.ledger(NOW + 25 * HOUR).pings, 0);
});

test("two sends in the same millisecond, even from two instances in one process, are both kept", (t) => {
  const dir = sandbox(t);
  const a = createKeepWarmStore(dir, "s-1", { pid: 7, instance: "a" });
  const b = createKeepWarmStore(dir, "s-1", { pid: 7, instance: "b" });
  const x = a.ledgerSend(NOW, 0.02);
  const y = b.ledgerSend(NOW, 0.02);
  const z = a.ledgerSend(NOW, 0.02);
  assert.equal(new Set([x, y, z]).size, 3);
  b.ledgerCost(y, 0.5);
  const sum = a.ledger(NOW + MINUTE);
  assert.equal(sum.pings, 3);
  assert.ok(Math.abs(sum.usd - 0.54) < 1e-12);
});

test("two instances in one process for one session do not both own the lock", (t) => {
  const dir = sandbox(t);
  const a = createKeepWarmStore(dir, "s-1", { pid: 7, instance: "a", isAlive: () => true });
  const b = createKeepWarmStore(dir, "s-1", { pid: 7, instance: "b", isAlive: () => true });
  assert.deepEqual([a.lock(), b.lock(), a.lock(), b.lock()], [true, false, true, false]);
  b.unlock();
  assert.equal(a.lock(), true, "an instance that does not hold the lock cannot release it");
  a.unlock();
  assert.equal(b.lock(), true);
});

test("the ledger is shared by processes and by a new window, a reload or a cleared window file", (t) => {
  const dir = sandbox(t);
  const a = createKeepWarmStore(dir, "s-1", { pid: 1, isAlive: () => true });
  const b = createKeepWarmStore(dir, "s-1", { pid: 2, isAlive: () => true });
  a.ledgerSend(NOW, 0.02);
  b.ledgerSend(NOW + MINUTE, 0.02);
  a.save(W);
  rmSync(join(dir, "keepwarm", `${createHash("sha256").update("s-1").digest("hex")}.json`));
  const reopened = createKeepWarmStore(dir, "s-1");
  assert.equal(reopened.ledger(NOW + 2 * MINUTE).pings, 2, "nothing but time removes an entry");
  assert.equal(createKeepWarmStore(dir, "s-2").ledger(NOW).pings, 0, "another session has its own ledger");
});

test("a malformed ledger line is skipped, a partial last line costs nothing, and a session with no id has no ledger", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  s.ledgerSend(NOW, 0.02);
  writeFileSync(ledgerFile(dir, "s-1"), "\ngarbage\n{\"t\":\"send\",\"id\":\"x\",\"at\":\"x\"}\n", { flag: "a" });
  s.ledgerSend(NOW + MINUTE, 0.02);
  assert.equal(s.ledger(NOW + 2 * MINUTE).pings, 2, "malformed lines between valid ones are skipped");
  writeFileSync(ledgerFile(dir, "s-1"), "\n{\"t\":\"send\",\"id\":\"half\",\"at\":20", { flag: "a" });
  s.ledgerSend(NOW + 3 * MINUTE, 0.02);
  assert.equal(s.ledger(NOW + 4 * MINUTE).pings, 3, "a partial line (a write cut short) swallows neither the earlier entries nor the next one");
  const none = createKeepWarmStore(dir, null);
  assert.equal(none.ledgerSend(NOW, 1), null);
  none.ledgerCost(null, 1);
  assert.deepEqual(none.ledger(NOW), { pings: 0, usd: 0, noteAt: null });
});

test("a ledger file that cannot be read as a ledger fails closed with a note that says how to reset it", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  mkdirSync(join(dir, "keepwarm"), { recursive: true });
  writeFileSync(ledgerFile(dir, "s-1"), "not json\n\u0000\u0001\n{\"t\":\"send\",\"at\":\"x\"}\n");
  assert.throws(() => s.ledger(NOW), /delete it to reset it/);
  rmSync(ledgerFile(dir, "s-1"));
  mkdirSync(ledgerFile(dir, "s-1"));
  assert.throws(() => s.ledger(NOW), /delete it to reset it/, "a ledger that is not a file is the same");
  assert.deepEqual(createKeepWarmStore(sandbox(t), "s-1").ledger(NOW), { pings: 0, usd: 0, noteAt: null }, "no file at all is an empty ledger, not a failure");
});

test("the ledger remembers when the daily-limit note was last shown, and treats a future entry as now", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  s.ledgerNote(NOW);
  assert.equal(s.ledger(NOW + HOUR).noteAt, NOW);
  s.ledgerSend(NOW + 30 * HOUR, 5);
  const seen = s.ledger(NOW);
  assert.deepEqual([seen.pings, seen.usd], [1, 5], "an entry dated in the future counts as now: it is neither hidden nor dropped");
});

test("compacting the ledger, at start-up only, drops just the entries 24 hours old, atomically, and gives way to a write that races it", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  for (let i = 0; i < 12; i += 1) s.ledgerSend(NOW + i * MINUTE, 0.01);
  s.ledgerSend(NOW + 30 * HOUR, 0.01);
  s.ledgerNote(NOW + 30 * HOUR);
  const size = readFileSync(ledgerFile(dir, "s-1"), "utf8").length;
  s.compactLedger(NOW + 30 * HOUR + MINUTE);
  const after = readFileSync(ledgerFile(dir, "s-1"), "utf8");
  assert.ok(after.length < size, "the file shrank");
  assert.deepEqual([s.ledger(NOW + 30 * HOUR + 2 * MINUTE).pings, s.ledger(NOW + 30 * HOUR + 2 * MINUTE).noteAt], [1, NOW + 30 * HOUR], "only the old entries went");
  assert.deepEqual(readdirSync(join(dir, "keepwarm")).filter((f) => f.includes(".tmp")), [], "no temp file is left");
  // A send in the middle of a compaction: the compaction notices the file changed and leaves it alone.
  const racing = createKeepWarmStore(dir, "s-1", { beforeLedgerRename: () => s.ledgerSend(NOW + 31 * HOUR, 0.02) });
  racing.compactLedger(NOW + 31 * HOUR + MINUTE);
  assert.equal(s.ledger(NOW + 31 * HOUR + 2 * MINUTE).pings, 2, "the entry appended meanwhile is kept");
});
