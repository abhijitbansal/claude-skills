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

test("a lock file is never seen empty: it appears whole or not at all", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1", { pid: 42, isAlive: () => true });
  assert.equal(s.lock(), true);
  assert.deepEqual(JSON.parse(readFileSync(lockFile(dir, "s-1"), "utf8")), { pid: 42 });
  assert.deepEqual(readdirSync(join(dir, "keepwarm")).filter((f) => f.includes(".tmp")), []);
});

const MINUTE = 60_000;
const ledgerFile = (dir, id) => join(dir, "keepwarm", `${createHash("sha256").update(id).digest("hex")}.ledger`);

test("the ping ledger records each send at its estimate, replaces it with the measured cost, and sums the last 24 hours", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  s.ledgerSend(NOW, 0.02);
  s.ledgerSend(NOW + 4 * MINUTE, 0.02);
  s.ledgerCost(NOW, 0.03);
  const sum = s.ledger(NOW + 5 * MINUTE);
  assert.equal(sum.pings, 2);
  assert.ok(Math.abs(sum.usd - 0.05) < 1e-12, "the first ping counts at its measured cost, the second at its estimate");
  assert.equal(s.ledger(NOW + 24 * HOUR + MINUTE).pings, 1, "an entry leaves the ledger only when it is 24 hours old");
  assert.equal(s.ledger(NOW + 25 * HOUR).pings, 0);
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

test("a malformed ledger line is skipped, and a session with no id has no ledger", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1");
  s.ledgerSend(NOW, 0.02);
  writeFileSync(ledgerFile(dir, "s-1"), "garbage\n{\"t\":\"send\",\"at\":\"x\"}\n{\"t\":\"send\",\"at\":" + NOW + ",\"usd\":0.02}\n", { flag: "a" });
  assert.equal(s.ledger(NOW + MINUTE).pings, 1);
  const none = createKeepWarmStore(dir, null);
  none.ledgerSend(NOW, 1);
  none.ledgerCost(NOW, 1);
  assert.deepEqual(none.ledger(NOW), { pings: 0, usd: 0 });
});

test("compacting the ledger drops only entries older than 24 hours", (t) => {
  const dir = sandbox(t);
  const s = createKeepWarmStore(dir, "s-1", { ledgerCompactBytes: 300 });
  for (let i = 0; i < 12; i += 1) s.ledgerSend(NOW + i * MINUTE, 0.01);
  s.ledgerSend(NOW + 30 * HOUR, 0.01);
  s.ledgerSend(NOW + 30 * HOUR + MINUTE, 0.01);
  assert.equal(s.ledger(NOW + 30 * HOUR + 2 * MINUTE).pings, 2, "the 12 old entries are gone");
  assert.ok(readFileSync(ledgerFile(dir, "s-1"), "utf8").split("\n").filter(Boolean).length <= 3, "and the file shrank");
  assert.equal(s.ledger(NOW + 55 * HOUR).pings, 0);
});
