# make-motion: five improvements and a hand-drawn explainer mode

Date: 2026-11-05. Plugin: `plugins/portable-artifacts`, skill `make-motion`, currently 1.1.0. Target release: 1.2.0.

## Intent

Shipped together in one PR because the owner asked for that.

1. **Part A** implements the five proposals in `~/Downloads/make-motion-improvements.md`, written after two real narrated films (1:02 and 1:53) were made with the skill. Each proposal removes work that had to happen around the skill.
2. **Part B** adds a new style: an explainer drawn on a whiteboard by an illustrated hand holding a pencil. It suits explaining a concept or an architecture. A film can be drawn from start to finish, or only some of its scenes can be, inside a bigger video. It comes with templates, and an agent reading the skill knows it exists and offers it.

The owner also questioned why video length is limited at all, and wants the agent to define it. So Part C removes the total length cap.

## Goals

- Every "done when" in Part A holds and can be shown from command output.
- An agent can make a hand-drawn film by writing a few elements or blocks in `motion.json`, with no animation code and no hand-computed stroke timing.
- Specs that do not use the new features render exactly as they do today.

## Non-goals

- **A drawing sound effect.** It was tried in two synthesised versions. The owner called the first too hissy and then said to take it off for now. Follow-up idea: a recorded CC0 pencil sample, because an agent cannot judge synthesised audio by ear.
- Other board looks (pencil on paper, chalkboard). The default look was the only one chosen.
- A forearm, sleeve or photo-realistic hand. The owner asked for the hand only, cut at the wrist.
- The Hershey single-stroke script. It was compared on film and rejected in favour of a handwriting font.
- Re-skinning the 28 existing blocks as sketches. Sketch scenes have their own blocks.
- Sketch scenes in a viral spec. Viral mode requires a hook on screen at frame 0, and a board starts empty. Validation refuses the combination in this release.
- A second-pass scanner for forbidden words, voice rankings and a spec generator, as the improvements document already rules out.

## Anti-goals

These would make the work a failure even if it technically runs:

- A hand whose grip looks wrong. The owner rejected two earlier drawings on this point. The accepted grip is in `.scratch/sketch-spike/D-photo-traced-grip.mp4`.
- Any change to the renders of existing specs. No existing test catches this: `test/blocks.test.mjs:91-95` only checks that sheets exist, and the determinism tests compare within one run. So the first plan task, before any edit, records the SHA-256 of a render of every example spec on the base commit. The last task repeats it and puts the comparison in the PR body. Hashes are machine-specific, so they are not committed as a test.
- A non-deterministic drawing. The same spec gives the same frames, with any `--workers` value.

## Constraints

- Offline at validate, preview and render time, per the skill's Security section.
- Pure seek-based rendering: every frame is a pure function of time.
- `SKILL.md` frontmatter `description` stays a single line, because the registry parser truncates folded scalars.
- `shared/` inside a skill is generated. Edit `plugins/portable-artifacts/shared/` and run `node bin/sync-shared.mjs` from the plugin folder.
- The skill runs on a cheap model (`model: haiku`, `effort: low`), so instructions must be literal.
- Tests must be written first, per `rules/ecc/common/testing.md`. Every guardrail must be shown failing on bad input.
- One browser-heavy run at a time on this machine (`~/.claude/CLAUDE.md`).
- `node_modules` is absent in this worktree, so `npm ci` in the skill folder is the first plan task.

## What the owner decided

