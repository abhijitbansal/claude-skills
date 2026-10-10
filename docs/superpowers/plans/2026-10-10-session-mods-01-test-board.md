# Session mods: phase 1, Test Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `plugins/test-board/`, a mod that shows passed/failed/skipped counts for every test run (main loop or subagent) in a band above the prompt, next to the previous run of the same suite in the same worktree.

**Architecture:** Four pure modules (`suite.ts`, `parse.ts`, `history.ts`, `format.ts`) hold every decision and are unit-tested alone. `register.tsx` wires `tool.call` (Bash), `agent.spawn`, `prompt.submit`, `session.start` and the `AbovePrompt` band, and does all `$.store` / `$.state` / `$.process` I/O. History lives in `$.store`; the band reads `$.state`.

**Tech Stack:** Claude Code 2.1.296 function hooks (`claude-code`, `claude-code/testing`), TypeScript/TSX, `claude plugin validate`, `claude plugin test`, `tsc`.

**Spec:** [`docs/superpowers/specs/2026-10-10-test-board-mod-design.md`](../specs/2026-10-10-test-board-mod-design.md) (amended in `2a38d12`), with the [decision log](../specs/2026-10-10-session-mods-decisions.md).

## Global Constraints

- Branch `feat/session-mods`. In the `claude-mods` worktree, push with `git push origin HEAD:feat/session-mods`. The executor may commit and push after each task.
- **Before Task 1, read decision log §5 "Plan impact"** (written by plan 00). A probe that came back false changes the steps it names; edit them first.
- Plugin name `test-board`, version `0.1.0`, folder `plugins/test-board/`. No `skills/` folder.
- Shared contract with plan 02: `PluginState['test-board'] = { latest: TestRun[]; expanded: boolean }`. Plan 02 reads `{ plugin: 'test-board', key: 'latest' }`. Do not rename either.
- Store: `runs:<key>` holds `TestRun[]` newest first, capped at 10; `index` holds keys most-recent-first; oldest keys are dropped when the summed JSON length passes 2 MiB (2,097,152).
- Limits: 20 failure IDs per run, 3 runs in `latest`, 10 failure IDs shown when expanded, 48-column suite label, narrow terminal under 80 columns.
- The mod never denies or alters a tool call; every hook returns what `next(e)` returned.
- Tests run under `claude plugin test`: no fs, network or process. Fixtures are TS modules exporting strings.
- Type declarations: `/private/tmp/claude-501/bundled-skills/2.1.296/e60f5bab9db54497098195964d5421f8/plugin-authoring/types/claude-code.d.ts` (rewritten each time the plugin-authoring skill loads; reload it after a restart and use the path it names).
- Marketplace entry and doc/site count sync are **not** in this plan: plan 02's last task does both plugins in one PR.

## Review Focus

1. A non-test command whose output contains a test summary (`cat pytest.log`, `cartoon logs grep`) must not create a run. Pinned in Task 2 (`parse.test.ts`).
2. A test command run in the background (`run_in_background`) returns before any output; it must not record a `parsed: false` run. Pinned in Task 4.
3. The same suite run twice in one turn shows once in the band (newest), not twice. Pinned in Task 4.
4. `xcodebuild test … 2>&1 | tail -30` and the bare command must share one suite key, so history compares them. Pinned in Task 1.
5. A Bash call another plugin denied must pass through untouched and record nothing. Pinned in Task 4.

## Spec deviations (deliberate)

- `hooks/format.ts` is added: band-line text, arrows and narrow-terminal drops are pure logic, tested without mounting.
- `register.test.ts` is `register.test.tsx`: its bottom `ui.render` hook and inline band plugin use JSX.
- Raw readers run only when the normalized command matches the test-command pattern; the cartoon summary reader runs for any command (cartoon prints that line only from its test adapters). This closes Review Focus 1, which the spec's "first match wins" leaves open.
- `tool.call` carries no cwd. The run's cwd is a leading `cd <dir>`, else the subagent's spawn `cwd`, else `$.session.cwd()` (subject to probe U13).

---

### Task 1: Scaffold the plugin and suite identity

**Files:**
- Create: `plugins/test-board/.claude-plugin/plugin.json`
- Create: `plugins/test-board/hooks/hooks.json`
- Create: `plugins/test-board/hooks/register.tsx` (stub)
- Create: `plugins/test-board/types/index.d.ts`
- Create: `plugins/test-board/tsconfig.json`
- Create: `plugins/test-board/hooks/suite.ts`
- Test: `plugins/test-board/tests/suite.test.ts`
- Modify: `.gitignore` (append one line)

**Interfaces:**
- Produces: `TestRun`, `TestFailure` (types); `splitCommand(command: string): { cdDir?: string; normalized: string }`, `resolveDir(base: string, dir: string): string`, `suiteKey(worktreeRoot: string, normalized: string): string`, `suiteLabel(normalized: string): string`, `SUITE_LABEL_COLUMNS = 48`.

- [ ] **Step 1: Write the manifest, hooks list, tsconfig and gitignore line**

`plugins/test-board/.claude-plugin/plugin.json`:
```json
{
  "name": "test-board",
  "version": "0.1.0",
  "description": "Band above the prompt with pass/fail/skip counts for every test run, compared with the previous run of the same suite in the same worktree",
  "types": "./types/index.d.ts"
}
```

`plugins/test-board/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`plugins/test-board/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

Append to the repo `.gitignore`:
```
plugins/*/.claude-plugin/types/
```

`plugins/test-board/hooks/register.tsx` (stub, replaced in Task 4):
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 2: Write the state contract**

`plugins/test-board/types/index.d.ts`:
```ts
export type TestFailure = { id: string; loc?: string }

export type TestRun = {
  suite: string           // label, e.g. "xcodebuild test -scheme Cubby"
  key: string             // `${worktreeRoot}::${normalizedCommand}`
  total: number; passed: number; failed: number; skipped: number
  durationS?: number
  failures: TestFailure[] // capped at 20
  exitCode: number
  at: number              // epoch ms
  via?: string            // subagent description, "workflow", or undefined for the main loop
  parsed: boolean         // false: looked like a test run, counts unavailable
  stale?: boolean         // true only in `latest` for a run loaded from history at
                          // session start; never written to the store
}

declare module 'claude-code' {
  interface PluginState {
    'test-board': { latest: TestRun[]; expanded: boolean }
  }
}
```

