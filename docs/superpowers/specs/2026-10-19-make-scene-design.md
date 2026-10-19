# make-scene — Design

*2026-10-19 · branch `feat/make-scene` · status: spec (user asked to go straight from questions to plan and subagent-driven build; eval budget ≤ 5 billed runs)*

A fifth portable-artifacts skill. The model writes one small JSON spec. Scripts
validate it and build one offline HTML page with an interactive three.js 3D
scene. The scene is either a **world** (data becomes a city, forest, galaxy or
terrain) or a **lift** (an existing `diagram.json` or dashboard chart redrawn
in 3D). make-explainer pages can embed a scene as a section.

## Why

3D is opt-in eye candy with a purpose. Orbiting, hovering and touring a scene
holds attention in a way a flat chart does not. The user, or the agent on the
user's behalf, asks for 3D. The skill never upgrades a 2D request on its own.
Accuracy still matters: every number shown in 3D is also readable exactly
(hover, Explore list, data table).

## User decisions (2026-10-19)

- **New skill, `make-scene`.** It is not a mode of make-diagram or make-dashboard.
- **General purpose.** "Anything": any rows of data, not only git history.
- **All four worlds in v1:** City skyline, Forest, Galaxy, Terrain. The
  brainstorm mockup (`.superpowers/brainstorm/*/content/worlds.html`, not
  committed) showed all four from one `{ group, t, value }` dataset. The user
  picked all four.
- **Lifting in v1:** from `diagram.json`, from a dashboard spec, and as a
  `scene` section embedded in make-explainer.
- **Recommend, build, then offer.** The skill builds the recommended option
  straight away. It then lists the alternatives, each with an approximate
  cost and a one-line command to switch. It does not ask first.
- **Cheapest-model buildable.** `model: haiku`, `effort: low`. The model only
  writes JSON, never three.js code, coordinates, CSS or HTML.
- **Everything in one branch:** skill, lifts, explainer section, tests, CI,
  Haiku eval run (billed, approved) and site gallery entries.

## Goals

1. A Haiku-class model can produce a correct scene from a prompt plus data,
   using the same validate-retry loop as the sibling skills.
2. Same spec → same scene (seeded layout, no `Math.random` at runtime).
3. Offline single HTML file under the existing strict CSP (`script-src
   'unsafe-inline'` only: no CDN, no `unsafe-eval`, no blob/data scripts).
4. Works on a phone. Degrades to a readable 2D/table page with WebGL off.
5. Themed by the shared themes and follows the page's light/dark toggle.

## Non-goals

- Model-authored geometry, shaders, custom meshes or GLB/glTF import.
- Physics, VR/AR, multiplayer, sound.
- Video export (make-motion owns video; a later branch may record a scene orbit).
- Lifting a whole dashboard at once. A lift takes **one chart**.
- Lifting dashboard `boxplot` and raw `vegaLite` charts. The validator
  rejects them and lists the liftable kinds.

## Anti-goals (failure even if it works)

- A pretty scene that hides or distorts the numbers. Every value must be
  reachable exactly; height scales start at zero; no perspective trick is
  the only encoding.
- A page that pins a phone's GPU or drains its battery. Instancing is
  required for repeated geometry. Rendering stops when the scene is off-screen
  or the tab is hidden.
- A spec format Haiku gets wrong often. Spec shape is judged by the eval, not
  by taste.

## Spec contract (`scene.json`)

```json
{
  "title": "Commits per folder, last 12 weeks",
  "subtitle": "optional one line",
  "world": "city",
  "theme": "dusk",
  "data": {
    "rows": [ { "group": "api", "t": "2026-W30", "value": 12, "label": "optional" } ],
    "csv": "optional path instead of rows",
    "columns": { "group": "folder", "t": "week", "value": "commits" }
  },
  "lift": { "diagram": "path/or/inline object" },
  "units": "commits",
  "tour": [
    { "title": "Web spikes in week 9", "focus": ["web"], "caption": "The redesign landed." }
  ],
  "autoplay": false,
  "generatedBy": { "model": "...", "effort": "...", "agent": "..." }
}
```

Exactly one of `data` or `lift`.

**`world`** (with `data`): `city` | `forest` | `galaxy` | `terrain`.

