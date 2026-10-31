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
  test('an unknown command status with no other issue draws no status segment', () => {
    for (const extra of [{}, { exitCode: null, commandStatus: 'unknown' }]) {
      const parts = lineParts(run(extra), undefined, 0, 120)
      expect(parts.status).toBeUndefined()
      expect(joinParts(parts)).not.toContain('unknown')
    }
  })
  test('a host exit code on a tool error draws as exit N', () => {
    const parts = lineParts(run({ commandStatus: 'tool-error', exitCode: 139 }), undefined, 0, 120)
    expect(parts.isFailing).toBe(true)
    expect(parts.status).toBe('exit 139')
  })
  test('a passing line keeps done and via on an 80-column row', () => {
    const parts = lineParts(run({ exitCode: null, commandStatus: 'unknown', via: 'workflow' }), undefined, 0, 80, 3)
    expect(parts.doneAt).toBeDefined()
    expect(parts.via).toBe('via workflow')
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
  test('summaries in two different formats are conflicting, even when they agree', () => {
    for (const text of [PASS + 'Tests: 1 failed, 1 total\n', 'Tests: 10 passed, 10 total\n10 pass\n0 fail\n']) {
      expect(parseTestOutput({ command: 'npm test', text, exitCode: 0 })).toMatchObject({ parsed: false, countsIssue: 'conflicting' })
    }
  })
  test('repeated pytest summaries are summed', () => {
    expect(parse(PASS + '1 failed in 0.50s\n')).toMatchObject({ parsed: true, total: 11, passed: 10, failed: 1, durationS: 1 })
  })
  test('repeated jest summaries under a monorepo runner are summed', () => {
    const text = 'Tests: 1 failed, 4 passed, 5 total\nTests: 5 passed, 5 total\n'
    expect(parseTestOutput({ command: 'pnpm test', text, exitCode: 0 }))
      .toMatchObject({ parsed: true, total: 10, passed: 9, failed: 1 })
  })
  test('repeated vitest summaries are summed', () => {
    const text = 'Tests  1 failed | 2 passed (3)\nTests  4 passed (4)\n'
    expect(parseTestOutput({ command: 'pnpm test', text, exitCode: 0 }))
      .toMatchObject({ parsed: true, total: 7, passed: 6, failed: 1 })
  })
  test('repeated Swift Testing runs are summed, each keeping its own failures', () => {
    const text = '✘ Test a() failed after 0.1 seconds.\n✘ Test run with 3 tests in 1 suite failed after 0.5 seconds with 1 issue.\n'
      + '✔ Test run with 2 tests in 1 suite passed after 0.2 seconds.\n'
    expect(parseTestOutput({ command: 'xcodebuild -scheme S test', text, exitCode: null }))
      .toMatchObject({ parsed: true, total: 5, passed: 4, failed: 1, durationS: 0.7, failures: [{ id: 'a()' }] })
  })
  test('a multi-destination xcodebuild run never mixes destinations when XCTest and Swift Testing combine', () => {
    const dest = 'Executed 10 tests, with 0 failures (0 unexpected) in 1.000 (1.000) seconds\n'
      + '✔ Test run with 5 tests in 1 suite passed after 0.5 seconds.\n'
    // XCTest repeats nested suite totals, so only the last destination is known; Swift Testing must match it.
    expect(parseTestOutput({ command: 'xcodebuild -scheme S test', text: dest + dest, exitCode: null }))
      .toMatchObject({ parsed: true, total: 15, passed: 15 })
  })
  test('every repeated summary must still pass the impossible-count checks', () => {
    const text = 'Tests: 5 passed, 5 total\nTests: 9 passed, 1 total\n'
    expect(parseTestOutput({ command: 'pnpm test', text, exitCode: 0 })).toMatchObject({ parsed: false, countsIssue: 'invalid' })
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
