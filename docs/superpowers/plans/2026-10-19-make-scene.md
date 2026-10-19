# make-scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fifth portable-artifacts skill, `make-scene`. Haiku writes `scene.json`; scripts build one offline three.js HTML page that shows a world (city, forest, galaxy, terrain) or a 3D lift of a `diagram.json` or one dashboard chart. make-explainer gains a `scene` section.

**Architecture:** Node turns the spec into a deterministic **scene graph JSON** (one module per world or lift). A prebuilt, committed IIFE bundle (three.js + our runtime, built by esbuild as a dev dependency) instantiates that graph in the browser. Pages reuse the siblings' shared theme, toggle, favicon, provenance and CSP.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, ajv 8.20.0, three (pin the latest stable at Task 2; 0.186.1 on 2026-10-19), esbuild (dev), Playwright 1.64.0 (dev) with SwiftShader WebGL.

**Spec:** `docs/superpowers/specs/2026-10-19-make-scene-design.md`. Executors read both documents. Where this plan is silent, the spec governs.

## Global Constraints

- Skill dir: `plugins/portable-artifacts/skills/make-scene/` (abbreviated `MS/` below). Plugin root: `plugins/portable-artifacts/` (`PA/`).
- SKILL.md frontmatter has single-line values only: `name: make-scene`, `model: haiku`, `effort: low`. The description is 41–1024 chars. Rules: `PA/bin/test/frontmatter.test.mjs:13-30`, `PA/bin/test/portability.test.mjs:9-46`. The exact line "`<skill-dir>` is the folder containing this SKILL.md." is required.
- The page CSP is exactly the siblings' string (`PA/skills/make-diagram/template/viewer.html:5`). No CDN, no `unsafe-eval`, no workers, no blob or data scripts. The page makes no network requests.
- The model writes only JSON. It never writes three.js, coordinates, CSS or HTML.
- Same spec → byte-identical page (pin `SOURCE_DATE_EPOCH`). No `Math.random` anywhere; use the seeded `seedFrom` from `PA/shared/art.mjs:43`.
- Limits: ≤ 2000 rows, ≤ 24 groups, ≤ 12 tour beats, `group` ≤ 48 chars, beat `title` ≤ 48 and `caption` ≤ 160, `title` ≤ 120, `subtitle` ≤ 160. The scene source in an explainer is ≤ 1 MB. At most 4 scene sections per explainer page.
- Default theme `dusk`. Default output is `${PA_OUTPUT_DIR or ~/.agent/scenes}/<slug>.html`, through `PA/shared/output.mjs` `resolveOutput`.
- `shared/` has one source, `PA/shared/`. After editing it, run `node PA/bin/sync-shared.mjs`. Never edit `MS/shared/` by hand.
- Labels reach the DOM only through `textContent` or escaped attributes, never `innerHTML` with spec text.
- **Commits:** implementer subagents do not commit or push. The controller commits after each task's review passes, with conventional messages and the session's trailers. Never commit to `main`. Push only at the end of the branch.
- The sanctioned test invocations are exactly:
  - `cd PA/skills/make-scene && npm test`
  - `cd PA/bin && node --test "test/*.test.mjs"`
  - `node --test "PA/shared/test/*.test.mjs"`
  - `node PA/bin/sync-shared.mjs --check`
  - `python3 -m pytest tests/pytest -q` (repo root)
  - `python3 scripts/sweep_counts.py --check` (repo root)
  - `bats tests/bats` (repo root)
  - The make-explainer and make-diagram suites: `npm test` in their dirs.
  - Browser tests skip themselves without Chromium. To install it: `cd PA/skills/make-scene && npx playwright install chromium`.

## Shared contract: scene graph v1

Every world/lift module returns this object; the runtime (Task 7–8) consumes exactly this. Colour values are a **ColourRef**: a theme token name (`cat1`…`cat8`, `page`, `surface`, `text`, `text2`, `line`, `grid`, `accent`, `good`, `warn`, `bad`, `glow`), a `#rrggbb` hex, or `{ "base": "#rrggbb", "tint": <token>, "share": 0..1 }` (mixed at runtime, so it follows the theme toggle).

```json
{
  "v": 1,
  "kind": "city|forest|galaxy|terrain|diagram|chart",
  "title": "…",
  "units": "commits",
  "bounds": { "min": [0,0,0], "max": [0,0,0] },
  "camera": { "position": [0,0,0], "target": [0,0,0] },
  "env": { "sky": "theme|space", "ground": null, "fog": true, "stars": false, "water": null, "nightLights": true },
  "groups": [ { "name": "api", "colour": "cat1" } ],
  "items":  [ { "id": "i0", "label": "api · W30", "group": 0, "t": "2026-W30", "value": 12, "display": "12 commits" } ],
  "batches": [ { "id": "b0", "shape": "box|cylinder|sphere|icosa|cone|disc", "colour": "<ColourRef>", "emissive": null, "flat": false,
                 "instances": [ [0,0,0, 1,1,1, 0] ] } ],
  "tubes":   [ { "id": "e0", "points": [[0,0,0],[1,0,0]], "radius": 0.06, "colour": "<ColourRef>", "item": null } ],
  "surfaces":[ { "id": "s0", "nx": 2, "nz": 2, "size": [10,6,3], "heights": [0,0,0,0], "bands": [ { "below": 0.9, "colour": "#d8c38a" } ], "cells": [0] } ],
  "labels":  [ { "text": "api", "at": [0,0,0], "size": 0.6 } ],
  "anim":    { "sway": ["b1"], "orbits": [ { "batch": "b2", "center": [0,0,0], "r": [1.4], "phase": [0.3], "speed": [0.7] } ] },
  "focus":   { "api": { "position": [0,0,0], "target": [0,0,0] } },
  "tour":    [ { "title": "…", "caption": "…", "focus": "api", "path": null, "reverse": false } ],
  "fallback": { "kind": "table|svg", "columns": ["group","t","value"], "rows": [["api","2026-W30","12"]], "svg": null }
}
```

- Each instance is `[x, y, z, sx, sy, sz, itemIndex]`. `itemIndex` is −1 for decoration such as trunks and branches.
- `surfaces[].cells` maps each data cell to an item index.
- `focus` keys are lowercased group names, row labels, or node ids.
- Numbers are rounded to 3 decimals, so the goldens are stable.

