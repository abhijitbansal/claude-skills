import { expect, test, type Engine } from 'claude-code/testing'
import { BAND_PROPS, PANE_PROPS, START, T0, WT, startWorld } from './fixtures/world'

const OTHER = {
  id: 'sess-0', repo: 'ocr', worktree: '/Users/me/projects/ocr', branch: 'main',
  goal: 'table OCR', step: 'review', lastActive: T0 - 3_600_000, artifacts: [],
}
const RUN = { command: 'compass', args: '', origin: { kind: 'user' } } as never
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'session-compass', surface, component: 'Pane', requestId: 'compass', props: PANE_PROPS } as never)

test('the pane preserves warnings alongside passing test counts', async ($, on) => {
  startWorld(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('state.get', (_$, e, next) => e.plugin === 'test-board' && e.key === 'latest' ? { value: { version: 1, value: [{
    parsed: true, total: 10, passed: 10, failed: 0, skipped: 0, exitCode: null, commandStatus: 'tool-error',
  }] } } : next(e))
  await $.session.start(START)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ text: /Tests: 10 ✓ 0 ✗/ })).toBeDefined()
  expect(await ui.find({ text: /1 warning/ })).toBeDefined()
  const band = await $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 30 } as never })
  expect(await band.find({ text: /tests: 1 warning/ })).toBeDefined()
})

test('/compass opens the pane', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.command.run(RUN)
  expect(world.opened).toEqual(['compass'])
})

test('this-session tab lists status and artifacts; pressing one copies it', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__session-compass__compass_status', goal: 'barcode fallback' } as never)
  await $.tool.call({ tool: 'Write', file_path: `${WT}/docs/plan.md`, content: 'x' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: 'Goal: barcode fallback' })).toBeDefined()
    await ui.press({ key: 'a-doc-0' })
  }
  expect(world.copied).toEqual([`${WT}/docs/plan.md`, `${WT}/docs/plan.md`])
})

test('all-sessions tab lists other sessions; pressing a row copies the resume command', async ($, on) => {
  const { world } = startWorld(on, {}, { 'session:sess-0': OTHER, index: ['sess-0'] })
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    await ui.press({ key: 'tab-all' })
    expect(await ui.find({ text: /ocr · ocr\/main · table OCR · review/ })).toBeDefined()
    await ui.press({ key: 's-sess-0' })
  }
  expect(world.copied).toEqual(['claude --resume sess-0', 'claude --resume sess-0'])
})

test('a corrupt index is rebuilt from session keys', async ($, on) => {
  const { world } = startWorld(on, {}, { 'session:sess-0': OTHER, index: ['sess-0'] })
  await $.session.start(START)
  world.data.set('index', 'garbage')
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'tab-all' })
  expect(await ui.find({ text: /table OCR/ })).toBeDefined()
})

test('all-sessions tab stays within the 50-session cap, current session excluded', async ($, on) => {
  const seed: Record<string, unknown> = {}
  for (let i = 0; i < 60; i++) seed[`session:o-${i}`] = { ...OTHER, id: `o-${i}`, lastActive: T0 - i * 1000 }
  startWorld(on, {}, seed)
  await $.session.start(START)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'tab-all' })
  expect(await ui.find({ key: 's-o-0' })).toBeDefined()
  expect(await ui.find({ key: 's-o-48' })).toBeDefined()
  expect(await ui.find({ key: 's-o-49' })).toBeUndefined()
})
