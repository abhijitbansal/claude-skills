# portable-artifacts 2: Refresh of the Other Four Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make-dashboard, make-diagram, make-explainer and make-scene look like one studio's work: a shared type scale with real display and text contrast, nine themes with depth, seeded art for every theme, and each skill's own surfaces redrawn to a short, viewed list. Nothing about SQL, provenance, security or the spec formats changes except the opt-in fields named in the decisions.

**Architecture:** Shared first, skills second. Tasks 1 to 3 change `shared/` (type tokens, theme tokens and their contrast rules, seeded art) and sync it into the skills, so all four inherit the base. Tasks 4 to 7 each start by building that skill's examples, shooting them, viewing them and writing the change list that is the task's scope; they end at a look gate, where a reviewer who has not seen the list judges before and after screenshots. Motion work (the diagram story player, the scene tour) is split into its own dispatch so that one dispatch never loads two design rulebooks.

**Tech Stack:** Node 20 or later, `node:test`, Playwright (already a dev dependency of each skill), Vega-Lite (make-dashboard), ELK (make-diagram), three.js bundled by esbuild (make-scene). No new npm dependency and no new font file.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md` section 13 (binding), section 15 step 8 (this plan), section 16 (constraints), section 17 ("the per-skill refresh lists" are left to the builder), section 18 (the regression risk). Routing: `~/.claude/skills/design-router/SKILL.md`.

Abbreviations: `P` = `plugins/portable-artifacts`, `D` = `P/skills/make-dashboard`, `G` = `P/skills/make-diagram`, `E` = `P/skills/make-explainer`, `S` = `P/skills/make-scene`, `W` = the worktree root `/Users/abhijitbansal/projects/claude-skills/.claude/worktrees/New-Motion`. Inventory read at commit `c8c1d659`.

## What was looked at, and what was not

- The four skills have no `node_modules` in this worktree, so their build scripts do not run here. Five examples were built with the main checkout's copy of the skills (`/Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts`, branch `docs/skill-improvement-plan`) into `W/.scratch/refresh-look/`: `dashboard-sales/index.html`, `diagram-story.html`, `explainer-concept.html`, `explainer-slides.html`, `scene-city.html`. All five built.
- No screenshot was taken and no page was viewed in a browser: other agents' headless browsers were live, and the planner was told not to start one. The "provisional list" in each task below comes from the template and stylesheet source in this worktree, not from pixels. It is a starting point; step 1 of each task replaces it with a list written after viewing.
- The other branch differs from this one in the presentation files only slightly (`git diff HEAD docs/skill-improvement-plan` on `D/template/page.html`, `G/template/viewer.html`, `E/template/base.css`, `E/template/deck-flavors.css`: a `font-synthesis` line, right-aligned number cells, weight variables in the diagram viewer, diff and checklist rules, a poster deck fix). It does not touch `shared/type.mjs`, `shared/theme.mjs`, `shared/art.mjs`, `shared/contrast.mjs` or `shared/themes/`. So the provisional lists carry over to this branch.

## Decisions for the controller

Each has a default this plan is written to. Change the default before dispatching the task named.

| # | Question | What was found | Default | Alternative | Task |
|---|---|---|---|---|---|
| 1 | Does `docs/skill-improvement-plan` land on this branch first? | That branch changes 290 files under `P/shared` and the four skills (11,647 insertions): `shared/shot.mjs` and its test, `shared/preflight.mjs`, a `check.mjs` for make-dashboard, per-skill `scripts/lib/shots.mjs`, reworked `build.mjs` in all four, `--display-weight` and `--strong-weight` in the diagram viewer. None of it is on this branch | Merge or rebase it in before Task 0, as its own reviewed step. This plan then edits the merged tree and uses its `shot.mjs` | Do not merge. Task 0 runs the screenshot tool from the main checkout path and this plan's diffs will conflict with that branch later in the files listed above | 0, all |
| 2 | One static rulebook, or one per surface? | `design-router`: the stack gate fails (no React and Tailwind in any `package.json` here), so the taste skills are out. "Redesign existing" routes to `redesign-existing-projects`; static polish also fits `impeccable:impeccable` (critique). The user's rule is one rulebook at a time | `redesign-existing-projects` for every static task (1 to 7a), so the four skills are judged by one hand. `emil-design-eng` for the two motion dispatches (5b, 7b) | `impeccable:impeccable` for Tasks 1 to 3 (tokens) and `redesign-existing-projects` for 4 to 7; never both in one dispatch | all |
| 3 | Chart rules | `design-router` has no chart row. The `dataviz` skill is a chart method outside the router's pool; `P/shared/contrast.mjs:2-4` already names its palette validator for categorical colours | Task 4 uses `redesign-existing-projects` only. The chart grammar is section 13's four items. The dataviz palette validator is used as a check tool if step 1 finds it on disk, never loaded as a second rulebook | Dispatch the chart half of Task 4 separately with the `dataviz` skill as its one rulebook | 4 |
| 4 | Sparklines | A KPI shows the first row's `field` of a named query (`D/references/schema.md:30`). A sparkline needs a series | Opt-in: `kpis[].trend = { query, field }`, naming a query the spec already declares. No new SQL surface; a KPI without `trend` renders as today | Automatic: draw one whenever the KPI's own query returns three or more rows (changes existing pages) | 4 |
| 5 | Pull quotes | make-explainer has no quote section (`E/scripts/lib/render/` has 26 files, none for a quote) and its markdown has no blockquote | A new section type `quote` (`text`*, `by`, `tone`), with schema, renderer, lint budget, golden and docs | Style an existing type (a `callout` variant) and add no type | 6 |
| 6 | Deck closing slide | `E/scripts/lib/slides.mjs:117` draws a cover (`.slide-cover`); art is asked for "the first and the last slide" but the last slide is an ordinary content slide | The last slide gets a closing layout when it is a `tldr`, a `callout` or a `quote`; no new spec field | A new root field `closing: { title, text }` | 6 |
| 7 | Optical sizes | The shipped fonts are static latin instances (`P/shared/fonts/*-latin-<weight>-normal.woff2`); a static instance has no `opsz` axis. `theme.test.mjs` holds a font budget | No new font file. Task 1 checks each file for an `opsz` axis with `P/bin/font-metrics.py`'s reader; where there is none the scale compensates with tracking and weight per size, and the plan's report says "no optical axis in the shipped files" | Ship variable files for Newsreader and Bricolage Grotesque and raise the font budget | 1 |
| 8 | Art for six themes in one file | `P/shared/art.mjs` is 454 lines with three generators; six more would pass the 800-line rule | Split into `P/shared/art/` (one module per style, shared pieces in `art/pieces.mjs`), `art.mjs` stays the entry point with the same export. `bin/sync-shared.mjs` copies subfolders (it already copies `themes/` and `fonts/`) | Keep one file and give the six themes parameter variants of the three existing generators | 3 |
| 9 | Look-gate reviewer tier | `AGENTS.md` routes reviewers to the executor tier at medium; the user's global rule says reviewers are Opus at medium. The gate judges images | Opus, medium effort, fresh context, report only | Executor tier per `AGENTS.md` | gates |
| 10 | Screenshots of the story player, the tour and the 3D canvas | `shot.mjs` forces reduced motion and takes one full-page still; a headless browser may not draw WebGL | Motion is judged by the existing browser and unit suites plus the manual-test checklist; the scene still comes from `S/scripts/check.mjs` if step 1 of Task 7 finds it can write one (`S/scripts/lib/canvas-shot.mjs`), else from the checklist | Add a `--at <seconds>` mode to `shot.mjs` | 5b, 7 |

## Global Constraints

- No change to SQL handling, the SQL sandbox, provenance, the CSP, request handling or any validator rule that refuses input. A diff that touches `D/scripts/lib/sql.mjs`, `guard.mjs`, `sources.mjs`, `P/shared/provenance.mjs`, or a CSP string is a stop.
- No new npm dependency, no version change in any manifest, no new font file (decision 7).
- Existing contrast checks pass after every task: `checkTheme` in `P/shared/contrast.mjs` for all nine themes in both modes. A threshold is never lowered. New tokens get their own rule and that rule is shown failing on a bad theme before it is trusted.
- Reduced motion is honoured: every new or changed transition has a `prefers-reduced-motion: reduce` branch (CSS) or goes through the existing reduced checks (`camera.reduced()` in `G/template/story.js`, `reducedMotion()` in `S/template/runtime/chrome/tour.js`), with a test.
- Edit `P/shared/` only; never a skill's `shared/` copy. After any shared edit run `node W/plugins/portable-artifacts/bin/sync-shared.mjs`, then `--check`.
- Text set as SVG in make-diagram is layout-measured (`G/scripts/lib/sizes.mjs`, `P/shared/fonts/metrics.json`, `P/bin/font-metrics.py`). A change to a diagram label's size, weight, family or letter-spacing changes measured widths: re-measure, then regenerate goldens. `P/shared/test/type.test.mjs` forbids body-level `tabular-nums` and forbids `.pa-label` reaching SVG `<text>` for this reason.
- Goldens and snapshots are never regenerated to make a failure go away. A golden changes only when the visual change is on the task's list, and the commit message says so. Use the suite's own switch where one exists (`E/test/golden.test.mjs`, `E/test/build.test.mjs`, the four `S/test` files that read `process.env.UPDATE*`); `D/test/golden/` and `G/test/golden/` have no switch that was found, so step 1 of Tasks 4 and 5 finds the writer before any golden moves.
- `S/template/vendor/scene-runtime.min.js` is generated: after a change under `S/template/runtime/` run `npm --prefix W/plugins/portable-artifacts/skills/make-scene run bundle`. Never edit the bundle by hand.
- One browser-heavy run at a time on this machine, across all agents. Run `pgrep -fl chrome-headless-shell` first; if anything is listed, wait. Screenshots come from `shot.mjs` only (below); no ad-hoc screenshot loop.
- One design rulebook per dispatch. The dispatch prompt names it; the implementer calls `Skill(design-router)` with that route and loads nothing else from the same exclusion set.
- Shell rules of this worktree: one plain command per call, literal absolute paths, no `cd`, no variables, loops or heredocs. Use `npm --prefix <absolute folder>` and `node --test "<absolute glob>"`.
- Implementers do not commit. The controller commits one task per commit, pushes the branch, never force-pushes, never merges.
- Repo rules that bind: files under 800 lines, functions under 50, tests first, counts changed only through `python3 scripts/sweep_counts.py`.

## The screenshot tool

`shot.mjs` is the tool the user's rules name: `node <path>/shot.mjs <file.html | folder> --widths 390,1280 --out <dir>`. It serves the page from a loopback server, shoots each width in light and dark in one browser, refuses while another headless browser is live (exit 2), and reports horizontal overflow at 390 px as a warning.

- It is **not in this worktree**. It lives at `/Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/shared/shot.mjs` (commits `2164616c`, `748ecd8d`, branch `docs/skill-improvement-plan`). Under decision 1's default it arrives as `W/plugins/portable-artifacts/shared/shot.mjs`; otherwise run it from the main checkout path. It loads Playwright from a skill folder next to it, so the main-checkout copy works without an install here.
- Output goes to `W/.scratch/refresh-look/<before|after-rN>/<skill>/`. File names are `<page>-<width>-<scheme>.png`.
- It writes PNGs; it verifies nothing. Every shot is opened and viewed with the Read tool.

## Review Focus

1. **A security or data change hiding in a look change.** Any diff outside templates, stylesheets, renderers, theme and type tokens, and the opt-in fields of decisions 4 to 6 is questioned. `trend` must not accept SQL text, only the name of a declared query.
2. **Contrast.** Each new surface step is checked against every text token; the KPI numeral, direct chart labels and caps labels are text on a surface and are covered by a rule, not by eye.
3. **Measured text.** After Task 1 and Task 5, no diagram label overflows its node: `G/test/look-browser.test.mjs` and `G/scripts/check.mjs` on all six examples.
4. **Goldens.** Each changed golden maps to a list item. A golden that changed with no list item is a regression.
5. **Reduced motion and print.** `E/template/base.css` has print rules and two reduced-motion blocks; new shadows and bands must not print as grey boxes, and nothing new animates under `reduce`.
6. **Old specs.** Every example and every test fixture that validated before still validates and builds, with no new required field.
7. **The gate was real.** The reviewer's prompt held no change list and no implementer notes; its verdicts are quoted, not summarised.

## File Structure

| File | Change | Task |
|---|---|---|
| `P/shared/type.mjs`, `P/shared/test/type.test.mjs` | Scale, display and text roles, weight tokens, caps-label token, `.pa-num` | 1 |
| `P/shared/theme.mjs`, `P/shared/contrast.mjs`, `P/shared/themes/*.json` (9), `P/shared/test/theme.test.mjs`, `contrast.test.mjs` | Surface steps, elevation scale, accent retune, new contrast rules | 2 |
| `P/shared/art.mjs`, new `P/shared/art/*.mjs`, `P/shared/test/art.test.mjs` | Six new styles; entry point unchanged | 3 |
| `D/template/page.html`, `D/scripts/lib/vega-config.mjs`, `html.mjs`, `kinds.mjs`, `spec.mjs`, new `D/scripts/lib/sparkline.mjs`, `D/references/schema.md`, `D/SKILL.md`, `D/test/` | Newsroom charts, KPI tiles, `trend` | 4 |
| `G/scripts/lib/css.mjs`, `sizes.mjs`, `G/template/viewer.html`, `G/test/` | Node, edge and label styling | 5a |
| `G/template/story.js`, `transport.js`, `camera.js`, `G/test/story-*.test.mjs` | Calmer story player | 5b |
| `E/template/base.css`, `flavors.css`, `deck-flavors.css`, `slides.html`, `E/scripts/lib/slides.mjs`, `sections.mjs`, `schema.mjs`, new `E/scripts/lib/render/quote.mjs`, `E/references/sections.md`, `schema.md`, `E/test/` | Hero, rhythm, quote, cards, deck title and closing slides | 6 |
| `S/template/runtime/render.js`, `theme.js`, `colour.js`, `chrome/labels.js`, `S/template/page.css`, `S/template/vendor/scene-runtime.min.js` (generated), `S/test/` | Lighting, materials, fog, label type | 7a |
| `S/template/runtime/travel.js`, `chrome/tour.js`, `S/test/tour-unit.test.mjs`, `travel-unit.test.mjs` | Tour camera easing | 7b |
| `P/CHANGELOG.md`, `P/README.md`, `P/USAGE.md` (theme and look paragraphs only) | What changed, with no re-measured claim invented | 8 |

Every skill's `shared/` copy changes with Tasks 1 to 3 through `sync-shared.mjs`.

## Suites and checks that exist

| Where | Command | Notes |
|---|---|---|
| shared | `node --test "W/plugins/portable-artifacts/shared/test/*.test.mjs"` | `type`, `theme`, `contrast`, `art` are the ones this plan moves |
| sync | `node W/plugins/portable-artifacts/bin/sync-shared.mjs --check` | CI fails on drift |
| plugin guards | `node --test "W/plugins/portable-artifacts/bin/test/*.test.mjs"` | `style-lint.test.mjs` (no ad-hoc underline, fonts from theme variables, nav links), `theme-guidance.test.mjs` (SKILL.md names only real themes) |
| make-dashboard | `npm --prefix W/plugins/portable-artifacts/skills/make-dashboard test` | Browser tests: `browser`, `chrome-browser`, `nowrap-browser`; goldens in `test/golden/*.json` (Vega specs); `theme-page.test.mjs`. No `check.mjs` on this branch |
| make-diagram | `npm --prefix W/plugins/portable-artifacts/skills/make-diagram test` | Browser tests: `browser`, `chrome-browser`, `explore-browser`, `fullscreen-browser`, `look-browser`, `story-browser`; `look.test.mjs`, `theme.test.mjs`, goldens. Check: `node G/scripts/check.mjs <page.html> --json` |
| make-explainer | `npm --prefix W/plugins/portable-artifacts/skills/make-explainer test` | Browser tests: every `*-browser.test.mjs` and `browser.test.mjs`; `golden.test.mjs`, `flavor.test.mjs`, `slides.test.mjs`. Check: `node E/scripts/check.mjs <page.html> --json`. Run alone: it starts browsers |
| make-scene | `npm --prefix W/plugins/portable-artifacts/skills/make-scene test` | Browser tests: `chrome-browser`, `lift-browser`, `runtime-fixes-browser`, `scene-browser`; `bundle.test.mjs`, `tour-unit`, `travel-unit`, `runtime-colour`. Check: `node S/scripts/check.mjs <page.html> --json` |
| repo | `uv tool run pytest tests/pytest/ -q`, `bats tests/bats`, `python3 scripts/sweep_counts.py --check` | Only if a count or a site page moves |

The three `check.mjs` scripts exit 0 with `status: "skipped"` when no browser is found. A skipped check is reported as skipped, never as passed.

## The look gate (Tasks 4 to 7)

1. Before-shots exist from Task 0. After the task's work, the same examples are rebuilt and shot into `W/.scratch/refresh-look/after-r1/<skill>/`.
2. The controller dispatches one reviewer (decision 9), fresh context, with: the absolute paths of each before and after PNG pair, the section 13 sentence for that skill quoted verbatim, the gate rubric below, and "report only: never write session logs or project docs; do not commit or push". The prompt holds no change list, no diff and no implementer notes. It carries the finding-stage sentence of `~/.claude/rules/ecc/common/code-review.md` verbatim.
3. Rubric, per pair: better, same or worse, with one reason; then, for the skill as a whole: is there real contrast between display and text type; are numerals aligned where they stack; is there one accent; do surfaces read as steps; is anything clipped, overflowing or illegible at 390 px; in dark mode is anything lower in contrast than before.
4. Pass: no pair judged worse, no clipped or illegible text, and every item on the task's list is visible in at least one after-shot (the controller checks this last part against the list). Otherwise the implementer revises and the gate reruns as `after-r2`, with a new fresh reviewer.
5. Two revision rounds at most. If round two does not pass, the task stops, the frames go to the owner, and the other skills' tasks continue.
6. What the gate cannot see (decision 10) is listed in the task and goes on the manual-test checklist.

---

### Task 0: Baseline, installs and before-shots

**Rulebook:** none (no design work).

**Files:** none tracked. Writes `W/.scratch/refresh-look/before/` and `W/.scratch/refresh-look/baseline.md`.

- [ ] **Step 1: Decision 1.** If the default stands, confirm the other branch is merged (`git log --oneline -1 -- plugins/portable-artifacts/shared/shot.mjs` prints a commit). Record `git rev-parse HEAD` in `baseline.md`.
- [ ] **Step 2: Install.** `npm ci --prefix <abs D>`, then the same for `G`, `E`, `S`, as CI does (`.github/workflows/test.yml:120`). The cut-over plan uses `--ignore-scripts` for make-motion; whether these four build with it was not checked (`D` depends on `@duckdb/node-api`, a native package). If the controller wants `--ignore-scripts` here, build `sales-overview.json` straight after and fall back to plain `npm ci` for a skill that fails. This needs the network; the implementer runs it. `node_modules` is ignored by git.
- [ ] **Step 3: Baseline suites,** one at a time: the shared tests, `sync-shared.mjs --check`, the `P/bin` tests, then each skill's `npm test`. Record pass, fail and skip counts per suite in `baseline.md`. A red suite at baseline is reported and not fixed here.
- [ ] **Step 4: Build every example** into `W/.scratch/refresh-look/before/<skill>/<name>/`: `D` `minimal.json`, `sales-overview.json`; `G` `architecture`, `cloud-architecture`, `flow`, `sequence`, `state`, `story` (`*.diagram.json`); `E` `checklist`, `concept`, `plan`, `recap`, `recap-simple`, `slides`, `slides-simple` (`*.explainer.json`); `S` `city`, `forest`, `galaxy`, `terrain`, `lift-dashboard`, `lift-diagram` (`*.scene.json`). Then a theme matrix: `sales-overview`, `story`, `concept` and `slides` once per theme with `--theme <name>` for all nine.
- [ ] **Step 5: Shoot.** `pgrep -fl chrome-headless-shell` first. One `shot.mjs` call per built example, `--widths 390,1280`, each with its own `--out <...>/before/<skill>/<name>/shots`: the tool names a file `<page>-<width>-<scheme>.png`, and every dashboard page is `index.html`, so a shared `--out` would overwrite. Record every overflow warning in `baseline.md`: an overflow that exists before is not a regression later.
- [ ] **Step 6: View** every PNG. Note in `baseline.md` which pages `shot.mjs` cannot show (a blank canvas, a deck that shows only its first slide).

**Verification.** `baseline.md` holds the commit, the counts and the warnings; each built example has four PNGs per page (two widths, two schemes). Deliverable: a recorded before-state every later task compares against.

### Task 1: Shared type scale

**Rulebook:** `redesign-existing-projects` (decision 2).

**Files:** `P/shared/type.mjs`, `P/shared/test/type.test.mjs`; the synced copies.

**Provisional list (from source).** The scale is 12, 14, 17, 21, 27, 34 px and a 40 to 60 px hero: steps of about 1.25, so a card heading (17 px, weight 600, body family) barely differs from body text. Weight is the literal `600` in every stylesheet; two themes ship a 400 display face only. Caps labels use three trackings: `.06em` in `.pa-label`, `.08em` in diagram group and kind labels, none in dashboard KPI labels. `tabular-nums` is declared rule by rule in `D/template/page.html` (the KPI value, tables) and `E/template/base.css` (the KPI value, tables, step numbers, checklist counts) and not at all in card bodies.

**Interfaces**

- `TYPE_TOKENS` keeps every existing name (other stylesheets read them). It gains: display sizes with a wider ratio above body (`--fs-d1` to `--fs-d3`), `--display-weight` and `--strong-weight` (per theme, set in Task 2's theme tokens; defaults here), `--track-caps`, `--lh-tight`.
- `typeCss()` gains `.pa-num{font-variant-numeric:tabular-nums lining-nums}` and `.pa-caps` (the one caps-label style: size, tracking, weight, colour). `.pa-label:not(text)` keeps its selector and becomes an alias of `.pa-caps`.
- Nothing is set on `body`, `:root` or any selector that can reach SVG `<text>`.
- If decision 1's default held, `--display-weight`, `--strong-weight` and a `<!--@WEIGHTS-->` style block already exist in `G/template/viewer.html` and its builder. Read that source first and move its definition into the shared tokens; do not define a second pair with the same names.

- [ ] **Step 1: The list.** View the Task 0 shots of all four skills for type only; write `W/.scratch/refresh-look/lists/type.md` (at most ten items). That list is the scope.
- [ ] **Step 2: Tests first** in `type.test.mjs`. Keep "every token is emitted with its spec value" (update the table), "no body-level tabular-nums", ".pa-label never restyles make-diagram SVG labels". Add: "display sizes step by at least 1.3 from the largest text size" (computed from the tokens), "one caps tracking: `.pa-caps` and `.pa-label` share `--track-caps`", "`.pa-num` sets tabular and lining figures and matches no SVG text selector". Run: the new tests fail.
- [ ] **Step 3: Implement,** sync, rerun. Check `opsz` per decision 7 and write the result in the list file.
- [ ] **Step 4: Adopt in the four skills' stylesheets** only where a literal duplicates a token (`600`, `.06em`, `.08em`, a local `tabular-nums` on a table or KPI). Diagram SVG label rules are left for Task 5a.
- [ ] **Step 5: Verify.** Shared tests, sync check, `P/bin` tests, each skill's `npm test` one at a time. Any golden that moved is listed with its reason.

### Task 2: Themes with depth

**Rulebook:** `redesign-existing-projects`.

**Files:** `P/shared/theme.mjs`, `P/shared/contrast.mjs`, the nine `P/shared/themes/*.json`, `P/shared/test/theme.test.mjs`, `contrast.test.mjs`.

**Provisional list (from source).** Each theme has two surfaces (`page`, `surface`) and a hairline (`line`); every card in all four skills is a 1 px border with no elevation. There is one accent and one soft accent; in `editorial` the accent (`#1f4e79`) is close in weight to the text. Dark modes use the same two-step structure.

**Interfaces**

- New theme tokens, both modes, in all nine files: `surface2`, `surface3` (steps above `surface`), `shadow` (the colour the elevation scale mixes), and per-theme `displayWeight`, `strongWeight`. `VARS` in `theme.mjs` maps them to `--surface-2`, `--surface-3`, `--shadow`, `--display-weight`, `--strong-weight`. Existing token names and values that are not retuned stay.
- `themeCss()` emits an elevation scale `--elev-1` to `--elev-3` built from `--shadow` (inside `@supports` for `color-mix`, with a plain fallback first, as `G/scripts/lib/css.mjs:13-18` does).
- `checkTheme()` gains: every text token at 4.5:1 on `surface2` and `surface3`; `surface`, `surface2`, `surface3` strictly ordered in luminance with a minimum contrast step between neighbours (a named constant), in one direction per mode; accent at 4.5:1 on `page` and on every surface when used as text.
- Direction. Dark mode: each step is lighter than the one under it. Light mode: `surface` is already white or near white in seven themes (`#ffffff` in `paper`, `blueprint`, `ink`, `mono`; `#fffefb`, `#fffefc`, `#fff8f0` in `editorial`, `brief`, `dusk`), so a step cannot go lighter. There the steps go darker (insets, bands, wells) and lift is carried by `--elev-*` alone. `press` has `surface` darker than `page` today; the rule orders the three surface tokens only and leaves `page` free.

- [ ] **Step 1: The list.** View the nine-theme matrix from Task 0; write `lists/themes.md`: per theme, the surface steps, the accent decision and anything dropped.
- [ ] **Step 2: Guards first.** In `contrast.test.mjs` add the three rules with a red proof each: a theme whose `surface2` drops `text3` under 4.5:1 fails naming `light.text3` and the ratio; a dark theme with `surface3` darker than `surface2`, and a light theme whose `surface2` equals `surface`, each fail naming the mode and the token; an accent under 4.5:1 on `surface2` fails. In `theme.test.mjs` extend "every theme defines every token in both modes" to the new tokens. Run: red.
- [ ] **Step 3: Retune** the nine files. Keep "type systems" (`theme.test.mjs:45`) and the font budget green: no font pairing changes.
- [ ] **Step 4: Sync and adopt.** Cards, tiles, panels and menus in the four skills move from "border only" to a surface step plus `--elev-1`, in the stylesheet of each skill, only where Task 4 to 7 would otherwise each redo it. Print rules drop the shadow.
- [ ] **Step 5: Verify** as Task 1, plus the per-skill theme tests (`D/test/theme-page.test.mjs`, `G/test/theme.test.mjs`, `G/test/look.test.mjs`, `E/test/flavor.test.mjs`, `S/test/runtime-colour.test.mjs`).

### Task 3: Seeded art for the six themes that have none

**Rulebook:** `redesign-existing-projects`.

**Files:** `P/shared/art.mjs`, new `P/shared/art/` (decision 8), `P/shared/test/art.test.mjs`.

**Found.** `ART_STYLES` has `dusk`, `press`, `poster`. `paper`, `ink`, `blueprint`, `mono`, `brief` and `editorial` fall back to `press`. `art.test.mjs` asserts that fallback ("legacy themes fall back to the press style"): that test flips.

**Interfaces**

- `artSvg({ theme, seed, width, height, mode })` unchanged in signature, error types and safety contract (no script, no `foreignObject`, no `href`, no external `url()`, only `#rrggbb` theme tokens, the seed only hashed).
- `ART_STYLES` lists nine entries, one per theme. Default directions, to be confirmed by the list: `paper` ruled margins and fold lines; `ink` brush washes; `blueprint` drafting grid with dimension ticks; `mono` dot-matrix raster; `brief` memo tabs and rules; `editorial` column rules with an ornament.

- [ ] **Step 1: The list.** View where art appears today (explainer hero and deck cover in `dusk`, `press`, `poster` shots); write `lists/art.md` with one line per new style.
- [ ] **Step 2: Tests first.** Replace the fallback test with "every theme has its own style and an unknown theme still throws `ThemeError`". Extend to all nine themes and both modes: byte-identical for equal arguments; under 60 KB at every accepted size including the extreme aspect ratios; one filter at most; only theme colours; ids unique and disjoint across seeds; every `url(#)` resolves. Add: "no two themes give the same bytes for the same seed". Run: red.
- [ ] **Step 3: Implement** one style per module, each under 200 lines; move shared pieces without changing the three existing styles' output (a test pins their bytes for one seed before the move and after).
- [ ] **Step 4: Sync; verify** shared tests, sync check, `E` and `S` suites (they embed art).

### Task 4: make-dashboard

**Rulebook:** `redesign-existing-projects` (decisions 2, 3).

**Files:** `D/template/page.html`, `D/scripts/lib/vega-config.mjs`, `html.mjs`, `kinds.mjs`, `spec.mjs`, new `D/scripts/lib/sparkline.mjs`, `D/references/schema.md`, `D/SKILL.md`, tests.

**Examples:** `minimal.json`, `sales-overview.json`; the nine-theme matrix of `sales-overview`.

**Provisional list (from source).**

1. Chart title: the card `h2` is 17 px, weight 600, body family; it reads as a label. Make it the claim, in the display role, with the description as a quieter deck line under it.
2. Legend: always on top with circle symbols (`vega-config.mjs:17-20`). Direct labels at the line end or on the bar where they fit; the legend stays as the fallback.
3. Grid: axis domain, ticks and grid lines all use `grid` at width 1 (`:11-15`). Drop the domain and ticks on the value axis, keep a lighter grid, keep the zero line.
4. Series palette: the eight categorical colours are used in order. One accent for the series the title is about, greys from the surface steps for the rest, the full palette only above a stated series count.
5. Marks: bars have a 4 px end radius and a 2 px surface stroke; reduce both.
6. KPI tile: label above the value at 14 px, value at 27 px at most in the body family, no trend. Numeral in the display role with `.pa-num`, caps label, optional delta and sparkline (decision 4).
7. Page head: `h1` at 34 px sits close to the 27 px KPI numerals; widen the gap with the new display sizes.

**Interfaces**

- `vegaConfig(colours, font)` keeps its signature and stays self-contained (it is shipped to the page as source). `colours` gains `accent` and the surface steps.
- `sparklineSvg(values, { width, height })` returns one inline SVG path string, no script, numbers only; `[]` or one value returns `''`.
- `kpis[].trend`: `{ query, field }`, both required when present; `query` must name a declared query; unknown name fails validation with `kpis[n].trend.query: unknown query "<x>"; declared: a, b`.

- [ ] **Step 1: The list.** View the before-shots; replace the provisional list in `lists/dashboard.md` (at most ten items). Find how `test/golden/*.json` is written, and whether the dataviz palette validator exists on disk (decision 3).
- [ ] **Step 2: Tests first.** `validate.test.mjs`: "a kpi trend naming an undeclared query fails with the declared names", "a kpi without trend validates as before", "trend carries no SQL text" (a `trend.sql` key is refused as an unknown key). `static-chart.test.mjs` and `kinds.test.mjs`: "the value axis has no domain line", "a single-series chart has no legend", "a line chart with at most N series labels its line ends and has no legend", "a chart above N series keeps the legend". New `sparkline.test.mjs`: "same values give the same path", "one value gives no sparkline", "a non-finite value is skipped, never written". `build.test.mjs`: "a KPI numeral carries `pa-num`", "a KPI with trend renders an svg with no script". Run: red.
- [ ] **Step 3: Implement.** Regenerate the goldens the list covers; name each in the task report.
- [ ] **Step 4: Docs.** `references/schema.md` and `SKILL.md` gain `trend` and one sentence on titles as claims. `theme-guidance.test.mjs` still passes.
- [ ] **Step 5: Verify.** `npm --prefix <abs D> test`; `sync-shared.mjs --check`; the `P/bin` tests. Rebuild and shoot into `after-r1/dashboard/`.
- [ ] **Step 6: Look gate.** Not visible to the gate: the Table view toggle, the export menu, live reload. Those are covered by `interact.test.mjs`, `views.test.mjs`, `live.test.mjs` and the checklist.

### Task 5a: make-diagram, static look

**Rulebook:** `redesign-existing-projects`.

**Files:** `G/scripts/lib/css.mjs`, `sizes.mjs`, `G/template/viewer.html`, tests and goldens.

**Examples:** all six; the nine-theme matrix of `story`.

**Provisional list (from source).**

1. Nodes: a 1.5 px family-hue border on a 10 % tint (`css.mjs:39`, `:76`); every node carries the same weight, so nothing leads. Use a surface step and `--elev-1` for cards; keep the hue for the tile, icon and kind line.
2. Edges: 1.25 px in `text-3`; family-coloured wires compete with nodes. Quieter default wire, hue only on hover, trace and story.
3. Edge labels: a bordered pill on every label (`:35`); drop the border, keep the plate.
4. Labels: node label and group label both at weight 600; kind line and group label both caps at `.08em`. Take sizes and tracking from Task 1's tokens.
5. Groups: 7 % tint box with a hairline; use a surface step.
6. Dim state: `opacity:.25` is abrupt against the new surfaces (shared with 5b).

- [ ] **Step 1: The list** in `lists/diagram.md`; find how `test/golden/` is written.
- [ ] **Step 2: Tests first.** `look.test.mjs` and `theme.test.mjs`: "a card's fill is a surface step and the kind hue still meets 4.5:1 on it" (extends `shared/contrast.mjs`'s `TINT` rule if the tint changes: one number, two places), "edge label plates have no stroke", "the default wire colour is not a family hue". If any SVG text size, weight or tracking changes: `sizes` tests first ("every label of the six examples fits its measured box at the new size"). Run: red.
- [ ] **Step 3: Implement;** re-measure with `P/bin/font-metrics.py` only if a font metric input changed; regenerate goldens on the list.
- [ ] **Step 4: Verify.** `npm --prefix <abs G> test`; `node <abs G>/scripts/check.mjs <page> --json` on each of the six rebuilt pages (a skipped check is reported as skipped); `E` and `S` suites, which embed diagrams (`E/test/diagram*.test.mjs`, `S/test/lift-diagram.test.mjs`).
- [ ] **Step 5: Look gate** on `after-r1/diagram/`.

### Task 5b: make-diagram, a calmer story player

**Rulebook:** `emil-design-eng` (motion; a separate dispatch from 5a).

**Files:** `G/template/story.js`, `transport.js`, `camera.js`, `G/scripts/lib/css.mjs` (state rules only), `G/test/story-unit.test.mjs`, `story-browser.test.mjs`, `transport-unit.test.mjs`.

**Provisional list (from source).** A beat holds 1,800 ms plus 30 ms per caption character (`story.js:21-22`); speeds are 0.5, 1, 1.5, 2. On a beat, the wire goes to 3 px accent, everything else to 25 % opacity, and the camera moves, all at once. "Calmer" means fewer things changing in the same instant, a softer dim, and a camera that settles before the caption changes.

- [ ] **Step 1: The list** in `lists/diagram-player.md`, written after playing `story` and `sequence` in a browser through the existing browser suite's helpers (one browser run). State each timing as a named constant.
- [ ] **Step 2: Tests first.** `story-unit.test.mjs`: "the caption changes after the camera move ends", "every duration still divides by the speed", "under reduced motion a beat is applied at once with no timers beyond the hold". `story-browser.test.mjs`: "with `prefers-reduced-motion: reduce` no element has a running transition during a beat". Run: red.
- [ ] **Step 3: Implement;** no new control, no change to the story spec format.
- [ ] **Step 4: Verify** `npm --prefix <abs G> test`. Add to the manual checklist: play one story at 1x and 2x and judge the pace; `shot.mjs` cannot show it.

### Task 6: make-explainer

**Rulebook:** `redesign-existing-projects`.

**Files:** `E/template/base.css`, `flavors.css`, `deck-flavors.css`, `slides.html`, `E/scripts/lib/slides.mjs`, `sections.mjs`, `schema.mjs`, new `E/scripts/lib/render/quote.mjs`, `E/references/sections.md`, `schema.md`, tests and goldens.

**Examples:** all seven; the nine-theme matrices of `concept` and `slides`.

**Provisional list (from source).**

1. Hero: `h1` at 40 to 60 px, weight 600, with the summary card directly under it on a left rule (`base.css:28-57`). Larger display size from Task 1, more air above the card, the meta chips quieter.
2. Section rhythm: visual sections alternate onto a surface band (`.sec-alt`); text sections all have the same top spacing. Vary the spacing by section role and use the surface steps for bands.
3. Cards: 1 px border, 10 px radius, 16 px padding, heading at body size (`:152-159`). Surface step, `--elev-1`, heading in the strong weight, tone as a top rule and not a full border.
4. Pull quotes: none exist (decision 5). A `quote` section: display face, hanging mark, attribution in caps.
5. KPI row: already uses the display face at 34 px; add `.pa-num` and the caps label.
6. Deck title slide: `h1` at 2.3 to 4.2 rem with a subtitle (`slides.html:44-46`); give it the hero's display size and the theme's art for all nine themes (Task 3).
7. Deck closing slide: an ordinary content slide today (decision 6).

**Interfaces**

- Section `quote`: `{ type: "quote", text*, by?, tone? }`; `text` and `by` under the lint budgets of `E/scripts/lib/budget.mjs`; rendered as `<figure class="quote"><blockquote>…</blockquote><figcaption>…</figcaption></figure>`; in a deck it is one slide.
- `slides.mjs`: the last slide gets class `slide-close` when its section is a `tldr`, `callout` or `quote`.

- [ ] **Step 1: The list** in `lists/explainer.md` (page and deck separately, at most ten items each).
- [ ] **Step 2: Tests first.** `spec.test.mjs`: "a quote needs text", "an unknown key in a quote is refused with did-you-mean". `render.test.mjs`: "a quote renders a figure with a blockquote and escapes its text". `lint.test.mjs`: "a quote over its budget warns with its path". `slides.test.mjs`: "the last slide of a deck ending in a tldr has slide-close", "a deck ending in a table does not". `golden.test.mjs`: goldens for the list's items, updated through its switch. `flavor.test.mjs`: every flavor still styles the hero and the cover. A print test: "no box-shadow in the print rules". Run: red.
- [ ] **Step 3: Implement.** `base.css` is 349 lines and `flavors.css` 262: if either would pass 400, the quote and card rules go in a new stylesheet loaded by `page.mjs`.
- [ ] **Step 4: Docs.** `references/sections.md`, `schema.md` and `SKILL.md` gain `quote`; `E/test/labels.test.mjs` and `P/bin/test/theme-guidance.test.mjs` still pass.
- [ ] **Step 5: Verify.** `npm --prefix <abs E> test` (alone); `node <abs E>/scripts/check.mjs <page> --json` on each rebuilt example; sync check.
- [ ] **Step 6: Look gate** on `after-r1/explainer/`. Not visible to the gate: slides after the first, the plan page's answer controls, the checklist's saved progress. Covered by `slides-browser`, `plan-browser`, `checklist-browser` and the manual checklist (page through one deck in each of three themes).

### Task 7a: make-scene, static look

**Rulebook:** `redesign-existing-projects` for label type and page chrome. Lighting, materials and fog have no row in `design-router`; they are judged by the look gate and the list, with no rulebook.

**Files:** `S/template/runtime/render.js`, `theme.js`, `colour.js`, `chrome/labels.js`, `S/template/page.css`, the generated bundle, tests.

**Examples:** all six; `city` in three themes (one light-first, `dusk`, `poster`).

**Provisional list (from source).**

1. Lighting: a hemisphere light at 1, a sun at 1 and an ambient at 0.12 (`render.js:212-216`), with a night variant; flat, with little form shadow. A key and fill with a clear ratio, and a rim for the night variant.
2. Materials: roughness 1, 0.82 or 0.92 and almost no metalness everywhere (`:233-409`); every world reads as matte plastic. Two or three material roles (ground, mass, accent) with distinct roughness.
3. Fog: linear, set by `retint`, none in space (`:202`). Tune near and far to the scene extent so depth reads without hiding far labels.
4. Labels: DOM labels in `chrome/labels.js`; take size, weight and caps style from Task 1; numerals with `.pa-num`.
5. Page chrome (`page.css`, 96 lines): panels and the legend on a surface step with `--elev-1`.

- [ ] **Step 1: The list** in `lists/scene.md`. Find whether `scripts/check.mjs` can write a canvas PNG (decision 10) and how the Task 0 scene shots came out.
- [ ] **Step 2: Tests first.** `runtime-colour.test.mjs`: "retint sets the fog colour from the theme in both modes", "fog near and far scale with the extent". A render unit test: "lights and materials come from named constants, one set per sky". `page.test.mjs`: "labels carry the shared caps and numeral classes". `bundle.test.mjs` stays green only after `npm run bundle`. Run: red.
- [ ] **Step 3: Implement; bundle.**
- [ ] **Step 4: Verify.** `npm --prefix <abs S> test`; `node <abs S>/scripts/check.mjs <page> --json` per rebuilt example; `E/test/scene-*.test.mjs` (explainer embeds scenes).
- [ ] **Step 5: Look gate** on what can be shot. If the canvas cannot be captured headless, the gate judges chrome and labels only, says so, and the 3D look goes on the manual checklist with the six example names.

### Task 7b: make-scene, tour camera easing

**Rulebook:** `emil-design-eng` (a separate dispatch from 7a).

**Files:** `S/template/runtime/travel.js`, `chrome/tour.js`, `controls.js` if the camera flight lives there, `S/test/travel-unit.test.mjs`, `tour-unit.test.mjs`, the generated bundle.

**Provisional list (from source).** Travel along a tube uses smoothstep, `u*u*(3-2u)` (`travel.js:6`); under reduced motion a beat is instant (`tour.js:54`). The camera flight between beats is read in step 1.

- [ ] **Step 1: The list** in `lists/scene-tour.md`: the easing of each move, its duration rule, and what stays.
- [ ] **Step 2: Tests first.** `travel-unit.test.mjs`: "the eased position is 0 at 0 and 1 at 1 and never leaves [0, 1]", "speed is zero at both ends", "reverse mirrors forward". `tour-unit.test.mjs`: "under reduced motion every beat is instant" (kept), "a beat's flight time grows with distance and is capped". Run: red.
- [ ] **Step 3: Implement; bundle. Step 4: Verify** `npm --prefix <abs S> test`. Manual checklist: run the `city` tour end to end.

### Task 8: Documents and final verification

**Rulebook:** none.

- [ ] **Step 1:** `P/CHANGELOG.md` under `[Unreleased]`: the new tokens (themes written outside the repo against the old token set still build: say whether they do, from a test), `trend`, `quote`, the closing slide, the six art styles. `P/README.md` and `P/USAGE.md`: only sentences that would now be false. No figure is added.
- [ ] **Step 2:** Every suite of "Suites and checks that exist", one at a time, with counts next to Task 0's baseline. `python3 scripts/sweep_counts.py --check`.
- [ ] **Step 3:** The manual-test checklist gains the items each task named as invisible to the gate.

## Not in this plan

- make-motion (its own plans), the showreel, the site gallery and feature page images (design step 9).
- Director and operator (`docs/superpowers/plans/2026-11-16-pa2-director-operator.md`). That plan adds `scripts/make.mjs` to these four skills; it does not touch the files in this plan's File Structure table except each `SKILL.md`. If both run in parallel, `SKILL.md` edits are serialised by the controller.
- New chart kinds, new diagram kinds, new worlds, new themes.

## Left to the implementer

- The token values, the surface and accent hexes, the elevation numbers, the six art generators' geometry.
- The final per-skill lists (design section 17).
- The series count above which a chart keeps its legend, and the story player's constants.
