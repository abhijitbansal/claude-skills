import { chip, inline, SEVERITY, lookup } from './ui.mjs';

// Severity is a shape + a word; the stacked small-screen layout labels each cell.
export function render(section) {
  const hasOwner = section.items.some((r) => r.owner !== undefined);
  const head = ['Severity', 'Risk', 'Mitigation', ...(hasOwner ? ['Owner'] : [])];
  const rows = section.items.map((r) => `<tr>
<td data-label="Severity">${chip(lookup(SEVERITY, r.severity, 'low'))}</td>
<td data-label="Risk">${inline(r.risk)}</td>
<td data-label="Mitigation">${inline(r.mitigation)}</td>${hasOwner ? `\n<td data-label="Owner">${r.owner === undefined ? '' : inline(r.owner)}</td>` : ''}
</tr>`);
  return `<div class="tablewrap risks" role="region" aria-label="Risks" tabindex="0">
<table>
<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</div>`;
}
