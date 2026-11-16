# make-motion 2: Shot Kinds, Second Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remaining shot kinds of the design (`screen`, `media`, `map`, `diagram`, `timeline`, `code`, `feed`), the chart types `scatter` and `race`, the remaining devices (`label`, `focus`, `route`, `numeral`, `sticker`, `sweep`, `duotone`, `halftone`) and the move names as a registry, composed for `desk` and `pop` at 16:9 and 9:16, each passing the film's own review and an independent look review of its frames.

**Architecture:** A kind stays a registry entry that turns one shot into scene-graph nodes for a look and a format, as the nine existing kinds do. Two things are new. First, `map` and `code` need libraries (`d3-geo`, `topojson-client`, `shiki`) that the render page cannot load: the page is served only `/engine/*.mjs`, fonts and the film's pictures (`scripts/v2/server.mjs`), and a kind's `expand` runs in the page (`engine/page/stage.mjs` is the only caller of `buildFilm` outside the tests). So those libraries run in Node only, in a **prepare** step that turns a shot into plain JSON (projected outlines, coloured tokens) which the page receives with the film and the kind reads as `ctx.prepared`. Second, a kind that fails the look review is **parked** by look data, the way the `cosmos` look was parked.

**Tech Stack:** The version 2 engine as it stands. `node:test`. `d3-geo` 3.1.1 and `topojson-client` 3.1.0 promoted from transitive to direct exact pins (both are already in `package-lock.json` at those versions, licence ISC there); `world-atlas` 2.0.2, `us-atlas` 3.0.1 and `shiki` 4.5.0 stay as they are pinned today. No other package.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, sections 5 (art direction, devices 5.3), 6.1 (shots), 8.2 to 8.5 (scene graph, moves, graphics, review), 11 (dependencies), 16 and 17. House style and the first wave: `docs/superpowers/plans/2026-11-16-pa2-shot-kinds-a.md`. What reviewers rejected: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` (shot kinds and cosmos sections) and `docs/decisions-pending.md`.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/` (`M`) unless they start with `docs/` or `plugins/`.

## Global Constraints

Everything in the first wave's Global Constraints still binds (kind file layout, purity, look data and no branch on a look's or mode's name, units, typography 5.2, layout 5.4, words with the narration, `summary` / `example` / `schema` / `targets` / `numbered` / `showsWords` / `review`, clean examples in both looks and formats, the implementer views every sheet, files under 800 lines, functions under 50, tests first, a mutation row for a test written after its code). In addition:

- **Version 1 is read, never imported.** `template/` and `scripts/lib/` are deleted by the cut-over plan. Tables and pure geometry this plan needs (the atlas table and name lists of `template/maps.mjs` and `template/map-names.mjs`, the language list and aliases of `template/code-theme.mjs`, the window chrome sizes of `template/blocks/browser-window.mjs`, `rankByPeriod` of `template/blocks/race.mjs`) are copied into version 2 files with a one-line note of where they came from. No version 2 file imports from `template/`, `scripts/lib/` or `scripts/*.mjs` of version 1 (a test in Task 1 holds this for the new files). The DOM and Vega renderers are not reused.
- **No package import under `engine/`.** The page cannot resolve a bare specifier. Libraries are imported only under `scripts/v2/prepare/`. The server gains no `node_modules` or `/vendor` route.
- **The approved frames do not change.** New moves, devices and look data are added beside what exists; `enter`, `exit`, `emphasize`, `draw` and `count` keep their values, and the nine existing kinds keep their code paths. Task 1 records the expansion of every existing kind's example before anything else changes, and that test stays green to the end.
- **Every new registered device and every new `eventDevices` name needs a sound entry (a cue or `null`) in every registered look**, `cosmos` included (`validateLook`, `scripts/v2/sound/cues.mjs`). `engine/looks/cosmos.mjs` is being edited by another agent: this plan adds only `sounds.device.<name>: null` rows there, in the same commit as the registration, after the controller confirms that agent's work is committed. `cosmos` gets no `kinds.<kind>` data for the new kinds, so a film that asks for one in `cosmos` gets the existing "not supported by look" error.
- **Patterns the look reviews rejected are forbidden up front.** Each is a test in `test/v2/helpers/bar.mjs` (Task 1) that every kind's task runs for its example and for a "full" fixture with every optional field set, in both looks and both formats:
  1. *No stretched fit-to-width stack.* Within one block of lines every line has one size; only an emphasised line may be larger. No text is scaled on one axis.
  2. *No empty lower half on a tall frame.* At 9:16, at the shot's last frame, the union of the kind's content boxes spans at least 70 percent of the safe height (the platform safe zone in `pop`, the grid margins in `desk`; with captions on, for a kind whose `showsWords` is false, the room above the caption zone, and the check runs both ways), and no band taller than 25 percent of it is empty between the top and bottom of that span. A kind reaches this by composing for the tall frame (a second panel, a larger map crop, a column instead of a row), never by spreading gaps.
  3. *No exemption from the 3x hero rule.* The rule as it stands at HEAD (`engine/review/frame.mjs`, `hierarchyRules`): texts are grouped into size clusters after lines of one stack are counted once, furniture is left out, texts with the role `affix` or `tag` are left out of the contrast rule, and the largest cluster must be `MIN_HERO_RATIO` (3) times the smallest only when there are at least `MIN_SIZES_TO_COMPARE` clusters; a frame set in one size passes. No text of a new kind sets `props.furniture`, and the roles `tag` and `affix` are used only for a real `tag` device and a numeral's unit, never for the author's sentences. Task 1 pins this rule with a test, because another fix owns that file. A kind whose content is many equal items (code lines, chat bubbles, node and edge labels, place labels) sets all of them at one size and tells them apart by face, weight and colour. A second, smaller text is added only where the larger is three times it.
  4. *Readable at phone size.* Every text that carries the author's words is at least the look's second scale step (44 units in `desk`, 56 in `pop`) at 9:16, and at least the first step at 16:9. Code is the one exception, with its own arithmetic (Task 8).
  5. *No silently dropped field.* For each schema field, the full fixture either yields a node whose `nodeField` is that field, or a finding at that field's path saying why the look or format does not draw it. A value that is clipped, truncated or ignored without a finding is a test failure.
  6. *Frame 0 is whole and the shot is not a still.* At the first frame no node is part-way through an entrance (opacity strictly between 0 and 1, or a scale or offset between its start and rest values), the frame is not empty, and something changes after frame 0 through a node's own track (`pop`'s camera is locked, `camera.drift: 0`, so a camera move does not count). Every reveal has landed at least 0.6 s before the shot ends.
