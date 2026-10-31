# test-board

A Claude Code mod. After every test run, from the main session or a subagent, a band
above the prompt shows how many tests passed, failed and were skipped, next to the
previous run of the same suite in the same worktree.

```
Cubby · xcodebuild test -scheme Cubby   412 ✓  3 ✗  2 skip   exit 65   ▲3 ✗   1m12s   done 14:32  ✕
```

## What the band shows

- One line per recent run, up to 3. Runs in the same turn stack; the first run after
  you submit a prompt replaces the previous turn's lines.
- Each line: repo and suite, counts, command/evidence warnings, change in failures against the previous run
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
- It reads cartoon's test summary and raw xcodebuild, swift test, pytest,
  jest/vitest and bun output. Impossible counts are invalid. Repeated summaries in
  one format (a monorepo or multi-destination run) are summed, each one checked on
  its own; summaries in two different formats are conflicting rather than silently
  choosing one, and so are repeated bun counts. Summing has limits: echoed output
  (`tee log; cat log`) counts twice, per-package prefixes (`pnpm -r`, turbo) are
  not read, and a multi-destination xcodebuild run shows only its last destination.
  Nested XCTest totals and combined XCTest/Swift Testing runs remain supported.
- A recognised test command whose output it cannot read shows `counts unavailable`.
- Parsed counts never erase a tool error, interruption, or reported nonzero exit.
  `10 passed` followed by a failed build is still qualified as a `tool error` when
  the host reports one. Interrupted or explicitly truncated output is marked
  `output incomplete`.
- The observed Bash response does not provide a structured exit code, so a response
  without a tool error is never given an invented exit zero. Its status is unknown and
  the line says nothing about it; only a tool error, an interruption, incomplete
  output or an exit code is shown. For a failed call the host writes `Exit code N` as
  the first line of the error text: that line is shown as `exit N`. Exit-code prose
  anywhere later in the output is not trusted. Older records' nonzero codes are
  labeled `reported exit N`.
- It never blocks or changes a tool call, and makes no model calls.

## Source freshness

The band shows one source line, kept visible on narrow terminals, under the newest
run that has a check:

```
    source changed at last check 14:35
```

A run gets a line only if a capture was actually attempted for it (a recognised direct
test command, below) and the collector reported something: a comparison, or a reason it
could not give one (`unknown`). Runs from unsupported or shell-dependent commands, runs
whose collector could not be started or returned unusable output, and restored (dimmed)
runs draw no source line, so a folder that is not a Git worktree does not carry a
permanent `source unknown` under every run.

- `matching`: the bounded source observations before and after the run matched,
  and the most recent check still matches them. This is not a claim of continuous
  monitoring or proof of which inputs the command read.
- `changed`: the supported source identity changed during the run or since it.
  A change during the run stays flagged even if the source later returns to its
  earlier state.
- `unknown`: no complete supported comparison is available. Old runs without
  source observations, overlapping tools, ambiguous shell context, unlocated
  subagent directories, missing tools, unsupported files, and capture limits do
  not become matching (and, apart from capture limits and unsupported files the
  collector itself reports, draw no line). Subagent capture requires an explicit
  spawn directory; an inherited or unknown directory does not borrow the main
  session's identity.

