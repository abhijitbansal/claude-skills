#!/usr/bin/env node
// Keeps the SHA-256 block in install.sh in step with extension/. The one-line install checks
// every file it downloads against that block, so run `--write` after any edit under extension/;
// `--check` (run by the tests) fails when the block is stale.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(ROOT, "install.sh");
const BEGIN = "# BEGIN SHA256 (generated: node tools/cache-clock/bin/checksums.mjs --write)";
const END = "# END SHA256";
const BLOCK = /# BEGIN SHA256[^\n]*\n[\s\S]*?\n# END SHA256/;
const USAGE = "usage: checksums.mjs --write | --check";
const STALE = "cache-clock: install.sh checksums are stale; run node tools/cache-clock/bin/checksums.mjs --write";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The extension files install.sh downloads, in its order. */
function listedFiles(script) {
  const match = /^FILES="([^"]+)"/m.exec(script);
  if (!match) throw new Error("install.sh has no FILES list");
  return match[1].split(/\s+/).filter(Boolean);
}

/** The generated block: one `<sha256>  <path>` line per listed file, in FILES order. */
function checksumBlock(files) {
  const lines = files.map((file) => `${sha256(readFileSync(join(ROOT, "extension", file)))}  ${file}`);
  return `${BEGIN}\nSUMS='${lines.join("\n")}\n'\n${END}`;
}

/** The script with its block replaced, or added after the FILES line when it has none yet. */
function withBlock(script, block) {
  if (BLOCK.test(script)) return script.replace(BLOCK, () => block);
  return script.replace(/^(FILES="[^"]+")$/m, (line) => `${line}\n${block}`);
}

function main(args) {
  if (args.length !== 1 || !["--write", "--check"].includes(args[0])) {
    console.error(USAGE);
    return 2;
  }
  const script = readFileSync(INSTALL, "utf8");
  const next = withBlock(script, checksumBlock(listedFiles(script)));
  if (args[0] === "--check") {
    if (next === script) return 0;
    console.error(STALE);
    return 1;
  }
  if (next !== script) writeFileSync(INSTALL, next);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
