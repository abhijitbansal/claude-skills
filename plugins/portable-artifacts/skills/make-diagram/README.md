# make-diagram

**Prompt → JSON topology → one offline HTML diagram.** Architecture
diagrams, flowcharts, sequence diagrams and state diagrams, laid out with
[ELK](https://github.com/kieler/elkjs) and drawn by local scripts. Works with
any agent that can run shell commands. Nothing leaves your machine.

- **One spec, `diagram.json`**: a title, a type, and nodes with edges (or
  participants with messages). The agent never writes coordinates, CSS, SVG
  or HTML; the spec accepts none of them.
- **Stamped**: a favicon, an icon theme toggle in the toolbar and a provenance
  line under the title (model, effort, agent from `generatedBy` or
  `--model`/`--effort`/`--agent`; "not reported" when unknown).
  `scripts/doctor.mjs` reports anything missing with the fix for your OS;
  `--for check` adds the `check.mjs` needs (`dev_deps`, `chromium`).
- **Targeted edits**: "rename the cache" or "add a queue between the API and
  the worker" changes a few fields, and the layout is recomputed.
- **Checked before you see it**: validation lays the diagram out and lints
  the geometry (text that does not fit its box, overlapping nodes, labels on
  top of nodes), so a spec that validates is buildable.
- **Deterministic**: the same spec and versions give byte-identical
  pages. The only thing that varies is the date in the provenance line (the
  build day); set `SOURCE_DATE_EPOCH` to pin it.
- **A page worth opening**: a story player (named chapters of beats, a travelling dot along each hop, a transport bar with speed and loop), an Explore panel (what a node sends and receives, the shortest route between two nodes, Find), kind-coloured cards with emoji tiles, lanes and a legend, light and dark, full screen, SVG and PNG export.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-diagram && npm ci --omit=dev && cd -        # one-time
node make-diagram/scripts/doctor.mjs                # optional: what is missing, and how to fix it
node make-diagram/scripts/validate.mjs make-diagram/references/examples/architecture.diagram.json
node make-diagram/scripts/build.mjs    make-diagram/references/examples/architecture.diagram.json --out checkout.html --model "Claude Sonnet" --agent "Claude Code"
node make-diagram/scripts/check.mjs    checkout.html   # optional; skips when no browser is installed
```

Or just ask your agent: *"Draw the checkout request path from the browser to
the orders DB."* It writes `diagram.json`, runs the three commands and tells
you where the page is. Default output folder is `~/.agent/diagrams/`
(`PA_OUTPUT_DIR` or `--out` change it).

## Requirements

- Node.js ≥ 20 and a one-time `npm ci --omit=dev` inside this folder (ELK and
  Ajv; fonts, icon catalogs and metrics are committed files).
- **No Chromium or other browser is needed to validate or build.** Only
  `scripts/check.mjs` (a headless page check at 1440 and 390 px) and the
  browser tests use one. `check.mjs` needs Playwright (a dev dependency, so a
  full `npm ci`, not `--omit=dev`) plus a Chromium or Chrome; without either
  it skips cleanly and says so (`PA_NO_BROWSER=1` forces the skip). To enable
  it: `node scripts/doctor.mjs --for check --fix dev_deps,chromium`, or `npm ci && npx playwright install chromium` inside this folder.

## The page

| Key | Does |
|---|---|
| `P` / `E` | Play story (opens beat 1) / Explore |
| Space | play or pause the story |
| arrows, Page Up/Down, Home/End | in Play: step the beats (left/up back, right/down forward); first and last beat |
| `F` | full screen (`Esc` leaves; a sandboxed page fills its window instead) |
| `0`, double-click | fit the diagram |
| `+` / `-`, wheel, pinch | zoom |
| arrows (Explore), drag | pan |
| hover, click, shift-click | tooltip; the side panel; the shortest route; `Esc` closes the panel |
| `/` | Find a node |
| `A` | toggle edge-flow animation (off under reduced motion) |

Beats come from the spec's stories, or, with none, from the layout (one per layer, one per message in a sequence). The camera never zooms past twice the fit. Reduced-motion settings turn off the travelling dot, camera glides and autoplay.

## Types

| type | uses | node kinds |
|---|---|---|
| `architecture` | nodes, edges, nested groups | service, client, user, database, storage, queue, cache, function, gateway, external, other |
| `flow` | nodes, edges, groups | step, start, end, decision, io, subprocess, wait |
| `state` | nodes, edges, groups | state, start, end, choice |
| `sequence` | participants, messages, frames, notes | service, actor, database, queue, external |

Full field reference: [`references/schema.md`](references/schema.md). Kinds,
shapes and icons: [`references/kinds.md`](references/kinds.md). Working
examples of each type: [`references/examples/`](references/examples/).

Icons are 306 general [Lucide](https://lucide.dev) icons and 126 software
brand marks ([Simple Icons](https://simpleicons.org), CC0), drawn in one
neutral colour. Find one with `node scripts/icons.mjs search <word>`.

## Security

- The spec has no field for CSS, SVG, HTML, coordinates, colours or URLs.
- Labels and ids are escaped: a `<` or `&` in a label renders as text.
- The page carries a strict CSP (`default-src 'none'`; inline script and style
  only; `data:` images and fonts) and makes no network requests. Build time
  is offline too.

## Tests

```bash
npm ci && npm test      # the viewer tests skip when no browser is installed (npx playwright install chromium)
```

Licences of everything bundled: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
