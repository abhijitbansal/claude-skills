# Inspired by claude-motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the owner-approved claude-motion-inspired changes: a calmer, faster make-diagram story player (icon Play/Pause, progress ring, Bézier edges, wheel no longer pauses), a README with real samples, a make-motion review loop and motion-design reference, and a make-diagram-built architecture page.

**Architecture:** make-diagram's browser runtime (`template/*.js`) gains two story hooks and an icon/ring transport; its renderer (`scripts/lib/edges.mjs`, `render.mjs`) draws Bézier curves over ELK's unchanged orthogonal routes. make-motion gains an in-browser tiled contact sheet and a `check.mjs` gate. Docs tasks consume assets those tasks produce.

**Tech Stack:** Node 20 ESM, `node --test`, ELK (`elkjs@0.12.0`), anime.js 4.5, Playwright 1.64, ffmpeg, bats, pytest. Zero new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-inspired-by-claude-motion-design.md` (read it first; it holds the reasons, the verified file:line facts and the owner decisions D1–D6).

## Global Constraints

- Skills stay Haiku-buildable: the model writes JSON; scripts do geometry, CSS, HTML. No new root spec field for curves (no `lines`).
- Generated pages stay offline under the strict CSP: no CDN, no `eval`.
- Same spec, same output: no `Math.random`/`Date` in render paths; do not change MP4 bytes except where a task says so.
- Every change under `plugins/portable-artifacts/**` ships with a `.claude-plugin/plugin.json` version bump (CI job `plugin-bump`). First PR: `0.5.0`→`0.6.0`; each later PR bumps the patch after rebasing. Renumber on conflict.
- `SKILL.md` descriptions stay one line (registry parser). New/removed skill dirs: none in this plan, so no `sweep_counts.py --write` except Task 11.
- Site/doc pages that list commands keep per-line copy buttons with no `# comment` in `data-copy`.
- Time is never estimated in hours or days; report code surface and verification only.
- UI work is not done until it was driven in a browser and a screenshot was viewed.
- Guardrails (new tests/checks) must be shown failing (RED) before the code that satisfies them.
- Implementers do **not** commit or push; the controller commits at each task's Commit step with the attribution trailers the session specifies. Reviewers report only.
- Setup once per skill folder before its tests: `npm ci` there. Browser tests need `npx playwright install chromium`; if unavailable they skip, so say so in the report.

## Review Focus

- **Ring while nothing plays:** manual Next/Prev/scrub/chip while paused must never start or leave a ring (Task 3).
- **Ring survives repaint:** speed change, loop toggle and `paint()` mid-hold must not erase or restart it (Task 4).
- **Last beat, loop off:** no ring on a hold that ends in a stop (Task 4).
- **Reduced motion:** no animation, but a visible time-left cue (Task 4).
- **Curves vs labels and nodes:** the label plate sits on the curve midpoint and overlaps no node box; no curve sample enters a node box (Task 5).
- **Self loops and sequence messages** keep today's drawing (Task 5).
- **Caption hold floor:** a 160-character caption still holds long enough to read after speeding up (Task 1).
- **check.mjs false positives:** every bundled example spec passes it (Task 9).

---

## PR A — make-diagram story player (Tasks 1–4)

Branch `feat/diagram-player`. Working dir for tests: `plugins/portable-artifacts/skills/make-diagram`, plus make-explainer for Task 2.

### Task 1: Faster playback and wheel no longer pauses

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/story.js:20-23` (constants), `template/viewer.js:282-288` (wheel handler)
- Test: `test/story-unit.test.mjs:76-125` (pinned ms), `test/story-browser.test.mjs:384-397`

**Interfaces:**
- Produces: story constants `GLIDE_MS = 450`, `DOT_MS = 900`, `HOLD_MS = 1800`, `HOLD_PER_CHAR_MS = 30`, `HOLD_MAX_MS = 4500`. `SPEEDS` unchanged.

- [ ] **Step 1: Write failing tests.** In `story-unit.test.mjs`: change the pinned `600` glide expectations to `450` and add `'a 160-character caption holds 1800 + 30*160 = 4500 ms at 1x, divided by the speed'` asserting `holdMs` via the timer the story arms. In `story-browser.test.mjs` replace "the wheel pauses" with two tests: `'press and drag on the canvas pause playback'` (keep the old assertions) and `'the wheel zooms and playback keeps running'` (`await page.mouse.wheel(0, 120)`; assert `playing(page) === true` and the camera zoom changed).
- [ ] **Step 2: Run to verify RED:** `npm test -- test/story-unit.test.mjs test/story-browser.test.mjs` → FAIL on 600/450 and on the wheel test.
- [ ] **Step 3: Implement.** Set the five constants. Delete `story.pause();` in the wheel handler only; leave pointerdown (`viewer.js:224`) and keys untouched. Update the comment above `HOLD_*` if it states numbers.
- [ ] **Step 4: Run to verify GREEN:** same command → PASS.
- [ ] **Step 5: Commit** `feat(make-diagram): faster story pacing; wheel zoom no longer pauses`.

### Task 2: Icon Play/Pause button

**Files:**
- Modify: `make-diagram/template/transport.js:98-99`, `template/viewer.html:176` (+ its CSS), `make-explainer/scripts/lib/render/diagram.mjs:69`, `make-explainer/template/diagram.css`, `make-diagram/scripts/lib/css.mjs` (button sizing)
- Test: `make-diagram/test/transport-unit.test.mjs`, `story-browser.test.mjs`, `explore-browser.test.mjs`, `fullscreen-browser.test.mjs`, `make-explainer/test/diagram.test.mjs`, `diagram-browser.test.mjs`

**Interfaces:**
- Produces (DOM contract, consumed by Task 4): the `[data-pa-play]` button contains one `<span class="pa-playicon" aria-hidden="true">` holding an inline `<svg>` (triangle when paused, two bars when playing, `fill="currentColor"`). Its accessible name is `aria-label` = `"Play"` | `"Pause"`; `title="Play or pause (Space)"` stays. Hit area ≥ 40×40 px. `paint()` swaps the svg's markup via a constant pair `PLAY_SVG`/`PAUSE_SVG` in `transport.js`; it must not assign the button's `textContent`.
- The buttons' static HTML in `viewer.html` and make-explainer carries the paused icon and `aria-label="Play"`, no visible text.

- [ ] **Step 1: Failing tests.** `transport-unit`: extend `fakeEl` with `innerHTML`, `classList` (`add/remove/contains`) and `style`; add `'the play button shows the paused icon and aria-label Play, then the pause icon and Pause when playing'` and `'paint() never writes textContent on the play button'`. In the browser tests replace every read of the button's text `Play`/`Pause` with `getAttribute('aria-label')`. Add one make-explainer assertion that the overlay's button has the same contract.
- [ ] **Step 2: Run RED:** `npm test -- test/transport-unit.test.mjs` (make-diagram) and `npm test -- test/diagram.test.mjs` (make-explainer) → FAIL.
- [ ] **Step 3: Implement** the contract above in the three markup places and `transport.js`; style the icon with `currentColor` so all themes and the light/dark toggle work. Prev/Next/chapter buttons stay text (decision D6 open).
- [ ] **Step 4: Run GREEN** for both skills' full suites (`npm test`); then build `references/examples/story.diagram.json` with `scripts/build.mjs --out` into the scratchpad directory the controller names, open it, screenshot the Play and Pause states in dusk dark and paper light, and view the screenshots.
- [ ] **Step 5: Commit** `feat(make-diagram): real play/pause icon button`.

### Task 3: Story hold hooks (`onHold`, `onHoldEnd`)

**Files:**
- Modify: `make-diagram/template/story.js:226-245,204-209,313-319` (hold closure, `cancelRun`, `pause`), `template/viewer.js:80-83` (forward hooks)
- Test: `test/story-unit.test.mjs`

**Interfaces:**
- Consumes: `hooks.onHold`, `hooks.onHoldEnd` (optional functions) passed as the sixth argument of `PADiagram.story(stage, svg, data, els, camera, hooks)`.
- Produces: `hooks.onHold(ms: number)` fires **once per hold, only while `playing` is true**, with the exact `holdMs(beat)` value (already divided by speed). `hooks.onHoldEnd()` fires when that hold ends for any reason: it advanced, `cancelRun()` ran (goTo/pause/exit), or it expired without advancing (last beat, loop off). Neither fires for a hold armed while paused.

- [ ] **Step 1: Failing tests** (fake-clock harness already in the file): `'play fires onHold once with 1800+30*chars divided by speed'`; `'speed 2x halves the reported ms'`; `'pause during a hold fires onHoldEnd before anything else'`; `'goTo during a hold fires onHoldEnd then onHold for the new beat'`; `'goTo while paused fires neither hook'`; `'the last beat with loop off fires onHold then onHoldEnd when the hold expires'`.
- [ ] **Step 2: RED:** `npm test -- test/story-unit.test.mjs`.
- [ ] **Step 3: Implement.** In `hold` call `hooks.onHold(ms)` only if `playing`; track an `inHold` flag so `onHoldEnd` fires exactly once from the hold callback and from `cancelRun()`. In `viewer.js` pass `onHold: function (ms) { transport.hold(ms); }` and `onHoldEnd: function () { transport.holdEnd(); }` (functions defined in Task 4; until then define no-op stubs on the transport object so this task is self-contained and tested with a spy).
- [ ] **Step 4: GREEN:** full `npm test` in make-diagram.
- [ ] **Step 5: Commit** `feat(make-diagram): story reports hold start and end`.

### Task 4: Progress ring on the control that fires next

**Files:**
- Modify: `make-diagram/template/transport.js`, `scripts/lib/css.mjs:~125` (inside the existing `prefers-reduced-motion: no-preference` block), `template/viewer.html` CSS, `make-explainer/template/diagram.css`
- Test: `test/transport-unit.test.mjs`, `test/story-browser.test.mjs`, make-explainer `test/diagram-browser.test.mjs`

**Interfaces:**
- Consumes: Task 3 hooks; Task 2 play-icon contract.
- Produces: `transport.hold(ms: number): void` and `transport.holdEnd(): void` on the object returned by `PADiagram.transport(...)`. The transport itself creates one `<span class="pa-ring" aria-hidden="true">` (an SVG circle with `stroke-dasharray`) as a child of `[data-pa-next]`; on the last beat with `story.loop()` true it lives in `[data-pa-play]` instead; on the last beat with loop off there is no ring. It re-parents only when the target changes. The fill uses WAAPI `el.animate(...)` with an explicit `cancel()` (not class toggling) over `ms` linear. Under reduced motion `hold(ms)` shows a static ring at half fill (a visible "advancing" cue, no animation). `paint()` never restarts a running ring.

- [ ] **Step 1: Failing tests.** transport-unit: `'hold(ms) creates a ring under data-pa-next and animates over ms'`, `'the ring survives paint() and a speed change mid-hold'`, `'last beat, loop on: ring moves to data-pa-play'`, `'last beat, loop off: no ring'`, `'holdEnd removes the animation'`. story-browser: ring visible while playing, absent after pause and in Explore, static half-fill under `page.emulateMedia({ reducedMotion: 'reduce' })`. make-explainer browser test: the overlay's Next button gets a ring while playing.
- [ ] **Step 2: RED**, **Step 3: Implement**, **Step 4: GREEN** (both skills' full `npm test`), then screenshot a playing story mid-hold in dusk dark and paper light and view it.
- [ ] **Step 5: Bump** `plugins/portable-artifacts/.claude-plugin/plugin.json` to `0.6.0`; update `make-diagram/SKILL.md`/`README.md` only where they describe Play/Pause text or the hold timing; run `docs.test.mjs`. **Commit** `feat(make-diagram): hold-progress ring`.

---

## PR B — Bézier edges (Tasks 5–6)

Branch `feat/diagram-bezier`.

### Task 5: Bézier routes

**Files:**
- Modify: `make-diagram/scripts/lib/edges.mjs` (add `curvedRoute`), `scripts/lib/render.mjs:46,51` (use it, move plates), keep `render-sequence.mjs:59` on `roundedPath`
- Test: `test/edges.test.mjs`, `test/render.test.mjs` (`pathPoints` gains `C`), regenerated `test/golden/*.svg`

**Interfaces:**
- Produces in `edges.mjs`: `export function curvedRoute(points: {x:number,y:number}[]): { d: string, mid: {x:number,y:number} }` and `export const FALLBACK_CORNER_RADIUS = 24`. Rules on the anchored, repeat-free polyline: 1 segment → `M..L..`; 2 segments (L) → one cubic `M p0 C c1 c2 p2` with `c1 = p0+(p1-p0)·0.6`, `c2 = p2+(p1-p2)·0.6`; 3 segments (Z) → one cubic with control points exactly the two inner corners `p1`, `p2` (hull stays inside the layer channel); ≥4 segments → `roundedPath(points, FALLBACK_CORNER_RADIUS)` and `mid` = point at half the polyline length. `mid` for a cubic = the curve at t = 0.5. End tangents equal the first/last segment directions (arrow markers keep working).
- `render.mjs` `renderGraph`: `d` and the plate come from `curvedRoute`; the plate box is re-centred on `mid` (`x = mid.x - w/2`, `y = mid.y - h/2`). Self-loops (4-point `widenSelfLoop` routes) and sequence messages keep `roundedPath` with radius 6.

- [ ] **Step 1: Failing tests** in `edges.test.mjs`: `curvedRoute` of an L, a Z, a straight line and a 5-point route returns exactly the path strings above (write the expected strings from the formulas for `[{0,0},{40,0},{40,40}]` and `[{0,0},{0,30},{50,30},{50,60}]`); `'a Z curve stays inside the polyline bounding box'`; `'mid of a symmetric Z is its centre'`. In `render.test.mjs`: update `pathPoints` to read `C` (end point = last pair); add `'no sampled curve point of any example enters a node box'` (sample each wire's path with 40 points via the `C`/`Q` math over all four graph examples) and `'each edge label plate is centred on its curve midpoint and overlaps no node box'`; add `'edges between the same two layers do not share a sampled point in their middle 60%'`, run over every example. Update the pinned `Q` strings in `edges.test.mjs:155-156` only for `roundedPath` callers that remain.
- [ ] **Step 2: RED:** `npm test -- test/edges.test.mjs test/render.test.mjs`.
- [ ] **Step 3: Implement** per Interfaces. **If the parallel-edge or node-box test fails on an example, stop and report BLOCKED with the example name and the offending edges; do not invent a mitigation** (the controller decides the fallback with the owner).
- [ ] **Step 4: Regenerate goldens:** `PA_WRITE_GOLDEN=1 npm test -- test/render.test.mjs test/layout-graph.test.mjs`, then run the full suite without the env var. `layout-graph.test.mjs:77` (orthogonality) must stay GREEN untouched. Build `references/examples/architecture.diagram.json` and `flow.diagram.json` in dusk and paper, screenshot at desktop and 390 px width and view them.
- [ ] **Step 5: Commit** `feat(make-diagram): Bézier edges (goldens regenerated on purpose)`. Run make-explainer's `npm test` (it embeds diagrams) in the same step.

### Task 6: Regenerate gallery diagrams and thumbnails

**Files:**
- Modify: `docs/features/showcase/portable-artifacts/gallery/{delivery-diagram,incident-flow,oauth-sequence,pipeline-diagram}/**` (the three theme variants of each: their `diagram.json` sits beside the page), and each `thumb.jpg`; leave `docs/features/showcase/cache-clock/**` alone (built by archify).
- Test: `tests/bats/` showcase guards already in the repo.

- [ ] **Step 1:** For each gallery dir, rebuild with `node plugins/portable-artifacts/skills/make-diagram/scripts/build.mjs <dir>/<name>.json --out <dir>/index.html --theme <dusk|press|poster>` (use the exact flags each dir's existing build note records; read them first). Pin `SOURCE_DATE_EPOCH` to the existing page's embedded date so diffs show only drawing changes.
- [ ] **Step 2:** Regenerate each `thumb.jpg` at its current size with Playwright (`check.mjs --json` already boots the page; screenshot at 1280×720), keeping filenames and dimensions (`width="1280" height="720"` is hard-coded in `docs/features/portable-artifacts.html`).
- [ ] **Step 3: Verify:** `bats tests/bats` and view three thumbs. **Step 4: Commit** `docs: rebuild gallery diagrams with Bézier edges`.

---

## PR C — README samples (Task 7)

Branch `docs/readme-samples`. Land after PR B so the diagram tile shows the new look.

### Task 7: Hero, sample row, prompt blocks, asset guard

**Files:**
- Create: `docs/features/img/portable-artifacts/launch-announcement.gif`, `docs/features/img/portable-artifacts/diagram-story.gif`, `tests/bats/readme-assets.bats`
- Modify: `README.md` (insert between the intro paragraph and the plugin table; leave the rest)

**Interfaces:** none consumed from code tasks except the built story page from Task 5/6.

- [ ] **Step 1: Failing guard.** `tests/bats/readme-assets.bats`: `@test "every docs/features/img path in README.md exists"` extracts each `docs/features/img/...` path with `grep -o` and `[ -f ]`s it. Add the README hunk first referencing the two not-yet-made GIFs. Run `bats tests/bats/readme-assets.bats` → RED.
- [ ] **Step 2: Make the GIFs** (record the exact ffmpeg commands in the PR body; no new flag). Hero: `ffmpeg` palettegen/paletteuse from `docs/features/showcase/portable-artifacts/gallery/launch-announcement/video.mp4`, 640 px wide, 12 fps, loop. Diagram tile: Playwright records the architecture example story playing at 960×600, converted to a GIF ≤ 500 KB. View both.
- [ ] **Step 3: Write the hunk.** Hero image with the caption "Made by an agent from this prompt with `/make-motion`: JSON in, MP4 out, offline." followed by the **first** prompt from `launch-announcement/prompt.txt` only (the file also holds a voiceover follow-up and the GIF is silent). Alt text describes what is on screen (title, counter, end card), not narration. Name the model only if `docs/features/portable-artifacts.html` says so. Row of three: `diagram-story.gif`, `docs/features/img/portable-artifacts/growth-dashboard.jpg`, `docs/features/showcase/portable-artifacts/gallery/explainer-deck/thumb.jpg`, each linked to its Pages URL (`https://abhijitbansal.github.io/claude-skills/features/...`). Two fenced `text` prompt blocks: the launch prompt (clip) and `growth-dashboard.prompt.txt` verbatim (dashboard). One sentence of lead-in each; install line `/plugin install portable-artifacts@claude-skills`.
- [ ] **Step 4: GREEN:** `bats tests/bats`. Push the branch and view the README on github.com (controller step) to confirm the images render. **Step 5: Commit** `docs: README hero, samples and prompt blocks`.

---

## PR D — make-motion review loop (Tasks 8–9)

Branch `feat/motion-review-loop`. Working dir `plugins/portable-artifacts/skills/make-motion`.

### Task 8: Tiled, timestamped contact sheets

**Files:**
- Modify: `scripts/render.mjs:147-155` (`renderContactSheets`), `template/renderer.mjs` (timestamp overlay in contact mode only), `scripts/lib/sheet.mjs` **(create)**
- Test: `test/render-smoke.test.mjs:165-192`, `test/render-flags.test.mjs`, new `test/sheet.test.mjs`

**Interfaces:**
- Produces in `scripts/lib/sheet.mjs`: `export function sheetTimes(scene: {duration:number, elements:object[]}): number[]` — scene-local seconds, sorted, deduped to 0.05 s: `0.1`, each element keyframe `t + 0.1` (capped at `duration - 1/fps`), `0.85 × duration`, and `duration - 1/fps`; and `export async function tileSheet(browser, tiles: {png: Buffer, label: string}[]): Promise<Buffer>` which lays the tiles out as a data-URL `<img>` grid in a second Chromium page and returns one PNG (no ffmpeg; `render-smoke` runs with `PATH=/nonexistent`).
- The existing per-scene file name `out/contact/<scene-id>.png` and the printed `<dir>` + `N contact sheet(s)` lines stay. The page exposes `window.__motion.seek(s)` already; contact mode adds a fixed overlay element `[data-sheet-stamp]` showing `scene-id · 1.20s`. A 360 px-wide downscaled copy of the last frame is added as the final tile (phone readability).

- [ ] **Step 1: Failing tests:** `sheet.test.mjs` pins `sheetTimes` for a 4 s scene with keyframes at 0 and 0.6 and for a 1 s scene (dedupe, cap, order); `render-smoke`: sheet PNG has more than one tile (width > scene width) and the MP4 render of the same spec is byte-identical with and without this change (assert the overlay element is absent outside contact mode).
- [ ] **Step 2: RED**, **Step 3: Implement**, **Step 4: GREEN** (`npm test`; existing `nonBackgroundRatio` thresholds may need adjusting, state any change), then view a sheet for `references/examples/how-it-works.json`.
- [ ] **Step 5: Commit** `feat(make-motion): tiled timestamped contact sheets`.

### Task 9: `check.mjs`, SKILL step, CI

**Files:**
- Create: `scripts/check.mjs`, `test/check.test.mjs`
- Modify: `SKILL.md` (step 4), `scripts/doctor.mjs` (`--for check`), `.github/workflows/test.yml:85-87`, `.claude-plugin/plugin.json`

**Interfaces:**
- Produces: `node scripts/check.mjs <motion.json> [--json]`; exit 0 clean, 1 findings, 2 usage; skips cleanly (exit 0, prints `skipped: no browser`) without Playwright. Findings, each `scenes[i].elements[j]: <message>`: text outside the safe area (60 px at 1080 wide, scaled by `size[0]/1080`) at any sheet time; two visible `text` boxes overlapping at the same sheet time; a scene whose elements all have opacity 0 at its last frame. **No frame-0 rule.**

- [ ] **Step 1: RED fixtures:** `test/fixtures/bad-safe-area.json` (title `y: 10` at 1080p), `bad-empty-end.json` (everything fades to 0), `bad-overlap.json`. Test asserts exit 1 and the exact message for each; and `'every spec in references/examples passes with exit 0'` (RED until the rule set is right).
- [ ] **Step 2: RED run**, **Step 3: Implement** (reuse `startServer`, `launchBrowser`, `sheetTimes` from Task 8), **Step 4: GREEN**.
- [ ] **Step 5:** SKILL.md step 4 becomes "open each contact sheet tile, then run `node <skill-dir>/scripts/check.mjs motion.json`"; `doctor --for check` mirrors make-diagram's; CI step for make-motion adds `npx playwright install --with-deps chromium` (decision D5, default yes). Bump plugin patch version. **Commit** `feat(make-motion): check.mjs gate and review step`.

---

## PR E — motion-design reference (Task 10)

Branch `feat/motion-taste`.

### Task 10: Reference doc, named eases, opt-in exits

**Files:**
- Create: `make-motion/references/motion-design.md`
- Modify: `template/timeline.mjs`, `scripts/lib/spec.mjs` (ease enum), `references/schema.md:60`, `SKILL.md` (Eases line, link to the reference), `template/defaults.mjs`
- Test: `test/timeline.test.mjs`, `test/presets.test.mjs`, `test/validate.test.mjs`

**Interfaces:**
- New ease names accepted by validate and the renderer: `enter` = `cubicBezier(0.16, 1, 0.3, 1)`, `exit` = `(0.6, 0, 0.9, 0.35)`, `move` = `(0.65, 0, 0.35, 1)`, `land` = `(0.55, 0, 0.2, 1.12)`. They must be **functions** from `import { cubicBezier } from 'animejs'` (a `'cubicBezier(...)'` string is silently linear in anime 4.5). Confirm the browser bundle `/vendor/animejs/anime.esm.js` exports `cubicBezier` and that `land`'s overshoot is not clamped, with a test that samples the eased value at 0.8 and expects > 1.
- Exit preset: element property `"exit": true` on a `role:"title"` text with no author keyframes adds the theme's exit over the last `PRESET_SECONDS/2`, starting no earlier than `0.9 × scene.duration`, and never on the last scene. Author keyframes win entirely. Default is off.

- [ ] **Step 1: Failing tests:** validate accepts the four names and rejects `enterr` with a did-you-mean; `timeline` shows `land` exceeds 1 mid-way and `enter` is not linear (sample 0.25 → value ≠ 0.25); presets: `exit:true` adds an exit that starts ≥ `0.9×duration`, not on the last scene, not when author keyframes exist; without `exit` output is unchanged (golden frames in `theme-render.test.mjs` stay GREEN).
- [ ] **Step 2: RED**, **Step 3: Implement**, **Step 4: GREEN** (full `npm test`).
- [ ] **Step 5: Write `motion-design.md`** (paraphrased from claude-motion, one credit line "Timing numbers adapted from whaleyxbt/claude-motion, MIT"): entrance 0.6–0.9 s `enter`; exit about half, `exit`; stagger 0.09 s per word, 0.2–0.25 s per item; hold ≥ 1 s + 0.25 s per word beyond three and ≥ 2 s on the closing frame; safe area 60 px at 1080 wide; one accent colour; linear only for continuous motion; one hero moment. Do not claim anything is enforced beyond what `check.mjs` checks. Bump the plugin patch version. **Commit** `feat(make-motion): motion-design reference, named eases, opt-in exits`.

---

## PR F — architecture page (Task 11)

Branch `docs/architecture-make-diagram`. **Start only after `feat/make-scene` has merged to main**; rebase onto it first (it edits `docs/architecture.html` l.107/292).

### Task 11: Rebuild `docs/architecture.html` with make-diagram

**Files:**
- Create: `docs/architecture.diagram.json`, `docs/architecture-diagram.html` (built output)
- Modify: `docs/architecture.html` (replace the Mermaid `<pre>` block and its `<script type="module">`; drop `https://cdn.jsdelivr.net` from this page's CSP only if nothing else on the page needs it), `scripts/sweep_counts.py:68-72` (remove the five architecture.html Mermaid SITES), `AGENTS.md:57`, `docs/architecture.md` (build command note)
- Test: `tests/pytest/test_sweep_counts.py`, `tests/bats/onboarding-showcase.bats`

**Interfaces:** consumes the built make-diagram from PRs A–B.

- [ ] **Step 1: Failing guard:** add a pytest `test_architecture_diagram_spec_is_valid` that runs `node …/make-diagram/scripts/validate.mjs docs/architecture.diagram.json` (skip when Node is absent) and a bats check that `docs/architecture.html` contains an `<iframe` pointing at `architecture-diagram.html` with a `title` attribute and no `mermaid` reference. RED.
- [ ] **Step 2: Write the spec:** `type: architecture`, `direction: down`, groups Plugins / Tools / Entry points, nodes and edges mirroring the Mermaid, plugin names only (no counts in labels; the cards below keep counts), one story of 5–6 beats ending in a `focus` over everything, `autoplay: false`.
- [ ] **Step 3: Build:** `SOURCE_DATE_EPOCH=<fixed> node plugins/portable-artifacts/skills/make-diagram/scripts/build.mjs docs/architecture.diagram.json --out docs/architecture-diagram.html --theme dusk`; then `check.mjs` on it. Iframe in `.diagram-shell` with `title="Repository architecture diagram"`, `allow="fullscreen"`, `min-height: 560px`, `width: 100%`, plus a visible "open full page" link. Keep the page footer (it is in `_FOOTER_FILES`) and `assets/site.css`.
- [ ] **Step 4: Fix counts:** remove the five SITES in the same commit, edit `AGENTS.md:57` ("counts live in mermaid labels" → counts live in the cards), run `python3 scripts/sweep_counts.py --check`, `uv tool run pytest tests/pytest -q`, `bats tests/bats`. No byte-for-byte rebuild test; add a warning-only note in `docs/architecture.md` giving the build command. View screenshots at 1440 and 390 px.
- [ ] **Step 5: Commit** `docs: architecture page built with make-diagram`.

---

## Self-review

- **Spec coverage:** P1 → Tasks 1–4 (pacing, wheel, icons, hooks, ring, reduced motion, last beat); P2 → 5–6 (Bézier, tests, gallery + thumbs, cache-clock left alone); P3 → 7; P4 → 8–9 (tiling in-browser, stamp in contact mode only, 360 px tile, check.mjs without frame-0, CI D5); P5 → 10 (named eases as functions, browser bundle check, opt-in exits after 0.9×, no hold lint); P6 → 11. Spec items intentionally not built: hold lint, `--gif` flag, beat sheet, `lines` field, rebuild-equals-committed test.
- **Open before Task 5 executes:** the parallel-edge outcome (BLOCKED path) and D6 (icons for Prev/Next). Open before Task 9: D5.
- **Dispatch:** executors Sonnet 5, high; one fresh Opus 5 reviewer per PR at medium with the report-everything sentence, report only; Task 5 geometry and Task 11 sweep change also get one fresh planner-tier verify.
