# make-motion 1.2.0: improvements and hand-drawn style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five make-motion improvements, a per-scene hand-drawn whiteboard style with templates, and removal of the total length cap, as one PR.

**Architecture:** Hand-drawn scenes compile to a pure stroke plan (polylines plus times) that runs identically in Node and the page. Validators and audits read the plan without a browser, and the renderer only looks values up per frame. Standard scenes take no new code path, so their renders stay byte-identical.

**Tech Stack:** Node 20+ ES modules, `node:test`, ajv, Playwright, ffmpeg, kokoro-js 1.2.1.

**Spec:** `docs/superpowers/specs/2026-11-05-make-motion-sketch-mode-design.md`. Read it first: it holds the why, the owner's decisions and the non-goals.

`<skill>` below means `plugins/portable-artifacts/skills/make-motion`. Run commands from the worktree root.

## Global Constraints

- Offline at validate, preview and render time. No new runtime dependency in `package.json`.
- Every frame is a pure function of time. Same spec, same frames, any `--workers` value.
- Specs with no sketch scene and no new flag render byte-identically to the base commit.
- `SKILL.md` frontmatter `description` stays on one line.
- Files under `<skill>/shared/` are generated. Do not edit them.
- Keep the agent-surface rule: scripts reject unknown arguments with an error listing accepted ones.
- A drawing sound, other board looks, a forearm, and sketch scenes in viral specs are out of scope.
- The reference photos in `.scratch/grip-refs/` never ship.
- Shell rules for this worktree: one plain command per Bash call, literal absolute paths, no `cd`, pipes, `;`, shell variables, loops or heredocs; scripts go in `.scratch/` via the Write tool. The word "eval" in a path trips the guard, so use Read and Edit, not Bash, on `plugins/portable-artifacts/eval/`.
- One browser-heavy run at a time. Run `pgrep -fl chrome-headless-shell` first.
- Commit message trailer, exactly one line: `Co-Authored-By: Claude <noreply@anthropic.com>`. Implementers do not commit; the orchestrating session does.

## Review Focus

Inputs the spec implies and no feature test would naturally hit. Each line has its test in the owning task.

1. Handwritten text containing a character Caveat lacks (emoji, CJK): a validation error naming the character, not a silent fallback font that the plan's glyph positions no longer match. Task 8.
2. A vertical film (`format: "9:16"`) with a sketch diagram: the block picks a column layout, stays in the safe area, and the hand scales with the short side. Task 14.
3. A mixed film rendered with `--theme poster`: standard scenes take poster, sketch scenes keep the board palette. Task 10.
4. A `{{var}}` inside handwritten text with `--batch`: the stroke plan sees the substituted text, so timing and glyphs match each row. Task 10.
5. A drawing that ends exactly at the scene's end: the required duration includes the hand's exit, so the hand is never visibly cut off by the next scene. Task 9.

---

## Part 0: baseline

### Task 1: Install and record base hashes

**Files:**
- Create: `.scratch/baseline-render.mjs` (gitignored, not shipped)

**Interfaces:**
- Produces: `.scratch/baseline/base.json`, mapping each `references/examples/*.json` name to an md5 of its decoded video and audio streams.

- [ ] **Step 1: Install dependencies**

Run: `npm --prefix /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/Add-Couple-features/plugins/portable-artifacts/skills/make-motion ci`
Expected: exit 0.

- [ ] **Step 2: Run the existing suite**

Run: `node --test "plugins/portable-artifacts/skills/make-motion/test/**/*.test.mjs"`
Expected: all pass or skip. Record the pass count, and report any failure before going on.

- [ ] **Step 3: Write `.scratch/baseline-render.mjs <out.json>`**

For each top-level example, serially, it runs `render.mjs <example> --out <tmp>.mp4 --workers 1` and hashes with `ffmpeg -i <tmp>.mp4 -map 0 -c copy -f md5 -` for stream data only, because the MP4 `comment` tag holds a build date. An example that fails records its error.

- [ ] **Step 4: Run it on the unchanged tree**

Run: `node .scratch/baseline-render.mjs .scratch/baseline/base.json`
Expected: one hash per example. Run it a second time to `.scratch/baseline/base2.json` and confirm the two match, which proves the guardrail is stable.

---

## Part C: length cap

### Task 2: Remove the total length cap

**Files:**
- Modify: `<skill>/scripts/lib/spec.mjs:40,1019-1020`, `<skill>/scripts/lib/storyboard.mjs:16` and its uses
- Modify: `<skill>/references/schema.md:23,259`, `<skill>/README.md:216`, `<skill>/SKILL.md:95` ("total ≤ 120 s")
- Test: `<skill>/test/validate.test.mjs:104-106`, `<skill>/test/storyboard.test.mjs`

