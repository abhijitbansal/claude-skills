import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BuiltinToolResults, On } from 'claude-code'

const ROOT = '/synthetic/repo'
const SNAPSHOT = {
  version: 1, scope: 'git-tracked+untracked-nonignored', status: 'available', root: ROOT,
  head: 'a'.repeat(40), branch: 'refs/heads/main', digest: 'b'.repeat(64), files: 1, bytes: 8,
}
const proc = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
const passed = () => ({ result: {
  stdout: '1 passed in 0.10s', stderr: '', interrupted: false,
} satisfies BuiltinToolResults['Bash'], text: '1 passed in 0.10s' })
const edited = () => ({ result: {
  filePath: `${ROOT}/app.txt`, oldString: 'a', newString: 'b', originalFile: 'a',
  structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
  userModified: false, replaceAll: false,
} satisfies BuiltinToolResults['Edit'], text: 'edited' })

function world(on: On, capture: () => unknown = () => SNAPSHOT, useMockClock = true) {
  const data = new Map<string, unknown>()
  const seen = new Map<string, unknown>()
  const history = { unavailable: false, failedReads: 0 }
  const calls: { argv: readonly string[]; init?: { timeoutMs?: number } }[] = []
  const clock = useMockClock ? mock.clock(on, { now: 1_000_000 }) : undefined
  on('session.cwd', () => ({ value: ROOT }))
  on('store.get', (_$, e) => {
    if (history.unavailable) {
      history.failedReads += 1
      throw new Error('synthetic unavailable history')
    }
    return { value: data.get(e.key) }
  })
  on('store.set', (_$, e) => { data.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { data.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...data.keys()] }))
  on('state.set', (_$, e, next) => { seen.set(e.key, e.value); return next(e) })
  on('ui.log', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    calls.push(e)
    return { value: proc(e.argv[0] === 'git' ? `${e.init?.cwd ?? ROOT}\n` : `${JSON.stringify(capture())}\n`) }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { data, seen, calls, clock, history }
}

const runs = (seen: Map<string, unknown>) => (seen.get('latest') ?? []) as {
  source?: { before?: unknown; after?: unknown }; sourceCheck?: { status: string }; stale?: boolean
}[]

test('captures before and after the actual command, persists both and preserves its result', async ($, on) => {
  const order: string[] = []
  const w = world(on, () => { order.push('capture'); return SNAPSHOT })
  on('tool.call', { tool: 'Bash' }, () => {
    order.push('command')
    return passed()
  })
  const result = await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(result.text).toBe('1 passed in 0.10s')
  expect(order.slice(0, 3)).toEqual(['capture', 'command', 'capture'])
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('matching')
  expect(runs(w.seen)[0]?.source).toEqual({ before: SNAPSHOT, after: SNAPSHOT })
  const stored = w.data.get(`runs:${ROOT}::pytest -q`) as Record<string, unknown>[]
  expect(stored[0]?.source).toEqual({ before: SNAPSHOT, after: SNAPSHOT })
  expect(stored[0]?.sourceCheck).toBeUndefined()
  const captures = w.calls.filter(c => c.argv[0] === 'python3')
  expect(captures.length >= 2).toBe(true)
  expect(captures.every(c => c.argv[1] === '-I' && c.argv[2] === '-B' && c.init?.timeoutMs === 2000)).toBe(true)
})

test('source changes during a run cannot be relabelled matching at a later check', async ($, on) => {
  let current = SNAPSHOT
  const w = world(on, () => current)
  on('tool.call', { tool: 'Bash' }, () => {
    current = { ...SNAPSHOT, digest: 'c'.repeat(64) }
    return passed()
  })
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('changed')
  await $.prompt.submit({ text: 'next task' } as never)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('changed')
})

