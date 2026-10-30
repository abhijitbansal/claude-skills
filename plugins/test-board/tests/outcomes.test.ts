import { describe, expect, test } from 'claude-code/testing'
import { joinParts, lineParts } from '../hooks/format'
import { parseTestOutput } from '../hooks/parse'
import type { TestRun } from '../types'

const PASS = '10 passed in 0.50s\n'
const parse = (text: string, exitCode = 0) => parseTestOutput({ command: 'pytest', text, exitCode })
const run = (extra: Record<string, unknown> = {}): TestRun => ({
  suite: 'pytest', key: '/repo::pytest', total: 10, passed: 10, failed: 0, skipped: 0,
  failures: [], at: 0, parsed: true, exitCode: 0, ...extra,
})

describe('command evidence', () => {
  test('passing counts do not hide a failed command', () => {
    const parts = lineParts(run({ exitCode: 7 }), undefined, 0, 120)
    expect(parts.isFailing).toBe(true)
    expect(joinParts(parts)).toContain('exit 7')
  })
  test('failing tests remain failures with a zero exit', () => {
    expect(lineParts(run({ passed: 9, failed: 1 }), undefined, 0, 120).isFailing).toBe(true)
  })
  test('legacy zero exits are not newly verified command success', () => {
    expect(joinParts(lineParts(run(), undefined, 0, 120))).toContain('command status unknown')
  })
  test('tool errors and interruptions survive a passing parse', () => {
    for (const commandStatus of ['tool-error', 'interrupted']) {
      const parts = lineParts(run({ commandStatus, exitCode: null }), undefined, 0, 120)
      expect(parts.isFailing).toBe(true)
      expect(joinParts(parts)).toContain(commandStatus === 'tool-error' ? 'tool error' : 'interrupted')
    }
  })
  test('warnings survive a narrow display', () => {
    const parts = lineParts(run({ exitCode: 7, via: 'worker' }), undefined, 0, 35)
    expect(joinParts(parts)).toContain('exit 7')
    expect(parts.via).toBeUndefined()
  })
  test('a confirmed zero exit and valid summary is an ordinary passing control', () => {
    const parsed = parse(PASS)
    expect(parsed).toMatchObject({ parsed: true, passed: 10, commandStatus: 'exited' })
    const parts = lineParts(run(parsed ?? {}), undefined, 0, 120)
    expect(parts.isFailing).toBe(false)
    expect(joinParts(parts)).not.toContain('unknown')
  })
})

describe('summary evidence', () => {
  test('impossible cartoon totals are invalid, not passing', () => {
    expect(parse('summary{total,passed,failed,skipped,duration_s}: 1,10,0,0,0.5'))
      .toMatchObject({ parsed: false, countsIssue: 'invalid' })
  })
  test('invalid higher-priority evidence cannot fall through to a green raw summary', () => {
    expect(parse('summary{total,passed,failed,skipped,duration_s}: 1,10,0,0,0.5\n' + PASS))
      .toMatchObject({ parsed: false, countsIssue: 'invalid' })
  })
  test('contradictory and duplicate top-level summaries are ambiguous', () => {
    for (const text of [PASS + '1 failed in 0.50s\n', PASS + PASS]) {
      expect(parse(text)).toMatchObject({ parsed: false, countsIssue: 'conflicting' })
    }
  })
  test('conflicting cartoon summaries cannot use the first pass', () => {
    expect(parse('summary{total,passed,failed,skipped,duration_s}: 1,1,0,0,0.5\n' +
      'summary{total,passed,failed,skipped,duration_s}: 1,0,1,0,0.5\n'))
      .toMatchObject({ parsed: false, countsIssue: 'conflicting' })
  })
  test('mixed JavaScript summaries and repeated bun failure counts are conflicting', () => {
    for (const text of [
      'Tests: 10 passed, 10 total\nTests 1 failed (1)\n',
      '10 pass\n0 fail\n1 fail\n',
      '10 pass\n0 fail\n0 skip\n1 skip\n',
    ]) expect(parseTestOutput({ command: 'npm test', text, exitCode: 0 }))
      .toMatchObject({ parsed: false, countsIssue: 'conflicting' })
  })
  test('invalid numbers and malformed durations do not earn a parsed result', () => {
    for (const text of [
      'summary{total,passed,failed,skipped,duration_s}: 9007199254740993,9007199254740993,0,0,0.5',
      'summary{total,passed,failed,skipped,duration_s}: 1,1,0,0,0.5.1',
      'summary{total,passed,failed,skipped,duration_s}: -1,1,0,0,0.5',
    ]) expect(parse(text)).toMatchObject({ parsed: false, countsIssue: 'invalid' })
  })
  test('missing counts stay visibly unavailable', () => {
    const parts = lineParts(run(parse('') ?? {}), undefined, 0, 120)
    expect(joinParts(parts)).toContain('counts unavailable')
  })
})
