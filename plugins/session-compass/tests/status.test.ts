import { expect, test } from 'claude-code/testing'
import { START, T0, WT, startWorld } from './fixtures/world'

const STATUS = 'mcp__session-compass__compass_status'

test('session.start registers the tool and /compass and records where the session is', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  expect(world.registered).toEqual(['compass_status', '/compass'])
  expect(world.seen.get('record')).toMatchObject({
    id: 'sess-1', repo: 'cubby', worktree: WT, branch: 'feature/scan', lastActive: T0,
  })
  expect(world.data.get('index')).toEqual(['sess-1'])
})

test('compass_status merges fields and stores the record', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'barcode fallback', step: 'spec' } as never)
  await $.tool.call({ tool: STATUS, step: 'implement' } as never)
  expect(world.seen.get('record')).toMatchObject({ goal: 'barcode fallback', step: 'implement', statusAt: T0 })
  expect(world.data.get('session:sess-1')).toMatchObject({ goal: 'barcode fallback', step: 'implement' })
})

test('compass_status with every field empty answers an error naming the fields', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: STATUS, goal: '' } as never)
  expect(JSON.stringify(out)).toContain('goal, step, next')
  expect((world.seen.get('record') as { goal?: string }).goal).toBeUndefined()
})

test('the reminder section is added after the engine sections', async ($, on) => {
  startWorld(on)
  const { sections } = await $.prompt.compose({
    model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [],
  })
  expect(sections.map(s => s.id)).toEqual(['intro', 'session-compass:reminder'])
  expect(sections[1]).toMatchObject({ scope: 'session' })
})

test('a second session.start (hot reload) keeps the stored record and its artifacts', async ($, on) => {
  const stored = {
    id: 'sess-1', repo: 'cubby', worktree: WT, branch: 'feature/scan', goal: 'kept',
    lastActive: 1, artifacts: [{ kind: 'doc', path: 'docs/a.md', at: 1 }],
  }
  const { world } = startWorld(on, {}, { 'session:sess-1': stored, index: ['sess-1'] })
  await $.session.start(START)
  expect(world.seen.get('record')).toMatchObject({ goal: 'kept', artifacts: stored.artifacts, lastActive: T0 })
  expect(world.data.get('session:sess-1')).toMatchObject({ goal: 'kept', artifacts: stored.artifacts, lastActive: T0 })
})

test('git failing keeps a usable record', async ($, on) => {
  const { world } = startWorld(on, { git: {}, repoRoot: null })
  await $.session.start(START)
  expect(world.seen.get('record')).toMatchObject({ repo: 'feature-scan', worktree: WT, branch: '' })
})

const doc = (path: string) => ({ kind: 'doc', path, at: 1 }) as const
const stub = (id: string, lastActive: number, artifacts: unknown[] = []) =>
  ({ id, repo: 'r', worktree: '/w', branch: 'b', lastActive, artifacts })

test('a session record missing from the index is merged in on the next save', async ($, on) => {
  const { world } = startWorld(on, {}, { 'session:x': stub('x', 5), 'session:other': stub('other', 3), index: ['other'] })
  await $.session.start(START)
  expect(world.data.get('index')).toEqual(['sess-1', 'x', 'other'])
})

test('orphan records beyond the 50-session cap are deleted', async ($, on) => {
  const seed: Record<string, unknown> = { index: [] }
  for (let i = 0; i < 55; i++) seed[`session:o${i}`] = stub(`o${i}`, i + 1)
  const { world } = startWorld(on, {}, seed)
  await $.session.start(START)
  expect((world.data.get('index') as string[]).length).toBe(50)
  expect([...world.data.keys()].filter(k => k.startsWith('session:')).length).toBe(50)
  expect(world.data.has('session:o0')).toBe(false)
})

test('a failed write trims other sessions before the retry succeeds', async ($, on) => {
  const big = stub('o', 9, Array.from({ length: 80 }, (_, i) => doc(`d${i}`)))
  const { world } = startWorld(on, { setFailures: { 'session:sess-1': 1 } }, { 'session:o': big, index: ['o'] })
  await $.session.start(START)
  expect((world.data.get('session:o') as { artifacts: unknown[] }).artifacts.length).toBe(50)
  expect(world.data.has('session:sess-1')).toBe(true)
  expect(world.sets.indexOf('session:o')).toBeLessThan(world.sets.indexOf('session:sess-1'))
})

test('two failed writes log and keep the record in session state', async ($, on) => {
  const { world } = startWorld(on, { setFailures: { 'session:sess-1': 2 } })
  await $.session.start(START)
  expect(world.logged.join('\n')).toContain('store write failed')
  expect(world.seen.get('record')).toMatchObject({ id: 'sess-1' })
})

test('a rejected store read at start still leaves a record for compass_status', async ($, on) => {
  const { world } = startWorld(on, { isGetFailing: true })
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'still works' } as never)
  expect(world.seen.get('record')).toMatchObject({ goal: 'still works' })
  expect(world.logged.join('\n')).toContain('session-compass')
})

test('non-string compass_status fields are treated as left out, never thrown on', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: STATUS, goal: 5 } as never)
  expect(JSON.stringify(out)).toContain('goal, step, next')
  await $.tool.call({ tool: STATUS, goal: 5, step: 'ok' } as never)
  expect(world.seen.get('record')).toMatchObject({ step: 'ok' })
  expect((world.seen.get('record') as { goal?: unknown }).goal).toBeUndefined()
})

test('compass_status answers with a plain string result, as a registered tool must', async ($, on) => {
  startWorld(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: STATUS, goal: 'barcode fallback' } as never)
  expect(out.deny).toBeUndefined()
  expect(typeof out.result).toBe('string')
})
