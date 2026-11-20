// The summary's view of a session record (see session.mjs): five table cells per row, note fragments, a totals
// line and a "what was live" line. Everything read from a stream is untrusted text: whitespace collapses to one
// space, a cell is capped, and a pipe is escaped, so one case is always one table row.
export const SESSION_HEADERS = ['first build valid', 'spec by', 'make by', 'operator model', 'director model'];

const MAX_CELL_CHARS = 80;
const UNREADABLE = 'unreadable';
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const tri = (x) => (x === true ? '✓' : x === false ? '✗' : '-');

export function cellText(v) {
  const clean = oneLine(v) || '-';
  return (clean.length > MAX_CELL_CHARS ? `${clean.slice(0, MAX_CELL_CHARS - 1)}…` : clean).replaceAll('|', '\\|');
}

// Who did a kind of step: "director", "operator", "director+operator", with ×n when there were several, "-" for none.
function byCell(steps, what) {
  const of = steps.filter((s) => s.what === what);
  if (of.length === 0) return '-';
  const who = [...new Set(of.map((s) => s.by))].sort().join('+');
  return of.length > 1 ? `${who}×${of.length}` : who;
}

// No delegation is a result, not a gap: the cell says the director ran it. A named model on the delegating call
// overrode the agent file's own model, and the cell says so.
function operatorCell(s) {
  if (!s.delegated) return 'director ran it';
  const model = s.operatorModel ?? '-';
  return s.requestedModel ? `${model} (director requested ${oneLine(s.requestedModel)}: overrides the agent file)` : model;
}

/** The five cells for one row, in SESSION_HEADERS order. */
export function sessionCells(s) {
  if (!s.readable) return SESSION_HEADERS.map(() => UNREADABLE);
  return [tri(s.firstBuildValid), byCell(s.steps, 'spec'), byCell(s.steps, 'make'), cellText(operatorCell(s)), cellText(s.directorModel)];
}

/** Note fragments for one row's notes cell. */
export function sessionNotes(s) {
  if (!s.readable) return ['session stream unreadable'];
  return [s.capped ? 'hit the budget cap' : '', s.hooksFired.length ? `hooks fired: ${s.hooksFired.map(oneLine).join(', ')}` : ''];
}

/** `Delegated d/n · first build valid v/m[ · session unreadable u]` over the rows that have a session. */
export function sessionTotals(sessions) {
  const built = sessions.filter((s) => s.firstBuildValid !== null);
  const unreadable = sessions.filter((s) => !s.readable).length;
  return `Delegated ${sessions.filter((s) => s.delegated).length}/${sessions.length} · first build valid ${built.filter((s) => s.firstBuildValid).length}/${built.length}${unreadable ? ` · session unreadable ${unreadable}` : ''}`;
}

/** What the stream says was live: setting sources, plugins, hooks that fired. Says so when the stream lists no sources. */
export function sessionSetup(sessions) {
  const read = sessions.filter((s) => s.readable);
  const list = (items) => (items.length ? [...new Set(items.map(oneLine))].join(', ') : 'none');
  const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : null);
  const sourceLists = read.map((s) => asList(s.settingSources)).filter(Boolean);
  const sources = sourceLists.length ? list(sourceLists.flat()) : 'not listed in the stream';
  return `Session setup (read from the stream): setting sources ${sources}; plugins ${list(read.flatMap((s) => s.plugins))}; hooks fired ${list(read.flatMap((s) => s.hooksFired))}.`;
}
