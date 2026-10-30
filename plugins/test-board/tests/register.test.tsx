import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, Register, RenderPropsOf } from 'claude-code'

import type { TestRun } from '../types'
import { PYTEST_RAW } from './fixtures/output'

const ROOT = '/repo/wt-a'
const LATEST = { plugin: 'test-board', key: 'latest' } as const

type Proc = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const proc = (stdout: string): Proc => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

function store(on: On, seed: Record<string, unknown> = {}, isReadFailing = false, failRunSets = 0): Map<string, unknown> {
  const data = new Map<string, unknown>(Object.entries(seed))
  let failures = failRunSets
  on('store.get', (_$, e) => {
    if (isReadFailing) throw new Error('store unavailable')
    return { value: data.get(e.key) }
  })
  on('store.set', (_$, e) => {
    if (e.key.startsWith('runs:') && failures > 0) {
      failures -= 1
      throw new Error('quota exceeded')
    }
    data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  return data
}

function world(
  on: On, getCwd: () => string = () => ROOT, isReadFailing = false, seed: Record<string, unknown> = {}, failRunSets = 0,
): { writes: Map<string, unknown>; seen: Map<string, unknown>; clock: MockClock } {
  const writes = store(on, seed, isReadFailing, failRunSets)
  const seen = watchState(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.cwd', () => ({ value: getCwd() }))
  on('process.run', (_$, e) => ({ value: proc(`${e.init?.cwd ?? ROOT}\n`) }))
  return { writes, seen, clock }
}

function bash(on: On, stdout: string, extra: Record<string, unknown> = {}): void {
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout, stderr: '', interrupted: false, ...extra },
    text: stdout,
  }))
}

// The test kit answers $.state itself, so a recorder on state.set sees every write the plugin makes.
function watchState(on: On): Map<string, unknown> {
  const seen = new Map<string, unknown>()
  on('state.set', (_$, e, next) => {
    seen.set(e.key, e.value)
    return next(e)
  })
  return seen
}

const latest = (seen: Map<string, unknown>): TestRun[] => (seen.get('latest') ?? []) as TestRun[]

function turns(on: On): void {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
}

// agentId is raised by the engine for a subagent's loop; the test input type does not declare it.
const inAgent = (command: string, agentId: string): never => ({ tool: 'Bash', command, agentId }) as never

type SpawnArgs = Parameters<Engine['agent']['spawn']>[0]
const spawnArgs = (extra: Partial<SpawnArgs>): SpawnArgs =>
  ({ tool_use_id: 't1', prompt: 'p', description: 'ios-fixer', subagentType: 'general-purpose', ...extra }) as SpawnArgs