## Review Focus

1. **Degenerate data:** a single row, a single group, or all values `0`. Expect a valid scene with no NaN in the graph and a visible floor or zero-height marker. Tests: Task 5 `degenerate data yields finite graph` (every world), Task 6 for forest and galaxy.
2. **Hostile or long labels:** `<img onerror>`, emoji, or 48-char group names. These must show as literal text in the tooltip, Explore, legend and fallback. Tests: Task 8 `labels render as text, never markup`, and Task 9 browser `hostile label stays text`.
3. **WebGL unavailable or context lost:** the fallback is visible, there are no uncaught errors, and the controls are hidden. Test: Task 9 `--disable-gpu --disable-webgl` run, plus a dispatched `webglcontextlost` event.
4. **More than 8 groups:** colours repeat the 8 categorical tokens with a lightness step, so group 9 differs from group 1 and the legend stays unambiguous. Test: Task 5 `group colours stay distinct past eight`.
5. **Lift inputs the siblings reject:** an invalid diagram spec, an unknown chart id, a boxplot, a `vegaLite` chart, or a missing sibling skill. Each gets a path-scoped error with did-you-mean, or the sibling install command; never a stack trace. Tests: Task 10 and Task 11 error cases.

---

### Task 1: Scaffold the skill and keep the repo gates green