- [ ] **Step 3: Write the failing suite tests**

`plugins/test-board/tests/suite.test.ts`:
```ts
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
```

- [ ] **Step 4: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, `suite.test.ts` cannot resolve `../hooks/suite`.

- [ ] **Step 5: Implement `suite.ts`**

`plugins/test-board/hooks/suite.ts`:
```ts
export const SUITE_LABEL_COLUMNS = 48

const LEADING_CD = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/
const CARTOON_C = /^cartoon\s+-c\s+(?:'([^']*)'|"([^"]*)")\s*$/
const CARTOON_PREFIX = /^cartoon\s+(?:--tag\s+\S+\s+)?(?:--\s+)?/
const TRAILING_PIPE = /\s*\|\s*(?:head|tail|grep|rg)\b.*$/
const STDERR_MERGE = /\s*2>&1/g

export function splitCommand(command: string): { cdDir?: string; normalized: string } {
  let rest = command.trim()
  let cdDir: string | undefined
  const cd = LEADING_CD.exec(rest)
  if (cd) {
    cdDir = cd[1] ?? cd[2] ?? cd[3]
    rest = rest.slice(cd[0].length)
  }
  rest = rest.replace(ENV_PREFIX, '')
  const wrapped = CARTOON_C.exec(rest)
  rest = wrapped ? (wrapped[1] ?? wrapped[2] ?? '') : rest.replace(CARTOON_PREFIX, '')
  rest = rest.replace(TRAILING_PIPE, '').replace(STDERR_MERGE, '')
  const normalized = rest.replace(/\s+/g, ' ').trim()
  return cdDir === undefined ? { normalized } : { cdDir, normalized }
}

export function resolveDir(base: string, dir: string): string {
  if (dir.startsWith('/') || dir.startsWith('~')) return dir
  const parts: string[] = []
  for (const part of `${base}/${dir}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export function suiteKey(worktreeRoot: string, normalized: string): string {
  return `${worktreeRoot}::${normalized}`
}

export function suiteLabel(normalized: string): string {
  return normalized.slice(0, SUITE_LABEL_COLUMNS)
}
```

- [ ] **Step 6: Run the tests and validate**

Run: `claude plugin test plugins/test-board`
Expected: PASS, all `suite.test.ts` tests.
Run: `claude plugin validate plugins/test-board`
Expected: no refusal; the stub hooks nothing.

- [ ] **Step 7: Commit**

```bash
git add .gitignore plugins/test-board
git commit -m "feat(test-board): scaffold plugin and suite identity"
git push origin HEAD:feat/session-mods
```

---

### Task 2: Parse test output

**Files:**
- Create: `plugins/test-board/hooks/parse.ts`
- Create: `plugins/test-board/tests/fixtures/output.ts`
- Test: `plugins/test-board/tests/parse.test.ts`

**Interfaces:**
- Consumes: `TestRun`, `TestFailure` from `../types`.
- Produces: `type ParsedRun = Pick<TestRun, 'total' | 'passed' | 'failed' | 'skipped' | 'durationS' | 'failures' | 'exitCode' | 'parsed'>`; `parseTestOutput(input: { command: string; text: string; exitCode: number }): ParsedRun | null` (`command` is the normalized command); `isTestCommand(normalized: string): boolean`.

- [ ] **Step 1: Write the fixtures**

`plugins/test-board/tests/fixtures/output.ts`:
```ts
export const CARTOON_PYTEST = [
  'adapter: pytest',
  'summary{total,passed,failed,skipped,duration_s}: 13,10,2,1,3.21',
  'failures[2]{id,loc,msg}:',
  '  tests/test_a.py::test_x,tests/test_a.py:12,"assert 1 == 2"',
  '  tests/test_b.py::test_y,tests/test_b.py:40,boom',
].join('\n')

export const XCODEBUILD_RAW = [
  "Test Case '-[CubbyTests.ScanTests testBarcode]' started.",
  '/Users/x/Cubby/CubbyTests/ScanTests.swift:42: error: -[CubbyTests.ScanTests testBarcode] : XCTAssertEqual failed',
  "Test Case '-[CubbyTests.ScanTests testBarcode]' failed (0.012 seconds).",
  'Executed 3 tests, with 1 failure (0 unexpected) in 0.030 (0.031) seconds',
  'Executed 415 tests, with 2 tests skipped and 3 failures (0 unexpected) in 71.900 (72.100) seconds',
  '** TEST FAILED **',
].join('\n')

export const SWIFT_TESTING_RAW = [
  '✘ Test parsesDate() failed after 0.002 seconds with 1 issue.',
  '✔ Test parsesAmount() passed after 0.001 seconds.',
  '✘ Test run with 12 tests failed after 0.5 seconds with 1 issue.',
].join('\n')

export const PYTEST_RAW = [
  'FAILED tests/test_a.py::test_x - assert 1 == 2',
  '========= 1 failed, 10 passed, 2 skipped in 3.50s =========',
].join('\n')

export const JEST_RAW = 'Tests:       1 failed, 2 skipped, 10 passed, 13 total\nTime:        2.1 s'
export const VITEST_RAW = ' Test Files  1 failed (3)\n      Tests  1 failed | 9 passed (10)\n   Duration  1.20s'
export const BUN_RAW = '(fail) math > adds [0.12ms]\n\n 9 pass\n 1 fail\n 2 skip\nRan 12 tests across 3 files. [45.00ms]'
export const LS_OUTPUT = 'README.md\nplugins\ntests'
```

- [ ] **Step 2: Capture real output (optional, adds a smoke fixture)**

Run: `cartoon logs --help`, then use its listing command to find the newest pytest or xcodebuild-test entry, and `cartoon logs grep "summary\{" --last -C 3` for its TOON block. If one exists, append it to `output.ts` as `export const CARTOON_REAL = \`…\``, and add to `parse.test.ts`:
```ts
test('real cartoon capture parses', () => {
  const run = parseTestOutput({ command: 'pytest -q', text: CARTOON_REAL, exitCode: 0 })
  expect(run?.parsed).toBe(true)
  expect((run?.total ?? 0) > 0).toBe(true)
})
```
If cartoon has no such entry, skip this step and say so in the task report. If the real block's `failures` row format differs from the hand-written one (quoting, separators), fix `readCartoon` and the hand-written fixture to match the real one.

