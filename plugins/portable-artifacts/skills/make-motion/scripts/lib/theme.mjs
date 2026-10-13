// A spec's `theme` (a shared theme name) as what the render page needs: the theme's own JSON, and a
// stylesheet that offers the body and mono fonts from the synced shared/fonts. Fonts are linked by
// URL, not embedded: the page's CSP allows fonts from the local server only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme } from '../../shared/theme.mjs';

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../shared/fonts');
const ROLES = [['body', '--sans'], ['mono', '--mono']];

/** -> the theme JSON, or null for an unknown name. */
export function themeData(name) {
  try {
    return loadTheme(name);
  } catch {
    return null;
  }
}

/** @font-face rules for the body and mono fonts, then the two font variables on the stage. */
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
  const vars = ROLES.map(([role, name]) => `${name}:"${theme.fonts[role].family}", ${theme.fonts[role].fallback}`).join(';');
  return `${faces.join('\n')}\n#stage{${vars}}\n`;
}
