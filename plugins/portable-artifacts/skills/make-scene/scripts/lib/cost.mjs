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

function row(alt, { current, pageBytes, skillDir, specPath }) {
  const isCurrent = alt.world === current;
  if (!alt.eligible) return [alt.world, notAvailable(alt.needs), '0', '—', '—', ''];
  const size = isCurrent ? kb(pageBytes) : `~${kb(alt.estBytes)}`;
  const render = alt.weight === 'heavy' ? `heavy; ${HEAVY_NOTE}` : alt.weight;
  const command = isCurrent ? '' : `node ${shellArg(`${skillDir}/scripts/build.mjs`)} ${shellArg(specPath)} --world ${alt.world}`;
  return [isCurrent ? `${alt.world} (current)` : alt.world, alt.reason ?? 'fits', '0', size, render, command];
}

/**
 * @param {{ specText: string, current: string, pageBytes: number, skillDir: string, specPath?: string,
 *   alternatives: { world: string, eligible: boolean, needs?: string, reason?: string, estBytes: number, weight: string }[] }} o
 */
export function costTable({ specText, current, pageBytes, skillDir, specPath = 'scene.json', alternatives }) {
  const tokens = Math.ceil(specText.length / CHARS_PER_TOKEN);
  const rows = alternatives.map((a) => row(a, { current, pageBytes, skillDir, specPath }));
  const widths = COLUMNS.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(' | ').trimEnd();
  return [
    `spec authoring ≈ ${tokens} tokens (estimated)`,
    line(COLUMNS),
    widths.map((w) => '-'.repeat(w)).join('-+-'),
    ...rows.map(line),
  ].join('\n');
}
