# Session mods — decision log and open API questions

Date: 2026-10-10 · Branch: `feat/session-mods`
Specs: [Test Board](./2026-10-10-test-board-mod-design.md) · [Session Compass](./2026-10-10-session-compass-mod-design.md)

This file records every design question asked while brainstorming the two mods, the
options offered and the user's answer. It also lists what the mod API is confirmed to
do, and what is still unverified and must be tested before or during implementation.

## 1. Origin

The ideas came from 60 days of session history (225 sessions, 99% terminal):

| Signal | Count | Led to |
| --- | --- | --- |
| `xcodebuild test` runs | 93 (21 failed) | Test Board |
| Build/test commands piped through `head`/`tail`/`grep` | 157 of 299 | Pipe Guard (not taken forward yet) |
| Identical commands rerun after a failure | 138 (11 third tries) | Retry Breaker (not taken forward yet) |
| Repos with sessions | about 12, several with multiple worktrees | Session Compass |
| Session lifetime | median under 1 h, p90 72 h | Session Compass |
| `git commit` / `git push` / `gh pr create` | 221 / 168 / 22 | Compass git artifacts |

Notes on the counts:
- The counts come from aggregate scans of `~/.claude/projects/**/*.jsonl`. No message
  text was extracted.
- A 365-day rerun gave nearly the same numbers: almost all retained history is from the
  last 60 days.

## 2. Questions and answers

### Scope

| # | Question | Options offered | Answer |
| --- | --- | --- | --- |
| S1 | Process path | spike / bounded / architectural | **Architectural**: new mods, no existing code. Full path: questions, spec, plan. |
| S2 | One project or two? | combined plugin / two plugins | **Two independent plugins**, one spec each, Test Board first. |
| S3 | Where do specs and plans live? | new `~/projects/claude-mods` repo (first proposal) / claude-skills | **claude-skills**, branch `feat/session-mods`, in a separate checkout at `~/projects/claude-skills-session-mods`, user instruction. The main checkout was left on `feat/portable-artifacts` with its uncommitted work. |

### Test Board

| # | Question | Options offered | Answer |
| --- | --- | --- | --- |
| T1 | Where should the result show after a test run? | band above prompt · toast only · side pane with history · band + pane | **Band above prompt** |
| T2 | Should subagent test runs count? | yes, tagged · main session only · yes, untagged | **Yes, tagged** with the agent's name. The user first picked "main session only" by mistake and corrected it. |
| T3 | Compare against what, across worktrees? | same worktree · same repo, any worktree · both (worktree + main baseline) | **Same worktree.** Each worktree keeps its own history. |
| T4 | Parsing approach | A: cartoon summary + raw fallbacks · B: raw output only · C: shell out to `cartoon logs` | **A** |

### Session Compass

| # | Question | Options offered | Answer |
| --- | --- | --- | --- |
| C1 | Who writes the "what we're building / where we're at" line? | Claude via a status tool · derived facts only · both · background summarizer (Haiku) | **Claude keeps it updated** through a `compass_status` tool |
| C2 | When does it show? | on return + `/compass` command · always-on band · command only | **On return** (resume, or 15+ min idle; next prompt dismisses it) **plus `/compass`** |
| C3 | Which artifacts are listed? (multi-select) | published claude.ai artifacts · files sent with SendUserFile · generated deliverables · git activity | **All four** |
| C4 | Show other sessions too? | yes, in the pane · this session only | **Yes**, as an "All sessions" tab in the pane |

### Delivery

| # | Question | Options offered | Answer |
| --- | --- | --- | --- |
| D1 | Where does plan and build work happen? | new branch off `feat/session-mods` · reset the worktree branch · draft only | **`feat/session-mods`**, worked from the `claude-mods` worktree; its local branch tracks `origin/feat/session-mods` and pushes with `HEAD:feat/session-mods`, because git will not check out one branch in two worktrees |
| D2 | One PR per plugin, or one for both? | one per plugin (recommended) · one for both | **One PR for both**, with a single inventory-count sync |
| D3 | Where do probes U1–U12 run? | one shared probe phase first (recommended) · embedded per plugin | **One shared probe phase first.** Results go into §5 and any fallback is written into the specs before feature code starts |

### Approval gates

| Gate | Status |
| --- | --- |
| Approach A + Test Board design section | Approved |
| Session Compass design section | Approved |
| Written specs (`46bb9aa`) | Approved 2026-10-10, after four review fixes: Test Board `stale` field, a `tsconfig.json` per plugin, Compass `firstPrompt` capture in `prompt.submit`, and `repo` resolved through `--git-common-dir` |
| Implementation plans | Written 2026-10-10: `plans/2026-10-10-session-mods-00-probes.md`, `-01-test-board.md`, `-02-session-compass.md`. **Awaiting user review** |

