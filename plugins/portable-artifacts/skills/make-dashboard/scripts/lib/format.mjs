// A cell or KPI value as text, in one of the dashboard formats (number, currency, percent, compact).
export function formatValue(value, format) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  const abs = Math.abs(value);
  const opts = {
    currency: { style: 'currency', currency: 'USD', maximumFractionDigits: abs >= 1000 ? 0 : 2 },
    percent: { style: 'percent', maximumFractionDigits: 1 },
    // three significant digits, like the axis's d3 '.3~s' (views.mjs rewrites its G and k to B and K)
    compact: { notation: 'compact', maximumSignificantDigits: 3 },
  }[format] ?? { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', opts).format(value);
}
