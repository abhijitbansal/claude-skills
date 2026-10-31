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
    'pytest &', 'pytest\necho done', 'PYTHONPATH=$(helper) pytest']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
})

// The cartoon PreToolUse hook rewrites a test command to `cartoon -c '<original>'`; both forms must locate alike.
test('the cartoon wrapper locates its inner command, including an inner or outer cd', () => {
  expect(sourceCwd("cartoon -c 'pytest -q'", '/repo')).toBe('/repo')
  expect(sourceCwd("cartoon -c 'uv tool run pytest tests/pytest/ -q'", '/repo')).toBe('/repo')
  expect(sourceCwd('cartoon -c "pytest -q"', '/repo')).toBe('/repo')
  expect(sourceCwd("cartoon --raw -c 'pytest -q'", '/repo')).toBe('/repo')
  expect(sourceCwd("cartoon -c 'cd ./tests && pytest -q'", '/repo')).toBe('/repo/tests')
  expect(sourceCwd('cartoon -c "cd /other && pytest"', '/repo')).toBe('/other')
  expect(sourceCwd("cd ./a && cartoon -c 'cd ./b && pytest'", '/repo')).toBe('/repo/a/b')
  expect(sourceCwd("cd /a && cartoon -c 'pytest'", '/repo')).toBe('/a')
  expect(sourceCwd("cartoon -c 'pytest -q' 2>&1 | tail -n 5", '/repo')).toBe('/repo')
  expect(sourceCwd("cartoon -c 'xcodebuild -scheme App test'", '/repo')).toBe('/repo')
})

test('the cartoon prefix forms that suite.ts unwraps locate the command after them', () => {
  expect(sourceCwd('cartoon pytest -q', '/repo')).toBe('/repo')
  expect(sourceCwd('cartoon --tag t -- pytest -q', '/repo')).toBe('/repo')
  expect(sourceCwd('cd ./tests && cartoon -- pytest', '/repo')).toBe('/repo/tests')
})

test('the cartoon wrapper gets the same refusals as a bare command', () => {
  for (const command of [
    "cartoon -c 'cd tests && pytest'", "cartoon -c 'cd ~ && pytest'", "cartoon -c 'cd $ROOT && pytest'",
    "cartoon -c 'cd - && pytest'", "cartoon -c 'cd ./t*' && pytest", "cartoon -c 'cd ./t*; pytest'",
    "cartoon -c 'pytest; cd /other; pytest'", "cartoon -c 'pytest && pytest'", "cartoon -c 'pytest || true'",
    "cartoon -c 'pytest &'", "cartoon -c '(cd /other && pytest)'", "cartoon -c 'pytest $(helper)'",
    "cartoon -c 'pytest `helper`'", "cartoon -c 'ls'", "cartoon -c 'cat pytest.log'",
    'cartoon -c "pytest $ROOT"', 'cartoon -c "pytest `helper`"', 'cartoon -c "pytest $(helper)"',
    'cartoon -c "pytest \\"', "cartoon -c 'pytest' && rm x", "cartoon -c 'pytest'; rm x",
    "cartoon --x;rm -c 'pytest'", "cartoon --tag $(helper) -c 'pytest'", "cartoon --x`h` -c 'pytest'",
    "cartoon -c 'pytest", "cartoon -c 'pytest\nls'", "cartoon -c 'pytest' extra",
    "cartoon logs grep pytest", 'cartoon ls', "cartoon -c 'CDPATH=/x pytest'", 'cartoon pytest; rm x',
  ]) expect(sourceCwd(command, '/repo')).toBeUndefined()
})

// Measured: `cartoon hook rewrite` turns `pytest -k 'a and b'` into the first string below.
test("cartoon's own rewrite of a single-quoted argument is located like the bare command", () => {
  const rewritten = [
    String.raw`cartoon -c 'pytest -k '\''a and b'\'''`,
    String.raw`cartoon -c 'pytest -k '\''a and b'\'' -k '\''c d'\'' -q'`,
    String.raw`cartoon -c 'pytest -k "it'\''s" -q'`,
    String.raw`cartoon -c 'cd ./tests && pytest -k '\''a and b'\'''`,
    String.raw`cartoon -c 'pytest -k '\''a'\'' 2>&1 | tail -n 5'`,
  ]
  expect(sourceCwd("pytest -k 'a and b'", '/repo')).toBe('/repo')
  for (const command of rewritten.slice(0, 3)) expect(sourceCwd(command, '/repo')).toBe('/repo')
  expect(sourceCwd(rewritten[3] as string, '/repo')).toBe('/repo/tests')
  expect(sourceCwd(rewritten[4] as string, '/repo')).toBe('/repo')
})

