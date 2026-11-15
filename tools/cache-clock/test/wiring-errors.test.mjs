import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTail, MAX_HISTORY_BYTES } from "../extension/lib/wiring.mjs";
import { fakeHost, flush, goCold, sonnet } from "./helpers/fake-host.mjs";
import { T0 } from "./fixtures.mjs";

// Errors the extension used to swallow are now reported, once where a repeat would only be noise.
const count = (h, pattern) => h.logs.filter((l) => pattern.test(l.message)).length;

test("a synchronously throwing abort cannot stop the send: the hook lets it through and says so, never that it was held", async () => {
  for (const answer of [undefined, null]) {
    const h = fakeHost({ answer });
    h.session.abort = () => { throw new Error("sync abort"); };
    await goCold(h);
    assert.equal(await h.prompt("recap"), undefined, `answer ${answer}`);
    assert.equal(count(h, /held|Send it again/), 0, `answer ${answer}: no hold note for a send that was not held`);
    assert.equal(count(h, /could not stop the send \(sync abort\); it may have gone out\./), 1, `answer ${answer}`);
  }
});

test("an async abort failure is logged when it arrives", async () => {
  const h = fakeHost({ answer: null });
  h.session.abort = () => Promise.reject(new Error("gone"));
  await goCold(h);
  assert.deepEqual(await h.prompt("recap"), { suppressOutput: true });
  await flush();
  assert.equal(count(h, /could not stop the send \(gone\)/), 1);
  assert.equal(count(h, /held/), 1, "the hold note was said before, and is not taken back");
});

test("a failing question is logged once, and the refuse-once note still follows", async () => {
  const h = fakeHost({ answer: new Error("no ui") });
  await goCold(h);
  assert.deepEqual(await h.prompt("recap"), { suppressOutput: true });
  assert.equal(count(h, /could not show the question \(no ui\); used the refuse-once note instead\./), 1);
  assert.equal(count(h, /Send it again to pay it/), 1);
  await h.prompt("again");
  assert.equal(count(h, /could not show the question/), 1);
});

test("a failing refusal save is logged", async () => {
  const h = fakeHost();
  writeFileSync(join(h.dir, "refusals"), "");
  await goCold(h);
  await h.prompt("recap");
  assert.equal(count(h, /could not save the refusal memory \(.+\); a resumed session may ask again\./), 1);
});

test("a corrupt config is reported once and the file is left as it is", async () => {
  const h = fakeHost();
  await h.start();
  writeFileSync(join(h.dir, "config.json"), "{not json");
  await h.prompt("one");
  await h.prompt("two");
  await h.command("");
  assert.equal(count(h, /^cache-clock: config\.json is not valid JSON .*; using defaults for those settings\. The file was left as it is\.$/), 1);
  assert.equal(h.logs.find((l) => /not valid JSON/.test(l.message)).level, "warning");
  await h.command("guard warn");
  assert.match(h.logs.at(-1).message, /not saved/);
  assert.equal(readFileSync(join(h.dir, "config.json"), "utf8"), "{not json");
});

test("a bad value in config.json is reported once too, and its other settings still apply", async () => {
  const h = fakeHost({ config: { mode: "warn", minUsd: 0.1, headsUpMin: 5 } });
  await h.start();
  writeFileSync(join(h.dir, "config.json"), JSON.stringify({ mode: "warn", minUsd: -1 }));
  await h.prompt("one");
  await h.prompt("two");
  assert.equal(count(h, /minUsd must be a dollar amount of 0 or more; using defaults/), 1);
});

const usageLine = JSON.stringify({ type: "session.usage_record", timestamp: new Date(T0).toISOString(), data: { usage: sonnet() } });

test("readTail returns whole lines from the end of a large file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-tail-"));
  const file = join(dir, "events.jsonl");
  const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i, pad: "é".repeat(5) }));
  writeFileSync(file, lines.join("\n") + "\n");
  const tail = readTail(file, 200);
  assert.equal(tail.truncated, true);
  const got = tail.text.split("\n").filter(Boolean);
  assert.ok(got.length > 0 && got.length < 20, "a small tail of the file");
  for (const line of got) JSON.parse(line);
  assert.equal(got.at(-1), lines.at(-1));
  assert.equal(readTail(file, 1e9).truncated, false);
  assert.equal(readTail(file, 1e9).text, lines.join("\n") + "\n");
  assert.equal(MAX_HISTORY_BYTES, 8 * 1024 * 1024);
});

test("readTail of one line longer than the limit has no whole line to give", () => {
  const file = join(mkdtempSync(join(tmpdir(), "cc-tail-")), "events.jsonl");
  writeFileSync(file, "x".repeat(500));
  assert.deepEqual(readTail(file, 100), { text: "", truncated: true });
});

test("a truncated session log is reported once, and what was read still seeds the clock", async () => {
  const h = fakeHost();
  h.history = { text: usageLine, truncated: true };
  await h.start();
  assert.equal(count(h, /larger than 8 MiB; read only its last 8 MiB, so older calls are not in this session's tally\./), 1);
  h.advance(7 * 60_000);
  assert.deepEqual(await h.prompt("recap"), { suppressOutput: true }, "the clock is seeded, so a cold send is refused");
});

test("a session log that cannot be read is reported, unless it simply does not exist yet", async () => {
  const bad = fakeHost();
  bad.history = Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
  await bad.start();
  assert.equal(count(bad, /could not read the session log \(EACCES: denied\); the clock starts at the next model call\./), 1);
  const fresh = fakeHost();
  fresh.history = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  await fresh.start();
  assert.equal(count(fresh, /session log/), 0, "a new session has no log yet, and that is normal");
});

test("a failure of the guard itself is logged once instead of silently skipping the check", async () => {
  const h = fakeHost();
  await h.start();
  h.selected = { get modelId() { throw new Error("boom"); } };
  assert.equal(await h.prompt("recap"), undefined, "the user's message is never blocked on our own failure");
  assert.equal(await h.prompt("again"), undefined);
  assert.equal(count(h, /could not check this send \(boom\); sending without a guard\./), 1);
});
