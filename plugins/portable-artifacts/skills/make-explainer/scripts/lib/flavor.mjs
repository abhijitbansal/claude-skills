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

// The deck's title slide sets its text on a scrim: --page at `alpha` over the full-bleed art. Only the `inks`
// may sit directly on it (test/flavor.test.mjs proves them against the worst art pixel); anything else on the
// title slide brings its own solid ground. The closing slide puts its content on solid --page instead, because
// any section type can close a deck.
export const SCRIM = Object.freeze({ token: 'page', alpha: 0.84, inks: Object.freeze(['text', 'text2']) });

/** The scrim as one custom property ('' for classic); color-mix keeps it a token, so it follows the mode. */
export function scrimVar(flavor) {
  if (!CARD_INKS[flavorFor(flavor)]) return '';
  return `:root{--scrim:color-mix(in srgb, var(${CSS_NAME[SCRIM.token]}) ${Math.round(SCRIM.alpha * 100)}%, transparent)}`;
}

/**
 * Every scrim ink below 4.5:1 over some art pixel, as "<flavor> <mode>: <ink> on the scrim over <hex> is N:1" lines.
 * The pixels are every #rrggbb token of the theme plus black and white; `mix` is mixHex from shared/contrast.mjs.
 */
export function scrimProblems(scrim, themes, ratio, mix) {
  const problems = [];
  for (const [flavor, theme] of Object.entries(themes)) {
    for (const mode of ['light', 'dark']) {
      const tokens = theme[mode];
      const pixels = ['#000000', '#ffffff', ...Object.values(tokens).filter((v) => /^#[0-9a-f]{6}$/i.test(v))];
      for (const ink of scrim.inks) {
        const worst = pixels
          .map((px) => ({ px, value: ratio(tokens[ink], mix(tokens[scrim.token], px, scrim.alpha)) }))
          .reduce((a, b) => (b.value < a.value ? b : a));
        if (!(worst.value >= 4.5)) problems.push(`${flavor} ${mode}: ${ink} on the scrim over ${worst.px} is ${worst.value.toFixed(2)}:1`);
      }
    }
  }
  return problems;
}

/**
 * Every ink pair below 4.5:1, as "<flavor> <mode>: <fg> on <bg> is N:1" lines ([] when all pass).
 * `themes` maps a flavor to its loaded theme JSON; `ratio` is contrastRatio from shared/contrast.mjs.
 */
export function cardInkProblems(inks, themes, ratio) {
  const problems = [];
  for (const [flavor, modes] of Object.entries(inks)) {
    for (const [mode, [bg, fg]] of Object.entries(modes)) {
      const tokens = themes[flavor]?.[mode];
      const value = tokens ? ratio(tokens[bg], tokens[fg]) : 0;
      if (!(value >= 4.5)) problems.push(`${flavor} ${mode}: ${fg} on ${bg} is ${value.toFixed(2)}:1`);
    }
  }
  return problems;
}
