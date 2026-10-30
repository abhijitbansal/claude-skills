import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TestRun } from '../types'
import { GAP, lineParts, MAX_SHOWN_FAILURES, tail } from './format'
import {
  appendRun, BAND_TTL_MS, keysToDrop, MAX_LATEST, oldestQuarter, previousRun, STORE_SOFT_CAP_BYTES, touchIndex, visibleRuns,
} from './history'
import { parseTestOutput } from './parse'
import { resolveDir, splitCommand, suiteKey, suiteLabel } from './suite'

const latest = atom({ plugin: 'test-board', key: 'latest' } as const, [] as TestRun[])
const expanded = atom({ plugin: 'test-board', key: 'expanded' } as const, false)
const dismissed = atom({ plugin: 'test-board', key: 'dismissed' } as const, null as { key: string; at: number } | null)

// The ✕ and the two cells of gap before it.
const CLOSE_GAP = '  '
const CLOSE_RESERVE = CLOSE_GAP.length + 1

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
  return typeof ran.text === 'string' ? ran.text : ''
}

function commandEvidence(ran: Ran): Pick<TestRun, 'exitCode' | 'commandStatus' | 'outputIncomplete'> {
  const result = ran.result as { interrupted?: unknown; isStdoutTruncated?: unknown; isStderrTruncated?: unknown } | undefined
  const interrupted = result?.interrupted === true
  // Bash's observed response shape has no structured exit code. Output text is not authority.
  return {
    exitCode: null,
    commandStatus: interrupted ? 'interrupted' : ran.isError === true ? 'tool-error' : 'unknown',
    ...(interrupted || result?.isStdoutTruncated === true || result?.isStderrTruncated === true
      ? { outputIncomplete: true } : {}),
  }
}

type Roots = Map<string, string>
type Loops = Map<string, Loop>
type State = { loops: Loops; roots: Roots; turn: { isNew: boolean }; chain: Promise<void>; expiry?: Timer }

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

// Runs whose key lost the shared index race (concurrent sessions) are never sized or trimmed; reclaim them.
async function dropOrphans($: EngineInterface, index: string[]): Promise<void> {
  const known = new Set(index.map(k => `runs:${k}`))
  for (const k of asKeys(await $.store.keys())) {
    if (k.startsWith('runs:') && !known.has(k)) await $.store.delete(k)
  }
}

async function saveRun($: EngineInterface, run: TestRun): Promise<void> {
  try {
    await trySaveRun($, run)
  } catch (err) {
    $.ui.log(`test-board: history not saved: ${String(err).slice(0, 120)}`)
  }
}

async function trySaveRun($: EngineInterface, run: TestRun): Promise<void> {
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
      await dropOrphans($, index)
      const more = oldestQuarter(index.filter(k => !drop.includes(k)), run.key)
      await writeRuns($, run.key, runs, index, [...drop, ...more])
    } catch (err) {
      $.ui.log(`test-board: history not saved: ${String(err).slice(0, 120)}`)
    }
  }
}

async function partsFor($: EngineInterface, run: TestRun, now: number, columns: number, reserve: number) {
  let history: TestRun[] = []
  try {
    history = asRuns(await $.store.get(`runs:${run.key}`))
  } catch {
    // history unreadable: the run still draws, as a first run
  }
  return { run, parts: lineParts(run, previousRun(history, run), now, columns, reserve) }
}

// A draw is cached until something it read changes, so the hour has to end in a state write.
// One timer, due when the oldest run in latest turns an hour old; each fire re-arms it.
async function armExpiry($: EngineInterface, state: State): Promise<void> {
  state.expiry?.cancel()
  state.expiry = undefined
  const runs = await read($, latest)
  if (runs.length === 0) return
  const due = Math.min(...runs.map(r => r.at)) + BAND_TTL_MS
  state.expiry = $.clock.after(Math.max(0, due - await $.clock.now()), () => void expire($, state))
}

// Drops runs past the hour from latest: the write redraws every band that reads it (this one, session-compass).
// Only expired runs go; a run dated after `now` (a clock stepped back) stays, and the render hides it.
async function expire($: EngineInterface, state: State): Promise<void> {
  try {
    const now = await $.clock.now()
    const isExpired = (r: TestRun): boolean => now - r.at >= BAND_TTL_MS
    if ((await read($, latest)).some(isExpired)) {
      const kept = await update($, latest, list => list.filter(r => !isExpired(r)))
      if (kept.length === 0) await update($, expanded, () => false)
    }
    await armExpiry($, state)
  } catch (err) {
    $.ui.log(`test-board: expired runs not cleared: ${String(err).slice(0, 120)}`)
  }
}

// Queued behind record(), so a run cannot land between reading and writing the dismissal.
async function dismiss($: EngineInterface): Promise<void> {
  const head = visibleRuns(await read($, latest), await $.clock.now())[0]
  if (head === undefined) return
  await update($, dismissed, () => ({ key: head.key, at: head.at }))
  await update($, expanded, () => false)
}