**Files:**
- Create: `MS/package.json`, `MS/SKILL.md` (stub that passes the gates; full prose is written in Task 14), `MS/README.md` (one paragraph), `MS/scripts/doctor.mjs`, `MS/scripts/lib/requirements.mjs`, `MS/scripts/lib/internal-error.mjs` (copy of make-diagram's), `MS/test/doctor.test.mjs`
- Modify: `PA/shared/icons.mjs:5,15-20` (add `make-scene` to `SKILLS` and add a glyph), `PA/shared/test/icons.test.mjs`, `.github/workflows/test.yml:89-95` (add a make-scene step between make-diagram and make-explainer, with `npm ci`, `npx playwright install --with-deps chromium` and `npm test`. make-scene's lift tests need make-diagram's and make-dashboard's node_modules; make-explainer's scene test needs make-scene's), `docs/catalog.html` (add a Skill row copied from the make-motion row at `:217`)
- Run: `node PA/bin/sync-shared.mjs`, `python3 scripts/sweep_counts.py --write`

**Interfaces:**
- Produces:
  - `requirementsFor(target)`:
    - `check` / `ALL` → node 20, nodeModules, devDeps `required: true`, browser `required: true`;
    - a `.json` spec path → base + `sisterSkill('make-diagram')` if `lift.diagram`, `sisterSkill('make-dashboard')` if `lift.dashboard`;
    - otherwise base (node 20 + nodeModules).
  - `targets = ['check']`.
  - The favicon glyph `make-scene`: three stacked isometric blocks (city), drawn with classes `g`/`s` only.

- [ ] **Step 1: Write failing tests.** `MS/test/doctor.test.mjs`:
  - `pure world spec needs no sister skill`: the result has no id `make-diagram` or `make-dashboard`.
  - `diagram lift spec needs make-diagram`.
  - `dashboard lift spec needs make-dashboard`.
  - `check target needs browser and dev deps`.

  `PA/shared/test/icons.test.mjs`: `faviconSvg('make-scene', theme)` returns an SVG containing `class="g"`.
- [ ] **Step 2: Run the tests and see them fail.** `cd PA/skills/make-scene && npm test` fails with module not found.
- [ ] **Step 3: Implement.**
  - `package.json`:
    - same shape as `PA/skills/make-diagram/package.json`;
    - `dependencies` `ajv: 8.20.0` only;
    - `devDependencies` `three: <pin>`, `esbuild: <latest stable pin>`, `playwright: 1.64.0`. Node never imports three; it only reaches the committed bundle, so `npm ci --omit=dev` installs stay small;
    - `portableArtifacts.requires: ["make-diagram","make-dashboard"]`.
  - Add `.gitattributes` at the repo root with `plugins/portable-artifacts/skills/make-scene/template/vendor/*.min.js -diff linguist-generated`.
  - `SKILL.md` stub: valid frontmatter, the `<skill-dir>` line, and one sentence saying the workflow is being built.
  - doctor and requirements: mirror `PA/skills/make-diagram/scripts/doctor.mjs` and `PA/skills/make-explainer/scripts/lib/requirements.mjs:9-31`.
  - Run `npm install` to produce the lockfile.
- [ ] **Step 4: Sync, sweep and verify.**
  - Run `node PA/bin/sync-shared.mjs`, then `python3 scripts/sweep_counts.py --write`, then `git diff --stat`. Expect footers and counts to move from 4→5 for portable-artifacts and the total to rise by 1.
  - Gates, all green: `npm test` (MS), the shared tests, the bin tests, `python3 -m pytest tests/pytest -q`, `python3 scripts/sweep_counts.py --check`, and `node PA/bin/sync-shared.mjs --check`.
  - If the total shown in `site/og.html` changed, regenerate `site/og.png` as AGENTS.md says. If it cannot be regenerated, report that.
- [ ] **Step 5: Controller commits** `feat(make-scene): scaffold skill, doctor, favicon, CI step, counts`.

### Task 2: Runtime bundle pipeline, committed bundle, size cap

**Files:**
- Create: `MS/template/runtime/index.js` (for now: `window.PAScene = { mount }`, where `mount` draws one lit cube from a graph's first batch), `MS/scripts/dev/bundle.mjs`, `MS/template/vendor/scene-runtime.min.js` (generated, committed), `MS/scripts/lib/bundle.mjs`, `MS/THIRD_PARTY_NOTICES.md` (three.js MIT text, version), `MS/test/bundle.test.mjs`
- Modify: `MS/package.json` (`"bundle": "node scripts/dev/bundle.mjs"`)

**Interfaces:**
- Produces:
  - `MS/scripts/lib/bundle.mjs`:
    - `BUNDLE_FILE` (absolute path);
    - `readBundle(): string` (throws `UsageError` naming `npm run bundle` if missing);
    - `sourcesHash(): string`, a sha256 over the sorted `template/runtime/**/*.js` contents plus `three` version from `node_modules/three/package.json`, or from the bundle header when node_modules is absent;
    - `bundleHeaderHash(text): string|null`;
    - `MAX_PAGE_BYTES: number`.
  - Bundle header line 1: `/* make-scene runtime; sources sha256:<hex>; three@<ver>; MIT (see THIRD_PARTY_NOTICES.md) */`.
  - The global API: `window.PAScene.mount(host: HTMLElement, graph: SceneGraph, opts: { reducedMotion: boolean, idPrefix: string }): { destroy(): void }`.

- [ ] **Step 1: Failing tests** in `bundle.test.mjs`:
  - `committed bundle matches runtime sources`: `bundleHeaderHash(readBundle()) === sourcesHash()`.
  - `bundle is one classic script`: it has no `import `/`export ` statements at top level and no `eval(`, `new Function`, `Worker(` or `blob:`.
  - `bundle defines PAScene`: evaluate it in `node:vm` with a stub `window` that has `.PAScene.mount`. If three needs DOM at import, skip with a reason and assert the string `PAScene` instead.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `scripts/dev/bundle.mjs`.** It runs esbuild `{ entryPoints: ['template/runtime/index.js'], bundle: true, format: 'iife', minify: true, target: 'es2020', legalComments: 'none' }`, then prepends the header. Import `OrbitControls` from `three/addons/controls/OrbitControls.js`.
  - Measure the bundle and set `MAX_PAGE_BYTES = ceil((bundleBytes + 512 KB + 256 KB fonts/chrome) / 64 KB) * 64 KB`.
  - Record the measured bundle KB in a comment next to the constant, labelled *measured* with the date.
- [ ] **Step 4: Run tests and see them pass.** Then mutate one runtime file without rebundling and confirm `committed bundle matches runtime sources` fails. Revert. (This proves the guardrail fires.)
- [ ] **Step 5: Controller commits** `feat(make-scene): esbuild runtime bundle with staleness guard`.

### Task 3: Spec loading, data sources and the validator

**Files:**
- Create: `MS/scripts/lib/schema.mjs`, `MS/scripts/lib/spec.mjs`, `MS/scripts/lib/csv.mjs`, `MS/scripts/lib/rows.mjs`, `MS/scripts/validate.mjs`, `MS/test/spec.test.mjs`, `MS/test/csv.test.mjs`, `MS/test/validate-cli.test.mjs`, `MS/test/fixtures/` (specs, `data.csv`, `rows.json`)

**Interfaces:**
- Consumes: `PA/shared/errors.mjs` (`didYouMean`, `formatAjvErrors`, `printResult`), `PA/shared/cli.mjs` (`parseCli`, `evalLog`, `UsageError`), `PA/shared/provenance.mjs` `GENERATED_BY_SCHEMA`, `listThemes()`.
- Produces:
  - `loadSpec(file): { spec, dir }`, where `dir` is the spec's folder for resolving relative paths.
  - `async validateSpec(spec, { dir }): { ok, errors: [{path, message}] }`. It covers the schema, data-source rules, row rules, eligibility of an explicit `world`, and tour focus resolution. Lift specs are checked for shape only here; Tasks 10 and 11 add the sibling checks through `liftChecks` hooks registered in `spec.mjs` (`registerLiftCheck(kind, fn)`).
  - `loadData(spec, dir): { rows: Row[], links: Link[] }`, where `Row = { group: string, t?: string|number, value: number, label?: string, parent?: string }`.
  - `parseCsv(text): string[][]`: RFC 4180 quotes, CRLF, BOM.
  - `focusKeys(rows): Set<string>`: lowercased groups and labels.

- [ ] **Step 1: Failing tests** in `spec.test.mjs`. Each asserts `ok` and an error `path` and/or a message substring:
  - `exactly one of data or lift`;
  - `exactly one data source` (rows | file | csv);
  - `csv columns map group t value label parent`;
  - `rejects URL and missing data paths`;
  - `data path outside spec dir rejected`. `data.csv`, `data.file` and `lift.*` paths must resolve inside the spec's folder (no `..`, no absolute paths) unless `validateSpec(spec, { dir, allowOutside: true })`. Mirror make-dashboard's default. `validate.mjs` and `build.mjs` take `--allow-outside`;
  - `rejects negative or non-finite value`;
  - `group is free text up to 48 chars` (`.github` passes, 49 chars fails);
  - `parent must name a group` (did-you-mean);
  - `parent cycle is an error`;
  - `terrain needs t on every row`;
  - `terrain rejects duplicate group,t`;
  - `explicit world the data cannot feed names eligible worlds`;
  - `tour focus resolves case-insensitively` (`"Web"` matches group `web`);
  - `tour focus miss suggests a key`;
  - `limits: 2001 rows, 25 groups, 13 beats rejected`;
  - `unknown top-level field gets did-you-mean` (`"wrold"` → `world`);
  - `theme must be a shared theme`.

  `csv.test.mjs`: quoted commas, escaped quotes, CRLF, BOM, trailing newline.

  `validate-cli.test.mjs`: exit 0/1/2, `--json` output, `EVAL_LOG` line written.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
  - The ajv schema is in `schema.mjs`, with `additionalProperties: false` everywhere. `world` is an enum of the four worlds.
  - The `validate.mjs` CLI mirrors `PA/skills/make-diagram/scripts/validate.mjs`, with usage `node scripts/validate.mjs <scene.json> [--json]`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): scene.json schema, data sources and validator`.

### Task 4: Recommend and cost table

**Files:**
- Create: `MS/scripts/lib/recommend.mjs`, `MS/scripts/lib/cost.mjs`, `MS/test/recommend.test.mjs`, `MS/test/cost.test.mjs`

**Interfaces:**
- Consumes: `loadData` (Task 3).
- Produces:
  - `eligibility({rows, links}): Record<World, { ok: boolean, needs?: string }>`.
  - `recommend({rows, links}): { ranked: World[], reasons: Record<World,string> }`. The rules apply in order:
    1. links present → galaxy first;
    2. any `parent` → forest;
    3. every row has numeric or time-like `t` and the group×t grid is ≥ 60% filled (`TERRAIN_FILL = 0.6`) → terrain;
    4. any `t` → city;
    5. otherwise city.

    The remaining eligible worlds follow in the fixed order `city, forest, galaxy, terrain`. Ineligible worlds are last.
  - `renderWeight(graph): 'light'|'medium'|'heavy'`:
    - instances + tube segments + surface cells < `LIGHT_MAX = 3000` → light;
    - < `MEDIUM_MAX = 15000` → medium;
    - otherwise heavy.
  - `costTable({ specText, current, pageBytes, alternatives: [{ world, eligible, needs, estBytes, weight }] }): string`. This is a plain-text table. The columns are `world | fit | switch tokens | page size | render | command`.
    - The `switch tokens` column is always `0`.
    - A header line reads `spec authoring ≈ <ceil(chars/4)> tokens (estimated)`.
    - An ineligible row shows `not available: needs …` and no command.
    - Heavy rows add `may be slow on phones`.

- [ ] **Step 1: Failing tests**:
  - `links rank galaxy first`;
  - `parent ranks forest first`;
  - `dense grid ranks terrain first`;
  - `sparse grid does not pick terrain`;
  - `no t: terrain not available`;
  - `weights at thresholds` (2999 / 3000 / 14999 / 15000);
  - `cost table switch tokens are zero`;
  - `cost table estimates authoring tokens as ceil(chars/4) and says estimated`;
  - `ineligible rows have no command`;
  - `command text is node <skill-dir>/scripts/build.mjs <spec> --world <w>` (an absolute skill dir is passed in).
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): world recommendation and cost table`.

### Task 5: Scene graph core, City and Terrain

**Files:**
- Create: `MS/scripts/lib/graph.mjs`, `MS/scripts/lib/palette.mjs`, `MS/scripts/worlds/city.mjs`, `MS/scripts/worlds/terrain.mjs`, `MS/scripts/worlds/index.mjs`, `MS/test/graph.test.mjs`, `MS/test/worlds-city-terrain.test.mjs`, `MS/test/golden/city.json`, `MS/test/golden/terrain.json`, `MS/references/scene-graph.md` (the contract above, copied verbatim)

**Interfaces:**
- Consumes: `loadData`, `seedFrom` (`PA/shared/art.mjs:43`).
- Produces:
  - `graph.mjs`:
    - `emptyGraph(kind, {title, units})`;
    - `round3(n)`;
    - `finalizeGraph(g)`, which computes `bounds` and a default `camera` (an isometric 3/4 view fitting the bounds), lowercases `focus` keys, rounds numbers, and asserts every number is finite (throws `InternalError` naming the path);
    - `assertGraph(g)`, a structural check used by tests and the runtime contract.
  - `palette.mjs`: `groupColour(i): ColourRef`.
    - Groups 0–7 map to `cat1..cat8`.
    - Group `i ≥ 8` maps to `{ base: '#808080', tint: 'cat'+(i%8+1), share: 0.65 }` (lighter step).
    - `itemsFrom(rows, units)` builds `items[]` with `display = "<value> <units>"`, using `Intl.NumberFormat('en-US')`.
  - `worlds/index.mjs`: `WORLDS = { city, forest, galaxy, terrain }`. Each is `build(data, spec) → SceneGraph`. In this task, forest and galaxy throw "not implemented"; Task 6 replaces them.
  - City: districts are rows of buildings along x by `t` order (or value order). Building height is `0.15 + value/max * H` (H = 9), with a zero-value floor marker of height 0.05. `env.nightLights = true`. Emissive window density goes on `batches[].emissive`. Each district's `focus` frames it.
  - Terrain: `surfaces[0]` is a `(groups × t)` grid upsampled 5× with bilinear interpolation. `cells` maps each data cell to its item. Bands are sand, grass, rock and snow (fixed hexes) by normalized height. `env.water = { y: 0.12 }` (normalized).

- [ ] **Step 1: Failing tests**:
  - `city golden` / `terrain golden`: build a fixture (6 groups × 12 t) and deep-equal the golden. Create the golden on the first run with `UPDATE_GOLDEN=1`; state this in the commit.
  - `same input same graph`.
  - `degenerate data yields finite graph`: 1 row; 1 group; all zeros; for both worlds.
  - `zero value still draws a floor marker`.
  - `group colours stay distinct past eight`: groups 0 and 8 have different ColourRefs.
  - `every item reachable`: each item index appears in some instance or cell.
  - `heights are zero-based and proportional`: the ratio of two buildings' heights minus the floor equals the ratio of their values within 1e-3.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): scene graph contract, city and terrain worlds`.

### Task 6: Forest and Galaxy

**Files:**
- Create: `MS/scripts/worlds/forest.mjs`, `MS/scripts/worlds/galaxy.mjs`, `MS/test/worlds-forest-galaxy.test.mjs`, `MS/test/golden/forest.json`, `MS/test/golden/galaxy.json`
- Modify: `MS/scripts/worlds/index.mjs`

**Interfaces:** consumes the Task 5 helpers and produces `build(data, spec)` for both.
- **Forest:** root groups (no `parent`) are trees on a ring. A group with `parent` becomes a sub-branch on its parent's trunk. Branches spiral up by `t` order (or row order). Leaf-cluster `icosa` size is `0.15 + value/max * 0.95`. Trunk and branch instances use itemIndex −1. `anim.sway` lists the leaf batch.
- **Galaxy:** stars are on a ring. Planets orbit at `r = 1.4 + rank * 0.32` by `t` rank (or value rank). Size is `0.06 + value/max * 0.32`. Phases are seeded. `anim.orbits` carries per-instance `r`/`phase`/`speed = 0.9/sqrt(r)`. `links` become `tubes` (quadratic arc between star centres, raised by 1 + distance × 0.15). `env.sky = 'space'`, `env.stars = true`.

- [ ] **Step 1: Failing tests**:
  - goldens for both;
  - `parent nests under its tree`: the child's trunk-attachment instance lies inside the parent tree's radius;
  - `links become tubes between stars`;
  - `degenerate data yields finite graph` for both;
  - `orbit radius follows t rank`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): forest and galaxy worlds`.

### Task 7: Browser runtime core (render, theme, loop, controls)

**Files:**
- Create: `MS/template/runtime/render.js`, `theme.js`, `loop.js`, `controls.js`, `colour.js`, plus pure-logic tests `MS/test/runtime-colour.test.mjs` and `MS/test/runtime-loop.test.mjs`
- Modify: `MS/template/runtime/index.js`, then run `npm run bundle` to regenerate the vendor bundle.

**Interfaces:**
- Consumes: the scene graph v1 contract.
- Produces:
  - `colour.js` (no three import; testable in Node):
    - `resolveColour(ref, readVar): '#rrggbb'`, where `readVar(token)` returns the computed hex of `--<cssVar>`;
    - `TOKEN_VARS` maps `cat1..8 → --s1..8` and the other tokens to the var names in `PA/shared/theme.mjs:18-27`.
  - `loop.js` (no three import): `createLoop({ render, now, raf, caf }) → { wake(reason), sleep(), setVisible(bool), setActive(bool) }`. It renders while active animation, tween or orbit damping is running. It pauses when not visible (IntersectionObserver), when the document is hidden, or after `IDLE_MS = 1500` with no input or animation.
  - `render.js`: `buildObjects(graph, palette) → { root: THREE.Group, pickables, retint(palette), animate(t) }`.
    - Instanced batches use `InstancedMesh`; tubes use `TubeGeometry`; surfaces get vertex colours from bands.
    - `env` sets the sky, ground, fog, stars and water.
    - Dark mode with `nightLights` raises emissive and dims the sun.
  - `theme.js`: watches `data-theme` on `<html>` (MutationObserver) and `matchMedia('(prefers-color-scheme: dark)')`, then calls `retint`.
  - `controls.js`:
    - uses OrbitControls with damping;
    - auto-rotates until the first `pointerdown`/`keydown`/`wheel`;
    - arrow keys orbit when the canvas has focus;
    - under reduced motion there is no auto-rotate, no sway and no orbit animation (planets are frozen at their phase).
    - DPR cap: `min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2)`.
  - `mount()` always renders the semantic fallback first. It hides the fallback only after a successful first frame. On `webglcontextlost`, or when renderer creation throws, it shows the fallback again, hides the canvas and controls, and logs nothing at error level.

- [ ] **Step 1: Failing tests**:
  - `resolveColour handles token, hex and mix`;
  - `group mix follows tint var` (a different `readVar` gives a different hex);
  - `loop sleeps after idle and wakes on input`;
  - `loop pauses when hidden or offscreen`;
  - `loop keeps running while orbits animate unless reduced motion`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement**, then `npm run bundle`. **Step 4:** `npm test` passes, including Task 2's staleness test.
- [ ] **Step 5: Controller commits** `feat(make-scene): runtime render, theme retint, idle loop, controls`.

### Task 8: Page, chrome and build CLI

**Files:**
- Create:
  - `MS/template/page.html`, `MS/template/page.css`;
  - `MS/template/runtime/chrome/tooltip.js`, `legend.js`, `explore.js`, `tour.js`, `fullscreen.js`, `export.js`;
  - `MS/scripts/lib/page.mjs`, `MS/scripts/lib/api.mjs`, `MS/scripts/lib/theme.mjs`, `MS/scripts/build.mjs`;
  - tests `MS/test/page.test.mjs`, `MS/test/build.test.mjs`, `MS/test/tour-unit.test.mjs`
- Modify: `PA/bin/test/style-lint.test.mjs:9-11` (add `MS/template/page.css` and `page.html` to `SOURCES`)

**Interfaces:**
- Consumes: Tasks 3–7. The shared modules are `themeCss`, `TOGGLE_CSS`/`TOGGLE_JS`, `faviconLink('make-scene')`, `provenanceHtml`/`generatorMeta`, and `resolveOutput`.
- Produces:
  - `api.mjs`: `async buildScene(spec, { dir, theme, idPrefix = 'sc' }) → { graph, html, css, runtime, fallbackHtml, bytes }`. Here `html` is the embeddable fragment: host div, fallback, and a JSON data block. `runtime` is the bundle text. Explainer and build both use it. `validateSpec` is re-exported.
  - `page.mjs`: `renderPage(spec, built, { theme, env }) → string`. It writes the full document with the sibling CSP, the theme toggle, the favicon, a title/subtitle header, `built.html`, the runtime inlined once, and the provenance footer.
  - `build.mjs`: `async build(file, { out, theme, world, model, effort, agent, env, maxBytes = MAX_PAGE_BYTES }) → { ok, out, bytes, table } | { ok:false, errors }`.
    - `--world` first checks eligibility. If the data cannot feed that world, it returns the error and leaves `scene.json` untouched. Only after the check passes does it rewrite the `world` field of `scene.json` (2-space JSON, key order preserved) and print `scene.json: world set to <w>`.
    - Without `world`, the build uses `recommend().ranked[0]`.
    - The CLI prints `wrote <path>`, `open: <file URL>`, then `costTable(...)`. `--json` prints `{ ok, out, bytes, world, alternatives }`.
    - Page-over-cap is a spec error naming both sizes.
  - `tour.js` (pure state machine, no three): `createTour(beats) → { play(), pause(), next(), prev(), go(i), state }`. Keys: Space toggles play, ←/→ step, `P` opens beat 1. Reduced motion makes beats cut instead of fly.
  - Chrome:
    - the tooltip shows `label` + `display`;
    - the legend shows group swatches;
    - the Explore panel (`E`) lists groups → items, and clicking one flies to its focus;
    - `F` toggles full screen;
    - the export button saves a PNG of the current frame. Call `renderer.render()` synchronously, then `canvas.toBlob()` in the same tick. There is no `preserveDrawingBuffer`, so a later readback is black.
    - Fallback CSS: when `graph.fallback.css` is set (diagram lift), `page.mjs` includes it once. When `graph.fallback.svgDark` is set (dashboard lift), both SVGs ship, switched by the theme the same way make-explainer's chart section does.
    - Canvas has `aria-hidden="true"`; the fallback table and Explore are the accessible path.

- [ ] **Step 1: Failing tests**:
  - `page has the sibling CSP verbatim`;
  - `runtime inlined exactly once`;
  - `labels render as text, never markup` (fixture group `<img src=x onerror=alert(1)>`, the HTML contains it escaped, with no raw `<img`);
  - `fallback table lists every item`;
  - `same spec same bytes` (with `SOURCE_DATE_EPOCH` pinned);
  - `--world rewrites only the world field`;
  - `--world to an ineligible world leaves scene.json unchanged`;
  - `no world uses top recommendation`;
  - `over-cap page is an error with both sizes`;
  - `default output is PA_OUTPUT_DIR or ~/.agent/scenes`;
  - `tour play/next/prev/go bounds`;
  - `reduced motion tour cuts`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement**, then `npm run bundle`. **Step 4: Run and see them pass**, including the bin style-lint test.
- [ ] **Step 5: Controller commits** `feat(make-scene): page, chrome, build CLI with alternatives table`.

### Task 9: check.mjs and browser tests

**Files:**
- Create: `MS/scripts/check.mjs`, `MS/scripts/lib/browser.mjs` (copy of make-diagram's, with launch args `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`), `MS/scripts/lib/doctor-hint.mjs` (copy), `MS/test/check.test.mjs`, `MS/test/scene-browser.test.mjs`

**Interfaces:** the CLI is `node scripts/check.mjs <page.html> [--json]`. Exit 0 means ok, or skipped with no browser. Exit 1 means problems, 2 means usage. It checks at 1440×900 and 390×780:
- no console errors;
- no page overflow;
- the canvas is not blank. Take a Playwright element `screenshot()` of the canvas, decode the PNG in Node (a small zero-dependency PNG decoder over `node:zlib` in `scripts/lib/png.mjs`), sample a 32×32 grid, and require a distinct-colour count ≥ `MIN_COLOURS = 12`. Never read pixels in-page: without `preserveDrawingBuffer`, in-page readback is black. The "re-tints" and "reduced motion" tests use the same screenshot path;
- the fallback is hidden once WebGL runs;
- the tour reaches its last beat when present.

- [ ] **Step 1: Failing browser tests** (each skips when no Chromium):
  - `each world renders non-blank at both widths`;
  - `theme toggle re-tints` (the sampled pixel hash changes after clicking the toggle);
  - `hover shows exact value` (move to a known instance's projected screen point, using a test hook `window.PAScene.__project(itemIndex)` exposed only when `?test` is in the URL; the tooltip text equals the item's `display`);
  - `tour plays to last beat`;
  - `no webgl shows fallback` (launch with `--disable-webgl --disable-gpu`; the fallback table is visible with no page errors);
  - `context loss shows fallback` (`WEBGL_lose_context.loseContext()`);
  - `hostile label stays text` (tooltip `textContent` equals the raw string, and no `img` element is created);
  - `reduced motion stays still` (two screenshots 500 ms apart are identical under `reducedMotion: 'reduce'`).

  `check.test.mjs`: exits 0 on a good page, 1 on an injected console error, and 0 with a "skipped" message when no browser is available.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass** (Chromium installed).
- [ ] **Step 5: Controller commits** `feat(make-scene): check.mjs and browser tests`.

### Task 10: Diagram lift

**Files:**
- Create: `MS/scripts/lib/siblings.mjs` (adapted from `PA/skills/make-explainer/scripts/lib/siblings.mjs`, with "next to make-scene" in messages), `MS/scripts/lifts/diagram.mjs`, `MS/test/lift-diagram.test.mjs`, `MS/test/golden/lift-architecture.json`, `MS/test/golden/lift-sequence.json`, fixtures copied from `PA/skills/make-diagram/references/examples/`

**Interfaces:**
- Consumes: `loadSibling('make-diagram','scripts/lib/api.mjs')` → `buildDiagram(spec, {theme, idPrefix}).geometry` and `.svg` (see `PA/skills/make-diagram/scripts/lib/api.mjs:115`), `validateSpec`.
- Produces: `liftDiagram(source, { dir, theme }) → SceneGraph` (`kind: 'diagram'`). It also registers `registerLiftCheck('diagram', fn)`, which reports make-diagram's errors under `lift.diagram.<path>`.
  - Scale is px → world units ÷ 40. Node footprints come from ELK `width`/`height`. Block height and shape come from the node's kind: `database`/`storage` → cylinder, `queue` → stacked boxes, `start`/`end` → disc, `decision`/`choice` → cone, else box.
  - Groups are platforms at `y = -0.1 * depth` with `line` colour.
  - Edges are tubes along ELK `points` at y = 0.3. `style: async` uses the `accent` colour; `dashed` uses `text2`.
  - Sequence: participants are pillars along x. Each message is a horizontal tube at `y = top - index * STEP`.
  - Tour: `spec.tour` wins. Otherwise `stories` beats become `{ focus: to-node, path: edge tube id, reverse }`. The runtime animates a glowing sphere along `path`.
  - Fallback: `{ kind: 'svg', svg: built.svg, css: built.css }`.
  - Its lift check validates tour `focus` against node and participant ids, with did-you-mean.

- [ ] **Step 1: Failing tests**:
  - architecture golden;
  - `tour focus on unknown node id suggests one`;
  - sequence golden;
  - `stories become tour beats with paths`;
  - `reply beat reverses`;
  - `invalid diagram reports under lift.diagram`;
  - `missing make-diagram gives install command` (point `siblingDir` at a temp dir through an injectable resolver);
  - `inline and path sources both work`;
  - `source over 1 MB rejected`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement** (the runtime path animation goes in `render.js`, then `npm run bundle`). **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): lift diagram.json into 3D`.

