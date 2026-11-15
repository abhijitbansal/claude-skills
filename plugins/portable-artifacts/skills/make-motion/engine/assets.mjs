// Which files a shot names: the strings its kind's srcFields hold in the shot (a field may hold one string or an
// array of them), in srcFields order. The server numbers every shot's srcs through the film in this order
// (/asset/<n>) and the stage uses the same list to match each src string to its served file, so a request
// never names a path. Pure and DOM-free.
export function srcsOfShot(shot, srcFields = []) {
  return srcFields.flatMap((field) => {
    const value = shot[field];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  });
}
