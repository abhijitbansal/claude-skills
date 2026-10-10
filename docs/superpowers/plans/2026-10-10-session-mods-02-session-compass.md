# Session mods: phase 2, Session Compass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `plugins/session-compass/`: a return band and `/compass` pane that show what each session is building, where it stands and everything it produced, plus the repo obligations and the single PR for both session mods.

**Architecture:** Pure modules (`record.ts`, `capture.ts`, `git.ts`) hold every rule and are unit-tested. `io.ts` is the only file that touches `$.store`, `$.process` and Test Board's state. `register.tsx` wires events; `band.tsx` and `pane.tsx` each register their own render hooks. Session state lives in three `$.state` atoms (`state.ts`); the record is mirrored to `$.store` so other sessions can list it.

**Tech Stack:** Claude Code 2.1.296 function hooks (`claude-code`, `claude-code/testing`), TypeScript/TSX, `claude plugin validate|test`, `tsc` 5.6, bats, Chrome MCP for the site check.

**Spec:** [`docs/superpowers/specs/2026-10-10-session-compass-mod-design.md`](../specs/2026-10-10-session-compass-mod-design.md), with the [decision log](../specs/2026-10-10-session-mods-decisions.md) and [Test Board spec](../specs/2026-10-10-test-board-mod-design.md).

## Global Constraints

