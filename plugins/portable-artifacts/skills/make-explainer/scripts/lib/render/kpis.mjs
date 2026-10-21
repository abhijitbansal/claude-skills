import { esc, inline, toneChip, toneClass } from './ui.mjs';

// A number prints with every digit it has and, from 10,000 up, thousands separators ("min2": 2026 and 1107 stay
// as written, 51301 shows as 51,301). Always en-US, so a build never depends on the machine's locale.
// A string is shown as written.
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20, useGrouping: 'min2' });
const valueText = (value) => (typeof value === 'number' ? NUMBER_FORMAT.format(value) : String(value));

// The value is one line, sized from its tile's width: --n (its length) tells the CSS how many characters
// must fit. A value longer than KPI_WIDE_CHARS would not fit a small tile even at the smallest size, so its
// tile takes the whole row.
// The layout limit (10) is deliberately lower than the advice in semantic.mjs (warn above 12): 11 and 12
// characters are legal but no longer fit a small tile, so they get the wide tile without a warning.
// --n counts code points; wide glyphs (CJK, emoji, capitals) may run wider than the CSS's 0.7em-per-character
// assumption, and scripts/check.mjs reports any value that still spills its tile.
const KPI_WIDE_CHARS = 10;

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export function render(section) {
  const items = section.items.map((k) => {
    const delta = k.delta === undefined && !toneChip(k.tone) ? '' : `<dd class="kpi-delta">${toneChip(k.tone)}${k.delta === undefined ? '' : `<span>${esc(k.delta)}</span>`}</dd>`;
    const note = k.note === undefined ? '' : `<dd class="kpi-note">${inline(k.note)}</dd>`;
    const value = valueText(k.value);
    const chars = [...value].length;
    const wide = chars > KPI_WIDE_CHARS ? ' kpi-wide' : '';
    return `<div class="kpi ${toneClass(k.tone)}${wide}"><dt>${inline(k.label)}</dt><dd class="kpi-value" style="--n: ${chars}">${esc(value)}</dd>${delta}${note}</div>`;
  });
  return `<dl class="kpis">\n${items.join('\n')}\n</dl>`;
}
