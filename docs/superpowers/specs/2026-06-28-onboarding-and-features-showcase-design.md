# Onboarding & Features Showcase — design

- **Date:** 2026-06-28
- **Branch:** `feat/second-wind-overhaul` (continues the current branch)
- **Status:** approved design; pending spec review → implementation plan

## Context

`claude-skills` is now public. It already ships a polished public landing page
(`site/index.html` — hero, Why, Plugins, Install, Second Wind, Docs) plus
companion deep-dive pages in `docs/` (`architecture.html`, `machine-setup.html`,
`skills-catalog.html`, `second-wind/index.html`). `pages.yml` flattens `site/`
+ `docs/` into one published root on a **release publish** (or manual dispatch)
and rewrites local cross-links to flat deployed forms.

Second Wind is the most active feature. It ships as a single-file Python CLI
(`tools/second-wind/wind.py`, stdlib only) + a static `dashboard.html`, and as a
Claude Code **skill** (`plugins/second-wind/skills/second-wind`) with **no
`commands/` directory yet**. Other plugins (e.g. `core-workflow`, `linear-pm`)
do expose slash commands.

This design adds onboarding + discovery surfaces so a new (public) user can find
what the repo offers and get Second Wind running quickly.

## Goals

1. A **dedicated setup-guide command** for Second Wind, on two surfaces:
   `wind guide` (CLI) and `/second-wind` (Claude Code slash command).
2. An **in-dashboard help/guide** so the dashboard explains itself.
3. A **new interactive `docs/features.html`** that highlights **every** feature
   across the repo (all plugins + the CLI), suitable for the public site.

## Non-goals (YAGNI)

- No search backend, no server — `features.html` is fully client-side.
- No auto-generated/auto-synced inventory from the filesystem. The inventory is
  hand-authored in this spec and rendered into the page.
- No rewrite of the existing landing page. `/features` **complements** it; the
  landing gains one link.
- No new CI: `pages.yml` already copies `docs/*.html`, so `features.html` ships
  automatically at `/features.html`.

## Decisions

| Fork | Decision |
| --- | --- |
| Setup command surface | **Both** — `wind guide` CLI **and** `/second-wind` slash command, same 4-step spine. |
| Showcase HTML | **New standalone `docs/features.html`** explorer, linked from the landing — not folded into `site/index.html`. |

## Guiding principle — one content source

The setup walkthrough wording is authored **once** (below) and rendered into
each surface. The surfaces are different languages (Python / markdown / HTML),
so they cannot share a runtime object; consistency comes from authoring them
from this spec and a cheap **drift-guard test** (the slash-command file and
`wind guide` output must both name the same four step keywords).

### Canonical setup walkthrough (source of truth)

```
Second Wind — set-and-forget Claude Code across repos.

  1. wind init            Pick repos, a permission preset, and an agent.
                          Writes your config (or --defaults for a starter file).
  2. wind prompt <repo>   Optional: author each repo's first prompt in $EDITOR.
  3. wind up              Launch a tmux session per repo, send the first prompt,
                          and auto-spawn the watcher (it resumes you after the
                          5-hour limit resets — overnight, untouched).
  4. wind dash            Live localhost dashboard. Click a card to expand it;
                          hit ⧉ attach to copy `tmux attach -t <session>` and
                          drop into the real terminal with full TUI autocomplete.

Check in anytime:  wind status · wind resume · wind down
Full visual guide:  docs/second-wind/index.html
```

## Piece A — `docs/features.html` (public interactive explorer)

**Shape:** one standalone, self-contained HTML file (inline CSS + vanilla JS, no
build step), matching the landing's dark aesthetic (Space Grotesk / Inter /
JetBrains Mono, same CSS variables) so it reads as part of the site.

**Content model:** one card per feature. Each card carries:
- `title` — feature name
- `plugin` — owning plugin or "CLI"
- `type` — one of: Plugin · Skill · Command · Agent · Hook · CLI
- `summary` — one line on what it does
- `detail` — expandable: trigger / example / where it lives

**Inventory to render** (counts match the landing stat band — 4 plugins, 13
skills, 12 commands, 2 agents, 2 hooks, 1 CLI):

