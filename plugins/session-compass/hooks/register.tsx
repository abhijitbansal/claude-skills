import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { SessionRecord } from '../types'
import { GIT_TIMEOUT_MS, INDEX, PREFIX, isRecord, recordKey } from './io'
import {
  LIMITS, applyStatus, basename, capArtifacts, newRecord, orderIndex, sortByActive,
  type StatusInput, type Where,
} from './record'

// Atoms sit in this file: the host's state scan reads only atoms declared here.
const record = atom({ plugin: 'session-compass', key: 'record' } as const, null)

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

async function commit($: EngineInterface, rec: SessionRecord): Promise<void> {
  await update($, record, () => rec)
  await saveRecord($, rec)
}

export const register: Register = on => {
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
    await commit($, stored ? { ...stored, ...where, lastActive: now } : newRecord(id, where, now))
    return next(e)
  })

  on('tool.call', { tool: STATUS_TOOL_ID }, async ($, e) => {
    const rec = await read($, record)
    if (rec === null) return { deny: 'session-compass: no session record yet' }
    const out = applyStatus(rec, onlyStrings(e as unknown as Record<string, unknown>), await $.clock.now())
    if ('error' in out) return { deny: out.error }
    await commit($, out)
    return { result: { text: 'ok' } }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, REMINDER] }
  })
}
