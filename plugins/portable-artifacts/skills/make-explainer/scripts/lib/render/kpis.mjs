import { esc, inline, toneChip, toneClass } from './ui.mjs';

export function render(section) {
  const items = section.items.map((k) => {
    const delta = k.delta === undefined && !toneChip(k.tone) ? '' : `<dd class="kpi-delta">${toneChip(k.tone)}${k.delta === undefined ? '' : `<span>${esc(k.delta)}</span>`}</dd>`;
    const note = k.note === undefined ? '' : `<dd class="kpi-note">${inline(k.note)}</dd>`;
    return `<div class="kpi ${toneClass(k.tone)}"><dt>${inline(k.label)}</dt><dd class="kpi-value">${esc(String(k.value))}</dd>${delta}${note}</div>`;
  });
  return `<dl class="kpis">\n${items.join('\n')}\n</dl>`;
}
