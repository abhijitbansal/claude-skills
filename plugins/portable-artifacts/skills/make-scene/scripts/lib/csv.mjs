// RFC 4180 CSV: quoted fields (commas, newlines, "" escapes), CRLF or LF, a
// leading BOM, a trailing newline. Blank lines are skipped.
//
// parseCsvLines -> { rows: string[][], lines: number[] } where lines[i] is the
// 1-based file line row i starts on (so errors can point at it).
export function parseCsvLines(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  const lines = [];
  let row = [];
  let field = '';
  let quoted = false;
  let touched = false; // the line holds something, so it is not blank
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endRow = () => {
    if (touched) {
      rows.push([...row, field]);
      lines.push(rowLine);
    }
    row = [];
    field = '';
    touched = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '\n') line++;
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
    } else {
      if (!touched) rowLine = line;
      touched = true;
      if (c === '"' && field === '') { quoted = true; quoteLine = line; } else if (c === ',') { row.push(field); field = ''; } else field += c;
    }
  }
  if (quoted) throw new Error(`unterminated quote starting on line ${quoteLine}; close it with a matching "`);
  endRow();
  return { rows, lines };
}

/** @returns {string[][]} */
export function parseCsv(text) {
  return parseCsvLines(text).rows;
}
