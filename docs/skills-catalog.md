# Skills & Tools Catalog

> Visual version: [skills-catalog.html](skills-catalog.html) (open in a browser)

Four plugins, one CLI, one adapter script. Install only what you need:

```
/plugin marketplace add abhijitbansal/claude-skills
```

## ios-dev (plugin)

The iOS feedback loop: build, screenshot, deliver to your phone, ship to the App Store.
Needs `.claude/app.yml` in the target app repo (`app.name`, `app.bundle_id`, `app.scheme`, …).

| Name | Kind | What it does |
| --- | --- | --- |
| `app-preview` | skill | Builds the app on the booted simulator, launches it (optionally deep-linking), screenshots, and delivers the image to your iPhone — iMessage ping for the notification, iCloud Drive for the bytes. Output organized per git branch. |
| `ios-build` | skill | Builds for simulator or a connected device via `build.sh`, encoding signing and provisioning-profile detection rules. |
| `release` | skill | Code-complete → App Store Connect: `xcodebuild archive`, export .ipa, validate + upload via altool, tag the commit. `testflight` and `appstore` modes; refuses dirty trees. |
| `/preview` | command | One-shot build + launch + screenshot + deliver, with deep-link and `--no-build` options. |
| `/fix` | command | Tight UI-bug loop: apply a focused Swift fix, rebuild, screenshot, deliver proof to your phone. |
| `app-build-reminder` | hook | Stop hook — reminds the agent to run the build when Swift files are dirty before declaring done. |

## linear-pm (plugin)

Linear conventions an agent can execute: label vocabulary, status taxonomy, per-repo policy in `.claude/linear.yml`.

| Name | Kind | What it does |
| --- | --- | --- |
| `linear-pm` | skill | The conventions layer: `agent-ready`/`agent-blocked`/`needs-spec` labels, branch and PR naming, issue template, session-rename protocol. |
| `/linear-init` | command | Bootstrap a repo: write `.claude/linear.yml`, create the standard labels. |
| `/linear-new` | command | File an issue using the Why / What / Acceptance-criteria template. |
| `/linear-pick` | command | The autonomous loop: fetch issue → validate → branch → implement → verify → PR → update Linear. Refuses to write code unless repo policy allows autonomy. |
| `/linear-status` | command | Where everything stands, per the status taxonomy. |
| `/linear-sync` | command | Reconcile Linear state with repo reality. |
| `/linear-block` | command | Mark an issue `agent-blocked` with a reason comment. |

## core-workflow (plugin)

The everyday glue, useful in any repo.

| Name | Kind | What it does |
| --- | --- | --- |
| `commit` | skill | Stage, shellcheck-lint shell scripts, write a single conventional commit generated from the diff. Local only — never pushes uninvited. |
| `contribute` | skill | Send improvements back to this repo from any working directory: branches, validates with the test suite, opens a PR. |
| `/team` | command | Multi-agent team orchestration helper. |
| `/contribute-skill` | command | Scaffold a new skill into a plugin and open the PR (`--plugin` picks the destination). |
| `image-parser` | agent | Vision subagent: OCR, screenshot comparison, "is the title cut off?" checks. |
| `web-researcher` | agent | Docs/API lookup subagent: tight synthesis with sources, not raw page dumps. |
| `shellcheck-on-edit` | hook | PostToolUse hook — lints any `.sh` file the agent edits. |

## second-wind (plugin + CLI)

Claude Code pauses everything at the 5-hour usage limit. `wind` notices, waits, and resumes — including overnight.

| Name | Kind | What it does |
| --- | --- | --- |
| `wind` | CLI | Single-file, stdlib-only Python at `tools/second-wind/wind.py`. One tmux session per repo (`wind up`), a watcher that scans panes for the limit message (`wind watch`), one account-level reset clock, optional ntfy.sh notifications and macOS caffeinate. 16-test suite. |
| `second-wind` | skill | Teaches the agent `wind init/up/watch/status/resume/down`, the config keys, and how to self-install `wind` when missing from PATH. |

CLI install without the plugin:

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
chmod +x ~/.local/bin/wind
```

## adapters (multi-tool)

SKILL.md is tool-agnostic — one script wires the same skills everywhere.

| Mode | Target | What it does |
| --- | --- | --- |
| `codex` | `~/.codex/skills` | Symlinks every plugin skill. Skips cleanly if Codex isn't installed; `CODEX_SKILLS_DIR` overrides. |
| `copilot` | `~/.copilot/skills` | Same for Copilot CLI; `COPILOT_SKILLS_DIR` overrides. |
| `agents-md` | any `AGENTS.md` | Maintains a marker-delimited index block — every skill's name, description, and path — for Hermes and anything AGENTS.md-aware. Idempotent. |
| `all` | everything above | All three modes; prunes links it created for removed skills. |
