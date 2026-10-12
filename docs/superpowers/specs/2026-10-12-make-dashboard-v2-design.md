# make-dashboard v2 — Design (SP1 of the visual-artifacts program)

*2026-10-12 · branch `feat/visual-artifacts` · status: spec, awaiting review*

## Program context

This branch carries three sub-projects in one PR. Each sub-project gets its own
spec, brainstormed before its implementation starts. This doc is the SP1 spec
and records the program-level decisions so SP2 and SP3 start from them.

| # | Sub-project | What it is |
|---|---|---|
| SP1 | make-dashboard v2 | Chart kinds with built-in interactivity and alternate views, themes, live reload. Also lands the shared core. |
| SP2 | make-diagram | Our own architecture/flow diagram skill (replaces archify): typed topology in, auto-layout, icons, animation, presentation mode. |
| SP3 | make-explainer | Our own visual-explainer: typed sections in, single HTML out, presets, slides mode; embeds SP2 diagrams, dashboard charts and make-motion video. |

### Program decisions

| ID | Decision | Why |
|---|---|---|
| D1 | A family of focused skills in `plugins/portable-artifacts` (`make-dashboard`, `make-diagram`, `make-explainer`), not one combined skill and not forks of archify or visual-explainer. | A small SKILL.md and schema per skill keeps cheap models inside one small contract. Forks would import archify's ~750 KB-per-file output and visual-explainer's hand-written-HTML default and release churn. |
| D2 | **The model writes one JSON spec, never HTML, CSS, SVG or coordinates.** Scripts validate (field-level, did-you-mean), build, and lint. | Evidence: `eval/results/summary-full-2026-10-10.md` — gemma4 reached 10/10 on make-dashboard (one spec + validator) but failed make-motion on multi-step tool use. Anti-slop becomes structural: no spec field can produce a gradient, glass blur or emoji marker. |
| D3 | Shared code lives in `plugins/portable-artifacts/shared/` and is **synced into each skill as a committed copy** (`skills/<skill>/shared/`). CI fails on drift. | Every install path copies only skill folders or the whole plugin; `npx skills add … --skill <name>` copies only the skill folder and must keep working. Git stores identical blobs once. |
| D4 | Skill-to-skill dependencies (SP3 needs SP2, make-dashboard, make-motion) are declared and resolved by `bin/install.mjs` in SP3. Under `npx skills add`, a missing sibling fails with the exact install command. | `npx skills add` cannot install dependencies. |
| D5 | Clean-room reimplementation. Both upstreams are MIT; we take ideas, not code. Any adapted code gets attribution in a third-party notice. | User wants no dependency on archify or visual-explainer. |
| D6 | One branch, one PR for SP1–SP3; atomic commits per step. One `plugin.json` version bump (0.2.2 → 0.3.0). | User request. CI's `plugin-version-guard` needs one bump against `main`. |
| D7 | Themes are picked by the user from a rendered gallery (sample dashboard × each theme × light/dark), not chosen in the abstract. | Palettes are judged by looking at them. |
| D8 | "Design-router learnings" = the bans held by the skills it routes to (visual-explainer never-list, impeccable craft floor, redesign-existing-projects bans) plus the house style of the user's existing artifacts. | `design-router` is dispatch-only and holds no design rules. |

### Program follow-ups (not in this branch unless pulled in)

- Add rows for make-dashboard / make-diagram / make-explainer to `design-router`. It lives in `~/.agents/skills/design-router`, a different repo.
- Linked brushing across cards (selection in one chart filters others).
- make-motion on shared themes and fonts (it uses Inter, which is on the never-list): planned for SP3, where motion is embedded next to themed content.

## SP1 goals

1. Charts are authored as **kinds** (`"kind": "line"`) with field roles; scripts expand them into Vega-Lite with that kind's interactivity, theme and alternate views. Raw `vegaLite` keeps working.
2. Each card offers its kind's **alternate views** in a switcher, or two views side by side with `pair: true`.
3. Each card exports **PNG, SVG and CSV**, and offers a sortable **Table** view.
4. Pages use a **theme** from `shared/` with embedded fonts and a light/dark/auto toggle.
5. **Live reload**: `serve.mjs --watch` rebuilds when the spec or a data file changes and pushes the update to the open page; `--interval` and a Rebuild button cover sources without files.
6. The skill stays runnable by the cheapest model: SKILL.md about 100 lines, kinds reference loaded on demand, eval passes on Haiku and gemma4.

