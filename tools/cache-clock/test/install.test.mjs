import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

test("install and uninstall leave alone another tool's folder that also has an extension.mjs", () => {
  for (const flag of [[], ["--uninstall"]]) {
    const s = sandbox();
    mkdirSync(s.dest, { recursive: true });
    writeFileSync(join(s.dest, "extension.mjs"), "// someone else's extension\n");
    writeFileSync(join(s.dest, "settings.json"), "{}");
    const r = s.run(...flag);
    assert.equal(r.status, 1, flag.join(" "));
    assert.match(r.stderr, /not a cache-clock install/);
    assert.ok(existsSync(join(s.dest, "settings.json")));
  }
});

test("install replaces a dangling link, such as one left by a deleted checkout", () => {
  const s = sandbox();
  mkdirSync(join(s.home, "extensions"), { recursive: true });
  symlinkSync(join(s.home, "gone"), s.dest);
  assert.equal(s.run().status, 0);
  assert.ok(existsSync(join(s.dest, "extension.mjs")));
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
  assert.match(r.stdout, /VS Code.*from a project/);
  assert.match(r.stdout, /sh -s -- --project/);
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

const checksums = (...args) => spawnSync(process.execPath, [join(ROOT, "bin", "checksums.mjs"), ...args], { encoding: "utf8" });

test("install.sh checksums match the extension files", () => {
  const r = checksums("--check");
  assert.equal(r.status, 0, r.stderr);
});

test("checksums.mjs rejects unknown arguments and lists the accepted ones", () => {
  for (const args of [["--force"], [], ["--write", "--check"]]) {
    const r = checksums(...args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /--write \| --check/);
  }
});

test("checksums.mjs --check fails on a stale block and --write fixes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-sums-"));
  mkdirSync(join(dir, "bin"));
  cpSync(join(ROOT, "bin", "checksums.mjs"), join(dir, "bin", "checksums.mjs"));
  cpSync(join(ROOT, "install.sh"), join(dir, "install.sh"));
  cpSync(join(ROOT, "extension"), join(dir, "extension"), { recursive: true });
  const run = (arg) => spawnSync(process.execPath, [join(dir, "bin", "checksums.mjs"), arg], { encoding: "utf8" });
  assert.equal(run("--check").status, 0);
  appendFileSync(join(dir, "extension", "lib", "clock.mjs"), "// edited\n");
  const stale = run("--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /install\.sh checksums are stale; run node tools\/cache-clock\/bin\/checksums\.mjs --write/);
  assert.equal(run("--write").status, 0);
  assert.equal(run("--check").status, 0);
  const script = readFileSync(join(dir, "install.sh"), "utf8");
  const listed = script.match(/^FILES="([^"]+)"/m)[1].split(/\s+/).filter(Boolean);
  const sums = script.match(/^SUMS='([^']*)'$/m)[1].split("\n").filter(Boolean);
  assert.deepEqual(sums.map((l) => l.split(/\s+/)[1]), listed, "one line per file, in FILES order");
  assert.ok(sums.every((l) => /^[0-9a-f]{64} {2}\S+$/.test(l)));
});

test("a piped install refuses a file whose checksum does not match", () => {
  const tampered = join(mkdtempSync(join(tmpdir(), "cc-tamper-")), "extension");
  cpSync(join(ROOT, "extension"), tampered, { recursive: true });
  appendFileSync(join(tampered, "lib", "clock.mjs"), "// x\n");
  const p = piped(pathToFileURL(tampered).href);
  const r = p.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /checksum mismatch: lib\/clock\.mjs/);
  assert.ok(!existsSync(p.dest));
  assert.deepEqual(readdirSync(join(p.home, "extensions")).filter((f) => f.startsWith(".cache-clock")), []);
});

