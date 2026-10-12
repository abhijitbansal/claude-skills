# make-explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new portable-artifacts skill, `make-explainer`, that renders a typed-section JSON document (often scaffolded from git facts) into one offline, themed, accessible HTML page or slide deck, with presets for branch recap, test checklist, concept explainer and slides, and embeds for make-diagram figures, make-dashboard charts and make-motion video.

**Architecture:** Same spec → validate → build pattern. Section renderers are small pure functions `(section, ctx) -> html` registered in one table; a shared page shell supplies theme CSS, fonts, TOC, runtime. Sibling skills are loaded lazily through `siblings.mjs` only when a section needs them. Deterministic text lint enforces the anti-slop rules. The installer learns `requires` so installing make-explainer installs make-diagram and make-dashboard.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, `ajv@8.20.0`, Playwright 1.64 (dev, browser tests), sibling skills' own dependencies (elkjs via make-diagram, vega/vega-lite/duckdb via make-dashboard) — never duplicated into make-explainer.

**Spec:** `docs/superpowers/specs/2026-10-12-make-explainer-design.md`

## Global Constraints

- Branch `feat/visual-artifacts`. Implementers do **not** commit or push; the controller commits. Stage by path only (never `git add -A`).
- The model writes only JSON; no field accepts HTML/CSS/SVG/JS. Markdown-lite is the only markup: paragraphs, `**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` (http/https only, `rel="noopener noreferrer"`), `- ` lists. Everything else is escaped text.
- Page CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:` plus `; media-src 'self' file: blob:` only when a motion section exists. No network at build or view time.
- Default output `${PA_OUTPUT_DIR:-~/.agent/diagrams}/<slug>.html` (+ `<slug>.assets/` when needed); `--out <file.html|dir>` overrides.
- Shared code (`shared/theme.mjs`, `contrast.mjs`, `text.mjs`, `cli.mjs` incl. `evalLog`, `errors.mjs`) is reused from the skill's synced `shared/` copy; never duplicated.
- Sibling skills resolve as `path.resolve(<make-explainer>, '..', '<name>')`, loaded lazily; a missing sibling is an error that prints the exact `npx skills add abhijitbansal/claude-skills --skill make-explainer <names…>` command.
- Visual rules (same family as make-diagram/make-dashboard): hairline rules, surface cards, one accent, status by icon + label (never colour alone), no gradients/shadows/glow/blur/emoji/accent bars; body 68ch; reduced motion respected.
- Text lint (errors): emoji/Extended_Pictographic, banned phrases (from `references/style.md`), `TODO:`/lorem ipsum placeholders, headings ending in `!`; warning: paragraphs > 120 words.
- Slides budget (errors): ≤ 6 points, ≤ 8 table rows, ≤ 12 code lines, ≤ 80 words per slide.
- Every validator error has a JSON path and the fix; did-you-mean on closed sets.
- `npx skills add … --skill make-explainer make-diagram make-dashboard` must work; inventory (catalog row + `sweep_counts.py --write`) lands with SKILL.md.
- Size budget: a recap example with one diagram and one chart ≤ 600 KB.

## Review Focus

1. **Markdown-lite injection**: `[x](javascript:alert(1))`, raw `<img onerror>`, `**<b>**`, nested/unclosed markers, link text containing `](`. All must come out as inert escaped text. Pin in Task 2.
2. **Checklist state with a renamed or reordered item.** State is keyed by a stable id derived from `group title + item text` (hash), so reordering keeps ticks, and editing an item's text resets only that item. Blocked storage is tolerated. Pin in Task 4.
3. **Slides with a section taller than the viewport** (a long table at 390 px). The slide scrolls inside itself; navigation keys still move between slides when focus is not inside a scrollable region. Pin in Task 5.
4. **Relative paths** (`diagram`, `dashboard`, `video`, `image`) resolve relative to the spec file, must stay inside the spec's folder (like make-dashboard's source rule), and symlinks are refused. Pin in Task 3 (image) and Tasks 6–8.
5. **gather on an unusual repo**: detached HEAD, a base branch that doesn't exist, a rename, a binary file, a path containing spaces. Each gives a clear error or a correct fact, never a crash. Pin in Task 9.

---

### Task 1: Scaffold the skill; installer `requires`; sibling resolver

**Files:** `skills/make-explainer/{SKILL.md (stub), README.md (stub), package.json, package-lock.json, test/smoke.test.mjs}`, `scripts/lib/siblings.mjs`, `test/siblings.test.mjs`; `bin/install.mjs` + `bin/test/install.test.mjs`; CI step; catalog row + sweep (same commit); `node bin/sync-shared.mjs`.

**Interfaces:**
- `package.json`: `{"name":"make-explainer","version":"0.1.0","private":true,"type":"module","license":"MIT","engines":{"node":">=20"},"scripts":{"test":"node --test \"test/**/*.test.mjs\""},"dependencies":{"ajv":"8.20.0"},"devDependencies":{"playwright":"1.64.0"},"portableArtifacts":{"requires":["make-diagram","make-dashboard"]}}`.
- `siblings.mjs`: `siblingDir(name) -> string` (absolute; no existence check), `loadSibling(name, relModule) -> Promise<module>` (throws `SiblingError` with `.command` = the exact `npx skills add …` line when the dir or module is missing), `MISSING_HINT(names) -> string`.
- `install.mjs`: before installing, expand the requested skill list with each skill's `portableArtifacts.requires` (transitively, deduplicated, dependency-first order, cycle → UsageError naming the cycle); print `also installing <name> (required by <skill>)`; unknown required name → UsageError.
- Tests: siblings resolve from a temp layout; missing sibling message exact; installer expands `--skills make-explainer` to `make-diagram,make-dashboard,make-explainer` (order), dedups when listed explicitly, cycle error (fake skills in a temp SKILLS_SRC — refactor `install.mjs` minimally to accept an injectable source dir for tests if needed).

### Task 2: Schema, markdown-lite, text lint, validate CLI

**Files:** `scripts/lib/{schema,spec,markdown,lint}.mjs`, `scripts/validate.mjs`, `references/style.md` (banned phrases with replacements, one per line `phrase → replacement`), tests `test/{spec,markdown,lint,validate-cli}.test.mjs`, fixtures.

**Interfaces:**
- `validateSpec(spec, { dir }) -> Promise<{ ok, errors, warnings }>` — schema (per section type, `additionalProperties:false`, did-you-mean on `type`), limits from the spec table, ids unique, `TODO:` markers anywhere (`sections[3].text: still has a TODO placeholder — replace it with real content`), text lint, slide budget when `mode: 'slides'` or `preset: 'slides'`, file-ref existence + inside-folder rule (Task 3+ add per-type checks via a registry so this task only implements the generic path rule).
- `renderMarkdown(text) -> string` (safe HTML); `lintText(text, path) -> { errors, warnings }`.
- CLI: like make-diagram's validate (`--json`, `EVAL_LOG` via shared `evalLog`, exit 0/1/2, warnings printed but exit 0).
- Tests pin every message; Review Focus 1 vectors.

### Task 3: Page shell, core section renderers, build CLI

**Files:** `scripts/lib/{page,sections,output}.mjs`, `scripts/lib/render/{tldr,text,kpis,cards,table,risks,files,steps,timeline,compare,callout,code,details,image}.mjs`, `template/{page.html,runtime.js,pa-lib.js}`, `scripts/build.mjs`, `references/examples/concept.explainer.json`, tests `test/{render,build,page}.test.mjs`, goldens, `test/helpers/browser.mjs`, `test/browser.test.mjs`.

**Interfaces:**
- Section registry `SECTIONS: Record<type, { render(section, ctx) -> string, assets?(section, ctx) -> Promise<Asset[]>, check?(section, ctx) -> errors }>`; `ctx = { theme, dir, outDir, assetsDir, slug, mode, idFor(section, i) }`.
- `buildPage(spec, { dir, theme, out }) -> Promise<{ html, assets: [{ from, to }] }>`; `build.mjs <spec> [--out] [--theme] [--json]` writes page + copies assets, prints `wrote <abs>` and `open: file://<abs>`.
- Icons in `cards` come from make-diagram's catalog via `loadSibling('make-diagram', 'scripts/lib/icons.mjs')` (only when a card has an icon).
- `image`: png/jpg/webp/svg ≤ 1.5 MB as data URI; svg sanitised (reject if it contains `<script`, `on*=`, `href=` other than `#…`, `<foreignObject`).
- Runtime (page mode): theme toggle (same as dashboard: pre-paint script + "Theme:" label), TOC (≥ 4 sections; active highlight via IntersectionObserver), copy buttons (clipboard API; fallback select-text), heading anchors, rise-in once (reduced-motion off).
- Tests: escaping in every renderer; goldens; browser — example at 1280/390, no console errors/warnings, no overflow, TOC highlights, copy works (Playwright clipboard permission), screenshots viewed.

### Task 4: Checklist section

**Files:** `scripts/lib/render/checklist.mjs`, runtime additions, tests (unit + browser), `references/examples/checklist.explainer.json`.

**Interfaces:** item id = first 10 hex of sha256(`group.title + '\u0000' + item.text`) (computed at build, emitted as `data-id`); state `localStorage['pa-checklist:<key>']` = JSON `{ [id]: true }`; sticky progress bar `done / total` + percentage; per-group tally `n / m`; tags render as labelled chips (`regression` chip text "Regression"); reset button → inline confirm ("Reset all 23 ticks?" Yes/No) — never `window.confirm`; "If something fails" footer from `onFail` (markdown-lite) or a default text.
- Tests: persistence across reload; reorder keeps ticks; edited item resets only itself (Review Focus 2); reset flow; blocked storage (ticks work for the visit, warning chip "Progress won't be saved in this browser"); keyboard (space toggles); screenshot viewed.

### Task 5: Slides mode

**Files:** `scripts/lib/slides.mjs` (budget lint + slide assembly), template slides CSS/runtime, `references/examples/slides.explainer.json`, tests.

**Interfaces:** `mode: 'slides'` → each section a `<section class="slide" id="slide-N">`; title slide from `title/subtitle/meta`; keys ←/→/Space/PgUp/PgDn/Home/End/`O`; outline overlay lists slide titles (click to jump); progress bar; `#slide-N`; resume from `localStorage['pa-slides:<slug>']` (blocked storage tolerated); print CSS one slide per page; inner scroll for tall slides with keys handled per Review Focus 3.
- Tests: budget errors pinned; browser: navigation by keys, deep link, outline, resume, tall slide at 390 px scrolls internally and ←/→ still navigate, reduced motion, screenshots viewed.

### Task 6: Diagram section

**Files:** `scripts/lib/render/diagram.mjs`, runtime overlay presenter, tests, `references/examples/` recap using a diagram.

**Interfaces:** `diagram` = inline object or path (Review Focus 4 rules); calls `loadSibling('make-diagram','scripts/lib/api.mjs')` → `buildDiagram(spec, { theme })` and `viewerRuntime()`; validation of the embedded spec goes through make-diagram's `validateSpec` with errors re-pathed under `sections[i].diagram…`; figure = inline SVG + `diagramCss()` once per page + caption; "Present" opens a full-screen overlay running the diagram runtime's presentation (steps), `Esc` closes; hover tracing inline.
- Tests: embedded spec errors re-pathed; missing make-diagram → `SiblingError` message; browser: hover dims, Present overlay steps, Esc closes, no console errors.

### Task 7: Chart section

**Files:** `scripts/lib/render/chart.mjs`, tests.

**Interfaces:** `dashboard` + `chart` → run make-dashboard's pipeline functions (`loadSiblingFrom('make-dashboard', 'scripts/lib/pipeline.mjs')` → `buildDashboard` or the lower-level `validateSpec`/`runQueries`/`expandCharts`) to get the chart's primary view + rows; inline `data` + kind fields → `expandCharts` on a synthetic spec with a single in-memory result (column types inferred: number → DOUBLE, ISO date string → DATE, else VARCHAR); render static SVG in Node with `vega` + `vega-lite` from make-dashboard's node_modules (`new vega.View(vega.parse(compiled), { renderer: 'none' }).toSVG()`), themed by a config built from the theme tokens (same mapping as make-dashboard's runtime `config()` — extract that mapping into a pure function in make-dashboard `scripts/lib/vega-config.mjs` and use it from both places); `interactive: true` builds the dashboard to `<slug>.assets/<chart-id>/index.html` and adds an "Open interactive dashboard" link.
- Tests: inline-data chart SVG contains marks and axis titles; dashboard-sourced chart; format applied; dark theme config; interactive link + built file exists; Review Focus 4 path rules.