- Branch `feat/session-mods`. Push with `git push origin HEAD:feat/session-mods`. The executor may commit and push after each task.
- Plan 01 (Test Board) is complete before Task 1 starts. Read the decision log §5 "Plan impact" list first and edit any step it names.
- Plugin `session-compass`, version `0.1.0`, no `dependencies` entry (U14 fallback adds `"dependencies": ["test-board"]`).
- Limits, verbatim from the spec: goal 80 chars, step/next 60, first prompt 80, 100 artifacts per session, 50 sessions, idle threshold 15 minutes, write-failure retry trims to 40 sessions and 50 artifacts.
- Capture never alters or denies a tool call; every capture path catches its own errors and logs with `$.ui.log`.
- `claude plugin test` runs with no fs, network or process: fixtures are TS modules under `tests/fixtures/`; every `$` noun the plugin calls is stubbed in `tests/fixtures/world.ts`.
- Types: `/private/tmp/claude-501/bundled-skills/2.1.296/e60f5bab9db54497098195964d5421f8/plugin-authoring/types/claude-code.d.ts` (after a restart, load the plugin-authoring skill again and use the path it names).
- Spec deviations taken here, on purpose: `repo` comes from `$.session.repo().root` (the main working tree's root per the types, same answer as `--git-common-dir`); git facts come from the Bash result's structured `gitOperation`, with stdout only for the commit subject and push remote; two helper files `io.ts` and `state.ts` are added; the whole band line is dimmed when no goal is set.

## Review Focus

1. **A session that never sets a goal.** The band must still be useful: first prompt shown, marked `(no goal set)`. Test: `formatBand` with no goal (Task 5).
2. **A `Write` of source code under `docs/`** (e.g. `docs/x.ts`) must not count; only `.html .md .pdf .png .svg`. Test: capture negative (Task 2).
3. **A failed `git commit`** (pre-commit hook rejects) must add nothing. Test: `isError: true` Bash result (Task 2).
4. **Hot reload re-fires `session.start`** and must not duplicate or wipe the stored record. Test: second `session.start` keeps artifacts (Task 3).
5. **A corrupt or missing `index`** must be rebuilt from `session:*` keys, not crash the pane. Test: `listSessions` with `index` set to a string (Task 6).

---

### Task 1: Scaffold the plugin and the pure record module

**Files:**
- Create: `plugins/session-compass/.claude-plugin/plugin.json`
- Create: `plugins/session-compass/hooks/hooks.json`
- Create: `plugins/session-compass/tsconfig.json`
- Create: `plugins/session-compass/types/index.d.ts`
- Create: `plugins/session-compass/hooks/record.ts`
- Create: `plugins/session-compass/hooks/register.tsx` (stub, filled in Task 3)
- Create: `.scratch/tsc/session-compass.json` (gitignored type-check config)
- Test: `plugins/session-compass/tests/record.test.ts`

**Interfaces:**
- Produces: types `Artifact`, `SessionRecord`; from `record.ts`: `LIMITS`, `StatusInput`, `Where`, `truncate(text, max)`, `basename(path)`, `newRecord(id, where, now)`, `applyStatus(rec, input, now): SessionRecord | { error: string }`, `artifactKey(a)`, `addArtifact(rec, a)`, `capArtifacts(rec, max)`, `touch(rec, now)`, `withFirstPrompt(rec, text)`, `orderIndex(index, id, max): { index; dropped }`, `sortByActive(recs)`, `ago(now, then)`.

- [ ] **Step 1: Write the manifest, hooks list, tsconfig and contract**

`plugins/session-compass/.claude-plugin/plugin.json`:
```json
{
  "name": "session-compass",
  "version": "0.1.0",
  "description": "Shows what each session is building, where it stands and what it produced: a return band, a /compass pane and a compass_status tool",
  "types": "./types/index.d.ts"
}
```

`plugins/session-compass/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`plugins/session-compass/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

`plugins/session-compass/types/index.d.ts`:
```ts
export type Artifact =
  | { kind: 'artifact'; title: string; url: string; at: number }
  | { kind: 'file'; path: string; at: number }
  | { kind: 'doc'; path: string; at: number }
  | { kind: 'commit'; sha: string; subject: string; branch: string; at: number }
  | { kind: 'push'; branch: string; remote: string; at: number }
  | { kind: 'pr'; url: string; number: number; at: number }

export type SessionRecord = {
  id: string
  repo: string
  worktree: string
  branch: string
  goal?: string
  step?: string
  next?: string
  firstPrompt?: string
  statusAt?: number
  lastActive: number
  artifacts: Artifact[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-compass': {
      record: SessionRecord | null
      band: 'hidden' | 'return'
      tab: 'this' | 'all'
    }
  }
}
```

`plugins/session-compass/hooks/register.tsx` (stub so `validate` loads):
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

`.scratch/tsc/session-compass.json` (type-checks without a loaded session; `.claude-plugin/types/` is only laid by an interactive `--plugin-dir` load):
```json
{
  "extends": "../../plugins/session-compass/tsconfig.json",
  "include": [
    "/private/tmp/claude-501/bundled-skills/2.1.296/e60f5bab9db54497098195964d5421f8/plugin-authoring/types/claude-code.d.ts",
    "../../plugins/session-compass/hooks",
    "../../plugins/session-compass/types",
    "../../plugins/session-compass/tests"
  ]
}
```

- [ ] **Step 2: Write the failing record tests**

`plugins/session-compass/tests/record.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'
import type { Artifact } from '../types'
import {
  LIMITS, addArtifact, applyStatus, newRecord, orderIndex, sortByActive, withFirstPrompt, ago,
} from '../hooks/record'

const WHERE = { repo: 'cubby', worktree: '/w/feature-scan', branch: 'feature/scan' }
const base = () => newRecord('s1', WHERE, 1000)

describe('applyStatus', () => {
  test('fields left out keep their values', () => {
    const first = applyStatus(base(), { goal: 'barcode fallback', step: 'spec' }, 2000)
    if ('error' in first) throw new Error(first.error)
    const second = applyStatus(first, { step: 'implement' }, 3000)
    if ('error' in second) throw new Error(second.error)
    expect(second.goal).toBe('barcode fallback')
    expect(second.step).toBe('implement')
    expect(second.statusAt).toBe(3000)
  })
  test('caps goal at 80 and step at 60 chars', () => {
    const out = applyStatus(base(), { goal: 'g'.repeat(200), step: 's'.repeat(200) }, 2000)
    if ('error' in out) throw new Error(out.error)
    expect(out.goal?.length).toBe(LIMITS.goal)
    expect(out.step?.length).toBe(LIMITS.step)
  })
  test('every field empty returns an error naming the fields', () => {
    const out = applyStatus(base(), { goal: '  ' }, 2000)
    expect('error' in out && out.error).toContain('goal, step, next')
  })
})

describe('addArtifact', () => {
  const doc = (path: string, at: number): Artifact => ({ kind: 'doc', path, at })
  test('a rewrite of the same path updates the entry in place of a duplicate', () => {
    const rec = addArtifact(addArtifact(base(), doc('docs/a.md', 1)), doc('docs/a.md', 2))
    expect(rec.artifacts).toEqual([doc('docs/a.md', 2)])
  })
  test('a republish to the same URL updates the title', () => {
    const one: Artifact = { kind: 'artifact', title: 'Old', url: 'https://claude.ai/artifact/x', at: 1 }
    const two: Artifact = { ...one, title: 'New', at: 2 }
    expect(addArtifact(addArtifact(base(), one), two).artifacts).toEqual([two])
  })
  test('caps at 100, newest first', () => {
    let rec = base()
    for (let i = 0; i < 105; i += 1) rec = addArtifact(rec, doc(`docs/${i}.md`, i))
    expect(rec.artifacts).toHaveLength(LIMITS.artifacts)
    expect(rec.artifacts[0]).toEqual(doc('docs/104.md', 104))
  })
})

describe('index and helpers', () => {
  test('orderIndex moves the id to the front and reports the dropped ids', () => {
    expect(orderIndex(['a', 'b', 'c'], 'c', 2)).toEqual({ index: ['c', 'a'], dropped: ['b'] })
  })
  test('withFirstPrompt stores the first prompt once', () => {
    const rec = withFirstPrompt(withFirstPrompt(base(), 'first prompt'), 'second')
    expect(rec.firstPrompt).toBe('first prompt')
  })
  test('sortByActive puts the most recent first', () => {
    const a = { ...base(), id: 'a', lastActive: 1 }
    const b = { ...base(), id: 'b', lastActive: 2 }
    expect(sortByActive([a, b]).map(r => r.id)).toEqual(['b', 'a'])
  })
  test('ago reads minutes, hours, days', () => {
    expect(ago(0, 0)).toBe('just now')
    expect(ago(5 * 60_000, 0)).toBe('5m ago')
    expect(ago(2 * 3_600_000, 0)).toBe('2h ago')
    expect(ago(72 * 3_600_000, 0)).toBe('3d ago')
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `claude plugin test plugins/session-compass`
Expected: FAIL in `record.test.ts`, the module `../hooks/record` not found.

- [ ] **Step 4: Write `record.ts`**

`plugins/session-compass/hooks/record.ts`:
```ts
import type { Artifact, SessionRecord } from '../types'

export const LIMITS = {
  goal: 80,
  step: 60,
  next: 60,
  firstPrompt: 80,
  artifacts: 100,
  sessions: 50,
  trimArtifacts: 50,
  trimSessions: 40,
  idleMs: 15 * 60_000,
} as const

export type StatusInput = { goal?: string; step?: string; next?: string }
export type Where = { repo: string; worktree: string; branch: string }

const STATUS_FIELDS = ['goal', 'step', 'next'] as const

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function newRecord(id: string, where: Where, now: number): SessionRecord {
  return { id, ...where, lastActive: now, artifacts: [] }
}

export function applyStatus(
  rec: SessionRecord,
  input: StatusInput,
  now: number,
): SessionRecord | { error: string } {
  const given = STATUS_FIELDS.filter(k => (input[k] ?? '').trim() !== '')
  if (given.length === 0) {
    return { error: 'compass_status needs at least one non-empty field of: goal, step, next' }
  }
  const patch: StatusInput = {}
  for (const k of given) patch[k] = truncate(input[k] ?? '', LIMITS[k])
  return { ...rec, ...patch, statusAt: now, lastActive: now }
}

export function artifactKey(a: Artifact): string {
  switch (a.kind) {
    case 'artifact': return `artifact:${a.url}`
    case 'file': return `file:${a.path}`
    case 'doc': return `doc:${a.path}`
    case 'commit': return `commit:${a.sha}`
    case 'push': return `push:${a.remote}:${a.branch}`
    case 'pr': return `pr:${a.number}`
  }
}

export function addArtifact(rec: SessionRecord, a: Artifact): SessionRecord {
  const key = artifactKey(a)
  const rest = rec.artifacts.filter(x => artifactKey(x) !== key)
  return { ...rec, artifacts: [a, ...rest].slice(0, LIMITS.artifacts) }
}

export function capArtifacts(rec: SessionRecord, max: number): SessionRecord {
  return rec.artifacts.length <= max ? rec : { ...rec, artifacts: rec.artifacts.slice(0, max) }
}

export function touch(rec: SessionRecord, now: number): SessionRecord {
  return { ...rec, lastActive: now }
}

export function withFirstPrompt(rec: SessionRecord, text: string): SessionRecord {
  if (rec.firstPrompt !== undefined || text.trim() === '') return rec
  return { ...rec, firstPrompt: truncate(text, LIMITS.firstPrompt) }
}

export function orderIndex(
  index: readonly string[],
  id: string,
  max: number,
): { index: string[]; dropped: string[] } {
  const ordered = [id, ...index.filter(x => x !== id)]
  return { index: ordered.slice(0, max), dropped: ordered.slice(max) }
}

export function sortByActive(recs: readonly SessionRecord[]): SessionRecord[] {
  return [...recs].sort((a, b) => b.lastActive - a.lastActive)
}

export function ago(now: number, then: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
```

- [ ] **Step 5: Run tests, validate, type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS (all `record.test.ts` tests).
Run: `claude plugin validate plugins/session-compass` — Expected: no refusal.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors.

- [ ] **Step 6: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): scaffold plugin + pure session record module"
git push origin HEAD:feat/session-mods
```

---

### Task 2: Pure capture and git mapping

**Files:**
- Create: `plugins/session-compass/hooks/git.ts`
- Create: `plugins/session-compass/hooks/capture.ts`
- Create: `plugins/session-compass/tests/fixtures/results.ts`
- Test: `plugins/session-compass/tests/git.test.ts`, `plugins/session-compass/tests/capture.test.ts`

**Interfaces:**
- Consumes: `truncate`, `basename` from Task 1.
- Produces: `GitOperation` type, `gitArtifacts(op, output, now): Artifact[]`; `CaptureInput` type, `isDeliverable(path)`, `capture(c: CaptureInput): Artifact[]`; fixtures `BASH_COMMIT`, `BASH_PUSH_NEW_BRANCH`, `BASH_PR`, `ARTIFACT_PUBLISH`, `SEND_USER_FILE` (each `{ input, result, isError }`).

- [ ] **Step 1: Write the fixtures**

`plugins/session-compass/tests/fixtures/results.ts`:
```ts
export type Fixture = { input: Record<string, unknown>; result: unknown; isError: boolean }

export const BASH_COMMIT: Fixture = {
  input: { command: 'git commit -m "feat: barcode fallback"' },
  result: {
    stdout: '[feature/scan 1a2b3c4] feat: barcode fallback\n 2 files changed, 40 insertions(+)\n',
    stderr: '',
    interrupted: false,
    gitOperation: { commit: { sha: '1a2b3c4', kind: 'committed', branch: 'feature/scan' } },
  },
  isError: false,
}

export const BASH_COMMIT_DETACHED: Fixture = {
  input: { command: 'git commit -m "wip"' },
  result: {
    stdout: '[detached HEAD 9f8e7d6] wip\n 1 file changed\n',
    stderr: '',
    interrupted: false,
    gitOperation: { commit: { sha: '9f8e7d6', kind: 'committed' } },
  },
  isError: false,
}

export const BASH_COMMIT_FAILED: Fixture = {
  input: { command: 'git commit -m "x"' },
  result: 'Exit code 1\npre-commit hook failed',
  isError: true,
}

export const BASH_PUSH_NEW_BRANCH: Fixture = {
  input: { command: 'git push -u origin feature/scan' },
  result: {
    stdout: '',
    stderr: 'To github.com:me/cubby.git\n * [new branch]      feature/scan -> feature/scan\n',
    interrupted: false,
    gitOperation: { push: { branch: 'feature/scan' } },
  },
  isError: false,
}

export const BASH_PR: Fixture = {
  input: { command: 'gh pr create --fill' },
  result: {
    stdout: 'https://github.com/me/cubby/pull/42\n',
    stderr: '',
    interrupted: false,
    gitOperation: { pr: { number: 42, action: 'created' } },
  },
  isError: false,
}

export const BASH_GH_VIEW: Fixture = {
  input: { command: 'gh pr view 42' },
  result: {
    stdout: 'title: barcode fallback\n',
    stderr: '',
    interrupted: false,
    gitOperation: { pr: { number: 42, action: 'commented' } },
  },
  isError: false,
}

export const ARTIFACT_PUBLISH: Fixture = {
  input: { file_path: '.scratch/compass-report.html' },
  result: { url: 'https://claude.ai/artifact/abc123', title: 'Compass Report', version: '1' },
  isError: false,
}

export const SEND_USER_FILE: Fixture = {
  input: { file_path: '/Users/me/projects/cubby/.scratch/checklist.html' },
  result: { attachments: [{ path: '/Users/me/projects/cubby/.scratch/checklist.html', size: 10, isImage: false }] },
  isError: false,
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/session-compass/tests/git.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { gitArtifacts, type GitOperation } from '../hooks/git'
import { BASH_COMMIT, BASH_COMMIT_DETACHED, BASH_GH_VIEW, BASH_PR, BASH_PUSH_NEW_BRANCH, type Fixture } from './fixtures/results'

const run = (f: Fixture) => {
  const r = f.result as { stdout: string; stderr: string; gitOperation?: GitOperation }
  return gitArtifacts(r.gitOperation, `${r.stdout}\n${r.stderr}`, 5)
}

test('commit takes sha and branch from gitOperation, subject from stdout', () => {
  expect(run(BASH_COMMIT)).toEqual([
    { kind: 'commit', sha: '1a2b3c4', subject: 'feat: barcode fallback', branch: 'feature/scan', at: 5 },
  ])
})
test('a detached HEAD commit reads its branch from the commit line', () => {
  expect(run(BASH_COMMIT_DETACHED)[0]).toMatchObject({ kind: 'commit', branch: 'detached HEAD', subject: 'wip' })
})
test('a new-branch push reads the remote from the To line', () => {
  expect(run(BASH_PUSH_NEW_BRANCH)).toEqual([
    { kind: 'push', branch: 'feature/scan', remote: 'github.com:me/cubby.git', at: 5 },
  ])
})
test('a created PR takes its URL from stdout when gitOperation has none', () => {
  expect(run(BASH_PR)).toEqual([{ kind: 'pr', number: 42, url: 'https://github.com/me/cubby/pull/42', at: 5 }])
})
test('a non-create gh call records nothing', () => {
  expect(run(BASH_GH_VIEW)).toEqual([])
})
test('no gitOperation records nothing', () => {
  expect(gitArtifacts(undefined, '[main abc1234] x', 5)).toEqual([])
})
```

`plugins/session-compass/tests/capture.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { capture, isDeliverable } from '../hooks/capture'
import { ARTIFACT_PUBLISH, BASH_COMMIT, BASH_COMMIT_FAILED, SEND_USER_FILE, type Fixture } from './fixtures/results'

const run = (tool: string, f: Fixture) => capture({ tool, ...f, now: 7 })

test('an Artifact publish records title and URL', () => {
  expect(run('Artifact', ARTIFACT_PUBLISH)).toEqual([
    { kind: 'artifact', title: 'Compass Report', url: 'https://claude.ai/artifact/abc123', at: 7 },
  ])
})
test('an Artifact result with no title falls back to the input title, then the basename', () => {
  const noTitle = { ...ARTIFACT_PUBLISH, result: { url: 'https://claude.ai/artifact/abc123' } }
  expect(run('Artifact', noTitle)[0]).toMatchObject({ title: 'compass-report.html' })
  expect(run('Artifact', { ...noTitle, input: { title: 'Given' } })[0]).toMatchObject({ title: 'Given' })
})
test('SendUserFile records each attachment path', () => {
  expect(run('SendUserFile', SEND_USER_FILE)).toEqual([
    { kind: 'file', path: '/Users/me/projects/cubby/.scratch/checklist.html', at: 7 },
  ])
})
test('a Write of a deliverable under docs/ is a doc', () => {
  expect(run('Write', { input: { file_path: '/r/docs/plan.md' }, result: {}, isError: false })).toEqual([
    { kind: 'doc', path: '/r/docs/plan.md', at: 7 },
  ])
})
test('source code never counts, even under docs/', () => {
  expect(isDeliverable('/r/docs/x.ts')).toBe(false)
  expect(isDeliverable('/r/Sources/App.swift')).toBe(false)
  expect(isDeliverable('/r/README.md')).toBe(false)
})
test('the harness scratchpad counts', () => {
  expect(isDeliverable('/private/tmp/claude-501/-proj/abc/scratchpad/report.html')).toBe(true)
})
test('a Bash commit goes through git mapping; a failed one records nothing', () => {
  expect(run('Bash', BASH_COMMIT)).toHaveLength(1)
  expect(run('Bash', BASH_COMMIT_FAILED)).toEqual([])
})
test('an unrelated tool records nothing', () => {
  expect(run('Read', { input: {}, result: {}, isError: false })).toEqual([])
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/session-compass` — Expected: FAIL, `../hooks/git` and `../hooks/capture` not found.

- [ ] **Step 4: Write `git.ts`**

`plugins/session-compass/hooks/git.ts`:
```ts
import type { Artifact } from '../types'
import { truncate } from './record'

export type GitOperation = {
  commit?: { sha: string; kind: string; branch?: string }
  push?: { branch: string }
  pr?: { number: number; url?: string; action: string }
}

const COMMIT_LINE = /^\[(.+?)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)$/m
const PUSH_REMOTE = /^To (\S+)$/m
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/
const SUBJECT_MAX = 120

export function gitArtifacts(op: GitOperation | undefined, output: string, now: number): Artifact[] {
  if (op === undefined) return []
  const found: Artifact[] = []
  if (op.commit !== undefined) {
    const line = COMMIT_LINE.exec(output)
    found.push({
      kind: 'commit',
      sha: op.commit.sha,
      subject: truncate(line?.[3] ?? '', SUBJECT_MAX),
      branch: op.commit.branch ?? line?.[1] ?? 'HEAD',
      at: now,
    })
  }
  if (op.push !== undefined) {
    const remote = PUSH_REMOTE.exec(output)?.[1] ?? 'origin'
    found.push({ kind: 'push', branch: op.push.branch, remote, at: now })
  }
  if (op.pr !== undefined && op.pr.action === 'created') {
    const url = op.pr.url ?? PR_URL.exec(output)?.[0] ?? ''
    found.push({ kind: 'pr', number: op.pr.number, url, at: now })
  }
  return found
}
```

- [ ] **Step 5: Write `capture.ts`**

`plugins/session-compass/hooks/capture.ts`:
```ts
import type { Artifact } from '../types'
import { gitArtifacts, type GitOperation } from './git'
import { basename, truncate } from './record'

export type CaptureInput = {
  tool: string
  input: Readonly<Record<string, unknown>>
  result: unknown
  isError: boolean
  now: number
}

const DOC_EXT = /\.(html|md|pdf|png|svg)$/i
const DOC_DIR = /(^|\/)(\.scratch|docs|reports|test-checklists)\//
const SCRATCHPAD = /\/claude-\d+\/.+\/scratchpad\//
const CLAUDE_URL = /^https:\/\/claude\.ai\//
const TITLE_MAX = 120

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const fields = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

export function isDeliverable(path: string): boolean {
  return DOC_EXT.test(path) && (DOC_DIR.test(path) || SCRATCHPAD.test(path))
}

export function capture(c: CaptureInput): Artifact[] {
  if (c.isError) return []
  const result = fields(c.result)
  switch (c.tool) {
    case 'Artifact': {
      const url = text(result.url)
      if (url === undefined || !CLAUDE_URL.test(url)) return []
      const filePath = text(c.input.file_path)
      const title = text(result.title) ?? text(c.input.title) ?? (filePath ? basename(filePath) : url)
      return [{ kind: 'artifact', title: truncate(title, TITLE_MAX), url, at: c.now }]
    }
    case 'SendUserFile': {
      const list = Array.isArray(result.attachments) ? result.attachments : []
      return list
        .map(a => text(fields(a).path))
        .filter((p): p is string => p !== undefined)
        .map((path): Artifact => ({ kind: 'file', path, at: c.now }))
    }
    case 'Write': {
      const path = text(c.input.file_path)
      return path !== undefined && isDeliverable(path) ? [{ kind: 'doc', path, at: c.now }] : []
    }
    case 'Bash': {
      const output = `${text(result.stdout) ?? ''}\n${text(result.stderr) ?? ''}`
      return gitArtifacts(result.gitOperation as GitOperation | undefined, output, c.now)
    }
    default:
      return []
  }
}
```

- [ ] **Step 6: Run tests and type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors.

- [ ] **Step 7: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): pure artifact capture + gitOperation mapping"
git push origin HEAD:feat/session-mods
```

---

### Task 3: Session start, store I/O and the `compass_status` tool

**Files:**
- Create: `plugins/session-compass/hooks/state.ts`
- Create: `plugins/session-compass/hooks/io.ts`
- Modify: `plugins/session-compass/hooks/register.tsx` (replace the stub)
- Create: `plugins/session-compass/tests/fixtures/world.ts`
- Test: `plugins/session-compass/tests/status.test.ts`

**Interfaces:**
- Consumes: `record.ts` from Task 1.
- Produces: atoms `record`, `band`, `tab` (`state.ts`); from `io.ts`: `loadRecord($, id)`, `saveRecord($, rec)`, `loadIndex($)`, `listSessions($, excludeId)`, `locate($, prev?)`, `readTestBoard($)`; from `register.tsx`: `commit($, rec)` (module-local), constants `STATUS_TOOL_ID = 'mcp__session-compass__compass_status'`; test helpers `startWorld(on, over?)`, `START`, `BAND_PROPS`, `PANE_PROPS`, `T0`.

- [ ] **Step 1: Write the test world**

`plugins/session-compass/tests/fixtures/world.ts`:
```ts
// Stubs every `$` noun the plugin calls; nothing else answers beneath the
// plugin in `claude plugin test`. If tsc rejects an answer's shape, align it
// to that event's result in claude-code.d.ts; never loosen the plugin.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const T0 = 1_760_000_000_000
export const WT = '/Users/me/projects/cubby-wt/feature-scan'

export type World = {
  id: string
  turns: number
  repoRoot: string | null
  git: Record<string, string>
  copied: string[]
  opened: string[]
  registered: string[]
}

export const START = { cwd: WT, surface: 'terminal', isInteractive: true } as const
export const BAND_PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 }, view: {},
}
export const PANE_PROPS = {
  title: 'Compass', isFocused: true, bodyColumns: 120, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
}