## 3. Decisions made without a question

These are choices made during spec writing, recorded so they can be challenged:

- **Mod code location:** `plugins/test-board/` and `plugins/session-compass/` in the
  existing claude-skills marketplace.
- **Tests run locally only:** `claude plugin validate`, `tsc -p` and `claude plugin test`.
  CI keeps its manifest check, which already passes for a plugin with no `skills/` folder.
  CI cannot run the TypeScript tests because the runner has no `claude` CLI.
- **Inventory counts:** adding two plugins changes plugin counts across docs and site
  pages, so they are updated in the same PR (AGENTS.md cross-file invariant).
- **Band stacking:** each mod draws its line above whatever `next(e)` returns, so other
  mods' bands (cache-tax, savvy-progress) still show.
- **Test Board limits:** 10 runs per suite per worktree, a 2 MiB soft cap on the store,
  20 failure IDs per run, and up to 3 suites in the band.
- **Session Compass limits:** 50 sessions, 100 artifacts per session, a 15-minute idle
  threshold, a goal of up to 80 chars, and step/next of up to 60 chars.
- **No-goal fallback:** the Compass band shows the first 80 chars of the first prompt,
  marked "(no goal set)".
- **"Deliverable" means** a `Write` of `.html .md .pdf .png .svg` under `.scratch/`,
  `docs/`, `reports/`, `test-checklists/` or a harness scratchpad. Source code never counts.
- **All-sessions row action:** pressing a row copies `claude --resume <id>`.

## 4. Mod API: confirmed

Checked against `claude-code.d.ts` for Claude Code 2.1.296 and the plugin-authoring examples.

| Fact | Where |
| --- | --- |
| A `tool.call` hook can `await next(e)` and read the result; the result holds the tool's output, typed per built-in tool | `ToolCallResult`, types line ~12709 |
| Tool calls carry `agentId` for subagents and teammates; absent on the main loop | `AgentLoop`, types line ~194 |
| Workflow agents and engine forks carry IDs that `$.agent.list()` does not name | same doc comment |
| `agent.spawn` fires per subagent with `description` and `subagentType` | used by savvy-progress `register.tsx` |
| `$.store` persists across sessions, JSON only, 4 MiB total per plugin, with `get/set/delete/keys` | `store`, types line ~3358 |
| `$.state` values survive hot reload; any plugin reads any value, only the owner writes | `state` doc comment |
| `session.start` input is `{ cwd, surface, isInteractive }` with **no resume flag** | `SessionStartInput`, types line ~11679 |
| `$.session.id()`, `cwd()`, `root()`, `repo()`, `turns()`, `messages()` exist | types line ~6894 |
| `$.tool.register`, `$.command.register`, `$.clock.every`, `$.ui.open`, `$.ui.copy` exist | savvy-progress source + types |
| A pane opened by the user seats at any width; one opened unasked needs 144 columns (110 per `$.ui.open` doc) | plugin-authoring skill |
| cartoon test adapters print `summary{total,passed,failed,skipped,duration_s}: …` and `failures[N]{id,loc,msg}:` | cartoon 0.7.0 `docs/design.md` |
| cartoon covers pytest, unittest, jest, vitest, swift-test, xcodebuild-test, cargo-test, go-test, phpunit and rspec | `cartoon adapters` |

## 5. Mod API: unverified

Each item gets a throwaway probe mod (`claude --plugin-dir`) as the first plan task,
before any feature code. Status is updated here as probes run.

