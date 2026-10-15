// plugins/portable-artifacts/shared/theme-toggle.mjs
// The icon theme toggle shared by every page: Auto -> Light -> Dark.
// Templates own the <button>; this module owns its icons, CSS and behaviour.
import { SUN, MOON, AUTO } from './icons.mjs';

export const MODES = ['auto', 'light', 'dark'];
export const THEME_KEY = 'pa-theme';

export function nextMode(mode) {
  const i = MODES.indexOf(mode);
  return MODES[((i < 0 ? 0 : i) + 1) % MODES.length];
}

export const toggleIcons = () =>
  `<span class="pa-ti pa-ti-auto">${AUTO}</span><span class="pa-ti pa-ti-light">${SUN}</span><span class="pa-ti pa-ti-dark">${MOON}</span>`;

export const TOGGLE_CSS = [
  '[data-theme-toggle]{display:inline-grid;place-items:center;min-width:36px;min-height:36px;padding:0;line-height:0;cursor:pointer}',
  '.pa-ti{display:none}',
  ...MODES.map((m) => `[data-theme-toggle][data-mode="${m}"] .pa-ti-${m}{display:inline-flex}`),
  '@media print{[data-theme-toggle]{display:none}}',
].join('\n');

// Plain ES5 so it runs inline on every page; mirrors nextMode() above.
export const TOGGLE_JS = `(function () {
  if (window.__paThemeToggle) return;
  window.__paThemeToggle = true;
  var MODES = ${JSON.stringify(MODES)};
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var root = document.documentElement;
  function next(m) { var i = MODES.indexOf(m); return MODES[((i < 0 ? 0 : i) + 1) % MODES.length]; }
  function current() { var t = root.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function paint(m) {
    var label = 'Theme: ' + LABEL[m] + '. Switch to ' + LABEL[next(m)];
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('data-mode', m);
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
    }
  }
  function apply(m) {
    if (m === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    paint(m);
    try { document.dispatchEvent(new CustomEvent('pa:theme', { detail: { mode: m } })); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var m = next(current());
    try { window.localStorage.setItem(${JSON.stringify(THEME_KEY)}, m); } catch (err) {}
    apply(m);
  });
  paint(current());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(current()); });
})();`;