- [ ] **Step 3: Write the failing parse tests**

`plugins/test-board/tests/parse.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { isTestCommand, parseTestOutput } from '../hooks/parse'
import {
  BUN_RAW, CARTOON_PYTEST, JEST_RAW, LS_OUTPUT, PYTEST_RAW,
  SWIFT_TESTING_RAW, VITEST_RAW, XCODEBUILD_RAW,
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
      total: 415, passed: 410, failed: 3, skipped: 2, durationS: 71.9, exitCode: 1, parsed: true,
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
  test('jest', () => expect(run('npx jest', JEST_RAW)).toMatchObject({ total: 13, passed: 10, failed: 1, skipped: 2 }))
  test('vitest', () => expect(run('vitest run', VITEST_RAW)).toMatchObject({ total: 10, passed: 9, failed: 1, skipped: 0 }))
  test('bun', () => expect(run('bun test', BUN_RAW)).toMatchObject({
    total: 12, passed: 9, failed: 1, skipped: 2, failures: [{ id: 'math > adds' }],
  }))
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
```

- [ ] **Step 4: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, `parse.test.ts` cannot resolve `../hooks/parse`.

- [ ] **Step 5: Implement `parse.ts`**

`plugins/test-board/hooks/parse.ts`:
```ts
import type { TestFailure, TestRun } from '../types'

export type ParsedRun = Pick<TestRun,
  'total' | 'passed' | 'failed' | 'skipped' | 'durationS' | 'failures' | 'exitCode' | 'parsed'>
type Counts = Omit<ParsedRun, 'exitCode' | 'parsed'>
type Reader = (text: string) => Counts | null

const TEST_COMMAND = /\b(?:xcodebuild\b.*\btest\b|swift\s+test\b|pytest\b|jest\b|vitest\b|bun\s+test\b|npm\s+(?:run\s+)?test\b|cargo\s+test\b|go\s+test\b|fastlane\s+(?:scan|test)\b)/

export function isTestCommand(normalized: string): boolean {
  return TEST_COMMAND.test(normalized)
}

function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
  let last: RegExpExecArray | null = null
  for (const m of text.matchAll(re)) last = m as RegExpExecArray
  return last
}

function unquote(cell: string): string {
  return cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/\\"/g, '"') : cell
}

const readCartoon: Reader = text => {
  const m = /summary\{total,passed,failed,skipped,duration_s\}:\s*(\d+),(\d+),(\d+),(\d+),([\d.]+)/.exec(text)
  if (!m) return null
  const failures: TestFailure[] = []
  const block = /failures\[\d+\]\{id,loc,msg\}:\n((?:[ \t]+.*(?:\n|$))*)/.exec(text)
  for (const row of block?.[1]?.split('\n') ?? []) {
    const cells = /^\s+("(?:[^"\\]|\\.)*"|[^,]*),("(?:[^"\\]|\\.)*"|[^,]*),/.exec(row)
    if (cells?.[1]) failures.push({ id: unquote(cells[1]), ...(cells[2] ? { loc: unquote(cells[2]) } : {}) })
  }
  return {
    total: Number(m[1]), passed: Number(m[2]), failed: Number(m[3]), skipped: Number(m[4]),
    durationS: Number(m[5]), failures,
  }
}

const readXcodebuild: Reader = text => {
  const m = lastMatch(/Executed (\d+) tests?, with (?:(\d+) tests? skipped and )?(\d+) failures? \(\d+ unexpected\) in ([\d.]+)/g, text)
  if (!m) return null
  const locs = new Map<string, string>()
  for (const l of text.matchAll(/^(.+?:\d+): error: -\[(\S+) (\S+)\]/gm)) locs.set(`${l[2]}.${l[3]}`, l[1] ?? '')
  const ids = [...new Set([...text.matchAll(/Test Case '-\[(\S+) (\S+)\]' failed/g)].map(f => `${f[1]}.${f[2]}`))]
  const total = Number(m[1]); const skipped = Number(m[2] ?? 0); const failed = Number(m[3])
  return {
    total, skipped, failed, passed: total - failed - skipped, durationS: Number(m[4]),
    failures: ids.map(id => (locs.has(id) ? { id, loc: locs.get(id) } : { id })),
  }
}

const readSwiftTesting: Reader = text => {
  const m = /Test run with (\d+) tests? (passed|failed) after ([\d.]+) seconds/.exec(text)
  if (!m) return null
  const ids = [...text.matchAll(/✘ Test (\S+) failed after/g)].map(f => f[1] ?? '')
  const total = Number(m[1])
  const failed = m[2] === 'failed' ? Math.max(1, ids.length) : 0
  return { total, failed, skipped: 0, passed: total - failed, durationS: Number(m[3]), failures: ids.map(id => ({ id })) }
}

const readPytest: Reader = text => {
  const m = lastMatch(/^=+ (.+?) in ([\d.]+)s\b.*=+\s*$/gm, text)
  if (!m?.[1]) return null
  const n = (word: RegExp) => [...m[1]!.matchAll(word)].reduce((sum, p) => sum + Number(p[1]), 0)
  const passed = n(/(\d+) passed/g); const skipped = n(/(\d+) skipped/g)
  const failed = n(/(\d+) failed/g) + n(/(\d+) errors?/g)
  const ids = [...text.matchAll(/^FAILED (\S+)/gm)].map(f => ({ id: f[1] ?? '' }))
  return { total: passed + failed + skipped, passed, failed, skipped, durationS: Number(m[2]), failures: ids }
}

const readJest: Reader = text => {
  const jest = /Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(\d+) passed, (\d+) total/.exec(text)
  if (jest) {
    return { failed: Number(jest[1] ?? 0), skipped: Number(jest[2] ?? 0), passed: Number(jest[3]), total: Number(jest[4]), failures: [] }
  }
  const vitest = /Tests\s+(?:(\d+) failed \| )?(?:(\d+) skipped \| )?(\d+) passed \((\d+)\)/.exec(text)
  if (vitest) {
    return { failed: Number(vitest[1] ?? 0), skipped: Number(vitest[2] ?? 0), passed: Number(vitest[3]), total: Number(vitest[4]), failures: [] }
  }
  const pass = /^\s*(\d+) pass\s*$/m.exec(text)
  if (!pass) return null
  const fail = Number(/^\s*(\d+) fail\s*$/m.exec(text)?.[1] ?? 0)
  const skip = Number(/^\s*(\d+) skip\s*$/m.exec(text)?.[1] ?? 0)
  const ids = [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map(f => ({ id: f[1] ?? '' }))
  return { passed: Number(pass[1]), failed: fail, skipped: skip, total: Number(pass[1]) + fail + skip, failures: ids }
}

const RAW_READERS: Reader[] = [readXcodebuild, readSwiftTesting, readPytest, readJest]

function attempt(reader: Reader, text: string): Counts | null {
  try {
    return reader(text)
  } catch {
    return null
  }
}

export function parseTestOutput(input: { command: string; text: string; exitCode: number }): ParsedRun | null {
  const isTest = isTestCommand(input.command)
  const readers = isTest ? [readCartoon, ...RAW_READERS] : [readCartoon]
  for (const reader of readers) {
    const counts = attempt(reader, input.text)
    if (counts) return { ...counts, exitCode: input.exitCode, parsed: true }
  }
  if (!isTest) return null
  return { total: 0, passed: 0, failed: 0, skipped: 0, failures: [], exitCode: input.exitCode, parsed: false }
}
```

