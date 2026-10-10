# Session Compass mod — design

Date: 2026-10-10 · Branch: `feat/session-mods` · Sibling spec: [Test Board](./2026-10-10-test-board-mod-design.md)

## Goal

When the user comes back to a session (one of several across repos and worktrees),
show at a glance what the session is building, where it stands, and everything it has
produced. From any session, the user can also see what every other recent session is up to.

Why: 225 sessions in 60 days across about 12 repos (ocr, scan, cubby, foundry, purix, …),
often with several worktrees per repo and sessions that live for days (p90 is 72 h). The
user loses track of which session was doing what.

## Scope decisions (user-confirmed)

- **Status source:** Claude keeps it current through a mod-provided tool. No background
  summarizer, no derived-only facts line.
- **When it shows:** a band appears on resume and after 15+ minutes idle, and the next
  prompt dismisses it. `/compass` opens a pane at any time.
- **Artifacts tracked:** published claude.ai artifacts, files sent with SendUserFile,
  generated deliverables (non-source documents), and git activity (commits, pushes, PRs).
- **Cross-session:** yes, as a second tab in the pane.
- **Packaging:** its own plugin, `plugins/session-compass/`. It reads Test Board's state
  when Test Board is installed, and works without it.

## Where it lives

```
plugins/session-compass/
  .claude-plugin/plugin.json      name session-compass, version 0.1.0, "types": "./types/index.d.ts"
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              event wiring, tool + command registration
  hooks/capture.ts                pure: (tool, input, result) -> Artifact | null
  hooks/git.ts                    pure: commit/push/PR output -> git facts
  hooks/record.ts                 pure: session record updates, trimming, sort
  hooks/band.tsx                  band tree
  hooks/pane.tsx                  pane tree (two tabs)
  types/index.d.ts                PluginState contract
  tests/*.test.ts
  README.md
```

## Data model

```ts
type Artifact =
  | { kind: 'artifact'; title: string; url: string; at: number }
  | { kind: 'file';     path: string; at: number }            // SendUserFile
  | { kind: 'doc';      path: string; at: number }            // generated deliverable
  | { kind: 'commit';   sha: string; subject: string; branch: string; at: number }
  | { kind: 'push';     branch: string; remote: string; at: number }
  | { kind: 'pr';       url: string; number: number; at: number }

type SessionRecord = {
  id: string                 // $.session.id()
  repo: string               // repo name (top-level folder name of the main worktree)
  worktree: string           // absolute worktree root
  branch: string
  goal?: string; step?: string; next?: string
  firstPrompt?: string       // first 80 chars, fallback when no goal is set
  statusAt?: number          // when Claude last called compass_status
  lastActive: number
  artifacts: Artifact[]      // newest first, deduplicated, capped at 100
}
```

- **Store:** `$.store` key `session:<id>` holds a `SessionRecord`, and key `index` lists IDs
  by `lastActive`. 50 sessions are kept, and older records are deleted on write.
  Records are kept small (artifacts capped at 100, strings truncated) to stay well under 4 MiB.
- **Session state:** `$.state` `session-compass.record` mirrors this session's record for
  the band and pane. `session-compass.band` holds `'hidden' | 'return'`, and
  `session-compass.tab` holds `'this' | 'all'`.

## The status tool

Registered in `session.start` with `$.tool.register`:

- **Name** `compass_status`. **Input** `{ goal?: string; step?: string; next?: string }`.
  Every field is optional, and fields left out keep their values. The goal is capped at
  80 chars, step and next at 60.
- **Description:** "Record what this session is building (goal), where it stands (step),
  and what comes next. Call it when the goal is first clear and whenever the phase changes
  (spec, plan, implement, review, PR, done), not every turn."
- A single `prompt.compose` section (`scope: 'session'`) adds one line: "Keep the session
  compass current with `compass_status` when the goal or phase changes." That costs a few
  dozen tokens per turn.
- The handler updates the record and returns `{ text: 'ok' }`.

## Artifact capture (`capture.ts`, `git.ts`)

A `tool.call` hook per tool calls `await next(e)`, then passes the input and result to a
pure capture function. It never denies or alters the call.

