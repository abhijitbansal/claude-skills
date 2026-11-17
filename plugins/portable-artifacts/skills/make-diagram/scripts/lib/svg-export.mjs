// A built diagram as one standalone .svg file, with no browser: the diagram's SVG plus the theme's variables, its
// embedded fonts, the diagram CSS and a surface-coloured background, so the file looks the same opened anywhere.
//
// The limit, by design: an .svg file has one palette. This carries the theme's LIGHT palette; there is no light/dark
// switch (the page's toolbar export draws whatever scheme the page shows at that moment).
import { themeCss } from '../../shared/theme.mjs';

const xmlText = (css) => css.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

// The diagram CSS keeps each dark-mode rule (the glow, the group tint) on a line of its own, keyed to the OS scheme or to data-theme.
// A standalone file has no data-theme and one palette: those rules would switch on under a dark OS and clash with the light variables.
const lightOnly = (css) => css.split('\n').filter((line) => !/prefers-color-scheme|data-theme/.test(line)).join('\n');

/** The theme's light-palette variables (colours, fonts, kind hues) as the body of one CSS rule, and its @font-face rules. */
function themeParts(theme) {
  const css = themeCss(theme);
  const light = /:root\{color-scheme:light;([^}]*)\}/.exec(css);
  if (!light) throw new Error('the theme CSS has no light palette to export');
  return { vars: light[1], faces: css.match(/@font-face\{[^}]*\}/g) ?? [] };
}

/**
 * `built` is buildDiagram's result and `theme` the loaded theme it was built with. Returns the SVG text.
 * `note` goes in an XML comment at the top of the drawing (who made it); it may not contain "--".
 */
export function standaloneSvg(built, theme, { note } = {}) {
  const { vars, faces } = themeParts(theme);
  const surface = /--surface:([^;]+)/.exec(vars)?.[1];
  if (!surface) throw new Error('the theme has no --surface colour to paint the background with');
  const style = `<style>${xmlText(`${faces.join('\n')}\n.pa-diagram{${vars}}\n${lightOnly(built.css)}`)}</style>`;
  const background = `<rect width="100%" height="100%" fill="${surface}"/>`;
  const comment = note ? `<!-- ${note.replace(/-(?=-)/g, '- ')} -->` : '';
  const sized = built.svg.replace(/^<svg ([^>]*)>/, (_, attrs) => `<svg ${attrs} width="${built.width}" height="${built.height}">`);
  const open = /^<svg [^>]*>/.exec(sized)?.[0];
  if (!open) throw new Error('the built diagram does not start with an <svg> element');
  // After the root tag and its <title> and <desc>, before the <defs>: the style applies to everything, the background paints first.
  const at = sized.indexOf('</desc>') + '</desc>'.length;
  if (at < '</desc>'.length) throw new Error('the built diagram has no <desc> to place the style after');
  return `${sized.slice(0, at)}${comment}${style}${background}${sized.slice(at)}`;
}
