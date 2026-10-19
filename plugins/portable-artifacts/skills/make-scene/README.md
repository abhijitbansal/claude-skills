# make-scene

**Prompt → JSON spec → one offline 3D page.** Your rows become a city of
towers, a forest, a galaxy or a terrain, or an existing make-diagram diagram
or make-dashboard chart is lifted into 3D. The page is drawn with a pinned,
bundled [three.js](https://threejs.org/) and guided by a camera tour. Works
with any agent that can run shell commands. Nothing leaves your machine.

- **One spec, `scene.json`**: a title, then either `data` (rows with `group`,
  `t`, `value`) or a `lift`, plus an optional tour. The agent never writes
  three.js, coordinates, CSS or HTML; the spec accepts none of them.
- **Four worlds, two lifts**: city, forest, galaxy, terrain; a `diagram.json`
  lifted into 3D (any type), or one chart of a dashboard.
- **Recommend, build, then offer**: the build picks the world that fits the
  data, prints an alternatives table (fit, page size, render weight, the exact
  command to switch) and costs no model tokens to switch (`--world`).
- **Every number stays exact**: height scales start at zero; hover shows the
  exact value; an Explore list and a data table carry the rest. Without WebGL
  the page falls back to the table (or the 2D drawing for a lift).
- **Deterministic**: the same spec and versions give byte-identical pages
  (`SOURCE_DATE_EPOCH` pins the build day). No `Math.random` anywhere.
- **Light on the machine**: instanced geometry, rendering pauses off-screen,
  in a hidden tab and when idle; reduced motion turns off orbit and sway.
- **Embeddable**: make-explainer pages take a `scene` section (up to 4 per
  page).

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-scene && npm ci --omit=dev && cd -        # one-time
node make-scene/scripts/doctor.mjs                # optional: what is missing, and how to fix it
node make-scene/scripts/validate.mjs make-scene/references/examples/city.scene.json
node make-scene/scripts/build.mjs    make-scene/references/examples/city.scene.json --out city.html
node make-scene/scripts/check.mjs    city.html    # optional; skips when no browser is installed
node make-scene/scripts/rows.mjs git --weeks 12   # commits per top-level folder per week, as data.file
```

Or just ask your agent: *"Show our commits per week per folder as a 3D city,
with a tour of the busiest weeks."* It writes `scene.json`, validates, builds
and tells you where the page is. Default output folder is `~/.agent/scenes/`
(`PA_OUTPUT_DIR` or `--out` change it); the default theme is `dusk`.

## Requirements

- Node.js >= 20 and a one-time `npm ci --omit=dev` inside this folder (Ajv;
  fonts and the three.js runtime bundle are committed files).
- Lifting a diagram needs make-diagram installed beside this skill; lifting a
  chart needs make-dashboard. Plain worlds need neither.
- **No browser is needed to validate or build.** Only `scripts/check.mjs` and
  the browser tests use one (Playwright and Chromium; without them they skip
  cleanly). To enable: `node scripts/doctor.mjs --for check --fix dev_deps,chromium`.

## Worlds and lifts

| Spec | `group` | `t` | `value` | Best for |
|---|---|---|---|---|
| `city` | district | position along the street | building height | a time or sequence per group |
| `forest` | tree (`parent` grows a sub-tree) | branch height | leaf size | hierarchies |
| `galaxy` | star (`links` draw trails) | orbit radius | planet size | linked things |
| `terrain` | row of the grid | column of the grid | elevation | a dense group by number grid (a dated grid starts as a city) |
| `lift.diagram` | | | | an existing `diagram.json` as blocks and tubes |
| `lift.dashboard` | | | | one chart as towers, ribbons, spheres or a surface |

Field reference: [`references/schema.md`](references/schema.md). What each
world does: [`references/worlds.md`](references/worlds.md). The intermediate
scene graph: [`references/scene-graph.md`](references/scene-graph.md). Working
examples: [`references/examples/`](references/examples/).

## The page

Drag, scroll or pinch to orbit and zoom (auto-orbit stops at the first touch);
hover or tap for the exact label and value; the Explore list flies to any
group or item; Play or Space runs the tour, arrow keys step the beats; `F` is
full screen; PNG export saves the current view; the toggle follows light and
dark.

## Security

- The spec has no field for CSS, SVG, HTML, coordinates, colours or URLs.
- Labels and group names reach the page only as text, never as markup.
- The page carries the sibling strict CSP (inline script and style only; no
  eval, workers or blob URLs) and makes no network requests. Build time is
  offline too.

## Tests

```bash
npm ci && npm test      # the browser tests skip when no browser is installed (npx playwright install chromium)
```

Licences of everything bundled: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
