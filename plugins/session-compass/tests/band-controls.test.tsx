import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { BAND_PROPS, PANE_PROPS, START, startWorld } from './fixtures/world'

const GOAL = 'portable-artifacts 2.0: make-motion v2 spec, refresh other plugins, update docs'
const STEP = 'wrapping the band onto a second line'
const NEXT = 'run the tests, update README and docs, hand to lead'
const STATUS = 'mcp__session-compass__compass_status'
const run = (args: string) => ({ command: 'compass', args, origin: { kind: 'user' } }) as never

const bottom = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
const setStatus = ($: Engine, fields: { goal?: string; step?: string; next?: string }) =>
  $.tool.call({ tool: STATUS, ...fields } as never)
const band = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt',
    props: { ...BAND_PROPS, bodyColumns: columns } as never,
  })

test('the band hints how to open the full text only when text is cut', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL, step: STEP })
  expect(await (await band($, 400)).find({ key: 'more' })).toBeUndefined()
  const narrow = await band($, 30)
  expect((await narrow.find({ key: 'more' }))?.text).toBe('▸ more')
  expect(await (await band($, 130)).find({ key: 'more' })).toBeUndefined()
})

test('expanding shows every character of goal, step and next, then folds back', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL, step: STEP, next: NEXT })
  const ui = await band($, 30)
  expect(await ui.find({ text: `Goal: ${GOAL}` })).toBeUndefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ text: `Goal: ${GOAL}` })).toBeDefined()
  expect(await ui.find({ text: `Now: ${STEP}` })).toBeDefined()
  expect(await ui.find({ text: `Next: ${NEXT}` })).toBeDefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ text: `Goal: ${GOAL}` })).toBeUndefined()
})

test('/compass more toggles the same expansion from the keyboard', async ($, on) => {
  const { world } = startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL, next: NEXT })
  const ui = await band($, 30)
  expect((await $.command.run(run('more'))).text).toMatch(/expanded/)
  expect(await ui.find({ text: `Next: ${NEXT}` })).toBeDefined()
  expect((await $.command.run(run('more'))).text).toMatch(/folded/)
  expect(await ui.find({ text: `Next: ${NEXT}` })).toBeUndefined()
  expect(world.opened).toEqual([])
})

test('/compass hide removes the band; /compass show brings it back', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL })
  const ui = await band($, 200)
  expect(await ui.find({ text: /cubby · / })).toBeDefined()
  expect((await $.command.run(run('hide'))).text).toMatch(/\/compass show/)
  expect(await ui.find({ text: /cubby · / })).toBeUndefined()
  await $.command.run(run('show'))
  expect(await ui.find({ text: /cubby · / })).toBeDefined()
})

test('a hidden band returns when the goal changes, and stays gone while it does not', async ($, on) => {
  startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: 'first goal' })
  await $.command.run(run('hide'))
  const ui = await band($, 200)
  await setStatus($, { step: 'a new step, same goal' })
  expect(await ui.find({ text: /cubby · / })).toBeUndefined()
  await setStatus($, { goal: 'second goal' })
  expect(await ui.find({ text: /Goal: second goal/ })).toBeDefined()
  // Going back to the dismissed text is a goal change too: it must not re-hide.
  await setStatus($, { goal: 'first goal' })
  expect(await ui.find({ text: /Goal: first goal/ })).toBeDefined()
})

test('dismiss and expand live in session state, never in the store', async ($, on) => {
  const { world } = startWorld(on)
  bottom(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL })
  await $.command.run(run('more'))
  await $.command.run(run('hide'))
  expect(JSON.stringify([...world.data.values()])).not.toMatch(/hidden|expanded/)
  expect([...world.data.keys()].filter(k => /hid|expand/.test(k))).toEqual([])
})

test('an unknown argument lists the accepted ones and opens nothing', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  const text = (await $.command.run(run('bogus'))).text
  expect(text).toMatch(/more/)
  expect(text).toMatch(/hide/)
  expect(text).toMatch(/show/)
  expect(world.opened).toEqual([])
})

test('the pane shows goal, step and next in full even at a narrow width', async ($, on) => {
  startWorld(on)
  await $.session.start(START)
  await setStatus($, { goal: GOAL, step: STEP, next: NEXT })
  const ui = await $.ui.mount({
    plugin: 'session-compass', surface: 'terminal', component: 'Pane', requestId: 'compass',
    props: { ...PANE_PROPS, bodyColumns: 30 } as never,
  })
  expect(await ui.find({ text: `Goal: ${GOAL}` })).toBeDefined()
  expect(await ui.find({ text: `Now: ${STEP} · Next: ${NEXT}` })).toBeDefined()
})