Before/after capture applies to recognized direct test commands with a statically
located working directory, optionally preceded by a literal `cd /absolute/path &&`
or `cd ./relative/path &&` (`..` paths are also supported). Bare relative names
such as `cd tests` can follow `CDPATH`, even when quoted; `cd -` follows `OLDPWD`.
Those destinations remain unknown. Shell expansions (including path globs),
compound commands, redirections, pipes, and quoted shell wrappers
still show their test results but have unknown source freshness. Tools that can
change source (`Bash`, `Edit`, `Write`, `NotebookEdit`, `MultiEdit`, and any tool not on
a short read-only list: `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, `WebFetch`,
`WebSearch`, `TodoWrite`, `Agent`, `Task`, `Skill`, `ToolSearch`, `AskUserQuestion`,
`TaskOutput`, `BashOutput`, `ExitPlanMode`, `EnterPlanMode`) clear the previous check
before running. `Agent` and `Task` are skipped because a subagent's own tool calls reach
this same hook; the spawn call itself is not checked. Read-only tools do
not clear it, re-run it or spoil a test's evidence by overlapping it. The two captures around
a test run synchronously, because they bracket the command. Every other check
(after a tool, at a new prompt) runs in the background, 0.5 seconds after the last
event, at most one at a time: a tool call or prompt never waits on one, and a burst of
edits costs one check. The line therefore trails an edit by that delay plus the capture
time. Checks never run during rendering or on a filesystem-watcher timer.
An edit made outside the session is only detected at the next check; the line
explicitly says when that check occurred. A restored run starts without a check and
stays without one. Reload also clears cached checks when history is missing or cannot
be read.

The collector needs an existing `python3` and Git on a POSIX host. Nothing is
installed automatically. It uses Python isolated mode and read-only, argv-based
Git commands with hooks/fsmonitor and global/system Git config disabled. Git is
found once on the `PATH` the session inherited, so Homebrew, Nix or `/usr/local`
installs work (falling back to the system default path when `PATH` is unset or empty),
and run by absolute path; a relative `PATH` entry is refused.
System and global config stay off, except that the collector reads back only your
global `core.excludesFile` (else `$XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`)
so editor and OS litter such as `.DS_Store` stays out of scope. A repo's own
`core.excludesFile` takes precedence, as in Git, and an excludes path that is not a
regular file (or a link to one), such as a FIFO or device, is skipped. Each capture has a
1.5-second internal deadline and a 2-second host process timeout.
A capture hashes contents once, then re-lists Git state, re-walks the in-scope
directories and re-checks every file's identity to catch changes made meanwhile.
Limits per capture: 4,096 entries, 64 directory levels, 4 MiB per file, 32 MiB read,
and 512 KiB per Git response. Unsupported or over-budget captures return unknown,
without a partial digest. A nested Git repository inside the worktree is unsupported.
Git runs a fixed handful of times plus one ignore query per directory level that
holds unlisted directories, not one per directory. The worktree-root lookup is capped
at one second. Capture adds bounded latency: two captures around a test (what the
test command waits for), then at most one background check at a time covering up to
three visible worktrees.

Measured with `python3 -I -B plugins/test-board/scripts/source_snapshot.py <root>`
(wall clock, median of 3, macOS, warm cache; before is the previous collector):

| Root | Before | After |
| --- | --- | --- |
| `claude-skills` (1,625 tracked, 354 directories) | unknown, `deadline`, 1.53 s | unknown, `unsupported_file`, 0.15 s |
| a 593-file app repo (45.5 MB) | unknown, `byte_limit`, 1.31 s | unknown, `byte_limit`, 0.17 s |
| a 186-file repo (3.6 MB) | available, 1.41 s | available, 0.25 s |
| a 598-file repo (9.4 MB) | unknown, `deadline`, 1.53 s | available, 0.35 s |
| a 697-file repo (16.9 MB) | unknown, `deadline`, 1.53 s | available, 0.33 s |

The two large roots are unknown for real reasons, not time. `claude-skills` holds
untracked symlinks (`.claude/skills/*`), which are unsupported; its tracked files alone
total 80 MB, over the 32 MiB cap. The 593-file app repo tracks 45.5 MB, over the cap, including two
files of about 4.3 MB over the 4 MiB per-file cap. With the caps lifted for one
measurement only (not a supported setting), a clean checkout of `claude-skills`
(1,727 files, 84.6 MB) completed in 0.50 s and the app repo in 0.30 s, so the time
budget is no longer what limits them. Caps are unchanged.


The scope is Git-tracked files and repository-nonignored untracked regular files.
Identity includes the worktree, HEAD, branch, index entries, paths, executable
bits, and SHA-256 content hashes. It detects staged and unstaged edits, including
same-length changes with restored modification times. File contents and individual
filenames are not stored or logged. Symlinks, special nodes, submodules, nested Git
repositories, assume-unchanged/skip-worktree entries (including sparse checkouts),
unreadable files, or inconsistent scans yield unknown.

These observations are not an atomic snapshot or an attestation. Edit-and-revert
between observations can escape detection. Ignored files, dependencies outside
the scope, environment variables, remote services, and other processes' behavior
are not validated. Source matching does not imply passing tests or a successful
command. Session Compass continues to display test counts; the source line is
currently shown by Test Board only.

## Install

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install test-board@claude-skills
```

## Data

History lives in the plugin's store: the last 10 runs per suite per worktree. When the
store passes a 2 MiB soft cap, the least recently used suites are dropped first.
New runs also retain their before/after source observations (including digests,
root, commit, branch, and aggregate file/byte counts). The latest comparison label
is not persisted: restarting cannot resurrect a previously matching label.
Session Compass reads the latest runs from `test-board.latest` when it is installed.
Update Session Compass to 0.2.2 or later to retain these warnings in its band and pane.
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

This is an observational display, not a test attestation or enforcement gate.
Output can be misleading even when it matches a supported summary format. The
plugin does not independently observe process exits or detect every way output
can be incomplete. Pipelines and wrappers may hide failures from the host itself.
Warnings are never dropped to make space; mandatory content can wrap in a narrow
terminal. This change does not establish which source revision was tested.

## Develop

```
claude --plugin-dir plugins/test-board      # lays .claude-plugin/types (gitignored)
npx -y -p typescript@5.6.3 tsc -p plugins/test-board
claude plugin validate plugins/test-board
claude plugin test plugins/test-board
python3 -B -m unittest discover -s tests/pytest -p 'test_source_*.py' -v
```
