// Theme bridge: reads the page's CSS variables and tells the scene when light/dark flips.
// Dark mode is decided exactly as shared/theme.mjs's themeCss does: the data-theme attribute wins,
// otherwise prefers-color-scheme.

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isDarkMode(root = document.documentElement, win = window) {
  const attr = root.getAttribute('data-theme');
  return attr === 'dark' || (attr !== 'light' && win.matchMedia(DARK_QUERY).matches);
}

/** { dark, readVar(cssVar) -> computed value } for the page as it is right now. */
export function readPalette(root = document.documentElement, win = window) {
  const style = win.getComputedStyle(root);
  return { dark: isDarkMode(root, win), readVar: (cssVar) => style.getPropertyValue(cssVar) };
}

/** Calls onChange(palette) when data-theme changes or the OS scheme flips. Returns a stop function. */
export function watchTheme(onChange, root = document.documentElement, win = window) {
  const fire = () => onChange(readPalette(root, win));
  const observer = new MutationObserver(fire);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const media = win.matchMedia(DARK_QUERY);
  media.addEventListener('change', fire);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', fire);
  };
}