**`lift`** (instead of `data`), exactly one key:

- `{ "diagram": <path to diagram.json | inline object> }`: any of the four
  diagram types.
- `{ "dashboard": <path to dashboard.json>, "chart": "<chart id>" }`.

**Data rows** use one generic shape. Each world reads the fields it needs:

| Field | Meaning | city | forest | galaxy | terrain |
|---|---|---|---|---|---|
| `group` | category | district | tree | star system | row of grid |
| `t` | order/time (string or number) | street position | branch height (bottom = oldest) | orbit radius | column of grid |
| `value` | number ≥ 0 | building height | leaf-cluster size | planet size | elevation |
| `parent` | optional: hierarchy | — | sub-branch of another row | — | — |
| `links` | optional top-level `[{from,to,value?}]` between groups | — | — | light trails between stars | — |
| `label` | optional text for hover/Explore | ✓ | ✓ | ✓ | ✓ |

**Data sources**, exactly one per spec:

- `data.rows`: inline, for small data the model already has in hand.
- `data.file`: a JSON file `{ "rows": [...], "links": [...] }`. This is what
  `rows.mjs` writes, so the model never retypes generated rows.
- `data.csv` with `columns`: maps CSV headers onto any of `group`, `t`,
  `value`, `label`, `parent`. `links` cannot come from a CSV; use `data.file`
  for them.

A model never reshapes data by hand. Each source keeps the sibling skills'
local-file rules: no URLs, and the path must exist.

**Row field rules** (settled after the builder check; orchestrator's calls):

- `group` is free display text (≤ 48 chars), not an id. `.github` and
  `Sources` are fine. The runtime derives internal keys itself.
- Tour `focus` entries match a `group` or a row `label` exactly
  (case-insensitive), or a node id in a diagram lift. The validator gives
  did-you-mean errors for misses.
- `parent` names another `group`. In Forest, a group with a parent grows as
  a branch of that group's tree, not as its own tree. Other worlds ignore
  `parent`. Cycles and unknown parents are errors.
- `t` is optional:
  - City puts a district's buildings in `t` order, or in value order when
    `t` is absent.
  - Forest puts branches in `t` order, or in row order when `t` is absent.
  - Galaxy sets orbit radius by `t` rank, or by value rank when `t` is absent.
  - Terrain requires `t`.
- Duplicate `(group, t)` pairs are kept as separate items, never summed:
  - City places them side by side.
  - Forest and Galaxy give each its own leaf cluster or planet.
  - Terrain needs exactly one row per `(group, t)`.
- **World eligibility:** a world whose requirements the data fails is
  listed in the alternatives table as "not available: needs …", with no
  switch command. The validator rejects an explicit `world` the data cannot
  feed, and the error names the eligible worlds.

**`tour`** is up to 12 beats. Each beat has `title` (≤ 48), optional
`caption` (≤ 160), and `focus` (group ids, row labels, or, for a diagram
lift, node ids). The camera flies to each focus in turn. A diagram lift with
no `tour` replays the diagram's own `stories` (beats become hops along 3D
edge tubes, with a travelling light).

Limits: titles ≤ 120, subtitle ≤ 160, ≤ 2000 rows, ≤ 24 groups, ids follow
the sibling id rule. The validator gives did-you-mean errors per JSON path and
calls `evalLog` like the siblings.

## How each scene looks

Mockup-level intent. Exact proportions, materials and lighting are the
builder's.

- **City:** districts per group in rows, buildings along streets by `t`,
  height = value (zero-based). Light mode is day; dark mode is night, with lit
  windows (emissive) whose density tracks value.
- **Forest:** one tree per group on a meadow. Branches spiral up the trunk
  by `t`, leaf-cluster size = value. Rows with `parent` grow sub-branches.
  Gentle leaf sway (off under reduced motion).
- **Galaxy:** one star per group. Planets orbit at radius by `t`, size =
  value. `links` draw arcs between stars. Starfield background.
- **Terrain:** a group × t grid interpolated into a landscape. Elevation =
  value, a sea level marks low values, and colour bands go by height.
