import { inline, toneChip, toneClass } from './ui.mjs';

// The verdict block: first viewport, one lead sentence, then the few points.
export function render(section) {
  const points = (section.points ?? []).map((p) => `<li>${inline(p)}</li>`).join('\n');
  const tone = toneChip(section.tone);
  return `<div class="tldr ${toneClass(section.tone)}">
${tone ? `<p class="tldr-tone">${tone}</p>\n` : ''}<p class="lead">${inline(section.text)}</p>
${points ? `<ul class="points">\n${points}\n</ul>` : ''}
</div>`;
}
