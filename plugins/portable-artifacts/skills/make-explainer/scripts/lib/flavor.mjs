// Theme character beyond colour tokens. A page's <html data-flavor> selects the
// layout and type treatment its theme was drawn with: dusk (soft, tilted card,
// outlined numerals), press (print: drop caps, marginal numerals), poster
// (condensed caps, hard rules, registration marks). The four older themes are
// `classic`: they keep the page exactly as it was, with no flavor stylesheet.
// The deck (slides.html) uses the same function so both layouts agree.

export const FLAVORS = Object.freeze(['dusk', 'press', 'poster']);
export const CLASSIC = 'classic';

/** Theme name -> 'dusk' | 'press' | 'poster' | 'classic'. */
export function flavorFor(themeName) {
  return FLAVORS.includes(themeName) ? themeName : CLASSIC;
}

// The solid card fill and the text colour on it, per flavor and mode, as theme
// token names. Only these pairs are contrast-checked (test/flavor.test.mjs), so
// CSS draws a solid fill with text on it only through --card-bg / --card-fg.
export const CARD_INKS = Object.freeze({
  dusk: { light: ['accent', 'page'], dark: ['accent', 'page'] },
  press: { light: ['text', 'page'], dark: ['text', 'page'] },
  poster: { light: ['glow', 'text'], dark: ['glow', 'page'] },
});

const CSS_NAME = { accent: '--accent', page: '--page', text: '--text', glow: '--glow' };
const pair = ([bg, fg]) => `--card-bg:var(${CSS_NAME[bg]});--card-fg:var(${CSS_NAME[fg]})`;

/** The flavor's mode-dependent custom properties, on the same selectors themeCss() uses. '' for classic. */
export function flavorVars(flavor) {
  const inks = CARD_INKS[flavorFor(flavor)];
  if (!inks) return '';
  return [
    `:root{${pair(inks.light)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${pair(inks.dark)}}}`,
    `:root[data-theme="dark"]{${pair(inks.dark)}}`,
  ].join('\n');
}