## Non-goals

- Cross-card linked selection (follow-up).
- Live reload for a page opened from disk (`file://`): it has no server to talk to.
- Changing the security model: the SQL allowlist, locked DuckDB connection, and the on-disk page's `default-src 'none'` CSP stay as they are.
- New data source types.

## Spec contract

A chart sets exactly one of `kind` or `vegaLite`.

```json
{
  "title": "Sales", "theme": "paper",
  "sources": { "sales": { "type": "csv", "path": "data/sales.csv" } },
  "queries": {
    "monthly": "SELECT date_trunc('month', day) AS month, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1",
    "by_region": "SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC"
  },
  "charts": [
    { "id": "trend", "title": "Revenue up 18% since March", "query": "monthly",
      "kind": "line", "x": "month", "y": "revenue", "color": "region",
      "format": "currency", "views": ["area", "table"], "width": "full" },
    { "id": "mix", "title": "North drives half of revenue", "query": "by_region",
      "kind": "bar", "x": "region", "y": "revenue", "pair": true },
    { "id": "legacy", "title": "Raw Vega-Lite still works", "query": "by_region",
      "vegaLite": { "mark": "bar", "encoding": { "x": { "field": "region", "type": "nominal" }, "y": { "field": "revenue", "type": "quantitative" } } } }
  ]
}
```

New fields:

| Field | Rule |
|---|---|
| root `theme` | Optional theme name from `shared/themes/`. Default: the house theme. Unknown name → error listing the available themes. |
| `charts[].kind` | One of the kinds below. Unknown → did-you-mean error listing all kinds. |
| `charts[].x`, `y`, `color`, `size`, `value` | Field roles. Each must name a column of the chart's query; which roles are required or allowed depends on the kind. Errors name the path (`charts[1].y`) and suggest the closest column. |
| `charts[].format` | `number \| currency \| percent \| compact` (same as KPIs); applies to the quantitative axis and tooltips. |
| `charts[].views` | Optional ordered list of alternate view names allowed for the kind. Narrows and reorders the defaults; `table` is always available. Requesting a view the data cannot support is an error that says why. |
| `charts[].pair` | Optional boolean. Shows the first two views (primary + first alternate) side by side; forces `width: full`; stacks vertically below 900 px. |

Field types are inferred from the DuckDB column types already returned with each query
(`scripts/lib/data.mjs:108-112`): `DATE` / `TIMESTAMP*` → temporal (UTC time units added
automatically), numeric → quantitative, everything else → nominal. A role given a column
of the wrong type is an error (`charts[0].y: "region" is text; y needs a numeric column`).

### Kinds

| kind | required roles | optional | interactivity | alternate views |
|---|---|---|---|---|
| `bar` | `x` (nominal/temporal), `y` (numeric) | — | hover highlight | `sorted`, `share`, `table` |
| `stacked-bar` | `x`, `y`, `color` | — | hover, legend filter | `grouped`, `normalized`, `table` |
| `grouped-bar` | `x`, `y`, `color` | — | hover, legend filter | `stacked`, `normalized`, `table` |
| `line` | `x` (temporal/ordinal), `y` | `color` | nearest-point crosshair, x zoom/pan, legend filter | `area`, `table` |
| `area` | `x`, `y` | `color` | same as line | `line`, `table` |
| `scatter` | `x`, `y` (numeric) | `color` | zoom/pan both axes, legend filter | `table` |
| `bubble` | `x`, `y`, `size` (numeric) | `color` | as scatter | `scatter`, `table` |
| `heatmap` | `x`, `y` (nominal/temporal), `value` (numeric) | — | cell hover | `table` |
| `histogram` | `value` (numeric) | — | hover | `boxplot`, `table` |
| `boxplot` | `value` (numeric) | `x` (group) | hover | `histogram`, `table` |
| `donut` | `x` (category), `y` (numeric) | — | hover, legend filter | `bar`, `table` |

Availability rules (checked against the query rows at validate and build):

- `share`, `normalized` and `donut` need every value ≥ 0 and a positive total. Stacked `area` with `color` needs every value ≥ 0.
- `donut` needs ≤ 6 categories.
- `color` is only allowed for a nominal column with ≤ 8 distinct values; more → error suggesting a filter or `TOP 8` + "Other" in SQL.
- An unavailable default view is silently dropped; an unavailable *requested* view (`views`) is an error naming the offending value and row.

### Expansion rules (`scripts/lib/kinds.mjs`)

