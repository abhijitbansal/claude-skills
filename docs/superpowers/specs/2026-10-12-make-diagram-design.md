# make-diagram — Design (SP2 of the visual-artifacts program)

*2026-10-12 · branch `feat/visual-artifacts` · status: spec (user pre-approved building without a review stop)*

Program context, decisions D1–D8 and the shared core are in
`2026-10-12-make-dashboard-v2-design.md`. This doc adds what SP2 needs.

## User decisions (2026-10-12)

- Layout engine: **ELK** (`elkjs`), at build time only.
- Diagram types in v1: **architecture, flowchart/workflow, sequence, state/lifecycle**.
- Icons: **Lucide** (ISC) for generic nodes **plus Simple Icons** (CC0) brand marks.
- Default output folder: **`~/.agent/diagrams`** (override with `--out` or `PA_OUTPUT_DIR`).
- After the eval passes: remove `archify` (cut-over happens in SP3's final step).

## Goal

The model writes one small JSON topology. Scripts validate it, lay it out,
draw a professional SVG, and wrap it in a single offline HTML viewer with zoom,
hover tracing, a step-by-step presentation mode, edge-flow animation, export
and themes. A cheap model (Haiku, gemma4) can author it, because it never
writes coordinates, SVG or CSS.

## Non-goals

- Hand-positioned nodes (no `pos`/`size` fields). ELK decides; the spec can
  only nudge with `direction`, `group` membership and edge order.
- True swimlanes in flowcharts (ELK cannot pin compound nodes into aligned
  bands). Flow `groups` render as boxes, like architecture groups.
- Mermaid input. A user who pastes Mermaid gets a re-authored JSON spec.
- Arbitrary user SVG or icon URLs (rejected, as archify does).

## Spec contract (`*.diagram.json`)

```json
{
  "title": "Checkout request path",
  "subtitle": "optional one line",
  "type": "architecture",
  "theme": "paper",
  "direction": "right",
  "animate": false,
  "groups": [
    { "id": "aws", "label": "AWS us-east-1" },
    { "id": "vpc", "label": "Private VPC", "parent": "aws" }
  ],
  "nodes": [
    { "id": "web", "label": "Web app", "kind": "client" },
    { "id": "api", "label": "Checkout API", "kind": "service", "group": "vpc", "icon": "brand:nodedotjs" },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "vpc", "icon": "brand:postgresql", "note": "primary + replica" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "POST /checkout" },
    { "from": "api", "to": "db", "label": "writes order", "style": "solid" }
  ],
  "steps": [
    { "title": "The browser calls the API", "show": ["web", "api"], "note": "TLS ends at the load balancer." },
    { "title": "The API writes the order", "show": ["db"], "focus": ["api", "db"] }
  ]
}
```

| Field | Rule |
|---|---|
| `type` | `architecture` \| `flow` \| `sequence` \| `state`. |
| `direction` | `right` (default for architecture, state) \| `down` (default for flow). Not allowed for sequence (the validator rejects it). |
| `theme` | A `shared/themes` name; default `paper`. |
| `animate` | Start with edge-flow animation on (the viewer toggle still works). Default `false`. |
| `groups[]` | `id`, `label`, optional `parent` (nesting ≤ 3 deep, no cycles). Not for sequence. |
| `nodes[]` | `id` (`^[a-z][a-z0-9_-]*$`), `label` (≤ 48 chars, wraps to ≤ 2 lines), optional `kind`, `icon`, `group`, `note` (≤ 60 chars, one line), `tone` (`neutral`\|`accent`\|`good`\|`warn`\|`bad`, default neutral). |
| `edges[]` | `from`, `to` (node ids; architecture may also target a group id), optional `id`, `label` (≤ 40 chars; should be a verb phrase), `style` (`solid`\|`dashed`\|`async`), `both` (two-headed). |
| `steps[]` | Presentation script: `title` (≤ 60), optional `note` (≤ 200), `show` (ids revealed, cumulative), `focus` (ids to zoom to; default = this step's `show`), `highlight` (ids emphasised this step). Edges whose ends are both visible appear automatically. When `steps` is absent the viewer builds steps from ELK's layers (build-up left→right / top→down). |

Per-type node kinds (shape encodes kind; colour is never the only signal):

| type | kinds (default first) and shape |
|---|---|
| architecture | `service` (rounded rect), `client` (rounded rect, monitor icon), `user` (rounded rect, user icon), `database` (cylinder), `storage` (cylinder), `queue` (rect with stacked lines), `cache` (rounded rect, zap icon), `function` (rounded rect, function icon), `gateway` (hexagon-cut rect), `external` (dashed rounded rect), `other` |
| flow | `step` (rect), `start`, `end` (stadium), `decision` (diamond), `io` (parallelogram), `subprocess` (rect with double side bars), `wait` (rounded rect, clock icon) |
| state | `state` (rounded rect), `start` (filled dot), `end` (ringed dot), `choice` (small diamond) |
| sequence | participants: `actor` (stick-figure icon), `service` (default), `database`, `queue`, `external` |

Sequence uses `participants` + `messages` instead of `nodes` + `edges`:

```json
{
  "type": "sequence", "title": "Login with refresh",
  "participants": [ { "id": "u", "label": "User", "kind": "actor" }, { "id": "app", "label": "App" }, { "id": "auth", "label": "Auth API" } ],
  "messages": [
    { "id": "m1", "from": "u", "to": "app", "label": "enter password" },
    { "id": "m2", "from": "app", "to": "auth", "label": "POST /token" },
    { "id": "m3", "from": "auth", "to": "app", "label": "access + refresh", "kind": "reply" },
    { "id": "m4", "from": "app", "to": "app", "label": "store tokens", "kind": "self" }
  ],
  "frames": [ { "kind": "alt", "label": "token expired", "messages": ["m2", "m3"] } ],
  "notes": [ { "over": ["app"], "text": "keeps refresh in Keychain", "after": "m4" } ]
}
```

Message `kind`: `sync` (default, solid + filled arrow), `async` (solid + open arrow), `reply` (dashed + open arrow), `self` (loop). Frames: `loop` \| `alt` \| `opt` \| `par`, spanning a contiguous message range. Limits: ≤ 12 participants, ≤ 60 messages.

Icons: `icon` is `lucide:<name>` or `brand:<slug>`. Without `icon`, the kind's default Lucide icon is used. Icons come from committed catalogs (`icons/lucide.json`, ~250 icons; `icons/brands.json`, ~150 brands relevant to software diagrams), generated from pinned `lucide-static` and `simple-icons` dev dependencies by `scripts/dev/build-icons.mjs`. Brand marks render monochrome in `--text-2`, never in brand colours. Unknown icon → did-you-mean over the catalog.

Global limits (readability): ≤ 60 nodes, ≤ 120 edges, ≤ 25 steps.

## Pipeline

```
diagram.json --validate.mjs--> errors (path, message, did-you-mean)
             --build.mjs-----> measure text (font metrics) -> ELK layout (or sequence layout)
                               -> render SVG (shapes, icons, edges, labels)
                               -> geometry lint (overlaps, label collisions, budget)
                               -> viewer HTML (theme CSS + fonts + runtime) -> <out>/<slug>.html
             --check.mjs-----> optional headless browser check (when Chromium/Chrome exists)
```

- **Text measurement without a browser:** `shared/fonts/metrics.json` holds advance widths (ASCII 32–126 + Latin-1) and line metrics for each shipped font, generated once by `scripts/dev/font-metrics.mjs` from the `@fontsource` `.woff` files with `opentype.js` (dev dependency) and committed to `shared/` (synced to every skill). `shared/text.mjs` exposes `measure(text, { family, weight, size })` and `wrap(text, maxWidth, font)`. make-explainer reuses it.
- **Layout:** `elkjs` (`elk.bundled.js`, runs in Node) with `algorithm: layered`, `edgeRouting: ORTHOGONAL`, `hierarchyHandling: INCLUDE_CHILDREN`, `randomSeed: 1`, spacing tuned once (node-node 32, between layers 72, group padding 24 + label height), edge labels sized from metrics and placed by ELK. Output is deterministic for a given spec and ELK version (golden tests pin it).
- **Sequence layout:** pure function: column x from cumulative max(participant label width, adjacent message label widths); one row per message; self-messages take two rows; frames and notes add rows.
- **Render:** hand-written SVG builder: hairline borders (`--line`), surface fills, one weight of icon stroke, labels in the body font (600) with notes in `--text-3`, mono only for ids in tooltips. Edges are orthogonal paths with 6 px rounded corners and marker arrowheads; labels sit on a `--surface` plate. Groups: 1 px `--line` outline, `--page` fill, label top-left in `--text-2`. Tones colour only the 1.5 px border and the icon. No gradients, shadows, glow, blur or accent bars (structurally impossible: the spec has no style fields).
- **Geometry lint (build fails on these):**
  - Overlapping node boxes.
  - Edge labels overlapping a node.
  - Text that measures wider than its box.
  - Page payload over 400 KB for ≤ 60 nodes.
- **Viewer** (`template/viewer.html` + `template/viewer.js`, inlined; strict CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`):
  - **Toolbar:** title/subtitle, Fit, −, +, Present, Animate, Theme, Export (SVG, PNG).
  - **Navigation:** wheel/pinch zoom, drag pan, double-click fits.
  - **Keyboard:** `F` fit, `+`/`-`, arrow keys pan, `P` present, `A` animate, `Esc` exits presentation.
  - **Hover/focus on a node:** highlights it, its edges and its neighbours, dims the rest. Click pins the highlight; Tab moves through nodes in reading order.
  - **Presentation mode:**
    - A caption panel shows the step title, note and `n / N`.
    - Arrow keys / Space / click step through; the camera animates the viewBox to the step's `focus` bounding box (300 ms ease-out).
    - Revealed elements fade/draw in; later steps' elements are hidden.
    - `#step-3` deep links work.
  - **Animation:** dashes flow along edges in the edge direction (CSS `stroke-dashoffset`), off under `prefers-reduced-motion` (the toggle then shows "Reduced motion").
  - **Accessibility:**
    - The SVG has `role="img"` with a title and description.
    - Every node is a focusable `<g>` with an accessible name.
    - A visually hidden text alternative lists nodes by group and every edge as "A → B: label".
  - **Export:** SVG and PNG, filled with the theme surface (same rule as make-dashboard).
  - **Theme:** the shared theme CSS and fonts, plus the `Theme:` toggle stored in `localStorage` (blocked storage tolerated).
- **Output:** `--out <file.html | dir>`; default `${PA_OUTPUT_DIR:-~/.agent/diagrams}/<slug-of-title>.html`. The build prints the absolute path and a `file://` URL.
- **Embedding API (for make-explainer):** `scripts/lib/api.mjs` exports `buildDiagram(spec, { theme }) -> { svg, width, height, steps, ids }` (SVG uses CSS variables and classes, no fonts) `viewerRuntime() -> string` (the hover/present/animate script without toolbar chrome) and `validateSpec(spec, { layout }) -> { ok, errors }` (re-exported from `spec.mjs`: the same checks `buildDiagram` runs, for callers that only validate, such as make-explainer's `validate`). Stable contract; tested.

## Skill files

```
skills/make-diagram/
  SKILL.md                      (≤ ~110 lines; model writes JSON only)
  README.md, package.json (ajv 8.20.0, elkjs 0.12.0; dev: playwright 1.64.0,
                           lucide-static, simple-icons, opentype.js, @fontsource/* .woff for metrics)
  scripts/validate.mjs build.mjs check.mjs icons.mjs (list/search icons)
  scripts/lib/{cli,spec,schema,kinds,icons,layout-graph,layout-sequence,render,shapes,edges,lint,viewer,api,output}.mjs
  scripts/dev/{build-icons,font-metrics}.mjs
  template/viewer.html template/viewer.js
  icons/lucide.json icons/brands.json THIRD_PARTY_NOTICES.md
  references/schema.md references/kinds.md references/examples/*.diagram.json (one per type)
  test/…  shared/ (generated copy)
```

`scripts/icons.mjs search <word>` lets the model find an icon name without reading the catalog (cheap-model affordance).

## Validation and errors

All errors carry a JSON path and, where possible, a did-you-mean:
- Unknown ids in edges, steps, frames and notes.
- Duplicate ids.
- A group parent cycle.
- A kind not valid for the type.
- An unknown icon.
- An over-long label (the error gives its length and the limit).
- Too many nodes.
- A sequence frame whose messages are not contiguous.

`validate` runs layout too, so "valid" means buildable, including the geometry lint.

## Testing

- **Unit:**
  - Schema and refs, with each error message pinned.
  - Metrics: measure/wrap against known strings, and a font-metrics drift test.
  - ELK layout determinism: golden geometry JSON per example.
  - Sequence layout geometry.
  - SVG render goldens (normalised).
  - Lint fires on an injected overlap (guardrail RED).
  - Icon catalog completeness: every kind's default icon exists.
- **Browser (Playwright, skips without Chromium/Chrome):**
  - Every example renders with no console errors at 1440 and 390 px, and no page overflow.
  - Measured `getBBox` text fits its node.
  - Hover dims non-neighbours, and Tab focuses nodes.
  - Presentation: steps advance, the camera moves, and `#step-2` deep-links.
  - Animate toggles, and reduced motion disables it.
  - SVG and PNG export downloads.
  - The theme toggle works, including with blocked storage.
  - Screenshots are viewed.
- **Size budget:** the 4 examples each build to ≤ 400 KB.
- **Eval:** `eval/lib.mjs` gains a `diagram` skill entry; 8 prompts (2 per type, including one edit prompt with a seed); gemma4, then Haiku and Sonnet (user-approved). Gate: Haiku ≥ 9/10-equivalent pass rate (≥ 7/8), median validate runs ≤ 2. Pin `model: haiku`, `effort: low` only if it passes.

## Docs and inventory

- SKILL.md, README, `references/schema.md` + `kinds.md` + examples.
- Plugin README/USAGE, `docs/features/portable-artifacts.html` (copy-button rule), and catalog rows in `docs/skills-catalog.md`.
- `python3 scripts/sweep_counts.py --write` runs in the **same commit** that adds `skills/make-diagram/SKILL.md`; otherwise the live-count pytest goes red.
- CI: a make-diagram step (`npm ci && npx playwright install --with-deps chromium && npm test`).

## Risks

| Risk | Mitigation |
|---|---|
| ELK label placement collides with nodes on dense graphs | Geometry lint fails the build with the edge id; SKILL.md tells the model to shorten labels or split the diagram. |
| ELK output changes across versions | Exact pin `elkjs@0.12.0`; golden geometry tests. |
| Metrics drift vs real rendering | Browser check measures real `getBBox`; tolerance 2 px; padding margin in node sizing. |
| Brand marks are trademarks | Monochrome, only when named; NOTICE file states trademark ownership. |
| elkjs licence EPL-2.0 OR GPL-3.0 | Build-time dependency, unmodified, not shipped in output HTML; recorded in THIRD_PARTY_NOTICES. |
