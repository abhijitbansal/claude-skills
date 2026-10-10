import type { Artifact, SessionRecord } from '../types'

export const LIMITS = {
  goal: 80,
  step: 60,
  next: 60,
  firstPrompt: 80,
  artifacts: 100,
  sessions: 50,
  trimArtifacts: 50,
  trimSessions: 40,
} as const

export type StatusInput = { goal?: string; step?: string; next?: string }
export type Where = { repo: string; worktree: string; branch: string }

const STATUS_FIELDS = ['goal', 'step', 'next'] as const

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function newRecord(id: string, where: Where, now: number): SessionRecord {
  return { id, ...where, lastActive: now, artifacts: [] }
}

export function applyStatus(
  rec: SessionRecord,
  input: StatusInput,
  now: number,
): SessionRecord | { error: string } {
  const given = STATUS_FIELDS.filter(k => (input[k] ?? '').trim() !== '')
  if (given.length === 0) {
    return { error: 'compass_status needs at least one non-empty field of: goal, step, next' }
  }
  const patch: StatusInput = {}
  for (const k of given) patch[k] = truncate(input[k] ?? '', LIMITS[k])
  return { ...rec, ...patch, statusAt: now, lastActive: now }
}

export function artifactKey(a: Artifact): string {
  switch (a.kind) {
    case 'artifact': return `artifact:${a.url}`
    case 'file': return `file:${a.path}`
    case 'doc': return `doc:${a.path}`
    case 'commit': return `commit:${a.sha}`
    case 'push': return `push:${a.remote}:${a.branch}`
    case 'pr': return `pr:${a.number}`
  }
}

export function addArtifact(rec: SessionRecord, a: Artifact): SessionRecord {
  const key = artifactKey(a)
  const rest = rec.artifacts.filter(x => artifactKey(x) !== key)
  return { ...rec, artifacts: [a, ...rest].slice(0, LIMITS.artifacts) }
}

// A record the store could not be read for starts empty; once the store answers,
// what was stored fills the empty fields and the artifacts merge, newest first.
export function mergeStored(cur: SessionRecord, stored: SessionRecord): SessionRecord {
  const base: SessionRecord = {
    ...cur,
    goal: cur.goal ?? stored.goal,
    step: cur.step ?? stored.step,
    next: cur.next ?? stored.next,
    firstPrompt: cur.firstPrompt ?? stored.firstPrompt,
    statusAt: cur.statusAt ?? stored.statusAt,
    artifacts: [],
  }
  const oldestFirst = [...cur.artifacts, ...stored.artifacts].sort((a, b) => a.at - b.at)
  return oldestFirst.reduce(addArtifact, base)
}

export function capArtifacts(rec: SessionRecord, max: number): SessionRecord {
  return rec.artifacts.length <= max ? rec : { ...rec, artifacts: rec.artifacts.slice(0, max) }
}

export function touch(rec: SessionRecord, now: number): SessionRecord {
  return { ...rec, lastActive: now }
}

export function withFirstPrompt(rec: SessionRecord, text: string): SessionRecord {
  if (rec.firstPrompt !== undefined || text.trim() === '') return rec
  return { ...rec, firstPrompt: truncate(text, LIMITS.firstPrompt) }
}

export function orderIndex(
  index: readonly string[],
  id: string,
  max: number,
): { index: string[]; dropped: string[] } {
  const ordered = [id, ...index.filter(x => x !== id)]
  return { index: ordered.slice(0, max), dropped: ordered.slice(max) }
}

export function sortByActive(recs: readonly SessionRecord[]): SessionRecord[] {
  return [...recs].sort((a, b) => b.lastActive - a.lastActive)
}

export function ago(now: number, then: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
