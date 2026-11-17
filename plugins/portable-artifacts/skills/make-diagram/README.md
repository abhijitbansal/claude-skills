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
- **A page worth opening**: a story player (named chapters of beats, a travelling dot along each hop, a transport bar with an icon play/pause button, speed, loop and a progress ring that shows when the next beat comes), an Explore panel (what a node sends and receives, the shortest route between two nodes, Find), kind-coloured cards with emoji tiles, lanes and a legend, light and dark, full screen, SVG and PNG export.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-diagram && npm ci --omit=dev && cd -        # one-time
node make-diagram/scripts/doctor.mjs                # optional: what is missing, and how to fix it
node make-diagram/scripts/validate.mjs make-diagram/references/examples/architecture.diagram.json
node make-diagram/scripts/build.mjs    make-diagram/references/examples/architecture.diagram.json --out checkout.html --model "Claude Sonnet" --agent "Claude Code"
node make-diagram/scripts/check.mjs    checkout.html --shots shots   # optional; skips when no browser is installed; --shots also writes light and dark PNGs at 390 and 1280 px to look at
node make-diagram/scripts/build.mjs    make-diagram/references/examples/architecture.diagram.json --format svg --out checkout.svg   # one standalone SVG, no browser
```

Or just ask your agent: *"Draw the checkout request path from the browser to
the orders DB."* It writes `diagram.json`, runs the three commands and tells
you where the page is. `build.mjs` prints `wrote <path>` and then the `file://` URL alone on
its own line. Without `--out` the page goes to `<git root>/.scratch/<slug>.html` when the spec sits
in a git repo, else `~/.agent/diagrams/`; `PA_OUTPUT_DIR` or `--out` change it.

## Requirements

- Node.js ≥ 20 and a one-time `npm ci --omit=dev` inside this folder (ELK and
  Ajv; fonts, icon catalogs and metrics are committed files).
- **No Chromium or other browser is needed to validate or build.** Only
  `scripts/check.mjs` (a headless page check at 1440 and 390 px) and the
  browser tests use one. `check.mjs` needs Playwright (a dev dependency, so a
  full `npm ci`, not `--omit=dev`) plus a Chromium or Chrome; without either
  it skips cleanly and says so (`PA_NO_BROWSER=1` forces the skip). To enable
  it: `node scripts/doctor.mjs --for check --fix dev_deps,chromium`, or `npm ci && npx playwright install chromium` inside this folder.

## Spec warnings, legibility, SVG, rebuilding

- **Warnings never fail a spec.** `validate.mjs` and `build.mjs` print `path: warning: message` and still exit 0 (`--json` adds a `warnings` list when there are any). The checks: a node no edge touches, a flow `decision` with fewer than two outgoing edges or an unlabelled branch, groups or nodes whose labels differ only by case, a sequence participant with no message, a note too long for its card (clipped there with an ellipsis; the Explore panel shows it whole), and a diagram whose labels would draw smaller than 8 px when the page fits it on a 1440 px screen (`check.mjs` measures the same thing in the page and fails on it).
- **Long chains wrap.** When the plain layout would draw its labels below that floor and the spec has no groups, the graph is laid out again with ELK's layer wrapping (rows, or columns when the flow runs down) and the larger fit is kept. A 12-node chain draws at about 17 px that way; a 60-node chain still warns (about 7 px): split it.
- **`--format svg`** writes one standalone `.svg` with the theme's variables, embedded fonts, the diagram CSS and a surface-coloured background. The limit: an SVG file has one palette, so it carries the theme's **light** palette only (no dark variant, no light/dark switch). The page's toolbar SVG export draws whichever scheme the page shows.
- **Rebuilding.** The page records `<meta name="pa-build" content="spec=<file name>; theme=<name>; out=<file name>; flags=<--theme ...|none>">` (file names only, no folders): enough to derive the build command again. `doctor.mjs --for <spec.diagram.json>` reads the spec and reports the `cloud:` icons it names that this machine lacks, with the import command.
- **Missing install.** `validate.mjs` and `build.mjs` check for `node_modules` before anything else and, when it is missing, print one line naming the doctor command (exit 2). `doctor.mjs` exits 1 when a required item is missing or stale, 0 otherwise, 2 on bad usage.

## The page

| Key | Does |
|---|---|
| `P` / `E` | Play story (starts playing at beat 1; reduced motion waits for Space) / Explore |
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

Icons are 306 general [Lucide](https://lucide.dev) icons and 133 software
brand marks ([Simple Icons](https://simpleicons.org), CC0), drawn in one
neutral colour. Find one with `node scripts/icons.mjs search <word>`.

Cloud icons (`cloud:aws-lambda`, `cloud:google-cloud-run`) come from the CC0
[SVG Logos](https://github.com/gilbarbara/logos) pack: 60 AWS names and 4
Google Cloud names, drawn in their own colours (a `tone` does not tint them).
Services the pack lacks can be imported from the vendor's own icon download,
which you unpack yourself after accepting the vendor's terms:
`node scripts/icons.mjs import <aws|gcp> <folder>`. Imported icons live outside
the repo (`$MAKE_DIAGRAM_ICON_DIR`, default
`~/.cache/portable-artifacts/make-diagram/`); a bundled name wins over an
imported one, and a built page embeds the markup it uses. Every icon, bundled or
imported, passes one allow-list (`scripts/lib/svg-safe.mjs`): no script, event
handler, `foreignObject`, `<style>` or external reference gets through. The
importer is tested on folders shaped like the documented layouts, not on real
vendor downloads. An import skips (and reports) a file over 256 KiB, a symlink, an
unreadable file or folder, and anything past 32 MiB read in total; it exits
non-zero when nothing could be imported. A damaged file in the import folder
never affects the bundled icons: `search` and `list` warn on stderr, and only a
name that exists in that file fails, with an error naming it.

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
