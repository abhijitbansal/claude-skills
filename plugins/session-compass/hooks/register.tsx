import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Artifact, SessionRecord } from '../types'
import { bandView, formatBand, fullLines, goalKey, hintLabel, tally } from './band'
import { capture } from './capture'
import { PANE_ID, paneView, type Tab } from './pane'
import { GIT_TIMEOUT_MS, INDEX, PREFIX, isPartialRecord, isRecord, recordKey } from './io'
import {
  LIMITS, addArtifact, applyStatus, basename, capArtifacts, mergeStored, newRecord, orderIndex, sortByActive, touch, withFirstPrompt,
  type StatusInput, type Where,
} from './record'

// Atoms sit in this file: the host's state scan reads only atoms declared here.
const record = atom({ plugin: 'session-compass', key: 'record' } as const, null)
const tab = atom({ plugin: 'session-compass', key: 'tab' } as const, 'this' as Tab)
// Band view state, per session and never stored: `expanded` shows the full text; `hidden` holds the
// goal the band was hidden at (see goalKey) and keeps it hidden until the goal differs.
const expanded = atom({ plugin: 'session-compass', key: 'expanded' } as const, false)
const hidden = atom({ plugin: 'session-compass', key: 'hidden' } as const, null as string | null)
const BAND_USAGE = 'more (open or fold the full text), hide, show'

export const STATUS_TOOL_ID = 'mcp__session-compass__compass_status'
export const STATUS_TOOL_DESCRIPTION =
  'Record what this session is building (goal), where it stands (step), and what comes next. ' +
  'Call it when the goal is first clear and whenever the phase changes ' +
  '(spec, plan, implement, review, PR, done), not every turn. ' +
  'A field left out keeps its value; an empty string clears it. ' +
  'For the main session only: a subagent call is refused.'
const STATUS_TOOL = {
  name: 'compass_status',
  description: STATUS_TOOL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'What this session is building (up to 80 chars)' },
      step: { type: 'string', description: 'Where it stands now (up to 60 chars)' },
      next: { type: 'string', description: 'What comes next (up to 60 chars)' },
    },
    additionalProperties: false,
  },
  isDeferred: false,
}
const REMINDER = {
  id: 'session-compass:reminder',
  text: 'Keep the session compass current with the compass_status tool when the goal or phase changes.',
  scope: 'session',
} as const
const CAPTURED = new Set(['Artifact', 'SendUserFile', 'Write', 'Bash'])
const GIT_MOVE = /\bgit\s+(?:-C\s+\S+\s+)?(checkout|switch|worktree|commit|push)\b|\bgh\s+pr\s+checkout\b/
// Tools that move the session into or out of a worktree.
const MOVE_TOOLS = new Set(['EnterWorktree', 'ExitWorktree'])

// `isPartial` accepts a record that lacks fields session.start can fill again (this session's own).
export async function loadRecord($: EngineInterface, id: string, isPartial = false): Promise<SessionRecord | undefined> {
  const raw = await $.store.get(recordKey(id))
  const isUsable = isPartial ? isPartialRecord(raw) : isRecord(raw)
  return isUsable ? (raw as SessionRecord) : undefined
}

// The index is last-write-wins across concurrent sessions, so it can lose an id
// whose record is still stored. Every read merges those back in, newest first.
export async function loadIndex($: EngineInterface): Promise<string[]> {
  const raw = await $.store.get(INDEX)
  const listed = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const known = new Set(listed)
  const missing = (await $.store.keys())
    .filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)).filter(id => !known.has(id))
  if (missing.length === 0) return listed
  const recs = (await Promise.all([...listed, ...missing].map(id => loadRecord($, id)))).filter(isRecord)
  const sorted = sortByActive(recs).map(r => r.id)
  return [...sorted, ...listed.filter(id => !sorted.includes(id))]
}

async function writeAll($: EngineInterface, rec: SessionRecord, maxSessions: number): Promise<void> {
  await $.store.set(recordKey(rec.id), rec)
  const { index, dropped } = orderIndex(await loadIndex($), rec.id, maxSessions)
  for (const id of dropped) await $.store.delete(recordKey(id))
  await $.store.set(INDEX, index)
}

async function trimOthers($: EngineInterface, keepId: string): Promise<void> {
  for (const id of await loadIndex($)) {
    if (id === keepId) continue
    const other = await loadRecord($, id)
    if (other !== undefined && other.artifacts.length > LIMITS.trimArtifacts) {
      await $.store.set(recordKey(id), capArtifacts(other, LIMITS.trimArtifacts))
    }
  }
}

