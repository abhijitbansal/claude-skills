# Cache Clock issue #60 fix, plus repo review follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issue #60 (cache-clock guard gaps) in one PR, ship it to users with a release tag, and queue the other review findings as separate topic PRs.

**Architecture:** Cache Clock's send guard is `decide()` in `tools/cache-clock/extension/lib/guard.mjs`, called from `onPrompt`/`checkPrompt` in `extension/lib/wiring.mjs`. The fix replaces the two `NOT_A_PROMPT` checks with one prompt classifier and makes unpriced cold sends warn per episode. It also writes every settings file owner-only. All logic stays pure and is tested on the fake host in `test/helpers/fake-host.mjs`.

**Tech Stack:** Node 24 ESM, `node:test`, no dependencies. Run from `tools/cache-clock`: `node --test "test/*.test.mjs"` (baseline on `main` 167244da: 358/358 pass, measured 2026-11-20).

**Spec:** GitHub issue #60 (`gh issue view 60`), plus this review's findings below.

## Global Constraints

- No new dependencies. The extension runs inside Copilot's runtime.
- After any edit under `extension/`, run `node tools/cache-clock/bin/checksums.mjs --write`. The tests fail on a stale list.
- The one-line install is pinned to the tag `cache-clock-v1.1.0` (`install.sh:15`, `README.md:23,32,44`). `git tag -l 'cache-clock-*'` returned nothing on 2026-11-20, so today the piped install answers 404 for everyone.
- Never borrow another model's price. That is an existing guard invariant (`format.mjs:187`).
- Commit trailer: exactly `Co-Authored-By: Claude <noreply@anthropic.com>` (AGENTS.md).

## Evidence status

- **Orchestrator-confirmed** means read in source on `main` 167244da this session, with the line given.
- **Reviewer-reported** means it came from the find-only review workflow (4 Opus reviewers, no verify stage) and is not yet verified. Each task's first step is a failing test, and that test is the verification.
- The digest below covers only HIGH and MEDIUM findings. The LOW findings (about 60 across the four areas) are not listed here.

## Review Focus

1. **A model-backed slash command on a cold, priced cache** (`/some-skill`, `/compact`, any `/x` in `copilot -p`). Expected: refuse or warn, not a silent rewrite. Pinned in Task 1.
2. **Two separate cold, unpriced episodes on the same model.** Expected: each one warns. Today the dedupe is per selection only. Pinned in Task 2.
3. **An existing `~/.copilot/cache-clock` created 0755 by an older version.** Expected: tightened to 0700 on the next save. `mkdirSync` mode does not touch an existing dir. Pinned in Task 3.
4. **A `/skill` turn starting within the keep-warm tail window.** Expected: its usage is booked as a user call, not ping spend. Pinned in Task 1.
5. **`CACHE_CLOCK_HOME` pointing at a shared dir** (for example `$HOME`). Expected: only cache-clock's own files get chmod'ed, never the dir itself unless cache-clock created it. Pinned in Task 3.

---

## Part A — PR 1: `fix/cache-clock-issue-60`

### Task 0: Probe the real host (blocks Task 1's design only)

The suite runs on a fake host, so 358 passing tests cannot show what Copilot passes to `onUserPromptSubmitted`.

- [ ] **Step 1:** In an interactive `copilot` session with the extension linked (`sh tools/cache-clock/install.sh`), add a temporary `say(JSON.stringify(input?.prompt))` at the top of `onPrompt` (`wiring.mjs:318`). Type `/model`, `/clear`, `/compact`, `/help`, one installed skill command, and `/cache-clock status`. Repeat `copilot -p "/help"`.
- [ ] **Step 2:** Record which commands reach the hook, and whether `session.abort()` stops a skill command. Write this into the PR body. Revert the temporary line.
- [ ] **Decision rule:**
  - If no built-in reaches the hook, Task 1 drops the slash exemption entirely and keeps only `!` and the in-flight ping.
  - If built-ins do reach it, Task 1 uses the local-command allowlist below, and an unknown `/name` is guarded.
  - If no real host is available, take the allowlist design (guard by default) and mark the PR "host behavior unverified".

### Task 1: One prompt classifier; guard model-backed slash commands

**Files:**
- Modify: `tools/cache-clock/extension/lib/guard.mjs:12-18`
- Modify: `tools/cache-clock/extension/lib/wiring.mjs:318-330` (orchestrator-confirmed: the second `NOT_A_PROMPT` check at :326 returns before `promptPendingUntil` and `promptSinceSend` are set at :329-330)
- Modify: `tools/cache-clock/extension/lib/format.mjs:183` (HELP line), `tools/cache-clock/README.md:160,447`
- Test: `tools/cache-clock/test/clock-guard.test.mjs:136-142`, `tools/cache-clock/test/wiring.test.mjs`