- [ ] **Step 1: Replace the failing-length test** with `total duration over 120 s is valid`: a spec of 3 scenes of 50 s each returns no errors. Add `a storyboard brief of 150 s is accepted` to the storyboard test.
- [ ] **Step 2: Run both test files.** Expected: FAIL with `total duration 150s exceeds the 120s limit`.
- [ ] **Step 3: Remove `MAX_TOTAL_SECONDS` and its check, and `MAX_CLIP_SECONDS`.** Keep `maxItems: 50` and the 60 s scene maximum. Update the three docs, adding one sentence that render time grows with length, pointing to `--workers` and `--quality draft`.
- [ ] **Step 4: Run both test files.** Expected: PASS.
- [ ] **Step 5: Prove nothing else assumes the cap.** Write `.scratch/long.json` with three 45 s scenes of one text each and an `audio` track, then run `node <skill>/scripts/render.mjs .scratch/long.json --out .scratch/long.mp4 --quality draft --loudness -14 --workers auto`. Expected: `ffprobe` reports about 135 s, and the loudness line prints.
- [ ] **Step 6: Commit** `feat(make-motion): remove the 120 s total length cap`.

---

## Part A: improvements

### Task 3: `--no-provenance`

**Files:**
- Modify: `<skill>/scripts/render.mjs:52,76-105,233`, `<skill>/scripts/lib/spec.mjs` (root schema), the preview footer's source (find with a search for `provenanceText` under `<skill>/template` and `<skill>/scripts`)
- Test: `<skill>/test/render-flags.test.mjs`

**Interfaces:**
- Produces: root field `"provenance": false` (boolean), flag `--no-provenance` setting `opts.noProvenance`.

- [ ] **Step 1: Write failing tests:**
  - `--no-provenance removes comment and artist tags`: render a tiny spec that has `generatedBy.model`, `ffprobe -show_format`, assert neither tag.
  - `root "provenance": false does the same, through the loudness path`: the same spec with an audio track and `--loudness -14`.
  - `--no-provenance with --contact-sheet is a usage error`: exit 2, message contains `--no-provenance does not apply to --contact-sheet`.
  - `default still writes both tags` (guards the base behaviour).
  - `faststart: moov comes before mdat`, only if a search of the tests shows nothing pins `+faststart`.
- [ ] **Step 2: Run them.** Expected: FAIL on the first three, with an unknown-flag error on the first.
- [ ] **Step 3: Implement.** In `prepare`, `metadata` becomes `{}` when either switch is set. Hide the preview footer when the spec's field is false. Do not touch ffmpeg's `encoder` tag.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Docs and commit.** `SKILL.md` step 6, `references/schema.md`, and this sentence in both: "This removes the authoring tags. ffmpeg's own encoder tag stays." Commit `feat(make-motion): render --no-provenance`.

### Task 4: `--poster`

**Files:**
- Modify: `<skill>/scripts/render.mjs`
- Test: `<skill>/test/render-flags.test.mjs`

**Interfaces:**
- Produces: `renderPoster(page, p): Promise<void>`; `opts.poster` (seconds), `opts.posterOut`.

- [ ] **Step 1: Write failing tests**, using a spec with a block and an SRT captions track:
  - `poster equals the film's frame with the captions layer hidden`: capture that frame through the page with `#stage > .captions` hidden, compare to the poster's PNG bytes.
  - `poster keeps the captioned block layout`: the poster differs from a poster of the same spec with `captions` deleted.
  - `--poster past the end is a usage error`: exit 2, `--poster 40: past the end (the video is 3 s)`.
  - `--poster-out without --poster`, `--poster with --batch`, `--poster with --contact-sheet`, and an extension other than `.jpg`, `.jpeg` or `.png`: each exit 2.
  - `--poster writes no MP4`.
- [ ] **Step 2: Run them.** Expected: FAIL with an unknown flag.
- [ ] **Step 3: Implement.** Treat poster runs like contact sheets for `prepare` (no ffmpeg, no audio plan, one page). The frame is `Math.round(seconds * fps)`. After seeking, set `visibility: hidden` on `#stage > .captions`, then `page.screenshot`. Default path `<spec dir>/out/poster.jpg`, JPEG quality 92. Print the path. Grain and vignette stay.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Docs and commit.** `SKILL.md` step 6, `references/schema.md`. Commit `feat(make-motion): render --poster`.

### Task 5: Phonemes

**Files:**
- Modify: `<skill>/scripts/lib/voice.mjs:109-116,138-153`, `<skill>/scripts/voice.mjs`, `<skill>/SKILL.md` (Workflow step 2 and Voiceover notes)
- Test: `<skill>/test/voice.test.mjs`, `<skill>/test/captions.test.mjs`

