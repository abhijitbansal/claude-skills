# Session mods: phase 0, API probes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer every open mod-API question (U1–U15) with a throwaway probe mod before any Test Board or Session Compass code is written, and fold each answer back into the specs.

**Architecture:** Two throwaway mods, `probe-a` and `probe-b`, live under the gitignored `.scratch/session-mods-probe/`. Each hook writes what it sees to `$.store` (key `probe:<U#>…`) and echoes it with `$.ui.log`. A `/probe-report` command prints the store. The person runs the sessions; the agent writes the code, reads the report and updates the decision log and specs.

**Tech Stack:** Claude Code 2.1.296 function hooks (`claude-code` types), TypeScript/TSX, `claude plugin validate`, `tsc`.

**Spec:** [`docs/superpowers/specs/2026-10-10-session-mods-decisions.md`](../specs/2026-10-10-session-mods-decisions.md) §5, with [Test Board](../specs/2026-10-10-test-board-mod-design.md) and [Session Compass](../specs/2026-10-10-session-compass-mod-design.md).

## Global Constraints

- Branch: `feat/session-mods`. In the `claude-mods` worktree the local branch tracks it; push with `git push origin HEAD:feat/session-mods`.
- Probe code is throwaway: it stays in `.scratch/` (gitignored) and is never committed. Only the decision log and spec edits are committed.
- Types: `/private/tmp/claude-501/bundled-skills/2.1.296/e60f5bab9db54497098195964d5421f8/plugin-authoring/types/claude-code.d.ts` (rewritten whenever the plugin-authoring skill loads; after a restart, load the skill again and use the new path it names).
- Every probe that needs the person at the keyboard is marked **[person]**. The agent never fakes a result; an unrun probe stays `Open`.
- Commit authorization: the executor may commit and push the decision-log and spec edits in Task 4. No other commits.

## Review Focus

1. A probe "passes" on the main loop only: U3/U4 must be read from a real subagent and a real Workflow run, not inferred from types.
2. U2 must be checked on a **cartoon-wrapped** test command; a bare `echo` proves nothing about TOON.
3. U5/U6 need two **concurrent** sessions; sequential sessions prove persistence, not concurrency.
4. U9 compares `cache_read_input_tokens` on turn 2 vs turn 3; turn 1 always writes the cache.
5. U13 must include a `cd` into another directory *within* the session, then a later command with no `cd`.

## Questions this phase answers

U1–U12 are the decision log's. U13–U16 were added during planning, from the types:

| # | Question | Why it matters | Fallback if false |
| --- | --- | --- | --- |
| U13 | Does `$.session.cwd()` follow a Bash `cd` that persisted in the session? (`tool.call` carries no cwd.) | Test Board's `worktreeRoot` | Track cwd in the mod: apply each command's leading `cd <dir>` to a per-loop cwd, seeded from `$.session.root()` |
| U14 | Can one mod `$.state.get` another mod's value with no `dependencies` entry, and does `claude plugin validate` accept it? | Compass reads `test-board.latest` | List `test-board` under Compass's `dependencies` (auto-installs it) |
| U15 | Does a Bash `tool.call` result carry `result.gitOperation` (commit/push/pr) for `git commit`, `git push` and `gh pr create`? | Compass git capture | Parse stdout with regexes (the spec's original `git.ts`) |
| U16 | Under `claude plugin test`, which engine calls (`session.*`, `process.run`, `tool.register`, `command.register`, `ui.open`, `store`, `clock`) does the kit answer by itself, and which throw unless a test hook answers? | Every plan 01/02 test that stubs the engine | None needed: the answer tells the plans what to stub |

---

### Task 1: Write and check the probe mods

**Files:**
- Create: `.scratch/session-mods-probe/probe-a/.claude-plugin/plugin.json`
- Create: `.scratch/session-mods-probe/probe-a/hooks/hooks.json`
- Create: `.scratch/session-mods-probe/probe-a/hooks/register.tsx`
- Create: `.scratch/session-mods-probe/probe-a/types/index.d.ts`
- Create: `.scratch/session-mods-probe/probe-a/tsconfig.json`
- Create: `.scratch/session-mods-probe/probe-b/.claude-plugin/plugin.json`
- Create: `.scratch/session-mods-probe/probe-b/hooks/hooks.json`
- Create: `.scratch/session-mods-probe/probe-b/hooks/register.tsx`
- Create: `.scratch/session-mods-probe/probe-a/tests/kit.test.ts`

**Interfaces:**
- Produces: store keys `probe:<U#>…` and the `/probe-report`, `/probe-race`, `/probe-copy` commands, used by Tasks 2–3.

- [ ] **Step 1: Write probe-a's manifest, hooks list, contract and tsconfig**

`.scratch/session-mods-probe/probe-a/.claude-plugin/plugin.json`:
```json
{ "name": "probe-a", "version": "0.0.1", "description": "Throwaway API probe for the session mods", "types": "./types/index.d.ts" }
```

`.scratch/session-mods-probe/probe-a/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`.scratch/session-mods-probe/probe-a/types/index.d.ts`:
```ts
declare module 'claude-code' {
  interface PluginState {
    'probe-a': { ticks: number }
  }
}
export {}
```

`.scratch/session-mods-probe/probe-a/tsconfig.json` (the header's hooks-module options):
```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types"]
}
```

- [ ] **Step 2: Write probe-a's hooks module**

`.scratch/session-mods-probe/probe-a/hooks/register.tsx`:
```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const ticks = atom({ plugin: 'probe-a', key: 'ticks' } as const, 0)
const ID_PREFIX = 'probe:'