describe('recording', () => {
  test('absence of a structured command status does not invent exit zero', async ($, on) => {
    const { seen } = world(on); bash(on, '10 passed in 0.5s')
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ parsed: true, exitCode: null, commandStatus: 'unknown' })
  })

  test('interruption qualifies even a complete-looking passing summary', async ($, on) => {
    const { seen } = world(on); bash(on, '10 passed in 0.5s', { interrupted: true })
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ commandStatus: 'interrupted', outputIncomplete: true, exitCode: null })
  })

  test('stdout cannot forge an authoritative exit code', async ($, on) => {
    const { seen } = world(on)
    const text = 'Exit code 1\nExit code 0\n10 passed in 0.5s'
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: text, text }))
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ commandStatus: 'tool-error', exitCode: 1 })
  })

  test('an exit code that is not the host\'s first line is not read', async ($, on) => {
    const { seen } = world(on)
    const text = '10 passed in 0.5s\nExit code 0'
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: text, text }))
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ commandStatus: 'tool-error', exitCode: null })
  })

  test('a successful call is never given an exit code from its output', async ($, on) => {
    const { seen } = world(on); bash(on, 'Exit code 139\n10 passed in 0.5s')
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ commandStatus: 'unknown', exitCode: null })
  })

  test('a malformed result records unavailable evidence rather than leaving an earlier pass current', async ($, on) => {
    const { seen } = world(on)
    let malformed = false
    on('tool.call', { tool: 'Bash' }, () => (malformed
      ? { result: { stdout: 5 }, text: {} }
      : { result: { stdout: '10 passed in 0.5s' }, text: '10 passed in 0.5s' }) as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]?.parsed).toBe(true)
    malformed = true
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(latest(seen)[0]).toMatchObject({ parsed: false, exitCode: null, commandStatus: 'unknown' })
  })

  test('a main-loop test run sets latest and history', async ($, on) => {
    const { writes, seen } = world(on); bash(on, PYTEST_RAW)
    const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q 2>&1 | tail -5' })
    expect(ran.text).toBe(PYTEST_RAW)
    const [run] = latest(seen)
    expect(run).toMatchObject({ suite: 'pytest -q', key: `${ROOT}::pytest -q`, failed: 1, passed: 10 })
    expect(run?.via).toBeUndefined()
    expect(writes.get(`runs:${ROOT}::pytest -q`)).toHaveLength(1)
    expect(writes.get('index')).toEqual([`${ROOT}::pytest -q`])
  })

  test('a subagent run carries its description', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
    await $.agent.spawn(spawnArgs({}))
    await $.tool.call(inAgent('pytest -q', 'a1'))
    expect(latest(seen)[0]?.via).toBe('ios-fixer')
  })

  test('an unknown agent id is tagged workflow', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW)
    await $.tool.call(inAgent('pytest -q', 'zz'))
    expect(latest(seen)[0]?.via).toBe('workflow')
  })

  test('a spawn-cwd subagent keys on its own directory', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a2' }))
    await $.agent.spawn(spawnArgs({ cwd: '/repo/wt-sub' }))
    await $.tool.call(inAgent('pytest -q', 'a2'))
    expect(latest(seen)[0]?.key).toBe('/repo/wt-sub::pytest -q')
  })

  test('a non-test command records nothing', async ($, on) => {
    const { writes, seen } = world(on); bash(on, 'README.md')
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.text).toBe('README.md')
    expect(latest(seen)).toEqual([])
    expect(writes.size).toBe(0)
  })

  test('a backgrounded test command records nothing', async ($, on) => {
    const { seen } = world(on); bash(on, '', { backgroundTaskId: 'b1' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(ran.result).toMatchObject({ backgroundTaskId: 'b1' })
    expect(latest(seen)).toEqual([])
  })

  test('a denied call passes through and records nothing', async ($, on) => {
    const { seen } = world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked' }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(ran.deny).toBe('blocked')
    expect(latest(seen)).toEqual([])
  })

  test('an errored run takes the host exit code from the first line of the text', async ($, on) => {
    const { seen } = world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'Exit code 139', text: 'Exit code 139\nsegfault' }))
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect(latest(seen)[0]).toMatchObject({ parsed: false, exitCode: 139, commandStatus: 'tool-error' })
  })

  test('same suite twice in one turn shows once; a new turn replaces latest', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW); turns(on)
    await $.prompt.submit({ text: 'run tests' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(latest(seen)).toHaveLength(1)
    await $.tool.call({ tool: 'Bash', command: 'swift test' })
    expect(latest(seen)).toHaveLength(2)
    await $.prompt.submit({ text: 'again' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(latest(seen)).toHaveLength(1)
  })

  test('a mid-turn delivery does not start a new turn', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW); turns(on)
    await $.prompt.submit({ text: 'run tests' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.prompt.submit({ text: 'peer says hi', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'swift test' })
    expect(latest(seen).map(r => r.suite).sort()).toEqual(['pytest -q', 'swift test'])
  })

  test('a leading cd decides the worktree', async ($, on) => {
    const { seen } = world(on); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'cd ../wt-b && pytest -q' })
    expect(latest(seen)[0]?.key).toBe('/repo/wt-b::pytest -q')
  })

  test('the session cwd is read before the command runs', async ($, on) => {
    let cwd = ROOT
    const { seen } = world(on, () => cwd)
    on('tool.call', { tool: 'Bash' }, () => {
      cwd = '/repo/elsewhere'
      return { result: { stdout: PYTEST_RAW, stderr: '', interrupted: false }, text: PYTEST_RAW }
    })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(latest(seen)[0]?.key).toBe(`${ROOT}::pytest -q`)
  })
})

describe('concurrency and failure', () => {
  test('two concurrent runs both land in the index, in history, and in latest', async ($, on) => {
    const { writes, seen } = world(on); bash(on, PYTEST_RAW); turns(on)
    await $.prompt.submit({ text: 'go' } as never)
    await Promise.all([
      $.tool.call({ tool: 'Bash', command: 'pytest -q' }),
      $.tool.call({ tool: 'Bash', command: 'swift test' }),
    ])
    const keys = [`${ROOT}::pytest -q`, `${ROOT}::swift test`]
    expect([...(writes.get('index') as string[])].sort()).toEqual([...keys].sort())
    for (const k of keys) expect(writes.get(`runs:${k}`)).toHaveLength(1)
    expect(latest(seen).map(r => r.key).sort()).toEqual([...keys].sort())
  })

  test('a store read failure still updates latest', async ($, on) => {
    const { seen } = world(on, () => ROOT, true); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(latest(seen)[0]).toMatchObject({ key: `${ROOT}::pytest -q`, failed: 1 })
  })
})

