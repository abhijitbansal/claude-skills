# Inspired by claude-motion — Design and plan

*2026-10-19 · branch `worktree-inspiration-to-motion` · status: decisions D1–D4 answered by the owner (see the end); awaiting approval of this document before any build*

Source studied: [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT, Remotion
toolkit; four skills: motion-design, review-loop, sound-design, web-sims). We adopt ideas and numbers,
paraphrased, with one credit line. No code or prose is copied. Zero new npm dependencies.

Consulted before this draft: a Fable 5.1 planner (ran two throwaway spikes against `elkjs@0.12.0` and
`animejs@4.5.0`) and a fresh-context Opus 5.5 adversarial review that checked the plan against the files.
Where they disagreed, the Opus finding won because it was checked against code. Corrections are folded in.

## Why

1. The README has no picture. claude-motion opens with a hero clip, a row of samples and copy-paste prompts.
   We already own the assets and the tools that make them.
2. Our skills are Haiku-buildable JSON writers that cannot see their own output. claude-motion's best idea is
   making the agent look at frames before saying done.
3. The owner wants diagrams that feel hand-drawn (curved lines) and a visible cue before the story moves on.

## Goals

- README hero, a row of samples, two prompt blocks, all backed by files in the repo.
- make-diagram: softer, longer curves on edges; a progress ring on the control that fires next while a story plays.
- make-motion: the agent can judge its draft from timestamped contact sheets; a motion-design reference with numbers.

## Non-goals