export function startWorld(on: On, over: Partial<World> = {}, store: Record<string, unknown> = {}) {
  const world: World = {
    id: 'sess-1',
    turns: 0,
    repoRoot: '/Users/me/projects/cubby',
    git: { 'rev-parse --show-toplevel': `${WT}\n`, 'rev-parse --abbrev-ref HEAD': 'feature/scan\n' },
    copied: [],
    opened: [],
    registered: [],
    ...over,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.id }))
  on('session.turns', () => ({ value: world.turns }))
  on('session.cwd', () => ({ value: WT }))
  on('session.repo', () => ({
    value: world.repoRoot === null ? null : { root: world.repoRoot, remote: null, internal: false, name: null },
  }))
  on('process.run', (_$, e) => {
    const out = world.git[e.argv.slice(1).join(' ')]
    return out === undefined
      ? { deny: 'no such command in this test' }
      : { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', (_$, e) => {
    world.registered.push(e.name)
    return { value: { tool: `mcp__session-compass__${e.name}` } }
  })
  on('command.register', (_$, e) => {
    world.registered.push(`/${e.name}`)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', (_$, e) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }] }))
  mock.store(on, store)
  const clock = mock.clock(on, { now: T0 })
  return { world, clock }
}
```

- [ ] **Step 2: Write the failing status tests**

`plugins/session-compass/tests/status.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { START, T0, WT, startWorld } from './fixtures/world'

const RECORD = { plugin: 'session-compass', key: 'record' } as const
const STATUS = 'mcp__session-compass__compass_status'

test('session.start registers the tool and /compass and records where the session is', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  expect(world.registered).toEqual(['compass_status', '/compass'])
  const { value } = await $.state.get(RECORD)
  expect(value).toMatchObject({ id: 'sess-1', repo: 'cubby', worktree: WT, branch: 'feature/scan', lastActive: T0 })
  expect(await $.store.get('index')).toEqual(['sess-1'])
})

test('compass_status merges fields and stores the record', async ($, on) => {
  startWorld(on)
  await $.session.start(START)
  await $.tool.call({ tool: STATUS, goal: 'barcode fallback', step: 'spec' } as never)
  await $.tool.call({ tool: STATUS, step: 'implement' } as never)
  const { value } = await $.state.get(RECORD)
  expect(value).toMatchObject({ goal: 'barcode fallback', step: 'implement', statusAt: T0 })
  expect(await $.store.get('session:sess-1')).toMatchObject({ goal: 'barcode fallback' })
})

test('compass_status with every field empty answers an error naming the fields', async ($, on) => {
  startWorld(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: STATUS, goal: '' } as never)
  expect(JSON.stringify(out)).toContain('goal, step, next')
})

