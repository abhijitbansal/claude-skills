import { expect, test } from 'claude-code/testing'
import { ARTIFACT_PUBLISH, BASH_COMMIT, BASH_COMMIT_FAILED, type Fixture } from './fixtures/results'
import { START, startWorld } from './fixtures/world'

const answer = (f: Fixture) =>
  f.isError ? { isError: true as const, result: f.result, text: String(f.result) } : { result: f.result, text: 'ok' }

const quiet = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
type Rec = { artifacts: { kind: string; path?: string; sha?: string; title?: string }[]; branch: string }

test('a successful git commit adds a commit artifact and passes the result through', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => answer(BASH_COMMIT) as never)
  await $.session.start(START)
  const out = await $.tool.call({ tool: 'Bash', ...BASH_COMMIT.input } as never)
  expect(out).toMatchObject({ text: 'ok' })
  expect((world.seen.get('record') as Rec).artifacts[0]).toMatchObject({ kind: 'commit', sha: '1a2b3c4' })
  expect((world.data.get('session:sess-1') as Rec).artifacts[0]).toMatchObject({ kind: 'commit', sha: '1a2b3c4' })
})

test('a failed commit adds nothing', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Artifact' }, () => answer(ARTIFACT_PUBLISH) as never)
  on('tool.call', { tool: 'Bash' }, () => answer(BASH_COMMIT_FAILED) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', ...BASH_COMMIT_FAILED.input } as never)
  await $.tool.call({ tool: 'Artifact', ...ARTIFACT_PUBLISH.input } as never)
  expect((world.seen.get('record') as Rec).artifacts.map(a => a.kind)).toEqual(['artifact'])
})

test('an Artifact publish is captured', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Artifact' }, () => answer(ARTIFACT_PUBLISH) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Artifact', ...ARTIFACT_PUBLISH.input } as never)
  expect((world.seen.get('record') as Rec).artifacts[0]).toMatchObject({ kind: 'artifact', title: 'Compass Report' })
})

test('git switch refreshes the branch in state and store', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => quiet as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'main\n'
  await $.tool.call({ tool: 'Bash', command: 'git switch main' } as never)
  expect((world.seen.get('record') as Rec).branch).toBe('main')
  expect((world.data.get('session:sess-1') as Rec).branch).toBe('main')
})

test('a Bash command that is not a git move does not refresh the branch', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => quiet as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'main\n'
  await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)
  expect((world.seen.get('record') as Rec).branch).toBe('feature/scan')
  await $.tool.call({ tool: 'Bash', command: 'git checkout main' } as never)
  expect((world.seen.get('record') as Rec).branch).toBe('main')
})

test('a Write of a deliverable doc is captured', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plan.md', content: 'x' } as never)
  expect((world.seen.get('record') as Rec).artifacts[0]).toMatchObject({ kind: 'doc', path: '/repo/docs/plan.md' })
})

test('a denied call is returned untouched and records nothing', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Artifact' }, () => answer(ARTIFACT_PUBLISH) as never)
  on('tool.call', { tool: 'Write' }, () => ({ deny: 'nope' }) as never)
  await $.session.start(START)
  const out = await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plan.md', content: 'x' } as never)
  expect(out).toMatchObject({ deny: 'nope' })
  await $.tool.call({ tool: 'Artifact', ...ARTIFACT_PUBLISH.input } as never)
  expect((world.seen.get('record') as Rec).artifacts.map(a => a.kind)).toEqual(['artifact'])
})

test('a throwing capture logs, and the result still passes through', async ($, on) => {
  const { world } = startWorld(on)
  const gate = { isBroken: false }
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  on('state.get', (_$, e, next) => {
    if (gate.isBroken) return { deny: 'state down' } as never
    return next(e)
  })
  await $.session.start(START)
  gate.isBroken = true
  const out = await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plan.md', content: 'x' } as never)
  expect(out).toMatchObject({ text: 'ok' })
  expect(world.logged.join('\n')).toContain('capture failed')
})

test('concurrent captures keep every artifact', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await Promise.all(
    ['a', 'b', 'c', 'd'].map(n => $.tool.call({ tool: 'Write', file_path: `/repo/docs/${n}.md`, content: 'x' } as never)),
  )
  const paths = (world.seen.get('record') as Rec).artifacts.map(a => a.path).sort()
  expect(paths).toEqual(['/repo/docs/a.md', '/repo/docs/b.md', '/repo/docs/c.md', '/repo/docs/d.md'])
  const stored = (world.data.get('session:sess-1') as Rec).artifacts.map(a => a.path).sort()
  expect(stored).toEqual(paths)
})

test('a compass_status call racing an artifact capture keeps both', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await Promise.all([
    $.tool.call({ tool: 'mcp__session-compass__compass_status', goal: 'raced goal' } as never),
    $.tool.call({ tool: 'Write', file_path: '/repo/docs/raced.md', content: 'x' } as never),
    $.tool.call({ tool: 'mcp__session-compass__compass_status', step: 'raced step' } as never),
  ])
  const seen = world.seen.get('record') as Rec & { goal?: string; step?: string }
  expect(seen).toMatchObject({ goal: 'raced goal', step: 'raced step' })
  expect(seen.artifacts.map(a => a.path)).toEqual(['/repo/docs/raced.md'])
  expect(world.data.get('session:sess-1')).toMatchObject({ goal: 'raced goal', step: 'raced step' })
  expect((world.data.get('session:sess-1') as Rec).artifacts.length).toBe(1)
})

test('compass_status answers a deny, not ok, when its write fails', async ($, on) => {
  startWorld(on)
  const gate = { isBroken: false }
  on('state.get', (_$, e, next) => (gate.isBroken ? ({ deny: 'state down' } as never) : next(e)))
  await $.session.start(START)
  gate.isBroken = true
  const out = await $.tool.call({ tool: 'mcp__session-compass__compass_status', goal: 'g' } as never)
  expect(JSON.stringify(out)).toContain('status not saved')
  expect(JSON.stringify(out)).not.toContain('"ok"')
})

test('a call that captures nothing does not wait for a slow queued job', async ($, on) => {
  const { world } = startWorld(on)
  const gate: { isHeld: boolean; release: () => void; reached: () => void } = {
    isHeld: false, release: () => undefined, reached: () => undefined,
  }
  const released = new Promise<void>(r => { gate.release = r })
  const reached = new Promise<void>(r => { gate.reached = r })
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  on('tool.call', { tool: 'Bash' }, () => quiet as never)
  on('state.get', async (_$, e, next) => {
    if (gate.isHeld) {
      gate.reached()
      await released
    }
    return next(e)
  })
  await $.session.start(START)
  gate.isHeld = true
  const slow = $.tool.call({ tool: 'Write', file_path: '/repo/docs/slow.md', content: 'x' } as never)
  await reached
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(out).toMatchObject({ text: '' })
  expect((world.seen.get('record') as Rec).artifacts).toEqual([])
  gate.isHeld = false
  gate.release()
  await slow
  expect((world.seen.get('record') as Rec).artifacts[0]).toMatchObject({ kind: 'doc', path: '/repo/docs/slow.md' })
})

test('a subagent git move keeps its artifacts but does not relocate the session', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => answer(BASH_COMMIT) as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'sub-branch\n'
  await $.tool.call({ tool: 'Bash', agentId: 'a1', command: 'git commit -m x' } as never)
  const rec = world.seen.get('record') as Rec
  expect(rec.artifacts[0]).toMatchObject({ kind: 'commit', sha: '1a2b3c4' })
  expect(rec.branch).toBe('feature/scan')
})