**Interfaces:**
- Produces: sidecar `sentences[i].phonemes: string`; `opts.phonemes: boolean`; stdout lines `<sentence>\t<phonemes>` after the existing three.

- [ ] **Step 1: Prove the API first.** Write `.scratch/phoneme-probe.mjs`, which needs the voice install and the model; ask the owner once if the doctor reports them missing. It passes a closed `TextSplitterStream` to `tts.stream()`. Run it on "Send your résumé. I will resume later." with a time limit. Expected: it terminates and prints `ɹˈɛzuːmˌeɪ` and a different reading for "resume". If it hangs, stop and report.
- [ ] **Step 2: Write failing tests**, with the file's existing kokoro stubs extended with `stream`:
  - `sidecar sentences carry phonemes`.
  - `--phonemes prints one tab-separated line per sentence after the three contract lines`.
  - `a chunk yielding two results joins audio and phonemes`.
  - `--phonemes with an unknown extra flag lists accepted flags`.
  - In captions: `a sidecar with phonemes parses to the same groups as one without`.
  - Gated on `VOICE_TEST=1`: `the résumé spelling reads ɹˈɛzuːmˌeɪ`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Replace `tts.generate` at `voice.mjs:144` with `for await` over `tts.stream(closedSplitter(chunk), { voice, speed })`. Keep the dispose discipline.
- [ ] **Step 5: Run them, including `VOICE_TEST=1 node --test <skill>/test/voice.test.mjs`.** Expected: PASS.
- [ ] **Step 6: `SKILL.md`.** Add to Voiceover: check words with more than one pronunciation (resume/résumé, lead, read, live, record) with `--phonemes`, and respell them in the narration file.
- [ ] **Step 7: Commit** `feat(make-motion): voice.mjs --phonemes and pronunciation guidance`.

### Task 6: Left anchor

**Files:**
- Modify: `<skill>/template/renderer.mjs:634`, `textStyle` at `:108`, `<skill>/scripts/lib/spec.mjs:63`, `<skill>/scripts/check.mjs`, `<skill>/SKILL.md:103`, `<skill>/references/schema.md`
- Test: `<skill>/test/render-flags.test.mjs` or a new `<skill>/test/anchor.test.mjs`, `<skill>/test/check.test.mjs`

**Interfaces:**
- Produces: text field `anchor: 'left'|'center'|'right'`, default `center`. `check.mjs` warning `text "<id>" nearly lines up with "<other>": left edges differ by <n> px`.

- [ ] **Step 1: Write failing tests:**
  - `three stacked lines with anchor left share one left edge`: Host Grotesk, different lengths, same `x`. DOM rects' `left` equal to within 0.5 px.
  - `anchor right aligns right edges`.
  - `scale keeps the anchored edge fixed`.
  - `anchor on a shape is a validation error`.
  - `check warns on left edges 1 to 12 px apart, not at 0 px or 13 px` at 1080, scaled for the short side, not while moving. Feed it the bad spec and see the warning first.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The x translation is `0%`, `-50%` or `-100%` for text only; `transform-origin` becomes `left center` or `right center`. An element with no `anchor` must produce the exact transform string it does today.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-motion): text anchor and near-aligned edge warning`.

### Task 7: UI mockup blocks

**Files:**
- Create: `<skill>/template/blocks/browser-window.mjs`, `form-fields.mjs`, `tab-switch.mjs`, `button-state.mjs`, `side-panel.mjs`
- Create: `<skill>/references/examples/blocks/<name>.json` and `<skill>/references/blocks/<name>.png` for each, `<skill>/references/examples/ui-form-fill.json`
- Modify: `<skill>/template/blocks/index.mjs:32-90`, `<skill>/SKILL.md` block table and place rules, `<skill>/scripts/blocks.mjs` (print `content` for `browser-window`)
- Test: `<skill>/test/blocks.test.mjs` (loops over `BLOCK_NAMES`), new `<skill>/test/ui-blocks.test.mjs`

**Interfaces:**
- Consumes: `template/blocks/layout.mjs` helpers (`textPart`, `rectPart`, `enter`, `blockGroup`, `fitText`); the module shape documented at `index.mjs:4-20`.
- Produces: params per the spec's A3 table. `browser-window` exports `contentRect(size, format): { x, y, width, height }`, printed by `blocks.mjs show browser-window`.

- [ ] **Step 1: Write failing tests** in `ui-blocks.test.mjs`:
  - `form-fields fills rows in order`: each row's value keyframe starts after the previous row's ends.
  - `tab-switch and button-state: the old face is at opacity 0 by the time the new one reaches 1`, or they cross-fade in one spot.
  - `blocks.mjs show browser-window prints the content rectangle`.
  - `ui-form-fill.json has at most 5 block elements and check.mjs reports no problems`.
  - `a 9:16 browser-window stays inside the safe area`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the five blocks.** Text never below `MIN_TEXT`. Follow `template/blocks/step-flow.mjs` for style. Blocks do not nest.
- [ ] **Step 4: Write the examples, render a contact sheet of each, view it, and save the block's representative tile as its golden PNG** in the same format as `references/blocks/step-flow.png`.
- [ ] **Step 5: Run `blocks.test.mjs` and `ui-blocks.test.mjs`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(make-motion): UI mockup blocks`.