| Tool | Condition | Artifact |
| --- | --- | --- |
| `Artifact` | publish result carries a claude.ai URL | `artifact` with the page `<title>` (or `title` input) and URL; a republish to the same URL updates the entry |
| `SendUserFile` | success | `file` with the path |
| `Write` | path ends `.html .md .pdf .png .svg` **and** sits under `.scratch/`, `docs/`, `reports/`, `test-checklists/` or a harness scratchpad dir | `doc` with the path; rewrites update the entry |
| `Bash` | `git commit` succeeded | `commit` from `[<branch> <sha>] <subject>` |
| `Bash` | `git push` succeeded | `push` from `<branch> -> <branch>` / `* [new branch]` lines |
| `Bash` | `gh pr create` succeeded | `pr` from the `https://github.com/…/pull/<n>` line |

Branch refresh: after any Bash call containing `git checkout|switch|worktree|commit|push`,
re-read the branch with `git rev-parse --abbrev-ref HEAD`.

## Return detection

- **Idle:** `$.clock.every(60_000)` compares now with `lastActive`, which is updated on
  `prompt.submit` and `turn.complete`. At 15 minutes or more, with no turn running, it sets
  `band = 'return'`. The band is up when the user looks back.
- **Resume:** in `session.start`, when `$.session.turns()` is above 0 (an existing
  session), it sets `band = 'return'`.
- **Dismiss:** `prompt.submit` sets `band = 'hidden'` and passes the prompt through unchanged.

## Band

When `band === 'return'`, one line stacked above `next(e)`'s tree:

```
cubby · wt/feature-scan (feature/scan) · Goal: barcode fallback · Now: fixing 3 failing tests · 4 artifacts
```

- With no goal set: `Goal: "<first prompt…>" (no goal set)`, dimmed.
- When Test Board's `latest` exists, `· tests 412 ✓ 3 ✗` is appended.
- **Narrow terminals:** drop the artifact count, then tests, then shorten the worktree to its basename.

## `/compass` pane

Registered with `$.command.register({ name: 'compass' })`. The `command.run` hook calls
`$.ui.open({ id: 'compass', title: 'Compass' })`, and the pane is drawn by
`ui.render { component: 'Pane', requestId: 'compass' }`.

- **This session tab:** repo, worktree, branch, goal, step, next, status age ("set 2h ago"),
  last test result when available, then the artifacts grouped by kind, newest first. URLs
  and paths are pressable: an artifact URL is copied with `$.ui.copy`, and a path is copied too.
- **All sessions tab:** one row per record in `index` other than the current one:
  `repo · worktree/branch · goal · step · last active`, newest first, up to 50. Pressing a
  row copies `claude --resume <id>`.

## Error handling

- Each capture function is wrapped. On a throw it records nothing and the tool result
  passes through. Capture is never allowed to break a tool call.
- Store write failure: trim to 40 sessions and 50 artifacts per session and retry once,
  then fall back to `$.ui.log`.
- Branch lookup failure keeps the previous branch.
- A `compass_status` call with every field empty returns an error text naming the fields.

## Testing

- `capture.test.ts`: fixtures for each tool row in the table, plus negatives (a `Write` of
  `.swift` source, a failed commit, a non-PR `gh` call). Also republish dedup.
- `git.test.ts`: commit, push and PR output parsing, including `[new branch]` and a detached HEAD.
- `record.test.ts`: status merge (fields left out keep values), 100-artifact cap,
  50-session trim, index ordering.
- `register.test.ts` under `claude plugin test`: the `compass_status` call updates state; an
  idle tick past 15 min raises the band; `prompt.submit` hides it; the band stacks over
  `next(e)`; `/compass` opens the pane and both tabs render.
- **Gates:** `claude plugin validate`, `tsc -p` and `claude plugin test` on
  `plugins/session-compass`, all local, as for Test Board.

## Repo obligations

Same as Test Board: a marketplace entry, inventory-count sync across docs/site in the
same PR, and a version bump on later changes.

## Out of scope

Automatic goal inference by a model, editing the goal from the pane, cross-machine sync,
cleanup or deletion of other sessions' artifacts, and notifications.

## Risks to verify early in the plan

1. **Cross-session reads:** confirm `$.store` is shared across sessions of the same plugin
   (the doc says values persist "across sessions"). Confirm concurrent sessions writing
   different keys don't clobber each other, and that `index` updates survive races
   (read-modify-write. Last write wins is acceptable for `index`; it is rebuilt from
   `session:*` keys via `$.store.keys()` when inconsistent).
2. **`$.session.turns()` on resume:** confirm it reports the earlier turns when a session
   is resumed.
3. **Artifact tool result shape:** confirm the publish result exposes the URL and title to
   a `tool.call` hook.
4. **Band stacking:** shared with Test Board risk 1.