Note: when a reader returns no `durationS`, the key is absent, matching `toEqual`.

- [ ] **Step 6: Run the tests**

Run: `claude plugin test plugins/test-board`
Expected: PASS, `suite.test.ts` and `parse.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add plugins/test-board
git commit -m "feat(test-board): parse test output (cartoon summary + raw readers)"
git push origin HEAD:feat/session-mods
```

---

### Task 3: History rules

**Files:**
- Create: `plugins/test-board/hooks/history.ts`
- Test: `plugins/test-board/tests/history.test.ts`

**Interfaces:**
- Consumes: `TestRun`.
- Produces: `MAX_RUNS = 10`, `MAX_LATEST = 3`, `MAX_FAILURES = 20`, `STORE_SOFT_CAP_BYTES = 2097152`; `appendRun(history: TestRun[], run: TestRun): TestRun[]`; `previousRun(history: TestRun[], run: TestRun): TestRun | undefined`; `touchIndex(index: string[], key: string): string[]`; `type KeySize = { key: string; bytes: number }`; `keysToDrop(sizes: KeySize[], capBytes: number, keep: string): string[]`; `oldestQuarter(index: string[], keep: string): string[]`.

- [ ] **Step 1: Write the failing tests**

`plugins/test-board/tests/history.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { TestRun } from '../types'
import { appendRun, keysToDrop, oldestQuarter, previousRun, touchIndex } from '../hooks/history'

const mk = (at: number, extra: Partial<TestRun> = {}): TestRun => ({
  suite: 'pytest -q', key: '/r::pytest -q', total: 1, passed: 1, failed: 0, skipped: 0,
  failures: [], exitCode: 0, at, parsed: true, ...extra,
})

describe('appendRun', () => {
  test('newest first, capped at 10', () => {
    let h: TestRun[] = []
    for (let at = 1; at <= 12; at += 1) h = appendRun(h, mk(at))
    expect(h.map(r => r.at)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  })
  test('caps failures at 20 and never stores stale', () => {
    const failures = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }))
    const [stored] = appendRun([], mk(1, { failures, stale: true }))
    expect(stored?.failures).toHaveLength(20)
    expect(stored?.stale).toBeUndefined()
  })
})

describe('previousRun', () => {
  test('the newest run older than this one', () => {
    const h = [mk(30), mk(20), mk(10)]
    expect(previousRun(h, mk(30))?.at).toBe(20)
    expect(previousRun([mk(30)], mk(30))).toBeUndefined()
  })
})

describe('index and trimming', () => {
  test('touchIndex moves the key to the front once', () => {
    expect(touchIndex(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(touchIndex([], 'a')).toEqual(['a'])
  })
  test('keysToDrop drops oldest until under the cap, never the kept key', () => {
    const sizes = [{ key: 'new', bytes: 5 }, { key: 'mid', bytes: 5 }, { key: 'old', bytes: 5 }]
    expect(keysToDrop(sizes, 10, 'new')).toEqual(['old'])
    expect(keysToDrop(sizes, 4, 'new')).toEqual(['old', 'mid'])
    expect(keysToDrop(sizes, 100, 'new')).toEqual([])
  })
  test('oldestQuarter drops at least one, never the kept key', () => {
    expect(oldestQuarter(['k', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], 'k')).toEqual(['f', 'g'])
    expect(oldestQuarter(['k', 'a'], 'k')).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, cannot resolve `../hooks/history`.

- [ ] **Step 3: Implement `history.ts`**

`plugins/test-board/hooks/history.ts`:
```ts
import type { TestRun } from '../types'

export const MAX_RUNS = 10
export const MAX_LATEST = 3
export const MAX_FAILURES = 20
export const STORE_SOFT_CAP_BYTES = 2 * 1024 * 1024

export type KeySize = { key: string; bytes: number }

function toStored(run: TestRun): TestRun {
  const { stale: _stale, ...rest } = run
  return { ...rest, failures: run.failures.slice(0, MAX_FAILURES) }
}

export function appendRun(history: TestRun[], run: TestRun): TestRun[] {
  return [toStored(run), ...history].slice(0, MAX_RUNS)
}

export function previousRun(history: TestRun[], run: TestRun): TestRun | undefined {
  return history.find(r => r.at < run.at)
}

export function touchIndex(index: string[], key: string): string[] {
  return [key, ...index.filter(k => k !== key)]
}

