import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register, RenderPropsOf } from 'claude-code'

import type { TestRun } from '../types'
import { PYTEST_RAW } from './fixtures/output'

const ROOT = '/repo/wt-a'
const LATEST = { plugin: 'test-board', key: 'latest' } as const

type Proc = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const proc = (stdout: string): Proc => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

function store(on: On, seed: Record<string, unknown> = {}, isReadFailing = false): Map<string, unknown> {
  const data = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => {
    if (isReadFailing) throw new Error('store unavailable')
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
  on('store.keys', () => ({ value: [...data.keys()] }))
  return data
}

function world(on: On, getCwd: () => string = () => ROOT, isReadFailing = false): { writes: Map<string, unknown>; seen: Map<string, unknown> } {
  const writes = store(on, {}, isReadFailing)
  const seen = watchState(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.cwd', () => ({ value: getCwd() }))
  on('process.run', (_$, e) => ({ value: proc(`${e.init?.cwd ?? ROOT}\n`) }))
  return { writes, seen }
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

  test('an errored run takes the exit code from the text', async ($, on) => {
    const { seen } = world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'Exit code 139', text: 'Exit code 139\nsegfault' }))
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect(latest(seen)[0]).toMatchObject({ parsed: false, exitCode: 139 })
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

describe('session start', () => {
  test('loads the worktree’s most recent run as stale', async ($, on) => {
    const old: TestRun = {
      suite: 'pytest -q', key: `${ROOT}::pytest -q`, total: 1, passed: 1, failed: 0, skipped: 0,
      failures: [], exitCode: 0, at: 5, parsed: true,
    }
    const seen = watchState(on)
    store(on, { index: [`/other::x`, old.key], [`runs:${old.key}`]: [old] })
    mock.clock(on)
    on('session.cwd', () => ({ value: ROOT }))
    on('process.run', () => ({ value: proc(`${ROOT}\n`) }))
    on('session.start', () => ({ cwd: ROOT }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(latest(seen)[0]).toMatchObject({ key: old.key, stale: true })
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
})
