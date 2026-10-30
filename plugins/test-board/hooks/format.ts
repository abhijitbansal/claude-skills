import type { TestRun } from '../types'

export const NARROW_COLUMNS = 80
export const MAX_SHOWN_FAILURES = 10
export const GAP = '   '

// East Asian Wide/Fullwidth blocks, emoji drawn as emoji, and an emoji variation selector: two cells.
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}\ufe0f]|\p{Emoji_Presentation}/u
const segmenter = typeof Intl === 'object' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

const graphemes = (s: string): string[] =>
  segmenter === undefined ? Array.from(s) : Array.from(segmenter.segment(s), g => g.segment)

/** Terminal cells a string takes: a grapheme is one cell, two when wide. */
export function cellWidth(s: string): number {
  return graphemes(s).reduce((cells, g) => cells + (WIDE.test(g) ? 2 : 1), 0)
}

/** Each present part with the gap before it, as the band draws the end of a line. */
export function tail(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).map(s => `${GAP}${s}`).join('')
}

export type LineParts = {
  label: string; counts: string; isFailing: boolean
  /** `counts` cut around its failed segment so the UI can color only that part; absent when unparsed. */
  split?: { head: string; failed: string; tail: string }
  status?: string
  trend?: string; duration?: string; doneAt?: string; prev?: string; via?: string
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
    ? 'counts unavailable'
    : `${split.head}${split.failed}${split.tail}`
}

export function joinParts(p: LineParts): string {
  return [p.label, p.counts, p.status, p.trend, p.duration, p.doneAt, p.prev, p.via].filter(Boolean).join(GAP)
}

function status(run: TestRun): string | undefined {
  const command = run.commandStatus === 'interrupted' ? 'interrupted'
    : run.commandStatus === 'tool-error' ? 'tool error'
    : Number.isSafeInteger(run.exitCode) && run.exitCode !== 0 ? `${run.commandStatus === 'exited' ? '' : 'reported '}exit ${run.exitCode}`
    : run.commandStatus === 'exited' && run.exitCode === 0 ? undefined : 'command status unknown'
  return [command, run.countsIssue === undefined ? undefined : `${run.countsIssue} counts`,
    run.outputIncomplete ? 'output incomplete' : undefined].filter(Boolean).join(' · ') || undefined
}

/**
 * The line's parts, dropping fields until it fits `columns - reserve` cells.
 * `reserve` is width another control takes on the row; `via` drops on a
 * narrow terminal by `columns` alone.
 */
export function lineParts(run: TestRun, prev: TestRun | undefined, now: number, columns: number, reserve = 0): LineParts {
  const delta = prev?.parsed && run.parsed ? run.failed - prev.failed : 0
  let parts: LineParts = {
    label: `${repoName(run.key)} · ${run.suite}`,
    counts: counts(run),
    ...(run.parsed ? { split: countSplit(run) } : {}),
    status: status(run),
    isFailing: (run.parsed && run.failed > 0) || (Number.isSafeInteger(run.exitCode) && run.exitCode !== 0)
      || run.commandStatus === 'tool-error' || run.commandStatus === 'interrupted',
    ...(delta > 0 ? { trend: `▲${delta} ✗` } : delta < 0 ? { trend: `▼${-delta} ✗` } : {}),
    ...(run.durationS === undefined ? {} : { duration: formatDuration(run.durationS) }),
    doneAt: `done ${formatClock(run.at)}`,
    prev: prev === undefined
      ? 'first run'
      : `prev ${prev.parsed ? `${prev.passed} ✓ ${prev.failed} ✗` : 'counts unavailable'}${status(prev) ? ` · ${status(prev)}` : ''} · ${formatAgo(now - prev.at)}`,
    ...(run.via === undefined ? {} : { via: `via ${run.via}` }),
  }
  if (columns < NARROW_COLUMNS) parts = { ...parts, via: undefined }
  for (const field of ['via', 'prev', 'duration', 'doneAt'] as const) {
    if (cellWidth(joinParts(parts)) <= columns - reserve) break
    parts = { ...parts, [field]: undefined }
  }
  return parts
}