### Task 8: Motion section; make-motion theme option

**Files:** `scripts/lib/render/motion.mjs`, make-motion `scripts/lib/spec.mjs` + render/preview theme plumbing + tests, explainer tests.

**Interfaces:** `video` path → copied to `<slug>.assets/`; `poster` optional (copied); `spec` without `video` → render via `loadSibling('make-motion','scripts/render.mjs')` CLI (child process, `--out <assets>`), error with the make-motion install hint and its own requirements (ffmpeg, Chromium) when unavailable; `<video controls preload="metadata" playsinline>` with relative src; CSP gains `media-src 'self' file: blob:`. make-motion: optional root `theme` → default font family/colours from the shared theme (fonts from make-motion's synced `shared/fonts`); without `theme` output is byte-for-byte unchanged (existing golden/contact-sheet tests unchanged).
- Tests: asset copy + relative src + CSP; missing make-motion hint; make-motion themed contact sheet uses theme font (render-smoke-style test that skips without browser/ffmpeg).

### Task 9: Presets, gather and scaffold

**Files:** `scripts/gather.mjs`, `scripts/scaffold.mjs`, `scripts/lib/{git,presets}.mjs`, tests with a temp git repo fixture builder, `references/examples/recap.explainer.json`.

**Interfaces:** `gather.mjs git [--base main] [--repo .] [--json]` → `{ branch, base, mergeBase, commits: [{ sha, subject }], files: [{ path, change, add, del, binary }], tests: [path], date }`; `scaffold.mjs <recap|checklist|concept|slides> [--facts f.json] [--title t]` → starter spec on stdout (recap: tldr/text/risks with `TODO:`, kpis from facts, files from facts, timeline from commits; checklist: groups by top-level folder of changed files with TODO items, `key` from branch; concept/slides: skeletons). Review Focus 5 cases each tested.

### Task 10: Docs, inventory, eval wiring

SKILL.md (≤ ~120 lines: first use, scaffold-or-write, validate, build, check, report; one short example; section list one line each; "titles state the finding"; presets), README, `references/schema.md`, `references/sections.md`, `references/style.md` (from Task 2), plugin README/USAGE (include make-diagram + make-explainer rows — carried from SP2 Task 1 review), site page, catalog row text, `plugin.json` description; `eval/lib.mjs` `SKILLS.explainer`, `eval/prompts/explainer.json` (8 prompts per spec), `eval/fixtures/seeds/explainer.json`, eval test; fix the SP2 design doc note "direction ignored for sequence" → "rejected for sequence".

### Task 11: Eval and model pin

Same procedure and gate as make-diagram Task 11 (gemma4 first — run with `env -u NODE_USE_SYSTEM_CA` if the harness fix isn't in your checkout — then Haiku and Sonnet; Haiku ≥ 7/8; pin only on pass).