| # | Question | Affects | How to verify | Fallback if false | Status |
| --- | --- | --- | --- | --- | --- |
| U1 | Can an `AbovePrompt` hook draw its own tree **above** the tree `next(e)` returns, so several mods' bands stack? | both | Probe with two mods: each returns `<Box flexDirection="column">{mine}{await next(e)}</Box>`; check both lines render | Draw only when `next(e)` has nothing to show, and document it in the README | Open |
| U2 | Does the `tool.call` result for Bash carry the output **after** cartoon's PreToolUse rewrite (TOON), and does `result` expose stdout text? | Test Board | Probe logs `result` keys and the first 200 chars after a cartoon-wrapped `pytest` run | Fall back to raw readers only, or read the archived raw log once via `cartoon logs grep --last` | Confirmed (2026-10-10): `result.stdout`/`text` hold the output of the command as cartoon rewrote it (classic PreToolUse runs beneath plugin hooks). In practice cartoon's net-savings guard passes pytest through raw; no real TOON test summary appears in 60 days of transcripts. Raw readers carry the load; the TOON reader stays. |
| U3 | Do `tool.call` hooks fire for subagent Bash calls (with `agentId` set)? | Test Board `via` | Probe: one Agent dispatch that runs `echo`; log whether the hook saw it | Count main-session runs only, and drop the `via` tag | Confirmed (2026-10-10): a subagent's Bash `tool.call` carries `agentId`, equal to `agent.spawn`'s `next(e).agentId`. |
| U4 | Do Workflow-run agents trigger `tool.call` and `agent.spawn` in the parent session's mods? | Test Board `via workflow`; savvy-progress panel | Probe with a one-agent Workflow | Tag nothing for workflow runs; note it in the README | Confirmed (2026-10-10): a Workflow agent raises `agent.spawn` with `workflow.runId` (`wf_…`) and its Bash calls carry its `agentId`. |
| U5 | Is `$.store` shared across **concurrent** sessions of the same plugin, and do writes to different keys from two sessions both survive? | Compass all-sessions tab | Two terminals, each writing `session:<id>`; read `keys()` from a third | Keep one file per session through `$.fs` under a plugin data dir instead of `$.store` | Confirmed (2026-10-10): two concurrent `claude -p` sessions both wrote `session:<id>` keys into one store; `--plugin-dir` store file is `~/.claude/plugins/store/<name>_inline-<hash>.json`. |
| U6 | Under a race on the shared `index` key, is last-write-wins the only failure (no corruption)? | Compass | Same probe, both sessions updating `index` in a tight loop | Drop `index`; rebuild the list from `$.store.keys()` every read | Confirmed (2026-10-10): 2×50 racing appends left 92 entries, valid JSON: last write wins, no corruption. |
| U7 | Does `$.session.turns()` report earlier turns when a session is **resumed**? | Compass resume band | Probe logs `turns()` in `session.start`, then `claude --resume` | Detect resume via `$.session.messages()` length, or the store already holding `session:<id>` | Confirmed (2026-10-10): `$.session.turns()` in `session.start` read 1 and 2 on `--resume`. |
| U8 | Does the Artifact tool's publish result expose the URL and page title to a `tool.call` hook? | Compass artifact capture | Probe logs the Artifact `result` after one publish | Read the title from the published file's `<title>` via `$.fs.read(input.file_path)`, and the URL from result text by regex | Not run headless: `claude -p` does not offer the Artifact tool. Types show `url` and `title?` on the record; interactive check pending. |
| U9 | Does `prompt.compose` with `scope: 'session'` add the one-line compass reminder without breaking prompt caching each turn? | Compass | Probe adds a static section; compare `cache_read_input_tokens` across two turns | Put the reminder in the tool description only | Confirmed (2026-10-10): with a static `session` section, turn 3 wrote 224 cache tokens and read 71,267. |
| U10 | Does `$.clock.every(60_000)` keep firing while the session is idle with no turn running? | Compass idle band | Probe increments a store counter each tick; idle 3 min | Raise the band on the next `prompt.submit` after a gap (late, but correct) | Open |
| U11 | Does a band set while idle redraw immediately, without user input? | Compass idle band | Same probe sets `$.state` from the timer; observe the terminal | Accept a redraw at the next keypress | Open |
| U12 | Does `$.ui.copy` work in the terminal surface (iTerm2 through herdr)? | Compass pane row actions | Probe copies a string; paste | Show the text selectable instead of copying | Open |
| U13 | Does `$.session.cwd()` follow a Bash `cd` that persisted in the session? `tool.call` carries no cwd. | Test Board `worktreeRoot` | Probe logs `cwd()` after `cd /tmp && echo hi`, then after a bare `pwd` | Track cwd in the mod: apply each command's leading `cd <dir>` to a per-loop cwd seeded from `$.session.root()` | Answered (2026-10-10): `$.session.cwd()` is the cwd the command **started** in (a `cd plugins && …` shows the old cwd; the next command shows `plugins`). A `cd` outside the project is reset by the harness. Read it before `next(e)` and apply the command's leading `cd`. |
| U14 | Can one mod `$.state.get` another mod's value with no `dependencies` entry, and does `claude plugin validate` accept it? | Compass reads `test-board.latest` | probe-b reads probe-a's value in its band; run validate on probe-b | List `test-board` under Compass's `dependencies` | Partly (2026-10-10): `claude plugin validate` accepts the read and lists it as `state of other plugins, not checked`. Runtime read pending (interactive band). |
| U15 | Does a Bash result carry `result.gitOperation` for commit, push and PR? The types say it does. | Compass git capture | Probe logs `gitOperation` after an unpushed empty commit | Parse stdout with regexes (the spec's original `git.ts`) | Confirmed for commit (2026-10-10): `{"commit":{"sha":"f118b26","kind":"committed","branch":"worktree-claude-mods"}}`. Push and PR inferred from types only. |
| U16 | Under `claude plugin test`, which engine calls does the kit answer by itself, and which throw unless a test hook answers? | Every plan 01/02 test that stubs the engine | `tests/kit.test.ts` in probe-a calls each noun with no stub; `claude plugin test` reports which threw | None: the answer sets what the plans stub | Answered (2026-10-10): the kit answers only `$.state`, invalidate and `session.append`. Any other op a hook calls without a stub skips that hook (`… hook was skipped: <plugin>: no implementation for <op>`) and the test still passes unless it asserts an effect; `ui.log` is dropped, not skipped. Stub with `on('<op>', () => ({ value }))` or `mock.store`/`mock.clock`. |

U13 to U16 were added while writing the plans, from the 2.1.296 types. The probes run
as [plan 00](../plans/2026-10-10-session-mods-00-probes.md).

### Plan impact (from the probes run so far)

- **Plan 01 Task 4:** read `$.session.cwd()` before `await next(e)` (U13), then apply the leading `cd`.
- **Plans 01 and 02, every test:** stub each op the hook under test calls (`on('<op>', () => ({ value }))`,
  `mock.store`, `mock.clock`) and assert an effect; a missing stub skips the hook silently (U16).
- **Plan 01 Task 2:** the real-output capture step uses `.scratch/session-mods-probe/pyfail` (`3 failed, 40 passed,
  1 skipped`); the cartoon TOON fixture stays hand-written from cartoon's documented format (U2).
- **Both plans:** a `types/index.d.ts` contract may export only types; a bare `export {}` fails validate.
- U1, U8, U10, U11, U12 and U14 (runtime) are pending an interactive session; plan 01 Task 5 (band) and plan 02
  Tasks 3–6 re-check this list before starting.

## 5a. Plan-time deviations from the specs

Found while writing plans 01 and 02. Each is written into the plan as a deliberate
deviation; the user reviews them with the plans.

**Test Board (plan 01)**
- Raw readers run only when the command matches the test-command pattern, so `cat pytest.log`
  is not counted. The cartoon summary reader still runs for any command.
- Background-moved runs (no output yet) record nothing.
- When one suite runs twice in a turn, `latest` keeps only the newest run.
- Adds `hooks/format.ts` (band text, arrows, narrow-terminal drops). `register.test.ts` becomes `.tsx`.

**Session Compass (plan 02)**
- The model sees the tool as `mcp__session-compass__compass_status` (mod tools are listed as
  `mcp__<plugin>__<name>`). It is registered with `isDeferred: false` so its schema is in the tool list from turn one.
- Git artifacts come from the Bash result's structured `gitOperation`. The commit subject still
  comes from the `[<branch> <sha>] <subject>` stdout line, and the push remote from the `To <remote>` line
  (default `origin`). This depends on U15.
- `repo` is the basename of `$.session.repo().root`, which the engine documents as the main
  working tree's root. This matches the amended spec's `--git-common-dir` intent.
- Copy buttons take the surface from the render event, because `command.run` carries no surface.
- A hot reload fires `session.start` again, so `turns() > 0` raises the return band after each
  reload during development. This is accepted.
- The whole no-goal band line is dimmed, not only the goal part.
- When a store write fails, the trim to 50 artifacts per session rewrites other sessions' records (`trimOthers`).

**Both**
- `tsc` is not installed on the machine. Gates run `npx -y -p typescript@5.6.3 tsc`. Plan 02 also
  type-checks after each task through a gitignored `.scratch/tsc` config that points at the skill's
  declaration file, before the first `--plugin-dir` load.

## 6. Not taken forward (yet)

Suggested from the same history scan and left for later, at the user's call:

- **Pipe Guard:** block or strip `| head|tail|grep` on noisy build/test commands.
- **Retry Breaker:** stop an unchanged third attempt after two failures.
- **Dispatch Contract:** hold an Agent dispatch until its prompt states commit permission
  (46 of 129 non-security dispatches lacked one).
- **Ship Board:** branch, unpushed commits, PR and CI status pane.
- **token-weather / image-peek:** existing mods, install-only.