Remotion, the Python sfx engine, spring presets, film grain/vignette, web-sims (make-scene's lane), effort and MCP tables,
anything dashboard-related. Springs: anime.js springs override segment duration, which breaks fixed-`t` keyframes.
Grain: needs a seeded per-frame PRNG to keep "same spec, same MP4".

## Anti-goals

A guardrail that is red on shipped examples (it gets disabled). A README claim the repo cannot back. Curves that cross
labels or nodes. A ring that animates when nothing is playing.

## Verified facts that shape the plan

- ELK `SPLINES` routing is rejected (spike): nodes are left diagonally, self-loops break, and it fails
  `test/layout-graph.test.mjs:77` and the `edges.mjs` anchoring. Curves are a render-time change to `edges.mjs`.
- Edge labels sit **beside** the wire (`elk.edgeLabels.inline: false`, 6 px gap), so the risk is a corner cut crossing a plate.
- `transport.js:99` sets `play.textContent` on every `paint()`, which deletes any child element inside that button.
- `story.js` arms the hold timer in `show()` even while paused; only the callback checks `playing`.
- `test/render.test.mjs:28-41` parses `M L Q A H V Z` only. Cubic `C` segments break the structural tests.
- `PA_WRITE_GOLDEN=1` already regenerates goldens.
- Mermaid 11's default flowchart curve is probably already `basis` (not rendered to confirm). The Mermaid page has no steps.
- `README.md:98` links "architecture diagram" to the cache-clock page, which is built by archify 3.0.1, not make-diagram.
- `scripts/sweep_counts.py:68-72` anchors five SITES on Mermaid labels in `docs/architecture.html`; pytest runs a live `--check`.
- `feat/make-scene` currently touches `docs/architecture.html` (l.107, l.292), `architecture.md`, `site/*`, the feature page and `test.yml`.
  It does not yet touch `README.md` or `sweep_counts.py`.

## Plan (each phase is one PR and leaves the tree green)

Every phase under `plugins/portable-artifacts/**` bumps `.claude-plugin/plugin.json` (CI job). Bump in merge order, rebase between.

### P1 — Hold-progress ring (make-diagram) · small–medium · risk low–medium

- `story.js`: new hooks `onHold(ms)` and `onHoldEnd()`. Emit **only while playing**; clear when a hold expires without advancing and on `cancelRun()`. Use the exact `holdMs(beat)/speed` value.
- `viewer.js:80-84` forwards the hooks (story is built before transport).
- **Icon Play/Pause button (owner request, added after review).** `data-pa-play` shows an inline SVG: a triangle when paused, two bars when playing, replacing the "Play"/"Pause" text. The accessible name moves to `aria-label` ("Play" / "Pause"), updated in `paint()`, and `title` keeps "Play or pause (Space)". `paint()` swaps the SVG, not `textContent`, which also fixes the ring-erasing bug. Icons use `currentColor` so every theme and the light/dark toggle work, with a hit area of at least 40 px. Same markup change in make-explainer's overlay (`scripts/lib/render/diagram.mjs:69`) and `viewer.html:176`. Prev/Next stay text unless the owner wants icons too (open question below). Tests that read the Play label (`transport-unit`, `story-browser`, `explore-browser`, `fullscreen-browser`, make-explainer `diagram*.test.mjs`) change to read `aria-label`.
- **Slightly faster playback (owner request).** `story.js` constants, about 25 % shorter: `GLIDE_MS` 600→450, `DOT_MS` 1200→900, `HOLD_MS` 2500→1800, `HOLD_PER_CHAR_MS` 40→30, `HOLD_MAX_MS` 6000→4500. The 0.5×–2× speed cycle is unchanged. A 160-character caption still holds about 4.5 s, enough to read, so the new hold floor is checked against the longest bundled caption before merging. Fake-clock tests that pin the old milliseconds are updated in the same commit.
- **Wheel no longer pauses (owner request).** Delete `story.pause()` in the wheel handler at `template/viewer.js:284`. Pointer press, click and drag on the canvas still pause (`viewer.js:224`). The wheel still zooms the camera while a story plays. The story's next glide re-frames the beat, so a wheel zoom lasts only until the next beat; if it feels jarring during a glide, the zoom is allowed but the glide wins. Test change: `story-browser.test.mjs:384-397` currently asserts "the wheel pauses"; split it so click and drag pause and the wheel leaves `playing` true and still changes zoom. make-explainer's overlay shares `viewer.js`, and its "wheel leaves the page alone" test is unaffected.
- `transport.js` creates the ring around the icon button. The play/pause icon is its own child so `paint()` cannot erase the ring. Re-parent only when the parent changes, so speed/loop changes do not restart the animation. Prefer WAAPI `el.animate()` with explicit `cancel()` over class toggling.
- Ring lives on `data-pa-next`; on the last beat it moves to `data-pa-play` only when loop is on. No ring when playback will just stop.
- Reduced motion: no animation, but a stepped/static indicator still shows time left.
- Amended (as built, 2026-10-19): under reduced motion the ring is a static half ring while a step holds, a cue that the story moves on; it does not show time left.
- make-explainer inherits it through `viewerRuntime()`; only `template/diagram.css` sizing changes.
- Tests (RED first): story-unit fake clock (play fires `onHold(ms)` once; speed divides; pause/goTo fires `onHoldEnd`; paused `goTo` fires nothing); transport-unit (ring survives `paint()`; the fake element gains `classList` and `style`); story-browser (visible in Play, absent in Explore and under reduced motion). Look at a screenshot in dusk dark and paper light.

### P2 — Curved edges (make-diagram) · small code, medium tests · risk medium

**Owner chose Bézier curves (D2).** Graph edges become smooth cubic Béziers (d3 `linkVertical` style) instead of rounded right angles.
- Rule per route, computed in `edges.mjs` after `anchorEdges`: a three-segment Z route becomes one cubic from start to end with control points along the start and end directions, so it stays inside the layer channel and cannot reach a node. A two-segment L route becomes one cubic bend. Routes with more segments (long skips, detours) keep their waypoints and join them with cubic corners at a large radius. Self-loops and sequence-diagram messages keep today's drawing.
- Known cost: parallel edges that shared a lane lose their separate slots and can overlap or cross. Mitigation to build and test: offset the control points per edge index within a shared channel, and add a golden with three edges between the same layers. If it still reads badly, fall back to the large-radius rounded corner for those routes only.
- Arrow heads still point along the end tangent (`orient="auto-start-reverse"`), the travelling dot uses `getPointAtLength` (curve-agnostic), and Explore's route highlight reuses the same `<path>`; none need changes.
- New tests: no sampled curve point inside any label plate rect; plate near edge stays about 6 px (±2) from the path; no sampled point inside a node box; three-parallel-edges case. Fix `pathPoints` in `render.test.mjs` for `C`; update the pinned `Q` strings in `edges.test.mjs`.
- Regenerate goldens with `PA_WRITE_GOLDEN=1`, stated as intentional. Regenerate the four gallery diagram sets (delivery, incident, oauth, pipeline) **with their `thumb.jpg`**. Leave cache-clock pages (archify) alone.
- No `lines` root field: Bézier is the default look. A rounded-corner fallback flag is added only if the parallel-edge mitigation fails.
- Screenshots of the examples in dusk and paper are viewed before the PR; the owner sees them before merge.
- Amended (as built, 2026-10-19): the fallback is safety-first, per edge. An edge is drawn as a Bézier only when the curve stays 4 px (`CLEARANCE`) from every node it does not join and from every plate, and its label plate (if any) finds a place on the curve; otherwise it keeps today's drawing (the orthogonal route with radius-6 corners and ELK's own plate). Self loops and sequence messages are never curved.

