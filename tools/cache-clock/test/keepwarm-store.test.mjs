import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
