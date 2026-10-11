import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// A throwaway checkout, so no installer bug can touch the real extension sources.
function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "cc-install-"));
  const checkout = join(base, "checkout");
  mkdirSync(checkout);
  cpSync(join(ROOT, "install.sh"), join(checkout, "install.sh"));
  cpSync(join(ROOT, "extension"), join(checkout, "extension"), { recursive: true });
  const home = join(base, "copilot");
  const run = (...args) => spawnSync("sh", [join(checkout, "install.sh"), ...args], { encoding: "utf8", env: { ...process.env, COPILOT_HOME: home } });
  return { checkout, home, dest: join(home, "extensions", "cache-clock"), run };
}

test("install links, reinstalls by copy, and uninstalls without touching the source", () => {
  const s = sandbox();
  assert.equal(s.run().status, 0);
  assert.ok(lstatSync(s.dest).isSymbolicLink());
  assert.ok(existsSync(join(s.dest, "extension.mjs")));

  assert.equal(s.run("--copy").status, 0);
  assert.ok(!lstatSync(s.dest).isSymbolicLink());
  assert.ok(existsSync(join(s.dest, "lib", "wiring.mjs")));

  assert.equal(s.run("--copy").status, 0);
  assert.equal(s.run().status, 0);
  assert.ok(lstatSync(s.dest).isSymbolicLink());

  assert.equal(s.run("--uninstall").status, 0);
  assert.ok(!existsSync(s.dest));
  assert.ok(existsSync(join(s.checkout, "extension", "extension.mjs")));
});

test("install refuses to replace a directory that is not a cache-clock install", () => {
  const s = sandbox();
  mkdirSync(s.dest, { recursive: true });
  writeFileSync(join(s.dest, "notes.txt"), "mine");
  const r = s.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a cache-clock install/);
  assert.ok(existsSync(join(s.dest, "notes.txt")));
});

test("install rejects unknown flags", () => {
  assert.equal(sandbox().run("--force").status, 2);
});