/** `sizes` is most-recent-first; drops from the end until the total fits. */
export function keysToDrop(sizes: KeySize[], capBytes: number, keep: string): string[] {
  let total = sizes.reduce((sum, s) => sum + s.bytes, 0)
  const dropped: string[] = []
  for (let i = sizes.length - 1; i >= 0 && total > capBytes; i -= 1) {
    const size = sizes[i]
    if (size === undefined || size.key === keep) continue
    total -= size.bytes
    dropped.push(size.key)
  }
  return dropped
}

export function oldestQuarter(index: string[], keep: string): string[] {
  const candidates = index.filter(k => k !== keep)
  const count = Math.max(1, Math.floor(index.length / 4))
  return candidates.slice(-count)
}
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/test-board`
Expected: PASS, all three suites.

- [ ] **Step 5: Commit**

```bash
git add plugins/test-board
git commit -m "feat(test-board): history append, previous-run and store trimming rules"
git push origin HEAD:feat/session-mods
```

---

### Task 4: Event wiring (record runs, tag subagents, load at start)

**Files:**
- Modify: `plugins/test-board/hooks/register.tsx` (replace the stub)
- Test: `plugins/test-board/tests/register.test.tsx`

**Interfaces:**
- Consumes: `splitCommand`, `resolveDir`, `suiteKey`, `suiteLabel` (Task 1); `parseTestOutput` (Task 2); `appendRun`, `touchIndex`, `keysToDrop`, `oldestQuarter`, `MAX_LATEST`, `STORE_SOFT_CAP_BYTES` (Task 3).
- Produces: `$.state` `test-board.latest` and `test-board.expanded`; `$.store` `runs:<key>` and `index`. Task 5 adds the band to this file.

- [ ] **Step 1: Write the failing wiring tests**

`plugins/test-board/tests/register.test.tsx`:
```tsx
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { TestRun } from '../types'
import { PYTEST_RAW } from './fixtures/output'

const ROOT = '/repo/wt-a'
const LATEST = { plugin: 'test-board', key: 'latest' } as const

function world(on: On, cwd = ROOT): void {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.cwd', () => cwd)
  on('process.run', () => ({ exitCode: 0, stdout: `${ROOT}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }))
}

function bash(on: On, stdout: string, extra: Record<string, unknown> = {}): void {
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout, stderr: '', interrupted: false, ...extra },
    text: stdout,
  }))
}

async function latest($: Engine): Promise<TestRun[]> {
  return ((await $.state.get(LATEST)).value ?? []) as TestRun[]
}

type SpawnArgs = Parameters<Engine['agent']['spawn']>[0]
const spawnArgs = (extra: Partial<SpawnArgs>): SpawnArgs =>
  ({ tool_use_id: 't1', prompt: 'p', description: 'ios-fixer', subagentType: 'general-purpose', ...extra }) as SpawnArgs

describe('recording', () => {
  test('a main-loop test run sets latest and history', async ($, on) => {
    world(on); bash(on, PYTEST_RAW)
    const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q 2>&1 | tail -5' })
    expect(ran.text).toBe(PYTEST_RAW)
    const [run] = await latest($)
    expect(run).toMatchObject({ suite: 'pytest -q', key: `${ROOT}::pytest -q`, failed: 1, passed: 10 })
    expect(run?.via).toBeUndefined()
    expect(await $.store.get(`runs:${ROOT}::pytest -q`)).toHaveLength(1)
  })

  test('a subagent run carries its description', async ($, on) => {
    world(on); bash(on, PYTEST_RAW)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
    await $.agent.spawn(spawnArgs({}))
    await $.tool.call({ tool: 'Bash', command: 'pytest -q', agentId: 'a1' })
    expect((await latest($))[0]?.via).toBe('ios-fixer')
  })

  test('an unknown agent id is tagged workflow', async ($, on) => {
    world(on); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q', agentId: 'zz' })
    expect((await latest($))[0]?.via).toBe('workflow')
  })

  test('a non-test command records nothing', async ($, on) => {
    world(on); bash(on, 'README.md')
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(await latest($)).toEqual([])
  })

  test('a backgrounded test command records nothing', async ($, on) => {
    world(on); bash(on, '', { backgroundTaskId: 'b1' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await latest($)).toEqual([])
  })

  test('a denied call passes through and records nothing', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked' }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(ran.deny).toBe('blocked')
    expect(await latest($)).toEqual([])
  })

  test('an errored run takes the exit code from the text', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'Exit code 139', text: 'Exit code 139\nsegfault' }))
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect((await latest($))[0]).toMatchObject({ parsed: false, exitCode: 139 })
  })

  test('same suite twice in one turn shows once; a new turn replaces latest', async ($, on) => {
    world(on); bash(on, PYTEST_RAW)
    on('prompt.submit', (_$, e) => e as never)
    await $.prompt.submit({ text: 'run tests' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await latest($)).toHaveLength(1)
    await $.tool.call({ tool: 'Bash', command: 'swift test' })
    expect(await latest($)).toHaveLength(2)
    await $.prompt.submit({ text: 'again' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await latest($)).toHaveLength(1)
  })

  test('a leading cd decides the worktree', async ($, on) => {
    mock.store(on); mock.clock(on)
    on('session.cwd', () => ROOT)
    on('process.run', (_$, e) => ({
      exitCode: 0, stdout: `${e.init?.cwd ?? ''}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
    }))
    bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'cd ../wt-b && pytest -q' })
    expect((await latest($))[0]?.key).toBe('/repo/wt-b::pytest -q')
  })
})