test('the decoded inner text of a cartoon rewrite gets every usual refusal', () => {
  for (const command of [
    // decodes to an unterminated quote, an escaped quote outside quotes, or a lone backslash
    String.raw`cartoon -c 'pytest'\''; rm x'`, String.raw`cartoon -c 'pytest -k '\'a'`,
    String.raw`cartoon -c 'pytest -k '\'''`, String.raw`cartoon -c 'pytest\'`, String.raw`cartoon -c 'pytest -k '\''a'`,
    // decodes to text that chains, expands or changes the directory
    String.raw`cartoon -c 'pytest -k '\''a'\''; cd /other'`, String.raw`cartoon -c 'pytest -k "$X" '\''y'\'''`,
    String.raw`cartoon -c 'pytest '\''a'\'' && rm x'`, String.raw`cartoon -c 'cd tests && pytest -k '\''a'\'''`,
    String.raw`cartoon -c 'pytest -k "it'\''s$X"'`, String.raw`cartoon -c 'CDPATH=/x pytest -k '\''a'\'''`,
    String.raw`cartoon -c 'ls -k '\''a'\'''`,
    // an escaped quote is only the POSIX '\'' sequence
    String.raw`pytest -k 'a'\'b`, String.raw`pytest -k a\'b`, String.raw`cartoon -c 'pytest' \'`,
  ]) expect(sourceCwd(command, '/repo')).toBeUndefined()
})

test('quoted arguments are accepted when the quoted text cannot expand or change the directory', () => {
  expect(sourceCwd('pytest -k "a and b"', '/repo')).toBe('/repo')
  expect(sourceCwd("pytest -k 'x'", '/repo')).toBe('/repo')
  expect(sourceCwd("pytest -k 'a or $b' -q", '/repo')).toBe('/repo')
  expect(sourceCwd("pytest -k 'a; cd /other' -q", '/repo')).toBe('/repo')
  expect(sourceCwd('pytest -k "a|b" tests/', '/repo')).toBe('/repo')
  expect(sourceCwd('swift test --filter "Suite/test one"', '/repo')).toBe('/repo')
  expect(sourceCwd('FOO="a b" pytest', '/repo')).toBe('/repo')
  expect(sourceCwd('cd "/repo with space" && pytest -k "a b"', '/repo')).toBe('/repo with space')
  // Quoted text is not a command boundary: it cannot make a non-test command look like a test.
  expect(sourceCwd('echo "x; pytest"', '/repo')).toBeUndefined()
  expect(sourceCwd("echo 'x && pytest'", '/repo')).toBeUndefined()
})