**Interfaces:**
- Produces: `export function classifyPrompt(text: string, { interactive: boolean }): "shell" | "local-command" | "prompt"` in `guard.mjs`.
- Produces: `export const LOCAL_COMMANDS: ReadonlySet<string>`, the command names without the slash. Start from the Task 0 results. The default if unprobed is `help, clear, model, exit, quit, experimental, resume, cwd, add-dir, login, logout, usage, session, theme, cache-clock`. `compact` is never in it (owner decision 1).
- `decide({ snap, prompt, config, refusedKey, busy, interactive = true })` gains `interactive`. It returns `allow` only for `classifyPrompt(...) !== "prompt"`.
- Removes: `NOT_A_PROMPT` (both call sites).

- [ ] **Step 1: Write failing tests** in `clock-guard.test.mjs`:
  - `decide guards a model-backed skill command on a cold priced snapshot`: `decide({ snap: coldSnap, prompt: "/some-skill do x", config: cfg }).action === "refuse"`.
  - `decide guards any slash text in -p mode`: `decide({ snap: coldSnap, prompt: "/help", config: cfg, interactive: false }).action === "refuse"`.
  - `decide still allows local commands and shell escapes`: `/model claude-sonnet-5.5`, `/cache-clock status` and `!ls` each give `"allow"`.
  - Change the assertion at :142 so that `/compact` on `coldSnap` gives `"refuse"`.
  - In `wiring.test.mjs`, add `a /skill prompt marks a turn pending before any exemption`: after `onPrompt({prompt:"/some-skill x"})`, `state.promptPendingUntil > now`. Local commands (`/model`) are not marked pending, so they never count as a user turn for keep-warm (or the observable equivalent: keep-warm does not ping before the turn starts).