- **Validation errors** keep the form `<json.path>: <message>` with did-you-mean on names, and say what to do. Limits are schema limits where they are fixed, and creative fit findings where they depend on the look and format.
- **Sounds:** arrivals are `device` events named in `eventDevices`, or the `land` event. No new event kind.
- **Browser runs are serialised:** one render or browser suite at a time on this machine, across all agents.
- **Commit and push authority** comes from the dispatch prompt of each task, not from this plan.

## Review Focus

1. The prepare seam: a film with a `map` or `code` shot expands identically in the page and in the Node test helper; a missing or stale prepared entry is a clear error naming the shot, never an empty frame; prepared data is deterministic (same film, same bytes) and bounded in size.
2. Honesty: a place outside the map's projection, a route to a place that is not there, a diff that hides a change, a scatter with a truncated axis, a race whose bars do not start at zero, a notification that reads as a real system dialog (the frame carries the look's styling, never a platform's).
3. Containment: every `src` stays inside the film's folder; `url` in a `screen` is display text and is never fetched; code and terminal text is drawn, never run.
4. Text that does not fit: a 90-character chat message, an 80-character code line at 9:16, eight places clustered in one country, a timeline of six long dates, a diagram of seven nodes on a tall frame. Each fits down to its floor or gives a creative finding that says what to cut.
5. Timing without narration (`hold` and no `say`), fewer sentences than items, an `on` event whose target the kind does not have, and each kind with captions and with sound on in a voiced film.
6. The six forbidden patterns above, in both looks and both formats, on the full fixture and not only on the example.
7. Parking: a parked kind still validates and renders, is left out of listings, and is reported.

## File Structure

- `engine/moves/index.mjs` (new): the move registry. `engine/looks/desk.mjs`, `pop.mjs`: the four new move entries, device styling, `kinds.<kind>` data and sound rows. `engine/looks/cosmos.mjs`: sound rows only. `engine/looks/index.mjs`: `validateLook` checks moves; the parked-kind helpers.
- `engine/devices/`: `label.mjs`, `focus.mjs`, `route.mjs`, `numeral.mjs`, `sticker.mjs`, `sweep.mjs`, `treatments.mjs`, registered in `index.mjs`. `engine/page/treat.mjs` (new): duotone and halftone pixels, cached.
- `engine/kinds/`: `media.mjs`, `screen.mjs` (+ `screen-frame.mjs`), `map.mjs` (+ `map-desk.mjs`, `map-pop.mjs`, `map-names.mjs`, `map-time.mjs`), `diagram.mjs` (+ `diagram-layout.mjs`), `timeline.mjs` (+ `timeline-desk.mjs`, `timeline-pop.mjs`), `code.mjs` (+ `code-diff.mjs`, `code-langs.mjs`, `code-desk.mjs`, `code-pop.mjs`), `feed.mjs` (+ `feed-desk.mjs`, `feed-pop.mjs`), `chart-scatter.mjs`, `chart-race.mjs`; registered in `index.mjs`. A kind splits into per-look files as `compare` does when it nears the size limits.
- `scripts/v2/prepare/index.mjs`, `map.mjs`, `code.mjs`, `atlases.mjs`, `code-theme.json` (new). `scripts/v2/server.mjs`, `session.mjs`, `run.mjs`, `report.mjs`, `list.mjs`, `cli.mjs`: prepared data in the film payload, `--list moves`, parked kinds.
- `engine/graph/film.mjs`, `engine/page/stage.mjs`, `test/v2/helpers/kinds.mjs`: `prepared` passed through to `ctx`.
- Tests: `test/v2/moves.test.mjs`, `prepare.test.mjs`, `kinds-parked.test.mjs`, `kinds-frozen.test.mjs` (+ `fixtures/kinds-frozen.json`), `helpers/bar.mjs`, `devices-b.test.mjs`, `treat-browser.test.mjs`, `kinds-<kind>.test.mjs` and `kinds-<kind>-browser.test.mjs` per kind, `kinds-chart-scatter.test.mjs`, `kinds-chart-race.test.mjs`; `purity.test.mjs` and `plugins/portable-artifacts/bin/test/dependency-pins.test.mjs` extended.
- `package.json`, `package-lock.json`; licence rows in `plugins/portable-artifacts/README.md` (the table near the `world-atlas` and `us-atlas` rows; there is no `THIRD_PARTY_NOTICES.md` at HEAD).
- Examples: `references/examples/v2/kinds-b-desk.json`, `kinds-b-pop.json`, with their pictures beside them.

## What each kind registers

Every kind also declares `summary`, `example`, `schema`, `validate` (with `kindSupportProblems`), `review`, `ids`, `heroTarget`, `expand`, and a `nodeField` that maps each node it makes to the field it shows (`null` for a text the kind computes, such as a tick or a prompt sign). `events` sends only the names in `eventDevices`.

| Kind | `srcFields` | `showsWords` | `numbered` | `eventDevices` | `targets` | `prepared` |
|---|---|---|---|---|---|---|
| `media` | `['src']` | true with a `caption`, else false | false | none | `picture`, `caption` | no |
| `screen` | `['src']` | false | false | `zoom` | `screen`, `region:<name>` | no |
| `map` | `[]` | false | false | `pin`, `link` | `map`, `place:<name>`, `link:<n>` | yes |
| `diagram` | `[]` | false | false | `node` | `node:<id>`, `edge:<n>` | no |
| `timeline` | `[]` | true | false | `event` | `event:<n>` | no |
| `code` | `[]` | false | false | `change`, `output` (and `land`) | `code`, `line:<n>` | yes |
| `feed` | `[]` | true | false | `message` | `item:<n>` | no |
| `chart` (`scatter`, `race`) | `[]` | false | false | none new (`land`) | as today | no |