test('quotes that could expand, escape or never close are refused', () => {
  for (const command of ['pytest -k "$X"', 'pytest -k "a`b`"', 'pytest -k "$(helper)"', 'pytest -k "a\\b"',
    'pytest -k "unterminated', "pytest -k 'unterminated", 'pytest -k "a" "b', 'pytest -k a\\ b',
    'pytest -k "a"$X', 'pytest -k $\'x\'']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
})

test('trailing output plumbing does not move the directory', () => {
  for (const command of ['pytest 2>&1', 'pytest -q 2>&1', 'pytest > out.log', 'pytest >out.log', 'pytest >> out.log',
    'pytest 2> err.log', 'pytest > out.log 2>&1', 'pytest 2>&1 > out.log', 'pytest > /dev/null',
    'pytest | tail -n 50', 'pytest -q 2>&1 | tail -n 50', 'pytest | tee log', 'pytest | tee -a "my log"',
    'pytest 2>&1 | grep -E "FAIL|ERROR" | head -20', 'pytest|tail', 'pytest 2>&1|tail', 'pytest | tail > out.log',
    'pytest -k "a and b" 2>&1 | tail -n 50']) {
    expect(sourceCwd(command, '/repo')).toBe('/repo')
  }
  expect(sourceCwd('cd ./tests && pytest 2>&1 | tail -n 5', '/repo')).toBe('/repo/tests')
})

test('plumbing that could run, chain or move something else is refused', () => {
  for (const command of ['pytest 2>', 'pytest >', 'pytest > >', 'pytest >&2', 'pytest 1>&2', 'pytest >&1', 'pytest &> out',
    'pytest >| out', 'pytest < in.txt', 'pytest <<< x', 'pytest > $OUT', 'pytest > `f`', 'pytest > "$OUT"', 'pytest | ',
    'pytest || tail', 'pytest |& tail', 'pytest | | tail', 'pytest | cd /other', 'pytest | sh', 'pytest | $(f)',
    'pytest | tail -n $N', 'pytest | tail; cd /other', 'pytest | tail && cd /other', 'pytest | tail &',
    'pytest | (cd /other; cat)', 'pytest 2>&1; cd /other', 'pytest 2>&1 &', 'pytest 2>&1x', 'pytest 2>&12',
    'pytest | tail | xargs rm', 'pytest | tail |', '| pytest']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
})

test('environment prefixes are accepted unless they set the working directory', () => {
  expect(sourceCwd('PYTHONPATH=src pytest -q', '/repo')).toBe('/repo')
  expect(sourceCwd("cartoon -c 'CI=1 pytest'", '/repo')).toBe('/repo')
  for (const command of ['PWD=/other pytest', 'CDPATH=/other pytest', 'OLDPWD=/other pytest', 'A=1 PWD=/x pytest',
    'cd ./t && CDPATH=/x pytest', "CDPATH=/x cartoon -c 'pytest'", 'PWD="/x" pytest', 'PYTHONPATH=$X pytest',
    'PYTHONPATH=`h` pytest']) {
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

test('quote characters in an unquoted cd operand are refused, because the shell joins them into the path', () => {
  for (const command of ["cd ./x'y' && pytest", 'cd /a"/b" && pytest', "cd ./x'y && pytest", 'cd ./x"y && pytest',
    "cd ./x'y'z && pytest", 'cd ./x"y"/z && pytest', "cartoon -c 'cd ./x\"y\" && pytest'"]) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
  expect(sourceCwd('cd "./x y" && pytest', '/repo')).toBe('/repo/x y')
  expect(sourceCwd("cd '/a/b' && pytest", '/repo')).toBe('/a/b')
})

test('only space and tab separate words: any other whitespace anywhere refuses the command', () => {
  expect(sourceCwd('pytest\t-q', '/repo')).toBe('/repo')
  expect(sourceCwd('cd\t./tests\t&&\tpytest', '/repo')).toBe('/repo/tests')
  expect(sourceCwd("cartoon\t-c\t'pytest -q'", '/repo')).toBe('/repo')
  for (const space of [' ', '\f', '\v', ' ', ' ', '　', ' ', '﻿']) {
    for (const command of [`pytest${space}-q`, `pytest -q${space}`, `${space}pytest -q`, `cd${space}./tests && pytest`,
      `cd ./tests${space}&& pytest`, `cd ./tests &&${space}pytest`, `cd ./tests${space}&&${space}pytest`,
      `cartoon${space}-c 'pytest'`, `cartoon -c${space}'pytest'`, `cartoon -c 'pytest -q'${space}`,
      `cartoon -c 'pytest${space}-q'`, `pytest -k "a${space}b"`, `pytest -q 2>&1${space}| tail`, `pytest -q |${space}tail`,
      `CI=1${space}pytest`, `pytest 2>&1${space}`]) {
      expect(sourceCwd(command, '/repo')).toBeUndefined()
    }
  }
})

test('output filters that run programs are refused', () => {
  for (const command of ['pytest | rg --pre ./x foo', 'pytest | rg --pre=cat foo', 'pytest | rg --pre-glob "*.log" foo',
    'pytest | rg --pre-glob=*.log foo', 'pytest 2>&1 | rg -n --pre ./x FAIL', 'pytest | rg "--pre" ./x foo',
    'pytest | tail | rg --pre ./x foo', 'pytest | sort --compress-program=./x', 'pytest | sort --compress-program ./x',
    'pytest | sort --compress-prog=./x', 'pytest | sort --compress=./x', 'pytest | sort --comp ./x']) {
    expect(sourceCwd(command, '/repo')).toBeUndefined()
  }
  // `--pre` as an argument of the test, not of the filter, is nothing to refuse.
  for (const command of ['pytest | rg -n FAIL', 'pytest | rg -e --', 'pytest | rg "FAIL|ERROR" | head', 'pytest | sort -r',
    'pytest --pre -q']) {
    expect(sourceCwd(command, '/repo')).toBe('/repo')
  }
})

// Flags and variables that point a runner at code outside the working directory. The cwd stays put, so the
// worktree located from it would be the wrong one.
const MOVING = [
  'jest --roots ../other', 'jest --roots=/abs', 'jest --projects ../other', 'npx jest --projects /abs/a',
  'pytest -qc ../other/pytest.ini', 'pytest -qc../x', 'pytest -vc /abs/pytest.ini',
  'npm --prefix ../other test', 'npm --prefix=../other test', 'npm test --prefix ../other', 'npm --prefix ./sub test',
  'npm -C ../other test', 'npm -C../other test', 'pnpm --dir ../other test', 'pnpm --dir=/abs test', 'pnpm -C ../other test',
  'pnpm test --dir ./x', 'yarn --cwd ../other test', 'yarn --cwd=/abs test', 'bun --cwd ../other test', 'bun test --cwd=../x',
  'npm_config_prefix=../other npm test', 'NPM_CONFIG_PREFIX=/abs npm test', 'CI=1 npm_config_prefix=x npm test',
  "cartoon -c 'npm --prefix ../other test'", "npm_config_prefix=/x cartoon -c 'npm test'",
  'go test -C ../other ./...', 'go test -C=../other ./...', 'make -C ../other test', 'make -C../other test',
  'cargo test --manifest-path ../other/Cargo.toml', 'cargo test --manifest-path=/abs/Cargo.toml',
  'swift test --package-path ../other', 'swift test --package-path=/abs', 'swift test --chdir ../other',
  'pytest --rootdir ../other', 'pytest --rootdir=/abs tests', 'pytest --rootdir=. tests',
  'jest --rootDir ../other', 'jest --rootDir=/abs', 'vitest --root ../other', 'vitest --root=/abs run',
  'uv run --directory ../other pytest', 'uv run --project ../other pytest', 'poetry run -C ../other pytest',
  'pytest "--rootdir" ../other', "pytest '--rootdir'=../other", 'pytest --root"dir" ../other', 'npm --prefix "../other" test',
  'PYTEST_ADDOPTS=--rootdir=../other pytest', 'PYTEST_ADDOPTS="-q --rootdir ../other" pytest',
  // a flag that selects a file or project is refused when its value leaves the directory, or is missing
  'jest --config ../other/jest.config.js', 'jest --config=/abs/jest.config.js', 'jest --config ~/jest.config.js',
  'vitest --config ../vitest.config.ts', 'pytest -c ../other/pytest.ini', 'pytest -c../other/pytest.ini', 'pytest -c /abs/pytest.ini',
  'pytest -c', 'pytest --config', 'jest --config=',
  'xcodebuild -project ../other/App.xcodeproj test', 'xcodebuild -project /abs/App.xcodeproj test',
  'xcodebuild -workspace ../App.xcworkspace -scheme App test', 'xcodebuild test -workspace /abs/App.xcworkspace',
  'xcodebuild -project "../x/App.xcodeproj" test', 'xcodebuild -project foo/../../App.xcodeproj test',
  'vitest -r ../other run',
]
const ORDINARY = [
  'jest --roots src', 'jest --projects packages/app', 'pytest -qc pytest.ini',
  'xcodebuild test -scheme App -project App.xcodeproj', 'xcodebuild test -enableCodeCoverage YES -scheme App',
  'pytest -k "a and b" -q', 'pytest -q', 'pytest -x --tb=short tests/', 'pytest -rA', 'pytest -r A', 'pytest -rfE -q',
  'pytest -p no:cacheprovider', 'pytest --confcutdir=tests', 'pytest -c pytest.ini', 'pytest -c config/pytest.ini -q',
  'npm test -- --watch=false', 'npm run test -- --watch=false', 'npm test --silent', 'pnpm test --filter app', 'yarn test --watch=false',
  'jest --config jest.config.js', 'jest --config=config/jest.json', 'jest --rootDirs', 'vitest run --coverage',
  'vitest --config vitest.config.ts', 'bun test --timeout 5000', 'cargo test -p core -- --nocapture', 'go test ./... -run X',
  'go test -count=1 -v ./...', 'swift test --filter Suite/test', 'swift test --parallel',
  'xcodebuild -project App.xcodeproj -scheme App test', 'xcodebuild -workspace App.xcworkspace -scheme App test',
  'xcodebuild -project "My App.xcodeproj" test', 'xcodebuild test -scheme App -destination "platform=iOS"',
  'uv run pytest -q', 'PYTHONPATH=src pytest', 'PYTEST_ADDOPTS=-q pytest', 'PYTEST_ADDOPTS="-q -x" pytest',
  'npm_config_loglevel=silent npm test',
]

test('runner flags and variables that move the code under test refuse a source check', () => {
  for (const command of MOVING) {
    expect([command, sourceCwd(command, '/repo')]).toEqual([command, undefined])
  }
})

test('ordinary runner flags still locate the command', () => {
  for (const command of ORDINARY) {
    expect([command, sourceCwd(command, '/repo')]).toEqual([command, '/repo'])
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