const isDismissed = (d: { key: string; at: number } | null, run: TestRun | undefined): boolean =>
  d !== null && run !== undefined && d.key === run.key && d.at === run.at

async function record(
  $: EngineInterface, state: State,
  call: { command: string; agentId: string | undefined; startCwd: string }, ran: Ran,
) {
  const text = outputOf(ran)
  if (text === null) return
  const parts = splitCommand(call.command)
  const parsed = parseTestOutput({ command: parts.normalized, text, ...commandEvidence(ran) })
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
  // A run after ✕ starts the band afresh: the rows the person closed stay closed.
  const wasDismissed = (await read($, dismissed)) !== null
  await update($, latest, list =>
    [run, ...(isFresh || wasDismissed ? [] : list.filter(r => r.key !== run.key && r.stale !== true))].slice(0, MAX_LATEST))
  if (wasDismissed) await update($, dismissed, () => null)
  await armExpiry($, state)
}

export const register: Register = on => {
  const state = { loops: new Map<string, Loop>(), roots: new Map<string, string>(), turn: { isNew: true }, chain: Promise.resolve() } as State

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
      // Serial queue: record() calls never interleave, so store and latest updates cannot be lost.
      state.chain = state.chain
        .then(() => record($, state, { command: e.command, agentId: e.agentId, startCwd }, ran as Ran))
        .catch((err: unknown) => {
          $.ui.log(`test-board: run not recorded: ${String(err).slice(0, 120)}`)
        })
      await state.chain
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
    // A delivery into a running turn (peer message, notification) is not a new turn.
    if (e.turnId === undefined) state.turn.isNew = true
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const result = next(e)
    try {
      const root = await worktreeRoot($, state.roots, e.cwd)
      const key = asKeys(await $.store.get('index')).find(k => k.startsWith(`${root}::`))
      const newest = key === undefined ? undefined : asRuns(await $.store.get(`runs:${key}`))[0]
      const now = await $.clock.now()
      // A reload fires session.start too: a run past the hour stays off the band, and a closed band stays closed.
      const isClosed = (await read($, dismissed)) !== null
      if (newest !== undefined && !isClosed && visibleRuns([newest], now).length > 0) {
        await update($, latest, () => [{ ...newest, stale: true }])
      }
      // A hot reload cancels the old timer: re-arm for whatever latest now holds.
      await armExpiry($, state)
    } catch (err) {
      $.ui.log(`test-board: history not loaded: ${String(err).slice(0, 120)}`)
    }
    return result
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const held = await read($, latest)
    if (held.length === 0) return next(e)
    const now = await $.clock.now()
    // Hides runs dated after `now` and covers a timer that has not fired yet.
    const runs = visibleRuns(held, now)
    if (runs.length === 0 || isDismissed(await read($, dismissed), runs[0])) return next(e)
    const isOpen = await read($, expanded)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const rows = await Promise.all(runs.map((run, i) => partsFor($, run, now, columns, i === 0 ? CLOSE_RESERVE : 0)))
    const close = (): Promise<void> => {
      state.chain = state.chain.then(() => dismiss($)).catch((err: unknown) => {
        $.ui.log(`test-board: band not closed: ${String(err).slice(0, 120)}`)
      })
      return state.chain
    }
    return (
      <Box flexDirection="column">
        {rows.map(({ run, parts }, i) => (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Button key={`run-${run.key}`} plain onPress={() => update($, expanded, v => !v)}>
                <Text dimColor={run.stale === true}>{parts.label}{GAP}</Text>
                {parts.split === undefined && <Text dimColor={run.stale === true}>{parts.counts}</Text>}
                {parts.split !== undefined && <Text dimColor={run.stale === true}>{parts.split.head}</Text>}
                {parts.split !== undefined && (
                  <Text color={run.failed > 0 ? 'error' : undefined} dimColor={run.stale === true}>{parts.split.failed}</Text>
                )}
                {parts.split !== undefined && <Text dimColor={run.stale === true}>{parts.split.tail}</Text>}
                {parts.status !== undefined && <Text color={parts.isFailing ? 'error' : undefined}>{tail(parts.status)}</Text>}
                <Text dimColor={run.stale === true}>{tail(parts.trend, parts.duration)}</Text>
                <Text dimColor>{tail(parts.doneAt, parts.prev, parts.via)}</Text>
              </Button>
              {i === 0 && <Text>{CLOSE_GAP}</Text>}
              {i === 0 && (
                <Button key="close" plain dimColor role="dismiss" label="Close test results" onPress={close}>✕</Button>
              )}
            </Box>
            {isOpen && run.failures.slice(0, MAX_SHOWN_FAILURES).map(f => (
              <Text dimColor>{`    ${f.id}${f.loc === undefined ? '' : `  ${f.loc}`}`}</Text>
            ))}
          </Box>
        ))}
        {await next(e)}
      </Box>
    )
  })
}
