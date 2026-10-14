# make-diagram stories — design

Status: approved 2026-10-14 (all four design sections approved in chat; the user asked for every phase to be built on one branch, one commit per phase or logical boundary).
Branch: `feat/diagram-stories`, off `feat/visual-artifacts` (PR #38, not merged). Stacked PR; nothing merges.

## Goal

make-diagram output that plays like the reference the user showed (a dark "system map" with a story player) and looks like archify in light mode:

- **Stories.** Named chapters of beats; each beat is one hop along an edge (or a focus shot) with a title and caption. One timeline, a transport bar, speed, loop, and an optional autoplay.
- **Explore.** Click a node or edge for a detail panel and a pinned trace; shift-click a second node for the route between them; find a node by name.
- **Look.** Per-kind colour, emoji in the icon tile, lane-band groups, pill edge labels, a legend with counts. Dark mode glows (navy, glowing active edge, travelling dot); light mode is archify's tinted cards on a dotted grid.
- **Full screen,** with a fill-the-window fallback where the browser refuses.

The model still writes only `diagram.json`; `validate.mjs` → `build.mjs` → `check.mjs` is unchanged.

## Reference

- `~/Downloads/IMG_2961.jpg` and `IMG_2963.MOV` (a recording of a page made elsewhere): Play story / Explore tabs, "Find actor", chapter chips (Load, Bridge 3DX call, Server API call), bottom transport (prev chapter, prev beat, play/pause, next beat, next chapter, scrubber with beat ticks, "Beat 6/13", speed, loop), caption line "06 / 13 · BRIDGE 3DX CALL · 3DSpace answers — Returns ok, status …", beat chips; the camera fits each hop, the active edge glows with a travelling dot, the rest dims. Explore shows a "System map" panel: "Click an actor or edge. Shift-click a second actor to trace a path." with count chips (1 human · 11 system · 13 beats).
- archify output already on the site: `docs/features/showcase/cache-clock/diagram*/` (tinted cards, dotted grid, numbered lanes, coloured semantic edges, legend with counts, full-screen button, PATH and LENS tools).

Clean room (D5 in the dashboard v2 design): ideas only, no code from either.

## Non-goals

Links out of nodes, per-beat timing, branching stories, forced lane layout (ELK partitioning), a toolbar style switch, WebM export.

## 1. Spec format (`diagram.json`)

Every new field is optional. Existing specs build unchanged (their look changes; see §3).

Root:

| field | type | notes |
|---|---|---|
| `autoplay` | boolean, default `false` | start the story player on open; never under `prefers-reduced-motion: reduce` |
| `stories` | array, up to 8 | each `{ id, title, beats }`; `title` up to 40 characters (the chapter chip) |

All stories together hold at most 60 beats; they play as one timeline in array order.

Beat:

| field | notes |
|---|---|
| `title` | required, up to 48 characters |
| `caption` | up to 160 characters |
| target | exactly one of: `edge` (an edge id, or a message id in a sequence); `from` + `to` (node or participant ids — the build finds the one edge between them); `focus` (array of node / group / participant ids) |

- `from`/`to` naming the edge's ends in reverse order plays the hop backwards (the dot travels `to` → `from`), for replies. No edge between them, or more than one, is an error naming both ends and asking for `edge`. In a sequence, `from`/`to` resolves among messages the same way.
- An `edge` id that does not exist is an error with a did-you-mean over edge ids.
- An edge without an `id` can still be a beat target through `from`/`to`.

Node (graph types) and participant (sequence):

| field | notes |
|---|---|
| `emoji` | exactly one emoji grapheme (an `Extended_Pictographic` or regional-indicator sequence with its modifiers / ZWJ joins); drawn in the icon tile instead of the icon. Text, two emoji, or a bare-shape kind (flow `start`/`end`/`decision`, state `start`/`end`/`choice`) is an error |
| `detail` | up to 400 characters of plain text, shown in the panel |

`steps[]` stays accepted. Internally each step becomes a `focus` beat that also reveals ids (today's `show`/`focus`/`highlight` semantics), in one implicit story titled `Walkthrough`. A spec with both `stories` and `steps` is an error: "use stories; steps is the older form". With neither, the build makes the layer steps it makes today (one per layout layer, one per message in a sequence), so Play and `P` always have something to run.

SKILL.md teaches `stories`, `emoji` and `detail`, and no longer teaches `steps`. `references/schema.md` documents both, marking `steps` as the older form.

## 2. Viewer behaviour

Top bar: `Play story` / `Explore` tabs, a `Find` box, chapter chips (Play mode), Export, theme toggle.

### Play story

- Bottom transport: previous chapter, previous beat, play/pause, next beat, next chapter; a scrubber with one tick per beat (click or drag jumps); `Beat 6/13`; speed cycling 0.5× / 1× / 1.5× / 2×; loop toggle.
- Caption line: `06 / 13 · CHAPTER · Title — caption`, with `aria-live="polite"`. Below it a scrollable row of beat chips; the active chip is marked; clicking one jumps.
- A hop beat: the camera glides to fit both ends (600 ms), the edge glows and a dot travels along it (1200 ms), then holds for the caption (2.5 s plus 40 ms per caption character, capped at 6 s). All durations divide by the speed. Everything outside the beat dims to about 25% opacity.
- A focus beat fits and lights its ids; a step-derived beat also reveals, as today.
- The timeline stops on the last beat, or restarts when loop is on. Loop defaults on when `autoplay` is true.
- Pauses on any canvas click, drag or wheel, and on any key except Space.
- Keys: Space play/pause, ←/→ beat, Home/End first/last beat, `P` play story, `E` explore, `F` full screen, `/` focus Find, Esc closes the panel or leaves full screen.

### Explore

- Hover: tooltip "label — note".
- Click a node: side panel with emoji or icon, kind in small caps, label, note, `detail`, and two lists, "Sends to" and "Receives from" (each row: edge label and the other end; clicking jumps and selects). The node's upstream and downstream stay highlighted while selected.
- Click an edge: label, both ends, style, and "Used in" (the beats that use it; clicking one switches to Play at that beat).
- Shift-click a second node: the shortest route (BFS) along arrow direction is highlighted and its hops listed. With no directed route it falls back to ignoring direction and says "ignores arrow direction". No route at all says so.
- Find: filters node labels as you type; Enter or a click fits the camera on the node and selects it.
- Nothing selected: count chips by kind plus stories and beats ("1 human · 11 system · 13 beats") and the hint "Click a node or edge. Shift-click a second node to trace a path."

### Full screen

The button or `F` calls `requestFullscreen` on the viewer root. If it rejects or is unavailable (the site gallery's `sandbox="allow-scripts"` iframe), the viewer switches to a fixed, window-filling layer; Esc leaves.

### Reduced motion

No travelling dot, the camera jumps instead of gliding, `autoplay` is ignored. Manual stepping works.

### Accessibility

Every control has an accessible name. Nodes are reachable with Tab; Enter opens the panel; closing returns focus to the node. Colour is never the only signal (shape still encodes kind; the active edge is also thicker).

### Inside make-explainer

The inline figure stays a still SVG (new look, hover tracing as today). The overlay (`dialog.dg-overlay` in `make-explainer/scripts/lib/render/diagram.mjs`) mounts the full viewer: Play, Explore, panel, full screen. Its existing Back / Next caption controls are replaced by the viewer's own transport.

## 3. Look

- **Kind colour.** One hue per kind family: person (`user`, sequence `actor`) amber; service-like (`service`, `client`, `function`, `gateway`, `cache`, `other`, flow `step`, `io`, `subprocess`, `wait`) cyan; data (`database`, `storage`) violet; `queue` teal; `external` grey; decision / state (`decision`, `choice`, `state`) indigo; bare start/end shapes stay neutral. The hue drives the card tint, border, icon tile, small-caps type label, the node's outgoing edge tint and its legend swatch. `tone` still overrides border and icon (accent / good / warn / bad).
- **Dark mode (glow).** Navy canvas with a soft radial glow and faint grid lines; cards as dark glass with a kind-hue border; rounded icon tile; the active edge glows through an SVG blur filter, and a dot (JS-driven along `getPointAtLength`, no SMIL) travels along it.
- **Light mode (archify).** Off-white canvas with a dotted grid; cards with a pale kind tint and a stronger border; mono note text; coloured edges; the active edge is thicker instead of glowing.
- **Groups as lanes.** Pale fill, a 4 px kind-neutral accent bar on the left edge (colour cycles per top-level group), label in spaced capitals at top left. When top-level groups do not overlap vertically, the build stretches them to their common left and right so they read as lanes.
- **Edge labels** are pills: canvas-coloured fill, hairline border.
- **Legend** (top right): one swatch and count per kind used, plus the edge styles used (`solid` call, `dashed` optional, `async` event).
- **Themes.** `paper`, `blueprint`, `ink`, `editorial` keep setting fonts and base palette. New tokens (kind hues, glow, grid) are added to `plugins/portable-artifacts/shared/themes/*.json` and synced with `node bin/sync-shared.mjs`; existing tokens do not change, so dashboards and explainers are unaffected. New text-on-fill pairs pass `shared/contrast.mjs` in light and dark. make-diagram's default theme becomes `blueprint`.
- **Emoji** uses the system emoji font stack (`"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`); PNG export captures what the browser draws, SVG keeps it as text.
- Design skills for implementers: `redesign-existing-projects` (static look) and `emil-design-eng` (dot and camera motion). The stack gate fails (no React or Tailwind in `package.json`), so the taste skills are out.

## 4. Structure, errors, testing

### Units

| unit | role |
|---|---|
| `scripts/lib/stories.mjs` (new) | validate `stories`; resolve beats (`from`/`to` → edge id + direction); steps → beats; limits; errors in the existing path / problem / fix + did-you-mean style |
| `scripts/lib/schema.mjs`, `spec.mjs` | `autoplay`, `stories`, `emoji`, `detail`, the stories-and-steps error, new limits in `LIMITS` |
| `scripts/lib/data.mjs` (`viewerData`) | additive keys: `beats` (resolved), `chapters`, `info` (per node: kind, emoji, note, detail), `directed` (out-edges for BFS), `autoplay`. Existing keys unchanged |
| `scripts/lib/render.mjs`, `shapes.mjs`, `css.mjs`, `svg.mjs` | card markup (icon tile, type label, emoji text), lane bands and stretching, pill labels, legend, glow filter, tokens |
| `template/` | `viewer.js` (521 lines, one function) splits into `camera.js`, `story.js`, `explore.js`, `fullscreen.js` and a slimmer `viewer.js` that wires them; `toolbar.js` and `viewer.html` updated. The build inlines them in a fixed order. Each file stays under 400 lines |
| make-explainer `render/diagram.mjs`, `template/diagram.{css,js}` | overlay mounts the full viewer |
| `shared/themes/*.json` (plugin source) | new tokens, synced to each skill |

`scripts/lib/api.mjs` stays the embedding contract: `validateSpec`, `buildDiagram`, `viewerRuntime` keep their signatures; `test/api.test.mjs` stays green and gains cases for the new keys.

### Errors

Beats resolve at build time, so the page never meets a dangling beat. `requestFullscreen` rejection falls back to the window-filling layer. Reduced motion disables autoplay and the dot. Validation messages name the JSON path, the problem and the fix.

### Tests (TDD: failing test first)

- Unit (`node --test` in `skills/make-diagram`): every new field valid and invalid; beat resolution forward, reverse, missing, ambiguous, sequence; stories + steps; limits (8 stories, 60 beats); emoji grapheme check including ZWJ, skin tone, flags, keycaps and plain text; `viewerData` new keys; lane stretching; legend counts.
- Goldens (`test/golden/*.svg`, `*.layout.json`) change because the look changes. They are regenerated once, in the look commit, and that commit says so. They are never regenerated to hide an unrelated failure.
- Browser (Playwright, alongside `test/browser.test.mjs`): Play advances beats and the dot moves along the active edge; a canvas click pauses; keyboard map; node click opens the panel with Sends to / Receives from; shift-click lists a route; Find selects; full-screen fallback inside a `sandbox="allow-scripts"` iframe; reduced motion leaves autoplay off; no console errors and no horizontal overflow at 1280 and 390 px.
- Guard proof: each new browser assertion is shown failing against a deliberately broken page before it is trusted.
- make-explainer: a page embedding a story diagram builds, `check.mjs` passes, and the overlay plays a beat; the full make-explainer suite stays green.
- Repo: `python3 -m pytest -q` and `bats tests/bats` where `setup/` is touched (it should not be).
- Eval: `node eval/run-eval.mjs --skill diagram --host claude --model haiku --timeout 900` over the 8 existing prompts plus 2 new ones (a story prompt and an emoji prompt; `eval/prompts/diagram.json`). The `model: haiku` / `effort: low` pin stays only at 10/10 valid builds with median validate runs ≤ 2; otherwise the pin is lifted and the result recorded. A summary goes to `eval/results/summary-diagram-stories-2026-10-14.md`.

## 5. Phases (one commit or more per phase)

1. **Spec format and story player.** `stories.mjs`, schema, `viewerData` keys, template split, `story.js` and the transport bar, keyboard map, reduced motion.
2. **Explore.** Panel, pinned trace, shortest route, Find, tooltips, focus handling.
3. **Look.** Theme tokens, kind colours, emoji tile, lanes, pills, legend, glow and dot styling, default theme `blueprint`, goldens.
4. **Full screen, embed, docs, eval, sample.** Full screen and fallback; make-explainer overlay; SKILL.md, `references/schema.md`, `references/kinds.md`, README; eval run and summary; rebuild the gallery sample `docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/` with stories and emoji, and refresh its thumbnail.

Each phase: an executor builds it test-first; a fresh reviewer reports findings only; CRITICAL and HIGH findings are fixed before the commit; the orchestrator commits and pushes.

## Risks

- **Eval regression.** More fields widen the contract a small model must follow. Mitigation: all optional; SKILL.md teaches one walkthrough mechanism; the eval decides the pin.
- **Page weight.** Viewer JS grows. Budget: every built example stays under the existing 400 KB limit (`test/check.test.mjs`); the pipeline sample is about 180 KB today.
- **Emoji rendering** differs by OS; documented, not fixed.
- **Golden churn** in phase 3 hides nothing only if the regeneration is isolated to that commit.
