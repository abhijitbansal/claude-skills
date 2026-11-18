// A seeded random source for the v2 engine, so anything built from it is the same every time. Browser-safe and
// DOM-free. The same 32-bit generator and output as version 1's template/seeded.mjs (deleted at cut-over; test/v2/seeded.test.mjs
// holds the numbers it drew, recorded before the delete).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
