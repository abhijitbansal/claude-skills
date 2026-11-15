import { expect, test } from 'claude-code/testing'
import { formatBand, fullLines, hintLabel, hintReserve, tally, wrapTwo } from '../hooks/band'
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
test('tally sums valid counts and retains uncertainty about unparsed runs', () => {
  expect(tally([{ parsed: true, total: 11, passed: 10, failed: 1, skipped: 0, exitCode: 1, commandStatus: 'exited' }, { parsed: false }]))
    .toEqual({ passed: 10, failed: 1, warnings: 2 })
  expect(tally(undefined)).toBeUndefined()
})

const LONG_GOAL = 'portable-artifacts 2.0: make-motion v2 spec, refresh other plugins, update docs'
const long = { ...rec, goal: LONG_GOAL, step: 'wrapping the band onto a second line' }
const fullText = formatBand(long, TESTS, 10_000).text

test('a goal that fits on one line keeps one line and no second row', () => {
  const line = formatBand(rec, TESTS, 200)
  expect(line.second).toBeUndefined()
  expect(line.isCut).toBeUndefined()
})

test('a goal that needs two lines wraps at a word boundary and loses nothing', () => {
  const columns = Math.ceil(fullText.length * 0.6)
  const line = formatBand(long, TESTS, columns)
  expect(line.second).toBeDefined()
  expect(line.isCut).toBeUndefined()
  expect(line.text.length).toBeLessThanOrEqual(columns)
  expect((line.second ?? '').length).toBeLessThanOrEqual(columns)
  // Line one is a prefix that stops at a space; line two is the whole remainder.
  expect(fullText.startsWith(`${line.text} `)).toBe(true)
  expect(fullText.endsWith(line.second ?? '?')).toBe(true)
  expect(`${line.text} ${line.second}`).toContain(LONG_GOAL.split(' ').slice(0, 3).join(' '))
})

test('a break that lands on a separator drops the dangling dot', () => {
  const { first, second } = wrapTwo('alpha beta · gamma delta', 11)
  expect(first).toBe('alpha beta')
  expect(second).toBe('gamma delta')
  expect(wrapTwo('alpha beta · gamma', 12)).toEqual({ first: 'alpha beta', second: 'gamma', isCut: false })
})

test('a goal too long for two lines ends in an ellipsis on line two only', () => {
  const huge = { ...rec, goal: Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') }
  const columns = 60
  const line = formatBand(huge, undefined, columns)
  expect(line.isCut).toBe(true)
  expect(line.text).not.toContain('…')
  expect(line.text.length).toBeLessThanOrEqual(columns)
  expect(line.second?.endsWith('…')).toBe(true)
  expect(line.second?.slice(0, -1)).not.toContain('…')
  // Room is kept on line two for the hint that opens the full text.
  expect((line.second ?? '').length + hintReserve(columns)).toBeLessThanOrEqual(columns)
})

test('narrow widths never overflow a line, and a word wider than the line is broken', () => {
  for (const columns of [5, 12, 20, 24, 30, 45]) {
    const line = formatBand(long, TESTS, columns)
    expect(line.text.length).toBeLessThanOrEqual(columns)
    const reserve = line.isCut === true ? hintReserve(columns) : 0
    expect((line.second ?? '').length + reserve).toBeLessThanOrEqual(columns)
  }
  expect(wrapTwo('abcdefghij tail', 4)).toEqual({ first: 'abcd', second: 'efg…', isCut: true })
  expect(hintLabel(20)).toBe('')
  expect(hintLabel(30)).toBe('▸ more')
  expect(hintLabel(80)).toBe('▸ /compass more')
})

test('the warning stays first on line one when the band wraps', () => {
  const line = formatBand(long, { passed: 1, failed: 0, warnings: 1 }, 60)
  expect(line.text.startsWith('tests: 1 warning · ')).toBe(true)
})

test('fullLines carries every character of goal, step and next', () => {
  const all = { ...long, next: 'run the tests and update README and docs, then hand off' }
  expect(fullLines(all)).toEqual([
    'cubby · /Users/me/wt/feature-scan (feature/scan)',
    `Goal: ${LONG_GOAL}`,
    'Now: wrapping the band onto a second line',
    'Next: run the tests and update README and docs, then hand off',
  ])
  expect(fullLines({ ...rec, goal: undefined, step: undefined, firstPrompt: 'fix it' })[1])
    .toBe('Goal: "fix it" (no goal set)')
})