test("a piped install refuses a file the checksum list does not name", () => {
  const unlisted = join(mkdtempSync(join(tmpdir(), "cc-unlisted-")), "extension");
  cpSync(join(ROOT, "extension"), unlisted, { recursive: true });
  const script = readFileSync(join(ROOT, "install.sh"), "utf8").replace(/^SUMS='[^']*'$/m, "SUMS='abc  extension.mjs'");
  const r = spawnSync("sh", ["-s"], { input: script, cwd: tmpdir(), encoding: "utf8", env: { ...process.env, COPILOT_HOME: mkdtempSync(join(tmpdir(), "cc-home-")), CACHE_CLOCK_BASE_URL: pathToFileURL(unlisted).href } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no checksum listed for report\.mjs/);
});

test("the one-line install is pinned to a tag named once, in install.sh", () => {
  const script = readFileSync(join(ROOT, "install.sh"), "utf8");
  const ref = script.match(/^REF="([^"]+)"$/m)?.[1];
  assert.match(ref, /^cache-clock-v\d+\.\d+\.\d+$/);
  const baseLine = script.split("\n").find((l) => l.startsWith("BASE_URL="));
  assert.ok(baseLine.includes("$REF") && !baseLine.includes("/main/"), baseLine);
  assert.equal(script.split("\n").filter((l) => l.includes(ref)).length, 1, "the tag is spelled in one place");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const curlLines = readme.split("\n").filter((l) => l.includes("curl -fsSL") && l.includes("install.sh"));
  assert.ok(curlLines.length >= 2);
  for (const l of curlLines) {
    assert.ok(l.includes(`/${ref}/tools/cache-clock/install.sh`) && !l.includes("/main/tools/cache-clock/install.sh"), l);
  }
  assert.match(readme, new RegExp(`works once the tag \`${ref}\` exists`));
});

test("a piped install without sha256sum or shasum stops before downloading", () => {
  const empty = mkdtempSync(join(tmpdir(), "cc-nopath-"));
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  // PATH keeps only what the installer needs before the check: sh builtins, plus curl and mktemp stubs.
  for (const tool of ["curl", "mktemp", "dirname", "mkdir", "rm", "awk", "cat"]) {
    writeFileSync(join(empty, tool), tool === "curl" ? "#!/bin/sh\nexit 99\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  const r = spawnSync("/bin/sh", ["-s"], {
    input: readFileSync(join(ROOT, "install.sh"), "utf8"), cwd: tmpdir(), encoding: "utf8",
    env: { PATH: empty, HOME: home, COPILOT_HOME: home, CACHE_CLOCK_BASE_URL: pathToFileURL(join(ROOT, "extension")).href },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the one-line install needs sha256sum or shasum/);
});

// --project puts the extension in <git root>/.github/extensions, where VS Code's Copilot chat loads it.
function project({ git = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "cc-project-"));
  const repo = join(base, "repo");
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  if (git) spawnSync("git", ["init", "-q", repo]);
  return { repo, dest: join(repo, ".github", "extensions", "cache-clock") };
}

test("--project copies into the git root's .github/extensions, from a subfolder, and uninstalls", () => {
  const s = sandbox();
  const p = project();
  const run = (...args) => spawnSync("sh", [join(s.checkout, "install.sh"), ...args], {
    cwd: join(p.repo, "src", "deep"), encoding: "utf8", env: { ...process.env, COPILOT_HOME: s.home },
  });
  const r = run("--project");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!lstatSync(p.dest).isSymbolicLink(), "a project install is a copy, never a link into a checkout");
  assert.ok(existsSync(join(p.dest, "lib", "wiring.mjs")));
  assert.ok(!existsSync(s.dest), "the user install is left alone");
  assert.match(r.stdout, /\.github\/extensions\/cache-clock/);
  assert.match(r.stdout, /chat\.canvases\.enabled/);

  assert.equal(run("--project").status, 0, "reinstalls over its own copy");
  assert.equal(run("--project", "--uninstall").status, 0);
  assert.ok(!existsSync(p.dest));
});

test("--project takes a folder argument, and a folder outside git is used as is", () => {
  const s = sandbox();
  const p = project({ git: false });
  assert.equal(s.run("--project", p.repo).status, 0);
  assert.ok(existsSync(join(p.dest, "extension.mjs")));
});

test("--project refuses a missing folder", () => {
  const s = sandbox();
  const r = s.run("--project", join(tmpdir(), "cc-no-such-project"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such folder/);
});

test("piped --project downloads a copy into the project", () => {
  const p = project();
  const r = spawnSync("sh", ["-s", "--", "--project"], {
    input: readFileSync(join(ROOT, "install.sh"), "utf8"), cwd: p.repo, encoding: "utf8",
    env: { ...process.env, COPILOT_HOME: join(p.repo, "..", "copilot"), CACHE_CLOCK_BASE_URL: pathToFileURL(join(ROOT, "extension")).href },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(p.dest, "report.mjs")));
  assert.deepEqual(readdirSync(join(p.repo, ".github", "extensions")), ["cache-clock"], "no stage folder left behind");
});
