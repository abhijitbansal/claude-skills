import type { SourceMatch, SourceSnapshot } from '../types'
import { isTestCommand } from './parse'
import { resolveDir, splitCommand } from './suite'

export const SOURCE_SCOPE = 'git-tracked+untracked-nonignored'

// Mirrors the collector's single-scan byte cap: `max_bytes` in scripts/source_snapshot.py `capture()`.
// Keep the two equal, or a repo the collector reports available is rejected here as invalid_capture.
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024

const reasons = new Set(['deadline', 'unsupported_host', 'git_output_limit', 'git_unavailable',
  'invalid_listing', 'unsupported_index', 'file_limit', 'unsupported_path', 'unsupported_file',
  'byte_limit', 'changed_during_capture', 'not_worktree_root', 'unavailable', 'invalid_arguments'])
const silent = new Set(['unavailable', 'invalid_capture'])
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
const exactKeys = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))

export const unknownSource = (reason = 'unavailable'): SourceSnapshot =>
  ({ version: 1, scope: SOURCE_SCOPE, status: 'unknown', reason })

function available(v: unknown): v is Extract<SourceSnapshot, { status: 'available' }> {
  return object(v) && v.version === 1 && v.scope === SOURCE_SCOPE && v.status === 'available'
    && exactKeys(v, ['version', 'scope', 'status', 'root', 'head', 'branch', 'digest', 'files', 'bytes'])
    && typeof v.root === 'string' && v.root.startsWith('/') && v.root.length <= 4096 && !v.root.includes('\0')
    && typeof v.head === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v.head)
    && (v.branch === null || (typeof v.branch === 'string' && v.branch.startsWith('refs/heads/') && v.branch.length <= 1024))
    && typeof v.digest === 'string' && /^[0-9a-f]{64}$/.test(v.digest)
    && count(v.files, 4096) && count(v.bytes, MAX_SOURCE_BYTES)
}

/** Accept only a complete, supported collector record. Never forward diagnostics or payloads. */
export function parseSourceCapture(result: unknown): SourceSnapshot {
  if (!object(result) || result.exitCode !== 0 || result.stderr !== '' || typeof result.stdout !== 'string'
    || result.stdout.length > 8192 || !result.stdout.endsWith('\n')
    || result.isStdoutTruncated === true || result.isStderrTruncated === true) return unknownSource('invalid_capture')
  try {
    const v: unknown = JSON.parse(result.stdout)
    if (available(v)) return v
    if (object(v) && exactKeys(v, ['version', 'scope', 'status', 'reason'])
      && v.version === 1 && v.scope === SOURCE_SCOPE && v.status === 'unknown'
      && typeof v.reason === 'string' && reasons.has(v.reason)) return unknownSource(v.reason)
  } catch { /* Truncated or malformed capture: no partial identity. */ }
  return unknownSource('invalid_capture')
}

/** Equality of bounded observations, not proof of what the command actually read. */
export function compareSourceSnapshots(before: unknown, after: unknown): SourceMatch {
  if (!available(before) || !available(after)) return 'unknown'
  return ['root', 'head', 'branch', 'digest', 'files', 'bytes'].every(key =>
    before[key as keyof typeof before] === after[key as keyof typeof after]) ? 'matching' : 'changed'
}

/** A capture was attempted and said something: a complete observation or a reason the collector gave.
 * Failures to run the collector at all (`unavailable`, `invalid_capture`) say nothing worth a line. */
export function hasSourceReport(source: unknown): boolean {
  const said = (v: unknown): boolean => available(v)
    || (object(v) && v.status === 'unknown' && typeof v.reason === 'string' && !silent.has(v.reason))
  return object(source) && (said(source.before) || said(source.after))
}

export function sourceRoot(source: unknown): string | undefined {
  return object(source) && available(source.before) && available(source.after)
    && source.before.root === source.after.root ? source.after.root : undefined
}

export function sourceMatchForRun(source: unknown, current: unknown): SourceMatch {
  if (!object(source)) return 'unknown'
  const during = compareSourceSnapshots(source.before, source.after)
  if (during !== 'matching') return during
  return compareSourceSnapshots(source.after, current)
}

/** Shell context we can locate without executing or interpreting shell expansions. */
export function sourceCwd(command: string, base: string): string | undefined {
  if (/[\0\r\n]/.test(command)) return undefined
  let rest = command.trim()
  let cwd = base
  const cd = /^cd\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s]+))\s*&&\s*/.exec(rest)
  if (cd) {
    const dir = cd[1] ?? cd[2] ?? cd[3] ?? ''
    // Bare names consult CDPATH even when quoted; `cd -` follows OLDPWD.
    if (!/^(?:\/|\.\.?\/|\.\.?$)/.test(dir)
      || /[\0~$`\\;|&<>\r\n*?\[\]{}]/.test(dir)) return undefined
    cwd = resolveDir(base, dir)
    rest = rest.slice(cd[0].length)
  }
  if (!cwd.startsWith('/') || /[\0\r\n]/.test(cwd) || /[;&|$`\\<>\r\n(){}'"]/.test(rest)) return undefined
  return isTestCommand(splitCommand(rest).normalized) ? cwd : undefined
}
