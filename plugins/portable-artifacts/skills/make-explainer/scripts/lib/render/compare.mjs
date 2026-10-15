import { inline, toneChip, toneClass } from './ui.mjs';

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export function render(section) {
  const n = section.columns.length === 3 ? 3 : 2;
  const cols = section.columns.map((c) => `<div class="cmp-col ${toneClass(c.tone)}">
<h3>${inline(c.title)}</h3>${toneChip(c.tone)}
<ul>
${c.points.map((p) => `<li>${inline(p)}</li>`).join('\n')}
</ul>
</div>`);
  const verdict = section.verdict === undefined ? '' : `\n<p class="verdict"><strong>Verdict.</strong> ${inline(section.verdict)}</p>`;
  return `<div class="compare cols-${n}">\n${cols.join('\n')}\n</div>${verdict}`;
}