A map's routes are a field named `routes` and are drawn with the `route` device, but their sound event is named `link`, so it does not share `sounds.device.route` with a route placed by an `on` event.

---

### Task 1: Foundations (moves, the prepare seam, parking, the bar)

**Files:** `engine/moves/index.mjs`, `engine/looks/index.mjs`, `desk.mjs`, `pop.mjs`, `cosmos.mjs` (move rows only, same rule as sound rows), `engine/graph/film.mjs`, `engine/page/stage.mjs`, `scripts/v2/prepare/index.mjs`, `server.mjs`, `list.mjs`, `cli.mjs`, `run.mjs`, `report.mjs`, the tests named below.

**Interfaces.**
- `registries.moves` (exists, empty at HEAD) gets `rise`, `wipe`, `slam`, `pop`, `draw`, `count`, `settle`, each `{ summary }`. A look's `moves` gains `rise`, `wipe`, `slam`, `pop`, `settle` beside the five it has; `validateLook` requires an entry for every registered move. `moveOf(look, name) -> Move` throws for an unknown name with did-you-mean. `--list moves` joins `LIST_NAMES` and prints each name, its summary and each listed look's values.
- `prepareFilm(film, { filmDir }) -> { prepared: Record<shotId, object>, problems: { path, message }[] }` in `scripts/v2/prepare/index.mjs`, Node only. A kind that needs it declares `prepared: true`; its preparer is looked up by kind name in a table in that file. Problems are reported with the validation errors, with full paths (`shots[3].places[1].at: ...`). The server adds `prepared` to the film payload the page fetches; `buildFilm({ ..., prepared })` and `shotContext` put the shot's entry on `ctx.prepared`. A kind with `prepared: true` and no entry throws `shot "<id>": kind "<kind>" needs prepared data and got none (scripts/v2/prepare)`.
- Parking (the kind equivalent of `look.experimental`, found in `engine/looks/index.mjs` and `scripts/v2/report.mjs`): `look.kinds.<kind>.experimental === true` parks that kind in that look. `isParkedKind(look, kind)`, `kindLooks(kind) -> string[]` (the listed looks that ship it, unflagged), `listedKinds() -> string[]`. `registries.kinds.names()` is not wrapped and stays complete (`scripts/v2/sound/cues.mjs` walks it and must see parked kinds); listings and hints (`scripts/v2/list.mjs`, the `show` error in `scripts/v2/spec.mjs`) use `listedKinds`. A kind reads look data when any registered look, experimental ones included, has a `kinds.<kind>` entry; `statement`, `number`, `clipping` and `free` have none and are always listed. A kind is listed by `--list kinds` when it reads no look data or `kindLooks` is not empty; `--list kinds --all` shows the rest marked `(experimental)`, and every kind entry gains `looks`. A film that uses a parked kind validates and renders, logs one line per kind (`make: kind "feed" is experimental in look "pop": it renders, but it is not one of the listed kinds and may change`) and carries `kinds: [{ name, look, experimental: true }]` in its JSON report; no finding, no change of exit code. `kindSupportProblems` and the `show` error name only unparked kinds and looks. A chart type is parked the same way with `look.kinds.chart.experimentalTypes: string[]`. A device that fails is declined by the look (its `look.devices.<name>` entry is removed), which is the existing mechanism.

- [ ] **Step 1: Freeze the approved frames.** Before any other change, and after the controller confirms the other agent's edits to `engine/kinds` are committed: write `test/v2/kinds-frozen.test.mjs`, which expands every existing kind's `example` in `desk` and `pop` at 16:9 and 9:16, and every shot of the approved films (`references/examples/v2/gate-desk.json`, `gate-pop.json`, `kinds-desk.json`, `kinds-pop.json`, with estimated word times), through `test/v2/helpers/kinds.mjs` and compares a stable JSON of the nodes, tracks and camera with `fixtures/kinds-frozen.json`. Generate the fixture once from that commit; it is never regenerated in this plan (a later intended visual change regenerates it in a commit that says so). The same file pins the hero rule: a frame of one size gives no `hero` finding, two sizes at 2.9 times give one, and a text marked `tag` is left out. Prove the guard: change one number in `desk.moves.enter`, see the named test fail, restore, confirm an empty diff. Commit this alone.
- [ ] **Step 2: Failing tests.** `moves.test.mjs`: the seven names are registered; a look missing one fails `validateLook` naming the look and the move; `moveOf` did-you-mean; `--list moves` prints seven entries and `--list movs` exits 2 listing the accepted names. `prepare.test.mjs`: a film with no `prepared` kind gives `{}`; a fake preparer's output reaches `ctx.prepared` through `buildFilm`; a `prepared: true` kind with no entry throws the message above; the same film prepares to byte-identical JSON twice; a preparer's problem comes back with its full path. `kinds-parked.test.mjs` (with a throwaway kind and look registered in the test): flagged in one look, the kind is still listed with `looks` naming the other; flagged in every listed look, it leaves `--list kinds`, appears under `--all` marked experimental, and a film using it exits 0 with the one stderr line and the report entry; the unknown-kind hint does not offer it. `purity.test.mjs`: no file under `engine/` has a bare-specifier import, and no file under `engine/` or `scripts/v2/` imports from `template/` or `scripts/lib/` beyond the imports present at HEAD (an allow-list written into the test, which may only shrink); proof by feeding each rule one bad line.
- [ ] **Step 3: `test/v2/helpers/bar.mjs`.** `assertBar(kind, fixture, { look, format })` runs the six forbidden-pattern checks of Global Constraints on an expansion. Each check is proven by a fixture expansion that breaks it (six small hand-built node lists), reported as mutation rows.
- [ ] **Step 4 to 6:** run red, implement, run green; `kinds-frozen` still green; the whole `test/v2` suite green.

