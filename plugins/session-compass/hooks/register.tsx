import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { Artifact, SessionRecord } from '../types'
import { bandView, formatBand, tally } from './band'
import { capture } from './capture'
import { PANE_ID, paneView, type Tab } from './pane'
import { GIT_TIMEOUT_MS, INDEX, PREFIX, isRecord, recordKey } from './io'
import {
  LIMITS, addArtifact, applyStatus, basename, capArtifacts, newRecord, orderIndex, sortByActive, touch, withFirstPrompt,
  type StatusInput, type Where,
} from './record'

// Atoms sit in this file: the host's state scan reads only atoms declared here.
const record = atom({ plugin: 'session-compass', key: 'record' } as const, null)
const band = atom({ plugin: 'session-compass', key: 'band' } as const, 'hidden' as 'hidden' | 'return')
const tab = atom({ plugin: 'session-compass', key: 'tab' } as const, 'this' as Tab)
const IDLE_TICK_MS = 60_000

export const STATUS_TOOL_ID = 'mcp__session-compass__compass_status'
const STATUS_TOOL = {
  name: 'compass_status',
  description:
    'Record what this session is building (goal), where it stands (step), and what comes next. ' +
    'Call it when the goal is first clear and whenever the phase changes ' +
    '(spec, plan, implement, review, PR, done), not every turn.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'What this session is building (up to 80 chars)' },
      step: { type: 'string', description: 'Where it stands now (up to 60 chars)' },
      next: { type: 'string', description: 'What comes next (up to 60 chars)' },
    },
    additionalProperties: false,
  },
  isDeferred: false,
}
const REMINDER = {
  id: 'session-compass:reminder',
  text: 'Keep the session compass current with the compass_status tool when the goal or phase changes.',
  scope: 'session',
} as const
const CAPTURED = new Set(['Artifact', 'SendUserFile', 'Write', 'Bash'])
const GIT_MOVE = /\bgit\s+(checkout|switch|worktree|commit|push)\b/

export async function loadRecord($: EngineInterface, id: string): Promise<SessionRecord | undefined> {
  const raw = await $.store.get(recordKey(id))
  return isRecord(raw) ? raw : undefined
}

// The index is last-write-wins across concurrent sessions, so it can lose an id
// whose record is still stored. Every read merges those back in, newest first.
export async function loadIndex($: EngineInterface): Promise<string[]> {
  const raw = await $.store.get(INDEX)
  const listed = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const known = new Set(listed)
  const missing = (await $.store.keys())
    .filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)).filter(id => !known.has(id))
  if (missing.length === 0) return listed
  const recs = (await Promise.all([...listed, ...missing].map(id => loadRecord($, id)))).filter(isRecord)
  const sorted = sortByActive(recs).map(r => r.id)
  return [...sorted, ...listed.filter(id => !sorted.includes(id))]
}

async function writeAll($: EngineInterface, rec: SessionRecord, maxSessions: number): Promise<void> {
  await $.store.set(recordKey(rec.id), rec)
  const { index, dropped } = orderIndex(await loadIndex($), rec.id, maxSessions)
  for (const id of dropped) await $.store.delete(recordKey(id))
  await $.store.set(INDEX, index)
}

async function trimOthers($: EngineInterface, keepId: string): Promise<void> {
  for (const id of await loadIndex($)) {
    if (id === keepId) continue
    const other = await loadRecord($, id)
    if (other !== undefined && other.artifacts.length > LIMITS.trimArtifacts) {
      await $.store.set(recordKey(id), capArtifacts(other, LIMITS.trimArtifacts))
    }
  }
}

// Frees space before a retry: shrink the index, drop what falls off it, cap the
// artifacts of every session that stays.
async function freeSpace($: EngineInterface, keepId: string): Promise<void> {
  const { index, dropped } = orderIndex(await loadIndex($), keepId, LIMITS.trimSessions)
  for (const id of dropped) await $.store.delete(recordKey(id))
  await $.store.set(INDEX, index)
  await trimOthers($, keepId)
}

