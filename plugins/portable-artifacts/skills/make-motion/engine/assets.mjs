// Which files a shot names: the strings its kind's srcFields hold in the shot (a field may hold one string or an
// array of them), in srcFields order. A srcFields entry is a field name ("src") or a dotted path into the shot
// ("left.src"), so a kind can name a picture inside an object field. The server numbers every shot's srcs through the
// film in this order (/asset/<n>) and the stage uses the same list to match each src string to its served file, so a
// request never names a path. Pure and DOM-free.

/** The value at a srcFields entry ("src" or a dotted path such as "left.src") in `shot`, or undefined. */
export function fieldAt(shot, field) {
  return field.split('.').reduce((value, key) => (value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined), shot);
}

export function srcsOfShot(shot, srcFields = []) {
  return srcFields.flatMap((field) => {
    const value = fieldAt(shot, field);
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  });
}
