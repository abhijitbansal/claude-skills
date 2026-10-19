// The alternatives table the build prints. Every number is computed, never guessed.
import { notAvailable } from './recommend.mjs';

const CHARS_PER_TOKEN = 4;
const BYTES_PER_KB = 1024;
const HEAVY_NOTE = 'may be slow on phones';
const COLUMNS = ['world', 'fit', 'switch tokens', 'page size', 'render', 'command'];
// A leading '-' is quoted too, so an argument can never read as an option.
const SAFE_ARG = /^[\w@%+=:,./][\w@%+=:,./-]*$/;

const kb = (bytes) => `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
const shellArg = (s) => (SAFE_ARG.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

// The flags that make the switch the same build: where the page goes, which theme, whether outside paths are allowed.
function flagArgs({ out, theme, allowOutside } = {}) {
  return [out && `--out ${shellArg(out)}`, theme && `--theme ${shellArg(theme)}`, allowOutside && '--allow-outside'].filter(Boolean).map((a) => ` ${a}`).join('');
}

function row(alt, { current, pageBytes, skillDir, specPath, flags }) {
  const isCurrent = alt.world === current;
  if (!alt.eligible) return [alt.world, alt.unavailable === undefined ? notAvailable(alt.needs) : `not available: ${alt.unavailable}`, '0', '—', '—', ''];
  const size = isCurrent ? kb(pageBytes) : `~${kb(alt.estBytes)}`;
  const render = alt.weight === 'heavy' ? `heavy; ${HEAVY_NOTE}` : alt.weight;
  const command = isCurrent ? '' : `node ${shellArg(`${skillDir}/scripts/build.mjs`)} ${shellArg(specPath)} --world ${alt.world}${flagArgs(flags)}`;
  return [isCurrent ? `${alt.world} (current)` : alt.world, alt.reason ?? 'fits', '0', size, render, command];
}

/**
 * @param {{ specText: string, current: string, pageBytes: number, skillDir: string, specPath?: string, flags?: { out?: string, theme?: string, allowOutside?: boolean },
 *   alternatives: { world: string, eligible: boolean, needs?: string, reason?: string, estBytes: number, weight: string }[] }} o
 */
export function costTable({ specText, current, pageBytes, skillDir, specPath = 'scene.json', flags, alternatives }) {
  const tokens = Math.ceil(specText.length / CHARS_PER_TOKEN);
  const rows = alternatives.map((a) => row(a, { current, pageBytes, skillDir, specPath, flags }));
  const widths = COLUMNS.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(' | ').trimEnd();
  // A lift offers no other worlds: just the authoring estimate, no empty table.
  const table = rows.length === 0 ? [] : [line(COLUMNS), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(line)];
  return [`spec authoring ≈ ${tokens} tokens (estimated)`, ...table].join('\n');
}