---

## Part B: hand-drawn style

File layout, all under `<skill>/template/sketch/`:

| File | Responsibility |
|---|---|
| `style.mjs` | `isSketchScene`, palette, constants |
| `geometry.mjs` | Seeded wobble, polyline length and lookup |
| `plan.mjs` | Scene to strokes and times |
| `timing.mjs` | Sentence windows and pace |
| `hand.mjs` | Hand drawing, tones, pose at time t |
| `view.mjs` | DOM for a drawn element, per-frame apply |
| `caveat-700.woff2`, `caveat-metrics.mjs`, `lucide.mjs`, `LICENSES` | Generated assets |

### Task 8: Style field, assets and refusals

**Files:**
- Create: `plugins/portable-artifacts/bin/vendor-sketch-assets.mjs` (development tool, not run in CI)
- Create: `<skill>/template/sketch/style.mjs`, the four assets above, `<skill>/scripts/lib/sketch-check.mjs`, `<skill>/scripts/sketch-icons.mjs`
- Modify: `<skill>/scripts/lib/spec.mjs` (schema, `FIELDS`, `validateSpec`)
- Test: new `<skill>/test/sketch-validate.test.mjs`, new `<skill>/test/sketch-icons.test.mjs`

**Interfaces:**
- Produces, `style.mjs`: `isSketchScene(spec, scene): boolean` (scene `style`, else root `style`, else false); `specHasSketch(spec): boolean`; `PALETTE = { board: '#fdfcf8', ink: '#1d2330', accent: '#e8590c' }`; `HAND_TONES = ['light','medium','tan','brown','dark']`.
- Produces, `caveat-metrics.mjs`: `export default { unitsPerEm, ascent, descent, advance: { [char]: units } }`, for the shipped Latin subset.
- Produces, `lucide.mjs`: `export default { [name]: Array<Array<[x, y]>> }`, polylines in the 24-unit box, flattened at vendor time with Playwright's `getPointAtLength` and simplified to 0.05 units. Imported dynamically, so standard specs never load it.
- Produces, `sketch-check.mjs`: `checkSketch(written, errors): void`.
- Produces, block definitions: optional `sketchOnly: true`.

- [ ] **Step 1: Write failing tests** in `sketch-validate.test.mjs`. Each asserts an exact error path and that the message lists what is allowed:
  - `style accepts standard and sketch at root and scene; a scene overrides the root`.
  - `a chart, image, video, lottie, code or counter in a sketch scene is an error pointing to a standard scene`.
  - `a standard block in a sketch scene, and a sketch block in a standard scene, are errors`.
  - `keyframes, typing, role, exit, scale and rotate on an element in a sketch scene, and camera on the scene, are errors`; `opacity and hold stay valid`.
  - `an element or block named in a standard scene is unaffected`: an existing example validates unchanged.
  - `a sketch scene in a viral spec is an error`.
  - `sketch.hand.tone outside the five names, sketch.hand.scale outside 0.5 to 1.2, sketch.pace outside 0.5 to 2 are errors`.
  - `an unknown icon name has a did-you-mean`: `icon "sever"` suggests `server`.
  - **Review Focus 1:** `handwritten text with a character the font lacks is an error naming it`: `"Ship it 🚀"` gives `scenes[0].elements[0].text: "🚀" is not in the handwriting font; remove it or use a standard scene`. `"Café résumé"` is valid.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write `vendor-sketch-assets.mjs` and run it** with the throwaway venv form in `bin/font-metrics.py:5-7` for metrics. Sources: `@fontsource/caveat@5.3.0` and `lucide-static@1.69.0`, already in `.scratch/sketch-spike/node_modules`. Copy both licence texts into `LICENSES`. Dropped alias icons are fine. Report the size of `lucide.mjs`.