- **Diagram lift:** ELK's 2D layout laid flat on a floor. Nodes are blocks
  whose shape follows `kind` (cylinder for database, and so on). Groups are
  raised platforms by depth. Edges are tubes along ELK's edge points.
  Sequence diagrams stand participants up as pillars, with messages as beams
  stepping down in time.
- **Dashboard lift:** bar/stacked/grouped/histogram become towers;
  line/area become ribbons; scatter/bubble become spheres in a 3D box;
  heatmap becomes a terrain-like surface; donut becomes an extruded ring.
  Axes and tick labels come from the chart's roles (`x`, `y`, `color`, …).

Common chrome on every scene: auto-orbit on open (stops on first touch),
drag/scroll/pinch orbit and zoom, a hover/tap tooltip with exact label and
value, a legend (group → colour), an Explore list (every group and item,
clickable to fly to it), a tour transport bar (Play/Space, ←/→ beats), full
screen (`F`), PNG export of the current view, a theme toggle and the
provenance footer like the siblings. Keyboard: arrows orbit when the canvas
has focus.

## Recommend, build, then offer

`node <skill-dir>/scripts/recommend.mjs scene.json` (or `build.mjs`, which
calls it) inspects the data shape and ranks the options:

- `links` present → galaxy
- `parent` present → forest
- `t` dense numeric/time with many groups (grid ≥ ~60% filled) → terrain
- otherwise a time/sequence `t` → city
- a lift is never second-guessed

The SKILL.md workflow is:

1. The agent writes `scene.json`, setting `world` to its own pick, or
   leaving it out so the build uses the top recommendation.
2. The agent builds.
3. The build prints the HTML path plus an **alternatives table**. Each row
   has the world, why it fits or not, an approximate cost, and the exact
   switch command (`build.mjs scene.json --world forest`).
4. The agent relays that table to the user verbatim.

**Approximate cost** (the user's "approx cost") has three numbers, all
computed by the script and never guessed by the model:

- **Model tokens to switch:** `0`, because `--world` is a build flag and needs
  no model. `build.mjs --world <w>` also rewrites the `world` field in
  `scene.json` and says so. That keeps the saved spec, "View spec", the
  provenance and the next plain rebuild in step with the page. The table also states the measured token count of writing the
  current spec (characters ÷ 4, labelled "estimated"). This gives the user a
  sense of the authoring cost on any host.
- **Page size**, measured from the build. For alternatives, it is estimated
  as the shared bundle size plus the data.
- **Render weight:** light / medium / heavy, from instance and triangle
  counts. "Heavy" carries a "may be slow on phones" note.

Dollar figures are out: hosts and prices vary, and the repo's rule is not to
guess numbers.

## Architecture

```
scene.json ─▶ validate.mjs ─▶ build.mjs ─┬─ worlds/<world>.mjs   (Node: rows → scene graph JSON)
                                          ├─ lift/diagram.mjs     (sibling make-diagram api.buildDiagram().geometry)
                                          ├─ lift/dashboard.mjs   (sibling make-dashboard pipeline.chartData)
                                          └─ page.mjs ─▶ index.html
                                                         (inlined: theme CSS + fonts, scene-graph JSON,
                                                          prebuilt scene runtime bundle = three.js + runtime)
```

- **Node computes, the browser draws.** Each world/lift module turns data
  into a small, declarative **scene graph JSON**: instanced primitive
  batches, tubes, labels, camera bookmarks per focus id, and fallback
  table rows. It is deterministic and unit-testable without a browser. The
  browser runtime only instantiates that graph. This keeps the runtime
  generic and lets golden tests pin each world's output.
- **The runtime bundle** is the scene runtime source (`template/runtime/*.js`)
  plus the three.js modules it imports (`three` core and `OrbitControls`),
  bundled into **one IIFE script** with esbuild. esbuild is a **dev**
  dependency. The bundle is **committed**
  (`template/vendor/scene-runtime.min.js`) so installs (`npm ci
  --omit=dev`) need neither esbuild nor a build step. A test fails when the
  committed bundle is stale against its sources (hash recorded in a header
  comment), the same pattern as `sync-shared --check`. three.js is pinned
  (latest stable at plan time; `0.186.1` today) with its MIT notice in
  `THIRD_PARTY_NOTICES.md`.
- **CSP stays the sibling string.** The bundle is inline classic script text,
  with no workers, no eval and no blob URLs. WebGL needs no CSP source.
- **Page size:** make-scene has its own cap, set in the plan after measuring
  the bundle. The cap is bundle + 512 KB of scene data. The make-diagram 1 MB
  cap does not apply. The explainer inlines the runtime **once** per page
  however many scene sections it has.
- **Theme:** the runtime reads the shared theme's CSS variables at startup
  and again on toggle (the `data-theme` attribute and the media query). It
  re-tints materials without rebuilding. `cat1..8` colour groups. `page`,
  `surface` and `text` colour the sky/ground and chrome. Each world keeps its
  identity (forest greens, galaxy black) by blending theme colours into a
  fixed world base; contrast of chrome text stays under `shared/contrast.mjs`.
  Default theme: `dusk` (the newest family default).
- **No-WebGL fallback:** the page always contains a semantic fallback that
  the runtime hides once WebGL starts. For worlds it is a data table; for a
  diagram lift, the 2D SVG from `buildDiagram`; for a dashboard lift, the
  static SVG from make-dashboard's `static-chart.mjs` plus its table. The
  same table is the screen-reader view (canvas is `aria-hidden`, and the
  Explore list and table are the accessible path).
- **Reduced motion:** no auto-orbit, no sway, and tour beats cut instead of
  fly.
- **Performance:** `InstancedMesh` for repeated primitives. The render loop
  pauses when off-screen (IntersectionObserver), when the tab is hidden, and
  when idle (no orbit, tween or animation). DPR is capped at 2 (1.5 on
  phones).

### Sibling dependencies

- The diagram lift loads make-diagram's `scripts/lib/api.mjs`. The dashboard
  lift loads make-dashboard's `scripts/lib/pipeline.mjs` (and
  `static-chart.mjs`). Both load the same way make-explainer does (sibling
  folder next to make-scene).
