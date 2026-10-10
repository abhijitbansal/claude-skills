import { expect, test, type Engine } from 'claude-code/testing'
import { PANE_PROPS, START, T0, WT, startWorld } from './fixtures/world'

const STATUS = 'mcp__session-compass__compass_status'
const STORED = {
  id: 'sess-1', repo: 'cubby', worktree: WT, branch: 'feature/scan', goal: 'kept goal',
  lastActive: 1, artifacts: [{ kind: 'doc', path: 'docs/old.md', at: 1 }],
}
const RUN = { command: 'compass', args: '', origin: { kind: 'user' } } as never
const mount = ($: Engine) =>
  $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'Pane', requestId: 'compass', props: PANE_PROPS } as never)
type Rec = { goal?: string; artifacts: { kind: string; path?: string }[] }

test('I-1: a subagent compass_status is denied and leaves the main goal alone', async ($, on) => {
  const { world } = startWorld(on, {}, { 'session:sess-1': STORED, index: ['sess-1'] })
  await $.session.start(START)
  const out = await $.tool.call({ tool: STATUS, agentId: 'agent-7', goal: 'hijacked' } as never)
  expect(JSON.stringify(out)).toContain('compass_status is for the main session only')
  expect((world.seen.get('record') as Rec).goal).toBe('kept goal')
  expect((world.data.get('session:sess-1') as Rec).goal).toBe('kept goal')
})

test('I-2a: a single failed read at start is retried and the stored goal survives', async ($, on) => {
  const { world } = startWorld(on, { getFailures: 1 }, { 'session:sess-1': STORED, index: ['sess-1'] })
  await $.session.start(START)
  expect((world.data.get('session:sess-1') as Rec).goal).toBe('kept goal')
  expect((world.seen.get('record') as Rec).goal).toBe('kept goal')
})

test('I-2b: reads fail at start, store recovers; the next save merges the stored record', async ($, on) => {
  const { world } = startWorld(on, { getFailures: 2 }, { 'session:sess-1': STORED, index: ['sess-1'] })
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  expect((world.data.get('session:sess-1') as Rec).goal).toBe('kept goal')
  await $.tool.call({ tool: 'Write', file_path: `${WT}/docs/new.md`, content: 'x' } as never)
  const saved = world.data.get('session:sess-1') as Rec
  expect(saved.goal).toBe('kept goal')
  expect(saved.artifacts.map(a => a.path)).toEqual([`${WT}/docs/new.md`, 'docs/old.md'])
  expect((world.seen.get('record') as Rec).goal).toBe('kept goal')
})

test('M-1: a failing start step logs and session.start still resolves', async ($, on) => {
  const { world } = startWorld(on, { isToolRegisterFailing: true })
  await $.session.start(START)
  expect(world.logged.join('\n')).toContain('session-compass: start failed')
})

test('M-4: an unreadable store shows "Could not read other sessions."', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  world.isGetFailing = true
  const ui = await mount($)
  await ui.press({ key: 'tab-all' })
  expect(await ui.find({ text: 'Could not read other sessions.' })).toBeDefined()
  expect(world.logged.join('\n')).toContain('could not read other sessions')
})

test('M-5: a copy the surface refuses raises a toast', async ($, on) => {
  const { world } = startWorld(on, { isCopyFailing: true })
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: `${WT}/docs/plan.md`, content: 'x' } as never)
  const ui = await mount($)
  await ui.press({ key: 'a-doc-0' })
  expect(world.toasts.join('\n')).toContain('Copy failed: no-clipboard')
})

test('M-10: a rejected state read during an idle tick is logged and the next tick still runs', async ($, on) => {
  const { world, clock } = startWorld(on)
  let isFailing = false
  on('state.get', (_$, e, next) => {
    if (isFailing) return { deny: 'state unavailable' } as never
    return next(e)
  })
  await $.session.start(START)
  isFailing = true
  await clock.advance(60_000)
  expect(world.logged.join('\n')).toContain('idle tick failed')
  isFailing = false
  await clock.advance(16 * 60_000)
  expect(world.seen.get('band') ?? world.seen.get('session-compass:band')).toBe('return')
})
