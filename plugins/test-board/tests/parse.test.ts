import { describe, expect, test } from 'claude-code/testing'

import { isTestCommand, parseTestOutput } from '../hooks/parse'
import {
  BUN_RAW, CARTOON_PYTEST, JEST_ALL_FAIL, JEST_RAW, JEST_TODO, LS_OUTPUT, PYTEST_RAW, PYTEST_REAL,
  SWIFT_TEST_REAL, SWIFT_TESTING_RAW, SWIFT_TESTING_SUITES, SWIFT_WITH_EMPTY_XCTEST,
  VITEST_ALL_FAIL, VITEST_ORDER, VITEST_RAW, XCODEBUILD_MANY_ASSERTS, XCODEBUILD_NO_IDS, XCODEBUILD_RAW,
} from './fixtures/output'

const run = (command: string, text: string, exitCode = 1) => parseTestOutput({ command, text, exitCode })

describe('readers', () => {
  test('cartoon summary, any command', () => {
    expect(run('make check', CARTOON_PYTEST)).toEqual({
      total: 13, passed: 10, failed: 2, skipped: 1, durationS: 3.21, exitCode: 1, parsed: true,
      failures: [
        { id: 'tests/test_a.py::test_x', loc: 'tests/test_a.py:12' },
        { id: 'tests/test_b.py::test_y', loc: 'tests/test_b.py:40' },
      ],
    })
  })
  test('xcodebuild uses the last Executed line and maps failure locations', () => {
    expect(run('xcodebuild test -scheme Cubby', XCODEBUILD_RAW)).toEqual({
      total: 415, passed: 412, failed: 1, skipped: 2, durationS: 71.9, exitCode: 1, parsed: true,
      failures: [{
        id: 'CubbyTests.ScanTests.testBarcode',
        loc: '/Users/x/Cubby/CubbyTests/ScanTests.swift:42',
      }],
    })
  })
  test('swift-testing run line', () => {
    expect(run('swift test', SWIFT_TESTING_RAW)).toMatchObject({
      total: 12, failed: 1, passed: 11, skipped: 0, durationS: 0.5, failures: [{ id: 'parsesDate()' }],
    })
  })
  test('pytest final line', () => {
    expect(run('pytest -q', PYTEST_RAW)).toMatchObject({
      total: 13, passed: 10, failed: 1, skipped: 2, durationS: 3.5,
      failures: [{ id: 'tests/test_a.py::test_x' }],
    })
  })
  test('real pytest -q output (no = banner)', () => {
    expect(run('pytest .scratch/session-mods-probe/pyfail -q', PYTEST_REAL)).toMatchObject({
      total: 44, passed: 40, failed: 3, skipped: 1, durationS: 0.02, parsed: true,
    })
  })
  test('jest', () => expect(run('npx jest', JEST_RAW)).toMatchObject({ total: 13, passed: 10, failed: 1, skipped: 2 }))
  test('vitest', () => expect(run('vitest run', VITEST_RAW)).toMatchObject({ total: 10, passed: 9, failed: 1, skipped: 0 }))
  test('bun', () => expect(run('bun test', BUN_RAW)).toMatchObject({
    total: 12, passed: 9, failed: 1, skipped: 2, failures: [{ id: 'math > adds' }],
  }))
})

describe('fix round 1', () => {
  test('xcode failures are assertions: failed = distinct failed ids', () => {
    expect(run('xcodebuild test', XCODEBUILD_MANY_ASSERTS)).toMatchObject({ total: 1, failed: 1, passed: 0 })
  })
  test('xcode without ids clamps failed to total', () => {
    expect(run('xcodebuild test', XCODEBUILD_NO_IDS)).toMatchObject({ total: 2, failed: 2, passed: 0 })
  })
  test('empty XCTest line does not shadow swift-testing', () => {
    expect(run('swift test', SWIFT_WITH_EMPTY_XCTEST)).toMatchObject({ total: 12, failed: 1, passed: 11 })
  })
  test('swift-testing run line with suites', () => {
    expect(run('swift test', SWIFT_TESTING_SUITES)).toMatchObject({ total: 12, failed: 0, passed: 12, durationS: 0.5 })
  })
  test('real swift test output merges XCTest and swift-testing', () => {
    expect(run('swift test', SWIFT_TEST_REAL)).toMatchObject({
      total: 5, failed: 2, passed: 3, parsed: true,
      failures: [{ id: 'LibTests.XT.testFail' }, { id: 'bad()' }],
    })
  })
  test('jest all failing', () => expect(run('jest', JEST_ALL_FAIL)).toMatchObject({ total: 2, failed: 2, passed: 0 }))
  test('jest todo', () => expect(run('jest', JEST_TODO)).toMatchObject({ total: 6, failed: 1, skipped: 2, passed: 3 }))
  test('vitest all failing', () => expect(run('vitest', VITEST_ALL_FAIL)).toMatchObject({ total: 2, failed: 2, passed: 0 }))
  test('vitest token order', () => expect(run('vitest', VITEST_ORDER)).toMatchObject({ total: 4, failed: 1, passed: 2, skipped: 1 }))
  test('xcodebuild build with test.xcresult is not a test command', () => {
    expect(isTestCommand('xcodebuild build -resultBundlePath out/test.xcresult')).toBe(false)
    expect(isTestCommand('xcodebuild test-without-building -scheme A')).toBe(true)
  })
})

describe('detection', () => {
  test('test command with unreadable output is parsed: false', () => {
    expect(run('bun test', 'segfault', 139)).toEqual({
      total: 0, passed: 0, failed: 0, skipped: 0, failures: [], exitCode: 139, parsed: false,
    })
  })
  test('non-test command is ignored', () => expect(run('ls', LS_OUTPUT, 0)).toBeNull())
  test('non-test command printing a test summary is ignored', () => {
    expect(run('cat pytest.log', PYTEST_RAW, 0)).toBeNull()
  })
  test('test-command pattern', () => {
    for (const cmd of ['xcodebuild -scheme A test', 'swift test', 'python -m pytest', 'npm run test',
      'cargo test', 'go test ./...', 'fastlane scan', 'bun test', 'npx vitest']) {
      expect(isTestCommand(cmd)).toBe(true)
    }
    expect(isTestCommand('xcodebuild build')).toBe(false)
  })
})