Deterministic, unit-tested with golden files:

- `bar` turns horizontal when the longest x label exceeds 12 characters or there are more than 8 categories.
- Order follows the query (`sort: null`) unless the `sorted` view is active.
- Injected Vega-Lite params are namespaced `pa_*`:
  - hover: `{ name: "pa_hover", select: { type: "point", on: "pointerover", clear: "pointerout" } }` with an opacity condition.
  - legend filter: `{ name: "pa_legend", select: { type: "point", fields: [<color>] }, bind: "legend" }`.
  - crosshair: a layered rule + points driven by `{ name: "pa_x", select: { type: "point", encodings: ["x"], nearest: true, on: "pointerover", clear: "pointerout" } }`.
  - zoom/pan: `{ name: "pa_zoom", select: { type: "interval", encodings: [...] }, bind: "scales" }`; double-click resets.
- `format` maps to d3 formats shared with KPI formatting.

### Raw `vegaLite` charts

Unchanged contract (`FORBIDDEN_KEYS` and `MARKS` in `scripts/lib/spec.mjs:159-186` still apply). Best-effort additions in the page:

- tooltips (today's `withTooltip`, `template/page.html:130-138`);
- legend filter when the spec has a nominal `color` encoding and declares no `params` of its own;
- x/y zoom on unit specs whose mark is `point`/`circle`/`square`;
- Table view and PNG/SVG/CSV export, like every card.

## Page runtime (`template/page.html`)

- **Card:** title; a view switcher (segmented control, `role="tablist"`, arrow-key navigation) when the chart has more than one view; an export menu (PNG, SVG, CSV); the existing "SQL & data" `<details>`.
- **Views:** `kinds.mjs` emits one Vega-Lite spec per view at build; the page renders the active one. `pair` renders two. All views of a chart share the query rows already embedded once per query.
- **Table view:** all embedded rows, sortable by column header, formatted like tooltips; renders the first 500 rows with a "showing 500 of N" note.
- **Export:**
  - PNG via `view.toImageURL('png', 2)`, SVG via `view.toImageURL('svg')`.
  - CSV built from the embedded rows (RFC 4180 quoting). Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheet apps don't run them as formulas.
  - Downloads use `<a download>`; the browser test proves they work under the strict CSP.
- **Theme toggle:** header button cycling auto → light → dark. It sets `data-theme` on `<html>`; dark tokens apply under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. The choice is kept in `localStorage` (`pa-theme`), wrapped in try/catch, so the page works when storage is blocked.
- **Fonts:** `@font-face` with `data:` URLs (already allowed by `font-src data:`), only the files the theme uses.
- The Vega config keeps being built from CSS tokens (`template/page.html:99-127`), now including the theme's font roles.

## Live reload (`scripts/serve.mjs --watch`)

```
node <skill-dir>/scripts/serve.mjs --watch dashboard.json [--interval 60] [--open]
```

- The existing static mode (`serve.mjs <dist>`) is unchanged.
- Startup: validate + build once in-process (same code path as `build.mjs`), serve `dist/`.
- **Watch:**
  - The spec file plus every resolved file source (`build.mjs:85-88` already computes the absolute paths).
  - Watches the parent directories and filters by file name, so editors that save by rename-and-replace are caught.
  - Debounce 300 ms (make-motion pattern, `skills/make-motion/scripts/lib/server.mjs:182-192`).
  - One build at a time; a change during a build queues exactly one more.
- **Push:**
  - Server-sent events on `/events` (make-motion pattern, `server.mjs:122,136`).
  - `rebuilt`: the page reloads and restores scroll position and each card's active view from `sessionStorage`.
  - `error`: a banner shows the validator/build message (as text, not HTML) and the last good page stays.
- **On demand:**
  - A "Rebuild now" button POSTs `/rebuild` with a per-run random token in the `x-pa-token` header.
  - A custom header forces a CORS preflight, which the server never approves, so another site cannot trigger rebuilds. A missing or wrong token → 403.
  - `--interval <seconds>` (minimum 5) rebuilds on a timer, for Postgres/MySQL sources or anything else without a watchable file.
- **CSP:**
  - `dist/index.html` on disk is never changed by watch mode.
  - Only the served response is rewritten: the CSP meta gains `connect-src 'self'`, and the live client script plus badge ("Live · rebuilt 10:42:05" / "Build failed — showing last good") are injected.
- **Security unchanged:** 127.0.0.1 bind, Host-header check, traversal and symlink refusal (`serve.mjs:38-41,59-66`). Every rebuild re-runs validation and the SQL guard.

## Shared core (`plugins/portable-artifacts/shared/`)

| Path | Contents |
|---|---|
| `themes/<name>.json` | Light and dark tokens: `page`, `surface`, `text`, `text2`, `text3`, `line`, `grid`, `accent`, `accentSoft`, `warn`, `good`, `bad`, `cat1..cat8`, `seq1..seq7`; font roles `display`, `body`, `mono` (family + file names). |
| `fonts/` | woff2 files covering basic Latin, weights 400 and 600, copied from `@fontsource` packages, each family with its OFL licence. Candidates from the house style: IBM Plex Sans, IBM Plex Mono, Newsreader, Atkinson Hyperlegible, JetBrains Mono, Bricolage Grotesque. |
| `theme.mjs` | Theme JSON → CSS custom properties (light, dark, `data-theme` overrides), `@font-face` rules for the fonts used, and the values the Vega config needs. |
| `contrast.mjs` | WCAG checks, run by the build and the tests, in both modes: `text`, `text2`, `text3` ≥ 4.5:1 against `page` and `surface`; `cat1..cat8` and `seq7` ≥ 3:1 against `surface`; `seq1..seq7` monotonic in lightness. |
| `errors.mjs` | The did-you-mean / error-formatting helper now duplicated at `skills/make-dashboard/scripts/lib/errors.mjs` and `skills/make-motion/scripts/lib/errors.mjs`. |
| `README.md` | "Edit here only; run `node ../scripts/sync-shared.mjs`." |

- **Sync:** `plugins/portable-artifacts/scripts/sync-shared.mjs` copies `shared/` into `skills/<skill>/shared/` for every skill, and writes a `GENERATED.md` in each copy pointing back to the source. `--check` exits non-zero and lists drifted files.
- **CI:** the `cmp` step in `.github/workflows/test.yml:76-77` is replaced by `sync-shared.mjs --check`.
- **Imports:** skills import `../shared/…` relative to their scripts, the same in a checkout, a plugin-cache install, an `install.mjs` copy, a `--link` symlink and an `npx skills add` copy.
- **Themes:** 4–5 candidates in SP1. The default (`paper`) encodes the house style: warm off-white page, white cards, hairline rules, one teal accent, tinted near-black dark mode, three font roles. Final names and palettes are fixed after the user picks from the gallery.
- **Theme override:** `build.mjs --theme <name>` overrides the spec's theme. The gallery is produced with it into `.scratch/`.

## Validation and errors

- The JSON schema in `scripts/lib/spec.mjs` gains `theme`, `kind`, the role fields, `format`, `views` and `pair`. `required` changes from `vegaLite` to "exactly one of `kind` / `vegaLite`", with a custom message instead of ajv's `oneOf` dump.
- Role, type and availability checks need the query results, so they run where field checks run today (after queries, before render). `validate.mjs` already executes every query, so "valid" still means buildable.
- Every new error names the JSON path, the bad value, and the closest valid choice.

## Install and dependency changes

- `bin/install.mjs` and the SKILL.md first-use step switch to `npm ci --omit=dev`, so users don't download Playwright (now a make-dashboard dev dependency). make-motion keeps Playwright as a runtime dependency; it is unaffected.
- No installer change for `shared/`: it travels inside each skill folder.

## SKILL.md and docs

- **SKILL.md:**
  - The spec example uses kinds. One line points to `references/kinds.md`, which has one example per kind and is read on demand.
  - Step 5 adds the watch command.
  - It stays about 100 lines.
- **Frontmatter:** adds `model: haiku` and `effort: low` **only after** confirming that Claude Code honors skill-level `model:` for the skill's turn. The repo already uses the keys in `plugins/prompt-craft/skills/improve-prompt/SKILL.md`; other hosts ignore them. The eval run is the proof, not the frontmatter.
- **Docs to update:** `references/schema.md`, `references/refresh.md` (live mode), the plugin README, `USAGE.md`, the portable-artifacts site page (per-line copy-button contract from `CLAUDE.md`), and the `plugin.json` description.

## Testing

**Unit (`node --test`, per skill):**

- Golden Vega-Lite per kind and per view (committed). A baseline changes only when the commit message says why.
- Availability rules: negative values block `share` / `normalized` / `donut`; more than 6 categories blocks `donut`; more than 8 colour values is an error.
- Schema: exactly one of `kind` / `vegaLite`; role-to-column and role-type errors with suggestions; existing examples (`references/examples/*.json`) still validate and build.
- Guardrails, each shown failing on bad input before it is trusted:
  - a low-contrast fixture theme fails `contrast.mjs`;
  - an edited synced copy fails `sync-shared --check`.
- `serve --watch`:
  - editing the CSV emits `rebuilt`;
  - a broken spec emits `error` and the last good page stays;
  - a rename-style save is caught;
  - `/rebuild` without the token returns 403;
  - the served HTML has `connect-src 'self'` and the file on disk does not.
- CSV export quoting and the formula-prefix guard.

**Browser (Playwright, `test/browser.test.mjs`, skips when Chromium is missing):**

- Build the sales example, open it at 1280 px and 390 px.
- No console errors and no horizontal overflow; every card renders an SVG.
- Switching views changes the rendered chart; `pair` shows two.
- PNG, SVG and CSV exports each trigger a download under the strict CSP.
- Hovering a bar changes mark opacity; clicking a legend entry filters.
- The theme toggle switches tokens and survives a reload.
- Under `serve --watch`, editing the CSV changes a KPI value on the open page.

CI adds `npx playwright install --with-deps chromium` to the existing Ubuntu `node` job so the browser test runs there.

**Manual:** the theme gallery is reviewed by the user; screenshots of the example at both widths are viewed before the work is called done; a manual-test checklist HTML is generated at the end of the branch.

## Cost and eval

- Add prompts to `eval/prompts/dashboard.json`:
  - a new dashboard using kinds;
  - views and `pair`;
  - a theme;
  - an edit that changes one chart's kind.
- **Runs:** Claude Haiku and Sonnet via the `claude` host (billed to the user's account, so run only after the user says go), plus gemma4 via `codex-oss` (local).
- **Acceptance:**
  - Haiku ≥ 9/10 prompts end with a valid build.
  - gemma4 is no worse than its recorded 10/10 on the existing dashboard prompts.
  - Median validate runs stays at 1.
- **Recorded:** validate runs and seconds per prompt, as the harness does today.

## Commit sequence (SP1 part of `feat/visual-artifacts`)

1. `docs:` this spec.
2. `feat(shared):` `shared/` (themes, fonts, `theme.mjs`, `contrast.mjs`, `errors.mjs`), `sync-shared.mjs` + `--check`, CI step swap; both skills import `errors.mjs` from their synced copy.
3. `feat(make-dashboard):` themes, embedded fonts, light/dark/auto toggle, `--theme` flag; theme gallery for the user to pick from.
4. `feat(make-dashboard):` chart kinds, field roles, type inference, validation.
5. `feat(make-dashboard):` interactivity, views, `pair`, Table view, export; browser test; CI Chromium step; `--omit=dev`.
6. `feat(make-dashboard):` live reload (`--watch`, `--interval`, Rebuild button).
7. `docs:` SKILL.md, references, README, USAGE, site page; `plugin.json` 0.3.0; eval results.

Each commit leaves `npm test` green in both skills.

## Risks and things to verify first

| Risk | Check |
|---|---|
| Skill-level `model:` / `effort:` may not switch the model. | Ask the `claude-code-guide` agent with docs evidence before adding the keys. |
| Vega-Lite selections might not evaluate under `ast: true` (the bundled interpreter that avoids `unsafe-eval`). | Spike in the browser test before building all kinds. |
| `<a download>` with `data:`/`blob:` URLs might be blocked under `default-src 'none'`. | Browser test; fallback is opening the SVG/PNG in a new tab. |
| `npx skills add` might skip subfolders or binary files. | Manual acceptance: install each skill from the branch into a temp dir; confirm `shared/` and fonts exist and `validate` + `build` pass. On the manual checklist. |
| Page weight grows by about 150 KB of fonts on top of about 850 KB of Vega. | Test asserts the embedded font payload stays ≤ 200 KB. |

## Acceptance criteria

- Existing specs and examples build unchanged (apart from theme and fonts).
- Every kind renders with its interactivity and views in the browser test, at both widths, with no console errors.
- All exports download under the strict CSP.
- Editing a CSV under `serve --watch` updates the open page; the on-disk `dist/index.html` keeps `default-src 'none'`.
- `sync-shared --check`, unit tests and the browser test pass in CI.
- `npx skills add` of make-dashboard works from a clean temp dir (manual check).
- Eval acceptance above is met, with the result file committed.