- [ ] **Step 4: Implement schema additions and `checkSketch`.** Call it from `validateSpec` on the written spec. Additions: root and scene `style`; root `sketch` (`hand: { tone, scale }`, `seed` integer, `pace`); element type `icon` (`name`, `size`, `color?`); `drawAt` on elements in a sketch scene (a number, or the string `"sentence:<n>"`, resolved in Task 12); `"fill": "scribble"` on a shape in a sketch scene, as an exception to `checkColor`.
- [ ] **Step 5: Write `sketch-icons.mjs search <word>` and `list`,** rejecting unknown arguments, with tests in `sketch-icons.test.mjs`: `search server finds server`; `unknown flag exits 2 listing accepted ones`.
- [ ] **Step 6: Run both test files and the full `validate.test.mjs`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(make-motion): sketch style field, assets and refusals`.

### Task 9: Stroke plan

**Files:**
- Create: `<skill>/template/sketch/geometry.mjs`, `plan.mjs`, `timing.mjs`
- Modify: `<skill>/scripts/lib/spec.mjs` (required-duration error)
- Test: new `<skill>/test/sketch-plan.test.mjs`

**Interfaces:**
- Consumes: `caveat-metrics.mjs`, `lucide.mjs`, `isSketchScene`.
- Produces:
  - `planScene(scene, ctx): ScenePlan`, where `ctx = { size, seed, pace, icons, sceneIndex, startAfter }` and `startAfter` is seconds reserved by a transition.
  - `ScenePlan = { strokes: Stroke[], elements: Map<path, ElementPlan>, drawEnd: number, needs: number, problems: [{ path, message }] }`.
  - `Stroke = { path, kind: 'line'|'write'|'fill', points: [x,y][], lengths: number[], total: number, color, width, opacity, t0, t1, layer: 'under'|'ink' }`, in canvas pixels.
  - `ElementPlan = { box: { x, y, width, height }, t0, t1, glyphs?: [{ char, x, y }], fontSize? }`.
  - `pointAt(stroke, progress): [x, y]`, binary search, no DOM.

Values, all at 1080 on the short side and scaled by `unit(size)`, come from the approved spike (`.scratch/sketch-spike/spike.html`):

| What | Value |
|---|---|
| Line speed | 2700 px/s |
| Writing | 22 characters/s |
| Icon speed | 2000 px/s |
| Fill speed | 9000 px/s |
| Hand travel | `min(0.3, 0.04 + dist / 3600)` s |
| Hand entry and exit | from and to the lower right, off canvas; `HAND_EXIT = 0.65` s |
| Box stroke | amp 2.6, wave 110, width 5.5, closing overshoot 16 |
| Arrow | amp 1.3, wave 60, width 5.5, head 30 |
| Icon | amp 1.1, wave 45, width 4.5, scale `size / 24` |
| Scribble fill | gap 34, width 20, opacity 0.17, amp 3, wave 60 |
| Writing mask | width `0.42 × fontSize`, band `y - 0.62 fs` to `y + 0.14 fs`, 3 sweeps per glyph |

- [ ] **Step 1: Write failing tests:**
  - `the same scene and seed give the same plan, deepEqual`.
  - `inserting an element does not change another element's wobble`: seeded from `sketch.seed` and element `id`.
  - `elements draw in document order, with no overlap between strokes`.
  - `pace 2 halves stroke durations`.
  - `glyph x positions come from the metrics table`: `"AV"` matches the advance sum, with no kerning.
  - `text wraps at maxWidth and stays inside its box`.
  - `a group's children are planned in canvas coordinates`.
  - `drawAt delays an element; earlier ones are unaffected`.
  - `pointAt at 0 and 1 returns the first and last points`.
  - `a 1080x1920 canvas scales speeds and widths by the short side`.
  - **Review Focus 5:** `needs equals drawEnd + HAND_EXIT`; `a scene shorter than needs is a validation error with the seconds`: `scenes[0]: this drawing needs a scene of at least 14.2s`, under a block's `params.nodes` when the block is the last element.
- [ ] **Step 2: Run them.** Expected: FAIL with module not found.
- [ ] **Step 3: Implement.** Pure: no DOM, no `Math.random`, no imports from Node. The `icon` element takes `name`, `size` and optional `color`. `fill: "scribble"` on a shape emits a `fill` stroke in the `under` layer before its outline.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-motion): pure stroke plan for sketch scenes`.

### Task 10: Drawing on the page, and the hand

**Files:**
- Create: `<skill>/template/sketch/view.mjs`, `hand.mjs`
- Modify: `<skill>/template/renderer.mjs` (`buildElement:283`, `buildStage:449`, `makeApply:586`, `loadFonts:522`), `<skill>/template/defaults.mjs` (a sketch scene's `background` defaults to the board)
- Test: new `<skill>/test/sketch-render.test.mjs`; extend `<skill>/test/determinism.test.mjs`, `<skill>/test/workers.test.mjs`

**Interfaces:**
- Consumes: `planScene`, `pointAt`, `ElementPlan`.
- Produces:
  - `handSvg({ tone, scale, unit }): SVGElement`, with `id="sketch-hand"`, pencil tip at the origin.
  - `handPose(plan, sec): { x, y, lift, visible }`.
  - `mountDrawn(part, el, elementPlan, strokes, look): void`.
  - `applyDrawn(part, sec): void`.

**Decisions the DOM must honour:**
- Each drawn element keeps its `.el` node with `data-id`, `data-path` and a box from `ElementPlan.box`, because `check.mjs:139` reads those. Inside it, one SVG holds that element's strokes in local coordinates.
- Written text is SVG `<text>` with an explicit per-glyph `x` list and `font-kerning: none`, masked by the zig-zag stroke, so the page matches the plan without measuring. The node also carries the plain text in `textContent` for the audits.
- `node.dataset.reveal` holds progress (`'0'` before start, so `check.mjs:156` treats it as undrawn; it also feeds the change signature at `check.mjs:164`).
- The hand is one SVG appended to `#stage` above scenes and below captions, from `buildHand` in `.scratch/sketch-spike/spike.html`, inner scale 0.5 replaced by `HAND_BASE_SCALE = 0.4 × hand.scale × unit(size)`. Clean the lower-finger line ends and the wrist edge. Tones map to fills, `medium = #eec39d`, with a shade per tone.
- CSS tokens and `look` are overridden on the sketch scene's layer only.

