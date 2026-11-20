import type { Artifact, SessionRecord } from '../types'
import { clusters } from './cells'

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

// Control characters (C0, DEL, C1): an ESC or BEL in stored text must never reach the terminal.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

// Flattens whitespace to single spaces, drops control characters, then cuts to `max` UTF-16 units
// including the ellipsis, between clusters: never half an emoji.
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').replace(CONTROL, '').trim()
  if (flat.length <= max) return flat
  let kept = ''
  for (const cluster of clusters(flat)) {
    if (kept.length + cluster.length > max - 1) break
    kept += cluster
  }
  return `${kept}…`
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
  const given = STATUS_FIELDS.filter(k => input[k] !== undefined)
  if (given.length === 0) {
    return { error: 'compass_status needs at least one field of: goal, step, next (an empty string clears one)' }
  }
  // A field left out keeps its value; an empty (or blank) string clears it.
  const next: SessionRecord = { ...rec, statusAt: now, lastActive: now }
  for (const k of given) {
    const value = (input[k] ?? '').trim()
    if (value === '') delete next[k]
    else next[k] = truncate(value, LIMITS[k])
  }
  return next
}

export function artifactKey(a: Artifact): string {
  switch (a.kind) {
    case 'artifact': return `artifact:${a.url}`
    case 'file': return `file:${a.path}`
    case 'doc': return `doc:${a.path}`
    case 'commit': return `commit:${a.sha}`
    case 'push': return `push:${a.remote}:${a.branch}`
    // A PR number repeats across repos; its URL does not. Older records may lack the URL.
    case 'pr': return a.url !== '' ? `pr:${a.url}` : `pr:${a.number}`
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
