// make-scene's theme default. The shared DEFAULT_THEME stays `paper` for dashboards and explainers;
// a scene defaults to `dusk`, the newest family default, whose dark mode is the night-city look.
import { loadTheme } from '../../shared/theme.mjs';

export const SCENE_THEME = 'dusk';

/** The loaded theme for `spec`: `override` (a name or a loaded theme) wins, then spec.theme, then SCENE_THEME. */
export function themeFor(spec, override) {
  if (typeof override === 'object' && override !== null) return override;
  return loadTheme(override ?? spec.theme ?? SCENE_THEME);
}
