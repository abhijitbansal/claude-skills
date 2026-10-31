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
  test("unwraps cartoon's own POSIX escape of a single quote inside -c", () => {
    expect(splitCommand(String.raw`cartoon -c 'pytest -k '\''a and b'\'''`).normalized).toBe("pytest -k 'a and b'")
    expect(splitCommand(String.raw`cartoon -c 'pytest -k "it'\''s" -q'`).normalized).toBe(`pytest -k "it's" -q`)
  })
  test('unwraps cartoon --tag … --', () => {
    expect(splitCommand('cartoon --tag ios -- swift test').normalized).toBe('swift test')
  })
  test('unwraps cartoon with leading flags', () => {
    expect(splitCommand("cartoon --merge-streams -c 'pytest -q'").normalized)
      .toBe(splitCommand('pytest -q').normalized)
  })
  test('keeps a cd inside a wrapped command', () => {
    expect(splitCommand("cartoon -c 'cd app && pytest'")).toEqual({ cdDir: 'app', normalized: 'pytest' })
  })
  test('composes an outer and an inner cd', () => {
    expect(splitCommand("cd a && cartoon -c 'cd b && pytest'")).toEqual({ cdDir: 'a/b', normalized: 'pytest' })
    expect(splitCommand("cd a && cartoon -c 'cd /b && pytest'").cdDir).toBe('/b')
  })
  test('leaves cartoon utility commands untouched', () => {
    for (const c of ['cartoon logs grep x', 'cartoon stats', 'cartoon adapters', 'cartoon doctor'])
      expect(splitCommand(c).normalized).toBe(c)
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
