import type { EngineInterface, RenderElement } from 'claude-code'
import type { SessionRecord } from '../types'
import { cellWidth, sliceCells } from './cells'
import { basename, truncate } from './record'

// Pure view builders: no `$` here (the host does not follow it out of register.tsx).
export type Tally = { passed: number; failed: number; warnings?: number }
// `text` is line one. `second` is line two, present only when line one could not hold it all.
// `isCut` is set when line two ends in an ellipsis, so the full text is worth opening.
export type BandLine = { text: string; isDim: boolean; second?: string; isCut?: boolean }
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>
export type BandControls = {
  isOpen: boolean
  full: readonly string[]
  hint: string
  onToggle: () => void
}

const SEPARATOR = '·'
const HINT_LONG = '▸ /compass more'
const HINT_SHORT = '▸ more'
const HINT_LONG_COLUMNS = 50
const HINT_SHORT_COLUMNS = 24

const DEFAULT_COLUMNS = 80
// A word this wide with no space in it (a URL, a path) is broken to fill the line instead of moving whole.
const LONG_TOKEN_CELLS = 20

// A usable width: the host's number when it is a positive finite one, else a default.
export function safeColumns(columns: number): number {
  return Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : DEFAULT_COLUMNS
}

// The label of the button that opens the full text; empty where it would not fit.
export function hintLabel(columns: number): string {
  const width = safeColumns(columns)
  if (width >= HINT_LONG_COLUMNS) return HINT_LONG
  return width >= HINT_SHORT_COLUMNS ? HINT_SHORT : ''
}

// Cells the hint takes at the end of line two: its label and one gap.
export function hintReserve(columns: number): number {
  const label = hintLabel(columns)
  return label === '' ? 0 : cellWidth(label) + 1
}

// Fills one line from the front of `words`, counting terminal cells. A word wider than the whole
// line, or a long unbroken one that does not fit the room left, is cut between clusters to fill the line.
function takeLine(words: readonly string[], width: number): { line: string; rest: string[] } {
  let line = ''
  for (const [i, word] of words.entries()) {
    const joined = line === '' ? word : `${line} ${word}`
    if (cellWidth(joined) <= width) {
      line = joined
      continue
    }
    const room = width - (line === '' ? 0 : cellWidth(line) + 1)
    const isLong = cellWidth(word) > width || cellWidth(word) >= LONG_TOKEN_CELLS
    const { head, tail } = isLong ? sliceCells(word, room) : { head: '', tail: word }
    if (head === '') return { line, rest: words.slice(i) }
    return { line: line === '' ? head : `${line} ${head}`, rest: [tail, ...words.slice(i + 1)].filter(w => w !== '') }
  }
  return { line, rest: [] }
}

// Wraps `text` onto at most two lines of `columns` cells, breaking at a space (a separator's dot
// is dropped where the break replaces it). Only line two is cut: at its end, with an ellipsis,
// leaving `reserve` cells free for the hint.
export function wrapTwo(text: string, columns: number, reserve = 0): { first: string; second?: string; isCut: boolean } {
  const width = safeColumns(columns)
  const words = text.split(' ').filter(w => w !== '')
  if (words.length === 0) return { first: '', isCut: false }
  const taken = takeLine(words, width)
  const first = taken.line.replace(/ ·$/, '')
  const rest = taken.rest[0] === SEPARATOR ? taken.rest.slice(1) : taken.rest
  if (rest.length === 0) return { first, isCut: false }
  const tail = rest.join(' ')
  if (cellWidth(tail) <= width) return { first, second: tail, isCut: false }
  const room = Math.max(1, width - reserve)
  return { first, second: `${sliceCells(tail, room - 1).head.replace(/[\s·]+$/, '')}…`, isCut: true }
}

export const goalKey = (rec: { goal?: string } | null): string => rec?.goal ?? ''

function goalText(rec: SessionRecord): string {
  return rec.goal !== undefined ? `Goal: ${rec.goal}` : `Goal: "${rec.firstPrompt ?? '…'}" (no goal set)`
}

