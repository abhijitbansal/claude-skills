// How a counter prints a value (the page calls this on every frame): prefix, the number to `decimals` digits, suffix. With
// `group` the integer part gets a comma every three digits (48,200). The comma is written here, not by Intl, so the
// same value prints the same bytes on every machine whatever its locale; rounding stays toFixed's, as without `group`.
const GROUP_AT = /\B(?=(\d{3})+(?!\d))/g;

export function formatCounter(value, { prefix = '', suffix = '', decimals = 0, group = false } = {}) {
  const fixed = value.toFixed(decimals);
  if (!group) return `${prefix}${fixed}${suffix}`;
  const [whole, fraction] = fixed.split('.');
  return `${prefix}${whole.replace(GROUP_AT, ',')}${fraction === undefined ? '' : `.${fraction}`}${suffix}`;
}
