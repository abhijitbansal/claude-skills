import { describe, expect, test } from 'claude-code/testing'

import { resolveDir, splitCommand, suiteKey, suiteLabel } from '../hooks/suite'

describe('splitCommand', () => {
  test('strips a leading cd and keeps its dir', () => {
    expect(splitCommand('cd ios/App && xcodebuild test -scheme Cubby')).toEqual({
      cdDir: 'ios/App',
      normalized: 'xcodebuild test -scheme Cubby',
    })
  })
  test('strips env prefixes', () => {
    expect(splitCommand('CI=1 PYTHONPATH="a b" pytest -q').normalized).toBe('pytest -q')
  })
  test('unwraps cartoon -c', () => {
    expect(splitCommand("cartoon -c 'bun test'").normalized).toBe('bun test')
  })
  test('unwraps cartoon --tag … --', () => {
    expect(splitCommand('cartoon --tag ios -- swift test').normalized).toBe('swift test')
  })
  test('piped and bare runs share one normalized command', () => {
    const piped = splitCommand('xcodebuild test -scheme Cubby 2>&1 | tail -30').normalized
    expect(piped).toBe(splitCommand('xcodebuild   test -scheme Cubby').normalized)
  })
  test('keeps flags, so -only-testing is its own suite', () => {
    expect(splitCommand('xcodebuild test -only-testing:CubbyTests/ScanTests').normalized)
      .toBe('xcodebuild test -only-testing:CubbyTests/ScanTests')
  })
})

describe('resolveDir', () => {
  test('absolute dir wins', () => expect(resolveDir('/a/b', '/x')).toBe('/x'))
  test('relative dir joins and folds ..', () => expect(resolveDir('/a/b', '../c/./d')).toBe('/a/c/d'))
})

describe('suite identity', () => {
  test('two worktrees give two keys', () => {
    expect(suiteKey('/r/wt-a', 'pytest -q')).not.toBe(suiteKey('/r/wt-b', 'pytest -q'))
  })
  test('label truncates to 48 columns', () => {
    expect(suiteLabel('x'.repeat(60))).toHaveLength(48)
    expect(suiteLabel('pytest -q')).toBe('pytest -q')
  })
})
