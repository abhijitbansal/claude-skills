import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { BAND_PROPS, START, startWorld } from './fixtures/world'

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

// band atom writes are read back from the state.set recorder in startWorld.
const bandOf = (seen: Map<string, unknown>) => seen.get('session-compass:band') ?? seen.get('band')

test('15 idle minutes raise the band; the next prompt hides it', async ($, on) => {
  const { clock, world } = startWorld(on)
  await $.session.start(START)
  await clock.advance(14 * 60_000)
  expect(bandOf(world.seen)).not.toBe('return')
  await clock.advance(2 * 60_000)
  expect(bandOf(world.seen)).toBe('return')
  await $.prompt.submit({ text: 'back again' } as never)
  expect(bandOf(world.seen)).toBe('hidden')
})

test('a resumed session starts with the band up', async ($, on) => {
  const { world } = startWorld(on, { turns: 3 })
  await $.session.start(START)
  expect(bandOf(world.seen)).toBe('return')
})

test('no band while a turn runs, even past 15 minutes', async ($, on) => {
  const { clock, world } = startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'long task' } as never)
  await clock.advance(20 * 60_000)
  expect(bandOf(world.seen)).not.toBe('return')
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

test('no band is drawn while hidden', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  expect(await ui.find({ text: /cubby · / })).toBeUndefined()
})