// Frees space before a retry: shrink the index, drop what falls off it, cap the
// artifacts of every session that stays.
async function freeSpace($: EngineInterface, keepId: string): Promise<void> {
  const { index, dropped } = orderIndex(await loadIndex($), keepId, LIMITS.trimSessions)
  for (const id of dropped) await $.store.delete(recordKey(id))
  await $.store.set(INDEX, index)
  await trimOthers($, keepId)
}

// While the start-time read failed twice, the atom holds a fresh record. Before
// the first write, try the store once more and fold what it holds into the atom.
async function verifyStore($: EngineInterface, state: Chain, rec: SessionRecord): Promise<SessionRecord> {
  if (!state.isStoreUnverified) return rec
  let stored: SessionRecord | undefined
  try {
    stored = await loadRecord($, rec.id)
  } catch {
    return rec
  }
  state.isStoreUnverified = false
  if (stored === undefined) return rec
  const merged = await update($, record, cur => (cur === null ? cur : mergeStored(cur, stored)))
  return merged ?? rec
}

export async function saveRecord($: EngineInterface, state: Chain, first: SessionRecord): Promise<void> {
  const rec = await verifyStore($, state, first)
  try {
    await writeAll($, rec, LIMITS.sessions)
  } catch {
    try {
      await freeSpace($, rec.id)
      await writeAll($, capArtifacts(rec, LIMITS.trimArtifacts), LIMITS.trimSessions)
    } catch (err) {
      $.ui.log(`session-compass: store write failed, kept in session only: ${String(err).slice(0, 120)}`)
    }
  }
}

export async function listSessions($: EngineInterface, excludeId: string): Promise<SessionRecord[]> {
  const ids = (await loadIndex($)).filter(id => id !== excludeId)
  const recs = await Promise.all(ids.map(id => loadRecord($, id)))
  return sortByActive(recs.filter(isRecord)).slice(0, LIMITS.sessions)
}

async function git($: EngineInterface, args: readonly string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS })
    const out = ran.stdout.trim()
    return ran.exitCode === 0 && out !== '' ? out : undefined
  } catch {
    return undefined
  }
}

export async function locate($: EngineInterface, prev?: Where, startCwd?: string): Promise<Where> {
  const cwd = startCwd ?? (await $.session.cwd().catch(() => prev?.worktree ?? ''))
  const repoRoot = await $.session.repo().then(r => r?.root).catch(() => undefined)
  const worktree = (await git($, ['rev-parse', '--show-toplevel'])) ?? prev?.worktree ?? cwd
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? prev?.branch ?? ''
  const repo = repoRoot !== undefined ? basename(repoRoot) : prev?.repo ?? basename(worktree)
  return { repo, worktree, branch }
}

