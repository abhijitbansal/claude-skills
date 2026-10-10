// Stubs every `$` noun the plugin calls; nothing else answers beneath the
// plugin in `claude plugin test`. The test `$` only raises events, so effects
// are read back from the Map-backed store and the state.set recorder.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const T0 = 1_760_000_000_000
export const WT = '/Users/me/projects/cubby-wt/feature-scan'

export type World = {
  id: string
  turns: number
  repoRoot: string | null
  git: Record<string, string>
  copied: string[]
  opened: string[]
  registered: string[]
  data: Map<string, unknown>
  seen: Map<string, unknown>
  logged: string[]
  sets: string[]
  setFailures: Record<string, number>
  isGetFailing: boolean
  drop?: string
}

export const START = { cwd: WT, surface: 'terminal', isInteractive: true } as const
export const BAND_PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 }, view: {},
}
export const PANE_PROPS = {
  title: 'Compass', isFocused: true, bodyColumns: 120, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
}

export function startWorld(on: On, over: Partial<World> = {}, seed: Record<string, unknown> = {}) {
  const world: World = {
    id: 'sess-1',
    turns: 0,
    repoRoot: '/Users/me/projects/cubby',
    git: { 'rev-parse --show-toplevel': `${WT}\n`, 'rev-parse --abbrev-ref HEAD': 'feature/scan\n' },
    copied: [],
    opened: [],
    registered: [],
    data: new Map<string, unknown>(Object.entries(seed)),
    seen: new Map<string, unknown>(),
    logged: [],
    sets: [],
    setFailures: {},
    isGetFailing: false,
    ...over,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.id }))
  on('session.turns', () => ({ value: world.turns }))
  on('session.cwd', () => ({ value: WT }))
  on('session.repo', () => ({
    value: world.repoRoot === null ? null : { root: world.repoRoot, remote: null, internal: false, name: null },
  }))
  on('process.run', (_$, e) => {
    const out = world.git[e.argv.slice(1).join(' ')]
    return out === undefined
      ? { deny: 'no such command in this test' }
      : { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', (_$, e) => {
    world.registered.push(e.name)
    return { value: { tool: `mcp__session-compass__${e.name}` } }
  })
  on('command.register', (_$, e) => {
    world.registered.push(`/${e.name}`)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', (_$, e) => {
    world.logged.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.submit', (_$, e) => (world.drop === undefined ? { text: e.text } : { drop: world.drop }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }] }))
  on('store.get', (_$, e) => {
    if (world.isGetFailing) throw new Error('store unavailable')
    return { value: world.data.get(e.key) }
  })
  on('store.set', (_$, e) => {
    const left = world.setFailures[e.key] ?? 0
    if (left > 0) {
      world.setFailures[e.key] = left - 1
      throw new Error('quota exceeded')
    }
    world.sets.push(e.key)
    world.data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    world.data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...world.data.keys()] }))
  on('state.set', (_$, e, next) => {
    world.seen.set(e.key, e.value)
    return next(e)
  })
  const clock = mock.clock(on, { now: T0 })
  return { world, clock }
}
