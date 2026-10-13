// A cell or KPI value as text, in one of the dashboard formats (number, currency, percent, compact).
export function formatValue(value, format) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  const abs = Math.abs(value);
  const opts = {
    currency: { style: 'currency', currency: 'USD', maximumFractionDigits: abs >= 1000 ? 0 : 2 },
    percent: { style: 'percent', maximumFractionDigits: 1 },
    compact: { notation: 'compact', maximumFractionDigits: 1 },
  }[format] ?? { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', opts).format(value);
}
