import { expect, test } from 'claude-code/testing'
import { formatBand, tally } from '../hooks/band'
import { newRecord } from '../hooks/record'

const rec = { ...newRecord('s', { repo: 'r', worktree: '/r', branch: 'feature' }, 0), goal: 'run the suite' }
const pass = { parsed: true, total: 10, passed: 10, failed: 0, skipped: 0, exitCode: 0, commandStatus: 'exited' }

test('a failed command survives aggregation of passing tests', () => {
  const result = tally([{ ...pass, exitCode: 7 }])
  expect(result).toMatchObject({ passed: 10, failed: 0, warnings: 1 })
  expect(formatBand(rec, result, 120).text).toContain('1 warning')
  expect(formatBand(rec, result, 24).text).toContain('1 warning')
})
test('unparsed and legacy records are not silently dropped', () => {
  expect(tally([{ parsed: false, exitCode: 1 }, { parsed: true, passed: 10, failed: 0 }]))
    .toMatchObject({ warnings: 2 })
})
test('malformed records never contribute passing counts', () => {
  expect(tally([null, 'bad', { ...pass, passed: -1 }, { ...pass, total: 1 }, { ...pass, failed: NaN }]))
    .toMatchObject({ passed: 0, failed: 0, warnings: 5 })
})
test('an interrupted or truncated run remains qualified', () => {
  expect(tally([{ ...pass, commandStatus: 'interrupted' }, { ...pass, outputIncomplete: true }]))
    .toMatchObject({ warnings: 2 })
})
test('fully observed passing controls have no warning', () => {
  expect(tally([pass])).toEqual({ passed: 10, failed: 0, warnings: 0 })
  expect(tally([])).toBeUndefined()
})
test('a clean live run as test-board records it has no warning', () => {
  // The exact shape register.tsx writes for a passing Bash call: the host gives no structured exit code.
  const live = { ...pass, exitCode: null, commandStatus: 'unknown' }
  expect(tally([live])).toEqual({ passed: 10, failed: 0, warnings: 0 })
  expect(formatBand(rec, tally([live]), 120).text).not.toContain('warning')
})
test('failing tests and restored history are not warnings by themselves', () => {
  const live = { ...pass, exitCode: null, commandStatus: 'unknown' }
  expect(tally([{ ...live, passed: 9, failed: 1 }])).toEqual({ passed: 9, failed: 1, warnings: 0 })
  expect(tally([{ ...live, stale: true }])).toEqual({ passed: 10, failed: 0, warnings: 0 })
})
test('a tool error or a reported nonzero exit is a warning', () => {
  expect(tally([{ ...pass, exitCode: null, commandStatus: 'tool-error' }])).toMatchObject({ warnings: 1 })
  expect(tally([{ ...pass, exitCode: 139, commandStatus: 'tool-error' }])).toMatchObject({ warnings: 1 })
  expect(tally([{ ...pass, exitCode: null, commandStatus: 'unknown', countsIssue: 'conflicting', parsed: false }]))
    .toMatchObject({ warnings: 1 })
})
