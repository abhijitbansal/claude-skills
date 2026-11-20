# make-motion 2: Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every version 1 transition exists as a version 2 cut with validated options (direction, duration, smear), about ten shader cuts are ported from gl-transitions with their licences, slide and punch carry a motion blur that reads as blur, each look holds its cut set, option defaults and cue per cut as data, and two films that use every cut pass the film's own review and an independent look review.

**Architecture:** A cut today is a pure function from two sampled node lists to one (`engine/cuts/index.mjs`), and the post pass takes one picture (`engine/page/post.mjs`). That is enough for cuts that move nodes, and not for a wipe, an iris, a blur or a shader, which need the outgoing and the incoming shot as two pictures. So a cut belongs to one of three families, named on its registry entry. A **node** cut returns nodes, as now (`cut`, `slide`, `punch`, `match`, and the new `cover`). A **layer** cut returns a pure recipe (opacity, clip, scale, blur and order of the two pictures) that the page composes in canvas 2D before the post pass, so it is the same picture with or without WebGL (`crossfade`, `fade`, `wipe`, `iris`, `zoom`, `blur`). A **shader** cut names a fragment shader on the gl-transitions contract and a layer cut that stands in for it; the post pass runs it over the two pictures in WebGL2, and without WebGL2 the stand-in is drawn and the report says so. One normaliser, `resolveCut`, turns a shot's `cut` (a name or an object) and the look's defaults into the cut every reader uses. Motion blur is the true mean of sub-frame pictures of the moving nodes only, accumulated in the page.

**Tech Stack:** The version 2 engine as it stands (scene graph, canvas 2D draw, WebGL2 post pass, review, sound). `node:test`, Playwright Chromium for the browser tests. No new npm dependency. Shader sources are vendored text files.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, sections 8.4 (post pass, shader cuts, motion blur), 8.5 (cut strips), 9.4 (cues from events), 11 (dependencies), 16 (determinism). Owner decision: "All of them, smear on". The smear's history: `docs/decisions-pending.md`, "Motion smear on slide and punch cuts".

Abbreviations: `P` = `plugins/portable-artifacts`, `M` = `P/skills/make-motion`. Paths without a prefix are relative to `M/`. Read at commit `c8c1d659` with `git show`; nothing was run. Another agent was editing `engine/kinds` and `engine/looks` at the time.

## Decisions for the controller

Each has a default this plan is written to. Change it before dispatching the task named.

| # | Question | What was found | Default | Alternative | Task |
|---|---|---|---|---|---|
| 1 | Names where the two versions disagree | Version 2 `slide` moves both shots (`cuts/index.mjs` `slide()`), which is version 1 `push`. Version 1 `slide` moves only the incoming scene over a still one | `slide` keeps its version 2 picture and gains `direction`; version 1 `push` maps to `slide`; version 1 `slide` ships as `cover`. No aliases. The gate films' frames do not change | Rename to the version 1 meanings (`push` both, `slide` incoming only) and re-run the look gate for `desk` and `pop` | 1 |
| 2 | Per-look cut set against "every cut in both looks" | `look.cuts` is the validator's allow-list today (`desk`: cut, match, slide; `pop`: cut, punch, slide; `cosmos`: cut, match). The last task needs every cut in both looks | `look.cuts` lists every registered cut in all three looks. A new `look.cutPalette` is the look's default set: what `--list cuts` shows first and what the director reaches for. Using a cut outside the palette is not a finding | Keep `look.cuts` narrow and equal to the palette; the last task's films then use each look's palette only, and some cuts are never seen in one look | 2, 9 |
| 3 | Smear on by default, after two failed builds | `docs/decisions-pending.md`: "Two builds read as echoes, not blur". `look.smear` is absent in all three looks. The current build draws 12 whole-frame copies over half a frame of travel; at a slide's fastest frame the copies are about 20 px apart at 1920 wide (computed from `SLIDE`, `SMEAR` and the inOutCubic slope, not rendered) | Rebuild it (Task 6), on in `desk` and `pop` for `slide`, `punch` and `cover`, off in `cosmos`, with a strip review of its own. If it fails that review after two revision rounds, it ships off in that look, the option stays, and the owner is told with the strips | Flip `look.smear` on the current code | 6 |
| 4 | Which shaders, and who fetches them | The repository's `LICENSE` is MIT ("Copyright (c) 2017-present gl-transitions contributors") and says a file's own header may name another licence. File names were read from the repository listing; no file body or header was read | Candidates: `InvertedPageCurl`, `DirectionalWarp`, `CrossWarp`, `CrossZoom`, `Wind`, `WindowSlices`, `PolkaDotsCurtain`, `GlitchMemories`, `Pixelize`, `WaterDrop`; reserves `Dreamy`, `Swirl`. The implementer of Task 5 fetches them once, at one pinned commit (network), and drops any whose header is not MIT or that fails the determinism test | The controller picks another ten | 5 |
| 5 | `fade` | Version 1 `fade` cut to the background and faded the new scene in | A dip: the outgoing shot fades to the incoming shot's background over the first half of the window and the incoming one fades up over the second | The version 1 picture | 3 |
| 6 | `erase` | The hand-drawn style's own transition (`template/transitions.mjs` `ERASE`). The `marker` look is not built | Not ported; named in the migration table as arriving with `marker` | none | none |
| 7 | Where licences are listed | `P/skills/make-diagram/THIRD_PARTY_NOTICES.md` and `make-scene`'s exist; make-motion has none. Cut-over Task 6 says the plugin README's licence table "gains nothing" | `M/THIRD_PARTY_NOTICES.md`, plus one row in `P/README.md`'s licence table; the controller amends that cut-over sentence | Notices file only | 5 |