// Test Board's latest runs, when Test Board is installed (U14 decides whether
// this read needs a `dependencies` entry). Never throws.
export async function readTestBoard($: EngineInterface): Promise<unknown[] | undefined> {
  try {
    const held = await $.state.get({ plugin: 'test-board', key: 'latest' } as never)
    const value = (held as { value?: unknown }).value
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

// The model supplies the input; anything that is not a string counts as left out.
function onlyStrings(input: Record<string, unknown>): StatusInput {
  const pick = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return { goal: pick(input.goal), step: pick(input.step), next: pick(input.next) }
}

// Loads the stored record for `id` (a resume lands on one that may hold a goal
// and artifacts) or starts a fresh one, puts it in the atom and saves it.
// Callers queue it so saves never interleave.
async function openRecord($: EngineInterface, state: Chain, id: string, startCwd?: string): Promise<SessionRecord> {
  const now = await $.clock.now()
  // A new load starts verified; a read that fails twice flips the flag until the store answers.
  state.isStoreUnverified = false
  let stored: SessionRecord | undefined
  try {
    stored = await loadRecord($, id, true).catch(() => loadRecord($, id, true))
  } catch (err) {
    state.isStoreUnverified = true
    $.ui.log(`session-compass: store read failed, starting fresh: ${String(err).slice(0, 120)}`)
  }
  const where = await locate($, stored, startCwd)
  const started = stored ? { ...stored, ...where, lastActive: now } : newRecord(id, where, now)
  await update($, record, () => started)
  if (!state.isStoreUnverified) await saveRecord($, state, started)
  return started
}

// The record for the session id the host names now. After a /clear or a resume
// the process goes on under a new id with no session.start, so the first write
// under that id opens its record here.
async function ensureRecord($: EngineInterface, state: Chain): Promise<SessionRecord> {
  const id = await $.session.id()
  const cur = await read($, record)
  return cur !== null && cur.id === id ? cur : openRecord($, state, id)
}

// Folds new artifacts (and a fresh branch, after a git move) into the record
// with CAS updates, then saves what was written. Callers queue it so saves never interleave.
async function applyCapture($: EngineInterface, state: Chain, found: Artifact[], isGitMove: boolean): Promise<void> {
  await ensureRecord($, state)
  let written = await update($, record, cur => (cur === null ? cur : found.reduce(addArtifact, cur)))
  if (written === null) return
  if (isGitMove) {
    const where = await locate($, written)
    written = await update($, record, cur => (cur === null ? cur : { ...cur, ...where }))
  }
  if (written !== null) await saveRecord($, state, written)
}

export type Chain = { chain: Promise<void>; isStoreUnverified: boolean }

async function touchRecord($: EngineInterface, state: Chain, change: (r: SessionRecord, now: number) => SessionRecord) {
  await queue(state, 'touch', async () => {
    await ensureRecord($, state)
    const now = await $.clock.now()
    const written = await update($, record, cur => (cur === null ? cur : change(cur, now)))
    if (written !== null) await saveRecord($, state, written)
  }, $).catch(() => undefined)
}

// Record writes run one at a time so store saves never interleave. The chain
// link is catch-wrapped so one failure never poisons it; the caller gets the
// job's own settled promise and decides what a failure means.
function queue(state: Chain, kind: string, job: () => Promise<void>, $: EngineInterface): Promise<void> {
  const run = state.chain.then(job)
  state.chain = run.catch((err: unknown) => {
    try {
      $.ui.log(`session-compass: ${kind} failed: ${String(err).slice(0, 120)}`)
    } catch {
      // a throwing log must not leave the chain rejected
    }
  })
  return run
}

function logPane($: EngineInterface, what: string, err: unknown): void {
  try {
    $.ui.log(`session-compass: pane ${what} failed: ${String(err).slice(0, 120)}`)
  } catch {
    // a throwing log must not become an unhandled rejection
  }
}

export const register: Register = on => {
  // One promise chain per load: capture passes run one at a time.
  const state: Chain = { chain: Promise.resolve(), isStoreUnverified: false }

  on('session.start', async ($, e, next) => {
    await $.tool.register(STATUS_TOOL)
    await $.command.register({
      name: 'compass',
      description: 'Open the session compass pane, or open (more), hide or show the band',
      argumentHint: '[more|hide|show]',
    })
    // View state is per session: a new session handled by this load starts shown and folded.
    await update($, expanded, () => false)
    await update($, hidden, () => null)
    const id = await $.session.id()
    await queue(state, 'start', async () => { await openRecord($, state, id, e.cwd) }, $).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => {
    try {
      $.ui.log(`session-compass: start failed (the hook error is not passed to .catch)`)
    } catch {
      // a throwing log must not mask the original failure
    }
    return next(e)
  })

  // A /clear or resume ends this id while the process goes on under another, and
  // no session.start follows. Every write already saved the old record, so the
  // atom is emptied here (no git, no store: the exit bound is short) and the
  // next write opens the record for the new id (ensureRecord).
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await queue(state, 'end', async () => {
        await update($, record, cur => (cur !== null && cur.id === e.sessionId ? null : cur))
      }, $).catch(() => undefined)
    }
    return ended
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    // Only a prompt the person typed that entered as a new turn counts; a drop
    // or a peer/notification/plugin prompt changes nothing.
    const isPerson = e.origin === undefined || e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (ran.drop === undefined && e.turnId === undefined && isPerson) {
      await touchRecord($, state, (r, now) => touch(withFirstPrompt(r, e.text), now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn (agentId set) is not the main loop's.
    if (e.agentId === undefined) await touchRecord($, state, touch)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The compass band is up unless a survey takes its place or the person hid it at this goal.
    const rec = await read($, record)
    if (e.props.hasSurvey || rec === null) return next(e)
    if ((await read($, hidden)) === goalKey(rec)) return next(e)
    const columns = e.props.bodyColumns
    const line = formatBand(rec, tally(await readTestBoard($)), columns)
    const controls = {
      isOpen: await read($, expanded),
      full: fullLines(rec),
      hint: hintLabel(columns),
      onToggle: () => { update($, expanded, v => !v).catch(err => logPane($, 'band expand', err)) },
    }
    return bandView($.ui.resolve(e), line, await next(e), controls)
  })

  on('command.run', { command: 'compass' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'more') {
      if ((await read($, hidden)) === goalKey(await read($, record))) {
        return { text: 'Compass band is hidden. /compass show brings it back; then /compass more expands it.' }
      }
      const isOpen = await update($, expanded, v => !v)
      return { text: isOpen ? 'Compass band expanded. /compass more folds it.' : 'Compass band folded.' }
    }
    if (arg === 'hide') {
      const key = goalKey(await read($, record))
      await update($, hidden, () => key)
      await update($, expanded, () => false)
      return { text: 'Compass band hidden until the goal changes. /compass show brings it back.' }
    }
    if (arg === 'show') {
      await update($, hidden, () => null)
      return { text: 'Compass band shown.' }
    }
    if (arg !== '') return { text: `Unknown argument "${arg.slice(0, 40)}". /compass takes: ${BAND_USAGE}; no argument opens the pane.` }
    await $.ui.open({ id: PANE_ID, title: 'Compass' })
    return { text: 'Compass opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const shown = await read($, tab)
    const rec = await read($, record)
    // A corrupt or missing index never crashes the pane: loadIndex rebuilds from session keys.
    let isOthersUnreadable = false
    const others = shown === 'all'
      ? await listSessions($, rec?.id ?? '').catch((err: unknown) => {
          isOthersUnreadable = true
          $.ui.log(`session-compass: could not read other sessions: ${String(err).slice(0, 120)}`)
          return []
        })
      : []
    const tests = shown === 'this' ? tally(await readTestBoard($)) : undefined
    return paneView($.ui.resolve(e), {
      tab: shown, rec, others, isOthersUnreadable, tests, now: await $.clock.now(), columns: e.props.bodyColumns,
    }, {
      onTab: next => { update($, tab, () => next).catch(err => logPane($, 'tab change', err)) },
      onCopy: text => {
        $.ui.copy({ text, surface: e.surface }).then(
          done => { if (!done.isCopied) $.ui.toast(`Copy failed: ${done.reason}`) },
          err => logPane($, 'copy', err),
        )
      },
    })
  })

  on('tool.call', { tool: STATUS_TOOL_ID }, async ($, e) => {
    // A subagent's status would overwrite the main session's goal, step and next.
    if (e.agentId !== undefined) return { deny: 'session-compass: compass_status is for the main session only' }
    const input = onlyStrings(e as unknown as Record<string, unknown>)
    const outcome: { deny?: string } = {}
    const done = await queue(state, 'status', async () => {
      await ensureRecord($, state)
      const now = await $.clock.now()
      let error: string | undefined
      let before: string | undefined
      const written = await update($, record, cur => {
        error = undefined
        before = cur?.goal
        if (cur === null) return cur
        const out = applyStatus(cur, input, now)
        if ('error' in out) {
          error = out.error
          return cur
        }
        return out
      })
      if (written === null) outcome.deny = 'session-compass: no session record yet'
      else if (error !== undefined) outcome.deny = error
      else {
        await saveRecord($, state, written)
        // A new goal brings a hidden band back for good, even if the old text returns later.
        if (written.goal !== before && (await read($, hidden)) !== null) await update($, hidden, () => null)
      }
    }, $).then(() => true, () => false)
    if (!done) return { deny: 'session-compass: status not saved, try again' }
    // A registered tool's result is read like an MCP tool's: a string or content
    // blocks. An object here fails the host's shape check and the status is lost.
    return outcome.deny === undefined ? { result: 'ok' } : { deny: outcome.deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'session compass is busy; try again' }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    const isMoveTool = MOVE_TOOLS.has(tool)
    if ((!CAPTURED.has(tool) && !isMoveTool) || ran.deny !== undefined) return ran
    const input = e as unknown as Record<string, unknown>
    let found: Artifact[] = []
    try {
      found = capture({ tool, input, result: ran.result, isError: ran.isError === true, now: await $.clock.now() })
    } catch (err) {
      $.ui.log(`session-compass: capture failed: ${String(err).slice(0, 120)}`)
    }
    // A subagent's git move happens in its own worktree: it must not relocate this session.
    // locate() runs git with no cwd, which the host resolves to the session's current directory.
    const command = typeof input.command === 'string' ? input.command : ''
    const isMove = (tool === 'Bash' && GIT_MOVE.test(command)) || (isMoveTool && ran.isError !== true)
    const isGitMove = input.agentId === undefined && isMove
    // Decided before waiting: a call that captures nothing never queues behind the chain.
    if (found.length === 0 && !isGitMove) return ran
    await queue(state, 'capture', () => applyCapture($, state, found, isGitMove), $).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, REMINDER] }
  })
}