test('the reminder section is added after the engine sections', async ($, on) => {
  startWorld(on)
  const { sections } = await $.prompt.compose({} as never)
  expect(sections.map(s => s.id)).toEqual(['intro', 'session-compass:reminder'])
  expect(sections[1]).toMatchObject({ scope: 'session' })
})

test('a second session.start (hot reload) keeps the stored record and its artifacts', async ($, on) => {
  const stored = {
    id: 'sess-1', repo: 'cubby', worktree: WT, branch: 'feature/scan', goal: 'kept',
    lastActive: 1, artifacts: [{ kind: 'doc', path: 'docs/a.md', at: 1 }],
  }
  startWorld(on, {}, { 'session:sess-1': stored, index: ['sess-1'] })
  await $.session.start(START)
  const { value } = await $.state.get(RECORD)
  expect(value).toMatchObject({ goal: 'kept', artifacts: stored.artifacts, lastActive: T0 })
})

test('git failing keeps a usable record', async ($, on) => {
  startWorld(on, { git: {}, repoRoot: null })
  await $.session.start(START)
  const { value } = await $.state.get(RECORD)
  expect(value).toMatchObject({ repo: 'feature-scan', worktree: WT, branch: '' })
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/session-compass` — Expected: FAIL in `status.test.ts` (stub registers nothing).

- [ ] **Step 4: Write `state.ts`**

`plugins/session-compass/hooks/state.ts`:
```ts
import { atom } from 'claude-code'

export const record = atom({ plugin: 'session-compass', key: 'record' } as const, null)
export const band = atom({ plugin: 'session-compass', key: 'band' } as const, 'hidden')
export const tab = atom({ plugin: 'session-compass', key: 'tab' } as const, 'this')
```

- [ ] **Step 5: Write `io.ts`**

`plugins/session-compass/hooks/io.ts`:
```ts
import type { EngineInterface } from 'claude-code'
import type { SessionRecord } from '../types'
import { LIMITS, basename, capArtifacts, orderIndex, sortByActive, type Where } from './record'

const INDEX = 'index'
const PREFIX = 'session:'
const GIT_TIMEOUT_MS = 5_000
const recordKey = (id: string): string => `${PREFIX}${id}`

const isRecord = (v: unknown): v is SessionRecord =>
  typeof v === 'object' && v !== null && typeof (v as SessionRecord).id === 'string' &&
  Array.isArray((v as SessionRecord).artifacts)

export async function loadRecord($: EngineInterface, id: string): Promise<SessionRecord | undefined> {
  const raw = await $.store.get(recordKey(id))
  return isRecord(raw) ? raw : undefined
}

async function rebuildIndex($: EngineInterface): Promise<string[]> {
  const ids = (await $.store.keys()).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length))
  const recs = (await Promise.all(ids.map(id => loadRecord($, id)))).filter(isRecord)
  return sortByActive(recs).map(r => r.id)
}

