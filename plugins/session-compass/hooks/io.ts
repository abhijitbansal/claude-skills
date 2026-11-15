import type { SessionRecord } from '../types'

// Pure store-layout helpers. The host follows `$` only inside the file that
// holds register (register.tsx), so every helper that takes `$` lives there.
export const INDEX = 'index'
export const PREFIX = 'session:'
export const GIT_TIMEOUT_MS = 5_000
export const recordKey = (id: string): string => `${PREFIX}${id}`

// Enough of a record to heal: session.start fills the rest from where the session is.
export const isPartialRecord = (v: unknown): v is SessionRecord =>
  typeof v === 'object' && v !== null && typeof (v as SessionRecord).id === 'string' &&
  Array.isArray((v as SessionRecord).artifacts)

// A record the band and pane can draw without guarding every field.
export const isRecord = (v: unknown): v is SessionRecord =>
  isPartialRecord(v) && typeof v.worktree === 'string' && Number.isFinite(v.lastActive)
