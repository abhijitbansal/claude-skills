// node --import this file: makes every read of make-diagram's default theme (blueprint) throw, a stand-in
// for a bug inside the build that is not a spec or usage error.
import fs from 'node:fs';

const read = fs.readFileSync;
fs.readFileSync = function patched(file, ...rest) {
  if (String(file).endsWith('blueprint.json')) throw new Error('boom\n  at somewhere');
  return read.call(this, file, ...rest);
};