export async function loadIndex($: EngineInterface): Promise<string[]> {
  const raw = await $.store.get(INDEX)
  const isValid = Array.isArray(raw) && raw.every(x => typeof x === 'string')
  return isValid ? (raw as string[]) : rebuildIndex($)
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

export async function saveRecord($: EngineInterface, rec: SessionRecord): Promise<void> {
  try {
    await writeAll($, rec, LIMITS.sessions)
  } catch {
    try {
      await writeAll($, capArtifacts(rec, LIMITS.trimArtifacts), LIMITS.trimSessions)
      await trimOthers($, rec.id)
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

export async function locate($: EngineInterface, prev?: Where): Promise<Where> {
  const cwd = await $.session.cwd().catch(() => prev?.worktree ?? '')
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
```

- [ ] **Step 6: Write `register.tsx` (start, status tool, reminder)**

`plugins/session-compass/hooks/register.tsx`:
```tsx
import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { SessionRecord } from '../types'
import { locate, loadRecord, saveRecord } from './io'
import { applyStatus, newRecord, type StatusInput } from './record'
import { band, record } from './state'

export const STATUS_TOOL_ID = 'mcp__session-compass__compass_status'
const STATUS_TOOL = {
  name: 'compass_status',
  description:
    'Record what this session is building (goal), where it stands (step), and what comes next. ' +
    'Call it when the goal is first clear and whenever the phase changes ' +
    '(spec, plan, implement, review, PR, done), not every turn.',
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

async function commit($: EngineInterface, rec: SessionRecord): Promise<void> {
  await update($, record, () => rec)
  await saveRecord($, rec)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register(STATUS_TOOL)
    await $.command.register({ name: 'compass', description: 'Open the session compass pane' })
    const id = await $.session.id()
    const now = await $.clock.now()
    const stored = await loadRecord($, id)
    const where = await locate($, stored)
    await commit($, stored ? { ...stored, ...where, lastActive: now } : newRecord(id, where, now))
    return next(e)
  })

  on('tool.call', { tool: STATUS_TOOL_ID }, async ($, e) => {
    const rec = await read($, record)
    if (rec === null) return { deny: 'session-compass: no session record yet' }
    const out = applyStatus(rec, e as unknown as StatusInput, await $.clock.now())
    if ('error' in out) return { deny: out.error }
    await commit($, out)
    return { result: { text: 'ok' } }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, REMINDER] }
  })
}
```

(`band` is imported now and used from Task 5 on; drop the import if `tsc` flags it as unused before then.)

- [ ] **Step 7: Run tests, validate, type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS.
Run: `claude plugin validate plugins/session-compass` — Expected: hooks `session.start`, `tool.call`, `prompt.compose`; no refusal.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors.

- [ ] **Step 8: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): session record, store index and compass_status tool"
git push origin HEAD:feat/session-mods
```

---

### Task 4: Capture wiring and branch refresh

**Files:**
- Modify: `plugins/session-compass/hooks/register.tsx`
- Test: `plugins/session-compass/tests/capture-wiring.test.ts`

**Interfaces:**
- Consumes: `capture` (Task 2), `commit`, `locate` (Task 3), fixtures (Task 2).
- Produces: artifacts in the `record` atom and store after each captured tool call.

- [ ] **Step 1: Write the failing tests**

`plugins/session-compass/tests/capture-wiring.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { ARTIFACT_PUBLISH, BASH_COMMIT, BASH_COMMIT_FAILED, type Fixture } from './fixtures/results'
import { START, startWorld } from './fixtures/world'

const RECORD = { plugin: 'session-compass', key: 'record' } as const

const answer = (f: Fixture) =>
  f.isError ? { isError: true as const, result: f.result, text: String(f.result) } : { result: f.result, text: 'ok' }

test('a successful git commit adds a commit artifact and passes the result through', async ($, on) => {
  startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => answer(BASH_COMMIT) as never)
  await $.session.start(START)
  const out = await $.tool.call({ tool: 'Bash', ...BASH_COMMIT.input } as never)
  expect(out).toMatchObject({ text: 'ok' })
  const { value } = await $.state.get(RECORD)
  expect(value?.artifacts[0]).toMatchObject({ kind: 'commit', sha: '1a2b3c4' })
})

test('a failed commit adds nothing', async ($, on) => {
  startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => answer(BASH_COMMIT_FAILED) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', ...BASH_COMMIT_FAILED.input } as never)
  expect((await $.state.get(RECORD)).value?.artifacts).toEqual([])
})

test('an Artifact publish is captured', async ($, on) => {
  startWorld(on)
  on('tool.call', { tool: 'Artifact' }, () => answer(ARTIFACT_PUBLISH) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Artifact', ...ARTIFACT_PUBLISH.input } as never)
  expect((await $.state.get(RECORD)).value?.artifacts[0]).toMatchObject({ kind: 'artifact', title: 'Compass Report' })
})

test('git switch refreshes the branch', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'main\n'
  await $.tool.call({ tool: 'Bash', command: 'git switch main' } as never)
  expect((await $.state.get(RECORD)).value?.branch).toBe('main')
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/session-compass` — Expected: FAIL in `capture-wiring.test.ts` (no artifacts recorded).

- [ ] **Step 3: Add the capture hook to `register.tsx`**

Add imports:
```tsx
import { capture } from './capture'
import { addArtifact } from './record'
```
Add constants under `REMINDER`:
```tsx
const CAPTURED = new Set(['Artifact', 'SendUserFile', 'Write', 'Bash'])
const GIT_MOVE = /\bgit\s+(checkout|switch|worktree|commit|push)\b/
```
Add inside `register`, after the status-tool hook:
```tsx
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!CAPTURED.has(tool) || ran.deny !== undefined) return ran
    try {
      const rec = await read($, record)
      if (rec === null) return ran
      const input = e as unknown as Record<string, unknown>
      const found = capture({ tool, input, result: ran.result, isError: ran.isError === true, now: await $.clock.now() })
      let updated = found.reduce(addArtifact, rec)
      const command = typeof input.command === 'string' ? input.command : ''
      if (tool === 'Bash' && GIT_MOVE.test(command)) updated = { ...updated, ...(await locate($, updated)) }
      if (updated !== rec) await commit($, updated)
    } catch (err) {
      $.ui.log(`session-compass: capture skipped: ${String(err).slice(0, 120)}`)
    }
    return ran
  }).catch(($, e, next) => next(e))
```

- [ ] **Step 4: Run tests, type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors.

- [ ] **Step 5: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): capture artifacts and git activity from tool calls"
git push origin HEAD:feat/session-mods
```

---

### Task 5: Return detection and the band

**Files:**
- Create: `plugins/session-compass/hooks/band.tsx`
- Modify: `plugins/session-compass/hooks/register.tsx`
- Test: `plugins/session-compass/tests/band.test.ts`, `plugins/session-compass/tests/return.test.tsx`

**Interfaces:**
- Consumes: atoms, `readTestBoard`, `commit`, `touch`, `withFirstPrompt`, `LIMITS.idleMs`.
- Produces: `Tally` type, `tally(runs)`, `formatBand(rec, tests, columns): { text; isDim }`, `registerBand(on)`.

- [ ] **Step 1: Write the failing pure band tests**

`plugins/session-compass/tests/band.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'
import { formatBand, tally } from '../hooks/band'
import { newRecord } from '../hooks/record'

const rec = {
  ...newRecord('s1', { repo: 'cubby', worktree: '/Users/me/wt/feature-scan', branch: 'feature/scan' }, 0),
  goal: 'barcode fallback',
  step: 'fixing 3 failing tests',
  artifacts: [1, 2, 3, 4].map(i => ({ kind: 'doc' as const, path: `docs/${i}.md`, at: i })),
}
const TESTS = { passed: 412, failed: 3 }

test('wide terminal shows every segment', () => {
  expect(formatBand(rec, TESTS, 200)).toEqual({
    text: 'cubby · wt/feature-scan (feature/scan) · Goal: barcode fallback · Now: fixing 3 failing tests · 4 artifacts · tests 412 ✓ 3 ✗',
    isDim: false,
  })
})
test('narrow drops artifacts, then tests, then shortens the worktree', () => {
  expect(formatBand(rec, TESTS, 110).text).not.toContain('artifacts')
  expect(formatBand(rec, TESTS, 100).text).not.toContain('tests')
  expect(formatBand(rec, TESTS, 91).text.startsWith('cubby · feature-scan (feature/scan)')).toBe(true)
})
test('no goal shows the first prompt, marked and dimmed', () => {
  const line = formatBand({ ...rec, goal: undefined, firstPrompt: 'fix the scanner' }, undefined, 200)
  expect(line.text).toContain('Goal: "fix the scanner" (no goal set)')
  expect(line.isDim).toBe(true)
})
test('tally sums parsed runs and ignores unparsed ones', () => {
  expect(tally([{ parsed: true, passed: 10, failed: 1 }, { parsed: false }])).toEqual({ passed: 10, failed: 1 })
  expect(tally(undefined)).toBeUndefined()
})
```

- [ ] **Step 2: Write the failing wiring tests**

`plugins/session-compass/tests/return.test.tsx`:
```tsx
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { BAND_PROPS, START, startWorld } from './fixtures/world'

const BAND = { plugin: 'session-compass', key: 'band' } as const
const OTHER = {
  name: 'other-band',
  register: (on: On) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      return <Box flexDirection="column"><Text>other band</Text>{await next(e)}</Box>
    })
  },
}

