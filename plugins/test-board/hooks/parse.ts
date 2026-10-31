import type { TestFailure, TestRun } from '../types'

export type ParsedRun = Pick<TestRun,
  'total' | 'passed' | 'failed' | 'skipped' | 'durationS' | 'failures' | 'exitCode' | 'parsed' | 'commandStatus' | 'countsIssue' | 'outputIncomplete'>
type Counts = Pick<ParsedRun, 'total' | 'passed' | 'failed' | 'skipped' | 'durationS' | 'failures'>
// A reader that finds one summary per run returns them all; repeats of one format are summed (see `attempt`).
type Reader = (text: string) => Counts | Counts[] | null

// Anchored to the start of a command segment (optionally behind a runner prefix), so `cat pytest.log` is not a test run.
const RUNNER_PREFIX = '(?:(?:python3?\\s+-m|npx|bunx|uv\\s+run|uv\\s+tool\\s+run|uvx|poetry\\s+run|pnpm\\s+exec|pnpm\\s+dlx|yarn)\\s+)*'
const TEST_COMMAND = new RegExp(
  `(?:^|[;&|]\\s*)${RUNNER_PREFIX}(?:xcodebuild\\b(?:\\s+[^\\s;&|]+)*?\\s+test(?:-without-building)?(?=\\s|$|[;&|])|swift\\s+test\\b|pytest\\b|jest\\b|vitest\\b|bun\\s+test\\b|(?:npm|pnpm|yarn)\\s+(?:run\\s+)?test\\b|cargo\\s+test\\b|go\\s+test\\b|fastlane\\s+(?:scan|test)\\b)`,
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
  const m = /^summary\{total,passed,failed,skipped,duration_s\}:[ \t]*(\d+),(\d+),(\d+),(\d+),([\d.]+)[ \t]*\r?$/m.exec(text)
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
  const total = Number(m[1]); const skipped = Number(m[2] ?? 0)
  // XCTest's "N failures" counts failed assertions, not tests: prefer the distinct failed case ids.
  const failed = Math.min(total, ids.length > 0 ? ids.length : Number(m[3]))
  return {
    total, skipped, failed, passed: Math.max(0, total - failed - skipped), durationS: Number(m[4]),
    failures: ids.map(id => (locs.has(id) ? { id, loc: locs.get(id) } : { id })),
  }
}

const readSwiftTesting: Reader = text => {
  const runs = [...text.matchAll(/Test run with (\d+) tests?(?: in \d+ suites?)? (passed|failed) after ([\d.]+) seconds/g)]
  let from = 0
  return runs.map((m, i) => {
    // A run's failed tests are printed before its summary line; the last run also takes any recap after it.
    const ids = [...text.slice(from, i === runs.length - 1 ? undefined : m.index).matchAll(/✘ Test (\S+) failed after/g)].map(f => f[1] ?? '')
    from = m.index + m[0].length
    const total = Number(m[1])
    const failed = m[2] === 'failed' ? Math.max(1, ids.length) : 0
    return { total, failed, skipped: 0, passed: total - failed, durationS: Number(m[3]), failures: ids.map(id => ({ id })) }
  })
}

