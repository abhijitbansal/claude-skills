// The `list` kind's items as its compositions read them (list.mjs, list-desk.mjs, list-pop.mjs). Pure and DOM-free.

/** The items as { text, note } (note null when absent). */
export const itemsOf = (shot) => shot.items.map((item) => (typeof item === 'string' ? { text: item, note: null } : { text: item.text, note: item.note ?? null }));

/** Are the items numbered (figures in desk, "STEP" on the count in pop for steps)? With `numbered`, or always for steps. */
export const isNumbered = (shot) => shot.numbered === true || shot.style === 'steps';
