# Second Wind — Full-auto default, accept-all init, add-repo, settings inheritance — Design

**Date:** 2026-07-01
**Status:** Approved (user approved design in session; build authorized on `feat/second-wind-enhancements`)
**Branch:** `feat/second-wind-enhancements`

## Background

Second Wind 2.0 ships `wind` (`tools/second-wind/wind.py` + `dashboard.html`)
with a `wind init` wizard, a `wind watch` resume engine, and a localhost
`wind dash`. Four friction points surfaced in real use (the user's words,
paraphrased):

1. **Auto mode by default.** The permission presets only reach as far as
   `acceptEdits`; there's no full-auto ("accept everything") option, and
   full-auto isn't the default.
2. **Accept defaults for all repos.** `wind init` makes you click through
   per-repo permission / agent / prompt-file prompts for *every* selected repo,
   even when you just want the defaults everywhere.
3. **Add repos without re-init.** You can't bring a new repo under management
   without re-running `wind init`; the dashboard can't surface repos that were
   scanned but not initially picked, and there's no quick CLI add.
4. **Respect Claude settings/hooks at launch.** The user has `~/.claude/settings.json`
   defaults (effort high, remote control) and SessionStart hooks and wants them
   respected when `wind up` launches `claude`.

This design was grounded by a parallel code-mapping pass (one agent per feature)
against `wind.py`, `dashboard.html`, `README.md`, and `tests/test_wind.py`, then
cross-checked against a direct read of the same paths. Findings below are
anchored to `file:line`.

## Decisions (from the design Q&A)

- **F1:** Add a full-auto preset **and** make it the shipped **config default**
  (starter / `DEFAULT_CONFIG`). The wizard still makes you actively pick a preset
  (no menu-preselect change).
- **F2:** "Accept defaults for all" means: pick **one** permission preset once,
  applied to every selected repo with zero per-repo clicks (agent=`claude`, no
  prompt files). Delivered as one in-wizard menu choice.
- **F3:** Adding a repo (CLI + dashboard) **also launches** its session
  immediately.
- **F4:** The user's settings live in `~/.claude/settings.json` → already
  inherited. Verify with a regression test + document; no launch code change.

---

## F1 · Full-auto permission preset, as the shipped default

**Current state.** `PERMISSION_PRESETS` (wind.py:396-402) offers exactly four
choices: `acceptEdits` → `--permission-mode acceptEdits`, `plan` →
`--permission-mode plan`, `default` → `""`, `custom` → free-form. No full-auto
preset; the only way to full bypass today is typing it under "custom". The
shipped default is empty: `DEFAULT_CONFIG["claude_args"] = ""` (wind.py:87).
README:252-253 explicitly promises Second Wind does **not** default to full
bypass.

**Design.**

- Append one tuple to `PERMISSION_PRESETS` at **index 4** (after `custom`) so the
  existing indices 0–3 stay stable and no index-based wizard test breaks:
  `("auto — accepts everything, no prompts (full bypass)", "--permission-mode bypassPermissions")`.
- Use `--permission-mode bypassPermissions` (convention-consistent with the other
  presets), **not** `--dangerously-skip-permissions`.
- Flip `DEFAULT_CONFIG["claude_args"]` (wind.py:87) from `""` to
  `"--permission-mode bypassPermissions"`. This changes the **starter config**
  (`wind init --defaults` / non-TTY init via `write_starter_config`, wind.py:1477)
  and the top-level fallback in `resolve_agent` (wind.py:421).

**Back-compat.** Wizard-written configs always carry an explicit top-level
`claude_args` (from the user's pick, via `build_config(...claude_args=global_args)`,
wind.py:622-628/763), so **existing wizard configs are unchanged**. Only brand-new
starter configs — and any config that omits the `claude_args` key and relies on
`DEFAULT_CONFIG` merge — adopt full-auto. `resolve_agent` resolves `claude_args`
by key-**presence**, so an explicit `""` still means "no args".

**No resolver/launch changes.** The preset string flows unchanged through
`pick_permission_preset` (wind.py:405) → `resolve_agent` (wind.py:421) → `cmd_up`
(wind.py:1512-1515), which builds `command = cmd + (" " + args if args else "")`.

**Docs.** Reverse the README:251-253 / 291-294 security stance and the SKILL.md
permission notes: full-auto is now the default; state plainly what that means
(same risk class as `--dangerously-skip-permissions`) and how to opt back to a
safer preset.