// Final pytest line: `=== 1 failed, 10 passed in 3.50s ===` (default) or bare `1 failed, 10 passed in 3.50s` (-q).
const PYTEST_SUMMARY = /^(?:=+ )?((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in ([\d.]+)s\b/gm

// `swift test` prints an XCTest summary (possibly "Executed 0 tests") and then a swift-testing run line.
// Sum both when present; an empty XCTest run therefore never shadows swift-testing.
// XCTest keeps only the last destination's total, so beside it swift-testing keeps only its last run too.
const readSwiftPackage: Reader = text => {
  const xctest = attempt(readXcodebuild, text)
  const swiftRuns = readSwiftTesting(text)
  const lastRun = Array.isArray(swiftRuns) ? swiftRuns.slice(-1) : swiftRuns
  const swift = attempt(() => (xctest !== null && xctest.total > 0 ? lastRun : swiftRuns), text)
  const parts = [xctest, swift].filter((c): c is Counts => c !== null)
  const live = parts.filter(c => c.total > 0)
  if (live.length === 0) return parts[0] ?? null
  if (live.length === 1) return live[0] ?? null
  return sumCounts(live)
}

const readPytest: Reader = text => {
  const ids = [...text.matchAll(/^FAILED (\S+)/gm)].map(f => ({ id: f[1] ?? '' }))
  return [...text.matchAll(PYTEST_SUMMARY)].map((m, i) => {
    const n = (word: RegExp) => [...(m[1] ?? '').matchAll(word)].reduce((sum, p) => sum + Number(p[1]), 0)
    const passed = n(/(\d+) passed/g); const skipped = n(/(\d+) skipped/g)
    const failed = n(/(\d+) failed/g) + n(/(\d+) errors?/g)
    // FAILED lines are not attributable to a summary: they ride on the first.
    return { total: passed + failed + skipped, passed, failed, skipped, durationS: Number(m[2]), failures: i === 0 ? ids : [] }
  })
}

function tokenCounts(list: string): { failed: number; skipped: number; passed: number; todo: number } {
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}\\b`).exec(list)?.[1] ?? 0)
  return { failed: n('failed'), skipped: n('skipped'), passed: n('passed'), todo: n('todo') }
}

const readJest: Reader = text =>
  [...text.matchAll(/^\s*Tests:\s+(.+)$/gm)].flatMap(m => {
    const total = /(\d+) total/.exec(m[1] ?? '')
    if (!total) return []
    const t = tokenCounts(m[1] ?? '')
    return [{ failed: t.failed, skipped: t.skipped + t.todo, passed: t.passed, total: Number(total[1]), failures: [] }]
  })

const readVitest: Reader = text =>
  [...text.matchAll(/^\s*Tests\s+(.+?) \((\d+)\)\s*$/gm)].map(m => {
    const t = tokenCounts(m[1] ?? '')
    return { failed: t.failed, skipped: t.skipped + t.todo, passed: t.passed, total: Number(m[2]), failures: [] }
  })

// bun prints bare `N pass` / `N fail` / `N skip` lines; repeats cannot be paired up, so they stay conflicting (see repeatedBun).
const readBun: Reader = text => {
  const pass = /^\s*(\d+) pass\s*$/m.exec(text)
  if (!pass) return null
  const fail = Number(/^\s*(\d+) fail\s*$/m.exec(text)?.[1] ?? 0)
  const skip = Number(/^\s*(\d+) skip\s*$/m.exec(text)?.[1] ?? 0)
  const ids = [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map(f => ({ id: f[1] ?? '' }))
  return { passed: Number(pass[1]), failed: fail, skipped: skip, total: Number(pass[1]) + fail + skip, failures: ids }
}

const RAW_READERS: Reader[] = [readSwiftPackage, readPytest, readJest, readVitest, readBun]

function sumCounts(list: Counts[]): Counts {
  const sum = (pick: (c: Counts) => number) => list.reduce((acc, c) => acc + pick(c), 0)
  const durationS = list.reduce<number | undefined>((acc, c) => (c.durationS === undefined ? acc : (acc ?? 0) + c.durationS), undefined)
  return {
    total: sum(c => c.total), passed: sum(c => c.passed), failed: sum(c => c.failed), skipped: sum(c => c.skipped),
    ...(durationS === undefined ? {} : { durationS }), failures: list.flatMap(c => c.failures),
  }
}

// Repeats of one format are summed, but only if each is possible on its own: an invalid one is returned as it is.
function attempt(reader: Reader, text: string): Counts | null {
  try {
    const found = reader(text)
    if (!Array.isArray(found)) return found
    return found.find(c => !validCounts(c)) ?? (found.length === 0 ? null : found.length === 1 ? found[0] ?? null : sumCounts(found))
  } catch {
    return null
  }
}

function validCounts(c: Counts): boolean {
  return [c.total, c.passed, c.failed, c.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
    && Number.isSafeInteger(c.passed + c.failed + c.skipped)
    && c.total === c.passed + c.failed + c.skipped
    && (c.durationS === undefined || (Number.isFinite(c.durationS) && c.durationS >= 0))
}

// bun's bare pass/fail/skip lines cannot be paired across repeats. The other formats sum their repeats
// (XCTest repeats nested suite totals and keeps the last), so a monorepo run does not lose its counts.
function repeatedBun(text: string): boolean {
  return [/^[ \t]*\d+ pass[ \t]*\r?$/gm, /^[ \t]*\d+ fail[ \t]*\r?$/gm, /^[ \t]*\d+ skip[ \t]*\r?$/gm]
    .some(re => [...text.matchAll(re)].length > 1)
}

export function parseTestOutput(input: {
  command: string; text: string; exitCode: number | null
  commandStatus?: TestRun['commandStatus']; outputIncomplete?: boolean
}): ParsedRun | null {
  const isTest = isTestCommand(input.command)
  const exitCode = Number.isSafeInteger(input.exitCode) ? input.exitCode : null
  const base: ParsedRun = {
    total: 0, passed: 0, failed: 0, skipped: 0, failures: [], exitCode, parsed: false,
    commandStatus: input.commandStatus ?? (exitCode === null ? 'unknown' : 'exited'),
    ...(input.outputIncomplete ? { outputIncomplete: true } : {}),
  }
  const cartoonLines = [...input.text.matchAll(/^summary\{total,passed,failed,skipped,duration_s\}:/gm)].length
  if (!isTest && cartoonLines === 0) return null
  if (cartoonLines > 1 || (isTest && repeatedBun(input.text))) return { ...base, countsIssue: 'conflicting' }
  const cartoon = cartoonLines === 0 ? null : attempt(readCartoon, input.text)
  if (cartoonLines === 1 && (cartoon === null || !validCounts(cartoon))) return { ...base, countsIssue: 'invalid' }
  const candidates = [cartoon, ...(isTest ? RAW_READERS.map(reader => attempt(reader, input.text)) : [])]
    .filter((c): c is Counts => c !== null)
  if (candidates.some(c => !validCounts(c))) return { ...base, countsIssue: 'invalid' }
  if (candidates.length > 1) return { ...base, countsIssue: 'conflicting' }
  return candidates[0] === undefined ? base : { ...base, ...candidates[0], parsed: true }
}
