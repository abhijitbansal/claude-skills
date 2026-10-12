import { esc, inline, plain } from './ui.mjs';

const NUMERIC = /^[-+−]?\$?\d[\d,]*(\.\d+)?(%|[a-zA-Z]{0,3})?$/;
const ALIGN = { left: 'l', center: 'c', right: 'r' };

const isNumeric = (v) => typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim()));

// Explicit align wins; otherwise a column whose cells are all numbers is right-aligned.
function alignments(section) {
  return section.columns.map((_, c) => {
    const given = section.align?.[c];
    if (Object.hasOwn(ALIGN, given)) return ALIGN[given];
    return section.rows.length > 0 && section.rows.every((r) => isNumeric(r[c])) ? 'r' : 'l';
  });
}

const cell = (v) => (typeof v === 'number' ? esc(String(v)) : inline(v));

export function render(section) {
  const align = alignments(section);
  const head = section.columns.map((c, i) => `<th scope="col" class="a-${align[i]}">${inline(c)}</th>`).join('');
  const rows = section.rows.map((row) => {
    const cells = row.map((v, i) => (i === 0
      ? `<th scope="row" class="a-${align[i]}">${cell(v)}</th>`
      : `<td class="a-${align[i]}">${cell(v)}</td>`));
    return `<tr>${cells.join('')}</tr>`;
  });
  const label = plain(section.caption ?? section.title ?? 'Table');
  const caption = section.caption === undefined ? '' : `<caption>${inline(section.caption)}</caption>`;
  return `<div class="tablewrap" role="region" aria-label="${label}" tabindex="0">
<table>${caption}
<thead><tr>${head}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</div>`;
}
