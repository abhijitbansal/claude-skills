# make-diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new portable-artifacts skill, `make-diagram`, that turns a small JSON topology (architecture, flow, sequence, state) into a laid-out, themed, single-file HTML diagram viewer with hover tracing, presentation mode, animation and export, plus an embedding API for make-explainer.

**Architecture:** Same pattern as make-dashboard: the model writes `*.diagram.json`; `validate.mjs` checks schema, references, icons and geometry; `build.mjs` measures text with committed font metrics, lays out with ELK (or a custom sequence layout), renders SVG, lints geometry, and inlines it with theme CSS, fonts and a small runtime into one HTML file. Shared code (themes, fonts, metrics, text measurement, CLI plumbing, errors) lives in `plugins/portable-artifacts/shared/` and is synced into the skill.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, `ajv@8.20.0`, `elkjs@0.12.0` (build time only), Playwright 1.64 (dev, browser tests), dev-only `lucide-static`, `simple-icons`, `opentype.js`, `@fontsource/*@5.3.0` (for icon catalogs and font metrics, committed outputs).

**Spec:** `docs/superpowers/specs/2026-10-12-make-diagram-design.md` (program decisions in `2026-10-12-make-dashboard-v2-design.md`).

## Global Constraints

- Branch `feat/visual-artifacts`. Implementers do **not** commit or push; the controller commits.
- The model-facing contract is one JSON spec; no field accepts CSS, SVG, HTML, coordinates, colours or URLs.
- Output HTML CSP exactly: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. No network at build or view time.
- Default output: `${PA_OUTPUT_DIR:-~/.agent/diagrams}/<slug>.html`; `--out <file.html|dir>` overrides. Never write elsewhere implicitly.
- Visual rules: hairline `--line` borders, `--surface` fills, `--page` group fills, body font 600 labels, `--text-3` notes, mono only in tooltips/ids, edges orthogonal with 6 px rounded corners, edge labels on a `--surface` plate. Tones colour only the border (1.5 px) and icon. No gradients, shadows, glow, blur, emoji, or accent bars. Shape encodes kind.
- Limits: ≤ 60 nodes, ≤ 120 edges, ≤ 25 steps, label ≤ 48 chars (≤ 2 wrapped lines), note ≤ 60 chars (1 line), edge label ≤ 40 chars, ≤ 12 participants, ≤ 60 messages, group nesting ≤ 3.
- Deterministic builds: same spec + same versions → byte-identical HTML (there is no build timestamp; nothing in the page depends on build time).
- Size budget: ≤ 400 KB per built example.
- Zero runtime npm deps in `shared/`. Dev-only deps never needed at run time (catalogs and metrics are committed files).
- Every validator error has a JSON path and a did-you-mean where a closed set exists.
- Reduced motion disables animation and camera tweening.
- `npx skills add … --skill make-diagram` must work: everything the skill needs at run time is inside `skills/make-diagram/` (including its synced `shared/`).
- New skill inventory: `python3 scripts/sweep_counts.py --write` and the catalog row land in the same commit that adds `SKILL.md`.
- Frontmatter: single-line `key: value`, description 41–1024 chars, no `: ` or ` #` inside values.

## Review Focus

1. **A label or id with HTML/SVG special characters** (`<`, `&`, `"`) must render as text, never markup. Pin in Task 7 (render escaping) and Task 8 (viewer).
2. **Edges between nodes in different nested groups** (architecture, `hierarchyHandling: INCLUDE_CHILDREN`). ELK reports edge coordinates relative to a container. Converting them to absolute coordinates is the classic bug: arrows that start inside the wrong box. Pin in Task 5 with a golden and a geometric assertion (each edge starts on its source box border and ends on its target box border, ±1 px).
3. **Long labels and CJK/emoji text** (characters missing from metrics). Measurement must fall back to a safe average width, never 0, and the lint must catch overflow. Pin in Task 2 and Task 7.
4. **A spec with zero edges, or a single node.** It must lay out, render and present without division by zero in the camera fit. Pin in Task 5 and Task 8.
5. **Presentation steps referencing ids inside collapsed or nested groups.** The camera fits the union of focus boxes including group frames; revealing a node reveals its ancestor groups. Pin in Task 8.

---

