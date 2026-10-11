import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INSTALL = fileURLToPath(new URL("../install.sh", import.meta.url));
const run = (home, ...args) => spawnSync("sh", [INSTALL, ...args], { encoding: "utf8", env: { ...process.env, COPILOT_HOME: home } });

test("install links, reinstalls by copy, and uninstalls under COPILOT_HOME", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-install-"));
  const dest = join(home, "extensions", "cache-clock");

  assert.equal(run(home).status, 0);
  assert.ok(lstatSync(dest).isSymbolicLink());
  assert.ok(existsSync(join(dest, "extension.mjs")));

  assert.equal(run(home, "--copy").status, 0);
  assert.ok(!lstatSync(dest).isSymbolicLink());
  assert.ok(existsSync(join(dest, "lib", "wiring.mjs")));

  assert.equal(run(home, "--uninstall").status, 0);
  assert.ok(!existsSync(dest));
});

test("install rejects unknown flags", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-install-"));
  assert.equal(run(home, "--force").status, 2);
});
