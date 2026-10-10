import { expect, test } from 'claude-code/testing'
import { formatBand, tally } from '../hooks/band'
import { newRecord } from '../hooks/record'

const rec = {
  ...newRecord('s1', { repo: 'cubby', worktree: '/Users/me/wt/feature-scan', branch: 'feature/scan' }, 0),
  goal: 'barcode fallback',
  step: 'fixing 3 failing tests',
  artifacts: [1, 2, 3, 4].map(i => ({ kind: 'doc' as const, path: `docs/${i}.md`, at: i })),
}
const TESTS = { passed: 412, failed: 3 }

test('wide terminal shows every segment', () => {
  expect(formatBand(rec, TESTS, 200)).toEqual({
    text: 'cubby · wt/feature-scan (feature/scan) · Goal: barcode fallback · Now: fixing 3 failing tests · 4 artifacts · tests 412 ✓ 3 ✗',
    isDim: false,
  })
})
test('narrow drops artifacts, then tests, then shortens the worktree', () => {
  expect(formatBand(rec, TESTS, 110).text).not.toContain('artifacts')
  expect(formatBand(rec, TESTS, 100).text).not.toContain('tests 412')
  expect(formatBand(rec, TESTS, 91).text.startsWith('cubby · feature-scan (feature/scan)')).toBe(true)
})
test('no goal shows the first prompt, marked and dimmed', () => {
  const line = formatBand({ ...rec, goal: undefined, firstPrompt: 'fix the scanner' }, undefined, 200)
  expect(line.text).toContain('Goal: "fix the scanner" (no goal set)')
  expect(line.isDim).toBe(true)
})
test('tally sums parsed runs and ignores unparsed ones', () => {
  expect(tally([{ parsed: true, passed: 10, failed: 1 }, { parsed: false }])).toEqual({ passed: 10, failed: 1 })
  expect(tally(undefined)).toBeUndefined()
})
