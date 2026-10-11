import { describe, expect, test } from 'claude-code/testing'

import type { TestRun } from '../types'
import { appendRun, BAND_TTL_MS, keysToDrop, oldestQuarter, previousRun, touchIndex, visibleRuns } from '../hooks/history'

const mk = (at: number, extra: Partial<TestRun> = {}): TestRun => ({
  suite: 'pytest -q', key: '/r::pytest -q', total: 1, passed: 1, failed: 0, skipped: 0,
  failures: [], exitCode: 0, at, parsed: true, ...extra,
})

describe('appendRun', () => {
  test('newest first, capped at 10', () => {
    let h: TestRun[] = []
    for (let at = 1; at <= 12; at += 1) h = appendRun(h, mk(at))
    expect(h.map(r => r.at)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  })
  test('caps failures at 20 and never stores stale', () => {
    const failures = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }))
    const [stored] = appendRun([], mk(1, { failures, stale: true }))
    expect(stored?.failures).toHaveLength(20)
    expect(stored?.stale).toBeUndefined()
  })
})

describe('previousRun', () => {
  test('the newest run older than this one', () => {
    const h = [mk(30), mk(20), mk(10)]
    expect(previousRun(h, mk(30))?.at).toBe(20)
    expect(previousRun([mk(30)], mk(30))).toBeUndefined()
  })
})

describe('visibleRuns', () => {
  test('hides runs an hour old or older', () => {
    const now = 10 * BAND_TTL_MS
    expect(visibleRuns([mk(now - BAND_TTL_MS + 1), mk(now - BAND_TTL_MS)], now, 0).map(r => r.at))
      .toEqual([now - BAND_TTL_MS + 1])
  })
  test('hides runs at or before the last close', () => {
    expect(visibleRuns([mk(30), mk(20), mk(10)], 40, 20).map(r => r.at)).toEqual([30])
  })
})

describe('index and trimming', () => {
  test('touchIndex moves the key to the front once', () => {
    expect(touchIndex(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(touchIndex([], 'a')).toEqual(['a'])
  })
  test('keysToDrop drops oldest until under the cap, never the kept key', () => {
    const sizes = [{ key: 'new', bytes: 5 }, { key: 'mid', bytes: 5 }, { key: 'old', bytes: 5 }]
    expect(keysToDrop(sizes, 10, 'new')).toEqual(['old'])
    expect(keysToDrop(sizes, 4, 'new')).toEqual(['old', 'mid'])
    expect(keysToDrop(sizes, 100, 'new')).toEqual([])
  })
  test('oldestQuarter drops at least one, never the kept key', () => {
    expect(oldestQuarter(['k', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], 'k')).toEqual(['f', 'g'])
    expect(oldestQuarter(['k', 'a'], 'k')).toEqual(['a'])
  })
})
