import type { TestFailure, TestRun } from '../types'

export type ParsedRun = Pick<TestRun,
  'total' | 'passed' | 'failed' | 'skipped' | 'durationS' | 'failures' | 'exitCode' | 'parsed'>
type Counts = Omit<ParsedRun, 'exitCode' | 'parsed'>
type Reader = (text: string) => Counts | null

// Anchored to the start of a command segment (optionally behind a runner prefix), so `cat pytest.log` is not a test run.
const RUNNER_PREFIX = '(?:(?:python3?\\s+-m|npx|bunx|uv\\s+run|poetry\\s+run|pnpm\\s+exec|pnpm\\s+dlx|yarn)\\s+)*'
const TEST_COMMAND = new RegExp(
  `(?:^|[;&|]\\s*)${RUNNER_PREFIX}(?:xcodebuild\\b.*\\btest\\b|swift\\s+test\\b|pytest\\b|jest\\b|vitest\\b|bun\\s+test\\b|(?:npm|pnpm|yarn)\\s+(?:run\\s+)?test\\b|cargo\\s+test\\b|go\\s+test\\b|fastlane\\s+(?:scan|test)\\b)`,
)

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

// Final pytest line: `=== 1 failed, 10 passed in 3.50s ===` (default) or bare `1 failed, 10 passed in 3.50s` (-q).
const PYTEST_SUMMARY = /^(?:=+ )?((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in ([\d.]+)s\b/gm

const readPytest: Reader = text => {
  const m = lastMatch(PYTEST_SUMMARY, text)
  if (!m?.[1]) return null
  const counts = m[1]
  const n = (word: RegExp) => [...counts.matchAll(word)].reduce((sum, p) => sum + Number(p[1]), 0)
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