- [ ] **Step 2:** Run `node --test test/clock-guard.test.mjs test/wiring.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `classifyPrompt` and `LOCAL_COMMANDS`. Call it once in `onPrompt`, after setting `promptPendingUntil` and `promptSinceSend`, and pass `interactive`. Do not derive it from `canAsk` (`wiring.mjs:146`): that checks for elicitation UI, not `-p` mode, and an interactive host without elicitation would then guard `/help`. Detect `-p` mode from what Task 0 finds the host exposes; if nothing distinguishes it, guard slash text only when it is not in `LOCAL_COMMANDS`, in both modes. Keep the pasted-path rule: `/etc/hosts is broken` is a prompt.
- [ ] **Step 4:** Update the HELP line, README:160 and the "What is never guarded" item in `docs/features/cache-clock.html` to "Local commands (`/model`, `/clear`, …) and `!` shell escapes are never guarded; skill commands are." Update README:447 to say `-p` guards slash text too.
- [ ] **Step 5:** Run the full suite and `node bin/checksums.mjs --write`. Expected: all pass.
- [ ] **Step 6: Commit** `fix(cache-clock): guard model-backed slash commands (#60)`.

### Task 2: Unpriced cold sends warn, once per episode

**Files:**
- Modify: `tools/cache-clock/extension/lib/guard.mjs:22` (orchestrator-confirmed: `snap.extraUsd === null` returns `allow`)
- Modify: `tools/cache-clock/extension/lib/format.mjs:52-56` (`coldWarn`, which the reviewer ran and saw render `for ? (warm: ?)` for this case)
- Modify: `tools/cache-clock/extension/lib/wiring.mjs:344-351` (`alreadyWarnedUnknown`, keyed on `JSON.stringify(state.selection)` only)
- Test: `tools/cache-clock/test/clock-guard.test.mjs`, `tools/cache-clock/test/unknown-price-dedupe.test.mjs`

**Interfaces:**
- `decide` returns `{ action: "warn", key: episodeKey(snap), unpriced: true }` for `state === "cold" && !snap.reason && snap.extraUsd === null`.
- `coldWarn(snap)` for that case returns exactly: `cache-clock: ${displayName}: the cache went cold and no price is known for this model, so no price-based guard was possible. Sending.`
- The dedupe key becomes `JSON.stringify(state.selection) + "|" + (snap.reason ?? episodeKey(snap))`.

- [ ] **Step 1: Write failing tests:**
  - `decide warns on a cold unpriced snapshot`: `{...coldSnap, prices:null, extraUsd:null, coldUsd:null, warmUsd:null}` gives `action === "warn"`.
  - `coldWarn names the missing price for a cold unpriced snapshot`: matches `/no price-based guard was possible/` and does not contain `?`.
  - In `unknown-price-dedupe.test.mjs`: `two cold unpriced episodes on one selection warn twice`. Keep the three existing tests unchanged: the unknown-selection warning still dedupes per selection, because its key is `reason`.
- [ ] **Step 2:** Run those two files. Expected: the new tests FAIL and the existing ones pass.
- [ ] **Step 3:** Implement the three changes above.
- [ ] **Step 4:** Run the full suite and checksums `--write`. Expected: all pass.
- [ ] **Step 5: Commit** `fix(cache-clock): warn on unpriced cold sends once per episode (#60)`.

### Task 3: Owner-only settings files, including existing installs

**Files:**
- Modify: `tools/cache-clock/extension/lib/config.mjs:99-115` (`saveConfig`; orchestrator-confirmed that it has no mode and a pid-named tmp without `wx`)
- Modify: `config.mjs:150-158, 245, 265, 298` (refusals and keepwarm dirs, which already pass a mode but never tighten an existing dir)
- Test: `tools/cache-clock/test/format-config.test.mjs`

**Interfaces:**
- Produces: `function writePrivate(dir: string, name: string, text: string): void`. It creates `dir` with `0o700`, writes `${name}.${process.pid}.${randomUUID()}.tmp` with `{ flag: "wx", mode: 0o600 }`, renames into place, and removes the tmp in `finally`.
- Produces: `function tightenOwnDir(dir: string): void`. It runs `chmodSync(dir, 0o700)` only when `dir === configDir(env)`'s default path (`…/.copilot/cache-clock`) or `basename(dir)` is `refusals` or `keepwarm`. An explicit `CACHE_CLOCK_HOME` gets its files tightened, never the dir itself (Review Focus 5). It skips silently if the dir is not owned by `process.getuid()`.
- `saveConfig`, `saveRefusal` and the keepwarm writers use `writePrivate`.

- [ ] **Step 1: Write failing tests** (skip on `process.platform === "win32"`):
  - `saveConfig writes config.json 0600 in a 0700 dir`: `statSync(file).mode & 0o777 === 0o600`, and the same for the dir with `0o700`.
  - `saveConfig tightens an existing 0755 default dir`: pre-create with `mkdirSync(dir, {mode:0o755})`, save, expect `0o700`.
  - `saveConfig never chmods an explicit CACHE_CLOCK_HOME`: a dir at `0o755` stays `0o755`, and `config.json` is `0o600`.
- [ ] **Step 2:** Run `node --test test/format-config.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `writePrivate` and `tightenOwnDir`, and route the writers through them.
- [ ] **Step 4:** Run the full suite and checksums `--write`. Expected: all pass.
- [ ] **Step 5: Commit** `fix(cache-clock): write settings owner-only and tighten old dirs (#60)`.

### Task 4: Pure usage attribution, then fix ping/user misattribution

**Files:**
- Create: `tools/cache-clock/extension/lib/attribution.mjs`
- Modify: `tools/cache-clock/extension/lib/wiring.mjs:505-525` (the `assistant.usage` handler)
- Modify: `tools/cache-clock/extension/lib/keepwarm.mjs` around `releaseOwnership` (`:363`) and `bookPing`/`persist` (`:615`, `:636`)
- Test: create `tools/cache-clock/test/attribution.test.mjs`; extend `test/wiring-keepwarm.test.mjs`

**Interfaces:**
- Produces: `export function attributeUsage({ awaiting, inFlight, pingOwed, turnSource, promptSinceSend, hostReportsUserMessage }): { owner: "ping" | "user", spendsTypedPrompt: boolean }`. It is pure. `wiring.mjs` calls it and keeps the side effects: `fileKeepWarmPing`, `clock.ingest`, and the flag resets.

- [ ] **Step 1: Write the table test first, matching today's behavior.** Add one row per branch of the current condition at `wiring.mjs:513-516`. Run it with the function extracted and no behavior changed. Expected: PASS. This is the refactor's safety net.
- [ ] **Step 2: Commit** `refactor(cache-clock): extract usage attribution into a pure function`.
- [ ] **Step 3: Write failing tests:**
  - attribution row: `while a ping is in flight on a host without user.message, the first record goes to the ping even if the user typed`. `{awaiting:true, inFlight:true, promptSinceSend:true, hostReportsUserMessage:false, turnSource:null}` gives `owner: "ping"`.
  - wiring: `a /skill turn's usage within the tail window is a user call`. This builds on Task 1's pending flag: after `onPrompt({prompt:"/some-skill"})`, a usage event during `awaitingReply` is ingested into the tally, not filed as ping spend.
  - keepwarm: `releaseOwnership clears late and tail attribution`. After release, `status().awaitingReply === false`.
  - keepwarm: `bookPing with no window books nothing and persists nothing`.
- [ ] **Step 4:** Run those files. Expected: the new tests FAIL.
- [ ] **Step 5:** Implement. In `attributeUsage`, `inFlight` without `hostReportsUserMessage` takes the ping branch first. `releaseOwnership` resets `lateQueue`, `lastPing` and `tailUntil`. `bookPing` returns early when there is no window.
- [ ] **Step 6:** Run the full suite and checksums `--write`. Expected: all pass. **Commit** `fix(cache-clock): attribute ping and user usage correctly`.

### Task 5: Keep-warm lock staleness, heads-up, ledger growth

**Files:**
- Modify: `tools/cache-clock/extension/lib/config.mjs:170-180` (`pidAlive`) and `:255-285` (`lock()`; orchestrator-confirmed that a lock is stale only when its pid is gone, so a reused pid never lets it go)
- Modify: `tools/cache-clock/extension/lib/wiring.mjs:229-232` (`keepWarmWillPing`; orchestrator-confirmed that `passive === true` silences the heads-up whether or not the holder pings)
- Modify: `tools/cache-clock/extension/lib/keepwarm.mjs:253` (`dailySummary`) and `config.mjs:296-300, 356-375` (ledger append and compaction)
- Test: `test/keepwarm-store.test.mjs`, `test/wiring-keepwarm.test.mjs`, `test/keepwarm.test.mjs`

**Interfaces:**
- Constants in `config.mjs`: `LOCK_HEARTBEAT_MS = 10 * 60 * 1000`, `LOCK_STALE_MS = 30 * 60 * 1000`, `LEDGER_COMPACT_BYTES = 64 * 1024`.
- `lock()` refreshes the lock file's mtime (`utimesSync`) whenever it confirms ownership. It treats a holder whose mtime is older than `LOCK_STALE_MS` as stale, even when its pid is alive. The keep-warm store refreshes the lock every `LOCK_HEARTBEAT_MS` while it holds it, through the injected `timers` (no real timers in tests).
- The holder records `willPing: boolean` in the shared window file whenever it plans. `status()` in a passive process exposes `holderWillPing` read from that file. `keepWarmWillPing()` returns `status.willPing === true || (status.passive === true && status.holderWillPing === true)`.
- Ledger: after an append, compact under the lock when the file is larger than `LEDGER_COMPACT_BYTES`. `dailySummary` is cached in memory and invalidated on every append. Compaction writes a `wx` tmp with a UUID and renames it (no size-check-then-rename TOCTOU).

- [ ] **Step 1: Write failing tests:**
  - `a live pid holding a lock whose heartbeat is older than LOCK_STALE_MS is taken over`. Write a lock with `process.pid` of another live process (for example `process.ppid`) and set its mtime back 31 min. Expected: `lock() === true`.
  - `the holder's heartbeat keeps a live lock from being taken over`. Advance the fake clock 25 min with heartbeats firing. Expected: another store's `lock() === false`.
  - `a passive process shows the heads-up when the holder will not ping`. The holder's window has `willPing:false`. Expected: the heads-up is said.
  - `a passive process stays quiet when the holder will ping`.
  - `the ledger compacts once it passes 64 KiB, and the daily summary is unchanged by compaction`.
- [ ] **Step 2:** Run those files. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement against the interfaces above. Update README:281-283 to describe the heads-up rule.
- [ ] **Step 4:** Run the full suite and checksums `--write`. Expected: all pass. **Commit** `fix(cache-clock): stale-lock heartbeat, holder-aware heads-up, bounded ledger`.

### Task 6: Release, so the fix reaches users

- [ ] **Step 1:** Change every pin of `cache-clock-v1.1.0` to `cache-clock-v1.2.0` (owner decision 2): `REF` in `install.sh:15`, the curl lines at `README.md:23,44` and the tag named at `README.md:32`, the curl line and its `data-copy` in `docs/features/cache-clock.html:93,95`, and the install line in `docs/features/showcase/cache-clock/how-it-works.html:499-500`. Then confirm with `grep -rn cache-clock-v1.1.0` that nothing is left. Run `node bin/checksums.mjs --write`, then the full suite, then `shellcheck tools/cache-clock/install.sh`.
- [ ] **Step 2: Commit** `chore(cache-clock): pin install to <tag>`. Push and open the PR. The body uses the bug-fix four lines (symptom, root cause, fix, failing test), plus the Task 0 host results. It says `Fixes #60`.
- [ ] **Step 3:** Before the first push, run a fresh-context `/code-review` on the diff. Then check CI with `gh pr checks <N>`. The owner merges (`gh pr merge <N> --squash --admin`) and creates the tag on the merge commit.

---

## Part B — follow-up topic PRs (one branch each, after PR 1)

Ranked by risk, then code surface. Each item starts with a failing test or a reproducing command. "Confirmed" means the orchestrator read the code; everything else is reviewer-reported.

### PR 2 `fix/setup-exit-codes` — small surface, high impact (every machine bootstrap)
- **Confirmed** `setup/setup.sh:111-118`: the `| while` subshell loses `WARNS`/`FAILS` increments (counters at :50-57), so failed installs exit 0. `tests/bats/setup.bats:51-57` asserts exit 0, and its `claude` mock never fails. Fix with process substitution `done < <(...)`, plus a bats test whose mock fails.
- **Confirmed** `setup/contribute.sh:4`: `BASH_SOURCE` resolves to the `~/.local/bin` symlink's directory, so `source _lib.sh` fails for `claude-skills-contribute`. That breaks the contribute and learn-lesson skills. Fix: resolve the link (`realpath`).
- Reviewer-reported: `run_step || true` plus unchecked `parse_toml` exit codes mean a bad TOML still exits 0 (`setup.sh:306`). `--only` always exits 0 (:61). `python_check` compares versions as floats, so 3.9 passes (`_lib.sh:45`). `grep -w` matches `linear` inside `linear-pm` (:136). `--skill`/`--plugin` are unsanitised in `contribute.sh:84`.

### PR 3 `ci/mods-and-coverage` — CI only, no runtime risk
- Reviewer-reported: no CI job runs the mods' `tsc` or `claude plugin test`. test-board's local `tsc` is red on `main` (6 errors in `plugins/test-board/tests/source-register.test.tsx`). shellcheck covers 23 of 46 tracked `.sh` files (`test.yml:39`). cache-clock tests run on Ubuntu only. The commit-trailers check passes on an empty merge base (`test.yml:76`). `plugin_version_guard.py:49` misses renames.

### PR 4 `fix/ios-dev-config` — affects every `/release`
- **Partly confirmed** `plugins/ios-dev/skills/_lib/load_app_config.sh:51`: the PyYAML branch runs `print(val)`, which prints `True`, while `validate_app_config.sh:68` accepts only `true`/`false`. When PyYAML is installed, the `encryption_exempt: true` that `/ios-init` writes fails preflight. Not yet run end to end.
- Reviewer-reported: `bump_version.sh:43` rewrites `1.2` as `1.2.0`. The `deploy-site.sh` template force-pushes without the CNAME guard (`site-pages-deploy-kit/templates/deploy-site.sh:39`). `release.sh:204` uses paths relative to the current directory.

### PR 5 — moved into PR 1 as Tasks 4 and 5 (owner decision 3)

### PR 6 `fix/second-wind` and PR 7 `fix/mods-robustness`
- second-wind (reviewer-reported):
  - `wind.py:40` auto-loads `./second-wind.json` from the current directory, and that config runs commands. This is a trust issue: move it behind an explicit flag.
  - The clock-time reset is dated 24 h ahead (`wind.py:1114`).
  - The dashboard token is served on `GET /` (`wind.py:1392`).
  - The `WIND_HOME` override is broken (`install.sh:77`).
- Mods (reviewer-reported):
  - test-board records any command that prints a Cartoon summary as a test run (`hooks/parse.ts:206`).
  - `dropOrphans` deletes other sessions' history (`hooks/register.tsx:218`).
  - Control characters are not stripped from rendered text (`register.tsx:525`).
  - session-compass `compass_status` can answer "busy" while its write still lands (`register.tsx:378`).
- prompt-craft (reviewer-reported): the advisor fills slots alphabetically (`scripts/advisor.py:135`). Profile names do not match the registry's namespaced names (`learn_history.py:61`). A single global registry is shared across repos (`build_registry.py:237`).

## Owner decisions (answered 2026-11-20)

1. **`/compact` on a cold cache:** guard it. It is not in `LOCAL_COMMANDS`, and the test at `clock-guard.test.mjs:142` flips to `refuse`.
2. **Release tag:** bump to `cache-clock-v1.2.0`.
3. **PR scope:** fold the keep-warm fixes into PR 1 (Tasks 4 and 5 in Part A; Part B's PR 5 is moved there).
4. **Execution:** subagent-driven. Sonnet implementer at `effort: high` per task, Opus reviewer at medium per task, a whole-branch review before push.
