import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { BAND_PROPS, START, T0, startWorld } from './fixtures/world'

const OTHER = {
  name: 'other-band',
  register: (on: On) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      return <Box flexDirection="column"><Text>other band</Text>{await next(e)}</Box>
    })
  },
}

const bottom = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

test('the band is up as soon as the session has a record, with no turns and no wait', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  expect(await ui.find({ text: /cubby · .*feature-scan/ })).toBeDefined()
})

test('the band stays up across prompts and turns', async ($, on) => {
  const { clock } = startWorld(on)
  bottom(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'long task' } as never)
  await $.turn.start({ turnId: 't0', text: 'long task' } as never)
  await clock.advance(20 * 60_000)
  const ui = await $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  expect(await ui.find({ text: /cubby · / })).toBeDefined()
})

test('no band while a survey is on screen', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  const props = { ...(BAND_PROPS as Record<string, unknown>), hasSurvey: true }
  const ui = await $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ text: /cubby · / })).toBeUndefined()
})

test('the first prompt is kept as the no-goal fallback', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'fix the scanner crash' } as never)
  const rec = world.data.get('session:sess-1') as { firstPrompt?: string }
  expect(rec.firstPrompt).toBe('fix the scanner crash')
})

test('a delivery into a running turn does not count as a new prompt', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'mid turn nudge', turnId: 't1' } as never)
  const rec = world.data.get('session:sess-1') as { firstPrompt?: string }
  expect(rec.firstPrompt).toBeUndefined()
})

test('the band stacks above another mod band on both surfaces', { plugins: [OTHER] }, async ($, on) => {
  startWorld(on, { turns: 1 })
  bottom(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-compass', surface, component: 'AbovePrompt', props: BAND_PROPS as never })
    expect(await ui.find({ text: /cubby · .*feature-scan/ })).toBeDefined()
    expect(await ui.find({ text: 'other band' })).toBeDefined()
  }
})

const MAIN_TURN = { turnId: 't1', text: 'work' } as never
const SUB_DONE = { turnId: 't2', agentId: 'sub-1', reason: 'end_turn', durationMs: 5, isAborted: false } as never

test('a subagent turn.complete neither ends the main turn nor touches lastActive', async ($, on) => {
  const { clock, world } = startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'big job' } as never)
  await $.turn.start(MAIN_TURN)
  await clock.advance(16 * 60_000)
  await $.turn.complete(SUB_DONE)
  await clock.advance(60_000)
  expect((world.data.get('session:sess-1') as { lastActive: number }).lastActive).toBeLessThan(T0 + 16 * 60_000)
})

test('a dropped prompt is not kept as the first prompt', async ($, on) => {
  const { world } = startWorld(on, { drop: 'blocked by settings hook' })
  await $.session.start(START)
  await $.prompt.submit({ text: 'refused words' } as never)
  expect((world.data.get('session:sess-1') as { firstPrompt?: string }).firstPrompt).toBeUndefined()
})

test('a prompt the person did not type is not the first prompt', async ($, on) => {
  const { world } = startWorld(on, { turns: 2 })
  await $.session.start(START)
  await $.prompt.submit({ text: 'peer says hi', origin: { kind: 'peer' } } as never)
  expect((world.data.get('session:sess-1') as { firstPrompt?: string }).firstPrompt).toBeUndefined()
})
