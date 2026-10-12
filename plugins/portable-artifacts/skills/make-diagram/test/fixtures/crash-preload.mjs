// node --import this file: makes every read of the paper theme throw, a stand-in
// for a bug inside the build that is not a spec or usage error.
import fs from 'node:fs';

const read = fs.readFileSync;
fs.readFileSync = function patched(file, ...rest) {
  if (String(file).endsWith('paper.json')) throw new Error('boom\n  at somewhere');
  return read.call(this, file, ...rest);
};
