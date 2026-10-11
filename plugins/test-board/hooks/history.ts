import type { TestRun } from '../types'

export const MAX_RUNS = 10
export const MAX_LATEST = 3
export const MAX_FAILURES = 20
export const STORE_SOFT_CAP_BYTES = 2 * 1024 * 1024
export const BAND_TTL_MS = 60 * 60_000

export type KeySize = { key: string; bytes: number }

function toStored(run: TestRun): TestRun {
  const { stale: _stale, ...rest } = run
  return { ...rest, failures: run.failures.slice(0, MAX_FAILURES) }
}

export function appendRun(history: TestRun[], run: TestRun): TestRun[] {
  return [toStored(run), ...history].slice(0, MAX_RUNS)
}

export function previousRun(history: TestRun[], run: TestRun): TestRun | undefined {
  return history.find(r => r.at < run.at)
}

/** Runs the band still shows: under an hour old. */
export function visibleRuns(latest: TestRun[], now: number): TestRun[] {
  return latest.filter(r => now - r.at < BAND_TTL_MS)
}

export function touchIndex(index: string[], key: string): string[] {
  return [key, ...index.filter(k => k !== key)]
}

/** `sizes` is most-recent-first; drops from the end until the total fits. */
export function keysToDrop(sizes: KeySize[], capBytes: number, keep: string): string[] {
  let total = sizes.reduce((sum, s) => sum + s.bytes, 0)
  const dropped: string[] = []
  for (let i = sizes.length - 1; i >= 0 && total > capBytes; i -= 1) {
    const size = sizes[i]
    if (size === undefined || size.key === keep) continue
    total -= size.bytes
    dropped.push(size.key)
  }
  return dropped
}

export function oldestQuarter(index: string[], keep: string): string[] {
  const candidates = index.filter(k => k !== keep)
  const count = Math.max(1, Math.floor(index.length / 4))
  return candidates.slice(-count)
}