describe('session start', () => {
  test('loads the worktree’s most recent run as stale', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 0, skipped: 0,
      failures: [], exitCode: 0, at: 5, parsed: true,
    }
    mock.store(on, { index: [`/other::x`, old.key], [`runs:${old.key}`]: [old] })
    mock.clock(on)
    on('session.cwd', () => ROOT)
    on('process.run', () => ({ exitCode: 0, stdout: `${ROOT}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }))
    on('session.start', (_$, e) => e as never)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect((await latest($))[0]).toMatchObject({ key: old.key, stale: true })
  })
})
```

If the kit's bottom for `prompt.submit` or `session.start` needs a specific result shape, answer the shape `PromptSubmitResult` / `SessionStartResult` declare instead of `e as never`; the assertions do not change.

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, `latest` stays `[]` (the stub hooks nothing).

- [ ] **Step 3: Implement the wiring**

`plugins/test-board/hooks/register.tsx`:
```tsx
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRun } from '../types'
import { appendRun, keysToDrop, MAX_LATEST, oldestQuarter, STORE_SOFT_CAP_BYTES, touchIndex } from './history'
import { parseTestOutput } from './parse'
import { resolveDir, splitCommand, suiteKey, suiteLabel } from './suite'

const latest = atom({ plugin: 'test-board', key: 'latest' } as const, [] as TestRun[])
const expanded = atom({ plugin: 'test-board', key: 'expanded' } as const, false)

type Loop = { description: string; cwd?: string; isWorkflow: boolean }
type Ran = { deny?: string; isError?: true; result?: unknown; text?: string }

const asRuns = (v: unknown): TestRun[] => (Array.isArray(v) ? (v as TestRun[]) : [])
const asKeys = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

function outputOf(ran: Ran): string | null {
  if (ran.deny !== undefined) return null
  const result = ran.result as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown } | undefined
  if (typeof result?.backgroundTaskId === 'string') return null
  if (typeof result?.stdout === 'string') {
    return `${result.stdout}\n${typeof result.stderr === 'string' ? result.stderr : ''}`
  }
  return ran.text ?? ''
}

function exitCodeOf(ran: Ran): number {
  if (ran.isError !== true) return 0
  return Number(/Exit code (\d+)/.exec(ran.text ?? '')?.[1]) || 1
}

export const register: Register = on => {
  const loops = new Map<string, Loop>()
  const roots = new Map<string, string>()
  let isNewTurn = true

  async function worktreeRoot($: EngineInterface, cwd: string): Promise<string> {
    const cached = roots.get(cwd)
    if (cached !== undefined) return cached
    let root = cwd
    try {
      const out = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
      if (out.exitCode === 0 && out.stdout.trim() !== '') root = out.stdout.trim()
    } catch {
      // not a repo, or git missing: the cwd stands in for the worktree
    }
    roots.set(cwd, root)
    return root
  }

  async function writeRuns($: EngineInterface, key: string, runs: TestRun[], index: string[], drop: string[]) {
    for (const k of drop) await $.store.delete(`runs:${k}`)
    await $.store.set('index', index.filter(k => !drop.includes(k)))
    await $.store.set(`runs:${key}`, runs)
  }

  async function saveRun($: EngineInterface, run: TestRun): Promise<void> {
    const runs = appendRun(asRuns(await $.store.get(`runs:${run.key}`)), run)
    const index = touchIndex(asKeys(await $.store.get('index')), run.key)
    const sizes = await Promise.all(index.map(async key => ({
      key,
      bytes: JSON.stringify(key === run.key ? runs : (await $.store.get(`runs:${key}`)) ?? []).length,
    })))
    const drop = keysToDrop(sizes, STORE_SOFT_CAP_BYTES, run.key)
    try {
      await writeRuns($, run.key, runs, index, drop)
    } catch {
      try {
        const more = oldestQuarter(index.filter(k => !drop.includes(k)), run.key)
        await writeRuns($, run.key, runs, index, [...drop, ...more])
      } catch (err) {
        $.ui.log(`test-board: history not saved: ${String(err).slice(0, 120)}`)
      }
    }
  }

  async function record($: EngineInterface, command: string, agentId: string | undefined, ran: Ran) {
    const text = outputOf(ran)
    if (text === null) return
    const parts = splitCommand(command)
    const parsed = parseTestOutput({ command: parts.normalized, text, exitCode: exitCodeOf(ran) })
    if (parsed === null) return
    const loop = agentId === undefined ? undefined : loops.get(agentId)
    const base = loop?.cwd ?? (await $.session.cwd())
    const cwd = parts.cdDir === undefined ? base : resolveDir(base, parts.cdDir)
    const root = await worktreeRoot($, cwd)
    const via = agentId === undefined ? undefined : loop === undefined || loop.isWorkflow ? 'workflow' : loop.description
    const run: TestRun = {
      ...parsed,
      suite: suiteLabel(parts.normalized),
      key: suiteKey(root, parts.normalized),
      at: await $.clock.now(),
      ...(via === undefined ? {} : { via }),
    }
    await saveRun($, run)
    const isFresh = isNewTurn
    isNewTurn = false
    await update($, latest, list =>
      [run, ...(isFresh ? [] : list.filter(r => r.key !== run.key && r.stale !== true))].slice(0, MAX_LATEST))
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      await record($, e.command, e.agentId, ran as Ran)
    } catch (err) {
      $.ui.log(`test-board: run not recorded: ${String(err).slice(0, 120)}`)
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId !== undefined) {
      loops.set(started.agentId, {
        description: e.description,
        ...(e.cwd === undefined ? {} : { cwd: e.cwd }),
        isWorkflow: e.workflow !== undefined,
      })
    }
    return started
  })

  on('prompt.submit', ($, e, next) => {
    isNewTurn = true
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    try {
      const root = await worktreeRoot($, await $.session.cwd())
      const key = asKeys(await $.store.get('index')).find(k => k.startsWith(`${root}::`))
      const newest = key === undefined ? undefined : asRuns(await $.store.get(`runs:${key}`))[0]
      if (newest !== undefined) await update($, latest, () => [{ ...newest, stale: true }])
    } catch (err) {
      $.ui.log(`test-board: history not loaded: ${String(err).slice(0, 120)}`)
    }
    return next(e)
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/test-board`
Expected: PASS, all four suites. If `on('session.cwd', …)` is not the event the kit raises for `$.session.cwd()`, grep `'session.cwd'` in the declaration file and use the name it gives; do not change what is asserted.

- [ ] **Step 5: Validate and commit**

Run: `claude plugin validate plugins/test-board`
Expected: lists hooks on `tool.call` (Bash), `agent.spawn`, `prompt.submit`, `session.start`; `$.state` keys `test-board.latest`, `test-board.expanded` held to the contract; no refusal. The gating lines for `tool.call` / `prompt.submit` are facts, not errors (the hooks call `next` first and never deny).
```bash
git add plugins/test-board
git commit -m "feat(test-board): record test runs from main loop and subagents"
git push origin HEAD:feat/session-mods
```

---

### Task 5: The band (lines, arrows, expand, narrow terminals, stacking)

**Files:**
- Create: `plugins/test-board/hooks/format.ts`
- Test: `plugins/test-board/tests/format.test.ts`
- Modify: `plugins/test-board/hooks/register.tsx` (add one `ui.render` hook and two imports)
- Modify: `plugins/test-board/tests/register.test.tsx` (append a `band` describe)

**Interfaces:**
- Consumes: `TestRun`, `previousRun` (Task 3), `latest`/`expanded` atoms (Task 4).
- Produces: `type LineParts = { label: string; counts: string; isFailing: boolean; trend?: string; duration?: string; prev?: string; via?: string }`; `lineParts(run: TestRun, prev: TestRun | undefined, now: number, columns: number): LineParts`; `joinParts(p: LineParts): string`; `formatDuration(seconds: number): string`; `formatAgo(ms: number): string`; `NARROW_COLUMNS = 80`; `MAX_SHOWN_FAILURES = 10`.

- [ ] **Step 1: Write the failing format tests**

`plugins/test-board/tests/format.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { TestRun } from '../types'
import { formatAgo, formatDuration, joinParts, lineParts } from '../hooks/format'

const H = 3_600_000
const mk = (extra: Partial<TestRun> = {}): TestRun => ({
  suite: 'xcodebuild test -scheme Cubby', key: '/p/Cubby::xcodebuild test -scheme Cubby',
  total: 417, passed: 412, failed: 3, skipped: 2, durationS: 72, failures: [], exitCode: 65,
  at: 10 * H, parsed: true, via: 'ios-fixer', ...extra,
})
const prev = mk({ passed: 415, failed: 0, at: 8 * H, via: undefined })

describe('lineParts', () => {
  test('full line matches the spec example', () => {
    expect(joinParts(lineParts(mk(), prev, 10 * H, 200))).toBe(
      'Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   ▲3 ✗   1m12s   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer')
  })
  test('first run, falling failures', () => {
    expect(lineParts(mk(), undefined, 10 * H, 200).prev).toBe('first run')
    expect(lineParts(mk({ failed: 1 }), mk({ failed: 4, at: 1 }), 10 * H, 200).trend).toBe('▼3 ✗')
  })
  test('unparsed run', () => {
    expect(lineParts(mk({ parsed: false, exitCode: 1, suite: 'bun test' }), undefined, 0, 200).counts)
      .toBe('ran · exit 1 · counts unavailable')
  })
  test('narrow terminal drops via, then prev, then duration', () => {
    const at79 = lineParts(mk(), prev, 10 * H, 79)
    expect(at79.via).toBeUndefined()
    expect(joinParts(at79).length <= 79).toBe(true)
    const at60 = lineParts(mk(), prev, 10 * H, 60)
    expect([at60.via, at60.prev, at60.duration]).toEqual([undefined, undefined, undefined])
  })
})

describe('units', () => {
  test('durations', () => expect([formatDuration(9.6), formatDuration(72), formatDuration(61)]).toEqual(['10s', '1m12s', '1m01s']))
  test('ages', () => expect([formatAgo(30_000), formatAgo(5 * 60_000), formatAgo(2 * H), formatAgo(72 * H)])
    .toEqual(['just now', '5m ago', '2h ago', '3d ago']))
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, cannot resolve `../hooks/format`.

- [ ] **Step 3: Implement `format.ts`**

`plugins/test-board/hooks/format.ts`:
```ts
import type { TestRun } from '../types'

export const NARROW_COLUMNS = 80
export const MAX_SHOWN_FAILURES = 10
const GAP = '   '

export type LineParts = {
  label: string; counts: string; isFailing: boolean
  trend?: string; duration?: string; prev?: string; via?: string
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function repoName(key: string): string {
  return key.slice(0, key.indexOf('::')).split('/').filter(Boolean).pop() ?? ''
}

function counts(run: TestRun): string {
  return run.parsed
    ? `${run.passed} ✓  ${run.failed} ✗  ${run.skipped} skip`
    : `ran · exit ${run.exitCode} · counts unavailable`
}

export function joinParts(p: LineParts): string {
  return [p.label, p.counts, p.trend, p.duration, p.prev, p.via].filter(Boolean).join(GAP)
}

export function lineParts(run: TestRun, prev: TestRun | undefined, now: number, columns: number): LineParts {
  const delta = prev?.parsed && run.parsed ? run.failed - prev.failed : 0
  let parts: LineParts = {
    label: `${repoName(run.key)} · ${run.suite}`,
    counts: counts(run),
    isFailing: run.parsed ? run.failed > 0 : run.exitCode !== 0,
    ...(delta > 0 ? { trend: `▲${delta} ✗` } : delta < 0 ? { trend: `▼${-delta} ✗` } : {}),
    ...(run.durationS === undefined ? {} : { duration: formatDuration(run.durationS) }),
    prev: prev === undefined
      ? 'first run'
      : `prev ${prev.parsed ? `${prev.passed} ✓ ${prev.failed} ✗` : `ran · exit ${prev.exitCode}`} · ${formatAgo(now - prev.at)}`,
    ...(run.via === undefined ? {} : { via: `via ${run.via}` }),
  }
  if (columns < NARROW_COLUMNS) parts = { ...parts, via: undefined }
  for (const field of ['via', 'prev', 'duration'] as const) {
    if (joinParts(parts).length <= columns) break
    parts = { ...parts, [field]: undefined }
  }
  return parts
}
```

- [ ] **Step 4: Run the format tests**

Run: `claude plugin test plugins/test-board`
Expected: PASS for `format.test.ts`.

- [ ] **Step 5: Write the failing band tests**

Append to `plugins/test-board/tests/register.test.tsx` (add `RenderPropsOf`, `Register` to the `claude-code` type import):
```tsx
const bandProps = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { bodyRows: 11 } }) as unknown as RenderPropsOf['AbovePrompt']

function emptyBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const otherBand: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return <Box flexDirection="column"><Text>other band</Text>{await next(e)}</Box>
  })
}

describe('band', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: draws the run and expands failures`, async ($, on) => {
      world(on); bash(on, PYTEST_RAW); emptyBand(on)
      await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
      const ui = await $.ui.mount({ plugin: 'test-board', surface, component: 'AbovePrompt', props: bandProps(120) })
      expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
      expect(await ui.find({ text: /first run/ })).toBeDefined()
      expect(await ui.find({ text: /tests\/test_a\.py::test_x/ })).toBeUndefined()
      await ui.press({ key: 'run-0' })
      expect(await ui.find({ text: /tests\/test_a\.py::test_x/ })).toBeDefined()
    })
  }

  test('draws nothing of its own when there is no run', async ($, on) => {
    world(on); emptyBand(on)
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('stacks with another mod’s band', { plugins: [{ name: 'other-band', register: otherBand }] }, async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.find({ text: /other band/ })).toBeDefined()
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
  })

  test('narrow terminal drops the via tag', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q', agentId: 'zz' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(70) })
    expect(await ui.find({ text: /via workflow/ })).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `claude plugin test plugins/test-board`
Expected: FAIL, the band tests find no `1 ✗` text (no `ui.render` hook yet).

- [ ] **Step 7: Add the band hook**

In `plugins/test-board/hooks/register.tsx`, change the first import to `import { atom, read, update } from 'claude-code'`, add `import { lineParts, MAX_SHOWN_FAILURES } from './format'` and `previousRun` to the `./history` import, then add inside `register`, after the `session.start` hook:
```tsx
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const runs = await read($, latest)
    if (runs.length === 0 || e.props.hasSurvey) return next(e)
    const isOpen = await read($, expanded)
    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await Promise.all(runs.map(async run => ({
      run,
      parts: lineParts(run, previousRun(asRuns(await $.store.get(`runs:${run.key}`)), run), now, e.props.bodyColumns),
    })))
    return (
      <Box flexDirection="column">
        {rows.map(({ run, parts }, i) => (
          <Box flexDirection="column">
            <Button key={`run-${i}`} plain onPress={() => update($, expanded, v => !v)}>
              <Text dimColor={run.stale === true}>{parts.label}   </Text>
              <Text color={parts.isFailing ? 'error' : undefined} dimColor={run.stale === true}>{parts.counts}</Text>
              <Text dimColor={run.stale === true}>
                {[parts.trend, parts.duration].filter(Boolean).map(s => `   ${s}`).join('')}
              </Text>
              <Text dimColor>{[parts.prev, parts.via].filter(Boolean).map(s => `   ${s}`).join('')}</Text>
            </Button>
            {isOpen && run.failures.slice(0, MAX_SHOWN_FAILURES).map(f => (
              <Text dimColor>{`    ${f.id}${f.loc === undefined ? '' : `  ${f.loc}`}`}</Text>
            ))}
          </Box>
        ))}
        {await next(e)}
      </Box>
    )
  })
