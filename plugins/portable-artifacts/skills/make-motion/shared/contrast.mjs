// WCAG 2.x contrast maths and the theme rules every shipped theme must pass.
// Categorical colours are NOT gated here: the dataviz relief rule applies
// (legend + Table view on every card); they are validated per theme surface
// with the dataviz palette validator when a theme changes.

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['text', 'text2', 'text3'];
const UI = ['accent', 'warn', 'good', 'bad'];
const SEQ = ['seq1', 'seq2', 'seq3', 'seq4', 'seq5', 'seq6', 'seq7'];
const fmt = (r) => `${r.toFixed(2)}:1`;

export function checkTheme(theme) {
  const errors = [];
  for (const mode of ['light', 'dark']) {
    const t = theme[mode];
    for (const k of TEXT) {
      for (const bg of ['page', 'surface']) {
        const r = contrastRatio(t[k], t[bg]);
        if (r < 4.5) errors.push({ path: `${mode}.${k}`, message: `${t[k]} is ${fmt(r)} against ${bg}; needs 4.5:1` });
      }
    }
    for (const k of UI) {
      const r = contrastRatio(t[k], t.surface);
      if (r < 3) errors.push({ path: `${mode}.${k}`, message: `${t[k]} is ${fmt(r)} against surface; needs 3:1` });
    }
    const ramp = SEQ.map((k) => contrastRatio(t[k], t.surface));
    if (ramp.some((r, i) => i > 0 && r <= ramp[i - 1])) {
      errors.push({ path: `${mode}.seq`, message: `seq1..seq7 must get stronger against surface at every step (got ${ramp.map(fmt).join(', ')})` });
    }
    if (ramp[6] < 3) errors.push({ path: `${mode}.seq7`, message: `${t.seq7} is ${fmt(ramp[6])} against surface; needs 3:1` });
  }
  return errors;
}
