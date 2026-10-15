// `--out <file>` for the JSON-printing scripts: write UTF-8, create parent folders,
// print "wrote <file>". Lets an agent skip shell redirection (`>`), which not every host has.
import fs from 'node:fs';
import path from 'node:path';

export function emit(text, outFile) {
  if (outFile === undefined) {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, text, 'utf8');
  process.stdout.write(`wrote ${outFile}\n`);
}
