import { expect, test } from 'claude-code/testing'
import { formatBand, fullLines, hintLabel, hintReserve, tally, wrapTwo } from '../hooks/band'
import { cellWidth } from '../hooks/cells'
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

const FAMILY = '👨‍👩‍👧'
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const rows = (line: { text: string; second?: string }): string => `${line.text}\n${line.second ?? ''}`

test('cellWidth counts terminal cells: wide and emoji 2, combining and joiners 0', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('✓ ✗ · …')).toBe(7)
  expect(cellWidth('日本語')).toBe(6)
  expect(cellWidth('👍')).toBe(2)
  expect(cellWidth(FAMILY)).toBe(2)
  expect(cellWidth('é')).toBe(1)
  expect(cellWidth('🇯🇵')).toBe(2)
})

test('a CJK goal is measured in cells, so neither line overflows', () => {
  const cjk = { ...rec, goal: '修复条码回退并更新文档'.repeat(5) }
  // An independent count: this text is ASCII and CJK only, and every CJK character is two cells.
  const cells = (s: string): number => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)
  for (const columns of [30, 60, 90]) {
    const line = formatBand(cjk, undefined, columns)
    expect(cells(line.text)).toBeLessThanOrEqual(columns)
    const reserve = line.isCut === true ? hintReserve(columns) : 0
    expect(cells(line.second ?? '') + reserve).toBeLessThanOrEqual(columns)
  }
})

test('an emoji goal is cut on whole emoji: no lone surrogate, no split joiner sequence', () => {
  const emoji = { ...rec, goal: Array.from({ length: 30 }, () => '🚀').join('') }
  const family = { ...rec, goal: `ok ${FAMILY.repeat(25)}` }
  for (const columns of [25, 40, 61]) {
    for (const r of [emoji, family]) {
      const line = formatBand(r, undefined, columns)
      expect(LONE_SURROGATE.test(rows(line))).toBe(false)
      expect(cellWidth(line.text)).toBeLessThanOrEqual(columns)
      expect(cellWidth(line.second ?? '') + (line.isCut === true ? hintReserve(columns) : 0)).toBeLessThanOrEqual(columns)
    }
  }
  const cut = formatBand(family, undefined, 40)
  expect(/[\u{1F468}\u{1F469}\u{1F467}‍]/u.test(rows(cut).replaceAll(FAMILY, ''))).toBe(false)
})

test('a width that is 0, negative, undefined or NaN falls back to a sensible width', () => {
  for (const columns of [0, -5, Number.NaN, undefined as unknown as number]) {
    const line = formatBand(long, TESTS, columns)
    expect(rows(line)).not.toContain('NaN')
    expect(cellWidth(line.text)).toBeGreaterThan(10)
    expect(cellWidth(line.text)).toBeLessThanOrEqual(80)
    expect(cellWidth(line.second ?? '')).toBeLessThanOrEqual(80)
    expect(hintLabel(columns)).toBe('▸ /compass more')
  }
  expect(wrapTwo('x y', Number.NaN)).toEqual({ first: 'x y', isCut: false })
})

test('a long unbroken token fills line one and continues on line two', () => {
  const url = 'https://example.com/a/very/long/path/that/goes/on'
  const wrapped = wrapTwo(`see ${url}`, 30)
  expect(wrapped.first.startsWith('see https://')).toBe(true)
  expect(cellWidth(wrapped.first)).toBeLessThanOrEqual(30)
  expect(`${wrapped.first.slice(4)}${wrapped.second}`).toBe(url)
  expect(wrapped.isCut).toBe(false)
  // A short word still moves whole to the next line.
  expect(wrapTwo('see refresh', 8)).toEqual({ first: 'see', second: 'refresh', isCut: false })
})

test('a warning wider than the band still hints at the full text', () => {
  const line = formatBand(rec, { passed: 0, failed: 0, warnings: 10_000_000 }, 26)
  expect(line.text.startsWith('tests: 10000000 warnings')).toBe(true)
  expect(line.isCut).toBe(true)
  expect(hintLabel(26)).not.toBe('')
})