async function note($: EngineInterface, key: string, value: unknown): Promise<void> {
  await $.store.set(`${ID_PREFIX}${key}`, value)
  $.ui.log(`probe ${key}: ${JSON.stringify(value).slice(0, 300)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    await note($, 'U7.turnsAtStart', { id, turns: await $.session.turns() })
    await note($, `U5.session:${id}`, { at: await $.clock.now(), cwd: await $.session.cwd() })
    await note($, 'U13.cwdAtStart', await $.session.cwd())
    await $.command.register({ name: 'probe-report', description: 'Print every probe value' })
    await $.command.register({ name: 'probe-race', description: 'Race-write the shared index key' })
    await $.command.register({ name: 'probe-copy', description: 'Copy a test string to the clipboard' })
    $.clock.every(60_000, async () => {
      const n = Number((await $.store.get('probe:U10.ticks')) ?? 0) + 1
      await $.store.set('probe:U10.ticks', n)
      await update($, ticks, () => n)
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const result = (ran.result ?? {}) as Record<string, unknown>
    await note($, `U2.bash:${e.command.slice(0, 40)}`, {
      ranKeys: Object.keys(ran),
      resultKeys: Object.keys(result),
      isError: ran.isError ?? false,
      textHead: ran.text?.slice(0, 200),
      stdoutHead: typeof result.stdout === 'string' ? result.stdout.slice(0, 200) : null,
    })
    await note($, `U3.agentId:${e.command.slice(0, 40)}`, e.agentId ?? 'main')
    await note($, `U13.cwdAfter:${e.command.slice(0, 40)}`, await $.session.cwd())
    if (result.gitOperation !== undefined) {
      await note($, `U15.git:${e.command.slice(0, 40)}`, result.gitOperation)
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await note($, `U4.spawn:${e.description.slice(0, 40)}`, {
      agentId: started.deny === undefined ? started.agentId : null,
      workflowRunId: e.workflow?.runId ?? null,
      cwd: e.cwd ?? null,
    })
    return started
  })

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    const result = (ran.result ?? {}) as Record<string, unknown>
    await note($, 'U8.artifact', {
      resultKeys: Object.keys(result),
      url: result.url ?? null,
      title: result.title ?? null,
      textHead: ran.text?.slice(0, 200),
    })
    return ran
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [
        ...composed.sections,
        { id: 'probe-a:reminder', text: 'Probe reminder: this line is static.', scope: 'session' },
      ],
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const turn = await $.session.turns()
    await note($, `U9.turn${turn}`, e.usage ?? null)
    return done
  })

  on('command.run', { command: 'probe-report' }, async $ => {
    const keys = (await $.store.keys()).filter(k => k.startsWith(ID_PREFIX))
    const lines = await Promise.all(
      keys.map(async k => `${k} = ${JSON.stringify(await $.store.get(k)).slice(0, 400)}`),
    )
    return { text: lines.join('\n') || 'No probe values yet.' }
  })

  on('command.run', { command: 'probe-race' }, async $ => {
    const id = await $.session.id()
    for (let i = 0; i < 50; i += 1) {
      const index = ((await $.store.get('probe:U6.index')) ?? []) as string[]
      await $.store.set('probe:U6.index', [...index, `${id.slice(0, 8)}-${i}`])
    }
    return { text: 'Race writes done. Run /probe-report in both sessions.' }
  })

  on('command.run', { command: 'probe-copy' }, async ($, e) => {
    const copied = await $.ui.copy({ text: 'probe-copy-ok', surface: e.surface })
    await note($, 'U12.copy', copied)
    return { text: `copy result: ${JSON.stringify(copied)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, ticks)
    return (
      <Box flexDirection="column">
        <Text>probe-a band · ticks {n}</Text>
        {await next(e)}
      </Box>
    )
  })
}
```

Note: if `tsc` rejects `ran.text` / `started.agentId` narrowing or the `e.surface` field on `command.run`, adjust the access to what the declaration file says (grep `export type CommandRunInput`); the probe's job is to observe, so loosen with a local cast rather than change what is recorded.

- [ ] **Step 3: Write probe-b (second band + cross-mod state read)**

`.scratch/session-mods-probe/probe-b/.claude-plugin/plugin.json`:
```json
{ "name": "probe-b", "version": "0.0.1", "description": "Throwaway second band for the stacking probe" }
```

`.scratch/session-mods-probe/probe-b/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`.scratch/session-mods-probe/probe-b/hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    // U14: read another mod's value with no `dependencies` entry.
    let seen = 'unreadable'
    try {
      const held = await $.state.get({ plugin: 'probe-a', key: 'ticks' } as never)
      seen = JSON.stringify(held)
    } catch (err) {
      seen = `threw: ${String(err).slice(0, 80)}`
    }
    return (
      <Box flexDirection="column">
        <Text>probe-b band · probe-a ticks read: {seen}</Text>
        {await next(e)}
      </Box>
    )
  })
}
```

