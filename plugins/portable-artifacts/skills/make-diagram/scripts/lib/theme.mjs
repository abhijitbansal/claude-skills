// make-diagram's theme default. The shared DEFAULT_THEME stays `paper` for
// dashboards and explainers; a diagram defaults to `blueprint`, whose navy dark
// mode is the glow look of the design (spec §3).
import { loadTheme } from '../../shared/theme.mjs';

export const DIAGRAM_THEME = 'blueprint';

/** The loaded theme for `spec`: `override` (a name or a loaded theme) wins, then spec.theme, then DIAGRAM_THEME. */
export function themeFor(spec, override) {
  if (typeof override === 'object' && override !== null) return override;
  return loadTheme(override ?? spec.theme ?? DIAGRAM_THEME);
}