**Tests.** Add a wizard test exercising the new preset index; existing launch
tests (test_wind.py:1044-1070) set `claude_args` explicitly and are unaffected by
the `DEFAULT_CONFIG` change.

---

## F2 · Accept defaults for all selected repos

**Current state.** `run_wizard` (wind.py:658-778): after the repo `multiselect`
(678) and the single global-preset pick (700), a per-repo loop (705-751) asks,
**per repo**: a permission override select, an agent select, a prompt-file text
prompt, and (if a prompt file is given) an "open in editor" select. Even to accept
defaults, each repo costs ≥3 interactions; N repos = 3N prompts. The existing
`--defaults` flag is unrelated — it bypasses the whole wizard (no scan, no
multiselect) and dumps a placeholder `example-repo` (wind.py:1477-1483).

**Design.**

- Insert one `select` right after the global-preset step (after wind.py:704,
  before `repos = []`): *"Configure each repo individually"* vs *"Apply the global
  preset + defaults to all selected repos."* Follow the existing quit/None-cancel
  convention.
- Accept-all path:
  `repos = [build_repo_entry(n, p, "", "", override=False, agent="claude") for n, p in chosen]`,
  then skip the per-repo loop. Nothing after line 752 changes: `build_config`
  already writes the global preset top-level, and the summary loop already prints
  "inherits global" for keyless entries.
- Entries must stay minimal `{name, path}` (no `claude_args`/`agent`/`prompt_file`)
  so key-presence resolution inherits the top-level global preset.

**Tests.** Add a `WizardHarness` case driving the accept-all branch with a 2+ repo
multiselect, asserting each `cfg["repos"]` entry is exactly `{name, path}` and
`cfg["claude_args"]` equals the chosen global preset. The inserted select shifts
downstream indices, so **all existing wizard-driving tests must be updated in
lockstep** (this is the main blast radius; test_wind.py:826/856/908/936…).

---

## F3 · Add a repo without re-init (`wind add` + dashboard), with launch

**Current state.** Scan roots are **never persisted**: `run_wizard` collects
`roots` (wind.py:666), calls `scan_repos(roots.split(","))` (668), writes only the
picked repos, and discards the roots + unpicked candidates. `DEFAULT_CONFIG` has
no scan-roots field. The dashboard renders only `cfg["repos"]` (`status_payload`,
wind.py:1194; `dashboard.html` render, 1019). No `wind add` subcommand; no
add/scan endpoint. `scan_repos` (wind.py:496) is cheap, pure, stdlib-only.

**Design.**

*Persist roots (not results).*
- Add `"scan_roots": []` to `DEFAULT_CONFIG` (wind.py:84). `load_config` already
  merges `DEFAULT_CONFIG`, so old configs get `[]` harmlessly.
- In `run_wizard`, set `cfg["scan_roots"]` to the cleaned roots before the write
  (wind.py:763-764), or thread through `build_config`.
- Re-scan on demand with the existing `scan_repos()` — never cache stale result
  lists.

*CLI `wind add <path>`.*
- New subparser in `main()` (wind.py:1904) + `cmd_add(cfg, args)`.
- Validate the path is an existing **git** dir → derive `name = basename` →
  validate it as a safe single path component (reuse `_prompt_path`'s guard,
  wind.py:558) → reject duplicate name/path and the reserved watcher-session-name
  collision → re-read the **RAW** config from `cfg["_path"]`, append
  `build_repo_entry(name, path, "", "", override=False)`, `atomic_write_json(...,
  mode=0o644)` (mirror the `cmd_prompt` pattern, wind.py:1641-1651).