- [ ] **Step 1: Write failing tests**, gated like other render tests with `requireRender`:
  - `a sketch spec renders byte-identically twice`, and with `--workers 4` (extend the determinism and workers tests).
  - `written text is hidden at its t0 and fully shown at t1`: pixels in the text box.
  - `the hand tip sits on the stroke's point at time t, within 1 px`.
  - `the hand is off canvas at scene start before entry and after exit`.
  - `the page loads lucide.mjs only when the spec has a sketch scene`: request log on a standard spec.
  - **Review Focus 3:** `with --theme poster a mixed film's standard scene uses poster and its sketch scene keeps #fdfcf8`: sample both backgrounds.
  - **Review Focus 4:** `--batch with {{name}} in handwritten text renders each row with its own text`.
  - `a standard example's frame is byte-identical to the base commit`: read the hash from `.scratch/baseline/base.json` when present, else skip.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Compute plans once at build time, then look up per frame. No `getPointAtLength` at runtime. Add `@font-face` for `/template/sketch/caveat-700.woff2` and wait for it in `loadFonts` when `specHasSketch`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Measure frame cost.** Render a dense sketch scene (10 written lines, 6 boxes, 6 icons) at 1080p with `--workers 1` and record ms per frame for the PR body. If it is over 250 ms per frame, stop and report: the mask approach needs another look.
- [ ] **Step 6: View a result.** Write the spike's scene as a spec in `.scratch/`, render it through `render.mjs`, extract frames, read them, and compare with `.scratch/sketch-spike/D-photo-traced-grip.mp4`. The owner approved that look, apart from the smaller hand.
- [ ] **Step 7: Commit** `feat(make-motion): draw sketch scenes with an illustrated hand`.

### Task 11: Audits

**Files:**
- Modify: `<skill>/scripts/check.mjs` (`spansOf` near `:103`, `backdropColors` call), `<skill>/scripts/lib/audits.mjs` (`stillStretches:355`)
- Test: `<skill>/test/check.test.mjs`, `<skill>/test/audits.test.mjs`

**Interfaces:**
- Consumes: `planScene` (for spans), `#sketch-hand`.

- [ ] **Step 1: Write failing tests,** each seeing the bad input caught first:
  - `the hand over text does not change the contrast finding`: same result as with the hand removed.
  - `the hand overlapping a label is not an overlap problem`.
  - `two labels overlapping after they finish are an overlap problem`.
  - `a text being written is not judged until t1, and reading time counts from t1`.
  - `drawing in progress counts as change`: no dead stretch across a 6 s drawing.
  - `a silent board still for more than 3 s is a dead stretch`.
  - `a board still during narration is exempt`, needing Task 12's `narration`; pass it directly here.
  - `writing unfinished at scene end warns`.
  - `blank frame 0 on a sketch opening warns and mentions --poster`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Hide `#sketch-hand` during pixel sampling; do not loosen a threshold.
- [ ] **Step 4: Run them, plus the full check and audits tests.** Expected: PASS, with no existing test edited.
- [ ] **Step 5: Commit** `feat(make-motion): audits understand sketch scenes`.

### Task 12: Voice sync

**Files:**
- Create: `<skill>/scripts/lib/sketch-voice.mjs`
- Modify: `<skill>/scripts/lib/beats-file.mjs:66` (`resolveSpecBeats` calls it, so all four consumers get it), `<skill>/template/sketch/timing.mjs`, `plan.mjs`, `<skill>/scripts/check.mjs`
- Test: new `<skill>/test/sketch-voice.test.mjs`

