// make-explainer's default theme. The shared DEFAULT_THEME stays `paper` for make-dashboard.
export const EXPLAINER_THEME = 'dusk';
// A plan page reads as an engineering sheet: it defaults to mono (`--theme brief` or the spec's theme picks the
// executive look).
export const PLAN_THEME = 'mono';

/** The theme a spec builds with when neither --theme nor the spec names one. */
export const defaultTheme = (spec) => (spec?.preset === 'plan' ? PLAN_THEME : EXPLAINER_THEME);

/** The theme a spec builds with: its own `theme`, else the default for its preset. */
export const specTheme = (spec) => spec?.theme ?? defaultTheme(spec);
