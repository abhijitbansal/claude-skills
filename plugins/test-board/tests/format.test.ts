import { describe, expect, test } from 'claude-code/testing'

import type { TestRun } from '../types'
import { formatAgo, formatClock, formatDuration, joinParts, lineParts } from '../hooks/format'

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
      'Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   ▲3 ✗   1m12s   ran 14:32   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer')
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
  test('narrow terminal drops via, then prev, then duration, then the run time', () => {
    const at79 = lineParts(mk(), prev, T, 79)
    expect(at79.via).toBeUndefined()
    expect(joinParts(at79).length <= 79).toBe(true)
    const at60 = lineParts(mk(), prev, T, 60)
    expect([at60.via, at60.prev, at60.duration]).toEqual([undefined, undefined, undefined])
    expect([at79.duration, at79.ranAt]).toEqual([undefined, 'ran 14:32'])
    expect(at60.ranAt).toBeUndefined()
  })
})

describe('units', () => {
  test('durations', () => expect([formatDuration(9.6), formatDuration(72), formatDuration(61)]).toEqual(['10s', '1m12s', '1m01s']))
  test('clock time', () => expect([formatClock(T), formatClock(new Date(2026, 0, 2, 9, 5).getTime())]).toEqual(['14:32', '09:05']))
  test('ages', () => expect([formatAgo(30_000), formatAgo(5 * 60_000), formatAgo(2 * H), formatAgo(72 * H)])
    .toEqual(['just now', '5m ago', '2h ago', '3d ago']))
})
