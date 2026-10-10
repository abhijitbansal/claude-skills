import type { SessionRecord } from '../types'

// Pure store-layout helpers. The host follows `$` only inside the file that
// holds register (register.tsx), so every helper that takes `$` lives there.
export const INDEX = 'index'
export const PREFIX = 'session:'
export const GIT_TIMEOUT_MS = 5_000
export const recordKey = (id: string): string => `${PREFIX}${id}`

export const isRecord = (v: unknown): v is SessionRecord =>
  typeof v === 'object' && v !== null && typeof (v as SessionRecord).id === 'string' &&
  Array.isArray((v as SessionRecord).artifacts)
