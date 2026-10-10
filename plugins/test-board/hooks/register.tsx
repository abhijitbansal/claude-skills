import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRun } from '../types'
import { appendRun, keysToDrop, MAX_LATEST, oldestQuarter, STORE_SOFT_CAP_BYTES, touchIndex } from './history'
import { parseTestOutput } from './parse'
import { resolveDir, splitCommand, suiteKey, suiteLabel } from './suite'

const latest = atom({ plugin: 'test-board', key: 'latest' } as const, [] as TestRun[])
const expanded = atom({ plugin: 'test-board', key: 'expanded' } as const, false)

type Loop = { description: string; cwd?: string; isWorkflow: boolean }
type Ran = { deny?: string; isError?: true; result?: unknown; text?: string }

const asRuns = (v: unknown): TestRun[] => (Array.isArray(v) ? (v as TestRun[]) : [])
const asKeys = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

function outputOf(ran: Ran): string | null {
  if (ran.deny !== undefined) return null
  const result = ran.result as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown } | undefined
  if (typeof result?.backgroundTaskId === 'string') return null
  if (typeof result?.stdout === 'string') {
    return `${result.stdout}\n${typeof result.stderr === 'string' ? result.stderr : ''}`
  }
  return ran.text ?? ''
}

function exitCodeOf(ran: Ran): number {
  if (ran.isError !== true) return 0
  return Number(/Exit code (\d+)/.exec(ran.text ?? '')?.[1]) || 1
}

type Roots = Map<string, string>
type Loops = Map<string, Loop>

async function worktreeRoot($: EngineInterface, roots: Roots, cwd: string): Promise<string> {
  const cached = roots.get(cwd)
  if (cached !== undefined) return cached
  let root = cwd
  try {
    const out = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    if (out.exitCode === 0 && out.stdout.trim() !== '') root = out.stdout.trim()
  } catch {
    // not a repo, or git missing: the cwd stands in for the worktree
  }
  roots.set(cwd, root)
  return root
}

async function writeRuns($: EngineInterface, key: string, runs: TestRun[], index: string[], drop: string[]) {
  for (const k of drop) await $.store.delete(`runs:${k}`)
  await $.store.set('index', index.filter(k => !drop.includes(k)))
  await $.store.set(`runs:${key}`, runs)
}

async function saveRun($: EngineInterface, run: TestRun): Promise<void> {
  const runs = appendRun(asRuns(await $.store.get(`runs:${run.key}`)), run)
  const index = touchIndex(asKeys(await $.store.get('index')), run.key)
  const sizes = await Promise.all(index.map(async key => ({
    key,
    bytes: JSON.stringify(key === run.key ? runs : (await $.store.get(`runs:${key}`)) ?? []).length,
  })))
  const drop = keysToDrop(sizes, STORE_SOFT_CAP_BYTES, run.key)
  try {
    await writeRuns($, run.key, runs, index, drop)
  } catch {
    try {
      const more = oldestQuarter(index.filter(k => !drop.includes(k)), run.key)
      await writeRuns($, run.key, runs, index, [...drop, ...more])
    } catch (err) {
      $.ui.log(`test-board: history not saved: ${String(err).slice(0, 120)}`)
    }
  }
}

async function record(
  $: EngineInterface, state: { loops: Loops; roots: Roots; turn: { isNew: boolean } },
  call: { command: string; agentId: string | undefined; startCwd: string }, ran: Ran,
) {
  const text = outputOf(ran)
  if (text === null) return
  const parts = splitCommand(call.command)
  const parsed = parseTestOutput({ command: parts.normalized, text, exitCode: exitCodeOf(ran) })
  if (parsed === null) return
  const loop = call.agentId === undefined ? undefined : state.loops.get(call.agentId)
  const base = loop?.cwd ?? call.startCwd
  const cwd = parts.cdDir === undefined ? base : resolveDir(base, parts.cdDir)
  const root = await worktreeRoot($, state.roots, cwd)
  const via = call.agentId === undefined ? undefined : loop === undefined || loop.isWorkflow ? 'workflow' : loop.description
  const run: TestRun = {
    ...parsed,
    suite: suiteLabel(parts.normalized),
    key: suiteKey(root, parts.normalized),
    at: await $.clock.now(),
    ...(via === undefined ? {} : { via }),
  }
  await saveRun($, run)
  const isFresh = state.turn.isNew
  state.turn.isNew = false
  await update($, latest, list =>
    [run, ...(isFresh ? [] : list.filter(r => r.key !== run.key && r.stale !== true))].slice(0, MAX_LATEST))
}

export const register: Register = on => {
  const state = { loops: new Map<string, Loop>(), roots: new Map<string, string>(), turn: { isNew: true } }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // The directory the command starts in: read it before the command can change it.
    let startCwd: string | undefined
    try {
      startCwd = await $.session.cwd()
    } catch (err) {
      $.ui.log(`test-board: cwd unavailable: ${String(err).slice(0, 120)}`)
    }
    const ran = await next(e)
    if (startCwd !== undefined) {
      try {
        await record($, state, { command: e.command, agentId: e.agentId, startCwd }, ran as Ran)
      } catch (err) {
        $.ui.log(`test-board: run not recorded: ${String(err).slice(0, 120)}`)
      }
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId !== undefined) {
      state.loops.set(started.agentId, {
        description: e.description,
        ...(e.cwd === undefined ? {} : { cwd: e.cwd }),
        isWorkflow: e.workflow !== undefined,
      })
    }
    return started
  })

  on('prompt.submit', ($, e, next) => {
    state.turn.isNew = true
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    try {
      const root = await worktreeRoot($, state.roots, await $.session.cwd())
      const key = asKeys(await $.store.get('index')).find(k => k.startsWith(`${root}::`))
      const newest = key === undefined ? undefined : asRuns(await $.store.get(`runs:${key}`))[0]
      if (newest !== undefined) await update($, latest, () => [{ ...newest, stale: true }])
    } catch (err) {
      $.ui.log(`test-board: history not loaded: ${String(err).slice(0, 120)}`)
    }
    return next(e)
  })
}
