import { expect, test } from 'claude-code/testing'
import { parseTestOutput } from '../hooks/parse'

// Current Cartoon report shape, confirmed against its real CLI in tests/compat.
const SUMMARY = 'runner: pytest\nsummary:\n  total: 2\n  passed: 1\n  failed: 1\n  skipped: 0\n  duration_s: 0.01\n'
const RAW_PASS = '2 passed in 0.01s\n'
const parse = (text: string) => parseTestOutput({ command: 'pytest', text, exitCode: null })

test('current Cartoon counts and failure locations are retained without inventing exit zero', () => {
  expect(parse(SUMMARY + 'failures[1]{id,loc,msg}:\n  synthetic.two,test_two.py:5,synthetic failure\nexit_code: 0\n'))
    .toMatchObject({ parsed: true, total: 2, passed: 1, failed: 1, skipped: 0, durationS: 0.01,
      failures: [{ id: 'synthetic.two', loc: 'test_two.py:5' }], exitCode: null, commandStatus: 'unknown' })
})

test('current Cartoon supports reordered fields, CRLF and finite scientific durations', () => {
  const text = 'runner: pytest\r\nsummary:\r\n  duration_s: 1e-7\r\n  skipped: 0\r\n  failed: 0\r\n  passed: 2\r\n  total: 2\r\n'
  expect(parse(text)).toMatchObject({ parsed: true, total: 2, passed: 2, failed: 0, durationS: 1e-7 })
})

test('current Cartoon summary remains usable for wrapped commands without a known runner', () => {
  expect(parseTestOutput({ command: './custom-runner', text: SUMMARY, exitCode: 7 }))
    .toMatchObject({ parsed: true, failed: 1, exitCode: 7 })
})

test('duplicate current or mixed legacy/current summaries are conflicting', () => {
  for (const text of [SUMMARY + SUMMARY,
    SUMMARY + 'summary{total,passed,failed,skipped,duration_s}: 2,1,1,0,0.01\n']) {
    expect(parse(text)).toMatchObject({ parsed: false, countsIssue: 'conflicting' })
  }
})

test('raw and current Cartoon summaries cannot be silently combined', () => {
  expect(parse(SUMMARY + RAW_PASS)).toMatchObject({ parsed: false, countsIssue: 'conflicting' })
})

test('missing fields cannot be completed from a later report section or raw summary', () => {
  for (const field of ['total: 2', 'passed: 1', 'failed: 1', 'skipped: 0', 'duration_s: 0.01']) {
    const incomplete = SUMMARY.replace(`  ${field}\n`, '')
    expect(parse(incomplete + `traces:\n  ${field}\n` + RAW_PASS))
      .toMatchObject({ parsed: false, countsIssue: 'invalid' })
  }
})

test('duplicate fields, extra fields and malformed indentation are invalid', () => {
  for (const text of [SUMMARY + '  failed: 0\n', SUMMARY + '\n  failed: 0\n',
    SUMMARY + '  extra: 1\n', SUMMARY.replace('  failed:', '\tfailed:'),
    SUMMARY.replace('  failed:', '    failed:'), SUMMARY.replace('summary:', 'summary: garbage')]) {
    expect(parse(text + RAW_PASS)).toMatchObject({ parsed: false, countsIssue: 'invalid' })
  }
})

test('current Cartoon rejects unsafe numbers, impossible totals and invalid durations', () => {
  for (const text of [SUMMARY.replace('total: 2', 'total: 1'),
    SUMMARY.replace('total: 2', 'total: 9007199254740993'),
    SUMMARY.replace('failed: 1', 'failed: -1'), SUMMARY.replace('failed: 1', 'failed: 1.5'),
    SUMMARY.replace('failed: 1', 'failed: "1"'), SUMMARY.replace('duration_s: 0.01', 'duration_s: 1e309'),
    SUMMARY.replace('duration_s: 0.01', 'duration_s: NaN'),
    SUMMARY.replace('duration_s: 0.01', 'duration_s: 0.1.2')]) {
    expect(parse(text + RAW_PASS)).toMatchObject({ parsed: false, countsIssue: 'invalid' })
  }
})

test('a truncated summary stays invalid and retains incomplete-output evidence', () => {
  expect(parseTestOutput({ command: 'pytest', text: SUMMARY.slice(0, -3), exitCode: null, outputIncomplete: true }))
    .toMatchObject({ parsed: false, countsIssue: 'invalid', outputIncomplete: true })
})

test('indented quoted summaries are not counted as a second top-level report', () => {
  expect(parse(SUMMARY + 'traces:\n  quoted:\n    summary:\n      passed: 999\n'))
    .toMatchObject({ parsed: true, passed: 1, failed: 1 })
})

test('an ordinary summary heading is not a Cartoon format claim', () => {
  expect(parse('summary:\n  ordinary test commentary\n' + RAW_PASS))
    .toMatchObject({ parsed: true, passed: 2, failed: 0 })
})

test('Cartoon acceleration metadata does not hide its summary', () => {
  expect(parse(SUMMARY.replace('runner: pytest\n', 'runner: pytest\nfast: "-n auto"\n')))
    .toMatchObject({ parsed: true, passed: 1, failed: 1 })
})