- `package.json` declares `portableArtifacts.requires: ["make-diagram",
  "make-dashboard"]`. doctor's `requirementsFor(spec)` asks for a sister skill
  only when the spec lifts from it, so pure worlds install nothing extra.
- make-explainer adds `make-scene` to its own sister list, but only requires
  it when a page has a `scene` section.

### make-explainer `scene` section

- Fields: `scene` (inline object or `.json` path, same size cap as `diagram`)
  and `caption`.
- `prepare` calls make-scene's embedding API (`scripts/lib/api.mjs`
  `buildScene(spec, {theme, idPrefix})`, which returns `{html, data,
  runtime}`, mirroring make-diagram's API).
- The page theme overrides the scene's theme. The runtime is shipped once by
  the section's `page()` hook.
- The scene renders inline in a fixed-aspect frame and renders only while
  visible. Each page allows at most 4 scene sections (WebGL context limits).
- Slides get the same section. The decks' print/PDF path shows the fallback.
- Every explainer per-section-type touchpoint listed in recon gets an entry:
  schema, semantic, checks, budget, assets, slides, requirements, references,
  and the renderer-coverage test.

### Data helpers

`node <skill-dir>/scripts/rows.mjs git [--weeks 12] [--depth 1]` prints
`data.rows` for "commits per top-level folder per week" from the current
repo. It reuses make-explainer's git reading where practical; otherwise it
uses a local `git log --numstat` reader with the same buffer cap. It gives
the user's skyline idea a zero-thinking path for the model. The helper is
generic in output (rows), and git is just the first source.

## Workflow in SKILL.md (Haiku-sized)

Same skeleton as make-diagram: doctor, then write `scene.json` (examples in
`references/examples/` for every world and both lifts), then `validate.mjs`
until `valid`, set `generatedBy`, then `build.mjs` (`--out`, `--theme`,
`--world`), then `doctor --for check` and `check.mjs`, then report: path, one
line, the alternatives table verbatim, and the key hints. Default output
folder is `~/.agent/scenes/` (or `PA_OUTPUT_DIR`). The required portability
line and the no-bash-isms rules from `bin/test/portability.test.mjs` apply.

## Verification

