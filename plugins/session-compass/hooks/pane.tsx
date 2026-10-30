import type { EngineInterface } from 'claude-code'
import type { Artifact, SessionRecord } from '../types'
import type { Tally } from './band'
import { ago, basename, truncate } from './record'

// Pure view builder: no `$` here (the host does not follow it out of register.tsx).
// The tab atom, command.run, ui.render hook and every `$` call live there.
export const PANE_ID = 'compass'
export const ALL_ROWS = 50
export type Tab = 'this' | 'all'
type Els = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>
export type PaneData = {
  tab: Tab
  rec: SessionRecord | null
  others: readonly SessionRecord[]
  isOthersUnreadable: boolean
  tests: Tally | undefined
  now: number
  columns: number
}
export type PaneActions = { onTab: (tab: Tab) => void; onCopy: (text: string) => void }

const KINDS = ['artifact', 'file', 'doc', 'commit', 'push', 'pr'] as const
const KIND_LABEL: Record<Artifact['kind'], string> = {
  artifact: 'Published artifacts', file: 'Files sent', doc: 'Documents',
  commit: 'Commits', push: 'Pushes', pr: 'Pull requests',
}

function label(a: Artifact): string {
  switch (a.kind) {
    case 'artifact': return `${a.title}  ${a.url}`
    case 'file': case 'doc': return a.path
    case 'commit': return `${a.sha.slice(0, 7)} ${a.subject} (${a.branch})`
    case 'push': return `${a.branch} to ${a.remote}`
    case 'pr': return `#${a.number} ${a.url}`
  }
}

function copyText(a: Artifact): string {
  switch (a.kind) {
    case 'artifact': case 'pr': return a.url
    case 'file': case 'doc': return a.path
    case 'commit': return a.sha
    case 'push': return a.branch
  }
}

export function paneView({ Box, Text, Button }: Els, d: PaneData, act: PaneActions) {
  const tabs = (
    <Box flexDirection="row">
      <Button key="tab-this" label="This session" variant={d.tab === 'this' ? 'primary' : 'secondary'}
        onPress={() => act.onTab('this')} />
      <Button key="tab-all" label="All sessions" variant={d.tab === 'all' ? 'primary' : 'secondary'}
        onPress={() => act.onTab('all')} />
    </Box>
  )

  if (d.tab === 'all') {
    const rows = d.others.slice(0, ALL_ROWS)
    const age = (o: SessionRecord) => ` · ${ago(d.now, o.lastActive)}`
    return (
      <Box flexDirection="column">
        {tabs}
        {d.isOthersUnreadable && <Text dimColor>Could not read other sessions.</Text>}
        {rows.length === 0 && !d.isOthersUnreadable && <Text dimColor>No other sessions recorded.</Text>}
        {rows.map(o => {
          const head = `${o.repo} · ${basename(o.worktree)}/${o.branch} · ${o.goal ?? o.firstPrompt ?? '(no goal)'} · ${o.step ?? '-'}`
          return (
            <Button key={`s-${o.id}`} plain onPress={() => act.onCopy(`claude --resume ${o.id}`)}>
              {truncate(head, Math.max(20, d.columns - age(o).length - 4))}
              <Text dimColor>{age(o)}</Text>
            </Button>
          )
        })}
      </Box>
    )
  }

  const { rec } = d
  if (rec === null) {
    return <Box flexDirection="column">{tabs}<Text dimColor>No record for this session yet.</Text></Box>
  }
  const status = rec.statusAt === undefined ? 'status never set' : `status set ${ago(d.now, rec.statusAt)}`
  const warnings = d.tests?.warnings ?? 0
  const kinds = KINDS.filter(k => rec.artifacts.some(a => a.kind === k))
  return (
    <Box flexDirection="column">
      {tabs}
      <Text>{truncate(`${rec.repo} · ${rec.worktree} (${rec.branch})`, d.columns)}</Text>
      <Text>{`Goal: ${rec.goal ?? '(no goal set)'}`}</Text>
      <Text>{`Now: ${rec.step ?? '-'} · Next: ${rec.next ?? '-'}`}</Text>
      <Text dimColor>{status}</Text>
      {d.tests !== undefined && <Text>{`Tests: ${d.tests.passed} ✓ ${d.tests.failed} ✗`}</Text>}
      {warnings > 0 && <Text>{`Tests: ${warnings} warning${warnings === 1 ? '' : 's'}; see Test Board for details`}</Text>}
      {kinds.map(kind => (
        <Box key={`g-${kind}`} flexDirection="column">
          <Text bold>{KIND_LABEL[kind]}</Text>
          {rec.artifacts.filter(a => a.kind === kind).map((a, i) => (
            <Button key={`a-${kind}-${i}`} plain onPress={() => act.onCopy(copyText(a))}>
              {truncate(label(a), d.columns)}
            </Button>
          ))}
        </Box>
      ))}
    </Box>
  )
}