**Move values (starting points, tuned on the sheets):** `desk`: `rise` = today's `enter`; `wipe` a mask reveal, linear, 0.4 s; `slam` none of its own (`dur: 0`: a hard arrival, desk does not slam); `pop` = `rise`; `settle` outCubic 0.6 s. `pop`: `pop` = today's `enter`; `rise` outExpo 0.2 s, 40 units; `wipe` outExpo 0.18 s; `slam` spring, scale from 1.6, 0.16 s; `settle` spring 0.3 s.

### Task 2: Devices `label`, `focus`, `route`, `numeral`, `sticker`, `sweep`

**Files:** `engine/devices/*.mjs`, `index.mjs`, `desk.mjs`, `pop.mjs`, `cosmos.mjs` (sound rows), `scripts/v2/spec.mjs` only if the `on` check needs the `on: false` rule, `test/v2/devices-b.test.mjs`.

**Interfaces.** Each is `{ name, summary, supports(look), build(params) }` as today, `supports` being `styledBy(name)`.
- `label`: `build({ id, box, at, look, unit, seed, measure, text, anchor: [x, y], side? })` gives a text and a leader line from the text's nearest edge to `anchor`, drawn with the look's `draw` move; `side` is chosen away from `anchor` when absent. Text at one size given by the caller.
- `focus`: `build({ id, box, at, look, unit, cover })` gives a scrim over `cover` with `box` left clear, built on `paperScrim` (`engine/kinds/shared.mjs`), so `compare`'s dim and the clipping's region scrim keep their own code and gain nothing.
- `route`: `build({ id, at, look, unit, seed, points: [x, y][], pins?: boolean })` gives a path that draws on through `points` (smoothed), with pins at its ends when the look's styling says so (`desk`: pins and a thread; `pop`: a thick line with an arrow head that jabs).
- `numeral`: `build({ id, box, at, look, unit, measure, text, unitText? })` gives one figure fitted to `box` with fixed digit advances (`numeralLayout`), the unit smaller on the cap height.
- `sticker`: `build({ id, box, at, look, unit, seed, children })` wraps `children` in an outlined cut shape with a seeded rotation inside the look's range. `pop` only: `desk` has no styling for it and an `on` event asking for it there gets the existing "look does not support device" error.
- `sweep`: `build({ id, box, at, look, unit })` gives a band of light crossing `box` once, a gradient path with `screen` blend clipped to `box`, no blur filter. `pop` styles it; `desk` declines it (paper has no light).
- `numeral` and `sticker` are layout devices, not marks on a target: they declare `on: false`, and an `on` event naming one is `shots[i].on[j].do: "<name>" is built by shot kinds, not placed by an on event; the devices an on event can place: <list>`.

