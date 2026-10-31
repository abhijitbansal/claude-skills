import { expect, test } from 'claude-code/testing'
import { MAX_SOURCE_BYTES, compareSourceSnapshots, hasSourceReport, parseSourceCapture, sourceMatchForRun, sourceCwd, unknownSource } from '../hooks/source-freshness'

const snapshot = {
  version: 1, scope: 'git-tracked+untracked-nonignored', status: 'available', root: '/synthetic',
  head: 'a'.repeat(40), branch: 'refs/heads/main', digest: 'b'.repeat(64), files: 2, bytes: 10,
}
const captured = (...values: unknown[]) => ({ exitCode: 0, stdout: JSON.stringify(values.length ? values[0] : snapshot) + '\n', stderr: '' })

test('complete supported captures are accepted without source payloads', () => {
  expect(parseSourceCapture(captured())).toEqual(snapshot)
})

test('matching observations require both identities, not only the commit', () => {
  expect(compareSourceSnapshots(snapshot, { ...snapshot })).toBe('matching')
  for (const changes of [
    { head: 'c'.repeat(40) }, { branch: 'refs/heads/other' }, { root: '/other' },
    { digest: 'd'.repeat(64) }, { files: 3 }, { bytes: 11 },
  ]) expect(compareSourceSnapshots(snapshot, { ...snapshot, ...changes })).toBe('changed')
})

test('a detached head is supported without inventing a branch', () => {
  expect(parseSourceCapture(captured({ ...snapshot, branch: null })))
    .toEqual({ ...snapshot, branch: null })
})

test('historical, partial, unsupported and malformed observations remain unknown', () => {
  for (const value of [undefined, null, {}, { ...snapshot, version: 2 },
    { ...snapshot, scope: 'all-files' }, { ...snapshot, digest: '' }, { ...snapshot, files: -1 },
    { ...snapshot, bytes: Number.MAX_SAFE_INTEGER }, { ...snapshot, root: 'relative' },
    { ...snapshot, status: 'unknown' }, { ...snapshot, branch: 'not-a-ref' },
    { ...snapshot, head: 'zzzz' }, { ...snapshot, payload: 'not allowed' },
  ]) {
    expect(compareSourceSnapshots(snapshot, value)).toBe('unknown')
    expect(compareSourceSnapshots(value, snapshot)).toBe('unknown')
    expect(parseSourceCapture(captured(value))).toMatchObject({ status: 'unknown' })
  }
})

test('truncation, process errors and extra output cannot earn a matching observation', () => {
  for (const result of [null, {}, { ...captured(), exitCode: 1 }, { ...captured(), stderr: 'warning' },
    { ...captured(), stdout: JSON.stringify(snapshot) }, { ...captured(), isStdoutTruncated: true },
    { ...captured(), isStderrTruncated: true }, { ...captured(), stdout: captured().stdout + 'extra\n' },
    { ...captured(), stdout: captured().stdout.slice(0, -10) },
  ]) expect(parseSourceCapture(result)).toMatchObject({ status: 'unknown' })
})

test('capture failures preserve fixed reason codes but no diagnostic payload', () => {
  expect(parseSourceCapture(captured({ version: 1, scope: snapshot.scope, status: 'unknown', reason: 'deadline' })))
    .toMatchObject({ status: 'unknown', reason: 'deadline' })
  const result = parseSourceCapture(captured({ status: 'unknown', reason: 'synthetic private content' }))
  expect(result).toMatchObject({ status: 'unknown', reason: 'invalid_capture' })
  expect(JSON.stringify(result)).not.toContain('private')
})

test('a run needs matching before and after observations as well as a current match', () => {
  const source = { before: snapshot, after: snapshot }
  expect(sourceMatchForRun(source, snapshot)).toBe('matching')
  const changed = { ...snapshot, digest: 'c'.repeat(64) }
  expect(sourceMatchForRun(source, changed)).toBe('changed')
  expect(sourceMatchForRun({ before: snapshot, after: changed }, changed)).toBe('changed')
  expect(sourceMatchForRun({ before: snapshot, after: changed }, snapshot)).toBe('changed')
  expect(sourceMatchForRun(undefined, snapshot)).toBe('unknown')
  expect(sourceMatchForRun({ after: snapshot }, snapshot)).toBe('unknown')
  expect(sourceMatchForRun(source, { status: 'unknown' })).toBe('unknown')
})

test('source cwd accepts only statically located direct test commands', () => {
  expect(sourceCwd('pytest -q', '/repo')).toBe('/repo')
  expect(sourceCwd('cd ./tests && pytest -q', '/repo')).toBe('/repo/tests')
  expect(sourceCwd('cd ../tests && pytest -q', '/repo')).toBe('/tests')
  expect(sourceCwd('cd . && pytest -q', '/repo')).toBe('/repo')
  expect(sourceCwd('cd .. && pytest -q', '/repo')).toBe('/')
  expect(sourceCwd('cd "/repo with space" && pytest -q', '/repo')).toBe('/repo with space')
  for (const command of ['ls', 'cd absent; pytest', 'cd ~ && pytest', 'cd $ROOT && pytest',
    'cd $(pwd) && pytest', 'echo done && cd /other && pytest', 'pytest; cd /other; pytest',
    'pytest | tail -1', 'pytest &', 'pytest\necho done', 'pytest > result.txt',
    'cartoon -c "cd /other && pytest"', 'PYTHONPATH=$(helper) pytest']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
})

test('shell-dependent directory operands cannot supply a source identity', () => {
  for (const dir of ['tests', 'tests/nested', '"tests"', "'tests'", '-', '"-"', '--',
    './test*', './test?', './test[ab]', './{tests,other}', '/repo/test*']) {
    expect(sourceCwd(`cd ${dir} && pytest -q`, '/repo')).toBeUndefined()
  }
})

test('line breaks in a cd prefix cannot be consumed as shell whitespace', () => {
  for (const command of ['cd\n/other && pytest', 'cd /other\n&& pytest',
    'cd\r/other && pytest', 'cd /other &&\npytest']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
})

test('only an attempted capture that said something earns a source line', () => {
  const reported = unknownSource('byte_limit')
  expect(hasSourceReport({ before: snapshot, after: snapshot })).toBe(true)
  expect(hasSourceReport({ before: reported, after: reported })).toBe(true)
  expect(hasSourceReport({ before: unknownSource('invalid_capture'), after: reported })).toBe(true)
  for (const source of [undefined, null, {}, 'x', { before: unknownSource(), after: unknownSource() },
    { before: unknownSource('invalid_capture'), after: unknownSource('invalid_capture') }]) {
    expect(hasSourceReport(source)).toBe(false)
  }
})

test('a capture up to the collector byte cap is accepted and anything above it is not', () => {
  const MIB = 1024 * 1024
  expect(MAX_SOURCE_BYTES).toBe(128 * MIB)
  for (const bytes of [32 * MIB + 1, 85 * MIB, 128 * MIB]) {
    expect(parseSourceCapture(captured({ ...snapshot, bytes }))).toEqual({ ...snapshot, bytes })
  }
  expect(parseSourceCapture(captured({ ...snapshot, bytes: 128 * MIB + 1 }))).toMatchObject({ status: 'unknown', reason: 'invalid_capture' })
})
