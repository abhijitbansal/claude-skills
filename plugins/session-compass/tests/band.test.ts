import { expect, test } from 'claude-code/testing'
import { cellWidth, formatBand, tally } from '../hooks/band'
import { newRecord } from '../hooks/record'

const rec = {
  ...newRecord('s1', { repo: 'cubby', worktree: '/Users/me/wt/feature-scan', branch: 'feature/scan' }, 0),
  goal: 'barcode fallback',
  step: 'fixing 3 failing tests',
  artifacts: [1, 2, 3, 4].map(i => ({ kind: 'doc' as const, path: `docs/${i}.md`, at: i })),
}
const TESTS = { passed: 412, failed: 3 }
const PASSING = { passed: 412, failed: 0 }
const run = { parsed: true, total: 10, passed: 9, failed: 1, skipped: 0, exitCode: null, commandStatus: 'unknown' }

test('wide terminal shows every segment, the failing tests first', () => {
  expect(formatBand(rec, TESTS, 200)).toEqual({
    text: 'tests 412 ✓ 3 ✗ · cubby · wt/feature-scan (feature/scan) · Goal: barcode fallback · Now: fixing 3 failing tests · 4 artifacts',
    isDim: false,
  })
})
test('a passing tally stays at the end of the line', () => {
  expect(formatBand(rec, PASSING, 200).text).toBe(
    'cubby · wt/feature-scan (feature/scan) · Goal: barcode fallback · Now: fixing 3 failing tests · 4 artifacts · tests 412 ✓ 0 ✗',
  )
})
test('narrow drops artifacts, then tests, then shortens the worktree', () => {
  expect(formatBand(rec, PASSING, 110).text).not.toContain('artifacts')
  expect(formatBand(rec, PASSING, 100).text).not.toContain('tests 412')
  expect(formatBand(rec, PASSING, 91).text.startsWith('cubby · feature-scan (feature/scan)')).toBe(true)
})
test('a narrow terminal keeps the failed count', () => {
  for (const columns of [120, 100, 60, 30]) expect(formatBand(rec, TESTS, columns).text).toContain('3 ✗')
})
test('no goal shows the first prompt, marked and dimmed', () => {
  const line = formatBand({ ...rec, goal: undefined, firstPrompt: 'fix the scanner' }, undefined, 200)
  expect(line.text).toContain('Goal: "fix the scanner" (no goal set)')
  expect(line.isDim).toBe(true)
})
test('an empty branch draws no empty parentheses', () => {
  const text = formatBand({ ...rec, branch: '' }, undefined, 200).text
  expect(text).not.toContain('()')
  expect(text.startsWith('cubby · wt/feature-scan · Goal')).toBe(true)
})
test('the fit counts terminal cells, not string length', () => {
  const wide = { ...rec, goal: '漢字'.repeat(20) }
  for (const columns of [120, 90, 60]) expect(cellWidth(formatBand(wide, undefined, columns).text)).toBeLessThanOrEqual(columns)
})
test('tally sums valid counts and retains uncertainty about unparsed runs', () => {
  expect(tally([{ parsed: true, total: 11, passed: 10, failed: 1, skipped: 0, exitCode: 1, commandStatus: 'exited' }, { parsed: false }]))
    .toEqual({ passed: 10, failed: 1, warnings: 2 })
  expect(tally(undefined)).toBeUndefined()
})
test('tally skips stale runs restored from history', () => {
  expect(tally([{ ...run, stale: true }])).toBeUndefined()
  expect(tally([run, { ...run, failed: 5, passed: 5, stale: true }])).toEqual({ passed: 9, failed: 1, warnings: 0 })
})
