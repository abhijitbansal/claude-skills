# Test Board mod — design

Date: 2026-10-10 · Branch: `feat/session-mods` · Sibling spec: [Session Compass](./2026-10-10-session-compass-mod-design.md)

## Goal

Every time a test suite runs, from the main session or a subagent, show how many tests
passed, failed and were skipped, next to the previous result for the same suite in the
same worktree. It is deterministic and runs no model calls.

Why: 93 `xcodebuild test` runs in the last 60 days (21 failed), plus fastlane, bun and
pytest runs. Today the counts sit inside tool output the user does not read.

## Scope decisions (user-confirmed)

- **Display:** a band above the prompt. No toast, no history pane.
- **Subagents:** their runs count, tagged with the agent's name.
- **Previous result:** the last run of the same suite in the **same worktree**. Each
  worktree keeps its own history.
- **Parsing:** approach A. Read cartoon's normalized test summary first, then fall back to
  raw-format readers. Approaches B (raw only) and C (shell out to `cartoon logs`) were rejected.
- **Packaging:** its own plugin, `plugins/test-board/`, in this repo's marketplace.
  Independent of Session Compass. Compass reads Test Board's state when both are installed.

## Where it lives

```
plugins/test-board/
  .claude-plugin/plugin.json      name test-board, version 0.1.0, "types": "./types/index.d.ts"
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              event wiring + band rendering only
  hooks/parse.ts                  pure: tool output -> TestRun | null
  hooks/suite.ts                  pure: command + cwd -> suite key and label
  hooks/history.ts                pure: append/trim history, pick previous run
  types/index.d.ts                PluginState contract (last runs, expanded flag)
  tests/*.test.ts                 claude plugin test suites with output fixtures
  README.md
```

Each file has one job. `register.tsx` holds no parsing logic, and the three pure modules
import nothing from `claude-code` except types.

## Data model

```ts
type TestRun = {
  suite: string           // label, e.g. "xcodebuild test -scheme Cubby"
  key: string             // `${worktreeRoot}::${normalizedCommand}`
  total: number; passed: number; failed: number; skipped: number
  durationS?: number
  failures: { id: string; loc?: string }[]   // capped at 20
  exitCode: number
  at: number              // epoch ms
  via?: string            // subagent description, "workflow", or undefined for the main loop
  parsed: boolean         // false: looked like a test run, counts unavailable
}
```

- **History store:** `$.store` key `runs:<key>` holds `TestRun[]`, newest first, capped at 10.
  A key index `index` lists keys by last use. When the store passes 2 MiB (half the 4 MiB
  limit), the oldest keys are dropped.
- **Session state:** `$.state` `test-board.latest` holds the runs from the most recent turn
  that ran tests (at most 3). Session Compass reads this value. `test-board.expanded` holds
  the band's expanded/collapsed flag.

## Detection and parsing (`parse.ts`)

Input: the Bash command string and the tool result's stdout/stderr text and exit code.
Readers are tried in order, and the first match wins:

1. **cartoon summary:** a line matching
   `summary{total,passed,failed,skipped,duration_s}: <n>,<n>,<n>,<n>,<f>`, plus an optional
   `failures[N]{id,loc,msg}:` block (take `id` and `loc`, drop `msg`). This covers every
   cartoon test adapter: pytest, unittest, jest, vitest, swift-test, xcodebuild-test,
   cargo-test, go-test, phpunit and rspec.
2. **xcodebuild raw:** `Executed <n> tests?, with <m> failures? (<k> unexpected) in <s>`.
   Use the last occurrence (the suite total). Failing IDs come from
   `Test Case '-[<Class> <method>]' failed`.
3. **swift test raw:** the same XCTest `Executed …` line, or swift-testing's
   `Test run with <n> tests? passed|failed after <s> seconds` / `<n> tests? failed`.
4. **pytest raw:** the final `=+ (<n> failed, )?(<n> passed)?(, <n> skipped)? … in <s>s =+` line.
5. **jest / vitest / bun raw:** `Tests:\s+(<n> failed, )?(<n> skipped, )?<n> passed, <n> total`,
   and bun's `<n> pass` / `<n> fail` lines.

**Test-run command but no reader matched:** the command matches the test-command pattern
(`xcodebuild … test`, `swift test`, `pytest`, `jest`, `vitest`, `bun test`, `npm (run )?test`,
`cargo test`, `go test`, `fastlane (scan|test)`), so return `parsed: false` with the exit code.
**Neither matches:** return `null`, and the run is ignored.

## Suite identity (`suite.ts`)

