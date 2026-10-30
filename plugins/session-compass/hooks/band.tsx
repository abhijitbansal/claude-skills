import type { EngineInterface, RenderElement } from 'claude-code'
import type { SessionRecord } from '../types'
import { basename, truncate } from './record'

// Pure view builders: no `$` here (the host does not follow it out of register.tsx).
export type Tally = { passed: number; failed: number; warnings?: number }
export type BandLine = { text: string; isDim: boolean }
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

export function tally(runs: readonly unknown[] | undefined): Tally | undefined {
  if (runs === undefined) return undefined
  let passed = 0
  let failed = 0
  let isAny = false
  let warnings = 0
  for (const run of runs) {
    isAny = true
    if (run === null || typeof run !== 'object') { warnings += 1; continue }
    const r = run as Record<string, unknown>
    const countValues = [r.total, r.passed, r.failed, r.skipped]
    const valid = r.parsed === true && countValues.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
      && r.total === (r.passed as number) + (r.failed as number) + (r.skipped as number)
      && Number.isSafeInteger(passed + (r.passed as number)) && Number.isSafeInteger(failed + (r.failed as number))
      && r.countsIssue === undefined
    if (valid) {
      passed += r.passed as number
      failed += r.failed as number
    }
    if (!valid || r.commandStatus !== 'exited' || r.exitCode !== 0 || r.outputIncomplete === true
      || (r.failed as number) > 0 || r.stale === true) warnings += 1
  }
  return isAny ? { passed, failed, warnings } : undefined
}

const lastTwo = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/')

export function formatBand(rec: SessionRecord, tests: Tally | undefined, columns: number): BandLine {
  const isDim = rec.goal === undefined
  const goal = rec.goal !== undefined ? `Goal: ${rec.goal}` : `Goal: "${rec.firstPrompt ?? '…'}" (no goal set)`
  const now = rec.step !== undefined ? `Now: ${rec.step}` : undefined
  const count = rec.artifacts.length
  const artifacts = `${count} artifact${count === 1 ? '' : 's'}`
  const testText = tests ? `tests ${tests.passed} ✓ ${tests.failed} ✗` : undefined
  const warnings = tests?.warnings ?? 0
  // Reserve the warning first: dropping optional segments must not erase a failed/unknown run.
  const warning = warnings > 0 ? `tests: ${warnings} warning${warnings === 1 ? '' : 's'}` : ''
  const prefix = warning === '' ? '' : `${warning} · `
  if (prefix.length >= columns) return { text: truncate(warning, Math.max(0, columns)), isDim }
  const available = columns - prefix.length
  const attempts = [
    { wt: lastTwo(rec.worktree), hasArtifacts: true, hasTests: true },
    { wt: lastTwo(rec.worktree), hasArtifacts: false, hasTests: true },
    { wt: lastTwo(rec.worktree), hasArtifacts: false, hasTests: false },
    { wt: basename(rec.worktree), hasArtifacts: false, hasTests: false },
  ]
  let text = ''
  for (const a of attempts) {
    text = [
      `${rec.repo} · ${a.wt} (${rec.branch})`,
      goal,
      now,
      a.hasArtifacts ? artifacts : undefined,
      a.hasTests ? testText : undefined,
    ].filter((s): s is string => s !== undefined).join(' · ')
    if (text.length <= available) return { text: prefix + text, isDim }
  }
  return { text: prefix + truncate(text, available), isDim }
}

// The compass line stacked above whatever the next band drew.
export function bandView({ Box, Text }: Els, line: BandLine, below: RenderElement): RenderElement {
  return (
    <Box flexDirection="column">
      <Text dimColor={line.isDim}>{line.text}</Text>
      {below}
    </Box>
  )
}
