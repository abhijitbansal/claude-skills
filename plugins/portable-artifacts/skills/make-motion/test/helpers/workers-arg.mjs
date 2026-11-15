// Not a test file. render.mjs defaults to --workers auto (up to 8 pages); `npm test` runs files in parallel, so a test
// that renders and names no --workers would open up to 8 pages of its own. Test helpers pass the args through this.

// Modes that refuse --workers (a usage error): they capture on one page or write something other than one MP4.
const REFUSES_WORKERS = ['--contact-sheet', '--poster', '--batch'];

/** `args` plus `--workers 1`, unless a test already names --workers (either spelling) or the mode refuses it. The caller's array is not changed. */
export function withTestWorkers(args = []) {
  const named = args.some((a) => a === '--workers' || String(a).startsWith('--workers='));
  const refused = args.some((a) => REFUSES_WORKERS.includes(a));
  return named || refused ? [...args] : [...args, '--workers', '1'];
}
