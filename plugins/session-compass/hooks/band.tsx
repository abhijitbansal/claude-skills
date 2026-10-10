import type { EngineInterface, RenderElement } from 'claude-code'
import type { SessionRecord } from '../types'
import { basename, truncate } from './record'

// Pure view builders: no `$` here (the host does not follow it out of register.tsx).
export type Tally = { passed: number; failed: number }
export type BandLine = { text: string; isDim: boolean }
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

export function tally(runs: readonly unknown[] | undefined): Tally | undefined {
  if (runs === undefined) return undefined
  let passed = 0
  let failed = 0
  let isAny = false
  for (const run of runs) {
    const r = run as { parsed?: unknown; passed?: unknown; failed?: unknown }
    if (r.parsed !== true || typeof r.passed !== 'number' || typeof r.failed !== 'number') continue
    passed += r.passed
    failed += r.failed
    isAny = true
  }
  return isAny ? { passed, failed } : undefined
}

const lastTwo = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/')

export function formatBand(rec: SessionRecord, tests: Tally | undefined, columns: number): BandLine {
  const isDim = rec.goal === undefined
  const goal = rec.goal !== undefined ? `Goal: ${rec.goal}` : `Goal: "${rec.firstPrompt ?? '…'}" (no goal set)`
  const now = rec.step !== undefined ? `Now: ${rec.step}` : undefined
  const count = rec.artifacts.length
  const artifacts = `${count} artifact${count === 1 ? '' : 's'}`
  const testText = tests ? `tests ${tests.passed} ✓ ${tests.failed} ✗` : undefined
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
    if (text.length <= columns) return { text, isDim }
  }
  return { text: truncate(text, columns), isDim }
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
