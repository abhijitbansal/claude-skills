import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// `curl … | sh` runs the script with no checkout next to it: it downloads a copy instead.
function piped(baseUrl) {
  const base = mkdtempSync(join(tmpdir(), "cc-curl-"));
  const home = join(base, "copilot");
  const script = readFileSync(join(ROOT, "install.sh"), "utf8");
  const run = (...args) => spawnSync("sh", ["-s", "--", ...args], {
    input: script, cwd: base, encoding: "utf8", env: { ...process.env, COPILOT_HOME: home, CACHE_CLOCK_BASE_URL: baseUrl },
  });
  return { home, cwd: base, dest: join(home, "extensions", "cache-clock"), run };
}

test("piped install downloads every extension file into a plain copy", () => {
  const p = piped(pathToFileURL(join(ROOT, "extension")).href);
  const r = p.run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!lstatSync(p.dest).isSymbolicLink());
  for (const file of ["extension.mjs", "report.mjs", ...readdirSync(join(ROOT, "extension", "lib")).map((f) => `lib/${f}`)]) {
    assert.ok(existsSync(join(p.dest, file)), `missing ${file}`);
  }
  assert.match(r.stdout, /chat\.canvases\.enabled/);
});

test("the download list names every file the extension ships", () => {
  const script = readFileSync(join(ROOT, "install.sh"), "utf8");
  const listed = script.match(/^FILES="([^"]+)"/m)[1].split(/\s+/).filter(Boolean).sort();
  const onDisk = readdirSync(join(ROOT, "extension"), { recursive: true })
    .map((f) => String(f).split("\\").join("/"))
    .filter((f) => statSync(join(ROOT, "extension", f)).isFile())
    .sort();
  assert.deepEqual(listed, onDisk);
});

test("a failed download leaves no partial install and no stage folder", () => {
  const p = piped(pathToFileURL(join(tmpdir(), "cc-no-such-dir")).href);
  const r = p.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /download failed/);
  assert.ok(!existsSync(p.dest));
  assert.deepEqual(readdirSync(join(p.home, "extensions")).filter((f) => f.startsWith(".cache-clock")), []);
});

test("a failed download keeps the install that was already there", () => {
  const good = piped(pathToFileURL(join(ROOT, "extension")).href);
  assert.equal(good.run().status, 0);
  const bad = spawnSync("sh", ["-s"], {
    input: readFileSync(join(ROOT, "install.sh"), "utf8"), cwd: tmpdir(), encoding: "utf8",
    env: { ...process.env, COPILOT_HOME: good.home, CACHE_CLOCK_BASE_URL: pathToFileURL(join(tmpdir(), "cc-no-such-dir")).href },
  });
  assert.notEqual(bad.status, 0);
  assert.ok(existsSync(join(good.dest, "extension.mjs")));
});

test("a piped install ignores an extension folder in the current directory", () => {
  const p = piped(pathToFileURL(join(ROOT, "extension")).href);
  mkdirSync(join(p.cwd, "extension"));
  writeFileSync(join(p.cwd, "extension", "extension.mjs"), "// not cache-clock\n");
  const r = p.run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!lstatSync(p.dest).isSymbolicLink(), "it downloads instead of linking the decoy");
  assert.notEqual(readFileSync(join(p.dest, "extension.mjs"), "utf8"), "// not cache-clock\n");
});
