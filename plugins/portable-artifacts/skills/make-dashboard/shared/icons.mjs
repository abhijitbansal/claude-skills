// plugins/portable-artifacts/shared/icons.mjs
// Shared SVG icons: the theme toggle's three states and one favicon per skill.
// Zero dependencies; every skill gets a copy through bin/sync-shared.mjs.

export const SKILLS = ['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion'];

const icon = (body) =>
  `<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const SUN = icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
export const MOON = icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
export const AUTO = icon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>');

// Glyphs drawn in class "g" on a 32x32 accent tile (class "t").
const GLYPHS = {
  'make-dashboard': '<rect class="g" x="8" y="17" width="4" height="8" rx="1"/><rect class="g" x="14" y="12" width="4" height="13" rx="1"/><rect class="g" x="20" y="7" width="4" height="18" rx="1"/>',
  'make-diagram': '<path class="s" d="M11 11l4 9M21 11l-4 9M12 9h8"/><circle class="g" cx="9" cy="9" r="3.5"/><circle class="g" cx="23" cy="9" r="3.5"/><circle class="g" cx="16" cy="23" r="3.5"/>',
  'make-explainer': '<rect class="g" x="9" y="6" width="14" height="20" rx="2"/><path class="l" d="M12 12h8M12 16h8M12 20h5"/>',
  'make-motion': '<path class="g" d="M12 8.5v15l12-7.5Z"/>',
};

export function faviconSvg(skill, theme) {
  const glyph = GLYPHS[skill];
  if (!glyph) throw new Error(`unknown skill "${skill}"; known: ${SKILLS.join(', ')}`);
  const { light, dark } = theme;
  const style =
    `.t{fill:${light.accent}}.g{fill:${light.surface}}.s,.l{stroke:${light.surface};stroke-width:2.5;stroke-linecap:round;fill:none}.l{stroke:${light.accent}}` +
    `@media (prefers-color-scheme: dark){.t{fill:${dark.accent}}.g{fill:${dark.page}}.s{stroke:${dark.page}}.l{stroke:${dark.accent}}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>${style}</style><rect class="t" width="32" height="32" rx="7"/>${glyph}</svg>`;
}

export const faviconHref = (skill, theme) => `data:image/svg+xml,${encodeURIComponent(faviconSvg(skill, theme))}`;

export const faviconLink = (skill, theme) => `<link rel="icon" type="image/svg+xml" href="${faviconHref(skill, theme)}">`;
