// RFC 4180 CSV: quoted fields (commas, newlines, "" escapes), CRLF or LF, a
// leading BOM, a trailing newline. Blank lines are skipped. -> string[][]
export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let touched = false; // the line holds something, so it is not blank

  const endRow = () => {
    if (touched) rows.push([...row, field]);
    row = [];
    field = '';
    touched = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      touched = true;
      if (c === '"' && field === '') quoted = true;
      else if (c === ',') { row.push(field); field = ''; } else field += c;
    }
  }
  if (quoted) throw new Error('unterminated quote in CSV');
  endRow();
  return rows;
}