const bottom = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

test('15 idle minutes raise the band; the next prompt hides it', async ($, on) => {
  const { clock } = startWorld(on)
  await $.session.start(START)
  await clock.advance(14 * 60_000)
  expect((await $.state.get(BAND)).value).toBe('hidden')
  await clock.advance(2 * 60_000)
  expect((await $.state.get(BAND)).value).toBe('return')
  await $.prompt.submit({ text: 'back again' } as never)
  expect((await $.state.get(BAND)).value).toBe('hidden')
})

test('a resumed session starts with the band up', async ($, on) => {
  startWorld(on, { turns: 3 })
  await $.session.start(START)
  expect((await $.state.get(BAND)).value).toBe('return')
})

test('no band while a turn runs, even past 15 minutes', async ($, on) => {
  const { clock } = startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'long task' } as never)
  await clock.advance(20 * 60_000)
  expect((await $.state.get(BAND)).value).toBe('hidden')
})

test('the first prompt is kept as the no-goal fallback', async ($, on) => {
  startWorld(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'fix the scanner crash' } as never)
  const { value } = await $.state.get({ plugin: 'session-compass', key: 'record' } as const)
  expect(value?.firstPrompt).toBe('fix the scanner crash')
})

test('the band stacks above another mod band on both surfaces', { plugins: [OTHER] }, async ($, on) => {
  startWorld(on, { turns: 1 })
  bottom(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-compass', surface, component: 'AbovePrompt', props: BAND_PROPS as never })
    expect(await ui.find({ text: /cubby · .*feature-scan/ })).toBeDefined()
    expect(await ui.find({ text: 'other band' })).toBeDefined()
  }
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/session-compass` — Expected: FAIL in `band.test.ts` (module missing) and `return.test.tsx`.

- [ ] **Step 4: Write `band.tsx`**

`plugins/session-compass/hooks/band.tsx`:
```tsx
import { read } from 'claude-code'
import type { On } from 'claude-code'
import type { SessionRecord } from '../types'
import { readTestBoard } from './io'
import { basename, truncate } from './record'
import { band, record } from './state'

export type Tally = { passed: number; failed: number }
export type BandLine = { text: string; isDim: boolean }

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

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, band)
    const rec = await read($, record)
    if (e.props.hasSurvey || shown !== 'return' || rec === null) return next(e)
    const line = formatBand(rec, tally(await readTestBoard($)), e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor={line.isDim}>{line.text}</Text>
        {await next(e)}
      </Box>
    )
  })
}
```

- [ ] **Step 5: Wire return detection in `register.tsx`**

Add imports:
```tsx
import { registerBand } from './band'
import { LIMITS, touch, withFirstPrompt } from './record'
```
(merge with the existing `./record` import line.)

Add above `register`:
```tsx
const IDLE_TICK_MS = 60_000
let isTurnRunning = false

async function idleTick($: EngineInterface): Promise<void> {
  const rec = await read($, record)
  if (rec === null || isTurnRunning) return
  const isIdle = (await $.clock.now()) - rec.lastActive >= LIMITS.idleMs
  if (isIdle && (await read($, band)) !== 'return') await update($, band, () => 'return')
}
```

In the `session.start` hook, before `return next(e)`:
```tsx
    if ((await $.session.turns()) > 0) await update($, band, () => 'return')
    $.clock.every(IDLE_TICK_MS, () => idleTick($))
```

Inside `register`, add:
```tsx
  on('prompt.submit', async ($, e, next) => {
    isTurnRunning = true
    await update($, band, () => 'hidden')
    const rec = await read($, record)
    if (rec !== null) await commit($, touch(withFirstPrompt(rec, e.text), await $.clock.now()))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    isTurnRunning = false
    const rec = await read($, record)
    if (rec !== null) await commit($, touch(rec, await $.clock.now()))
    return next(e)
  })

  registerBand(on)
```

- [ ] **Step 6: Run tests, type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS. If the stacking test fails because `next(e)` cannot be embedded, U1 was false: apply the decision-log fallback (draw only when `next(e)` shows nothing) and change the test to assert the compass line alone.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors.

- [ ] **Step 7: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): return band on resume or 15 min idle"
git push origin HEAD:feat/session-mods
```

---

### Task 6: `/compass` pane

**Files:**
- Create: `plugins/session-compass/hooks/pane.tsx`
- Modify: `plugins/session-compass/hooks/register.tsx` (call `registerPane(on)`)
- Test: `plugins/session-compass/tests/pane.test.tsx`

**Interfaces:**
- Consumes: atoms, `listSessions`, `readTestBoard`, `tally`, `ago`, `basename`.
- Produces: `PANE_ID = 'compass'`, `registerPane(on)`.

- [ ] **Step 1: Write the failing pane tests**

`plugins/session-compass/tests/pane.test.tsx`:
```tsx
import { expect, test, type Engine } from 'claude-code/testing'
import { PANE_PROPS, START, T0, WT, startWorld } from './fixtures/world'

const OTHER = {
  id: 'sess-0', repo: 'ocr', worktree: '/Users/me/projects/ocr', branch: 'main',
  goal: 'table OCR', step: 'review', lastActive: T0 - 3_600_000, artifacts: [],
}
const RUN = { command: 'compass', args: '', origin: { kind: 'user' } } as never
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'session-compass', surface, component: 'Pane', requestId: 'compass', props: PANE_PROPS } as never)

test('/compass opens the pane', async ($, on) => {
  const { world } = startWorld(on)
  await $.session.start(START)
  await $.command.run(RUN)
  expect(world.opened).toEqual(['compass'])
})

test('this-session tab lists status and artifacts; pressing one copies it', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__session-compass__compass_status', goal: 'barcode fallback' } as never)
  await $.tool.call({ tool: 'Write', file_path: `${WT}/docs/plan.md`, content: 'x' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: 'Goal: barcode fallback' })).toBeDefined()
    await ui.press({ key: 'a-doc-0' })
  }
  expect(world.copied).toEqual([`${WT}/docs/plan.md`, `${WT}/docs/plan.md`])
})

test('all-sessions tab lists other sessions; pressing a row copies the resume command', async ($, on) => {
  const { world } = startWorld(on, {}, { 'session:sess-0': OTHER, index: ['sess-0'] })
  await $.session.start(START)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'tab-all' })
  expect(await ui.find({ text: /ocr · ocr\/main · table OCR · review/ })).toBeDefined()
  await ui.press({ key: 's-sess-0' })
  expect(world.copied).toEqual(['claude --resume sess-0'])
})

test('a corrupt index is rebuilt from session keys', async ($, on) => {
  startWorld(on, {}, { 'session:sess-0': OTHER, index: 'garbage' })
  await $.session.start(START)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'tab-all' })
  expect(await ui.find({ text: /table OCR/ })).toBeDefined()
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/session-compass` — Expected: FAIL in `pane.test.tsx` (no `command.run` answer, no pane tree).

