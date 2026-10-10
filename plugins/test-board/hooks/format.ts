import type { TestRun } from '../types'

export const NARROW_COLUMNS = 80
export const MAX_SHOWN_FAILURES = 10
const GAP = '   '

export type LineParts = {
  label: string; counts: string; isFailing: boolean
  trend?: string; duration?: string; prev?: string; via?: string
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function repoName(key: string): string {
  return key.slice(0, key.indexOf('::')).split('/').filter(Boolean).pop() ?? ''
}

function counts(run: TestRun): string {
  return run.parsed
    ? `${run.passed} ✓  ${run.failed} ✗  ${run.skipped} skip`
    : `ran · exit ${run.exitCode} · counts unavailable`
}

export function joinParts(p: LineParts): string {
  return [p.label, p.counts, p.trend, p.duration, p.prev, p.via].filter(Boolean).join(GAP)
}

export function lineParts(run: TestRun, prev: TestRun | undefined, now: number, columns: number): LineParts {
  const delta = prev?.parsed && run.parsed ? run.failed - prev.failed : 0
  let parts: LineParts = {
    label: `${repoName(run.key)} · ${run.suite}`,
    counts: counts(run),
    isFailing: run.parsed ? run.failed > 0 : run.exitCode !== 0,
    ...(delta > 0 ? { trend: `▲${delta} ✗` } : delta < 0 ? { trend: `▼${-delta} ✗` } : {}),
    ...(run.durationS === undefined ? {} : { duration: formatDuration(run.durationS) }),
    prev: prev === undefined
      ? 'first run'
      : `prev ${prev.parsed ? `${prev.passed} ✓ ${prev.failed} ✗` : `ran · exit ${prev.exitCode}`} · ${formatAgo(now - prev.at)}`,
    ...(run.via === undefined ? {} : { via: `via ${run.via}` }),
  }
  if (columns < NARROW_COLUMNS) parts = { ...parts, via: undefined }
  for (const field of ['via', 'prev', 'duration'] as const) {
    if (joinParts(parts).length <= columns) break
    parts = { ...parts, [field]: undefined }
  }
  return parts
}
