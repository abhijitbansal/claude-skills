// `--out <file>` for the JSON-printing scripts: write UTF-8, create parent folders,
// print "wrote <file>". Lets an agent skip shell redirection (`>`), which not every host has.
// A bad path is a usage error (exit 2, one line), never a stack trace.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';

// `overwrite: false` refuses a file that already exists (scaffold: a filled-in spec must not be replaced by a
// TODO skeleton); gather keeps the default, since its facts file is rewritten on every run.
export function emit(text, outFile, { overwrite = true } = {}) {
  if (outFile === undefined) {
    process.stdout.write(text);
    return;
  }
  if (outFile.trim() === '') throw new UsageError('--out needs a file path, for example --out facts.json');
  try {
    const existing = fs.statSync(outFile, { throwIfNoEntry: false });
    if (existing?.isDirectory()) {
      throw new UsageError(`--out must be a file, not a directory: ${outFile}`);
    }
    if (existing && !overwrite) {
      throw new UsageError(`${outFile} already exists; edit it instead, or pass --force to replace it with a fresh skeleton`);
    }
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, text, 'utf8');
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot write ${outFile}: ${e.code ?? e.message}`);
  }
  process.stdout.write(`wrote ${outFile}\n`);
}