**Interfaces:**
- Produces:
  - `resolveSketchVoice(spec, dir): { spec, errors }`: for each sketch scene whose `audio` track has `scene` equal to its id and a sidecar beside `src` (`sidecarPath` in `scripts/lib/voice.mjs`), sets internal `scene.narration = [{ start, end }]` in scene seconds (track `at` plus sentence time), and turns `drawAt: "sentence:<n>"` into `{ sentence: n }`.
  - `assignWindows(items, narration): Array<{ start, end, pinned }>` in `timing.mjs`.
- `validateSpec` rejects a written `narration`; only the resolver sets it.

- [ ] **Step 1: Write failing tests:**
  - `4 elements and 4 sentences: element k gets sentence k`.
  - `2 elements over 5 sentences share the whole narration in proportion to drawing length`.
  - `a block counts as one element and its parts share its window`.
  - `a pinned element splits runs: earlier elements use sentences before it, later ones after it`.
  - `a drawing stretches to fill its window, to half pace at most, then the hand leaves and the board holds`.
  - `a drawing that cannot fit at twice pace reports a problem naming the element and the seconds needed`.
  - `no voice track: natural pace, same plan as without audio`.
  - `a track with no sidecar is not a voice track`.
  - `sentence:9 past the end is an error naming the count`; `sentence:<n> with no voice track is an error`.
  - `a written narration field is an error`.
  - `changing the track's at shifts windows by the same amount`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Fake sidecars in `test/fixtures`, no model needed.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-motion): drawings follow narration sentences`.

### Task 13: Moving between ideas

**Files:**
- Modify: `<skill>/template/transitions.mjs:11,47,72`, `<skill>/template/sketch/hand.mjs`, `plan.mjs`, `<skill>/scripts/lib/sketch-check.mjs`
- Test: `<skill>/test/transitions.test.mjs`, `<skill>/test/sketch-plan.test.mjs`

**Interfaces:**
- Produces: transition name `erase` (default duration 0.8 s), which `normalizeTransition` accepts and `comesInOver` is true for. Add it outside the frozen `TRANSITIONS` list if a test pins that list at nine.

- [ ] **Step 1: Write failing tests:**
  - `erase between two sketch scenes is valid; into or out of a standard scene, or on the first scene, is an error`.
  - `drawing starts after the erase window`: `startAfter` equals the window, and `needs` includes it.
  - `the hand follows the sweep during the window and is off canvas afterwards until it enters to draw`.
  - `push into a sketch scene shows no hand during the window`.
  - `every other existing transition works between a standard scene and a sketch scene`: one render test with `fade`, `push`, `crossfade`.
  - Render test: `erase is byte-identical twice`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `layerStyles` reuses `wipeClip` for the board edge, and the hand travels with that edge.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-motion): erase transition for sketch scenes`.

### Task 14: Sketch blocks

**Files:**
- Create: `<skill>/template/blocks/sketch-diagram.mjs`, `sketch-steps.mjs`, `sketch-list.mjs`, `sketch-compare.mjs`, `sketch-callout.mjs`
- Create: `references/examples/blocks/<name>.json`, `references/blocks/<name>.png` for each
- Modify: `<skill>/template/blocks/index.mjs:32-90`, `<skill>/test/blocks.test.mjs` (its generic loop wraps sketch-only blocks in a sketch scene)
- Test: new `<skill>/test/sketch-blocks.test.mjs`

**Interfaces:**
- Consumes: module shape at `index.mjs:4-20`, with `sketchOnly: true`; part ids `<blockId>/<part>`.
- Produces, params:
  - `sketch-diagram`: `nodes` (2 to 8 of `{ id, label (up to 24), icon?, fill? }`), `edges` (`{ from, to, label? (up to 16) }`), `layout?` (`row`, `column`, `grid`; default `row` on a wide canvas, `column` on a tall one).
  - `sketch-steps`: `steps` (2 to 6, each up to 32).
  - `sketch-list`: `title?` (up to 40), `items` (2 to 6 of `{ text (up to 40), icon? }`).
  - `sketch-compare`: `left`, `right` (each `{ title (up to 24), points (1 to 5, each up to 28) }`).
  - `sketch-callout`: `text` (up to 40), `icon?`, `mark?` (`underline` or `circle`).

- [ ] **Step 1: Write failing tests:**
  - `an edge naming an unknown node is an error listing the node ids`; `a duplicate node id is an error`.
  - `each block expands only to text, shape, icon and group`.
  - `a node with fill draws its scribble before its outline`.
  - `an arrow with a label draws the label after the arrow`.
  - `no text below MIN_TEXT at 1920x1080 at the longest allowed values`.
  - **Review Focus 2:** `sketch-diagram on 9:16 lays out as a column, stays in the safe area, and check.mjs reports no problems`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Layouts size from `caveat-metrics` text widths. Edges connect box edges, not centres, with a slight bow as in the spike.
