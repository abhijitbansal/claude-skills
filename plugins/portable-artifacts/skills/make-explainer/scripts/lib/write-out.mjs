// `--out <file>` for the JSON-printing scripts: write UTF-8, create parent folders,
// print "wrote <file>". Lets an agent skip shell redirection (`>`), which not every host has.
// A bad path is a usage error (exit 2, one line), never a stack trace.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';

export function emit(text, outFile) {
  if (outFile === undefined) {
    process.stdout.write(text);
    return;
  }
  if (outFile.trim() === '') throw new UsageError('--out needs a file path, for example --out facts.json');
  try {
    if (fs.statSync(outFile, { throwIfNoEntry: false })?.isDirectory()) {
      throw new UsageError(`--out must be a file, not a directory: ${outFile}`);
    }
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, text, 'utf8');
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot write ${outFile}: ${e.code ?? e.message}`);
  }
  process.stdout.write(`wrote ${outFile}\n`);
}