## Global Constraints

- Version 1 files are not modified. The two version 1 shaders (`template/gl-transitions.mjs`: ripple and cube, written in this repository) are copied into `engine/`, never imported from `template/`: the cut-over's guard (`test/v2/standalone.test.mjs`) forbids that import.
- No new npm package. The only network use is Task 5 Step 1, by the implementer, to read ten to twelve files at one commit of `gl-transitions/gl-transitions`; nothing is sent but the request. A render, a review and a test never reach the network.
- `engine/cuts/**` is pure and DOM-free: no `document`, `window`, `Math.random`, `Date`; randomness only through `engine/seeded.mjs` or the post pass's integer hash. Shader sources are strings in `.mjs` files so the loopback server needs no new route. `test/v2/purity.test.mjs` stays green.
- Defaults reproduce today's frames. A film that names no option gets, for `cut`, `slide`, `punch` and `match`, the sampled nodes it gets at `c8c1d659`, with one stated exception: `slide` and `punch` in a look that turns the smear on (Task 6).
- Everything that differs between looks is look data. No branch on a look's name. A look names a cue or `null` for every registered cut (`validateLook` already refuses a look that does not), so the three look files change in the same commit that registers cuts.
- One film, one path: every shader a film uses is compiled before `__ready` resolves. If any fails, or there is no WebGL2, every shader cut of that film draws its stand-in, and the report names them.
- A frame is a function of the film, its seed and the frame number. Seeking frames in any order, or twice, gives the same pixels on one machine.
- A blank or half-drawn frame is never encoded: every GL call path ends in the existing `checkGl`.
- Validator errors keep the `<json.path>: <message>` form with did-you-mean.
- Files under 800 lines, functions under 50, named constants, tests first, a mutation row for a test written after its code. Snapshot baselines are never updated to make a failure pass.
- **Order with the version 1 gaps plan** (`2026-11-16-pa2-v1-gaps.md`): this plan lands first. Both edit `engine/page/stage.mjs`, `draw.mjs`, `scripts/v2/spec.mjs`, `report.mjs` and `engine/script/timing.mjs`; the gaps plan's preview, poster and workers tasks build on the two-picture path made here.
- One browser-heavy run at a time on this machine (`pgrep -fl chrome-headless-shell` first). `node --test` runs test files in parallel processes, so a run that includes browser tests is `node --test --test-concurrency=1 "<abs M>/test/v2/*.test.mjs"`, or one file at a time. Shell rules of this worktree: one plain command per call, literal absolute paths, no `cd`, no variables, loops or heredocs.
- Implementers do not commit. The controller commits one task per commit and pushes the branch.

## Review Focus

1. **Frames wrongly held.** `__stateKey` is built from sampled nodes. In a layer or shader cut between two still shots the nodes are identical while the progress moves, so the render would send one picture for the whole window. The key must carry the cut, its options and its progress.
2. **Seek order.** The outgoing picture is cached, the smear accumulates, shaders keep uniforms. Seek frames backwards and at random and compare with a forward pass.
3. **The first shot, a shot shorter than its cut, and a cut longer than half its shot.** The window is cut to the shot's length today (`film.mjs` `cutDur`); a `duration` option must go through the same clamp everywhere it is read.
4. **Readers that still take `registries.cuts.get(name).dur`.** After Task 1 no file outside `engine/cuts/` reads a cut's length or name from a shot except through `resolveCut`. The readers at `c8c1d659`: `engine/graph/film.mjs:134`, `engine/kinds/camera.mjs:74`, `engine/script/timing.mjs:311` (it takes the registry), `scripts/v2/plan.mjs` (`cutFrames`, `auditMoments`), `scripts/v2/review.mjs:94` and `:188`, `scripts/v2/sound/events.mjs:24`, `scripts/v2/sound/cues.mjs:68`, `scripts/v2/spec.mjs` (`checkCut`, `checkMatchCuts`), `scripts/v2/list.mjs`.
5. **What the review audits inside a window.** It audits the incoming shot alone (`__snapshotShot`). The contrast audit reads rendered pixels: it must not read a half-wiped frame.
6. **Shaders.** A sampler read outside 0..1, a division by a uniform that can be 0, a loop whose bound is a uniform, a `rand()` built on `sin()` (GPU rounding), alpha that is not 1 on output.
7. **Licence.** Every vendored file keeps its header byte for byte above our port notes; the notices file, the header and the pinned commit agree; a file with no MIT statement is not shipped.
8. **Cost.** A film with no new cut must not pay for the two-picture path.

