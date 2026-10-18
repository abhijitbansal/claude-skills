// A spec's `theme` (a shared theme name) as what the render page needs: the theme's own JSON, and a
// stylesheet that offers the display, body and mono fonts from the synced shared/fonts and the
// theme's dark colour tokens. Fonts are linked by URL, not embedded: the page's CSP allows fonts
// from the local server only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme } from '../../shared/theme.mjs';

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../shared/fonts');
// display: `role: "title"` text; body: all other text, counters and charts; mono: `font: "mono"`.
const ROLES = [['display', '--display'], ['body', '--sans'], ['mono', '--mono']];
const HEX = /^#[0-9a-f]{6}$/i;

/** -> the theme JSON, or null for an unknown name. */
export function themeData(name) {
  try {
    return loadTheme(name);
  } catch {
    return null;
  }
}

/**
 * @font-face rules for the three font roles, then the font variables and the theme's dark colour
 * tokens (`--page`, `--surface`, `--text`, `--accent`, ...) on :root, so the stage and the preview
 * chrome both draw with them.
 */
export function themeCss(theme) {
  const faces = [];
  const seen = new Set();
  for (const [role] of ROLES) {
    const { family, weights } = theme.fonts[role];
    for (const [weight, file] of Object.entries(weights)) {
      if (seen.has(file)) continue;
      seen.add(file);
      faces.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(/theme/fonts/${file}) format("woff2")}`);
    }
  }
  const fonts = ROLES.map(([role, name]) => `${name}:"${theme.fonts[role].family}", ${theme.fonts[role].fallback}`);
  // Theme files are checked by shared/test; a non-hex token still never reaches the stylesheet.
  const colours = Object.entries(theme.dark).filter(([, v]) => HEX.test(v)).map(([k, v]) => `--${k}:${v}`);
  return `${faces.join('\n')}\n:root{${[...fonts, ...colours].join(';')}}\n`;
}
