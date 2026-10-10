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