export async function saveRecord($: EngineInterface, rec: SessionRecord): Promise<void> {
  try {
    await writeAll($, rec, LIMITS.sessions)
  } catch {
    try {
      await freeSpace($, rec.id)
      await writeAll($, capArtifacts(rec, LIMITS.trimArtifacts), LIMITS.trimSessions)
    } catch (err) {
      $.ui.log(`session-compass: store write failed, kept in session only: ${String(err).slice(0, 120)}`)
    }
  }
}

export async function listSessions($: EngineInterface, excludeId: string): Promise<SessionRecord[]> {
  const ids = (await loadIndex($)).filter(id => id !== excludeId)
  const recs = await Promise.all(ids.map(id => loadRecord($, id)))
  return sortByActive(recs.filter(isRecord)).slice(0, LIMITS.sessions)
}

async function git($: EngineInterface, args: readonly string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS })
    const out = ran.stdout.trim()
    return ran.exitCode === 0 && out !== '' ? out : undefined
  } catch {
    return undefined
  }
}

export async function locate($: EngineInterface, prev?: Where, startCwd?: string): Promise<Where> {
  const cwd = startCwd ?? (await $.session.cwd().catch(() => prev?.worktree ?? ''))
  const repoRoot = await $.session.repo().then(r => r?.root).catch(() => undefined)
  const worktree = (await git($, ['rev-parse', '--show-toplevel'])) ?? prev?.worktree ?? cwd
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? prev?.branch ?? ''
  const repo = repoRoot !== undefined ? basename(repoRoot) : prev?.repo ?? basename(worktree)
  return { repo, worktree, branch }
}