- [ ] **Step 3: Write `pane.tsx`**

`plugins/session-compass/hooks/pane.tsx`:
```tsx
import { read, update } from 'claude-code'
import type { On } from 'claude-code'
import type { Artifact } from '../types'
import { tally } from './band'
import { listSessions, readTestBoard } from './io'
import { ago, basename } from './record'
import { record, tab } from './state'

export const PANE_ID = 'compass'
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

export function registerPane(on: On): void {
  on('command.run', { command: 'compass' }, async $ => {
    await $.ui.open({ id: PANE_ID, title: 'Compass' })
    return { text: 'Compass opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, tab)
    const rec = await read($, record)
    const now = await $.clock.now()
    const copy = (text: string) => () => { void $.ui.copy({ text, surface: e.surface }) }
    const tabs = (
      <Box flexDirection="row">
        <Button key="tab-this" label="This session" variant={shown === 'this' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'this')} />
        <Button key="tab-all" label="All sessions" variant={shown === 'all' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'all')} />
      </Box>
    )

    if (shown === 'all') {
      const others = await listSessions($, rec?.id ?? '')
      return (
        <Box flexDirection="column">
          {tabs}
          {others.length === 0 && <Text dimColor>No other sessions recorded.</Text>}
          {others.map(o => (
            <Button key={`s-${o.id}`} plain onPress={copy(`claude --resume ${o.id}`)}>
              {`${o.repo} · ${basename(o.worktree)}/${o.branch} · ${o.goal ?? o.firstPrompt ?? '(no goal)'} · ${o.step ?? '-'} · `}
              <Text dimColor>{ago(now, o.lastActive)}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    if (rec === null) {
      return <Box flexDirection="column">{tabs}<Text dimColor>No record for this session yet.</Text></Box>
    }
    const tests = tally(await readTestBoard($))
    const status = rec.statusAt === undefined ? 'status never set' : `status set ${ago(now, rec.statusAt)}`
    return (
      <Box flexDirection="column">
        {tabs}
        <Text>{`${rec.repo} · ${rec.worktree} (${rec.branch})`}</Text>
        <Text>{`Goal: ${rec.goal ?? '(no goal set)'}`}</Text>
        <Text>{`Now: ${rec.step ?? '-'} · Next: ${rec.next ?? '-'}`}</Text>
        <Text dimColor>{status}</Text>
        {tests !== undefined && <Text>{`Tests: ${tests.passed} ✓ ${tests.failed} ✗`}</Text>}
        {KINDS.map(kind => {
          const items = rec.artifacts.filter(a => a.kind === kind)
          if (items.length === 0) return null
          return (
            <Box key={`g-${kind}`} flexDirection="column">
              <Text bold>{KIND_LABEL[kind]}</Text>
              {items.map((a, i) => (
                <Button key={`a-${kind}-${i}`} plain onPress={copy(copyText(a))}>{label(a)}</Button>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
```

- [ ] **Step 4: Register the pane**

In `register.tsx` add `import { registerPane } from './pane'` and call `registerPane(on)` after `registerBand(on)`.

- [ ] **Step 5: Run tests, validate, type-check**