- [ ] **Step 1: Failing tests.** For each device: `supports` per look; hand-computed geometry for one input (the leader's end is on `anchor`; the focus hole equals `box`; the route passes through every point in order and its drawn length rises from 0 to 1 landing at `at`; a numeral's digits have equal advances and "8" and "1" give the same width; a sticker's rotation is the same for the same seed and differs for another; the sweep stays inside `box` at five sampled times). `label` chooses the side with room and never leaves the canvas. Every listed look and `cosmos` names a sound for each. `--list devices` shows the nine devices registered at HEAD and these six (the two treatments of Task 3 make seventeen). The `on: false` error.
- [ ] **Step 2 to 4:** run red, implement, run green. Render one `free`-kind sheet per look showing each device and view it.

### Task 3: Photo treatments and `media`

**Files:** `engine/devices/treatments.mjs`, `engine/page/treat.mjs`, `engine/page/draw.mjs` (one branch for a treated image), `engine/kinds/media.mjs`, look data, tests `devices-b.test.mjs`, `treat-browser.test.mjs`, `kinds-media.test.mjs`, `kinds-media-browser.test.mjs`.

**Treatments.** An image node may carry `props.treatment: { type: 'duotone' | 'halftone', dark, light, cell? }` with colours resolved from the look's palette when the kind builds the node (so a film's `accent` override reaches them through the accented look). `engine/page/treat.mjs` computes the treated bitmap once per picture, treatment and drawn size by pixel arithmetic on `ImageData` (duotone: luminance mapped between `dark` and `light` in OKLab, `engine/color/oklab.mjs`; halftone: one dot per `cell`, its radius from the cell's mean luminance, on `light`) and caches it; no canvas `filter`, nothing recomputed per frame. `duotone` and `halftone` are registered devices with `on: false`, so `--list devices` shows them.

**`media` fields:** `src` (required; a still inside the film's folder), `fit` (`bleed` | `cutout`, default `bleed`), `treatment` (`none` | `duotone` | `halftone`, default the look's `kinds.media.treatment`), `focus` (`[x, y]` fractions, default `[0.5, 0.5]`: the point a crop keeps), `caption` (at most 60 characters), `credit` (at most 40).

**Validation.** `src: a clip is not supported yet; give a still (png, jpg, jpeg, webp, gif)` for a video extension (the design's "photo or clip" is half built: see Decisions); `focus[0]: must be from 0 to 1`; `treatment: the pop look has no "..."` with the ones it has.

**Composition.** `bleed`: the picture covers the frame, cropped around `focus`, under the look's field texture; desk in duotone of ink and paper with the caption on a taped card low on the left grid columns; pop in halftone of ink and the field colour with the caption as a stack on an ink plate inside the safe zone. `cutout`: the picture as an object with the look's keyline and contact shadow (the existing `cutout` device, a rectangle: silhouette cut-outs with alpha are not in this plan), off-centre, with the caption as the hero beside it (16:9) or under it (9:16) so the tall frame is used. The caption's words arrive with the narration. The picture itself always moves on its own track, a slow push from `look.kinds.media.push` (a scale a little above 1 easing to 1 over the shot, with the `settle` move), so a shot with no caption is not a still in `pop`, whose camera is locked. The credit is small and sits on the picture's edge; where the caption is not three times it, the credit is not drawn and a finding says so.

- [ ] **Step 1: Failing tests.** Treatment arithmetic on a 4 by 4 fixture (hand-computed pixels for duotone; dot radii for halftone); the cache returns the same bitmap object for the same key; an accent override changes the treated colours. `media`: fields validate (each message above); cover crop keeps `focus` inside the frame for a wide and a tall picture at both formats (hand-computed crop rectangles); text over the picture passes the rendered-pixel contrast check; `assertBar` in both looks and formats for the example and the full fixture.
- [ ] **Step 2: Browser tests** for the treated bitmap (pixel samples) and held frames (a still `bleed` shot with no caption still changes between frames).
- [ ] **Step 3 to 4:** implement, run green. Render and view the eight sheets (two fits, two looks, two formats).

### Task 4: `screen`

**Files:** `engine/kinds/screen.mjs`, `screen-frame.mjs`, look data, `test/v2/kinds-screen.test.mjs`, browser sweep.

**Fields:** `src` (required), `frame` (`browser` | `phone` | `window` | `none`; default `browser` for a picture wider than tall, `phone` otherwise), `title` (at most 40 characters: the tab or window title), `url` (at most 48: shown in the address pill, never fetched or validated as reachable), `regions` (as `clipping`: name to `[x, y, w, h]` fractions), `zoom` (a region name the camera goes to with no mark). `on` events target `region:<name>` with `circle`, `underline`, `arrow`, `focus` or `sweep`.

**How it differs from `clipping`.** A clipping is a piece of paper on the desk, tilted and torn. A screen is upright in a device frame drawn from paths (chrome sizes copied from version 1's `browser-window.mjs`: title row 72, address row 88, corner radius 20, in units), styled by the look (desk: a white card with an ink hairline and the contact shadow; pop: an ink frame with a thick outline and the offset accent shadow). It reuses the region arithmetic and the push or cut to a close-up (`clipping-rules.mjs`, `close-ups.mjs`, `region-mark.mjs`) and does not copy them.

**Timing.** The framed screen is whole on frame 0. The zoom lands on the first `on` event that targets a region, or on the second sentence for `zoom` (the narration's midpoint with one sentence). The arrival at the region is a `device` event named `zoom`.

**Tall frames.** A phone screenshot fills the safe height. A wide screenshot at 9:16 is two panels: the whole screen across the top, and under it the region enlarged as a second framed crop that arrives with the zoom, joined by a `route` line from the region to the crop. With no region and no `zoom`, a wide screenshot at 9:16 is a creative finding at `regions` ("name a region to enlarge: a wide screen on a tall frame leaves half of it empty").

**A screen with nothing to point at.** With no `zoom` and no `on` event, at any format, nothing arrives after frame 0, so the kind gives a creative finding at `zoom` ("name a region to go to, or mark one with an on event: a screen that only sits there is a still"). The kind's `example` has a region and a `zoom`.

- [ ] **Step 1: Failing tests.** Default frame by aspect; chrome geometry for one hand-computed case per frame type; `url` appears as text and no code path requests it (the server's request log in the browser test holds only the film's own routes); region boxes match `clipping`'s for the same picture and region; zoom timing in the three cases; `zoom` naming no region is `zoom: no region "qeury"; did you mean "query"? (regions: query, total)`; the two-panel layout and its finding; `assertBar` everywhere.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 5: Map dependencies and `map`

**Files:** `package.json`, `package-lock.json`, `plugins/portable-artifacts/README.md`, `plugins/portable-artifacts/bin/test/dependency-pins.test.mjs`, `scripts/v2/prepare/atlases.mjs`, `prepare/map.mjs`, `engine/kinds/map*.mjs`, look data, `test/v2/kinds-map.test.mjs`, `prepare.test.mjs`.

**Dependencies (the step that may need the network; the controller runs it or authorises it in the dispatch).** `npm --prefix <abs M> install d3-geo@3.1.1 topojson-client@3.1.0 --save-exact --package-lock-only --ignore-scripts` (try `--offline` first: both tarballs are already in the lock), then `npm --prefix <abs M> ci --ignore-scripts`. Compare the lockfile's `name@version` set before and after: it must be equal (a promotion adds no package). If the cut-over has already removed Vega, the set may grow, and then only by `d3-geo`, `topojson-client` and what they depend on; any other difference, or any changed version, is a stop. `world-atlas` and `us-atlas` are already direct pins and stay; this plan depends on them and on `shiki` staying installed (see Decisions).

- [ ] **Step 1: Failing dependency tests** in `dependency-pins.test.mjs`: make-motion's manifest names `d3-geo`, `topojson-client`, `world-atlas` and `us-atlas` as direct dependencies with exact versions; the lockfile holds each with an integrity hash; the README licence table has a row for `d3-geo` and `topojson-client` and for each package they bring in, with the licence the lockfile states (read it from the lockfile: at HEAD `d3-geo`, `d3-array`, `internmap` and `topojson-client` say ISC). Guardrail proof: a manifest fixture with `"d3-geo": "^3.1.1"` fails `rangeViolations`. Then run the install step and make them pass.

**Fields:** `region` (`world` | `us`, required), `places` (0 to 8 of `{ name` (at most 24 characters)`, at: [lon, lat] }`), `routes` (0 to 6 of `{ from, to, label? }`, naming places), `highlight` (0 to 12 country or state names from the atlas), `title` (at most 60), `source` (at most 60), `view` (`whole` | `places`; default `whole` at 16:9 and `places` at 9:16). At least one of `places` and `highlight`.

**Validation.** `places[1].at: longitude must be from -180 to 180 and latitude from -90 to 90, got [200, 10]`; `places[2].at: [2.35, 48.86] is outside the US map; use "region": "world"` (from the preparer, when the projection returns nothing); `highlight[0]: no country "Brasil" in the world map; did you mean "Brazil"?`; `routes[0].to: no place "Lagos"; the places are: Paris, Nairobi`; a route from a place to itself; duplicate place names.

**Prepare.** `prepare/atlases.mjs` reads `world-atlas/countries-110m.json` or `us-atlas/states-10m.json` from `node_modules` (the other two atlas files are not used), once per process. `prepare/map.mjs` projects with `geoEqualEarth` (world) or `geoAlbersUsa` (US), both exported by `d3-geo` itself, fitted to a box 1000 wide, and returns `{ aspect, land, borders, highlights: [{ name, d }], places: [{ name, x, y }], routes: [{ from, to, d }], extent }`: path strings rounded to one decimal, routes as great-circle arcs on the world and straight lines on the US, `extent` the padded box around the places and highlights. Bounded: the returned JSON for the world is under 300 KB (a test measures it).

**Timing.** The land is whole on frame 0. A highlight fills, and a place's pin and label land, on the word that names it (a case-insensitive match of its name in `say`), else one per sentence, else evenly; a route draws once both its ends are on. Events: `pin` and `link` (a route drawn). `on` targets `place:<name>`, `link:<n>`, `map`.

**Composition.** desk: a printed map sheet on the desk (the `card` device), land in paper white with ink hairline borders, highlights under the highlighter (multiply), pins and a red thread (`route`), place names with the `label` device in the text face, the title as a serif heading on the left columns with the source line under the sheet. pop: land in ink on the field, highlights in the accent, places as `sticker` tags, routes as thick lines that jab, the title as a tag. Labels are one size; where they would overlap they are spread (`chart-labels.mjs` `spread`) and, failing that, a creative finding names the places to drop. At 9:16 the map shows `extent` (never thinner than 3:4) and the places are listed under it as a column of names arriving in step with their pins, so the frame is used.

- [ ] **Step 2: Failing tests.** Prepared output for a three-place fixture (Paris, Nairobi and Tokyo land at hand-checked positions to within 1 unit; byte-identical on a second run; size bound); each validation message; timing in the three cases; a route never draws before its ends; label spreading and its finding with eight places in one country; `view` defaults by format; the name lists in `map-names.mjs` equal the atlas files' names (so a version bump fails here); `assertBar` everywhere.
- [ ] **Step 3 to 5:** run red, implement, run green. Render and view world and US in both looks and formats.

### Task 6: `diagram`

**Files:** `engine/kinds/diagram.mjs`, `diagram-layout.mjs`, look data, `test/v2/kinds-diagram.test.mjs`.

**Fields:** `nodes` (2 to 7 of `{ id` (the `HERO_SCHEMA` pattern)`, label` (at most 24 characters)`}`), `edges` (0 to 8 of `{ from, to, label? }`, label at most 16), `layout` (`row` | `column` | `cycle` | `hub`; default `row` at 16:9 and `column` at 9:16), `title` (at most 60), `highlight` (a node id). There is no general graph layout: four designed arrangements (`hub` puts the first node in the middle). A diagram that needs more is make-diagram's.

**Validation.** `edges[2].to: no node "cahce"; did you mean "cache"? (nodes: client, cache, db)`; `edges[1]: an edge from a node to itself`; `nodes[3].id: "db" is already the id of nodes[1]`; `layout: a cycle needs at least 3 nodes`.

**Timing.** The first node is whole on frame 0. A node arrives on the word that names its label, else one per sentence, else evenly; an edge draws on (the `draw` move) once both ends are on, its label landing with the arrow head. Events: `node`. `on` targets `node:<id>`, `edge:<n>`.

**Composition.** Node and edge labels are one size, fitted for the longest label (nodes in the display face in ink, edge labels in the text face in ink2). desk: nodes as small paper cards, hand-drawn arrows that step on twos, the node being spoken in full ink and the rest under `focus` once `highlight` or an `on` asks. pop: nodes as stickers, arrows that jab, the current node in the accent. At 9:16 the default is a column filling the safe height, with edge labels beside their arrows.

- [ ] **Step 1: Failing tests.** `diagram-layout`: hand-computed centres for each layout with 3 and 7 nodes at both formats; no two node boxes overlap and every arrow starts and ends on a box edge, never inside one; an edge label never crosses a node; the validation messages; timing; a 24-character label on seven nodes fits or gives the fit finding naming `nodes[i].label`; `assertBar` everywhere.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 7: `timeline`

**Files:** `engine/kinds/timeline.mjs`, `timeline-desk.mjs`, `timeline-pop.mjs`, look data, `test/v2/kinds-timeline.test.mjs`.

**Fields:** `events` (2 to 6 of `{ when` (at most 14 characters, shown as written)`, what` (at most 60)`}`), `title` (at most 60), `highlight` (an event's 1-based number). Events are drawn in the order given and evenly spaced: the line shows sequence, not scale, and the kind says so in its summary (a line to scale would need parsed dates, which this plan does not add).

**Timing.** As `list`: one event per sentence when the counts match, else spread evenly; with `hold`, equal intervals. The line draws to each event as it arrives. Events: `event`. `on` targets `event:<n>`.

**Composition.** desk 16:9: a ruled line across the grid with a tick per event, `when` above and `what` below, the current event in ink with `when` as its hero and earlier ones in ink2. desk 9:16: the line runs down the left grid column and the events are stacked beside it over the safe height. pop: one event at a time, `when` as a `numeral` and `what` as a stack under it, with a progress rail of dots along the safe zone's edge (the current dot in the accent) so the place in the sequence is always shown. `when` holds three times `what`; where six events cannot hold that at 16:9, the fit finding says "cut an event or shorten events[i].when".

- [ ] **Step 1: Failing tests.** Timing in the three cases; hand-computed tick positions for four events at both formats; desk dims earlier events; pop shows one event and the rail; the 3x relation of `when` to `what` on every frame sampled; the fit finding; a single-character `when` and a 14-character one; `assertBar` everywhere.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 8: `code`

**Files:** `scripts/v2/prepare/code.mjs`, `code-theme.json`, `engine/kinds/code*.mjs`, look data, `engine/page/fonts-shared.mjs` (`facesFor` loads the face `look.kinds.code.font` names when a film has a `code` shot: JetBrains Mono 400 is in its table for `desk` and is not one of `pop`'s three faces), `plugins/portable-artifacts/bin/test/dependency-pins.test.mjs`, `test/v2/kinds-code.test.mjs`, `prepare.test.mjs`, `kinds-code-browser.test.mjs`.

**Dependency.** `shiki` 4.5.0 is already a direct exact pin and nothing is installed. One test is added to `dependency-pins.test.mjs`: the manifest names `shiki` with an exact version and the README licence table keeps its rows (if the cut-over removed the package first, this task adds it back at 4.5.0 with the lock-set check of Task 5).

**Fields:** `mode` (`type` | `diff` | `run`, default `type`), `lang` (one of the languages copied from version 1's `CODE_LANGS`, aliases accepted, default `text`), `code` (`type`), `before` and `after` (`diff`), `command` (one line, at most 60 characters) and `output` (at most 10 lines) (`run`), `title` (a file name, at most 40), `highlight` (at most 3 line numbers or `[from, to]` ranges of the shown code). A field of another mode is an error naming the mode it belongs to.

**Limits, from the reading floor.** Code is one size in the look's mono (`look.kinds.code.font`, the mono `desk` already loads; its advance is 0.6 em, checked by a browser test). Characters a line holds at the look's smallest step = floor(inner width / (0.6 x size)); lines = floor(inner height / (1.4 x size)).

| Look, format | Inner width (units) | Smallest step | Characters | At the second step |
|---|---|---|---|---|
| desk 16:9 | 1920 - 2 x 96 - 2 x 48 = 1632 | 30 | 90 | 61 at 44 |
| desk 9:16 | 1080 - 2 x 96 - 2 x 48 = 792 | 30 | 44 | 30 at 44 |
| pop 16:9 | 1920 - 2 x 72 - 2 x 32 = 1712 | 36 | 79 | 50 at 56 |
| pop 9:16 | safe width 765 - 2 x 32 = 701 | 36 | 32 | 20 at 56 |

Schema limits: at most 12 lines and 80 characters a line (16:9 desk holds floor(800 / (1.4 x 44)) = 12 lines under a title row). The per-format limit is a creative finding from the same formula, at the field: `code: line 3 is 58 characters; at 9:16 in this look a line holds 44: break it or cut it`. The type size is the largest step at which every line fits, so short code is set large; on a tall frame a block that spans under 70 percent of the safe height (the bar's own number) gives the finding "shorten the lines so the type can grow, or add the lines that matter". The kind's `example` has no line over 32 characters, so it reviews clean in all four cases.

**Prepare.** `prepare/code.mjs` tokenises with shiki's fine-grained core and JavaScript regex engine (no wasm), loading only the grammars in the language list, against `code-theme.json`, a theme whose colours are role markers; it returns `{ lines: [[{ text, role }]] }` per code string, roles `plain`, `keyword`, `string`, `number`, `comment`, `name`, `punct`. The look maps roles to palette keys (`look.kinds.code.roles`); no shiki theme colour reaches the frame. Tabs become two spaces. Nothing is executed: `run` draws the `command` and `output` the author wrote.

**Timing.** `type`: the panel, the title and the first line are on frame 0; the rest types on by token over the narration and has landed by its end (the `land` event); a highlighted line is marked on the word an `on` event anchors (`line:<n>`), else on the last sentence. `diff` (`code-diff.mjs`, a line LCS): `before` is whole on frame 0; on the second sentence removed lines tint and close and added lines open (event `change`). `run`: the prompt and the command type over the first sentence; output lines arrive in order over the rest (event `output` once, on the first line).

**Composition.** desk: a printout on a paper card, mono ink, the highlighter over highlighted lines, the title in the same size on the card's top rule. pop: an ink panel with a thick outline and the offset accent shadow, roles in white, the accent and the second accent, the title as the panel's first line. No second text size on the frame.

- [ ] **Step 1: Failing tests.** Tokens for a three-line JavaScript fixture (hand-written expected roles); an alias resolves; `lang: "pyhton"` did-you-mean; byte-identical on a second run; a field of the wrong mode; `code-diff` on five fixtures (all added, all removed, a change in the middle, identical, a moved line shown as a removal and an addition); the table above as assertions (the four character counts computed from the look data, not typed in); both findings; typing has landed by the narration's end; `assertBar` everywhere.
- [ ] **Step 2: Browser tests.** The mono's advance is 0.6 em within 1 percent in a `desk` film and in a `pop` film (so the face is loaded in both); a 12-line block at each look and format stays inside its panel.
- [ ] **Step 3 to 4:** implement, run green. Render and view the three modes in both looks and formats.

### Task 9: `feed`

**Files:** `engine/kinds/feed.mjs`, `feed-desk.mjs`, `feed-pop.mjs`, look data, `test/v2/kinds-feed.test.mjs`.

**Fields:** `style` (`chat` | `notifications`, default `chat`), `items` (2 to 6; chat: `{ from: 'me' | 'them', text }`; notifications: `{ app` (at most 20 characters)`, text }`), `title` (the thread's or the screen's name, at most 30). No pictures in items: `srcFields` reads a field or a dotted path, not a path into an array, and an avatar is not worth extending it. A sender is told by side and colour; an app by a coloured disc with its initial.

**Limit on `text`: 90 characters.** pop 9:16: safe width 765, a bubble at most 82 percent of it (627) less 2 x 28 padding = 571 units of text; at the second step (56) in the condensed face, about 0.45 em a character = 25 units, so 22 characters a line, four lines = 88. desk 9:16: 888 x 0.82 - 56 = 672 at 44 in the grotesque (about 0.5 em = 22 units) = 30 characters a line, three lines = 90. The implementer replaces the two advance estimates with measured ones in a browser test and keeps the limit at the smaller result rounded down to ten.

**Timing.** The first item is whole on frame 0. Then one item per sentence, else evenly; in chat a `them` message is led by typing dots for 0.4 s (never on frame 0). Events: `message`. `on` targets `item:<n>`.

**Composition.** All bubble text is one size. desk: paper slips, `me` on the right in the highlighter tint, `them` on the left in white, stacking down a column on the grid (two columns of the thread never; one thread). pop: thick-outlined bubbles in ink and accent that `pop` in; when the thread passes the safe height the oldest slide up and off. On a tall frame the bubble size is chosen so the finished thread spans at least 70 percent of the safe height. Notifications are cards with the app's disc and name at the text size in bold, the newest on top. The frames are the look's own: nothing imitates a named platform's interface.

- [ ] **Step 1: Failing tests.** Timing in the three cases and the dots' window; sides and colours by `from`; a 90-character message fits in both looks and formats and a 91-character one is a schema error at `items[i].text`; scroll-off keeps the newest whole and inside the safe zone; notifications order; `assertBar` everywhere.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view both styles.

### Task 10: Chart types `scatter` and `race`

**Files:** `engine/kinds/chart.mjs` (types, schema branches, honesty), `chart-scatter.mjs`, `chart-race.mjs`, look data, `test/v2/kinds-chart-scatter.test.mjs`, `kinds-chart-race.test.mjs`, the chart browser test.

**`scatter`.** `data`: 3 to 40 of `{ x, y, label? }` (both numbers; at most 6 labelled), `xLabel` and `yLabel` (at most 24 characters each, required: two axes need names), `highlight` (a label). Both axes come from `chart-scale.mjs` and fit the data; honesty findings: a non-finite value; fewer than 3 points ("a scatter of two points is a line"); `highlight` naming an unlabelled point. Points arrive together over the first sentence (not one cue per point); the highlighted point turns accent with its `label` device on its word; the `land` event is that. Labels use `spread`.

**`race`.** `data`: `{ periods: string[]` (2 to 12, each at most 12 characters)`, rows: [{ name, values: number[] }] }` (2 to 8 rows, `values` as long as `periods`), `top` (2 to 6, default the smaller of 6 and the row count), `highlight` (a row name). Honesty: bars start at zero (no `baseline`); a negative value, a non-finite value or a `values` of the wrong length is a mechanical finding at its path. The periods are spread over the narration; bars grow and change rank with the `settle` move (ranking copied from version 1's `rankByPeriod`); the period is a `numeral` (pop) or a mono label in the plot's corner (desk); values count with fixed advances. `land` is the last period's arrival.

- [ ] **Step 1: Failing tests.** Schema branches (a `race` with `[{ label, value }]` data gets "a race chart reads its data as { periods, rows }"); each honesty finding; scatter geometry for five hand-placed points; rank order and bar lengths for a 3-period, 4-row fixture at each period and halfway between two; ties keep the given order; `top` hides the rest without a finding only when the film's `highlight` is among the shown rows at the end, else a finding; `kinds-frozen` unchanged for the five existing types; `assertBar` everywhere.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 11: Two films and the look gate

**Files:** `references/examples/v2/kinds-b-desk.json`, `kinds-b-pop.json`, a screenshot and a photo beside them, `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`, `docs/decisions-pending.md`.

- [ ] **Step 1: The controller writes** one film per look (`desk`: pro, 16:9; `pop`: viral, 9:16), each one small true story that uses all seven new kinds, a `scatter` and a `race`, opened by a `statement` and closed by an `end`, voiced, with sound on. The copy claims only what the frames show (the first wave's films said "nine kinds" over eight). The screenshot is of one of this plugin's own pages; the photo is the repository's own example picture; no outside image.
- [ ] **Step 2: Render** both through `make.mjs` (one at a time); no mechanical and no creative finding; the controller views every sheet, including the phone-width sheets, and renders each film once more in the other format to see every kind at 16:9 and 9:16 in both looks.
- [ ] **Step 3: Independent look review.** A fresh reviewer who has not seen the design, sheets only, the look gate's brief, with the finding-stage sentence of `rules/ecc/common/code-review.md` verbatim and "report only". The reviewer gives, per kind and per look, pass, fix or fail, and is asked by name about the six forbidden patterns.
- [ ] **Step 4: At most two revision rounds**, each followed by a new fresh reviewer. After the third review: a kind that still fails in a look is parked there (`look.kinds.<kind>.experimental: true`), a chart type likewise (`experimentalTypes`), a device is declined by that look; each with its test in `kinds-parked.test.mjs` updated in the same commit. A kind parked in both looks leaves `--list kinds`. Nothing is deleted. "Fix" items left over are not parking: they go to `docs/decisions-pending.md` with a default.
- [ ] **Step 5: Record.** A section in the gate report (the table of the three reviews per look, the decision, what a viewer will still see) and the open items in `docs/decisions-pending.md`. Every count in it says how it was measured.

## Decisions for the controller (each has a default the plan proceeds on)

1. **`media` clips.** Version 2 has no video node in `engine/page/draw.mjs`, no video extension on the server and no frame-exact seek. Default: stills only, a clip refused with the message in Task 3; clips get their own plan. Alternative: add deterministic video frames here (a new engine feature, larger than any kind in this plan).
2. **Parking granularity.** Default: per kind and look, in look data, as Task 1 specifies (one mechanism, no branch on a look's name, nothing deleted). Alternative: a kind-level `experimental` flag mirroring `look.experimental` exactly (simpler listing, but a kind good in `desk` and failing in `pop` is then parked in both).
3. **`shiki` and the atlases against the cut-over plan.** Its decision 2 removes all three and has these kinds add them back. Default: they stay installed, and the cut-over's README edit keeps the `shiki`, `world-atlas` and `us-atlas` licence rows; if the cut-over runs first, Task 5 and Task 8 add the packages and rows back at 4.5.0, 3.0.1 and 2.0.2 with the same lock-set check.
4. **The network step of Task 5.** Default: the controller runs it (the implementers have no network), `--offline` first.
5. **`cosmos` rows.** Default: this plan adds only `null` sound and move rows to `engine/looks/cosmos.mjs`, after the other agent's work is committed; the parked look gets none of the new kinds.
6. **`sweep` in `desk`.** Default: declined (pop only), as `sticker` is by design. Alternative: a desk sweep as a strip of light across a screen card.
7. **Timeline to scale.** Default: evenly spaced, in the order given. Alternative: parsed dates and a proportional line.

## Not in this plan

Video clips and silhouette cut-outs with alpha; `on` events that name a move (kinds use the move registry; `on` keeps placing devices); general graph layout; the `50m` and county atlases; the four unstarted looks and any `cosmos` composition for these kinds; the first wave's open fix items (`docs/decisions-pending.md`); the cut-over; SKILL.md and `references/` prose for the new kinds (the cut-over's rewrite owns them, fed by `--list`).