- [ ] **Step 4: Validate both probes**

Run: `claude plugin validate .scratch/session-mods-probe/probe-a`
Run: `claude plugin validate .scratch/session-mods-probe/probe-b`
Expected: both report the hooks they register and no refusal. Record probe-b's output verbatim for U14 (whether validate flags the `probe-a` state key).

- [ ] **Step 5: Type-check probe-a**

The engine lays `.claude-plugin/types/` on first load, so type-checking waits for Task 2's first session. Until then run against the skill's declaration file:

Run: `npx -y -p typescript@5.6.3 tsc -p .scratch/session-mods-probe/probe-a` after temporarily adding the declaration file's absolute path to `include`.
Expected: no errors. Fix the probe code until clean; do not change what it records.

- [ ] **Step 6: U16 — what the test kit needs stubbed**

Under `claude plugin test`, a call that no test hook answers reaches the kit's bottom hook, which throws. Plans 01 and 02 stub these calls from the types alone. This step records what the kit actually does with each call.

`.scratch/session-mods-probe/probe-a/tests/kit.test.ts`:
```ts
import { test } from 'claude-code/testing'

// Each test calls one engine noun with no stub. A pass means the kit answers it
// by itself; a failure's message is the kit's own answer, which goes into §5.
test('U16 session.cwd', async $ => { await $.session.cwd({}) })
test('U16 session.id', async $ => { await $.session.id({}) })
test('U16 session.turns', async $ => { await $.session.turns({}) })
test('U16 session.repo', async $ => { await $.session.repo({}) })
test('U16 process.run', async $ => { await $.process.run({ argv: ['git', 'status'] }) })
test('U16 tool.register', async $ => {
  await $.tool.register({ name: 'probe_tool', description: 'probe', isDeferred: false })
})
test('U16 command.register', async $ => {
  await $.command.register({ name: 'probe-x', description: 'probe' })
})
test('U16 ui.open', async $ => { await $.ui.open({ id: 'probe', title: 'Probe' }) })
test('U16 store.get', async $ => { await $.store.get({ key: 'x' }) })
test('U16 clock.now', async $ => { await $.clock.now({}) })
```

A test's `$` raises events whole, so the argument shapes above follow `EngineCall<E>` (`Args<E>`). If `tsc` or the kit rejects one, fix the argument to what `Args<'<noun>.<verb>'>` declares; the result being recorded is what the kit answers.

Run: `claude plugin test .scratch/session-mods-probe/probe-a`
Expected: some tests fail. For each, copy the failure line into §5 row U16: the noun, and whether the kit answered or threw (with the message). Plans 01 and 02 stub exactly the nouns that threw, with answer shapes matching what the message names.

---

### Task 2: Single-session probes (U1, U2, U3, U4, U8, U9, U12, U13, U14, U15) **[person]**

**Files:** none changed; results come from `/probe-report`.

**Interfaces:**
- Consumes: probe-a and probe-b from Task 1.
- Produces: a pasted `/probe-report` transcript for Task 4.

