// Places n things on a ring in the xz plane so that neighbours are `spacing`
// apart (chord length). One thing sits on the origin. `angle` points outward.

/** [{ x, z, angle }] for n slots, slot 0 on the +x axis, going round in order. */
export function ringSlots(n, spacing) {
  const radius = n < 2 ? 0 : spacing / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle), angle };
  });
}