### P3 — README samples · small · risk low

Hunk goes between the intro paragraph and the plugin table.
- Hero (owner chose the launch announcement, D4): `gallery/launch-announcement/video.mp4`, with its `prompt.txt` and `motion.json` beside it. Make a GIF once with ffmpeg and record the command in the PR (no new `--gif` flag). Honesty rules from review: the prompt file also holds a voiceover follow-up and the GIF is silent, so the caption says "from this prompt" (first prompt only, quoted), the alt text describes what is on screen (title, counter, end card; not "narrated"), and the model is named only if `portable-artifacts.html` says so (it says Claude Code, Sonnet), otherwise "an agent".
- Row of three: diagram-story GIF (generate after P1+P2), `img/portable-artifacts/growth-dashboard.jpg`, `gallery/explainer-deck/thumb.jpg`.
- Two prompt blocks copied from real files: `growth-dashboard.prompt.txt` (dashboard) and `gallery/launch-announcement/prompt.txt` first prompt only (clip).
- Guard: a bats assertion that every `docs/features/img/...` path in `README.md` exists. First RED by referencing the not-yet-made GIF.
- Can land before P1/P2 using existing images; add the diagram tile afterwards.

### P4 — make-motion review loop v2 · medium · risk low–medium

- `render.mjs --contact-sheet`: tiles per scene at start+1 frame, each keyframe landing time (+0.1 s), 85 %, and the last frame; a timestamp stamped **inside the page, only in contact mode** (MP4 bytes unchanged); one extra 360 px-wide tile for phone readability.
- Tiling happens in a second Chromium page (data-URL grid), never ffmpeg: the existing smoke test runs with `PATH=/nonexistent`.
- New `scripts/check.mjs` (mirrors make-diagram's): text outside the safe area (60 px at 1080 wide, scaled), overlapping visible text boxes, a scene whose elements are all invisible at its end. **No "frame 0 never empty" rule** (it fails nearly every shipped spec because of `fade` and opacity-0 starts). Skips cleanly without a browser.
- SKILL.md step 4 gains the look-then-check checklist. Prove `check.mjs` fires: feed it a title at `y: 10` and a spec that fades everything out (RED), then clean specs (GREEN). Add Playwright Chromium to the make-motion CI step (D5).
- Cut for now: `--at`, `--every/--from/--to`.
- Amended (ruled 2026-10-19): safe area = 60 * min(w,h) / 1080 px on every side (60 px at 1080 on the short side), not width-scaled; the skip line matches make-diagram's: `check: skipped (no browser: <reason>; <doctor hint>)`.
- Amended (as built, 2026-10-19): a contact sheet shows at most 11 moments plus the phone tile (12 tiles), and prints a note on stderr when it drops moments; `check.mjs` judges all moments. It judges an element only in a hold (not inside a tween of a prop the rule cares about: geometry for the safe area, geometry and opacity for overlaps), plus the scene's last frame; a box wholly off the canvas is gone, not clipped; text and counters are both checked; a title whose `exit` preset was applied counts as present for the empty-ending rule.

### P5 — Motion-design reference and named eases · small–medium · risk low

- `references/motion-design.md`: entrance 0.6–0.9 s, exits about half, stagger 0.09 s words / 0.2–0.25 s items, reading holds (1 s + 0.25 s per word beyond three, 2 s on the closing frame), safe area, one accent, linear only for continuous motion, one hero moment. One credit line for claude-motion.
- Named eases `enter`, `exit`, `move`, `land` in `template/timeline.mjs` via `import { cubicBezier } from 'animejs'` (functions, never strings: strings are silently linear). Confirm the **browser** bundle (`/vendor/animejs/anime.esm.js`) exports it and that the y=1.12 overshoot works. Update the `spec.mjs` enum, `schema.md` ease line and the SKILL.md ease line.
- Exit presets are **opt-in** (`exit` on a titled element), start after 0.9 × duration, never on the last scene, so posters and 85 % contact frames are never half faded.
- Amended (ruled 2026-10-19): when the full exit (half the entrance) does not fit after 0.9 × duration, it starts at 0.9 × duration and is shortened to land one frame before the scene end; it is dropped only when the entrance has not finished by then. `check.mjs` treats a title whose exit was applied as leaving on purpose (a hand-keyframed fade-out that empties a scene is still reported).
- Hold lint is deferred until the bundled examples comply (two of four would warn today).

### P6 — docs/architecture.html rebuilt with make-diagram · medium · risk medium · approved by the owner (D1)

Lands after `feat/make-scene` merges. Replace the Mermaid block with an iframe of a built page from `docs/architecture.diagram.json` (counts out of node labels, cards keep them). In the same commit: remove the five SITES, edit `AGENTS.md:57` ("counts live in mermaid labels"), keep the page's footer (it is in `_FOOTER_FILES`) and `assets/site.css` (a bats test requires it), drop the CDN script. Guard: warn when the spec hash or plugin version changes, not a byte-for-byte rebuild test (that turns red on every future make-diagram PR).

## Verification

Per phase: that skill's `npm test`; `bats tests/bats`; `uv tool run pytest tests/pytest -q`; `python3 scripts/sweep_counts.py --check`. UI phases are not done until a screenshot was taken and viewed. The manual-test checklist is generated when the branch completes.

## Dispatch

Executors: Sonnet 5, high. Phase review: fresh Opus 5, medium, "report every issue" wording, report only. P2's geometry and P6's sweep change get one fresh-context planner-tier verify. Every dispatch states commit authority.

## Decisions

Answered by the owner on 2026-10-19:
- **D1 Which diagram?** Both: make-diagram output (P1, P2) and a rebuild of `docs/architecture.html` (P6, after `feat/make-scene` merges).
- **D2 How curved?** Bézier curves, not just a bigger corner radius (P2 above).
- **D3 Ring meaning.** Auto-advance progress ring on the control that fires next (P1).
- **D4 README hero.** The launch-announcement clip (P3).

Open, default chosen (override any time):
- **D6 Icons for Prev and Next too?** Only Play/Pause become icons by default. Say so if Prev, Next and the chapter buttons should match (small extra change in the same files).
- **D5 CI.** Add Playwright Chromium to make-motion's CI step so `check.mjs` runs in CI. Default yes; the other three skills already pay it.
- Credit-line wording for claude-motion; whether `plugins/portable-artifacts/README.md` swaps its motion image for the diagram GIF (default: leave).