describe('store trimming', () => {
  const stored = (n: string): TestRun => ({
    suite: n, key: n, total: 1, passed: 1, failed: 0, skipped: 0, failures: [], exitCode: 0, at: 5, parsed: true,
  })
  const KEY = `${ROOT}::pytest -q`

  test('a quota failure deletes orphaned runs keys, then the retry succeeds', async ($, on) => {
    const { writes } = world(on, () => ROOT, false, { index: [], 'runs:x': [stored('x')] }, 1); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(writes.has('runs:x')).toBe(false)
    expect(writes.get(`runs:${KEY}`)).toHaveLength(1)
  })

  test('one failed write deletes the oldest quarter and retries', async ($, on) => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const seed: Record<string, unknown> = { index: names }
    for (const n of names) seed[`runs:${n}`] = [stored(n)]
    const { writes } = world(on, () => ROOT, false, seed, 1); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(writes.has('runs:g')).toBe(false)
    expect(writes.has('runs:h')).toBe(false)
    expect(writes.has('runs:a')).toBe(true)
    expect(writes.get(`runs:${KEY}`)).toHaveLength(1)
    expect(writes.get('index')).toEqual([KEY, ...names.slice(0, 6)])
  })

  test('two failed writes log, and latest is still updated', async ($, on) => {
    const logs: string[] = []
    on('ui.log', (_$, e, next) => {
      logs.push((e as unknown as { text: string }).text)
      return next(e)
    })
    const { seen } = world(on, () => ROOT, false, {}, 2); bash(on, PYTEST_RAW)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(logs.some(l => l.includes('history not saved'))).toBe(true)
    expect(latest(seen)[0]).toMatchObject({ key: KEY })
  })
})

