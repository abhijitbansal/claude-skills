import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadRefusal, saveRefusal } from "../extension/lib/config.mjs";

const NOW = 1_800_000_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const moduleUrl = new URL("../extension/lib/config.mjs", import.meta.url).href;
const fileFor = (dir, id) => join(dir, "refusals", `${createHash("sha256").update(id).digest("hex")}.json`);
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "cc-refusal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("refusals round-trip in session-specific files with opaque filenames", (t) => {
  const dir = sandbox(t);
  for (const id of ["first", "second", "../outside", "__proto__", "constructor"]) {
    saveRefusal(dir, id, `${id}@cold`, NOW);
    assert.equal(loadRefusal(dir, id, NOW), `${id}@cold`);
    assert.equal(JSON.parse(readFileSync(fileFor(dir, id))).key, `${id}@cold`);
  }
  assert.equal(loadRefusal(dir, "missing", NOW), null);
  assert.equal(loadRefusal(dir, null, NOW), null);
  assert.ok(readdirSync(join(dir, "refusals")).every((name) => /^[a-f0-9]{64}\.json$/.test(name)));
});

test("migration reads valid legacy entries without modifying the shared file", (t) => {
  const dir = sandbox(t);
  const legacy = JSON.stringify({ first: { key: "legacy", at: NOW - 1 } });
  writeFileSync(join(dir, "refused.json"), legacy);
  assert.equal(loadRefusal(dir, "first", NOW), "legacy");
  saveRefusal(dir, "first", "new", NOW);
  assert.equal(loadRefusal(dir, "first", NOW), "new");
  assert.equal(readFileSync(join(dir, "refused.json"), "utf8"), legacy);
});

test("expired, future, malformed or empty entries cannot suppress a fresh question", (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, "refusals"));
  const entries = ["{broken", "null", "[]", JSON.stringify({ key: "" , at: NOW }),
    JSON.stringify({ key: "old", at: NOW - WEEK }), JSON.stringify({ key: "future", at: NOW + 1 }),
    JSON.stringify({ key: "no-time" }), JSON.stringify({ key: 42, at: NOW })];
  for (const text of entries) {
    writeFileSync(fileFor(dir, "first"), text);
    writeFileSync(join(dir, "refused.json"), JSON.stringify({ first: { key: "stale-fallback", at: NOW } }));
    assert.equal(loadRefusal(dir, "first", NOW), null, text);
    rmSync(fileFor(dir, "first"));
    writeFileSync(join(dir, "refused.json"), `{"first":${text}}`);
    assert.equal(loadRefusal(dir, "first", NOW), null, text);
  }
  saveRefusal(dir, "first", "valid", NOW - WEEK + 1);
  assert.equal(loadRefusal(dir, "first", NOW), "valid");
});

test("same-session replacement leaves complete JSON and no temporary files", (t) => {
  const dir = sandbox(t);
  saveRefusal(dir, "first", "old", NOW - 1);
  saveRefusal(dir, "first", "new", NOW);
  assert.equal(loadRefusal(dir, "first", NOW), "new");
  assert.equal(readdirSync(join(dir, "refusals")).length, 1);
});

test("a failed replacement cleans its temporary file and does not resurrect legacy state", (t) => {
  const dir = sandbox(t);
  mkdirSync(fileFor(dir, "first"), { recursive: true }); // Force rename to fail.
  writeFileSync(join(dir, "refused.json"), JSON.stringify({ first: { key: "legacy", at: NOW } }));
  assert.throws(() => saveRefusal(dir, "first", "new", NOW));
  assert.equal(readdirSync(join(dir, "refusals")).length, 1);
  assert.equal(loadRefusal(dir, "first", NOW), null);
});

test("invalid save inputs do not create refusal files", (t) => {
  const dir = sandbox(t);
  for (const [id, key, at] of [[null, "key", NOW], [42, "key", NOW], ["", "key", NOW], ["s", "", NOW], ["s", "key", NaN]]) {
    saveRefusal(dir, id, key, at);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test("twelve concurrent processes cannot erase each other's refusal", { timeout: 15_000 }, async (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, "refused.json"), "{}");
  // Force the legacy read/modify/write implementation to read the same snapshot
  // in every process before any can rename. Session-local writes need no barrier.
  const script = `
    const fs = require('node:fs');
    const { join } = require('node:path');
    const { syncBuiltinESMExports } = require('node:module');
    const [dir, id, url, at] = process.argv.slice(1);
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      const value = read.call(this, file, ...args);
      if (file === join(dir, 'refused.json')) {
        fs.writeFileSync(join(dir, 'ready-' + id), '');
        const deadline = Date.now() + 5000;
        while (fs.readdirSync(dir).filter(n => n.startsWith('ready-')).length < 12) {
          if (Date.now() > deadline) throw new Error('legacy barrier timed out');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      return value;
    };
    syncBuiltinESMExports();
    import(url).then(({saveRefusal}) => saveRefusal(dir, id, id + '@cold', Number(at)))
      .catch(() => { process.exitCode = 1; });
  `;
  const runs = Array.from({ length: 12 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, dir, `session-${i}`, moduleUrl, String(NOW)], { stdio: "ignore" });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`writer ${i}: exit ${code}`)));
  }));
  await Promise.all(runs);
  for (let i = 0; i < 12; i++) assert.equal(loadRefusal(dir, `session-${i}`, NOW), `session-${i}@cold`);
});