- **second-wind** (CLI + skill): the `wind` CLI tool; `second-wind` skill.
- **core-workflow** (plugin): commands `contribute-skill`, `team`; skills
  `commit`, `contribute`; agents `image-parser`, `web-researcher`; hook
  `shellcheck-on-edit`.
- **ios-dev** (plugin): commands `fix`, `ios-init`, `preview`; skills
  `ios-build`, `app-preview`, `release`, `biometric-applock`, `demo-recording`,
  `alternate-app-icons`, `swift6-mainactor-migration`, `xcode-cloud-validate`,
  `xcodegen-test-targets`; hook `app-build-reminder`.
- **linear-pm** (plugin): commands `linear-block`, `linear-init`, `linear-new`,
  `linear-pick`, `linear-status`, `linear-sync`; skill `linear-pm`.

**Interactions (client-side only):**
- Live text search over title + summary.
- Filter chips: All / Plugins / Skills / Commands / Agents / CLI.
- Click a card → expand its detail (one open at a time or accordion; either is
  fine).
- A small stat row at top mirrors the landing counts.

**Deploy & linking:**
- `pages.yml` already runs `cp docs/*.html _site/` → `features.html` deploys with
  no workflow change.
- Landing (`site/index.html`) gains a hero/nav link to `../docs/features.html`;
  the existing `sed 's#\.\./docs/##g'` rewrites it to `features.html` on deploy.

**Verify:** Bash/Python content test (or a bats test) asserting `features.html`
contains every plugin name and the type filter chips; visual check in browser.

## Piece B — `wind guide` CLI + `/second-wind` slash command

**`wind guide`:**
- New subcommand in `wind.py`. Prints the canonical walkthrough above.
- `wind guide --open` opens `docs/second-wind/index.html` (or the installed copy)
  in the browser via the platform opener; plain `wind guide` just prints.
- Stdlib only. Wire into the existing arg dispatch + help listing.

**`/second-wind` slash command:**
- New file `plugins/second-wind/commands/second-wind.md` (first command in that
  plugin). Claude-driven: walks the same four steps, can run them for the user
  (scan repos, run `wind init`, offer `wind up`).
- Names the same four step keywords as `wind guide` (drift guard).

**Verify (TDD):**
- Unit test: `wind guide` output contains the four step keywords (`init`,
  `prompt`, `up`, `dash`) and exits 0.
- Drift-guard test: `plugins/second-wind/commands/second-wind.md` exists and
  names the same four keywords.

## Piece C — in-dashboard help/guide

- Add a **`?` help button** to the dashboard header.
- Clicking opens a **help modal** (reuse the existing `#modal-overlay` pattern,
  or a dedicated lightweight overlay) covering:
  - what each card **state** means (running / idle / paused / reset countdown),
  - the action buttons (**resume**, **⧉ attach**, **kill**, **send**),
  - what the **watcher** does (limit detect → wait → resume),
  - a "first time? run `wind guide`" pointer.
- Self-contained in `dashboard.html`.

**Verify:** Python content test (same pattern as `DashboardAttachButton`)
asserting the help button id + key help strings are present in the served HTML.

## Build order (one branch, ~3 commits)

1. **Piece B** — canonical content + `wind guide` + `/second-wind`. Nail the
   wording first; it is the source of truth.
2. **Piece C** — dashboard help, reusing B's wording.
3. **Piece A** — `docs/features.html` showcase + landing link.

## Testing summary

- Piece B: 2 unit tests (CLI output keywords; slash-command drift guard).
- Piece C: 1 content test (help button + strings present).
- Piece A: 1 content test (plugins + filter chips present) + manual browser
  check (search, filter, expand).
- Full suite stays green (`python3 -m pytest tests` in `tools/second-wind`).

## Risks / notes

- **Inventory drift:** the hand-authored `features.html` corpus can fall out of
  sync if plugins change. Accepted (YAGNI on auto-generation); a comment in the
  file points future editors at this spec and the stat band.
- **`wind guide --open` portability:** reuse whatever opener `wind dash` already
  uses for the browser; degrade to printing the path if none.
- **Public surface:** `features.html` is static, no user input echoed, no
  secrets — no new security surface.