## File Structure

- `engine/cuts/index.mjs` (the registry and the four node cuts; stays under 800 lines), `resolve.mjs` (options and `resolveCut`), `cover.mjs`, `layers.mjs` (the six layer cuts as recipes), `smear.mjs` (sample plan), `shaders/index.mjs`, `shaders/ripple.mjs`, `shaders/cube.mjs`, `shaders/<name>.mjs` (one per ported shader).
- `engine/page/cut-pictures.mjs` (two pictures, the 2D compositor, the outgoing cache), `post-cut.mjs` (the shader pass), `accumulate.mjs` (the smear's mean); `post.mjs`, `stage.mjs`, `draw.mjs` modified.
- `engine/graph/film.mjs`, `engine/kinds/camera.mjs`, `engine/script/timing.mjs`, `engine/looks/index.mjs`, `desk.mjs`, `pop.mjs`, `cosmos.mjs` modified.
- `scripts/v2/spec.mjs`, `list.mjs`, `plan.mjs`, `layout.mjs`, `review.mjs`, `report.mjs`, `sound/events.mjs`, `sound/cues.mjs` modified.
- `THIRD_PARTY_NOTICES.md` (new); `P/README.md` (one row); `.github/workflows/test.yml` (the WebGL job's test list).
- Tests: `test/v2/cuts-resolve.test.mjs`, `cuts-layers.test.mjs`, `cuts-shaders.test.mjs`, `cuts-notices.test.mjs`, `cuts-smear.test.mjs`, `cuts-browser.test.mjs`, `cuts-smear-browser.test.mjs`, `cuts-determinism-browser.test.mjs`, a fixture `test/v2/fixtures/cuts/baseline-keys.json`, and cases added to `spec.test.mjs`, `looks.test.mjs`, `review.test.mjs`, `sound-cues.test.mjs`, `post-browser.test.mjs`, `kinds-film.test.mjs`.
- Films: `references/examples/v2/cuts-desk.json`, `cuts-pop.json`.

## The cuts

| Cut | Family | From version 1 | Directions (first is the default) | Default length | Smear |
|---|---|---|---|---|---|
| `cut` | node | `none` | none | 0 | no |
| `slide` | node | `push` | `right`, `left`, `up`, `down` (the edge the new shot comes from; `right` is today's picture) | 0.4 s | yes |
| `cover` | node | `slide` | `right`, `left`, `up`, `down` | 0.4 s | yes |
| `punch` | node | new in version 2 | none | 0.2 s | yes |
| `match` | node | new in version 2 | none | 0.5 s | no |
| `crossfade` | layer | `crossfade` | none | 0.4 s | no |
| `fade` | layer | `fade` (decision 5) | none | 0.4 s | no |
| `wipe` | layer | `wipe` | `left`, `right`, `up`, `down` | 0.4 s | no |
| `iris` | layer | `iris` | `in`, `out` | 0.4 s | no |
| `zoom` | layer | `zoom` | `in`, `out` | 0.4 s | no |
| `blur` | layer | `blur` | none | 0.4 s | no |
| `ripple` | shader (own) | `gl-ripple` | none | 0.6 s | no |
| `cube` | shader (own) | `gl-cube` | `left`, `right`, `up`, `down` | 0.6 s | no |
| ten ported | shader (MIT) | new | per shader | 0.6 s | no |

Every cut with a window takes `duration`, 0.1 to 2 s (the version 1 limits). Names of the ported cuts are lower-case with hyphens and no `gl-` prefix (`page-curl`, `cross-zoom`, and so on); Task 5 fixes them.

---

### Task 1: One normaliser, options, and their validation

**Files:** Create `engine/cuts/resolve.mjs`, `engine/cuts/cover.mjs`, `test/v2/cuts-resolve.test.mjs`, `test/v2/fixtures/cuts/baseline-keys.json`. Modify `engine/cuts/index.mjs`, every reader in Review Focus 4, `scripts/v2/spec.mjs`, `scripts/v2/list.mjs`.

**Interfaces.**
- A registry entry: `{ family: 'node' | 'layer' | 'shader', dur, summary, example, directions: string[] | null, smearable: boolean, incomingOnly: boolean }` plus `apply` (node), `layers` (layer) or `shader` and `standIn` (shader). `example` is one valid `cut` value, shown by `--list cuts`.
- A shot's `cut`: a name, or `{ "type": name, "direction"?, "duration"?, "smear"? }`. A root `cut` of the same shape is the film's default for every shot after the first (version 1's root `transition`); a shot's own `cut` wins.
- `resolveCut(value, { look, rootCut?, fps?, shotDuration? }) -> { name, entry, family, direction: string | null, dur, smear: boolean }`. Order of defaults: the shot's value, the root `cut`, `look.cutStyle[name]` (Task 2; absent until then), the entry. `dur` is clamped to `shotDuration` when given. It throws for an unregistered name; the validator reports before it can.
- `aloneFromFrame(cut)` and `aloneAfterFrame(cut, fps)` take a resolved cut.
- Validation (`checkCut`): an unknown key gets did-you-mean; `direction` on a cut with none, or a value outside its list, names the list; `duration` outside 0.1 to 2, or on `cut`, is refused; `smear` on a cut that is not `smearable` is refused; the first shot accepts only `cut`; `match` keeps its shared-id rule.

- [ ] **Step 1: Pin today's frames.** Before any change, a test records into `baseline-keys.json` the `stateKey` of what each of `cut`, `slide`, `punch` and `match` returns from `apply()` at p = 0, 0.1, 0.25, 0.5, 0.75, 0.9 and 1 for two small hand-written node lists (a shared background behind the picture plane, a shared hero with a box, two unshared nodes), with and without `frame`. The lists live in the test, so another agent's change to a kind or a look cannot turn it red. It also records the keys of every frame inside the cut windows of `references/examples/v2/gate-pop.json` (two punches; `gate-desk.json` has hard cuts only), built with `buildFilm`, the estimated timeline and a fixed stand-in text measure; that half is regenerated, with a stated reason, if the film or the look changes under it. The fixture names the commit. From then on the test asserts equality. Prove it fires: change `SLIDE.dur` to 0.5 as a literal replace that matches once, see the named test fail, restore, confirm an empty diff.
- [ ] **Step 2: Failing tests** in `cuts-resolve.test.mjs`. `resolveCut('slide', …)` gives direction `right`, 0.4 s, smear false. An object with `direction: 'up'` and `duration: 0.8` gives those. A root cut is used when the shot has none and lost to the shot's own. `dur` is never over `shotDuration`. `slide` with each of the four directions places the outgoing and incoming nodes at hand-computed x and y for p = 0.25 on a 1920 by 1080 canvas, and the shared background does not move. `cover` moves only the incoming nodes and leaves the outgoing ones where they were, for each direction. `aloneAfterFrame` of a 0.8 s slide at 30 fps is 24. Each validation message above, with its path (`shots[2].cut.direction`).
- [ ] **Step 3: Implement.** Replace every reader. A search for `registries.cuts.get(` outside `engine/cuts/`, `scripts/v2/list.mjs` and tests finds nothing; put the search output in the report.
- [ ] **Step 4: `--list cuts`** prints for each cut its family, directions, default length, whether it takes `smear`, and its example; `--json` carries the same fields. A test asserts every registered cut has an `example` that validates in `desk`.
- [ ] **Step 5: Green.** `node --test --test-concurrency=1 "<abs M>/test/v2/*.test.mjs"`. The Step 1 test passes unchanged.

### Task 2: The look's cut data

**Files:** `engine/looks/index.mjs`, `desk.mjs`, `pop.mjs`, `cosmos.mjs`, `scripts/v2/list.mjs`, `test/v2/looks.test.mjs`. This task and the registration half of Tasks 3 to 5 touch files another agent is editing: start from that agent's last commit, and re-run the look tests after any rebase.

**Interfaces.**
- `look.cuts: string[]`: the cuts a film in this look may name (decision 2: all of them).
- `look.cutPalette: string[]`: a subset of `look.cuts` in the order the look prefers; never empty; holds `cut`.
- `look.cutStyle: { [cut]: { direction?, duration?, smear? } }`: the look's defaults, each checked against that cut's own options by `validateLook`. It replaces the boolean `look.smear`, which is removed with its readers.
- `look.sounds.cut`: unchanged shape, one entry per registered cut.
- `validateLook` refuses: a palette entry not in `cuts`; a `cutStyle` key that is not a registered cut; a direction or duration the cut does not accept; `smear: true` on a cut that is not `smearable`.

Starting values (the implementer may change one after viewing strips, and says so):

| Look | Palette | Cue per new cut (`null` where not listed) |
|---|---|---|
| `desk` | cut, match, slide, crossfade, wipe, fade, `page-curl` | cover, wipe and `page-curl`: `paper` |
| `pop` | cut, punch, slide, cover, zoom, the dots and glitch shaders, `cross-zoom` | cover, zoom, cube and wipe: `whoosh`; the glitch and pixel shaders: `click`; `cross-zoom`: `impact` |
| `cosmos` | cut, match, crossfade, fade, iris, ripple | ripple and iris: `whoosh` |

Only cue names the look's table already uses are suggested; every name is checked against the cue plan by the existing `validateLook`.

- [ ] **Step 1: Failing tests.** Each refusal above. Every shipped and experimental look names a cue or `null` for every registered cut (the existing test, now over the larger registry). `resolveCut` reads `cutStyle`: a `pop` slide with no option resolves with the look's direction and smear. `--list cuts` in JSON gives, per look, which cuts are in its palette.
- [ ] **Step 2: Implement,** with the palettes holding only cuts registered so far; Tasks 3 to 5 add their cuts to the three looks in the commit that registers them. Run the look and spec tests.

### Task 3: Two pictures and the layer cuts

**Files:** Create `engine/cuts/layers.mjs`, `engine/page/cut-pictures.mjs`, `test/v2/cuts-layers.test.mjs`, `test/v2/cuts-browser.test.mjs`. Modify `engine/graph/film.mjs`, `engine/page/stage.mjs`, `engine/graph/sample.mjs` only if `stateKey` needs it, the three looks.

**Interfaces.**
- `frameAt(t)` returns `{ background, sampled }` as now for a node cut and outside a window. Inside a layer or shader window it returns `{ background, sampled, cut: { name, family, p, direction }, from: { shot: index, background, sampled } }`: `sampled` is the incoming shot alone and live, `from` the outgoing shot frozen at its end. `sampleAt`, `sampleShot` and `backgrounds` keep their meaning.
- A layer cut's `layers({ p, direction, canvas }) -> { under: 'from' | 'to', from: Pose, to: Pose, backdrop: 'from' | 'to' | null }`, `Pose = { opacity, clip: { rect: [x, y, w, h] } | { circle: [cx, cy, r] } | null, scale, blur }`, eased inside the recipe. At p 0 the composed picture is the outgoing picture exactly and at p 1 the incoming one exactly.
- `cut-pictures.mjs`: `createCutPictures({ w, h, drawShot })` -> `{ compose(ctx, state, recipe), outgoing(state) }`. The outgoing picture is drawn once per shot index and kept (it is a function of the film alone), which is what pays for the second picture.
- The capture key and the draw key of a frame inside a layer or shader window append `|cut:<name>:<direction>:<p rounded to 1e-9>`.

- [ ] **Step 1: Failing unit tests** (`cuts-layers.test.mjs`). For each layer cut: the recipe at p 0 and p 1 is the identity for the picture that should show; `wipe` from each edge at p 0.5 clips the incoming picture to the hand-computed half; `iris` `in` at p 1 has a radius that covers the canvas corners; `zoom` `in` starts at 1.2 and `out` at 0.8 (the version 1 values); `fade` shows neither picture above opacity 0 at p 0.5 and names the incoming background as its backdrop; `blur` never returns a negative radius. `frameAt` inside a wipe's window returns `cut` and `from`; one frame after the window it returns neither.
- [ ] **Step 2: Failing browser tests** (`cuts-browser.test.mjs`, one page, grain set to 0 through `__setPost`). A two-shot film of flat fields (red, then blue): for `wipe` `left` at mid-window the left half of the frame is blue and the right half red within one level, sampled at eight points; `crossfade` at p 0.5 is the mean of the two colours within two levels; `iris` centre is the incoming colour and a corner the outgoing one. Held frames: for a `crossfade` between two shots that hold still, `__heldFlags` over the window is all false, and the frames before and after the window are held as before. Seek order: frames of the window read forwards, then backwards, give identical pixel hashes.
- [ ] **Step 3: Implement.** `stage.mjs` draws the incoming picture into the existing source canvas and composes there; a film with no layer or shader cut creates no second canvas (assert it in the browser test through a counter the page exposes for tests).
- [ ] **Step 4: Looks.** Register the six cuts and add their entries to the three looks (Task 2's tables). View one strip per cut in `desk` and say what each shows.

### Task 4: The shader pass, and this repository's two shaders

**Files:** Create `engine/page/post-cut.mjs`, `engine/cuts/shaders/index.mjs`, `ripple.mjs`, `cube.mjs`, `test/v2/cuts-shaders.test.mjs`. Modify `engine/page/post.mjs`, `stage.mjs`, `scripts/v2/report.mjs`, `scripts/v2/review.mjs`, `test/v2/post-browser.test.mjs`, `test/v2/cuts-browser.test.mjs`.

**Interfaces.**
- The contract a shader file fulfils, as gl-transitions defines it: a GLSL body that declares `vec4 transition(vec2 uv)` and may call `getFromColor(uv)`, `getToColor(uv)` and read `progress` and `ratio`; its parameters are uniforms with defaults. A shader module exports `{ name, source, params: { [uniform]: number | number[] }, directions?: { [direction]: params }, standIn: 'crossfade' | 'wipe', license: { spdx, author, origin, commit } | null }` (`license` null for this repository's own).
- `post.render(source, t, cut?)`, `cut = { from: canvas, shader: name, progress, params }`. With `cut`, the transition is drawn into a texture first and the existing bloom, halftone and grain run over the result, so grain is one pattern over the frame.
- `createPost(canvas, { …, shaders: name[] })` compiles every named shader at creation. `post.cuts = { ran: name[], replaced: name[], reason: string | null }`.
- `__ready` adds `cuts: { ran, replaced, reason }`; the report gains `cuts` with the same shape, and the text form's post line reads `post webgl2, shader cuts: 3` or `post 2d, shader cuts replaced: ripple, cube (no WebGL2)`. A replaced cut is a `creative` page finding, in the form the 2D post pass already uses for bloom and halftone.
- Uniform maths stays pure and tested in Node: `shaderUniforms(module, { p, direction, canvas })`.

- [ ] **Step 1: Failing unit tests.** `ripple` and `cube` uniforms equal the version 1 values for the same progress, direction and size: copy six cases from `test/gl-transitions.test.mjs` as numbers, with a comment naming that file. Every shader module has a `standIn` that is a registered layer cut (a shader window already holds two pictures, which is what a layer cut composes; a node cut cannot stand in), and a stand-in takes the shader cut's direction when it has that direction and its own default otherwise (`cube` `up` stands in as `wipe` `up`). A module whose `source` lacks `transition(` is refused at registration.
- [ ] **Step 2: Failing browser tests.** With flat red and blue shots: `ripple` at p 0 is the outgoing picture and at p 1 the incoming one, exactly; `cube` `left` at mid-window shows both colours. A shader that does not compile (a test module with a syntax error): `__ready` reports every shader cut of the film as replaced with the compiler's message, and the frames equal the stand-in's frames. With WebGL2 taken away (the session option the 2D post test already uses), the same. `post.render` after a lost context throws the existing message.
- [ ] **Step 3: Implement.** The wrapper is ours (GLSL ES 3.00): it defines the samplers, `getFromColor`, `getToColor`, `progress`, `ratio`, the pixel origin, and writes alpha 1. The two shaders are ported from `template/gl-transitions.mjs` to the contract; their file headers say they were written in this repository.
- [ ] **Step 4: Looks and CI.** Register `ripple` and `cube`; add their look entries. In `.github/workflows/test.yml` the WebGL job's list gains `test/v2/cuts-browser.test.mjs` (the cut-over's Task 3 Step 5 rewrites the same line: tell the controller).

### Task 5: Ported shaders and their licences

**Files:** Create `engine/cuts/shaders/<name>.mjs` (ten), `THIRD_PARTY_NOTICES.md`, `test/v2/cuts-notices.test.mjs`. Modify `engine/cuts/shaders/index.mjs`, the three looks, `P/README.md` (one licence row).

**Interfaces.** A ported file is: the upstream header comment lines exactly as they are (author, licence), then a line `// Ported for make-motion from gl-transitions/gl-transitions@<40-hex commit>, transitions/<File>.glsl; changes: <list>`, then the module. `THIRD_PARTY_NOTICES.md` has one row per file: cut name, upstream file, author as the header gives it, licence, commit, the SHA-256 of the upstream file as fetched, then the MIT text once.

- [ ] **Step 1 (network, implementer only): Fetch.** Resolve the default branch of `gl-transitions/gl-transitions` to one commit and fetch each candidate file at that commit into a new empty folder under the scratch directory. Record the commit and each file's SHA-256. Read every header. A file is used only if its header says MIT, or it has no licence line and the repository `LICENSE` at that commit says such files are MIT (quote the sentence in the notices). Anything else is dropped and a reserve takes its place; report which.
- [ ] **Step 2: Failing tests** (`cuts-notices.test.mjs`). Every file under `engine/cuts/shaders/` with a non-null `license` has a row in the notices with the same author, licence and commit, and the reverse; all rows name one commit; the header lines of each file sit above the port line; `license.spdx` is `MIT` for every ported file. Prove it fires: delete one row as a literal replace, see the test fail, restore.
- [ ] **Step 3: Port,** one file at a time. Allowed changes, each listed on the port line: GLSL ES 1.00 calls to 3.00; a `rand()` built on `sin()` replaced by the post pass's integer hash seeded with the film seed; parameters lifted into `params`; a guard on a sampler read outside 0..1. The picture is otherwise the author's.
- [ ] **Step 4: Tests per shader** (added to `cuts-browser.test.mjs`): p 0 is the outgoing picture and p 1 the incoming one within one level at sixteen sample points; every output pixel at p 0.5 has alpha 255; two seeks of the same frame hash the same.
- [ ] **Step 5: Looks.** Register the ten under their make-motion names, add palette and cue entries, add the `P/README.md` row. View one strip per shader in `desk` and `pop`.

### Task 6: Motion blur that reads as blur

**Files:** Create `engine/cuts/smear.mjs`, `engine/page/accumulate.mjs`, `test/v2/cuts-smear.test.mjs`, `test/v2/cuts-smear-browser.test.mjs`. Modify `engine/cuts/index.mjs` (the `smeared` path goes), `cover.mjs`, `engine/graph/film.mjs`, `engine/page/stage.mjs`, `draw.mjs` (the comment about smear samples), `desk.mjs`, `pop.mjs`.

**Interfaces.**
- A smearable node cut exposes `parts({ from, to, canvas, direction }) -> { still: Node[], moving(q): Node[], travel(q0, q1): number }`: the nodes that do not move, the moving nodes at progress q, and the largest distance in pixels any point of them covers between two progress values.
- `smearPlan({ p, frame, travel }) -> { samples: number[], gapPx: number }` (pure): progress values spread over `SMEAR_SHUTTER` (half a frame, as now) centred on p, as many as keep neighbouring copies at most `SMEAR_GAP_PX` apart, between `SMEAR_MIN_SAMPLES` and `SMEAR_MAX_SAMPLES`.
- `frameAt` inside a smeared window returns `{ background, sampled: still, smear: { layers: Node[][] , gapPx, vector } }`, `sampled` then holding the still nodes only.
- `accumulate.mjs`: `createAccumulator({ w, h, gl? })` -> `{ mean(drawLayer, count) -> canvas, kind: 'float' | 'bytes' }`. Each layer is drawn on a clear canvas (premultiplied) and the mean of the layers is composited once over the still picture. Because compositing is linear in premultiplied colour, the mean of the layers over the still picture equals the mean of the whole frames, and the still nodes are drawn once instead of once per sample. With WebGL2 and float render targets the sum is exact; otherwise a running average in bytes with the sample count capped lower, and the report says `smear: reduced`.
- When the cap binds and `gapPx` is over `SMEAR_GAP_PX`, the mean is box-filtered along `vector` over `gapPx`, on the moving layer only.
- The capture key and the draw key of a frame inside a smeared window append `|smear:<name>:<direction>:<p rounded to 1e-9>`, as Task 3 does for a layer window: `sampled` holds only the still nodes there (none at all for a punch), so without it every frame of the window would be held.

- [ ] **Step 1: Failing unit tests.** `smearPlan` for a slide's fastest frame at 1920 wide gives the hand-computed count; a frame with no travel gives `SMEAR_MIN_SAMPLES`; samples never leave 0..1; a cut whose resolved `smear` is false returns no `smear`. `parts` of `slide`, `cover` and `punch`: `still` holds the shared background, `travel` equals the hand-computed distance.
- [ ] **Step 2: Failing browser tests, the echo guard.** A film of one white bar, 40 units wide, on black, into a `slide` with smear on, grain 0. At the frame of fastest travel, read the row of pixels through the bar's centre: (a) the luminance profile rises, holds and falls with no interior dip deeper than two levels; (b) its width is the bar's width plus the shutter's travel within two pixels; (c) the row's sum equals the unsmeared bar's sum within 1 percent (energy is kept). For `punch`, the same along a radius. The frame before the window and the frame after it equal the unsmeared frames exactly. `__heldFlags` over a smeared punch's window and a smeared slide's window is all false, and the MP4 of that film has as many captured frames as the window has frames.
- [ ] **Step 3: Prove the guard fires.** Set `SMEAR_MAX_SAMPLES` to 5 with the box filter off (the first rejected build) as literal replaces that match once: assertion (a) fails. Restore, confirm an empty diff. Put the row in the report: mutation, test, assertion, outcome.
- [ ] **Step 4: Implement,** then turn it on: `cutStyle` in `desk` and `pop` gets `smear: true` for `slide`, `cover` and `punch`. The Task 1 baseline fixture is regenerated only for the smeared windows of those looks, in this commit, and the commit message says the picture changed on purpose.
- [ ] **Step 5: Strip review.** The example films hold two punches (`gate-pop.json`) and no slide or cover, so write two small films in the scratch folder, one per look, each with a `slide`, a `cover` and a `punch` between shots with large type. Render their strips and `gate-pop.json`'s (`node <abs M>/scripts/make.mjs <film> --sheets-only --json --out <scratch>/<name>.mp4`), view every smeared strip at full size, and say what each frame shows. Then an independent reviewer (fresh, strips only, report only) is asked one question per strip: blur, or copies? Two revision rounds at most; after that, decision 3's fallback, recorded in `docs/decisions-pending.md` by the controller.

### Task 7: Review, strips, timing and sound follow the resolved cut

**Files:** `scripts/v2/plan.mjs`, `layout.mjs`, `review.mjs`, `sound/events.mjs`, `sound/cues.mjs`, `engine/script/timing.mjs`, `engine/review/pacing.mjs` if it reads a window; `test/v2/review.test.mjs`, `review-browser.test.mjs`, `sound-cues.test.mjs`, `timing.test.mjs`.

**Interfaces.**
- `CUT_STRIP_MAX_TILES` (in `plan.mjs`): a strip shows every frame of the window plus two each side when that is at most the cap; a longer window shows the two frames each side, the window's first, middle and last frames, and the rest spread evenly, in time order, with no frame twice. A strip tile inside a window is labelled with the cut's name and progress (`slide 50%`).
- A cut event carries the resolved cut: `{ kind: 'cut', t, shot, cut: name, dur, direction }`; the cue plan keys on `name` as now.
- New review findings: `mechanical` when a cut's window is longer than its shot (after the clamp the cut never finishes); `creative` when a window takes more than half its shot (`the wipe is on screen for 1.2 s of this 2.0 s shot; shorten it or lengthen the shot`).

- [ ] **Step 1: Failing tests.** A 2 s `crossfade` at 30 fps plans at most `CUT_STRIP_MAX_TILES` tiles that include the first, middle and last window frames; a 0.2 s punch plans the same tiles as today (compare with a recorded list). `auditMoments` includes the first frame after a 0.8 s slide's window. A frame inside a `wipe`'s window is audited as the incoming shot alone, and the contrast audit reads a picture of that shot alone, not the half-wiped frame (a film whose outgoing shot would fail contrast and whose incoming shot passes has no contrast finding in the window). The two findings fire, each on a fixture, and not on the gate films. A cue is planned at the start of each new cut for a look that names one, and none for `null`; the report's "cuts on a beat" count is unchanged for `sound-desk.json`.
- [ ] **Step 2: Implement; green.** The sweep in `test/v2/review-browser.test.mjs` stays green.

### Task 8: Determinism and cost

**Files:** Create `test/v2/cuts-determinism-browser.test.mjs`. Modify nothing else unless a measurement fails.

- [ ] **Step 1: Determinism.** For a film that uses one cut of each family and a smeared slide, with the look's grain on: every frame of every window is captured (PNG) in a forward pass, in a backward pass, and in a second, fresh page; the three hashes of each frame are equal. On a mismatch the test keeps the two PNGs and prints their paths. The comparison is a render against itself on one machine, never against stored pictures (version 1's shader transitions had a Linux-only byte-identity flake with grain; if this test flakes in CI, report it with the kept pairs and do not loosen it).
- [ ] **Step 2: Cost, measured.** With no other browser run live, run `node <abs M>/scripts/make.mjs <abs M>/references/examples/v2/gate-desk.json --json --out <scratch>/gate-desk.mp4` three times at the task's base commit and three times at its head, and take the median `msPerFrame` and `captured` of each. Budget: the head's median is at most 1.05 times the base's. That film has hard cuts only, so it pays for nothing this plan adds, with the smear on or off. What a window costs is measured in Task 9 Step 2, on the film that has them.
- [ ] **Step 3: If the 1.05 budget is missed,** find what a film without new cuts now pays for and remove it; do not raise the budget.

### Task 9: Two films with every cut, and a look review

**Files:** `references/examples/v2/cuts-desk.json`, `cuts-pop.json`; `docs/decisions-pending.md` (controller).

- [ ] **Step 1: The controller writes** one film per look, unvoiced or voiced, in which every registered cut appears once between shots that suit it (a `match` between two shots that share a hero; a `page-curl` between two full frames), with at least one use of each direction of `slide` and `wipe`, a `duration` override, a root `cut`, and sound on. A test asserts both films name every registered cut, so a cut added later cannot be left out.
- [ ] **Step 2: Render** both with `node <abs M>/scripts/make.mjs <film> --json --out <scratch>/<name>.mp4`. Exit 0, no mechanical finding, `cuts.replaced` empty. The controller views every cut strip and writes one sentence per cut on what a stranger would see. From the same render of `cuts-desk.json` report, with a test-only timer around `__seek`, the median time of a frame inside a layer window, a shader window and a smeared window against a frame outside any window, and the film's `msPerFrame` against `gate-desk.json`'s. These are reported as measured, with the commands; no budget is set for them and none is written into a document.
- [ ] **Step 3: The 2D path.** Render `cuts-desk.json` once with WebGL2 taken away (the test session option; a test, not a flag): it finishes, every shader cut is in `cuts.replaced`, and the strips show the stand-ins.
- [ ] **Step 4: Independent look review.** A fresh reviewer, strips and sheets only, report only, with this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them." The gate, applied by the controller per cut and per look: the cut reads as one intended move, nothing flashes or tears, and it suits the look. At most two revision rounds. A cut that still fails in a look leaves that look's palette and, if it fails in both, the registry; either way it is recorded for the owner.
- [ ] **Step 5: Hand-over.** A code review of the branch's diff with the Review Focus list and the security lens (the shader strings reach a GL compiler; the page still sends its CSP; nothing new is served). `docs/decisions-pending.md` gains the outcome of decisions 1 to 7 and any cut left out. The manual-test checklist gains: watch both cut films once at full speed; render one on a second machine and compare a strip.

## What the cut-over plan must change

The controller edits `docs/superpowers/plans/2026-11-16-pa2-cutover.md`; this plan does not.

- Task 3 Step 5: the WebGL job's test list also holds `test/v2/cuts-browser.test.mjs` and `cuts-determinism-browser.test.mjs`.
- Task 5 Step 1 (`references/migrating.md`): the transition rows come from "The cuts" table above, with `erase` as not in 2.0.
- Task 5 Step 4 and Task 6 Step 2: the README names `THIRD_PARTY_NOTICES.md`; the licence table gains one row (decision 7).
- Table B deletes `template/gl-transitions.mjs` and `test/gl-transitions.test.mjs`: Task 4 of this plan must land first, since it copies the two shaders and six test cases out of them.

## Not in this plan

A light sweep, and halftone or bloom changes, in the post pass (design 8.4 lists them; no look asks for one). `erase` and the `marker` look. Cuts inside a shot (a kind's own hard cut, as `compare` does in `pop`). A preview page (the version 1 gaps plan, Task 5, which shows every cut through the same stage). Documenting the cuts in `SKILL.md` and `references/schema.md` (the cut-over's Tasks 2 and 5; `--list cuts` is the source they quote).

## Could not determine (nothing was run)

- Whether Chromium's software GL in CI offers float render targets; `accumulate.mjs` has the byte path for when it does not.
- Whether any ported shader's header names a licence other than MIT, and the exact parameters of each: no shader file was read.
- What `engine/script/timing.mjs` does with the cut registry it is given (line 311 takes it as an option); Task 1 reads it.
- Whether the contrast audit reads the visible canvas or `window.__source` inside a window; Task 7 Step 1's fixture finds out.
- The cost of a second picture and of the smear: Task 8 measures them.
