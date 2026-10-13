import { esc, inline, toneChip, toneClass } from './ui.mjs';

// A number prints with every digit it has and, from 10,000 up, thousands separators ("min2": 2026 and 1107 stay
// as written, 51301 shows as 51,301). Always en-US, so a build never depends on the machine's locale.
// A string is shown as written.
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20, useGrouping: 'min2' });
const valueText = (value) => (typeof value === 'number' ? NUMBER_FORMAT.format(value) : String(value));

export function render(section) {
  const items = section.items.map((k) => {
    const delta = k.delta === undefined && !toneChip(k.tone) ? '' : `<dd class="kpi-delta">${toneChip(k.tone)}${k.delta === undefined ? '' : `<span>${esc(k.delta)}</span>`}</dd>`;
    const note = k.note === undefined ? '' : `<dd class="kpi-note">${inline(k.note)}</dd>`;
    return `<div class="kpi ${toneClass(k.tone)}"><dt>${inline(k.label)}</dt><dd class="kpi-value">${esc(valueText(k.value))}</dd>${delta}${note}</div>`;
  });
  return `<dl class="kpis">\n${items.join('\n')}\n</dl>`;
}