```

If validation refuses `color={undefined}`, spread it instead: `{...(parts.isFailing ? { color: 'error' } : {})}`.

- [ ] **Step 8: Run all tests**

Run: `claude plugin test plugins/test-board`
Expected: PASS, all five suites, on both surfaces.

- [ ] **Step 9: Commit**

```bash
git add plugins/test-board
git commit -m "feat(test-board): band with trend arrows, expand and narrow-terminal drops"
git push origin HEAD:feat/session-mods
```

---

### Task 6: README and local gates

**Files:**
- Create: `plugins/test-board/README.md`

**Interfaces:**
- Consumes: the finished plugin.
- Produces: a plugin that passes all three local gates, for plan 02's PR task.

- [ ] **Step 1: Write the README**

`plugins/test-board/README.md`:
````markdown
# test-board

A Claude Code mod. After every test run, from the main session or a subagent, a band
above the prompt shows how many tests passed, failed and were skipped, next to the
previous run of the same suite in the same worktree.

```
Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   ▲3 ✗   1m12s   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer
```

- Press the line to list up to 10 failing tests with their locations.
- It reads cartoon's test summary first (pytest, unittest, jest, vitest, swift-test,
  xcodebuild-test, cargo-test, go-test, phpunit, rspec), then raw xcodebuild, swift test,
  pytest, jest/vitest and bun output.
- A recognised test command whose output it cannot read shows `ran · exit N · counts unavailable`.
- It never blocks or changes a tool call, and makes no model calls.

## Install

```
/plugin install test-board --marketplace abhijitbansal/claude-skills
```

## Data

History lives in the plugin's store: the last 10 runs per suite per worktree, up to 2 MiB.
Session Compass reads the latest runs from `$.state` `test-board.latest` when both are installed.

## Develop

```
claude --plugin-dir plugins/test-board      # lays .claude-plugin/types (gitignored)
npx -y -p typescript@5.6.3 tsc -p plugins/test-board
claude plugin validate plugins/test-board
claude plugin test plugins/test-board
```
````

- [ ] **Step 2: Lay the types and type-check**

The person (or the executor, in an interactive terminal) runs `claude --plugin-dir plugins/test-board` once and exits; this writes `plugins/test-board/.claude-plugin/types/`.
Run: `npx -y -p typescript@5.6.3 tsc -p plugins/test-board`
Expected: no errors. Fix types in the plugin, never by loosening `tsconfig.json`.

- [ ] **Step 3: Run the other two gates**

Run: `claude plugin validate plugins/test-board`
Expected: no refusal.
Run: `claude plugin test plugins/test-board`
Expected: every test passes.
Run: `git status --short`
Expected: `.claude-plugin/types/` does not appear (gitignored).

- [ ] **Step 4: Live smoke check [person]**

In `claude --plugin-dir plugins/test-board`, ask Claude to run `uv tool run pytest tests/pytest -q` (`bats` is not a command the mod recognises). Expected: the band shows `claude-skills · uv tool run pytest tests/pytest -q   N ✓ …   first run`. Run it again: `prev …` appears. Record the outcome in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugins/test-board/README.md
git commit -m "docs(test-board): README with install and develop steps"
git push origin HEAD:feat/session-mods
```
