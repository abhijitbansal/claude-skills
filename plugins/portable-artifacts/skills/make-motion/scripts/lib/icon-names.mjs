// The icon names a hand-drawn scene can draw, and what to suggest for a name that is not one. Node only (it loads the
// whole Lucide set, template/sketch/lucide.mjs, which the page never does).
import { didYouMean } from '../../shared/errors.mjs';
import lucide from '../../template/sketch/lucide.mjs';

export const ICON_NAMES = Object.keys(lucide).sort();

// Old Lucide (and Feather) names, and plain words, that a spec is likely to use, to the names the set has now. Suggestions
// only: such a name is still an unknown icon. Every target must exist and no key may be a name (sketch-icons.test.mjs).
export const ICON_ALIASES = Object.freeze({
  home: 'house',
  edit: 'pencil',
  'edit-2': 'pencil',
  'edit-3': 'pen-line',
  'check-circle': 'circle-check',
  'check-circle-2': 'circle-check',
  'check-square': 'square-check',
  'x-circle': 'circle-x',
  'x-square': 'square-x',
  'plus-circle': 'circle-plus',
  'minus-circle': 'circle-minus',
  'user-circle': 'circle-user',
  'arrow-right-circle': 'circle-arrow-right',
  'alert-triangle': 'triangle-exclamation-point',
  'alert-circle': 'circle-exclamation-point',
  'alert-octagon': 'octagon-exclamation-point',
  'help-circle': 'circle-question-mark',
  'bar-chart': 'chart-column',
  'bar-chart-2': 'chart-no-axes-column',
  'pie-chart': 'chart-pie',
  'line-chart': 'chart-line',
  'more-horizontal': 'ellipsis',
  'more-vertical': 'ellipsis-vertical',
  refresh: 'refresh-cw',
  gear: 'settings',
  person: 'user',
  people: 'users',
  warning: 'triangle-exclamation-point',
});

/** The icon to suggest for `word`: its alias, else the closest name, else null. */
export function suggestIcon(word) {
  const key = String(word).toLowerCase();
  if (Object.hasOwn(ICON_ALIASES, key)) return ICON_ALIASES[key];
  return didYouMean(word, ICON_NAMES);
}
