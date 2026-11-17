import { describe, expect, test } from 'claude-code/testing'

import { expandHome, resolveDir, splitCommand, suiteKey, suiteLabel } from '../hooks/suite'

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
  test('tee and output redirects do not split a suite', () => {
    const bare = splitCommand('pytest -q').normalized
    for (const c of [
      'pytest -q | tee out.log',
      'pytest -q 2>&1 | tee -a out.log',
      'pytest -q |& tee out.log',
      'pytest -q > out.log 2>&1',
      'pytest -q &> out.log',
      'pytest -q >> out.log',
      'pytest -q 2> err.log',
    ]) expect(splitCommand(c).normalized).toBe(bare)
  })
  test('a > inside a quoted argument is kept', () => {
    expect(splitCommand('pytest -k "a > b"').normalized).toBe('pytest -k "a > b"')
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

describe('expandHome', () => {
  test('a leading ~ becomes the home directory', () => {
    expect(expandHome('~/projects/app', '/Users/me')).toBe('/Users/me/projects/app')
    expect(expandHome('~', '/Users/me')).toBe('/Users/me')
  })
  test('other paths, ~user, and an unknown home are left alone', () => {
    expect(expandHome('/a/b', '/Users/me')).toBe('/a/b')
    expect(expandHome('~bob/x', '/Users/me')).toBe('~bob/x')
    expect(expandHome('~/x', undefined)).toBe('~/x')
  })
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