- All of it lands in one PR.
- Hand-drawn content is mixed: architecture diagrams and concept sketches in one film.
- Default look: whiteboard with dark marker lines and one accent colour.
- The hand is illustrated, ships with the skill, and is cut at the wrist.
- The grip is the standard dynamic tripod: pencil almost level and in front of the hand, index pad on top of it, thumb pad under it, at the base of the wood cone. The shipped hand is smaller than the one in clip D.
- Handwriting uses a real handwriting font, uncovered as the pencil passes (clip A's method). The test used Caveat 700 (OFL-1.1).
- Lines, boxes, icons, scribble fill and drawing pace are right as seen in the clips.
- Agent behaviour: offered in the intake round, default off. It switches on by itself only when the prompt says whiteboard, hand-drawn, sketch or similar.
- Voiceover stays opt-in. When on, drawings line up with narration sentences automatically, and an element can pin itself to a chosen sentence. When off, the drawing sets its own pace.
- Moving between ideas supports both a hand wiping the board and a pan to a clean board, and the template or agent picks.
- Hand skin tone is offered at intake, with clip D's tone as the default.
- Hand-drawn can be part of a bigger video or the whole of one.
- The agent defines the length. Nothing in this style sets a default length.

---

# Part A: the five improvements

Line references were checked against this branch.

## A1. Pronunciation guidance and a phoneme check

**Why.** Kokoro reads "resume" as the verb, and an agent cannot hear the output.

- `scripts/lib/voice.mjs:144` calls `tts.generate()`, which returns audio only. In the pinned `kokoro-js@1.2.1`, `tts.stream()` yields `{ text, phonemes, audio }`, and the phonemiser is not exported. So phonemes come from `stream()`, and a phoneme check also synthesises. A dry run through the `phonemizer` package would skip Kokoro's own text normalisation, so it could report something other than what gets said.
- Keep the existing sentence splitting and the `finally { dispose }` discipline. Each chunk goes through `stream()`. If a chunk yields more than one result, join the audio and the phonemes.
- **Verify first:** `scripts/lib/voice.mjs:109-116` already knows that the string form of the splitter never closes, and already builds, pushes and closes a `TextSplitterStream`. Pass one of those to `tts.stream()`. The open point is whether that form terminates and yields `phonemes`. Prove it with `VOICE_TEST=1` against the real model.
- Every sentence in the sidecar gains `phonemes`. `template/captions.mjs:150` maps sentences by named fields, so extras are ignored; pin that with a test.
- `--phonemes` prints one `<sentence>\t<phonemes>` line per sentence on stdout after the existing three lines, so the three-line contract stands.
- `SKILL.md` voiceover notes: check words with more than one pronunciation (resume/résumé, lead, read, live, record) and respell them in the narration file.

**Done when** the "résumé" reading can be confirmed from command output without playing audio.

## A2. Left anchor for text

**Why.** `x` is the centre and text shrink-wraps, so left-aligned stacks stagger.

- Text gains `"anchor": "left" | "center" | "right"`, default `center`.
- `template/renderer.mjs:634` translates by `-50%`. For text only, this becomes `0%`, `-50%` or `-100%` on the x axis, and `transform-origin` moves to the matching edge so `scale` and `rotate` keep that edge fixed.
- `check.mjs` warns (warning, not problem) when vertically adjacent text elements have left edges that differ by more than 0.5 px and at most 12 px at 1080 on the short side, while neither is moving.

**Done when** three stacked lines of different lengths in a proportional font share one left edge from one `x` value, and existing golden sheets do not change.

## A3. UI mockup blocks

**Why.** Product screens were the hardest part of the films, and swapped states overlapped.

Five new blocks in `template/blocks/`:

| Block | Draws | Key params |
|---|---|---|
| `browser-window` | Title bar, address bar, content area | `url`, `title?`, `image?` |
| `form-fields` | Labelled rows filling one at a time | `fields` (`{ label, value }`), `typing?` |
| `tab-switch` | Tab row and panels, one active change at a time | `tabs` (`{ label, body }`), `switchAfter?` |
| `button-state` | A button changing label or colour | `from`, `to` (`{ label, tone? }`), `at?` |
| `side-panel` | A docked panel sliding in | `title`, `rows`, `side?` |

- `expandBlocks` handles only top-level elements (`template/blocks/index.mjs:112`), so blocks do not nest. Each stands alone and is placed by coordinates. `blocks.mjs show browser-window` prints the content rectangle, so `form-fields` can be placed inside it. This meets the "few `block` elements" requirement without adding nesting.
- `tab-switch` and `button-state` fade the old state fully out before the new one lands, or cross-fade in the one place `check.mjs` already allows.
- Each block gets a golden sheet in `references/blocks/`, a row in the `SKILL.md` table and a place rule. New example: `references/examples/ui-form-fill.json`.

**Done when** that example (a form filling itself inside a browser window with a side panel beside it) is a few `block` elements and `check.mjs` reports no overlaps.

## A4. `render --no-provenance`

- `--no-provenance` plus a root `"provenance": false` drop the `comment` and `artist` tags (`scripts/render.mjs:233`) and the preview page's footer line. The flag works with `--batch`. With `--contact-sheet` it is a `UsageError`, like the checks at `render.mjs:112-133`.
- `+faststart` is **already on** (`scripts/lib/ffmpeg.mjs:49`, `scripts/lib/loudness.mjs:101,114`), so no change is needed. Add a test only if none pins it.
- ffmpeg's own `encoder` tag stays. Docs must say this removes the authoring tags and does not claim the file is free of all metadata.

**Done when** `ffprobe -show_format` shows neither `comment` nor `artist`, with no second pass, including through the loudness path.

## A5. `render --poster <seconds>`

- `render.mjs motion.json --poster <seconds> [--poster-out file.jpg]` writes one frame **without rendering the MP4**, so adjusting a poster does not cost a full render. The default path is `out/poster.jpg`. JPEG or PNG follows the extension.
- The frame is `round(seconds × fps)`, and a time past the end is a usage error. The captions layer is hidden. Grain, vignette and everything else stay.
- `--poster` with `--batch` or `--contact-sheet` is a `UsageError`.

The poster is **the film's own frame minus the caption layer**. It is not a render of the spec with `captions` deleted, because blocks lay out differently when a spec has captions (`template/blocks/index.mjs:119-121`).

**Done when** the poster is pixel-equal to a capture of that frame with the captions layer hidden, shows the same block layout as the film, and contains no caption text.

---

# Part B: hand-drawn style

## How it appears in a spec

Hand-drawn is a **scene style**, so a film can mix drawn and standard scenes. A root `style` sets the default for every scene, the way a root `transition` does, and a scene can override it.

```json
{
  "sketch": { "hand": { "tone": "medium", "scale": 1 }, "seed": 1 },
  "scenes": [
    { "id": "open", "duration": 3,
      "elements": [ { "id": "t", "type": "block", "block": "title-card", "x": 960, "y": 540, "params": { "title": "How it works" } } ] },
    { "id": "flow", "style": "sketch", "duration": 14,
      "elements": [
        { "id": "title", "type": "text", "text": "How a request flows", "x": 960, "y": 170, "fontSize": 110 },
        { "id": "diagram", "type": "block", "block": "sketch-diagram", "x": 960, "y": 560,
          "params": {
            "nodes": [
              { "id": "web", "label": "Browser", "icon": "monitor" },
              { "id": "api", "label": "API", "icon": "server", "fill": true },
              { "id": "db", "label": "Database", "icon": "database" } ],
            "edges": [
              { "from": "web", "to": "api", "label": "https" },
              { "from": "api", "to": "db", "label": "SQL" } ] } } ] } ]
}
```

`style` is `standard` (default) or `sketch`. A whole-film drawing writes `"style": "sketch"` at the root. The code is `template/sketch*.mjs`, joining the pipeline in `expandSpec` (`template/defaults.mjs`) the way `applyViral` does.

## What each element does in a sketch scene

| Element | In a sketch scene |
|---|---|
| `text` | Written in the handwriting font, uncovered by a zig-zag mask that follows the pencil |
| `shape` | Wobbled stroke with slight corner overshoot, drawn by the hand; `"fill": "scribble"` adds an accent hatch |
| `icon` (new, sketch only) | A named line icon drawn stroke by stroke |
| `group` | Its children are drawn in order |
| `block` | Sketch blocks only |

Any other type or block in a sketch scene is a validation error that lists what is allowed, and the message points to putting it in a standard scene. That covers `chart`, `image`, `video`, `lottie`, `code`, `counter` and the standard blocks. Sketch blocks in a standard scene are an error too.

The drawing owns an element's appearance, so these are also validation errors in a sketch scene: element `keyframes`, `typing`, `role`, `exit`, `scale` and `rotate`, and the scene's `camera`. `scale` and `rotate` are refused because the hand follows world coordinates, so a transformed element would be drawn away from the pencil tip. A static `opacity` and `hold` stay allowed.

## Timing

- Elements draw **in document order**, one after another, by default. The hand travels between strokes.
- Pace is the spike's, which the owner approved: 2700 px/s for lines and 22 characters/s for writing, at 1080 on the short side. `sketch.pace` (0.5 to 2) scales them.
- An element may set `drawAt` (seconds inside the scene) to start later.
- **Automatic sync.** A scene's voice track is the `audio` entry with this scene's `scene` whose `src` has a voice sidecar beside it. When a scene has one, its top-level elements line up with the sentences in order, with no timing to write: element k draws during sentence k. If the counts differ, the elements share the whole narration, each getting time in proportion to its drawing length. A block counts as one element and its parts share its window.
- **Override.** `drawAt` can be `"sentence:<n>"`, mirroring `"beat:<n>"` (`scripts/lib/beat-refs.mjs`), resolving to that track's `at` plus the sentence's `start`. Everything until the next `drawAt` shares that window. Numeric `drawAt` still works. A pinned element splits the automatic sync into separate runs before and after it.
- Inside a window, drawing stretches to fill it, down to half the normal pace. If it would finish sooner, the hand finishes and moves away, and the board holds.
- If a drawing cannot fit its window at twice the normal pace, `check.mjs` reports a problem naming the element and the seconds needed. A scene with no voice too short for its drawing is a validation error, like `story-beats`: `params.nodes: this drawing needs a scene of at least 14.2s`.
- After an `erase` transition, drawing starts when the sweep ends. Transition windows sit at the start of the incoming scene (`template/transitions.mjs:47`), so required durations include the sweep.

## Stroke plan: a pure module

All geometry lives in one browser-safe, dependency-free module with no DOM use. It turns a resolved spec into a list of strokes as polylines with start and end times.

- Wobble is seeded from `sketch.seed` and the element `id`, so inserting an element does not reshuffle the others.
- The renderer sets dash offsets and the hand position from this plan, by lookup. No `getPointAtLength` runs per frame, which removes the main performance risk and any dependence on Chrome's path maths.
- `validate.mjs` and `check.mjs` run the same plan in Node, which is what lets them state a required duration without a browser.
- Text widths come from the existing metrics path (`shared/text.mjs`, `shared/fonts/metrics.json`).

## The hand

- An original vector drawing that ships with the skill, drawn by the renderer as a top layer, not as a spec element. Its starting point is `buildHand` in `.scratch/sketch-spike/spike.html`. The build cleans the line ends and refines the wrist edge.
- The reference photos in `.scratch/grip-refs/` belong to others. They informed the pose only, and neither they nor any trace of their pixels may ship.
- `sketch.hand.tone`: named tokens `light`, `medium` (default, clip D's colour), `tan`, `brown`, `dark`.
- `sketch.hand.scale`: 0.5 to 1.2. Scale 1 is **0.8 × the size in clip D**, because the owner asked for a smaller hand. It scales with the short side of the canvas.
- The hand appears only in sketch scenes, and is off screen when a sketch scene ends, so any transition to or from a standard scene shows no hand cut off mid-stroke.
- Motion: the pencil tip follows the stroke exactly on lines. On writing it follows a smoothed path, as the spike does. Between strokes it lifts and travels with ease. It enters from and leaves past the lower right edge of the frame.

## The look

Board `#fdfcf8`, ink `#1d2330`, accent `#e8590c`, scoped to sketch scenes. This is not a tenth shared theme, because shared themes are copied into every skill and counted in several documents.

The spec's `theme` keeps meaning what it means today, for its standard scenes, so a mixed film can have a `dusk` title and a whiteboard middle. The `theme: <name>` first line of `render.mjs` and the `--theme` flag do not change. A sketch scene overrides the CSS tokens on its own scene node and its own part of `look` (`template/renderer.mjs:60-98`), so tokens such as `accent`, `text`, `line` and `surface` resolve to this palette inside it. A scene `background` still overrides the board colour.

## Moving between ideas

- `"transition": "erase"` (new): the hand sweeps across and the board clears along its path. Only between two sketch scenes.
- `"transition": "push"` (existing): the next clean board slides in, which reads as a pan. Direction options stay as they are.
- All existing transitions work for a cut between a standard scene and a sketch scene, and between two sketch scenes.

## Templates

Five sketch-only blocks, each a normal block with `blocks.mjs show`, a golden sheet and a place rule:

| Block | Use |
|---|---|
| `sketch-diagram` | Architecture: 2 to 8 nodes with optional icons and fills, edges with labels, `layout` of `row`, `column` or `grid` |
| `sketch-steps` | A process of 2 to 6 numbered steps joined by arrows |
| `sketch-list` | A heading with 2 to 6 icon-and-phrase rows |
| `sketch-compare` | Two columns: before and after, or option A and option B |
| `sketch-callout` | One phrase with an icon, then an underline or a circle round it |

Four starter films in `references/examples/`: `sketch-architecture.json`, `sketch-concept.json`, `sketch-steps.json` and `sketch-mixed.json` (a standard title and closing around drawn scenes). Each validates, passes `check.mjs`, and renders.

## Icons

The Lucide set (ISC) is vendored as one minified JSON file in the skill, with its licence text. A `bin/` script generates it from a pinned `lucide-static`, which stays a development-time tool, not a runtime dependency. The full set is about 1 MB as files and smaller once stripped, small beside the skill's other dependencies, and a complete vocabulary means fewer dead ends for concept sketches. Unknown names are errors with a did-you-mean. `node scripts/sketch-icons.mjs search <word>` lets an agent find names, rejecting unknown arguments as the repo's agent-surface rule requires.

## Handwriting font

Caveat 700, Latin subset (`@fontsource/caveat` 5.3.0, OFL-1.1). It ships **inside make-motion, not in `shared/fonts`**, because `sync-shared.mjs` copies shared fonts into all five skills and only this one uses it. Its licence, source and metrics sit beside it under `template/sketch/`, which the server's `/template/` route already serves. The page adds its `@font-face` only when a spec has a sketch scene. Because it reads small for its nominal size, sketch text defaults to larger sizes, and the 28 px text floor stays as it is.

## Audits

`check.mjs` must stay honest in sketch scenes:

- The hand is excluded from contrast sampling and the overlap audit. Hide it during pixel sampling, not by loosening thresholds.
- A text being written counts as moving, so the overlap and reading-floor audits judge it after it finishes.
- A drawing in progress counts as change for the dead-stretch audit.
- With a voice track, a finished board holding while narration plays is exempt from the dead-stretch audit, since the viewer is listening. Without a voice track it is not exempt: a silent, still board for more than 3 s is a real problem.
- New warning: writing not yet finished at the end of a scene.
- A blank frame 0 stays a warning when a film opens on a sketch scene. The message suggests `--poster` for the thumbnail.

Each change is shown catching a bad spec first.

## Agent discovery

- The `SKILL.md` `description` gains "hand-drawn whiteboard explainer", staying on one line.
- **Intake** gains `style`: `standard` (default), `hand-drawn` for the whole film, or `mixed`, with a one-line description of when each suits. If either drawn option is picked, intake also asks `hand tone` (default `medium`). The intake's `length` line changes for these: the agent proposes a length from the content, with no fixed default.
- A prompt saying whiteboard, hand-drawn, sketch, "drawn by hand" or similar sets the style without asking.
- The `intake: skipped (...)` report line is a contract. Extend it with `style <name>` and `hand <tone or n/a>`. The test that pins it is `plugins/portable-artifacts/bin/test/intake.test.mjs:19,31`.
- The existing storyboard step (`SKILL.md:62`, clips over 20 s) applies unchanged. Any drawn film over 20 s gets the same scene review as any other long clip, with no exception to build.
- `SKILL.md`'s "stay under 15 s unless asked" in Style defaults does not apply to drawn scenes.
- A short "Hand-drawn style" section in `SKILL.md` covers when to use it, a pointer to `references/sketch.md` for details, the starter files, and the allowed elements.

## Risks the build checks first

1. **Text reveal in the render page.** The spike used SVG `<text>`. The renderer uses HTML text. Prove multi-line wrap, mask reveal and `check.mjs` rectangles on real render pages before building the blocks on top.
2. **Frame cost.** Measure a dense scene at 1080p with the real render path. Masks re-rasterise each frame, so report the per-frame figure in the PR.
3. **`--workers` determinism.** Extend `test/determinism.test.mjs` and `test/workers.test.mjs` to a sketch spec.

---

# Part C: remove the total length cap

**Why.** The owner asked why length is limited at all and wants the agent to decide. One of the two films behind the improvements document was already 1:53 against a 2:00 cap, and narrated drawn explainers run longer than that.

- Remove `MAX_TOTAL_SECONDS` and its check (`scripts/lib/spec.mjs:40,1019-1020`) and `MAX_CLIP_SECONDS` in `scripts/lib/storyboard.mjs:16`.
- Update `test/validate.test.mjs:104-106`, `references/schema.md:23,259` and the skill's `README.md:216`.
- The 50-scene and 60-second-per-scene limits stay. They catch malformed specs and do not limit a real film in practice, since together they allow 50 minutes.
- **Verify:** render a spec longer than the old cap (about 130 s of simple scenes) to confirm nothing else assumes it, for example in loudness measurement or the audio mix.
- Rendering time grows with length. The docs say so, and point to `--workers` and `--quality draft`. There is no new warning.

---

# Part D: Simple English in make-explainer

**Why.** The owner wants explainers that anyone can follow, taking the best parts of ASD-STE100, with a toggle at the top that switches the page's text.

**The owner decided:** the agent writes both versions and a script checks the simple one. The page opens in normal text. The toggle is named "Simple English" and the page remembers the choice. It ships in this PR.

- The name avoids claiming compliance. We use parts of the standard's writing rules and do not check its approved dictionary, which belongs to ASD. Docs say "based on ideas from ASD-STE100; not a compliant document". No text from the standard or its dictionary is copied; the rules and word swaps are written in our own words.
- **Spec:** an eligible section may carry `simple`, an object with the same prose fields as the section, replacing them in the simple view. A field left out shows its normal text. List fields match by position.
- **Eligible sections:** `tldr`, `text`, `cards`, `risks`, `steps`, `timeline`, `compare`, `callout`, `details`, `table`. On other sections `simple` is a validation error that lists these.
- **Not changed by the toggle:** code, commands, file paths, numbers and data, and interactive or embedded sections (`checklist`, `decision`, `approval`, `question`, `review`, `verdict`, `diagram`, `chart`, `scene`, `motion`, `image`, `code`, `files`, `kpis`). A plan's answers are never affected.
- **Modes:** recap, concept, plan, checklist and slides all work, through their eligible sections.
- **Page:** the toggle appears only when the page has simple text. Without JavaScript and in print, the normal text shows. Contents labels and section ids do not change, so links keep working.
- **Lint rules, as validate warnings on `simple` text only**, ignoring `code`: at most 20 words a sentence in `steps`, 25 elsewhere; at most 6 sentences a paragraph; one item of likely passive voice flagged per sentence; no semicolons; a short word-swap list ("in order to" to "to", "utilize" to "use", "prior to" to "before"); a step starts with a verb, checked only against a list of common non-verb openers.
- `simple` is optional in the schema, so older specs build unchanged, and pages without it render byte-identically. If a page has some simple text, an eligible section with none gets a warning. The skill tells the agent to write it for every eligible section.
- `simple` text does not count toward the page's word budgets, since a reader sees only one version.

**Done when** a recap and a deck each switch text with the toggle, the choice survives a reload, a plan page's answers are unaffected, and a page with no `simple` is byte-identical to today's.

---

# Part E: site and showcase

**Why.** The owner wants the portable-artifacts site page simplified, and to show the new work.

**The owner decided the order of `docs/features/portable-artifacts.html`:**

1. Showcase up top.
2. Quick, copy-pastable installation.
3. One line for each skill.
4. Then the details.

- Commands follow the per-line copy-button contract in `CLAUDE.md`.
- Existing detail content stays reachable below; it moves, and only repeated text is cut.
- **Two new showcase films, rendered with the skill itself and shown up top:** a hand-drawn film, and a film that shows make-motion's features. The feature film uses a representative of each major feature family: blocks, charts, maps, code, transitions, camera, captions, and the new UI blocks. Features needing a user's files (cutouts, footage, voice) may be left out or use bundled fixtures, and the film must not claim more than it shows.
- Films are silent unless a voiceover is already available. Each has a poster from `--poster`.
- Site changes stay local to the repo. Nothing is deployed.

---

## Cross-surface updates

- Plugin version 1.2.0 and `CHANGELOG.md`.
- `README.md`, `USAGE.md`, `references/schema.md`, `references/motion-design.md`, the skill's `README.md`.
- Block count: 28 becomes 38. Grep for it across the plugin and `docs/`, including `docs/features/portable-artifacts.html`.
- `docs/skills-catalog.md` and `docs/catalog.html` where the skill's description appears.
- Plugin eval cases for the intake line and for one hand-drawn prompt.

## How it gets proven

- Unit tests for the stroke plan, timing, refusals and each new flag, written first.
- Golden sheets for ten new blocks, with existing sheets unedited.
- The base-commit hash comparison from Anti-goals, in the PR body.
- Each "done when" in Part A exercised by a command and its output.
- All four starter films rendered, with contact sheets viewed.
- A real voiceover film proving `sentence:<n>` and phonemes, gated on `VOICE_TEST=1`.
- `branch-test-checklist` at the end of the branch for what a human must watch: the hand's look and motion, and narration sync by ear.

## My calls, for the owner to check

These were not discussed, and I chose them:

1. A scene-level `style` with the value `sketch`, called "hand-drawn" in prose. I changed this from a root `mode` once you said it can be part of a bigger video.
2. "Why are we limiting length" taken to mean removing the 120 s total cap for every film, and keeping the 50-scene and 60 s-per-scene limits. This is the call most worth checking.
3. Your "yeah" taken to mean drawn films keep the storyboard review over 20 s like any other clip.
4. Sketch scenes are refused in viral specs for now.
5. One document and one plan for all parts.
6. `--poster` writes only the poster, with no MP4, and shows the film's own frame minus captions.
7. Phonemes go in every sidecar, and `--phonemes` only adds printing.
8. Blocks do not nest; `browser-window` publishes a content rectangle instead.
9. Sketch scenes refuse charts, images, video, Lottie, code, counters, keyframes and camera moves. Those belong in standard scenes of the same film.
10. The palette is scoped to sketch scenes, not a shared theme. Caveat ships only in make-motion.
11. Timing rules: a sentence window stretches drawing to half pace at most, compresses to twice pace at most, and otherwise reports a problem. A pinned element splits automatic sync.
12. A still board is exempt from the dead-stretch audit only while narration plays.
13. The whole Lucide set is vendored, not a curated subset.
14. Hand tones are five named tokens.

## Left to the builder

File layout inside `template/`, the zig-zag sweep count per glyph, exact wobble parameters within what the clips show, hand travel easing, how the erase sweep is shaped, and block spacing rules.
