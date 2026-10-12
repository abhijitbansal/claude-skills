import { describe, expect, test } from 'claude-code/testing'

import type { TestRun } from '../types'
import { cellWidth, formatAgo, formatClock, formatDuration, joinParts, lineParts, tail } from '../hooks/format'

const H = 3_600_000
const T = new Date(2026, 9, 11, 14, 32).getTime()
const mk = (extra: Partial<TestRun> = {}): TestRun => ({
  suite: 'xcodebuild test -scheme Cubby', key: '/p/Cubby::xcodebuild test -scheme Cubby',
  total: 417, passed: 412, failed: 3, skipped: 2, durationS: 72, failures: [], exitCode: 65,
  at: T, parsed: true, via: 'ios-fixer', ...extra,
})
const prev = mk({ passed: 415, failed: 0, at: T - 2 * H, via: undefined })

describe('lineParts', () => {
  test('full line matches the spec example', () => {
    expect(joinParts(lineParts(mk(), prev, T, 200))).toBe(
      'Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   ▲3 ✗   1m12s   done 14:32   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer')
  })
  test('first run, falling failures', () => {
    expect(lineParts(mk(), undefined, T, 200).prev).toBe('first run')
    expect(lineParts(mk({ failed: 1 }), mk({ failed: 4, at: 1 }), T, 200).trend).toBe('▼3 ✗')
  })
  test('unparsed run', () => {
    expect(lineParts(mk({ parsed: false, exitCode: 1, suite: 'bun test' }), undefined, 0, 200).counts)
      .toBe('ran · exit 1 · counts unavailable')
  })
  test('counts split around the failed segment, unparsed has no split', () => {
    const p = lineParts(mk(), undefined, T, 200)
    expect(p.split).toEqual({ head: '412 ✓  ', failed: '3 ✗', tail: '  2 skip' })
    expect(`${p.split?.head}${p.split?.failed}${p.split?.tail}`).toBe(p.counts)
    expect(lineParts(mk({ parsed: false }), undefined, 0, 200).split).toBeUndefined()
  })
  test('narrow terminal drops via, then prev, then duration, then the finish time', () => {
    const at79 = lineParts(mk(), prev, T, 79)
    expect(at79.via).toBeUndefined()
    expect(joinParts(at79).length <= 79).toBe(true)
    const at60 = lineParts(mk(), prev, T, 60)
    expect([at60.via, at60.prev, at60.duration]).toEqual([undefined, undefined, undefined])
    expect([at79.duration, at79.doneAt]).toEqual([undefined, 'done 14:32'])
    expect(at60.doneAt).toBeUndefined()
  })
  test('a reserve shrinks the fit budget but not the narrow-terminal gate', () => {
    const short = mk({ key: '/p/r::t', suite: 't', via: 'a' })
    const line = joinParts(lineParts(short, undefined, T, 200))
    expect(line.length <= 77).toBe(true)
    expect(lineParts(short, undefined, T, 80, 3).via).toBe('via a')
    const long = mk({ key: '/p/r::t', suite: 't'.repeat(81 - line.length + 1), via: 'a' })
    expect(joinParts(lineParts(long, undefined, T, 200)).length).toBe(81)
    expect(lineParts(long, undefined, T, 81, 0).via).toBe('via a')
    expect(lineParts(long, undefined, T, 81, 1).via).toBeUndefined()
    expect(lineParts(long, undefined, T, 80, 0).via).toBeUndefined()
  })
  test('the fit counts terminal cells, not UTF-16 units', () => {
    const wide = mk({ key: '/p/テスト計画::t', suite: 't', via: undefined })
    const full = joinParts(lineParts(wide, undefined, T, 200))
    expect(cellWidth(full)).toBe(full.length + 5)
    const p = lineParts(wide, undefined, T, full.length)
    expect(p.prev).toBeUndefined()
    expect(cellWidth(joinParts(p)) <= full.length).toBe(true)
  })
})

describe('units', () => {
  test('cell width', () => expect([cellWidth('テスト計画'), cellWidth('412 ✓  3 ✗ · ▲ ✕'), cellWidth('🙂a'), cellWidth('e\u0301')])
    .toEqual([10, 16, 3, 1]))
  test('emoji take two cells', () => expect(['🚀', '✅', '❌', '⚡', '✨', '🟢', '🪲', '🇯🇵', '❤️'].map(cellWidth))
    .toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]))
  test('tail prefixes each present part with the gap', () => expect(tail('a', undefined, 'b')).toBe('   a   b'))
  test('durations', () => expect([formatDuration(9.6), formatDuration(72), formatDuration(61)]).toEqual(['10s', '1m12s', '1m01s']))
  test('clock time', () => expect([formatClock(T), formatClock(new Date(2026, 0, 2, 9, 5).getTime())]).toEqual(['14:32', '09:05']))
  test('ages', () => expect([formatAgo(30_000), formatAgo(5 * 60_000), formatAgo(2 * H), formatAgo(72 * H)])
    .toEqual(['just now', '5m ago', '2h ago', '3d ago']))
})
