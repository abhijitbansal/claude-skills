# test-board

A Claude Code mod. After every test run, from the main session or a subagent, a band
above the prompt shows how many tests passed, failed and were skipped, next to the
previous run of the same suite in the same worktree.

```
Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   ▲3 ✗   1m12s   done 14:32   prev 415 ✓ 0 ✗ · 2h ago   via ios-fixer  ✕
```

## What the band shows

- One line per recent run, up to 3. Runs in the same turn stack; the first run after
  you submit a prompt replaces the previous turn's lines.
- Each line: repo and suite, counts, change in failures against the previous run
  (`▲` more, `▼` fewer), duration, the time it finished (`done 14:32`), `prev …` (or
  `first run`), and `via …`.
- Each line leaves the band 60 minutes after its run finished; the band closes with
  the last one. Press `✕` at the end of the first line to close it sooner. It stays
  closed through a plugin reload; the next test run brings back a band holding only
  that run.
- Press the line to list up to 10 failing tests with their locations.
- Runs from a subagent are tagged `via <the agent's description>`. Workflow agents are
  tagged `via workflow`.
- When a session starts, the newest stored run of the current worktree appears dimmed
  (stale) until a new run replaces it, if it finished within the last 60 minutes.
- The band stays hidden while a survey is on screen. Narrow terminals drop `via`,
  then `prev`, then the duration, then the finish time.
- These commands count as test runs, alone or after a leading `cd`/env vars, behind
  `npx`, `bunx`, `uv run`, `uv tool run`, `uvx`, `poetry run`, `python -m`, `pnpm exec`,
  `pnpm dlx` or `yarn`: `xcodebuild … test` (or `test-without-building`), `swift test`,
  `pytest`, `jest`, `vitest`, `bun test`, `npm|pnpm|yarn [run] test`, `cargo test`,
  `go test`, `fastlane scan|test`. `cat pytest.log` is not one.
- It reads cartoon's test summary first, then raw xcodebuild, swift test, pytest,
  jest/vitest and bun output.
- A recognised test command whose output it cannot read shows `ran · exit N · counts unavailable`.
- It never blocks or changes a tool call, and makes no model calls.

## Install

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install test-board@claude-skills
```

## Data

History lives in the plugin's store: the last 10 runs per suite per worktree. When the
store passes a 2 MiB soft cap, the least recently used suites are dropped first.
Session Compass reads the latest runs from `test-board.latest` when it is installed.
Runs leave `test-board.latest` at 60 minutes, so Compass's `tests` segment clears with
them; `✕` hides only this band and leaves the segment up.

## Known limits

A hot reload of the plugin mid-session forgets which agent ids belong to which
subagent, so their later runs show as `via workflow`. It also resets the per-turn
grouping once: the next run replaces the lines on the band. After a hot reload or
worker restart the band may show the newest stored run dimmed until the next test run,
if it finished within the last 60 minutes and was not closed with `✕`.

Widths count terminal cells for CJK, Hangul, fullwidth forms and emoji drawn as emoji;
other wide characters count as one cell, so a line holding them can wrap. A hot reload
cancels the expiry timer; `session.start` re-arms it, so a line due in between leaves
a moment late.

## Develop

```
claude --plugin-dir plugins/test-board      # lays .claude-plugin/types (gitignored)
npx -y -p typescript@5.6.3 tsc -p plugins/test-board
claude plugin validate plugins/test-board
claude plugin test plugins/test-board
```