Run: `claude plugin test plugins/session-compass` — Expected: PASS.
Run: `claude plugin validate plugins/session-compass` — Expected: `command.run` "answers its own command: compass"; no refusal.
Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/tsc/session-compass.json` — Expected: no errors. If `null` is refused as a JSX child, filter the kinds first (`KINDS.filter(k => rec.artifacts.some(a => a.kind === k))`) instead of returning `null`.

- [ ] **Step 6: Commit and push**

```bash
git add plugins/session-compass
git commit -m "feat(session-compass): /compass pane with this-session and all-sessions tabs"
git push origin HEAD:feat/session-mods
```

---

### Task 7: README and local gates

**Files:**
- Create: `plugins/session-compass/README.md`

**Interfaces:**
- Consumes: the finished plugin.

- [ ] **Step 1: Write the README**

`plugins/session-compass/README.md`:
````markdown
# session-compass

Come back to any Claude Code session and see what it is building, where it stands and
everything it has produced.

- **Return band:** on resume, or after 15+ idle minutes, one line above the prompt:
  `repo · worktree (branch) · Goal · Now · N artifacts · tests` (tests when
  [test-board](../test-board) is installed). The next prompt dismisses it.
- **`/compass` pane:** this session's goal, step, next, status age, test result and every
  artifact (published claude.ai artifacts, files sent, documents written under
  `.scratch/`, `docs/`, `reports/`, `test-checklists/`, commits, pushes, PRs). Press an
  entry to copy it. The **All sessions** tab lists the 50 most recent sessions; press a
  row to copy `claude --resume <id>`.
- **`compass_status` tool:** Claude records the goal, step and next step when the goal is
  first clear and whenever the phase changes.

## Install

```
/plugin install session-compass --marketplace abhijitbansal/claude-skills
```

## Develop

```bash
claude plugin validate plugins/session-compass
claude plugin test plugins/session-compass
claude --plugin-dir plugins/session-compass   # lays .claude-plugin/types for tsc -p
```

## Limits

Goal 80 chars, step/next 60, 100 artifacts per session, 50 sessions. Data stays in this
plugin's local store; nothing leaves the machine.
````

- [ ] **Step 2: Run every local gate**

Run: `claude plugin validate plugins/session-compass` — Expected: no refusal.
Run: `claude plugin test plugins/session-compass` — Expected: every suite PASS.
The person (or the executor, in an interactive terminal) runs `claude --plugin-dir plugins/session-compass` once and exits; this lays `plugins/session-compass/.claude-plugin/types/` (gitignored).
Run: `npx -y -p typescript@5.6.3 tsc -p plugins/session-compass` — Expected: no errors. This is the spec's gate; the `.scratch/tsc` config is only the per-task check before a load.

- [ ] **Step 3: Commit and push**

```bash
git add plugins/session-compass/README.md
git commit -m "docs(session-compass): README"
git push origin HEAD:feat/session-mods
```

---

### Task 8: Repo obligations for both plugins

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: every file listed by `grep -rln -i -E '\b(five|5) plugins\b' docs site README.md`, excluding `docs/superpowers/**` (today: `docs/architecture.md`, `docs/architecture.html`, `docs/catalog.html`, `docs/features/*.html`, `docs/machine-setup.html`, `docs/second-wind/index.html`, `docs/skill-audit-plan.md`, `docs/skills-catalog.md`, `README.md`, `site/index.html`)
- Modify: `docs/catalog.html`, `docs/skills-catalog.md` (plugin listings)
- Modify: `tests/bats/onboarding-showcase.bats` (catalog loop)

**Interfaces:**
- Consumes: `plugins/test-board/` (plan 01) and `plugins/session-compass/`.

- [ ] **Step 1: Write the failing bats check**

In `tests/bats/onboarding-showcase.bats`, test "catalog lists every plugin and the filter chips", change the loop line to:
```bash
  for name in second-wind core-workflow ios-dev linear-pm prompt-craft test-board session-compass; do
```
Run: `bats tests/bats/onboarding-showcase.bats` — Expected: FAIL (catalog lacks `test-board`).

- [ ] **Step 2: Add the marketplace entries**

Append to `plugins` in `.claude-plugin/marketplace.json`:
```json
    {
      "name": "test-board",
      "source": "./plugins/test-board",
      "description": "Test results band: passed/failed/skipped after every test run, next to the previous run of the same suite in the same worktree"
    },
    {
      "name": "session-compass",
      "source": "./plugins/session-compass",
      "description": "Session compass: what each session is building, where it stands and what it produced, as a return band, a /compass pane and a compass_status tool"
    }
```

- [ ] **Step 3: Sweep the plugin counts with one script**

```bash
files=$(grep -rln -i -E '\b(five|5) plugins\b' docs site README.md | grep -v '^docs/superpowers/')
echo "$files"
perl -pi -e 's/\b5 plugins\b/7 plugins/g; s/\bfive plugins\b/seven plugins/g; s/\bFive plugins\b/Seven plugins/g' $files
grep -rn -i -E '\b(five|5) plugins\b' docs site README.md | grep -v '^docs/superpowers/'
```
Expected: the last grep prints nothing. Then `git diff --stat` and read each hunk: every change is a plugin count, nothing else.

- [ ] **Step 4: List both plugins in the catalogs**

Open `docs/catalog.html` and `docs/skills-catalog.md`, find the `prompt-craft` entry in each, and add `test-board` and `session-compass` entries after it in the same markup, using the marketplace descriptions from Step 2 (catalog filter chip: `Plugin`; component chips: `Hook`, plus `Command` for session-compass). Any command shown with a copy button follows the per-line `.code.cmds` contract in `CLAUDE.md` (no `# comment` in `data-copy`). Feature pages under `docs/features/` are out of scope for this PR.

- [ ] **Step 5: Run the repo gates**

Run: `bats tests/bats` — Expected: all pass.
Run the CI manifest check locally:
```bash
python3 -c "
import json, os
mp = json.load(open('.claude-plugin/marketplace.json'))
for p in mp['plugins']:
    pj = json.load(open(os.path.join(p['source'], '.claude-plugin', 'plugin.json')))
    assert pj['name'] == p['name'], p['name']
print('OK', len(mp['plugins']), 'plugins')
"
```
Expected: `OK 7 plugins`.

- [ ] **Step 6: Check the changed pages render**

With Chrome MCP (load the core tool set in one ToolSearch call), open `file://<repo>/site/index.html` and `file://<repo>/docs/catalog.html`: confirm "7 plugins" / "Seven plugins" render, the two new catalog entries show under the `Plugin` filter, and take one screenshot of each.

- [ ] **Step 7: Commit and push**

```bash
git add .claude-plugin/marketplace.json docs site README.md tests/bats/onboarding-showcase.bats
git commit -m "docs: list test-board + session-compass; plugin counts 5 to 7"
git push origin HEAD:feat/session-mods
```

---

### Task 9: Manual-test checklist and the PR

**Files:**
- Create: `.scratch/feat-session-mods-test-checklist.html` (gitignored deliverable)
- Create: `.scratch/feat-session-mods-test-checklist.md`

**Interfaces:**
- Consumes: both plugins, the decision log (probe results and any fallbacks), the branch's commit list.

- [ ] **Step 1: Write the HTML checklist**

One self-contained page (inline CSS/JS, light and dark via `prefers-color-scheme`) with:
- `<details open>` **"What's in this branch"**: Test Board features, Session Compass features, the four spec-review fixes, every probe fallback applied, and every review-cycle fix from this branch (`git log --oneline main..HEAD`).
- An intro saying what CI and `claude plugin test` already cover (parsers, record rules, capture, band text, pane tabs) and that the list covers only what needs a live session.
- Sections, each a list of real `<input type="checkbox">` items with a per-section `done/total` tally:
  1. **Install:** both plugins load via `claude --plugin-dir plugins/test-board --plugin-dir plugins/session-compass`; no dim refusal lines in the transcript.
  2. **Test Board live:** run a cartoon-wrapped `pytest`, a raw `xcodebuild test` in an iOS repo, a subagent test run (band shows `via <agent>`), a second run (shows `prev`), a failing run (expand lists IDs).
  3. **Compass status:** Claude calls `compass_status` on a new task without being asked; the pane shows goal/step/next.
  4. **Compass capture:** publish an artifact, send a file, write `.scratch/x.html`, commit, push, `gh pr create` on a throwaway repo; each appears in `/compass`; pressing an entry copies it (paste to verify).
  5. **Return band:** idle 15 minutes, band appears without a keypress (U10/U11); next prompt hides it; `claude --resume` shows it at once (U7).
  6. **All sessions:** a second concurrent session in another repo appears in the first one's All sessions tab (U5); pressing the row copies `claude --resume <id>`.
  7. **Stacking:** with cache-tax or savvy-progress installed, both mods' lines show above the prompt (U1).
  8. **Narrow terminal:** at 70 columns both bands drop segments in the spec order and never wrap.
- Items for fixes made during review carry a visible `regression` tag.
- A sticky progress bar (`done/total`), a Reset button, checkbox state in `localStorage` under key `checklist:feat/session-mods`, every read/write wrapped in `try/catch`.
- A closing **"If something fails"** section: copy the transcript's dim plugin line, run `claude --debug` and grep the debug log for `session-compass:` / `test-board:`, note the probe ID it maps to, and file it on the PR.

- [ ] **Step 2: Write the markdown twin**

`.scratch/feat-session-mods-test-checklist.md`: the same sections as `- [ ]` items, for pasting into the PR.

- [ ] **Step 3: Send the checklist**

Send `.scratch/feat-session-mods-test-checklist.html` to the person with SendUserFile.

- [ ] **Step 4: Open the single PR**

```bash
git push origin HEAD:feat/session-mods
git diff --stat main...HEAD
git log --oneline main..HEAD
gh pr create --base main --head feat/session-mods \
  --title "feat: test-board + session-compass mods" \
  --body-file .scratch/feat-session-mods-pr-body.md
```
Write `.scratch/feat-session-mods-pr-body.md` first, from the full `git diff main...HEAD`: Summary (both plugins, specs, probe results), Test plan (local gates run with their results; the manual checklist's markdown twin as `- [ ]` items), and the trailer:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01VWyfakd1WegdcTUQdaYqvH
```

- [ ] **Step 5: Stop at PR open**

Report the PR URL. The merge needs the person: solo CODEOWNERS blocks a self-authored PR and the classifier blocks `--admin`, so hand over `gh pr merge <n> --squash --delete-branch --admin` for them to run.

---

## Self-review

- **Spec coverage:** status tool + reminder (T3), capture table rows Artifact/SendUserFile/Write/commit/push/PR (T2, T4), branch refresh (T4), idle/resume/dismiss (T5), band with no-goal fallback, Test Board tally and narrow order (T5), pane tabs, copy actions, resume command (T6), store caps, index rebuild and trim-retry (T3 `io.ts`, T6 test), error handling per capture (T4 try/catch + `.catch`), repo obligations (T8), checklist and PR (T9). Spec's `git.ts` stdout parsing is replaced by `gitOperation` (deviation stated in Global Constraints; U15 decides).
- **Placeholders:** none; Task 8 Step 4 edits existing catalog markup in place, by pattern, since its exact HTML is the file's own.
- **Type consistency:** `SessionRecord`/`Artifact` from `types/index.d.ts` everywhere; `StatusInput`, `Where`, `LIMITS` from `record.ts`; `STATUS_TOOL_ID` matches tests' `mcp__session-compass__compass_status`; atoms `record`/`band`/`tab` match the contract keys; button keys `tab-this`, `tab-all`, `s-<id>`, `a-<kind>-<i>` match tests.
- **Review Focus:** each line has its test — no-goal band (band.test), source under docs/ (capture.test), failed commit (capture.test + capture-wiring), hot reload (status.test), corrupt index (pane.test).
