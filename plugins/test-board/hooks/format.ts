import type { TestRun } from '../types'

export const NARROW_COLUMNS = 80
export const MAX_SHOWN_FAILURES = 10
const GAP = '   '

export type LineParts = {
  label: string; counts: string; isFailing: boolean
  /** `counts` cut around its failed segment so the UI can color only that part; absent when unparsed. */
  split?: { head: string; failed: string; tail: string }
  trend?: string; duration?: string; ranAt?: string; prev?: string; via?: string
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

export function formatClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function repoName(key: string): string {
  return key.slice(0, key.indexOf('::')).split('/').filter(Boolean).pop() ?? ''
}

function countSplit(run: TestRun): LineParts['split'] {
  return run.parsed
    ? { head: `${run.passed} ✓  `, failed: `${run.failed} ✗`, tail: `  ${run.skipped} skip` }
    : undefined
}

function counts(run: TestRun): string {
  const split = countSplit(run)
  return split === undefined
    ? `ran · exit ${run.exitCode} · counts unavailable`
    : `${split.head}${split.failed}${split.tail}`
}

export function joinParts(p: LineParts): string {
  return [p.label, p.counts, p.trend, p.duration, p.ranAt, p.prev, p.via].filter(Boolean).join(GAP)
}

export function lineParts(run: TestRun, prev: TestRun | undefined, now: number, columns: number): LineParts {
  const delta = prev?.parsed && run.parsed ? run.failed - prev.failed : 0
  let parts: LineParts = {
    label: `${repoName(run.key)} · ${run.suite}`,
    counts: counts(run),
    ...(run.parsed ? { split: countSplit(run) } : {}),
    isFailing: run.parsed ? run.failed > 0 : run.exitCode !== 0,
    ...(delta > 0 ? { trend: `▲${delta} ✗` } : delta < 0 ? { trend: `▼${-delta} ✗` } : {}),
    ...(run.durationS === undefined ? {} : { duration: formatDuration(run.durationS) }),
    ranAt: `ran ${formatClock(run.at)}`,
    prev: prev === undefined
      ? 'first run'
      : `prev ${prev.parsed ? `${prev.passed} ✓ ${prev.failed} ✗` : `ran · exit ${prev.exitCode}`} · ${formatAgo(now - prev.at)}`,
    ...(run.via === undefined ? {} : { via: `via ${run.via}` }),
  }
  if (columns < NARROW_COLUMNS) parts = { ...parts, via: undefined }
  for (const field of ['via', 'prev', 'duration', 'ranAt'] as const) {
    if (joinParts(parts).length <= columns) break
    parts = { ...parts, [field]: undefined }
  }
  return parts
}
