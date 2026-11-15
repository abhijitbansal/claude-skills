// Terminal cell widths and grapheme-safe cutting, with no dependency. Pure, no `$`.
// Approximate on purpose: East Asian wide and fullwidth forms and emoji take 2 cells,
// combining marks and joiners 0, everything else 1. An over-estimate only costs a cell.

const inRange = (c: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([lo, hi]) => c >= lo && c <= hi)

// Marks that attach to the character before them: they never start a cluster.
const EXTEND: readonly (readonly [number, number])[] = [
  [0x300, 0x36f], [0x483, 0x489], [0x591, 0x5bd], [0x610, 0x61a], [0x64b, 0x65f], [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
  [0x1f3fb, 0x1f3ff], [0xe0020, 0xe007f],
]
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f000, 0x1faff], [0x20000, 0x3fffd],
]
const ZWJ = 0x200d
const VARIATION_EMOJI = 0xfe0f
const REGIONAL: readonly [number, number] = [0x1f1e6, 0x1f1ff]

const isExtend = (c: number): boolean => inRange(c, EXTEND)
const isRegional = (c: number): boolean => c >= REGIONAL[0] && c <= REGIONAL[1]

// Splits text into clusters a terminal draws as one unit: a character with its marks, a
// joiner sequence (a family emoji), or a pair of regional indicators (a flag). Never splits a surrogate pair.
export function clusters(text: string): string[] {
  const out: string[] = []
  let isJoining = false
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const last = out.length - 1
    const lastIsLoneFlag = last >= 0 && [...(out[last] ?? '')].length === 1 && isRegional((out[last] ?? '').codePointAt(0) ?? 0)
    if (last >= 0 && (isExtend(c) || isJoining || (isRegional(c) && lastIsLoneFlag))) {
      out[last] += ch
      isJoining = c === ZWJ
    } else {
      out.push(ch)
      isJoining = false
    }
  }
  return out
}

function clusterWidth(cluster: string): number {
  const points = [...cluster].map(ch => ch.codePointAt(0) ?? 0)
  const first = points[0] ?? 0
  if (isExtend(first)) return 0
  if (points.includes(VARIATION_EMOJI) || isRegional(first)) return 2
  return inRange(first, WIDE) ? 2 : 1
}

export function cellWidth(text: string): number {
  return clusters(text).reduce((sum, c) => sum + clusterWidth(c), 0)
}

// The longest prefix of `text` that fits `max` cells, cut between clusters, and the rest.
// With `isForced` a first cluster wider than `max` is still taken, so a caller always makes progress.
export function sliceCells(text: string, max: number, isForced = false): { head: string; tail: string } {
  const parts = clusters(text)
  let used = 0
  let count = 0
  for (const part of parts) {
    const w = clusterWidth(part)
    if (used + w > max) break
    used += w
    count += 1
  }
  if (count === 0 && isForced && parts.length > 0) count = 1
  return { head: parts.slice(0, count).join(''), tail: parts.slice(count).join('') }
}