`normalizedCommand` strips, in order: a leading `cd <dir> &&` / `;`, `VAR=value` env
prefixes, a cartoon wrapper (`cartoon -c '…'`, `cartoon --tag … --`, `cartoon <cmd>`), a
trailing `| head|tail|grep|rg …` and `2>&1`. It also collapses whitespace. Flags are kept,
so `-only-testing:` runs form their own suite. The label is the normalized command
truncated to 48 columns.

`worktreeRoot` is the `cwd` the command ran in, resolved to its git top level. That
lookup runs `git rev-parse --show-toplevel` once per distinct cwd per session, and the
result is cached in module state. Outside a repo, the cwd is used.

## Event wiring (`register.tsx`)

- `on('tool.call', { tool: 'Bash' }, …)`: call `await next(e)`, then parse the result.
  On a match, append it to history, set `latest`, and return the result unchanged.
  The mod never denies or alters a call.
- `via`: read `e.agentId`. Absent means the main loop. Otherwise look up the description
  recorded by an `agent.spawn` hook (`agentId -> description`). An ID with no record is
  tagged `workflow`.
- `on('session.start')`: load this worktree's most recent run for any suite into
  `latest`, flagged `stale: true`, so the band shows it dimmed.
- `on('ui.render', { component: 'AbovePrompt' })`: when `latest` is empty, return
  `next(e)`. Otherwise draw this mod's lines and **stack them above `next(e)`'s tree**,
  so bands from other mods (cache-tax, savvy-progress, compass) still show.

## Band

One line per run in `latest`, sized to `e.props.bodyColumns`:

```
Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip  1m12s   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer
```

- The failed count is colored as an error when non-zero. The "prev" segment is dimmed and
  reads `first run` when there is no history.
- An arrow marks a change from the previous run: `▲3 ✗` when failures rose, `▼` when they fell.
- **Expand control:** pressing the line toggles `expanded` and lists up to 10 failing IDs
  with locations underneath.
- `parsed: false` runs read `Cubby · bun test   ran · exit 1 · counts unavailable`.
- **Narrow terminals (under 80 columns):** drop `via`, then `prev`, then the duration.
- **Lifetime:** the band persists until the next test run replaces `latest`.

## Error handling

- Parse errors are caught per reader, and a throwing reader counts as no match. The Bash
  result always passes through untouched.
- A rejected store write (quota) triggers one trim of the oldest keys and a retry. A
  second failure is logged with `$.ui.log` and skipped, keeping the session state.
- A failed `git rev-parse` falls back to the cwd.

## Testing

- `parse.test.ts`: one fixture per reader, using real captured output where available
  (cartoon TOON from the archive, raw xcodebuild, pytest, jest, bun, swift-testing). It
  also covers a non-test Bash output (returns `null`) and a test command with unreadable
  output (`parsed: false`).
- `suite.test.ts`: normalization cases for cd/env/cartoon/pipe stripping, and two worktrees
  producing different keys.
- `history.test.ts`: append, cap at 10, previous-run selection, store-size trim.
- `register.test.ts` under `claude plugin test`: a Bash call with fixture output sets
  `latest`; a subagent call carries `via`; the band renders and stacks over `next(e)`.
- **Gates:** `claude plugin validate plugins/test-board`, `tsc -p plugins/test-board` and
  `claude plugin test plugins/test-board` run locally. CI keeps its manifest check, which
  passes for a plugin without `skills/`. CI does not run the TS tests (the runner has no
  `claude` CLI). Adding that is out of scope.

## Repo obligations

- Add `test-board` to `.claude-plugin/marketplace.json`.
- Inventory counts are cross-file invariants (AGENTS.md). Update plugin counts in
  `docs/skills-catalog.md`, `docs/architecture.*`, `docs/catalog.html`, `site/*` and the
  README in the same PR.
- `plugin-version-guard`: any later change to `plugins/test-board/**` bumps its version.

## Out of scope

History pane or trend view, toasts, flaky-test detection, CI result ingestion, and
coverage numbers.

## Risks to verify early in the plan

Tracked with probe method, fallback and status in the [decision log](./2026-10-10-session-mods-decisions.md#5-mod-api-unverified).

1. **Stacking under `next(e)`:** confirm an `AbovePrompt` hook can render its own tree
   above the tree `next(e)` returns. If not, fall back to drawing only when no other band
   is showing, and say so in the README.
2. **Output form after cartoon:** confirm `tool.call`'s `next(e)` result carries the
   rewritten (TOON) output and that `result` exposes stdout text for Bash.
3. **Subagent calls:** confirm `tool.call` hooks fire for subagent Bash calls with `agentId` set.