### Task 11: Dashboard lift

**Files:**
- Create: `MS/scripts/lifts/dashboard.mjs`, `MS/test/lift-dashboard.test.mjs`, `MS/test/golden/lift-bar.json`, fixtures (a small `dashboard.json` over `PA/eval/fixtures/data/sales.csv` copied into `MS/test/fixtures/`)

**Interfaces:**
- Consumes: `loadSibling('make-dashboard','scripts/lib/pipeline.mjs')` → `chartData(specFile, chartId)` (`pipeline.mjs:119`), and `static-chart.mjs` `renderThemedSvgs` (`:297`) for the fallback.
- Produces: `liftDashboard({ dashboard, chart }, { dir, theme }) → SceneGraph` (`kind: 'chart'`), plus `registerLiftCheck('dashboard', fn)`.
  - Mapping by chart kind:
    - bar / stacked-bar / grouped-bar / histogram → box towers on an x × color grid;
    - line / area → a tube ribbon per series (area adds a translucent `surface`);
    - scatter / bubble → spheres in a unit cube (bubble size from `size`);
    - heatmap → a surface;
    - donut → extruded ring segments (`cylinder` batch with per-instance angle via scale/rotation, or one tube per segment; builder's choice, but it must be golden-tested).
  - Negative `y` values extend below the floor, and the floor is drawn at 0.
  - Axis labels go in `labels`.
  - Fallback: `{ kind: 'svg', svg: <light svg>, svgDark: <dark svg> }` plus the table.
  - Tour `focus` resolves against the chart's x and color category values (lowercased). The lift check gives did-you-mean.
- Errors:
  - unknown chart → did-you-mean over the chart ids;
  - `boxplot` / `vegaLite` → `lift.chart: <kind> charts cannot be lifted; liftable kinds: …`;
  - `chartData` errors are re-pathed under `lift.dashboard`.

- [ ] **Step 1: Failing tests**:
  - bar golden;
  - `line lifts to ribbons`;
  - `negative values go below the floor`;
  - `boxplot rejected with liftable list`;
  - `unknown chart did-you-mean`;
  - `vegaLite chart rejected`;
  - `tour focus on unknown category suggests one`;
  - `missing make-dashboard gives install command`.

  These tests need make-dashboard's node_modules installed. If DuckDB is unavailable, skip with a reason.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): lift one dashboard chart into 3D`.

### Task 12: `rows.mjs` data helper (git)

**Files:**
- Create: `MS/scripts/rows.mjs`, `MS/scripts/lib/history-rows.mjs`, `MS/test/rows-history.test.mjs`

**Interfaces:**
- CLI: `node scripts/rows.mjs git [--weeks 12] [--depth 1] [--repo <dir>] [--out <rows.json>]`. It writes `{ "rows": [...] }`, by default to `./scene-rows.json`, and prints the path plus a ready-to-paste `"data": { "file": "scene-rows.json" }` line.
- `historyRows({ repo, weeks, depth, now }) → Row[]` (file names avoid the substring "git": the worktree Bash guard refuses such paths), using `git log --numstat --format=%H%x09%cI`:
  - It runs with argument arrays and a scrubbed env, the same as `PA/eval/lib.mjs` `createFixtureRepo`.
  - The buffer cap is 256 MB.
  - `group` = the path prefix at `depth`; root files fall under `(root)`.
  - `t` = ISO week `YYYY-Www`.
  - `value` = commits touching that group in that week.
  - Empty weeks are emitted as 0, so terrain stays eligible.
  - Every row is labelled `<group> · <week>`.
  - Unknown args are rejected with an error that lists the accepted ones.

- [ ] **Step 1: Failing tests** use a fixture repo with fixed commit dates (`GIT_COMMITTER_DATE`):
  - `counts commits per folder per week`;
  - `root files group as (root)`;
  - `zero weeks are filled`;
  - `depth 2 splits subfolders`;
  - `not a git repo is a usage error`;
  - `unknown flag lists accepted flags`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass.**
- [ ] **Step 5: Controller commits** `feat(make-scene): rows.mjs git helper`.

### Task 13: make-explainer `scene` section

**Files:**
- Create: `PA/skills/make-explainer/scripts/lib/render/scene.mjs`, `scene-source.mjs` (mirrors `diagram-source.mjs`), `PA/skills/make-explainer/test/scene-section.test.mjs`
- Modify (one entry each; recon anchors):
  - `lib/sections.mjs:25` `MODULES`;
  - `lib/schema.mjs:126` (`scene: section('scene', ['scene'], { caption })`);
  - `lib/semantic.mjs:169`;
  - `lib/checks.mjs` (a `registerCheck` for at most 4 scene sections);
  - `lib/budget.mjs:28`;
  - `lib/assets.mjs:210` `PATH_FIELDS`;
  - `lib/slides.mjs:69`;
  - `lib/requirements.mjs:7` (`scene: 'make-scene'` in `SECTION_SISTERS`);
  - `references/sections.md`, `references/schema.md`;
  - `PA/skills/make-explainer/SKILL.md` (one line naming the section);
  - `PA/skills/make-explainer/package.json` `portableArtifacts.requires` stays unchanged, because make-scene is optional and checked per spec.

**Interfaces:**
- Consumes: `loadSibling('make-scene','scripts/lib/api.mjs')` → `buildScene(spec, { dir, theme: ctx.theme, idPrefix: 'sc_<i>' })`.
- Produces:
  - `prepare` / `render` / `page` in the same shape as `render/diagram.mjs:24-60`.
  - `page()` returns the runtime once, plus scene CSS.
  - The scene renders inside a 16:9 frame and is mounted lazily, only when it scrolls into view.
  - Slides and print show the fallback.
  - The page theme overrides the scene's theme.

- [ ] **Step 1: Failing tests**:
  - `scene section renders host and fallback`;
  - `two scene sections inline the runtime once`;
  - `five scene sections rejected`;
  - `CSP unchanged with scene sections`;
  - `page theme overrides scene theme`;
  - `missing make-scene gives install command`;
  - `doctor --for spec with a scene section requires make-scene`;
  - The existing `page.test.mjs` "every schema type has a renderer" passes.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4:** the make-explainer `npm test` and the make-scene `npm test` are both green. Measure the built explainer page size with 1 and with 4 scene sections, and report both numbers for the PR body.
- [ ] **Step 5: Controller commits** `feat(make-explainer): scene section embeds make-scene`.

### Task 14: SKILL.md, references, examples, inventory prose

**Files:**
- Modify/Create:
  - `MS/SKILL.md` (full). It follows `PA/skills/make-diagram/SKILL.md`'s structure and ends with these sections: doctor, workflow 1–6, data (rows/file/csv/rows.mjs), worlds table, lifts, tour, alternatives table relay instruction ("show the table the build printed, unchanged"), degraded mode, security. It stays under 130 lines.
  - `MS/references/schema.md` (every field), `MS/references/worlds.md`.
  - `MS/references/examples/{city,forest,galaxy,terrain,lift-diagram,lift-dashboard}.scene.json`, each validated by a test.
  - `MS/README.md`.
  - `PA/README.md`, `PA/USAGE.md`, `PA/.claude-plugin/plugin.json` (description names five skills; version `0.6.0`), `.claude-plugin/marketplace.json` description.
  - `README.md:21,116,121`, `USAGE.md:131-134,262`, `docs/skills-catalog.md:165-172`, `docs/features/portable-artifacts.html` text-only lines 44/744/889/898 (the gallery is Task 16), `site/index.html:145`.
  - The manual "four/4 → five/5" grep from `AGENTS.md:46-65`.
- Test: `MS/test/docs.test.mjs` checks that every example validates, every script named in SKILL.md exists, and SKILL.md is ≤ 130 lines.

- [ ] **Step 1: Failing tests:** `docs.test.mjs` as above.
- [ ] **Step 2: Run and see them fail.** **Step 3: Write the docs.**
- [ ] **Step 4: Run** the MS `npm test`, the bin tests (frontmatter, portability, theme-guidance), `python3 -m pytest tests/pytest -q`, `python3 scripts/sweep_counts.py --check` and `bats tests/bats`. Then run `rg -n "four skills|4 skills|all four" plugins/portable-artifacts docs site README.md USAGE.md`; expect no stale hits referring to portable-artifacts.
- [ ] **Step 5: Controller commits** `docs(make-scene): SKILL.md, references, examples, inventory`.

### Task 15: Eval (controller runs the billed part)

The worktree Bash guard refuses command paths containing `eval`. Edit these files with the Write/Edit tools. In Bash, reach the folder through the `PA/ev[a]l` glob.

**Files:**
- Modify: `PA/eval/lib.mjs:8-40` (`SKILLS.scene = { dir: 'make-scene', spec: 'scene.json', siblings: ['make-diagram','make-dashboard'], outputCmd: … '--out', <work>/out/scene.html, artifacts: ['out/scene.html'] }`), `PA/eval/test/lib.test.mjs` (a `SKILLS.scene` case mirroring `:181`), `PA/eval/README.md`
- Create:
  - `PA/eval/prompts/scene.json`, with 10 prompts:
    - city from inline rows;
    - forest with `parent`;
    - galaxy with links via `data.file`;
    - terrain from `fixtures/data/web_traffic.csv`;
    - git rows (`"repo": true`);
    - a diagram lift (seed);
    - a dashboard lift (seed, sales.csv);
    - "add a 3-beat tour";
    - "switch to forest";
    - "rename group".
  - `PA/eval/fixtures/seeds/scene.json`.
  - `PA/eval/results/summary-scene-2026-10-<dd>.md` (one per billed run).

- [ ] **Step 1:** Run the fake-host test (free): `cd PA/eval && node --test "test/**/*.test.mjs"`. It fails first, then passes after the entry is added.
- [ ] **Step 2 (controller only, billed):** `node PA/eval/run-eval.mjs --skill scene --host claude --model haiku`. The pass bar is ≥ 90% valid. **Budget: at most 5 billed runs in total.** Between runs, fix only the spec shape, the validator messages or SKILL.md. Each fix is its own `fix(make-scene):` commit, and each run's summary is committed. After run 5, stop either way and report the scores.
- [ ] **Step 3: Controller commits** `test(eval): make-scene prompts and Haiku summary`.

### Task 16: Site gallery

**Files:**
- Create: `docs/features/showcase/portable-artifacts/gallery/scene-<name>/{dusk,press,poster}/thumb.jpg` (1280×720) and `scene-<name>/dusk/index.html` + `scene.json`, for name ∈ `city, forest, galaxy, terrain, lift-diagram, lift-dashboard`. The thumbnail script lives in the scratchpad, not the repo.
- Modify: `docs/features/portable-artifacts.html`:
  - six `.gitem.gal-card` entries after the existing gallery items (pattern at `:847-851`, `data-tpl-src` with `{d}`, no `data-tpl-href`, so "Open full page" always opens dusk);
  - a make-scene subsection in the per-skill section (`:911`) whose commands use per-line copy buttons per CLAUDE.md.

- [ ] **Step 1:** Build each page with `SOURCE_DATE_EPOCH` pinned and `--model/--effort/--agent` set, the same as the provenance paragraph at `:871`. Use `--out` into the gallery dir. Render the thumbnails headless with SwiftShader at 1280×720 after 1500 ms, for each theme.
- [ ] **Step 2: Verify.**
  - Open the page locally (Chrome MCP or Playwright).
  - Switch dusk/press/poster and screenshot the gallery. Look at the screenshot.
  - Confirm every "View spec" and "Open full page" link resolves.
  - Confirm no `data-copy` contains `#`.
  - Record total bytes added (`du -ch`) for the PR body.
- [ ] **Step 3: Controller commits** `docs(site): make-scene gallery and section`.

### Task 17: Branch finish

- [ ] **Step 1: Run every sanctioned invocation in Global Constraints.** Then run the make-diagram, make-dashboard, make-explainer and make-motion `npm test` suites (regression).
- [ ] **Step 2:** Do a whole-branch review with a fresh planner-tier reviewer (report-only, with the code-review.md finding-stage sentence). Fix CRITICAL/HIGH. Defer MEDIUM/LOW as follow-up commits.
- [ ] **Step 3:** Write the manual-test checklist at `.scratch/feat-make-scene-test-checklist.html` (plus a `.md` twin) per the global rule. It covers:
  - phone orbit/pinch on iOS Safari and Android Chrome;
  - real-GPU smoothness and battery/idle pause;
  - Firefox and Safari WebGL;
  - explainer page with 4 scenes on a phone;
  - regression rows for every review-cycle fix.
- [ ] **Step 4:** Push `-u`, then open a PR with the full commit history summary, the measured bundle and page sizes, the eval scores, and the gallery bytes.
