import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'
import type { TestRun } from '../types'
import { lineParts } from '../hooks/format'
import { cases } from './cartoon-captures'

// Copied into a disposable plugin's tests by run_cartoon.py. Real producer
// outputs are replayed; this models Bash's envelope, not a live host session.
const ROOT = '/synthetic/cartoon-compat'
type Capture = typeof cases[number]

function world(on: On) {
  const data = new Map<string, unknown>()
  const seen = new Map<string, unknown>()
  mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', (_$, e) => { data.set(e.key, e.value); return { value: undefined } })
  on('store.keys', () => ({ value: [...data.keys()] }))
  on('store.delete', (_$, e) => { data.delete(e.key); return { value: undefined } })
  on('state.set', (_$, e, next) => { seen.set(e.key, e.value); return next(e) })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${ROOT}\n`, stderr: '' } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { data, seen }
}

function envelope(c: Capture) {
  const output = `${c.stdout}\n${c.stderr}`
  if (c.exit !== 0) {
    const text = `Exit code ${c.exit}\n${output}`
    return { isError: true as const, result: text, text }
  }
  return { result: { stdout: c.stdout, stderr: c.stderr, interrupted: false }, text: output }
}

const latest = (seen: Map<string, unknown>) => (seen.get('latest') ?? []) as TestRun[]
const props = (bodyColumns: number) => ({ hasSurvey: false, isWorking: false, maxRows: 12,
  bodyColumns, scroll: { bodyRows: 11 } }) as unknown as RenderPropsOf['AbovePrompt']

for (const c of cases) {
  test(`real Cartoon capture: ${c.name} reaches history and display`, async ($, on) => {
    if (c.name.startsWith('adapter-')) {
      expect(c.stderr).not.toContain('adapter failed')
      if (c.name === 'adapter-pass-then-fail') {
        // Cartoon keeps the raw log when passing JUnit cannot explain the exit.
        expect(c.stdout).toContain('synthetic setup step 0:')
        expect(c.stdout).not.toContain('\nsummary:\n')
      } else {
        expect(c.stdout).toContain('\nsummary:\n')
        expect(c.stdout).not.toContain('synthetic setup step 0:')
      }
    } else {
      expect(c.stderr).toContain('adapter failed to parse')
    }
    const w = world(on)
    let calls = 0
    const answer = envelope(c)
    on('tool.call', { tool: 'Bash' }, () => { calls += 1; return answer })
    const returned = await $.tool.call({ tool: 'Bash', command: c.command })
    expect(returned).toEqual(answer)
    expect(calls).toBe(1)
    expect(latest(w.seen)).toHaveLength(1)
    const run = latest(w.seen)[0]!
    expect(run).toMatchObject(c.expected)
    expect((w.data.get(`runs:${run.key}`) as TestRun[])[0]).toMatchObject(c.expected)
    const parts = lineParts(run, undefined, 1_000_000, 40)
    expect(parts.isFailing).toBe(c.exit !== 0 || c.expected.failed > 0)
    for (const width of [40, 100]) {
      const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal',
        component: 'AbovePrompt', props: props(width) })
      if (c.exit !== 0) expect(await ui.find({ text: `exit ${c.exit}` })).toBeDefined()
      if (!c.expected.parsed) expect(await ui.find({ text: 'counts unavailable' })).toBeDefined()
      if (c.expected.failed > 0) expect(await ui.find({ text: parts.split!.failed })).toBeDefined()
    }
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
    expect(latest(w.seen)[0]).toMatchObject({ ...c.expected, stale: true })
  })
}

test('concurrent capture replays keep each command outcome attached to its own run', async ($, on) => {
  const w = world(on)
  const waiting: (() => void)[] = []
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const c = cases.find(c => c.command === e.command)!
    await new Promise<void>(resolve => {
      waiting.push(resolve)
      if (waiting.length === cases.length) waiting.forEach(release => release())
    })
    return envelope(c)
  })
  await Promise.all(cases.map(c => $.tool.call({ tool: 'Bash', command: c.command })))
  const index = w.data.get('index') as string[]
  expect(index).toHaveLength(cases.length)
  for (const c of cases) {
    const key = index.find(key => key.endsWith(`::pytest ${c.name}`))!
    expect((w.data.get(`runs:${key}`) as TestRun[])[0]).toMatchObject(c.expected)
  }
})
