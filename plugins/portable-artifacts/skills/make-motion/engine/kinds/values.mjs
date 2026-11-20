// The numbers the kinds show (number, compare, chart): the largest magnitude a value may have, the decimals a value is
// shown with (from the number itself, never its string, which may be in exponent form), and the rule that refuses a
// value that would be labelled 0 without being 0. Pure and DOM-free.

/** Larger figures lose integer precision and no layout holds them (schema bound, exclusive). */
export const VALUE_LIMIT = 1e15;
/** The most decimals a value is shown with. */
export const MAX_DECIMALS = 3;

/** A number field bounded by VALUE_LIMIT either way. */
export const VALUE_SCHEMA = Object.freeze({ type: 'number', exclusiveMinimum: -VALUE_LIMIT, exclusiveMaximum: VALUE_LIMIT });

/** The fewest decimals (at most `max`) that show `value` exactly; `max` when none does (1e-7, 0.1 + 0.2). */
export function shownDecimals(value, max = MAX_DECIMALS) {
  if (!Number.isFinite(value)) return 0;
  for (let d = 0; d < max; d++) if (Number(value.toFixed(d)) === value) return d;
  return max;
}

/** Would `value`, shown as `text`, read as 0 without being 0? */
export const showsAsZero = (value, text) => value !== 0 && Number.isFinite(value) && Number(text.replace(/[^\d.-]/g, '')) === 0;

/** The refusal for such a value, `hint` saying where its scale goes. */
export const zeroMessage = (value, text, hint) => `${value} would show as "${text}" (at most ${MAX_DECIMALS} decimals): scale it and ${hint}`;