- Then **launch** that one repo: mirror `cmd_up`'s `tmux new-session -d -s NAME -c
  PATH` + send-command, and ensure the watcher is running.
- Accepts **any valid git dir** (explicit CLI typing).
- If no config exists, `load_config` `die()`s as today — `wind add` requires a
  prior `wind init`.

*Dashboard.*
- `GET /api/scan` — **tokenless**, matching the read-only `/api/status` (it only
  lists candidate paths under the already-persisted `scan_roots`): returns
  candidates = `scan_repos(cfg.get("scan_roots", []))` minus already-configured
  paths.
- Token-gated `POST /api/add`: validate + append to the config file atomically
  **and** append to the in-memory `cfg["repos"]` snapshot (so `/api/status` shows
  the new card immediately) **and** launch the session.
- Restrict `/api/add` paths to candidates under a persisted `scan_root` — the
  dashboard cannot add arbitrary filesystem paths over HTTP.
- Small "add repo" affordance in `dashboard.html` (button → `GET /api/scan` →
  list → `POST /api/add` via the existing `apiPost` helper, dashboard.html:850).

**Hard security rule.** Both `wind add` and `/api/add` write **`{name, path}`
only** — they must **not** accept `claude_cmd` / `claude_args` / `limit_patterns` /
`prompt` from the CLI arg or HTTP body. Added repos inherit the global preset, so
no new command/arg-injection vector opens; the executed surface stays identical to
a `wind up` on the existing global preset. All write endpoints ride the existing
dashboard defenses: 127.0.0.1 bind, Host allowlist (`_host_allowed`, wind.py:1265),
and `X-Wind-Token` gate. Config writes stay atomic (`atomic_write_json`, 0o644).

**Boundary validations.** A live-appended entry must not bypass `load_config`'s
checks: name+path presence (wind.py:806-808), agent-name check (815-818), reserved
watcher-session-name collision (822-827).

**Watcher-refresh caveat (for the plan).** A running watcher caches config at
spawn (`build_watcher_command` / `spawn_watcher`, wind.py:968-1023), so a
newly-added repo may not be auto-watched until the watcher reloads/restarts. The
implementation plan must handle this (re-spawn the watcher or make it reload
config), otherwise "add + launch" produces a session the watcher ignores.

**Tests.** `cmd_add` (valid / duplicate / watcher-collision / non-git-dir /
no-config), `/api/scan` (candidate = scanned − configured), `/api/add`
(append + in-memory update + launch + `{name,path}`-only enforcement + path
restricted to scan_roots), and config-assembly with `scan_roots`.

---

## F4 · Respect `~/.claude/settings.json` + hooks (verify + document)

**Current state.** `cmd_up` launches each agent in two tmux calls: `tmux
new-session -d -s NAME -c PATH` (wind.py:1514) then `tmux send-keys` of the command
(1515). `tmux()` (wind.py:910-919) runs `subprocess.run` with **no `env=`**,
inheriting wind's environment. There is no `--settings`, no `CLAUDE_CONFIG_DIR` /
`HOME` override, no env stripping, no hook-suppressing flag. Because `claude` runs
as the same user with the same `$HOME`, it reads `~/.claude/settings.json` and
fires SessionStart hooks exactly as in a normal terminal; `--permission-mode`
governs only tool-permission prompting and does not disable settings/hooks.

**Design.** No launch code change is required — file-based settings + hooks are
already inherited. Deliver:

- A **regression test** asserting the launch command construction injects no
  `--settings` and that `tmux()` passes no `env=` — locking the inheritance
  contract so a future change can't silently break it.
- A short **README note** documenting that `wind` inherits the user's
  `~/.claude/settings.json` + SessionStart hooks because it launches the same
  `claude` in the same `$HOME` without a `--settings` override, plus the one
  caveat: settings tuned via **shell env vars** (not settings.json) can be stale
  because a pre-existing tmux server freezes its environment and wind adds no
  `update-environment` — this is deliberately out of scope.

---

## Cross-cutting

- **Tests / coverage.** New cases across F1–F4 as listed; keep ≥80% coverage. The
  F2 index shift requires updating all wizard-driving tests in lockstep.
- **Docs.** `README.md` and `plugins/second-wind/skills/second-wind/SKILL.md`:
  new full-auto preset + reversed default (security sections), `scan_roots`,
  `wind add`, dashboard add-repo, and settings inheritance.
- **Immutability / security invariants.** Keep using `build_config` /
  `build_repo_entry` (fresh dicts, no mutation of `chosen`); every config-writing
  path stays `{name, path}`-only, atomic, and behind the dashboard's
  bind/Host/token defenses.

## Out of scope

- Wizard preset **preselection** (would require a `select()` signature change).
- Env-var-based settings pass-through / forced login shell for F4.
- Caching scan **results** (only roots are persisted; scans run live).
- Per-repo agent/preset selection via `wind add` / `/api/add`.

## Success criteria

- Full-auto is a selectable preset and the shipped starter default; existing
  wizard configs unchanged.
- `wind init` offers a one-choice "defaults for all" path that writes minimal
  `{name, path}` entries inheriting one chosen preset.
- `wind add <path>` and a dashboard button add a repo (from scanned candidates,
  for the dashboard) and launch it, writing `{name, path}` only, atomically,
  behind existing defenses.
- A regression test locks settings.json/hook inheritance; README documents it.
- Full suite green; coverage ≥80%.