- **Unit:** validator (every field, did-you-mean), recommend ranking, each
  world/lift → scene-graph goldens, cost table maths, bundle-staleness
  check, rows.mjs git (fixture repo).
- **Browser** (`check.mjs`, Playwright with SwiftShader WebGL, skips cleanly
  without a browser):
  - the canvas is not blank (pixel variance), with no console errors;
  - desktop and phone widths have no overflow;
  - the fallback is visible with WebGL disabled;
  - the theme toggle re-tints (sampled pixel changes);
  - a tour plays to the last beat;
  - hover on a known instance shows its exact value.
- **Explainer:** a scene section renders, the runtime is inlined once with
  two sections, and the CSP string is unchanged.
- **Repo gates:** the per-skill `npm test` step is added to CI `node` job;
  `style-lint` SOURCES include the new template; frontmatter/portability
  tests pass; `sync-shared --check`; `sweep_counts.py --write` plus the
  manual "four → five" sweep from AGENTS.md; the catalog row; plugin.json and
  marketplace descriptions; plugin version bump to 0.6.0.
- **Eval** (billed, approved): `eval/prompts/scene.json` with about 10
  prompts: each world from inline rows, a CSV, git rows, a diagram lift, a
  dashboard lift, a tour, and edit prompts (switch world, rename, add beat).
  It is run on the claude host with Haiku. The summary is committed as
  `eval/results/summary-scene-<date>.md`. Pass bar: the same scoring as the
  siblings, with ≥ 90% valid on first or retried validate. **Budget (user
  decision): at most 5 billed runs in total.** Between runs, fix the spec
  shape or SKILL.md. If the bar still fails after run 5, stop and report.
  Every run's summary is committed.
- **Site:** gallery entries on `docs/features/portable-artifacts.html` for
  the 4 worlds + diagram lift + dashboard lift, each in dusk/press/poster
  thumbs (1280×720, rendered with SwiftShader headless), "Open full page"
  and "View spec" links, plus a per-skill section. To limit repo growth,
  each scene commits a full page in `dusk` only, and the theme switch swaps
  only the thumbnail. That is 6 pages, with the page size measured and
  reported in the PR. The copy-button rules
  from CLAUDE.md apply.
- **Manual-test checklist** (global rule): real-device phone orbit/pinch,
  real GPU smoothness, and Safari/Firefox WebGL. It goes in `.scratch/` per
  the user's global instructions.

## Builder's calls (left open on purpose)

- Exact geometry, materials, lighting, camera framing, sway and orbit speeds.
- The runtime module layout and how much UI chrome code it borrows from
  make-diagram's viewer templates. Copy, never import across skills at
  runtime.
- Tour camera easing; tooltip/legend placement.
- Exact recommend thresholds, provided the rules above hold and are
  unit-tested.
- Whether `rows.mjs git` imports make-explainer's git lib or carries its own.

## Calls made by the orchestrator (not user-confirmed; check these)

1. Cost = tokens-to-switch (0) + spec-authoring tokens (estimated) + measured
   page size + render weight. **No dollar figures.**
2. `--world` build flag, so switching worlds costs no model tokens.
3. Node computes a scene graph and the browser only instantiates it, so
   worlds are golden-testable.
4. The prebuilt esbuild bundle is committed, with a staleness test (installs
   stay `npm ci --omit=dev`, no bundler).
5. Light = day, dark = night (lit city windows).
6. Default theme `dusk`; default output folder `~/.agent/scenes/`, the
   sibling convention, overridable.
7. One chart per dashboard lift; boxplot/vegaLite not liftable.
8. At most 4 scene sections per explainer page.
9. Plugin version 0.6.0.
10. Row data contract: `group` is free text, `parent` names a group, `t` is
    optional except for Terrain, duplicates are never summed, and ineligible
    worlds show as "not available". Adds `data.file`, and `columns` maps
    `label`/`parent` too.
11. `--world` writes the choice back into `scene.json`.
12. Gallery: a dusk full page per scene, thumbnails for all three themes.
13. The product default output folder `~/.agent/scenes/` follows the
    siblings' `shared/output.mjs` convention. The global "assets inside the
    repo" rule governs the agent's own deliverables (checklists, gallery
    builds pass `--out` into the repo), not the skill's user-facing default.