describe('session start', () => {
  test('loads the worktree’s most recent run as stale', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 0, skipped: 0,
      failures: [], exitCode: 0, at: 5, parsed: true,
    }
    const seen = watchState(on)
    store(on, { index: [`/other::x`, old.key], [`runs:${old.key}`]: [old] })
    mock.clock(on, { now: 60_000 })
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(latest(seen)[0]).toMatchObject({ key: old.key, stale: true })
  })

  test('does not read the session cwd, using the event cwd', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 0, skipped: 0,
      failures: [], exitCode: 0, at: 5, parsed: true,
    }
    const seen = watchState(on)
    store(on, { index: [old.key], [`runs:${old.key}`]: [old] })
    mock.clock(on, { now: 60_000 })
    let cwdReads = 0
    on('session.cwd', () => {
      cwdReads += 1
      return { value: ROOT }
    })
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(latest(seen)[0]).toMatchObject({ key: old.key, stale: true })
    expect(cwdReads).toBe(0)
  })

  test('a stored run an hour old or older is not loaded', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 0, skipped: 0,
      failures: [], exitCode: 0, at: 5, parsed: true,
    }
    const seen = watchState(on)
    store(on, { index: [old.key], [`runs:${old.key}`]: [old] })
    mock.clock(on, { now: 5 + 60 * 60_000 })
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(latest(seen)).toEqual([])
  })

  test('a stale run loaded at session start leaves the band at its hour', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 1, skipped: 0,
      failures: [], exitCode: 1, at: 5, parsed: true,
    }
    const seen = watchState(on)
    store(on, { index: [old.key], [`runs:${old.key}`]: [old] })
    const clock = mock.clock(on, { now: 5 + 59 * 60_000 })
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    emptyBand(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await clock.advance(60_000)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(latest(seen)).toEqual([])
  })

  test('an empty history leaves latest empty', async ($, on) => {
    const seen = watchState(on)
    store(on); mock.clock(on)
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    const started = await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(started).toEqual({ cwd: ROOT })
    expect(latest(seen)).toEqual([])
  })
})

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
      await ui.press({ key: `run-${ROOT}::pytest -q` })
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
    await $.tool.call({ tool: 'Bash', command: 'pytest -q', agentId: 'zz' } as never)
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(70) })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    expect(await ui.find({ text: /via workflow/ })).toBeUndefined()
  })
  test('wide terminal keeps the via tag; a second run shows prev', async ($, on) => {
    let t = 1_000_000
    store(on); watchState(on)
    on('clock.now', () => ({ value: (t += 60_000) }))
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.prompt.submit({ text: 'again' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q', agentId: 'zz' } as never)
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(await ui.find({ text: /via workflow/ })).toBeDefined()
    expect(await ui.find({ text: /prev 10 ✓ 1 ✗/ })).toBeDefined()
    expect(await ui.find({ text: /first run/ })).toBeUndefined()
  })
  test('only the failed count carries the error color', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect((await ui.find({ text: /^1 ✗$/ }))?.props).toMatchObject({ color: 'error' })
    expect((await ui.find({ text: /10 ✓/ }))?.props?.color).toBeUndefined()
  })

  for (const kind of ['tool-error', 'interrupted', 'truncated'] as const) {
    test(`passing counts retain ${kind} warnings in the rendered band`, async ($, on) => {
      world(on); emptyBand(on)
      on('tool.call', { tool: 'Bash' }, () => ({
        ...(kind === 'tool-error' ? { isError: true as const } : {}),
        result: { stdout: '10 passed in 0.5s', stderr: '', interrupted: kind === 'interrupted', isStdoutTruncated: kind === 'truncated' },
        text: '10 passed in 0.5s',
      }))
      await $.tool.call({ tool: 'Bash', command: 'pytest && build' })
      const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(55) })
      expect(await ui.find({ text: /10 ✓/ })).toBeDefined()
      const warning = await ui.find({ type: 'Text', text: kind === 'tool-error' ? /tool error/ : kind === 'interrupted' ? /interrupted/ : /output incomplete/ })
      expect(warning).toBeDefined()
      if (kind !== 'truncated') expect(warning?.props?.color).toBe('error')
      expect((await ui.find({ text: /^0 ✗$/ }))?.props?.color).toBeUndefined()
    })
  }

  test('a passing run with no reported problem draws no status text', async ($, on) => {
    world(on); bash(on, '10 passed in 0.5s'); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
    expect(await ui.find({ text: /10 ✓/ })).toBeDefined()
    expect(await ui.find({ text: /unknown/ })).toBeUndefined()
    expect(await ui.find({ text: /done / })).toBeDefined()
  })

  test('a host exit code on a failed call draws as exit N', async ($, on) => {
    world(on); emptyBand(on)
    const text = 'Exit code 139\n10 passed in 0.5s'
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: text, text }))
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
    expect((await ui.find({ type: 'Text', text: /exit 139/ }))?.props?.color).toBe('error')
  })

  test('shows the time the run finished', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.find({ text: new RegExp(`done ${new Date(1_000_000).toTimeString().slice(0, 5)}`) })).toBeDefined()
  })

  test('a band on screen closes itself once its run is an hour old, and latest empties', async ($, on) => {
    const { seen, clock } = world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    await clock.advance(59 * 60_000)
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    await clock.advance(60_000)
    expect(await ui.find({ text: /1 ✗/ })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(latest(seen)).toEqual([])
  })

  test('each line leaves an hour after its own run', async ($, on) => {
    const { clock } = world(on); bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q a.py' })
    await clock.advance(30 * 60_000)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q b.py' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    await clock.advance(31 * 60_000)
    expect(await ui.find({ text: /pytest -q a\.py/ })).toBeUndefined()
    expect(await ui.find({ text: /pytest -q b\.py/ })).toBeDefined()
    await clock.advance(30 * 60_000)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('draws nothing of its own while a survey is up', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const props = { ...bandProps(120), hasSurvey: true } as RenderPropsOf['AbovePrompt']
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('one close button, on the first row, a single ✕ named for what it closes', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q a.py' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q b.py' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.key)).toEqual([`run-${ROOT}::pytest -q b.py`, 'close', `run-${ROOT}::pytest -q a.py`])
    const close = buttons[1]
    expect(close?.text).toBe('✕')
    expect(close?.props).toMatchObject({ role: 'dismiss', label: 'Close test results' })
  })

  test('the close button hides the band until the next run', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(await ui.find({ text: /1 ✗/ })).toBeUndefined()
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
  })

  test('a run after the close brings back only itself, not the rows that were closed', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q a.py' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    await ui.press({ key: 'close' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q b.py' })
    expect(await ui.find({ text: /pytest -q b\.py/ })).toBeDefined()
    expect(await ui.find({ text: /pytest -q a\.py/ })).toBeUndefined()
  })

  test('a closed band stays closed when session.start fires again (as on a reload)', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    on('session.start', () => ({ cwd: ROOT }))
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    await ui.press({ key: 'close' })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    const again = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await again.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('a band closed on another worktree’s run stays closed when session.start fires again', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    on('session.start', () => ({ cwd: ROOT }))
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q a.py' })
    await $.agent.spawn(spawnArgs({ cwd: '/repo/wt-sub' }))
    await $.tool.call(inAgent('pytest -q', 'a1'))
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    await ui.press({ key: 'close' })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    const again = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(await again.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('each expiry writes latest once, dropping only the run that turned an hour old', async ($, on) => {
    store(on)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    const seen = new Map<string, unknown>()
    let writes = 0
    on('state.set', (_$, e, next) => {
      seen.set(e.key, e.value)
      if (e.key === 'latest') writes += 1
      return next(e)
    })
    await $.prompt.submit({ text: 'go' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q a.py' })
    await clock.advance(30 * 60_000)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q b.py' })
    const before = writes
    await clock.advance(30 * 60_000)
    expect(writes).toBe(before + 1)
    expect(latest(seen).map(r => r.suite)).toEqual(['pytest -q b.py'])
    await clock.advance(30 * 60_000)
    expect(writes).toBe(before + 2)
    expect(latest(seen)).toEqual([])
  })

  test('closing collapses the failure list, so the next run draws collapsed', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    await ui.press({ key: `run-${ROOT}::pytest -q` })
    expect(await ui.find({ text: /tests\/test_a\.py::test_x/ })).toBeDefined()
    await ui.press({ key: 'close' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    expect(await ui.find({ text: /tests\/test_a\.py::test_x/ })).toBeUndefined()
  })

  test('expiry collapses the failure list, so the next run draws collapsed', async ($, on) => {
    const { clock } = world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    await ui.press({ key: `run-${ROOT}::pytest -q` })
    await clock.advance(60 * 60_000)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    expect(await ui.find({ text: /tests\/test_a\.py::test_x/ })).toBeUndefined()
  })

  test('a run in the same millisecond as the close still reopens the band', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    await ui.press({ key: 'close' })
    expect(await ui.find({ text: /1 ✗/ })).toBeUndefined()
    // world()'s clock does not move: this run has the closed run's key and `at`.
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
  })

  test('an 80-column terminal keeps via on the first row when it fits beside the ✕', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
    await $.agent.spawn(spawnArgs({ cwd: '/r', description: 'w' }))
    await $.tool.call(inAgent('pytest -q', 'a1'))
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(80) })
    expect(await ui.find({ text: /via w/ })).toBeDefined()
  })

  test('only the first row gives up width to the close button', async ($, on) => {
    world(on); bash(on, PYTEST_RAW); emptyBand(on); turns(on)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
    await $.prompt.submit({ text: 'go' } as never)
    await $.agent.spawn(spawnArgs({ cwd: '/r', description: 'abcdefghi' }))
    await $.tool.call(inAgent('pytest -q a', 'a1'))
    await $.tool.call(inAgent('pytest -q b', 'a1'))
    // Each line is 81 cells: the first row has 82 - 3 for the ✕, the second all 82.
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(82) })
    const vias = await ui.findAll({ type: 'Text', text: /via abcdefghi/ })
    expect(vias).toHaveLength(1)
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map(b => b.key)).toEqual(['run-/r::pytest -q b', 'close', 'run-/r::pytest -q a'])
    expect(JSON.stringify(rows[2]?.children)).toContain('via abcdefghi')
  })

  test('a store read failure at draw time still draws the run as a first run', async ($, on) => {
    let isBroken = false
    const data = new Map<string, unknown>()
    on('store.get', (_$, e) => {
      if (isBroken) throw new Error('store unavailable')
      return { value: data.get(e.key) }
    })
    on('store.set', (_$, e) => {
      data.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      data.delete(e.key)
      return { value: undefined }
    })
    watchState(on); mock.clock(on, { now: 1_000_000 })
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    bash(on, PYTEST_RAW); emptyBand(on)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    isBroken = true
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await ui.find({ text: /1 ✗/ })).toBeDefined()
    expect(await ui.find({ text: /first run/ })).toBeDefined()
  })
})
