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
// The thresholds come from the smallest size the CSS shrinks to, --fs-md = 21px, at an assumed 0.7em (14.7px)
// per character. Measured content widths (tile less its padding and border; value box at 320px viewport):
//   narrowest wide tile, page: 246px (paper, ink, blueprint, editorial, mono, brief), 240px (dusk), 288px (press, poster)
//   narrowest wide tile, deck: 246px; flavored decks floor at --fs-sm (14px) instead, 200px, 20 characters
//   short tile: 9.5rem = 152px less 42px of padding and border = 110px
// The page figure that binds is dusk's 240px, so 240 / 14.7 = 16.3: 16 characters fit one line in any wide tile.
//   KPI_WIDE_CHARS 10 (the 11-character "123,456,789" is the first that no longer fits a short tile at 21px)
//   KPI_LONG_CHARS 16
// A value over KPI_LONG_CHARS would not fit even a wide tile at the smallest size, so it may wrap (and break
// anywhere) rather than spill; the page and the deck never widen for it.
const KPI_WIDE_CHARS = 10;
const KPI_LONG_CHARS = 16;

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export function render(section) {
  const items = section.items.map((k) => {
    const delta = k.delta === undefined && !toneChip(k.tone) ? '' : `<dd class="kpi-delta">${toneChip(k.tone)}${k.delta === undefined ? '' : `<span>${esc(k.delta)}</span>`}</dd>`;
    const note = k.note === undefined ? '' : `<dd class="kpi-note">${inline(k.note)}</dd>`;
    const value = valueText(k.value);
    const chars = [...value].length;
    const wide = chars > KPI_LONG_CHARS ? ' kpi-wide kpi-long' : chars > KPI_WIDE_CHARS ? ' kpi-wide' : '';
    return `<div class="kpi ${toneClass(k.tone)}${wide}"><dt>${inline(k.label)}</dt><dd class="kpi-value" style="--n: ${chars}">${esc(value)}</dd>${delta}${note}</div>`;
  });
  return `<dl class="kpis">\n${items.join('\n')}\n</dl>`;
}