- [ ] **Step 1: Start the session with both probes**

The person runs, from the repo root:
```bash
claude --plugin-dir .scratch/session-mods-probe/probe-a --plugin-dir .scratch/session-mods-probe/probe-b
```

- [ ] **Step 2: U1 / U14 — look at the band**

Expected to see two lines above the prompt: `probe-a band · ticks 0` and `probe-b band · probe-a ticks read: …`. Record: both lines present (U1 true), and what probe-b read (U14).

- [ ] **Step 3: Drive the tool probes with these prompts, one per turn**

1. `Run: cd /tmp && echo hi` then `Run: pwd` (U13: cwd after a persisted `cd`).
2. `Run the pytest suite in tests/pytest with -q` (cartoon wraps it; U2 TOON vs raw).
3. `Dispatch one general-purpose subagent that runs "echo from-subagent" and reports back` (U3, U4 spawn).
4. `Run a one-agent Workflow whose agent runs "echo from-workflow"` (U4 workflow; needs ultracode or explicit ask, already authorized here).
5. `Run: git commit --allow-empty -m "probe: gitOperation"`, then `Run: git reset --soft HEAD~1` (U15 commit). The empty commit is never pushed, and the reset removes it while leaving the tree as it was.
6. `Publish .scratch/session-mods-probe/hello.html as an artifact` after writing a one-line HTML file there (U8).
7. `Say ok` twice more (U9: turns 2 and 3 cache reads).
8. `/probe-copy`, then paste into any field (U12).

U15 push/PR: not exercised (would publish); the commit result shows whether `gitOperation` exists at all. Record push/PR as "inferred from type only".

- [ ] **Step 4: Collect the report**

The person runs `/probe-report` and pastes the output into the session for Task 4.

---

### Task 3: Multi-session probes (U5, U6, U7, U10, U11) **[person]**

**Files:** none changed.

**Interfaces:**
- Consumes: probe-a.
- Produces: two `/probe-report` outputs and three observations for Task 4.

- [ ] **Step 1: U5/U6 — two concurrent sessions**

The person opens two terminals and runs in each:
```bash
claude --plugin-dir .scratch/session-mods-probe/probe-a
```
In both, at nearly the same moment: `/probe-race`. Then `/probe-report` in each.
Expected for U5: each report lists **both** `probe:U5.session:<id>` keys. Expected for U6: `probe:U6.index` holds 50–100 entries and parses as an array (no corruption). Fewer than 100 means last-write-wins, which the spec accepts.

- [ ] **Step 2: U10/U11 — idle timer and redraw**

In one session leave the prompt untouched for 3 minutes.
Expected: the band's `ticks` count rises with no keypress (U10 and U11 both true). If the count only jumps on the next keypress, U10 true and U11 false.

- [ ] **Step 3: U7 — resume**

Exit one session, then `claude --resume <its id> --plugin-dir .scratch/session-mods-probe/probe-a`, then `/probe-report`.
Expected: `probe:U7.turnsAtStart` shows `turns` above 0 for that id.

---

### Task 4: Record results and apply fallbacks

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-session-mods-decisions.md` (§5 table: Status column; add rows U13–U15)
- Modify: `docs/superpowers/specs/2026-10-10-test-board-mod-design.md` (only where a fallback applies)
- Modify: `docs/superpowers/specs/2026-10-10-session-compass-mod-design.md` (only where a fallback applies)

**Interfaces:**
- Consumes: the reports from Tasks 2–3.
- Produces: final API facts the Test Board and Compass plans read before their first task.

- [ ] **Step 1: Update §5**

Rows U13–U16 are already in §5. Set each Status to `Confirmed (2026-10-10)`, `False → fallback applied`, or `Not run` with the reason, quoting the decisive report line.

- [ ] **Step 2: Apply each fallback to its spec**

For every `False` row, edit the affected spec section to the fallback text from §5 and add one line under that spec's "Risks to verify early" naming the probe. Do not touch sections no probe changed.

- [ ] **Step 3: Flag plan impact**

For every `False` row, note which task of plan 01 or 02 it changes, in a short list at the end of §5 ("Plan impact"). The plan executor reads this list before starting plans 01 and 02 and edits the affected steps.

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-10-10-session-mods-decisions.md docs/superpowers/specs/2026-10-10-test-board-mod-design.md docs/superpowers/specs/2026-10-10-session-compass-mod-design.md
git commit -m "docs: session mods probe results (U1-U16)"
git push origin HEAD:feat/session-mods
```