test('an edit invalidates the prior check before executing and refreshes afterward', async ($, on) => {
  let current = SNAPSHOT
  const w = world(on, () => current)
  on('tool.call', { tool: 'Bash' }, passed)
  on('tool.call', { tool: 'Edit' }, () => {
    expect(runs(w.seen)[0]?.sourceCheck).toBeUndefined()
    current = { ...SNAPSHOT, digest: 'd'.repeat(64) }
    return edited()
  })
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('matching')
  const result = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/app.txt`, old_string: 'a', new_string: 'b' })
  expect(result.text).toBe('edited')
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('changed')
})

test('missing interpreter leaves results visible with source unknown and no error payload', async ($, on) => {
  const w = world(on, () => { throw new Error('synthetic private diagnostic') })
  on('tool.call', { tool: 'Bash' }, passed)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(runs(w.seen)).toHaveLength(1)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('unknown')
  expect(JSON.stringify([...w.data.values()])).not.toContain('private diagnostic')
})

test('ambiguous shell context does not gain source evidence', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, passed)
  await $.tool.call({ tool: 'Bash', command: 'pytest; cd /other; pytest' })
  expect(runs(w.seen)).toHaveLength(1)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('unknown')
  expect(w.calls.filter(c => c.argv[0] === 'python3')).toHaveLength(0)
})

for (const dir of ['tests', '"tests"', '-']) {
  test(`shell-dependent cd ${dir} keeps test counts but never earns source matching`, async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Bash' }, passed)
    const result = await $.tool.call({ tool: 'Bash', command: `cd ${dir} && pytest` })
    expect(result.text).toBe('1 passed in 0.10s')
    expect(runs(w.seen)[0]).toMatchObject({ passed: 1, sourceCheck: { status: 'unknown' } })
    expect(w.calls.filter(c => c.argv[0] === 'python3')).toHaveLength(0)
    await $.prompt.submit({ text: 'next' } as never)
    expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('unknown')
    const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt',
      props: { bodyColumns: 40, hasSurvey: false } as never })
    expect(await ui.find({ text: /source unknown/ })).toBeDefined()
    expect(w.calls.filter(c => c.argv[0] === 'python3')).toHaveLength(0)
  })
}

test('outside edits are checked at prompt boundaries, not inside render', async ($, on) => {
  let current = SNAPSHOT
  const w = world(on, () => current)
  on('tool.call', { tool: 'Bash' }, passed)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  current = { ...SNAPSHOT, digest: 'e'.repeat(64) }
  await $.prompt.submit({ text: 'next' } as never)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('changed')
  const before = w.calls.length
  const ui = await $.ui.mount({ plugin: 'test-board', surface: 'terminal', component: 'AbovePrompt',
    props: { bodyColumns: 40, hasSurvey: false } as never })
  expect(await ui.find({ text: /source changed/ })).toBeDefined()
  expect(w.calls.length).toBe(before)
})

test('concurrent commands never acquire matching source evidence', async ($, on) => {
  const w = world(on)
  const waiting: (() => void)[] = []
  on('tool.call', { tool: 'Bash' }, async () => {
    await new Promise<void>(resolve => {
      waiting.push(resolve)
      if (waiting.length === 2) waiting.forEach(release => release())
    })
    return passed()
  })
  await Promise.all([
    $.tool.call({ tool: 'Bash', command: 'pytest -q' }),
    $.tool.call({ tool: 'Bash', command: 'swift test' }),
  ])
  expect(runs(w.seen)).toHaveLength(2)
  expect(runs(w.seen).map(r => r.sourceCheck?.status)).toEqual(['unknown', 'unknown'])
})

test('restored history discards even a persisted matching label until a new check', async ($, on) => {
  const w = world(on)
  const key = `${ROOT}::pytest`
  const old = { suite: 'pytest', key, total: 1, passed: 1, failed: 0, skipped: 0,
    failures: [], exitCode: 0, at: 900_000, parsed: true,
    sourceCheck: { status: 'matching', at: 999_000 } }
  w.data.set('index', [key])
  w.data.set(`runs:${key}`, [old])
  on('session.start', () => ({ cwd: ROOT }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  expect(runs(w.seen)).toHaveLength(1)
  expect(runs(w.seen)[0]?.sourceCheck).toBeUndefined()
  await $.prompt.submit({ text: 'continue' } as never)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('unknown')
})

test('reload clears a cached matching check even when history has disappeared', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, passed)
  on('session.start', () => ({ cwd: ROOT }))
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('matching')
  w.data.clear()
  const captures = w.calls.length
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  expect(runs(w.seen)).toHaveLength(1)
  expect(runs(w.seen)[0]?.sourceCheck).toBeUndefined()
  expect(w.calls.length).toBe(captures)
})

test('reload clears cached checks before a failed history read', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, passed)
  on('session.start', () => ({ cwd: ROOT }))
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('matching')
  w.history.unavailable = true
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  expect(w.history.failedReads).toBe(1)
  expect(runs(w.seen)).toHaveLength(1)
  expect(runs(w.seen)[0]?.sourceCheck).toBeUndefined()
})

type SpawnArgs = Parameters<Engine['agent']['spawn']>[0]
const spawnArgs = (cwd?: string): SpawnArgs => ({
  tool_use_id: 'synthetic-spawn', prompt: 'synthetic task', description: 'synthetic-agent',
  subagentType: 'general-purpose', ...(cwd === undefined ? {} : { cwd }),
}) as SpawnArgs

for (const registered of [false, true]) {
  test(`an ${registered ? 'inherited-directory' : 'unrecognized'} agent cannot borrow the main loop source identity`, async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Bash' }, passed)
    if (registered) {
      on('agent.spawn', () => ({ model: 'sonnet', agentId: 'synthetic-agent' }))
      await $.agent.spawn(spawnArgs())
    }
    await $.tool.call({ tool: 'Bash', command: 'pytest', agentId: 'synthetic-agent' } as never)
    expect(runs(w.seen)).toHaveLength(1)
    expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('unknown')
    expect(w.calls.filter(c => c.argv[0] === 'python3')).toHaveLength(0)
  })
}

test('an explicitly located agent captures its own worktree, not the main loop worktree', async ($, on) => {
  const root = '/synthetic/agent'
  const snapshot = { ...SNAPSHOT, root }
  const w = world(on, () => snapshot)
  on('tool.call', { tool: 'Bash' }, passed)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'synthetic-agent' }))
  await $.agent.spawn(spawnArgs(root))
  await $.tool.call({ tool: 'Bash', command: 'pytest', agentId: 'synthetic-agent' } as never)
  expect(runs(w.seen)[0]?.sourceCheck?.status).toBe('matching')
  expect(runs(w.seen)[0]?.source).toEqual({ before: snapshot, after: snapshot })
  const captures = w.calls.filter(c => c.argv[0] === 'python3')
  expect(captures.length >= 2).toBe(true)
  expect(captures.every(c => c.argv[c.argv.length - 1] === root)).toBe(true)
})

test('a denied call and a background command cannot mint source evidence', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, (_$, e) => e.command === 'pytest'
    ? { deny: 'synthetic denial' }
    : { result: {
      stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'synthetic-task',
    } satisfies BuiltinToolResults['Bash'], text: 'started' })
  expect((await $.tool.call({ tool: 'Bash', command: 'pytest' })).deny).toBe('synthetic denial')
  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(runs(w.seen)).toHaveLength(0)
  expect(w.data.size).toBe(0)
})

test('a tool starting during the final check timestamp prevents a matching label', async ($, on) => {
  let captures = 0
  const w = world(on, () => { captures += 1; return SNAPSHOT }, false)
  let began = false
  let releaseEdit!: () => void
  let editStarted!: () => void
  const started = new Promise<void>(resolve => { editStarted = resolve })
  const held = new Promise<void>(resolve => { releaseEdit = resolve })
  let pending: Promise<unknown> | undefined
  on('tool.call', { tool: 'Bash' }, passed)
  on('tool.call', { tool: 'Edit' }, async () => {
    editStarted()
    await held
    return edited()
  })
  on('clock.after', () => new Promise(() => {}))
  on('clock.now', async () => {
    if (captures === 3 && !began) {
      began = true
      pending = $.tool.call({ tool: 'Edit', file_path: `${ROOT}/app.txt`, old_string: 'a', new_string: 'b' })
      await started
    }
    return { value: 1_000_000 }
  })
  try {
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    expect(began).toBe(true)
    expect(runs(w.seen)[0]?.sourceCheck).toBeUndefined()
  } finally {
    releaseEdit()
    await pending
  }
})