// Test Board's latest runs, when Test Board is installed (U14 decides whether
// this read needs a `dependencies` entry). Never throws.
export async function readTestBoard($: EngineInterface): Promise<unknown[] | undefined> {
  try {
    const held = await $.state.get({ plugin: 'test-board', key: 'latest' } as never)
    const value = (held as { value?: unknown }).value
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

// The model supplies the input; anything that is not a string counts as left out.
function onlyStrings(input: Record<string, unknown>): StatusInput {
  const pick = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return { goal: pick(input.goal), step: pick(input.step), next: pick(input.next) }
}

// Folds new artifacts (and a fresh branch, after a git move) into the record
// with CAS updates, then saves what was written. Callers queue it so saves never interleave.
async function applyCapture($: EngineInterface, found: Artifact[], isGitMove: boolean): Promise<void> {
  if ((await read($, record)) === null) return
  let written = await update($, record, cur => (cur === null ? cur : found.reduce(addArtifact, cur)))
  if (written === null) return
  if (isGitMove) {
    const where = await locate($, written)
    written = await update($, record, cur => (cur === null ? cur : { ...cur, ...where }))
  }
  if (written !== null) await saveRecord($, written)
}

type Chain = { chain: Promise<void>; isTurnRunning: boolean; idle?: Timer }

async function idleTick($: EngineInterface, state: Chain): Promise<void> {
  const rec = await read($, record)
  if (rec === null || state.isTurnRunning) return
  const isIdle = (await $.clock.now()) - rec.lastActive >= LIMITS.idleMs
  if (isIdle && (await read($, band)) !== 'return') await update($, band, () => 'return')
}

async function touchRecord($: EngineInterface, state: Chain, change: (r: SessionRecord, now: number) => SessionRecord) {
  await queue(state, 'touch', async () => {
    const now = await $.clock.now()
    const written = await update($, record, cur => (cur === null ? cur : change(cur, now)))
    if (written !== null) await saveRecord($, written)
  }, $).catch(() => undefined)
}

// Record writes run one at a time so store saves never interleave. The chain
// link is catch-wrapped so one failure never poisons it; the caller gets the
// job's own settled promise and decides what a failure means.
function queue(state: Chain, kind: string, job: () => Promise<void>, $: EngineInterface): Promise<void> {
  const run = state.chain.then(job)
  state.chain = run.catch((err: unknown) => {
    try {
      $.ui.log(`session-compass: ${kind} failed: ${String(err).slice(0, 120)}`)
    } catch {
      // a throwing log must not leave the chain rejected
    }
  })
  return run
}

export const register: Register = on => {
  // One promise chain per load: capture passes run one at a time.
  const state: Chain = { chain: Promise.resolve(), isTurnRunning: false }

  on('session.start', async ($, e, next) => {
    await $.tool.register(STATUS_TOOL)
    await $.command.register({ name: 'compass', description: 'Open the session compass pane' })
    const id = await $.session.id()
    const now = await $.clock.now()
    const stored = await loadRecord($, id).catch(err => {
      $.ui.log(`session-compass: store read failed, starting fresh: ${String(err).slice(0, 120)}`)
      return undefined
    })
    const where = await locate($, stored, e.cwd)
    const started = stored ? { ...stored, ...where, lastActive: now } : newRecord(id, where, now)
    await queue(state, 'start', async () => {
      await update($, record, () => started)
      await saveRecord($, started)
    }, $).catch(() => undefined)
    if ((await $.session.turns()) > 0) await update($, band, () => 'return')
    state.idle?.cancel()
    state.idle = $.clock.every(IDLE_TICK_MS, () => idleTick($, state))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    state.isTurnRunning = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    // Only a prompt the person typed that entered as a new turn counts; a drop
    // or a peer/notification/plugin prompt changes nothing.
    const isPerson = e.origin === undefined || e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (ran.drop === undefined && e.turnId === undefined && isPerson) {
      await update($, band, () => 'hidden')
      await touchRecord($, state, (r, now) => touch(withFirstPrompt(r, e.text), now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn (agentId set) is not the main loop's.
    if (e.agentId === undefined) {
      state.isTurnRunning = false
      await touchRecord($, state, touch)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, band)
    const rec = await read($, record)
    if (e.props.hasSurvey || shown !== 'return' || rec === null) return next(e)
    const line = formatBand(rec, tally(await readTestBoard($)), e.props.bodyColumns)
    return bandView($.ui.resolve(e), line, await next(e))
  })

  on('command.run', { command: 'compass' }, async $ => {
    await $.ui.open({ id: PANE_ID, title: 'Compass' })
    return { text: 'Compass opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const shown = await read($, tab)
    const rec = await read($, record)
    // A corrupt or missing index never crashes the pane: loadIndex rebuilds from session keys.
    const others = shown === 'all' ? await listSessions($, rec?.id ?? '').catch(() => []) : []
    const tests = shown === 'this' ? tally(await readTestBoard($)) : undefined
    return paneView($.ui.resolve(e), {
      tab: shown, rec, others, tests, now: await $.clock.now(), columns: e.props.bodyColumns,
    }, {
      onTab: next => { void update($, tab, () => next) },
      onCopy: text => { void $.ui.copy({ text, surface: e.surface }) },
    })
  })

  on('tool.call', { tool: STATUS_TOOL_ID }, async ($, e) => {
    const input = onlyStrings(e as unknown as Record<string, unknown>)
    const outcome: { deny?: string } = {}
    const done = await queue(state, 'status', async () => {
      const now = await $.clock.now()
      let error: string | undefined
      const written = await update($, record, cur => {
        error = undefined
        if (cur === null) return cur
        const out = applyStatus(cur, input, now)
        if ('error' in out) {
          error = out.error
          return cur
        }
        return out
      })
      if (written === null) outcome.deny = 'session-compass: no session record yet'
      else if (error !== undefined) outcome.deny = error
      else await saveRecord($, written)
    }, $).then(() => true, () => false)
    if (!done) return { deny: 'session-compass: status not saved, try again' }
    return outcome.deny === undefined ? { result: { text: 'ok' } } : { deny: outcome.deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'session compass is busy; try again' }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!CAPTURED.has(tool) || ran.deny !== undefined) return ran
    const input = e as unknown as Record<string, unknown>
    let found: Artifact[] = []
    try {
      found = capture({ tool, input, result: ran.result, isError: ran.isError === true, now: await $.clock.now() })
    } catch (err) {
      $.ui.log(`session-compass: capture failed: ${String(err).slice(0, 120)}`)
    }
    // A subagent's git move happens in its own worktree: it must not relocate this session.
    const command = typeof input.command === 'string' ? input.command : ''
    const isGitMove = tool === 'Bash' && input.agentId === undefined && GIT_MOVE.test(command)
    // Decided before waiting: a call that captures nothing never queues behind the chain.
    if (found.length === 0 && !isGitMove) return ran
    await queue(state, 'capture', () => applyCapture($, found, isGitMove), $).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, REMINDER] }
  })
}