### Task 1: Scaffold the skill; shared CLI plumbing; inventory

**Files:**
- Create: `plugins/portable-artifacts/shared/cli.mjs` (moved from `skills/make-dashboard/scripts/lib/cli.mjs`, unchanged API: `UsageError`, `parseCli`, `parseTimeout`, `exitUsage` which sets `process.exitCode = 2`)
- Modify: make-dashboard imports of `./lib/cli.mjs` / `./cli.mjs` → shared copy (`../shared/cli.mjs` from `scripts/`, `../../shared/cli.mjs` from `scripts/lib/`); delete `skills/make-dashboard/scripts/lib/cli.mjs`
- Create: `skills/make-diagram/{SKILL.md, README.md, package.json, package-lock.json}`, `skills/make-diagram/scripts/lib/.gitkeep` is not needed — create `scripts/validate.mjs` placeholder only in Task 4
- Modify: `.github/workflows/test.yml` (make-diagram step), `docs/skills-catalog.md` (row), counts via `python3 scripts/sweep_counts.py --write`
- Run: `node bin/sync-shared.mjs`

**Interfaces:**
- Produces: `shared/cli.mjs` exports `UsageError`, `parseCli(argv, options, usage)`, `parseTimeout(value, fallbackSeconds)`, `exitUsage(error, { json })`.
- Produces: `skills/make-diagram/package.json`: `{"name":"make-diagram","version":"0.1.0","private":true,"type":"module","license":"MIT","engines":{"node":">=20"},"scripts":{"test":"node --test \"test/**/*.test.mjs\""},"dependencies":{"ajv":"8.20.0","elkjs":"0.12.0"},"devDependencies":{"playwright":"1.64.0"}}` (Task 2/3 add their dev deps).

- [ ] **Step 1:** Move `cli.mjs` to `shared/`, repoint make-dashboard imports (grep `cli.mjs` in `skills/make-dashboard`), sync, run make-dashboard `npm test` (must stay green).
- [ ] **Step 2:** Create the skill folder with `package.json` above, `npm install` to produce the lockfile, and a minimal `SKILL.md`:

```markdown
---
name: make-diagram
description: Use when the user wants an architecture diagram, flowchart, sequence diagram or state diagram as a polished offline HTML page with zoom, hover tracing, a step-by-step presentation mode and export; the agent writes a small JSON topology and scripts lay it out with ELK and render it.
argument-hint: what to draw, e.g. "checkout request path from browser to orders DB"
---

# make-diagram

(Workflow lands in Task 10.)
```

- [ ] **Step 3:** `bin/test/frontmatter.test.mjs` must pass for the new skill (run `node --test "plugins/portable-artifacts/bin/test/*.test.mjs"`).
- [ ] **Step 4:** Inventory in the same change: add a `docs/skills-catalog.md` row for make-diagram next to make-dashboard's row (same column format), run `python3 scripts/sweep_counts.py --write`, then `--check`, then `uv tool run pytest tests/pytest/ -q` (or `python3 -m pytest tests/pytest -q`) — must pass. Grep the manual count spots AGENTS.md lists (`docs/features/portable-artifacts.html` prose like "two skills", site index rows) and update word forms.
- [ ] **Step 5:** CI: in `.github/workflows/test.yml` node job add after make-motion:

```yaml
      - name: make-diagram
        working-directory: plugins/portable-artifacts/skills/make-diagram
        run: npm ci && npx playwright install --with-deps chromium && npm test
```

(`npm test` with no test files yet must not fail: add `test/smoke.test.mjs` asserting `package.json` name is `make-diagram`.)

- [ ] **Step 6:** Verify: sync `--check`, shared tests, bin tests, make-dashboard + make-motion + make-diagram `npm test`, sweep `--check`, pytest. Stage.

---

### Task 2: Font metrics and text measurement (shared)

**Files:**
- Create: `skills/make-diagram/scripts/dev/font-metrics.mjs` (dev only)
- Create: `plugins/portable-artifacts/shared/fonts/metrics.json`, `plugins/portable-artifacts/shared/text.mjs`
- Test: `plugins/portable-artifacts/shared/test/text.test.mjs`
- Modify: `skills/make-diagram/package.json` devDependencies: `opentype.js` (exact current version), and the six `@fontsource/*@5.3.0` packages (for their `.woff` files)