// Every field in full, one row each: what the expanded band shows. Nothing is shortened here.
export function fullLines(rec: SessionRecord): string[] {
  return [
    `${rec.repo} · ${rec.worktree} (${rec.branch})`,
    goalText(rec),
    ...(rec.step !== undefined ? [`Now: ${rec.step}`] : []),
    ...(rec.next !== undefined ? [`Next: ${rec.next}`] : []),
  ]
}

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
    // A warning is evidence of trouble. An unknown status is the normal live shape; failed tests show as ✗; restored history is not trouble.
    if (!valid || r.commandStatus === 'tool-error' || r.commandStatus === 'interrupted' || r.outputIncomplete === true
      || (Number.isSafeInteger(r.exitCode) && r.exitCode !== 0)) warnings += 1
  }
  return isAny ? { passed, failed, warnings } : undefined
}

const lastTwo = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/')

export function formatBand(rec: SessionRecord, tests: Tally | undefined, bodyColumns: number): BandLine {
  const columns = safeColumns(bodyColumns)
  const isDim = rec.goal === undefined
  const goal = goalText(rec)
  const now = rec.step !== undefined ? `Now: ${rec.step}` : undefined
  const count = rec.artifacts.length
  const artifacts = `${count} artifact${count === 1 ? '' : 's'}`
  const testText = tests ? `tests ${tests.passed} ✓ ${tests.failed} ✗` : undefined
  const warnings = tests?.warnings ?? 0
  // Reserve the warning first: dropping optional segments must not erase a failed/unknown run.
  const warning = warnings > 0 ? `tests: ${warnings} warning${warnings === 1 ? '' : 's'}` : ''
  const prefix = warning === '' ? '' : `${warning} · `
  // The warning alone fills the line: the goal is dropped, so the full text is still worth opening.
  if (cellWidth(prefix) >= columns) return { text: truncate(warning, columns), isDim, second: '', isCut: true }
  const attempts = [
    { wt: lastTwo(rec.worktree), hasArtifacts: true, hasTests: true },
    { wt: lastTwo(rec.worktree), hasArtifacts: false, hasTests: true },
    { wt: lastTwo(rec.worktree), hasArtifacts: false, hasTests: false },
    { wt: basename(rec.worktree), hasArtifacts: false, hasTests: false },
  ]
  const texts = attempts.map(a => prefix + [
    `${rec.repo} · ${a.wt} (${rec.branch})`,
    goal,
    now,
    a.hasArtifacts ? artifacts : undefined,
    a.hasTests ? testText : undefined,
  ].filter((s): s is string => s !== undefined).join(' · '))
  // One line while any form fits: optional segments drop first, as before.
  const oneLine = texts.find(t => cellWidth(t) <= columns)
  if (oneLine !== undefined) return { text: oneLine, isDim }
  // Otherwise two lines: the fullest form that fits them whole, else the shortest, cut at the end of line two.
  for (const t of texts) {
    const wrapped = wrapTwo(t, columns)
    if (!wrapped.isCut) return { text: wrapped.first, isDim, ...(wrapped.second === undefined ? {} : { second: wrapped.second }) }
  }
  const cut = wrapTwo(texts[texts.length - 1] ?? '', columns, hintReserve(columns))
  return { text: cut.first, isDim, second: cut.second ?? '', isCut: true }
}

// The compass band stacked above whatever the next band drew: two rows at most, or the full text.
export function bandView({ Box, Text, Button }: Els, line: BandLine, below: RenderElement, ctl: BandControls): RenderElement {
  if (ctl.isOpen) {
    return (
      <Box flexDirection="column">
        {ctl.full.map((row, i) => (
          <Box key={`row-${i}`} flexDirection="column">
            <Text dimColor={line.isDim && row.startsWith('Goal: ')} wrap="wrap">{row}</Text>
          </Box>
        ))}
        <Button key="more" plain dimColor label="▾ fold" onPress={ctl.onToggle} />
        {below}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text dimColor={line.isDim} wrap="truncate-end">{line.text}</Text>
      {line.second !== undefined && line.isCut !== true && <Text dimColor={line.isDim} wrap="truncate-end">{line.second}</Text>}
      {line.isCut === true && (line.second !== '' || ctl.hint !== '') && (
        <Box flexDirection="row">
          <Text dimColor={line.isDim} wrap="truncate-end">{line.second ?? ''}</Text>
          {ctl.hint !== '' && <Text> </Text>}
          {ctl.hint !== '' && <Button key="more" plain dimColor label={ctl.hint} onPress={ctl.onToggle} />}
        </Box>
      )}
      {below}
    </Box>
  )
}
