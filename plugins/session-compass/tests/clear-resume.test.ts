import { expect, test } from 'claude-code/testing'
import { STATUS_TOOL_DESCRIPTION } from '../hooks/register'
import { START, WT, startWorld } from './fixtures/world'

const STATUS = 'mcp__session-compass__compass_status'
type Rec = { id: string; goal?: string; step?: string; firstPrompt?: string; artifacts: { path?: string }[] }
const end = (reason: string, sessionId = 'sess-1') => ({ reason, sessionId, resume: { id: sessionId } }) as never

test('after /clear, compass_status records under the new session id', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'old goal' } as never)
  await $.session.end(end('clear'))
  world.id = 'sess-2'
  const out = await $.tool.call({ tool: STATUS, goal: 'new goal' } as never)
  expect(out.deny).toBeUndefined()
  expect(world.seen.get('record')).toMatchObject({ id: 'sess-2', goal: 'new goal', worktree: WT })
  expect(world.data.get('session:sess-2')).toMatchObject({ id: 'sess-2', goal: 'new goal' })
  expect((world.data.get('session:sess-1') as Rec).goal).toBe('old goal')
})

test('after /clear, the next prompt opens a fresh record without the old goal', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'old goal' } as never)
  await $.session.end(end('clear'))
  world.id = 'sess-2'
  await $.prompt.submit({ text: 'a new task' } as never)
  const rec = world.seen.get('record') as Rec
  expect(rec).toMatchObject({ id: 'sess-2', firstPrompt: 'a new task' })
  expect(rec.goal).toBeUndefined()
})

test('a resume into a stored session keeps its goal and artifacts', async ($, on) => {
  const stored = {
    id: 'sess-9', repo: 'cubby', worktree: WT, branch: 'feature/scan', goal: 'resumed goal',
    lastActive: 1, artifacts: [{ kind: 'doc', path: 'docs/kept.md', at: 1 }],
  }
  const { world } = startWorld(on, {}, { 'session:sess-9': stored, index: ['sess-9'] })
  await $.session.start(START)
  await $.session.end(end('resume'))
  world.id = 'sess-9'
  await $.tool.call({ tool: STATUS, step: 'picking up' } as never)
  const rec = world.data.get('session:sess-9') as Rec
  expect(rec).toMatchObject({ goal: 'resumed goal', step: 'picking up' })
  expect(rec.artifacts.map(a => a.path)).toEqual(['docs/kept.md'])
})

test('compass_status with no record yet creates one instead of refusing', async ($, on) => {
  const { world } = startWorld(on)
  const out = await $.tool.call({ tool: STATUS, goal: 'first call' } as never)
  expect(JSON.stringify(out)).not.toContain('no session record yet')
  expect(world.seen.get('record')).toMatchObject({ id: 'sess-1', goal: 'first call' })
  expect(world.data.get('session:sess-1')).toMatchObject({ goal: 'first call' })
})

test('/clear empties the band at once, before the new id is known', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'old goal' } as never)
  await $.session.end(end('clear'))
  expect(world.seen.get('record')).toBeNull()
  expect((world.data.get('session:sess-1') as Rec).goal).toBe('old goal')
})

test('an ordinary exit leaves the record in place', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'kept' } as never)
  await $.session.end(end('prompt_input_exit'))
  expect(world.seen.get('record')).toMatchObject({ id: 'sess-1', goal: 'kept' })
})

test('the tool description says it is for the main session only', () => {
  expect(STATUS_TOOL_DESCRIPTION).toContain('main session only')
})