**Interfaces:**
- `metrics.json`: `{ "<family>|<weight>": { "unitsPerEm": n, "ascender": n, "descender": n, "lineGap": n, "advance": { "<codepoint>": units }, "fallback": averageAdvanceUnits } }` for every family/weight pair used by any shipped theme (read the theme JSONs to enumerate).
- `shared/text.mjs`: `measure(text: string, { family, weight = 400, size = 14 }) -> number` (px); `wrap(text, maxWidth, font) -> string[]` (word wrap, hard-breaks a single word longer than maxWidth with no hyphen); `lineHeight(font) -> number` (px, `size * 1.3` floor or font metrics, whichever is larger); `fontFor(theme, role) -> { family, weight }`.
- Unknown codepoints (CJK, emoji) use `fallback` × 1.6 for codepoints ≥ U+2E80 and `fallback` otherwise. Never returns 0 for non-empty text.

- [ ] **Step 1: Failing tests** (`shared/test/text.test.mjs`): `measure('', …) === 0`; `measure('Hello', Plex Sans 400 14px)` within 0.5 px of a value you obtain once from Chrome (`ctx.measureText` with the embedded font — record the number and the method in a comment); monotonic (`measure('Hello world') > measure('Hello')`); bold wider than regular; `wrap('Checkout API gateway service', 90, font)` gives ≥ 2 lines each ≤ 90 px; a 60-char single word wraps by hard-break; CJK `'注文データベース'` measures > 0 and ≥ 8 × fallback; every family|weight referenced by every theme exists in metrics.json (drift guard).
- [ ] **Step 2:** `scripts/dev/font-metrics.mjs` reads each `@fontsource/<pkg>/files/<pkg>-latin-<w>-normal.woff` with opentype.js, writes advances for U+0020–U+007E and U+00A0–U+00FF plus `fallback` = mean advance of a–z, A–Z. Output sorted keys, stable JSON (2-space). Run it; commit output to `shared/fonts/metrics.json`.
- [ ] **Step 3:** Implement `shared/text.mjs`. Implement, sync, run tests (quoted glob), verify the Chrome comparison numbers by a one-off Playwright measurement (record in report).

---

### Task 3: Icon catalogs

**Files:**
- Create: `skills/make-diagram/scripts/dev/build-icons.mjs`, `skills/make-diagram/icons/lucide.json`, `skills/make-diagram/icons/brands.json`, `skills/make-diagram/THIRD_PARTY_NOTICES.md`
- Create: `skills/make-diagram/scripts/lib/icons.mjs`, `skills/make-diagram/scripts/icons.mjs` (CLI)
- Test: `skills/make-diagram/test/icons.test.mjs`
- Modify: devDependencies `lucide-static`, `simple-icons` (exact current versions)

