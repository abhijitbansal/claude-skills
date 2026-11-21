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
- Produces: `export const LOCAL_COMMANDS: ReadonlySet<string>`, the command names without the slash. Start from the Task 0 results. The default if unprobed is `help, clear, model, exit, quit, experimental, resume, cwd, add-dir, login, logout, usage, session, theme, cache-clock`. `compact` goes in only if the owner decides to keep it exempt (see the decisions below).
- `decide({ snap, prompt, config, refusedKey, busy, interactive = true })` gains `interactive`. It returns `allow` only for `classifyPrompt(...) !== "prompt"`.
- Removes: `NOT_A_PROMPT` (both call sites).

- [ ] **Step 1: Write failing tests** in `clock-guard.test.mjs`:
  - `decide guards a model-backed skill command on a cold priced snapshot`: `decide({ snap: coldSnap, prompt: "/some-skill do x", config: cfg }).action === "refuse"`.
  - `decide guards any slash text in -p mode`: `decide({ snap: coldSnap, prompt: "/help", config: cfg, interactive: false }).action === "refuse"`.
  - `decide still allows local commands and shell escapes`: `/model claude-sonnet-5.5`, `/cache-clock status` and `!ls` each give `"allow"`.
  - Replace the assertion at :142 (`/compact` gives allow) with the owner's decision.
  - In `wiring.test.mjs`, add `a /skill prompt marks a turn pending before any exemption`: after `onPrompt({prompt:"/model x"})`, `state.promptPendingUntil > now` (or the observable equivalent: keep-warm does not ping before the turn starts).
- [ ] **Step 2:** Run `node --test test/clock-guard.test.mjs test/wiring.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `classifyPrompt` and `LOCAL_COMMANDS`. Call it once in `onPrompt`, after setting `promptPendingUntil` and `promptSinceSend`, and pass `interactive` from the host's `canAsk` capability. Keep the pasted-path rule: `/etc/hosts is broken` is a prompt.
- [ ] **Step 4:** Update the HELP line and README:160 to "Local commands (`/model`, `/clear`, …) and `!` shell escapes are never guarded; skill commands are." Update README:447 to say `-p` guards slash text too.
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

### Task 4: Release, so the fix reaches users

- [ ] **Step 1:** Change `REF` in `install.sh:15` and the three README curl lines to the release tag the owner picks (decision below). Run `node bin/checksums.mjs --write`, then the full suite, then `shellcheck tools/cache-clock/install.sh`.
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

### PR 5 `fix/cache-clock-keepwarm` — medium surface (keepwarm.mjs and wiring.mjs)
- Reviewer-reported:
  - The heads-up is silenced whenever another process holds the lock, even with no ping planned (`wiring.mjs:232` vs README:281-283).
  - pid reuse makes a stale lock permanent (`config.mjs:172`): add a start-time or heartbeat check.
  - `releaseOwnership` keeps the late/tail attribution state (`keepwarm.mjs:363`).
  - The ledger grows without bound (`keepwarm.mjs:253`).
  - A prompt typed during an in-flight ping steals its usage (`wiring.mjs:513`).
- Structural: extract usage attribution (`wiring.mjs:509-519`) into a pure, table-tested function first, then fix the items above against that table.

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

## Owner decisions (asked up front)

1. **`/compact` on a cold cache:** guard it (it is a model call over the whole context) or keep it exempt as documented today.
2. **Release tag:** `cache-clock-v1.1.0` was never created. Either create it with this fix, or bump to `cache-clock-v1.2.0`.
3. **PR scope:** #60 alone in PR 1 (planned), or fold PR 5's keep-warm items into it.