- [ ] **Step 4: Write the examples, render contact sheets, view them, save golden PNGs.**
- [ ] **Step 5: Run `blocks.test.mjs` and `sketch-blocks.test.mjs`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(make-motion): sketch blocks`.

### Task 15: Starter films and agent discovery

**Files:**
- Create: `<skill>/references/examples/sketch-architecture.json`, `sketch-concept.json`, `sketch-steps.json`, `sketch-mixed.json`, `<skill>/references/sketch.md`
- Modify: `<skill>/SKILL.md` (frontmatter `description`, Intake, Workflow, new "Hand-drawn style" section, Style defaults), `plugins/portable-artifacts/bin/test/intake.test.mjs:19,31`, `plugins/portable-artifacts/eval/prompts/motion.json` (Read and Edit only)
- Test: new `<skill>/test/sketch-examples.test.mjs`, `intake.test.mjs`

**Interfaces:**
- Produces: the report-line tail `style <name>, hand <tone or n/a>`, after `platform <name or none>`.

- [ ] **Step 1: Write failing tests:**
  - `each starter validates, check.mjs reports no problems, and it renders byte-identically twice`.
  - `sketch-mixed has both standard and sketch scenes`.
  - `the description is one line and contains "hand-drawn"`.
  - `intake lists style with standard, hand-drawn and mixed, and hand tone`; `the skipped line carries style and hand`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the four films.** Make `sketch-architecture` the spec's "How a request flows" example, extended to more than one scene with `erase`. `sketch-concept` uses `sketch-list` and `sketch-callout` with `push`.
- [ ] **Step 4: Edit `SKILL.md`,** literal for a cheap model. The prompt words "whiteboard", "hand-drawn", "sketch" or "drawn by hand" set the style without asking. Otherwise intake offers `style` and, if drawn, `hand tone`. The agent proposes a length from the content, with no fixed default, and "stay under 15 s" does not apply to drawn scenes. Storyboard rule unchanged. List what a sketch scene allows, and the starter files. Details go in `references/sketch.md`: spec fields, timing rules, voice sync, tones, icons search, transitions.
- [ ] **Step 5: Add a hand-drawn prompt case to the plugin's eval prompts,** copying the shape of the existing cases.
- [ ] **Step 6: Run them.** Expected: PASS.
- [ ] **Step 7: Prove voice sync on a real film.** With `VOICE_TEST=1` and the model present, narrate `sketch-architecture`, render, extract frames at each sentence start, and read them to confirm the matching element is being drawn. Print `--phonemes` output for the PR body.
- [ ] **Step 8: Commit** `feat(make-motion): starter films and hand-drawn intake`.

---

## Finish

### Task 16: Cross-surface docs, release, and proof

**Files:**
- Modify: `plugins/portable-artifacts/.claude-plugin/plugin.json` (1.2.0), `plugins/portable-artifacts/CHANGELOG.md`, `README.md`, `USAGE.md`, `<skill>/README.md`, `<skill>/references/schema.md`, `<skill>/references/motion-design.md`, `docs/features/portable-artifacts.html`, `docs/skills-catalog.md`, `docs/catalog.html`
- Generated: `.scratch/` test checklist

- [ ] **Step 1: Sweep the block count.** Search `28` near "block" across the plugin and `docs/`, and change to 38. Check `python3 scripts/sweep_counts.py --check`. No skill was added, so skill counts should not move.
- [ ] **Step 2: Write the CHANGELOG entry,** under 1.2.0, with a "Behaviour changes" note that the 120 s cap is gone. State measured figures with their commands.
- [ ] **Step 3: Run the full suites.** `node --test "plugins/portable-artifacts/skills/make-motion/test/**/*.test.mjs"`, `node --test "plugins/portable-artifacts/bin/test/*.test.mjs"`, `python3 -m pytest tests/pytest`, `bats tests/bats`. Expected: all pass. Report exact counts.
- [ ] **Step 4: Compare hashes.** Run `node .scratch/baseline-render.mjs .scratch/baseline/final.json`, then diff against `base.json`. Expected: identical for every original example. Any difference blocks the PR.
- [ ] **Step 5: Check every Part A "done when"** from the spec with a command and its output, for the PR body.
- [ ] **Step 6: Fresh-context review before the first push.** Run `/code-review` on the diff, per `AGENTS.md`. Fix CRITICAL and HIGH with a regression test that failed first.
- [ ] **Step 7: Run the `branch-test-checklist` skill.** Human items: the hand's look and motion in all four starter films, narration sync by ear, a mixed film's cuts, a poster on a real film.
- [ ] **Step 8: Commit, push with `-u`, open the PR.** Body: what shipped, hash comparison, frame cost, known gaps, the follow-up on a recorded CC0 drawing sound, and the checklist path. PR trailer per `AGENTS.md`.
