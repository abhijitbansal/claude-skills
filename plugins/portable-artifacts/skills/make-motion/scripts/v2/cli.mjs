// The command line of scripts/make.mjs: strict flags, one film path, and a UsageError (exit 2) that says what is
// accepted. Pure: it reads nothing and touches no file.
import { parseCli, UsageError } from '../../shared/cli.mjs';

export const LIST_NAMES = Object.freeze(['kinds', 'looks', 'modes', 'devices', 'cuts', 'fields']);
export const FLAGS = Object.freeze(['--out', '--json', '--sheets-only', '--outline', '--list', '--exact', '--no-render']);
const USAGE = `node scripts/make.mjs <film.json>; accepted flags: ${FLAGS.join(', ')}`;
const OPTIONS = Object.freeze({
  out: { type: 'string' },
  json: { type: 'boolean' },
  'sheets-only': { type: 'boolean' },
  outline: { type: 'boolean' },
  list: { type: 'string' },
  exact: { type: 'boolean' },
  'no-render': { type: 'boolean' },
});

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ specPath: string | null, out: string | null, json: boolean, noRender: boolean, outline: boolean, list: string | null, exact: boolean }}
 * @throws {UsageError} for an unknown or misspelled flag, a bad --list value, a missing or extra film path, or an --out that is not .mp4
 */
export function parseMakeArgs(argv) {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (values.list !== undefined && !LIST_NAMES.includes(values.list)) {
    throw new UsageError(`--list takes one of: ${LIST_NAMES.join(', ')}; got "${values.list}"`);
  }
  if (values.list === undefined && positionals.length !== 1) {
    throw new UsageError(`give the path of one film .json file (got ${positionals.length}); usage: ${USAGE}`);
  }
  if (values.out !== undefined && !values.out.toLowerCase().endsWith('.mp4')) {
    throw new UsageError(`--out must name an .mp4 file, got "${values.out}"`);
  }
  return {
    specPath: positionals[0] ?? null,
    out: values.out ?? null,
    json: values.json === true,
    noRender: values['no-render'] === true || values['sheets-only'] === true,
    outline: values.outline === true,
    list: values.list ?? null,
    exact: values.exact === true,
  };
}