**Interfaces:**
- `lucide.json`: `{ "version": "<lucide-static version>", "icons": { "<name>": "<inner svg markup of the 24×24 icon: paths/circles/lines only>" } }` — curated list in `build-icons.mjs` (~250 names covering: infra (server, database, hard-drive, cloud, cpu, network, router, globe, shield, lock, key, users, user, monitor, smartphone, laptop, tablet), data (table, file, files, folder, archive, layers, list, filter, search, git-branch, git-commit, git-merge, git-pull-request), messaging (mail, message-square, bell, inbox, send, rss, radio), compute (box, boxes, package, container, function-square, terminal, code, braces, bot, brain, sparkles), flow (play, pause, square, circle, check, x, alert-triangle, clock, timer, hourglass, repeat, refresh-cw, rotate-ccw, arrow-right, split, merge), money (credit-card, wallet, receipt, shopping-cart, store), misc (settings, wrench, gauge, chart-bar, chart-line, map, calendar, image, video, mic, camera, zap, flag, bookmark, link, external-link, eye, cloud-upload, cloud-download, download, upload, printer, scan, qr-code, fingerprint, building, factory, truck, plane)). Missing names in the installed lucide version → the dev script fails loudly.
- `brands.json`: `{ "version": "<simple-icons version>", "icons": { "<slug>": { "title": "…", "path": "<d attribute>" } } }` — curated ~150 slugs relevant to software (languages, databases, clouds that still exist in Simple Icons, queues, CI, observability, frameworks, SaaS: e.g. postgresql, mysql, sqlite, mongodb, redis, apachekafka, rabbitmq, docker, kubernetes, githubactions, github, gitlab, nginx, cloudflare, vercel, netlify, googlecloud, firebase, supabase, stripe, twilio, slack, openai, anthropic, nodedotjs, deno, bun, python, go, rust, swift, kotlin, typescript, javascript, react, nextdotjs, vuedotjs, svelte, angular, apple, android, linux, ubuntu, grafana, prometheus, datadog, sentry, elasticsearch, snowflake, duckdb, apachespark, terraform, ansible, …). Slugs missing upstream → the dev script prints them and skips (no failure), so the catalog is whatever exists.
- `scripts/lib/icons.mjs`: `iconSvg(ref) -> { kind: 'lucide'|'brand', markup, viewBox }` (throws `IconError` with `.suggestion`); `hasIcon(ref) -> boolean`; `searchIcons(word, limit=12) -> string[]` (refs like `lucide:database`, `brand:postgresql`, ranked: exact, prefix, substring, did-you-mean); `DEFAULT_ICON: Record<kind, string>` covering every kind in every type (Task 4's kinds table).
- `scripts/icons.mjs search <word>` prints matching refs one per line; `scripts/icons.mjs list [lucide|brand]` prints all; unknown subcommand exits 2 listing accepted ones.

- [ ] Tests first: every `DEFAULT_ICON` value resolves; `iconSvg('lucide:databse')` throws with suggestion `lucide:database`; `iconSvg('brand:postgres')` suggests `brand:postgresql`; markup contains no `<script`, `on*=` attributes, `href`, or `style=` (sanitise in the dev script and assert here); `searchIcons('data')` includes `lucide:database`; CLI exit codes.
- [ ] NOTICES: Lucide (ISC licence text, version), Simple Icons (CC0, version, plus "All brand icons are trademarks of their respective owners; use does not imply endorsement").

---

### Task 4: Spec schema and validation (without layout)

**Files:**
- Create: `skills/make-diagram/scripts/lib/schema.mjs` (ajv schema), `scripts/lib/kinds.mjs` (per-type kinds + shapes + default icons), `scripts/lib/spec.mjs` (`loadSpec`, `validateSpec`), `scripts/validate.mjs` (CLI, mirrors make-dashboard's: `--json`, exit 0/1/2, `EVAL_LOG` line per run)
- Test: `test/spec.test.mjs`, `test/validate-cli.test.mjs`, fixtures `test/fixtures/*.diagram.json`

**Interfaces:**
- `TYPES = ['architecture','flow','sequence','state']`; `KINDS[type] = { default, kinds: { <kind>: { shape, icon } } }` exactly per the spec table.
- `validateSpec(spec, { layout = true }) -> Promise<{ ok, errors: {path, message}[] }>`; Task 7 wires `layout: true` to run layout + lint; in this task `layout` is ignored (TODO-free: the parameter is added in Task 7).
- Checks (each with a pinned message test): JSON schema (additionalProperties false at every level, with did-you-mean via shared `formatAjvErrors`); ids unique across nodes+groups (architecture/flow/state) or participants+messages (sequence); every edge/step/frame/note reference exists (did-you-mean over ids); group parent exists, no cycle, depth ≤ 3; kind valid for type (did-you-mean); icon exists (did-you-mean via icons.mjs); length limits (`label is 53 characters; the limit is 48 — shorten it`); count limits; sequence frame messages contiguous (`frames[0].messages: m2 and m5 are not consecutive`); a node's group must be a group id; edges may target a group only in architecture; `direction` not allowed for sequence; `steps[].show` ids exist; `theme` exists (did-you-mean over `listThemes()`).

---

### Task 5: Graph layout with ELK (architecture, flow, state)

**Files:**
- Create: `skills/make-diagram/scripts/lib/layout-graph.mjs`, `scripts/lib/sizes.mjs` (node/label sizing from metrics + shape padding)
- Create: `references/examples/{architecture,flow,state}.diagram.json`
- Test: `test/layout-graph.test.mjs`, `test/golden/*.layout.json`

**Interfaces:**
- `nodeSize(node, kindInfo, theme) -> { width, height, lines: string[], noteLine?: string }` — label wrapped to ≤ 2 lines at max 180 px text width; widths/heights rounded up to even px; minimums per shape (decision diamond: text box × √2; start/end dots 20×20; cylinder +12 px height).
- `layoutGraph(spec, theme) -> Promise<Geometry>`; `Geometry = { width, height, nodes: [{ id, x, y, width, height, shape, lines, noteLine, icon, tone, group, layer }], groups: [{ id, x, y, width, height, label, depth }], edges: [{ id, from, to, points: [{x,y}...], label?: { text, x, y, width, height }, style, both }], layers: string[][] }` — ALL coordinates absolute (top-left origin, 24 px outer margin).
- ELK options (root): `elk.algorithm: layered`, `elk.direction: RIGHT|DOWN`, `elk.edgeRouting: ORTHOGONAL`, `elk.hierarchyHandling: INCLUDE_CHILDREN`, `elk.randomSeed: 1`, `elk.spacing.nodeNode: 32`, `elk.layered.spacing.nodeNodeBetweenLayers: 72`, `elk.spacing.edgeLabel: 6`, `elk.layered.spacing.edgeNodeBetweenLayers: 24`, `elk.padding: [top=40,left=24,bottom=24,right=24]` on groups (top includes label), `elk.edgeLabels.inline: false`. Edge ids default `e<i>`.
- `layers` = node ids grouped by ELK layer index (`elk.layered.layerIndex` via `elk.json.shapeCoords`/`layerId` option `org.eclipse.elk.layered.layering.layerId` if available; otherwise derive by x (RIGHT) or y (DOWN) clustering) — used for auto presentation steps.

- [ ] Tests first: golden geometry per example (written with `PA_WRITE_GOLDEN=1`, reviewed by eye, stored rounded to 0.1 px); determinism (two runs identical); **Review Focus 2:** for a nested-groups fixture, every edge's first point lies on the source node's border and last point on the target's border (±1 px) and no edge point lies inside an unrelated node; no two node boxes overlap; every node inside its group box; single node and zero-edge specs lay out (Review Focus 4); `direction: down` swaps the main axis (first layer has smallest y).

---

### Task 6: Sequence layout

**Files:**
- Create: `skills/make-diagram/scripts/lib/layout-sequence.mjs`, `references/examples/sequence.diagram.json`
- Test: `test/layout-sequence.test.mjs`, golden `test/golden/sequence.layout.json`

**Interfaces:**
- `layoutSequence(spec, theme) -> SeqGeometry = { width, height, participants: [{ id, x, y, width, height, lines, icon, kind, lifeline: { x, y1, y2 } }], messages: [{ id, from, to, kind, label: { text, x, y, width }, points: [{x,y}...], row }], frames: [{ kind, label, x, y, width, height }], notes: [{ text, x, y, width, height }], rows: number }`.
- Column gap = max(64, widest label between adjacent participants + 32); row height 44 px (self message 2 rows); frame padding 12 px and a label tab; notes span their `over` participants.
- Tests: golden; messages strictly increasing y; reply arrows dashed kind preserved; self message loops right of its lifeline; frame boxes enclose exactly their messages' rows; participants top header aligned; zero messages valid.

---

### Task 7: SVG render, geometry lint, embedding API

**Files:**
- Create: `skills/make-diagram/scripts/lib/render.mjs`, `scripts/lib/shapes.mjs`, `scripts/lib/edges.mjs`, `scripts/lib/lint.mjs`, `scripts/lib/api.mjs`
- Modify: `scripts/lib/spec.mjs` (`validateSpec(spec, { layout: true })` runs layout + lint)
- Test: `test/render.test.mjs`, `test/lint.test.mjs`, `test/api.test.mjs`, goldens `test/golden/*.svg`

**Interfaces:**
- `renderSvg(geometry, spec, { theme, idPrefix = 'd' }) -> string` — one `<svg viewBox="0 0 W H" role="img" aria-labelledby>` with `<title>`/`<desc>`; `<defs>` arrow markers; groups → nodes → edges → edge labels in z-order (edges under nodes except labels); every node `<g class="pa-node pa-kind-<kind> pa-tone-<tone>" data-id tabindex="0" aria-label="<label>: <kind>">`, every edge `<g class="pa-edge pa-edge-<style>" data-id data-from data-to>`; classes only, colours come from CSS variables in a `<style>` block emitted by `diagramCss()`; all text escaped (Review Focus 1); icons scaled to 18 px.
- `diagramCss() -> string` — the classes above using `var(--line)`, `var(--surface)`, etc.; animation keyframes for `.pa-animate .pa-edge path` (dash flow) inside `@media (prefers-reduced-motion: no-preference)`.
- `lintGeometry(geometry) -> {path, message}[]` — node overlap, edge label overlapping a node, text wider than box (using `measure`), node outside its group, payload size check is separate (Task 8).
- `api.mjs`: `buildDiagram(spec, { theme }) -> Promise<{ svg, css, width, height, steps, ids }>` where `steps` = spec steps or auto steps from `layers` (`[{ title: 'Step n', show: [...ids], focus: [...] }]`, auto titles name the layer's first node: `"<Label> and 2 more"`); `viewerRuntime() -> string` (from Task 8; export a stub that Task 8 fills is NOT allowed — implement `viewerRuntime` in Task 8 and add it to `api.mjs` then; in this task `api.mjs` exports `buildDiagram` only).
- Tests: render goldens per example (byte-for-byte, no normalising); escaping (`label: '<b>&"x"'` appears escaped, no `<b>` element); markers referenced exist; lint RED proof: inject overlapping geometry → errors with node ids; `validateSpec` with layout surfaces lint errors with spec paths (`nodes[3].label: text is 212 px wide; the box fits 180 px — shorten the label`); CJK label overflow caught (Review Focus 3).

---

### Task 8: Viewer HTML, runtime and build CLI

**Files:**
- Create: `skills/make-diagram/template/viewer.html`, `template/viewer.js`, `scripts/lib/viewer.mjs` (page assembly), `scripts/lib/output.mjs` (output path rules), `scripts/build.mjs`
- Modify: `scripts/lib/api.mjs` (+ `viewerRuntime()`)
- Test: `test/build.test.mjs`, `test/output.test.mjs`, `test/browser.test.mjs`, `test/helpers/browser.mjs` (copy the make-dashboard helper pattern: bundled Chromium, then system Chrome, skip otherwise)

**Interfaces:**
- `resolveOutput({ out, title, env = process.env, home = os.homedir() }) -> string` (absolute `.html` path): `--out` ending in `.html` → that file; `--out` dir → `<dir>/<slug>.html`; else `${env.PA_OUTPUT_DIR || <home>/.agent/diagrams}/<slug>.html`; slug = lowercase `[a-z0-9-]`, ≤ 60 chars, fallback `diagram`.
- `build.mjs <spec> [--out p] [--theme name] [--json]`: validate (with layout+lint) → buildDiagram → page → write (mkdir -p) → prints `wrote <abs path>` and `open: file://<abs path>`; `--json` prints `{ ok, out }`; exit 0/1/2 like make-dashboard. Payload > 400 KB → error.
- Page: CSP meta (Global Constraints), theme CSS (`themeCss`) + `diagramCss()`, pre-paint theme script (same as make-dashboard), toolbar markup, the SVG, hidden text alternative (`<section class="sr-only" aria-label="Diagram as text">`: nodes by group, edges "A → B: label", messages in order for sequence), JSON data block (`steps`, `ids`, adjacency, `animate`), inlined `viewer.js`. `window.paReady = true` once ready.
- Runtime behaviour (each pinned by a browser test): zoom (wheel, `+`/`-`, buttons, clamp 0.25–4×), pan (drag, arrow keys), fit (`F`, double-click, button; zero-size safe — Review Focus 4); hover/focus highlight (node + incident edges + neighbours; others get `.pa-dim`), click pins, `Esc` clears; Tab order = layer order; presentation (`P`/button): caption panel with title/note/`n / N`, next/prev via arrows/Space/click, hidden-until-revealed, revealing a node reveals its ancestor groups (Review Focus 5), camera animates viewBox to focus bbox + 48 px padding over 300 ms (instant when reduced motion), `#step-N` deep link, `Esc` exits; animate toggle (`A`/button; label "Reduced motion" and disabled when the media query matches); export SVG/PNG (surface-filled, same approach as make-dashboard Task 7); theme toggle ("Theme: Auto|Light|Dark", `localStorage` `pa-theme`, blocked storage tolerated).
- Tests: build writes to `--out`; default path uses `PA_OUTPUT_DIR` (set in test, never touches the real home); CSP string exact; page ≤ 400 KB for each example; no `http` URLs outside vendored nothing (there is no vendor here: assert no `http://`/`https://` anywhere except in NOTICES-free page); browser: every example renders at 1440 and 390 with no console errors and no page overflow; text inside node boxes via `getBBox` (tolerance 2 px); hover dims non-neighbours; Tab focuses first node; presentation steps + deep link + group reveal; reduced motion (Playwright `reducedMotion: 'reduce'`) disables animation; exports download; theme toggle + blocked storage; screenshots of each example in light and dark saved to the test temp dir and viewed by the implementer.

---

### Task 9: `check.mjs` and size budget

**Files:**
- Create: `skills/make-diagram/scripts/check.mjs`, reuse `test/helpers/browser.mjs` logic in `scripts/lib/browser.mjs` (runtime-optional: dynamic `import('playwright')`, clear message when absent)
- Test: `test/check.test.mjs`

**Interfaces:**
- `check.mjs <page.html> [--json]`: opens the page at 1440 and 390 px; fails (exit 1, one line per problem) on console errors, page overflow, text overflowing a node box (> 2 px), or presentation not reaching the last step; exit 0 prints `check: ok (2 viewports, N steps)`; when no browser is available prints `check: skipped (no browser; run: npx playwright install chromium)` and exits 0 — so a cheap model can always run it.
- Tests: a good page passes; a doctored page (inject a too-wide label by editing the SVG text) fails with the node id; skip path when playwright import is forced to fail (env `PA_NO_BROWSER=1`).

---

### Task 10: Docs, examples, inventory, eval wiring

**Files:**
- Modify: `skills/make-diagram/SKILL.md` (full workflow, ≤ ~110 lines), `README.md`, create `references/schema.md`, `references/kinds.md`
- Modify: `plugins/portable-artifacts/README.md`, `USAGE.md`, `docs/features/portable-artifacts.html` (copy-button rule), `docs/skills-catalog.md` row text, `plugin.json` description
- Modify: `plugins/portable-artifacts/eval/lib.mjs` (`SKILLS.diagram = { dir: 'make-diagram', spec: 'diagram.json', outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/diagram.html')], artifacts: ['out/diagram.html'] }`), `eval/run-eval.mjs` usage text (`--skill dashboard|motion|diagram`), `eval/prompts/diagram.json` (8 prompts: 2 per type, one edit prompt with `seed: "seeds/diagram.json"`), `eval/fixtures/seeds/diagram.json`, `eval/test/lib.test.mjs` (the new entry)

SKILL.md workflow (the model's whole job):
1. First use: `npm ci --omit=dev --prefix <skill-dir>`.
2. Pick the type; write `diagram.json` (show one short architecture example and one sequence example; list kinds per type on one line each; "labels are nouns, edge labels are verbs"; "≤ 12 nodes per diagram reads best; split big systems"). Find icons with `node <skill-dir>/scripts/icons.mjs search <word>`.
3. `node <skill-dir>/scripts/validate.mjs diagram.json` until `valid` (errors name the path and the fix).
4. `node <skill-dir>/scripts/build.mjs diagram.json` (prints the output path; default `~/.agent/diagrams/`, `--out` to choose).
5. `node <skill-dir>/scripts/check.mjs <printed path>` (skips cleanly without a browser).
6. Report the path, what the diagram shows, and that `P` presents it step by step.
Degraded mode and the security note (labels are escaped; no URLs; offline).

---

### Task 11: Eval and model pin

Same procedure as make-dashboard Task 10: run `node run-eval.mjs --skill diagram --host codex-oss --model gemma4`, then (user-approved) `--host claude --model haiku` and `--model sonnet`; write `eval/results/summary-diagram-<date>.md`; gate Haiku ≥ 7/8 valid builds and median validate runs ≤ 2; pin `model: haiku` + `effort: low` in SKILL.md only on pass; otherwise fix the SKILL.md wording / error messages the failures point at and rerun the failing prompts.
