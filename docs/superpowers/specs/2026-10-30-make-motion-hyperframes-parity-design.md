# make-motion: HyperFrames parity, the whole roadmap

Date: 2026-10-30. Branch: `worktree-skills-improvement`. Shares one branch and one
PR with the explainer-KPI and harness-learnings specs (same date).

Source: the owner's Claude Doc "make-motion vs HyperFrames: feature parity plan"
(2026-10-28, https://claude.ai/artifact/5F1whGdkBREmpCeV8W9AwU). A builder cannot
open that doc, so this spec carries all of it plus the owner's decisions from
2026-10-30. HyperFrames is https://github.com/heygen-com/hyperframes, Apache-2.0.

## Intent

make-motion should cover the work HyperFrames is used for, without free-form
HTML, GSAP, HeyGen or any cloud render. It should not try to match "anything a
browser can draw". Its edge is that a small model writes one JSON file, and the
same spec always renders the same video offline.

The biggest gaps today are footage, captions and a reusable block library.
make-motion has five element types (text, counter, shape, image, chart), three
transitions (none, fade, crossfade) and no video element. HyperFrames ships about
450 registry items (blocks and components) and treats video, captions and music
as first-class.

## What "competes" means, measured

- **Coverage.** A 12-prompt benchmark: two prompts for each of HyperFrames' six
  "What you can build" categories. The categories are product launch, PR
  walkthrough with code diff and captions, data viz with a chart race or map,
  captioned social clip with music, docs-to-video, and templated batch clip.
  Every prompt must be expressible in `motion.json`.
- **Small-model reliability.** Haiku, run through
  `plugins/portable-artifacts/eval/run-eval.mjs`, produces at least 11 of 12
  valid specs on the first build, with a median of 2 or fewer validate runs.
- **Determinism.** Every benchmark spec rendered twice gives byte-identical
  MP4s (same SHA-256).
- **Offline.** Zero network requests at validate, preview, check and render,
  enforced by the existing CSP and `guardNetwork()`.
- **Quality gate.** All 12 pass `check.mjs`, including the new Phase 2 audits.

## Design rules (every feature must pass all seven)

1. **Spec-first.** The model writes only JSON. A new capability is a field, an
   element type or a block, never code the model writes.
2. **Small-model writable.** Each new field or block passes the Haiku eval (at
   least 9 of 10 valid on the first build) before release.
3. **Deterministic.** The same spec and the same media give a byte-identical
   MP4. Each feature adds a render-twice-and-hash test.
4. **Offline at render.** No network after a one-time install the user agreed
   to. The CSP and `guardNetwork()` are the guarantee, not the validator.
5. **OSI licences only.** No GSAP, no Remotion, and no model weights under
   non-commercial licences.
6. **Opt-in and backward compatible.** A spec that does not use a new field
   renders exactly as before, and existing golden tests stay unchanged.
7. **Fails helpfully.** Each feature ships with validator errors that name the
   fix, a `check.mjs` rule wherever it can go wrong visually, and one example in
   `references/examples/`.

## Roadmap

### Phase 1: footage, captions, blocks

- **`group` element.** Holds child elements positioned relative to the group,
  and animates opacity, x, y, scale and rotate as one unit. Blocks are built on
  it. Done when a nested spec renders pixel-identical to its hand-flattened
  equivalent.
- **`video` element.** At validate, ffprobe checks the file. At render, ffmpeg
  decodes the trimmed range at the output fps into a cache keyed by file hash,
  range, fps and size, and frame i is shown as an image, so every frame is
  exact. Fields cover trim, offset and mute. Clip audio joins the existing mix
  graph. Preview seeks a `<video>` tag; this is approximate, like preview audio
  today. Done when MP4 frame k matches ffmpeg's decoded frame k at a PSNR of at
  least 45 dB, and two renders hash the same.
- **Captions track.** The source is the voice (Kokoro clips) or an SRT, VTT or
  Whisper JSON file. `voice.mjs` already synthesises sentence by sentence, so
  sentence start and end times are exact. In v1, a word's time is proportional
  to its characters within the sentence. Whisper word alignment through
  transformers.js is a v2 spike. There are six styles: plain, pill, karaoke (the
  current word highlighted), kinetic, boxed and typewriter. Port HyperFrames'
  grouping rules:
  - one group on screen at a time;
  - 2 to 6 words per group;
  - a break at a sentence end or a pause of 150 ms or more;
  - the first group at least 0.1 s in;
  - everything inside the caption zone.
- **Format presets.** 16:9, 9:16, 1:1 and 4:5 each set the size, a safe zone
  and a caption zone. `check.mjs` flags non-caption text inside the caption zone
  when the spec has captions.
- **Blocks v1 (8):** title-card, lower-third, kpi-counter, step-flow,
  quote-card, checklist, logo-outro and cta-close. A block expands at validate
  into a group of plain elements. Colours come from theme tokens, and validator
  errors point at params, never at the expansion. `blocks.mjs list` and
  `blocks.mjs show <name>` print each block's params and an example. Each block
  ships with a params schema, a golden contact sheet and one Haiku eval prompt.

**Gate 1.** Two things must hold:
- the PR-walkthrough and captioned-social benchmark prompts build on Haiku;
- every Phase 1 spec renders hash-identical twice.

### Phase 2: quality gates, motion, speed

- **Four new `check.mjs` audits:**
  - *Contrast.* WCAG AA (4.5:1, or 3:1 for large text), sampled from the pixels
    behind each text box, reusing `shared/contrast.mjs`. Each finding suggests
    the nearest passing theme token.
  - *Reading floor.* A line stays on screen at least 0.75 × (0.5 + 0.3 × words)
    s, and the last line at least 2 s.
  - *Dead stretch.* More than 3 s with no change is flagged. The final 3 s and
    elements marked `"hold": true` are exempt.
  - *Text floor.* Text under 28 px (at 1080 on the short side) held for 0.5 s or
    more.

  Severity follows HyperFrames: a finding at a single sample is info, and a
  held one is an error.
- **Six transitions:** push, slide, wipe, zoom, blur and iris. Each takes a
  direction and a duration (default 0.4 s), and uses only CSS transforms,
  `clip-path` and `filter`.
- **Scene camera.** Keyframes for zoom, x, y and rotate on the whole scene
  layer, plus a seeded shake. Safe-area checks are measured after the camera
  move.
- **`code` element.** Fields: `lang`, `code`, `highlight` (lines), `diff` and
  `typing`. Shiki (MIT) with bundled grammars renders the code to static spans
  at load, with colours mapped to theme tokens. New blocks: code-typing,
  code-diff and terminal-run.
- **Faster renders.**
  - `--workers N|auto` captures frame ranges in parallel pages but feeds one
    encoder in frame order, so the MP4 stays byte-identical to `--workers 1`.
  - `--quality draft` renders at half size with a higher CRF for iteration.
    `final` is today's output.
- **Variables and batch.**
  - A root `vars` declares typed variables with defaults, and `{{name}}` works
    in any text.
  - `render --batch rows.json --out "renders/{name}.mp4"` validates every row
    before the first frame. It writes `manifest.json` with each row's status,
    output path, SHA-256 and duration.

**Gate 2.** Two things must hold:
- a 30 s 1080p benchmark spec renders at least 2× faster on 4 workers than
  today;
- all 12 benchmark specs pass the new audits.

### Phase 3: media and data

- **Beats.** `beats.mjs` decodes the music track with ffmpeg and finds the
  beats in JS (spectral flux, no AGPL libraries), writing `beats.json`. A
  keyframe `t` or a cue `at` can then be `"beat:12"`, which the validator
  resolves to seconds. A track with no steady beat is an error.
- **Loudness.** `render --loudness -16` runs a two-pass loudnorm. The LUFS
  report stays.
- **Grade presets** on image and video: warm, cool, mono and film, plus
  exposure, contrast and saturation, built as SVG `feColorMatrix` and
  `feComponentTransfer`.
- **`lottie` element.** Uses lottie-web (MIT) with `goToAndStop(frame, true)`.
  The validator rejects embedded remote assets and expressions.
- **Maps.** Bundled world-atlas and us-atlas TopoJSON (ISC), which a chart
  names as `"data": {"name": "world-110m"}`. New blocks: map-highlight and
  flow-map.
- **`race` block.** Rows by period become bars, re-ranked and interpolated per
  frame.
- **Pick in preview.** Clicking an element in the preview page copies its spec
  path (`scenes[1].elements[3]`) and id.
- **Storyboard step.** For clips over 20 s, make-motion first builds a
  make-explainer plan page (scenes, beats, durations) for the user to approve,
  then writes the spec from the answers.
- **Blocks to about 24.** Adds comparison-split, before-after,
  notification-stack, chat-thread, timeline, testimonial and lower-third
  variants.

**Gate 3.** All 12 benchmark prompts build, pass `check.mjs` and render
hash-identical.

### Phase 4: conditional

- **Cutouts.** An on-demand install, the way Kokoro is installed today, of
  MODNet (Apache-2.0) or BiRefNet (MIT) on onnxruntime. It writes a cached alpha
  sequence, which a text-behind-subject block uses. It follows AGENTS.md's
  on-demand dependency rules: audited with `scripts/audit-on-demand-deps.sh`,
  pinned with overrides, and the doctor goes red on a stale install.
- **WebGL transitions.** These ship only if a software-GL render is
  byte-identical across two runs on two machines. Otherwise they are dropped,
  and the PR says so.

## What not to copy

- **Free-form HTML/CSS/JS authoring.** It breaks spec-first.
- **GSAP.** Not under an OSI licence; anime.js stays.
- **HeyGen avatars, TTS and generated video.** A paid cloud dependency.
- **Cloud render, publish, Lambda, Cloud Run, telemetry.** These break
  offline.
- **Project history and timeline edit verbs.** The spec lives in git.
- **Chasing registry size.** The target is coverage of the six categories.
- **`capture <url>`.** Needs the network. A user's own recording comes in
  through `video` instead.
- **Remotion import.** Its licence is not OSI-approved.

## Risks

| Risk | Mitigation |
|---|---|
| Spec creep lowers small-model accuracy | Blocks are the main surface. Rerun the Haiku eval at each gate, and block when it drops below 9 of 10. |
| Video frame cache size: 1080p PNG frames run to GBs for 30 s | Cache as high-quality JPEG or decode per worker chunk. Key by hash; clear with `doctor --fix cache`. |
| Kokoro word timings are estimates within a sentence | Sentence edges are exact. Spike Whisper alignment before promising karaoke-level sync. |
| Parallel capture changes output | Workers only capture; one encoder takes frames in order. A hash test compares `--workers 1` with `--workers 4`. |
| Lottie files carry remote images or expressions | The validator rejects both; the renderer's network abort is the backstop. |
| Beat detection fails on music with no clear pulse | Fail with a clear error rather than guess a grid. |
| One branch this large is hard to review and long-lived | See Constraints: gates are commit boundaries, there is a reviewer per gate, and the plan carries a Status block. |

## Decided (owner, 2026-10-30)

- **Scope.** The whole roadmap, Phases 1–4, in this one branch.
- **Phase 4.** Both items, each with its condition. Cutouts ship. WebGL ships
  only if it is byte-identical; otherwise it is dropped and reported.
- **Formats.** 9:16 vertical is in. Format presets are part of Phase 1, which
  answers the doc's open question.
- **Dependencies.** shiki, lottie-web, world-atlas, us-atlas and onnxruntime
  (plus the cutout weights, MODNet or BiRefNet) are approved. Each is pinned to
  an exact version and checked with `npm audit`, or with
  `audit-on-demand-deps.sh` for on-demand installs.
- **Blocks.** An agent drafts each block's params schema and expansion from
  HyperFrames' block list. Each block is then reviewed and gated by its golden
  contact sheet and its Haiku prompt. Porting rules or ideas needs no
  attribution. Porting code or assets from HyperFrames (Apache-2.0) needs
  attribution in a NOTICE entry and the file header.
- **Haiku eval budget.** One prompt per new block or field, each run once, plus
  the 12-prompt benchmark at Gates 1, 2 and 3. That is about 65–75 billed
  `claude -p --model haiku` runs over the branch. Design rule 2's "at least 9 of
  10" is read as follows: of each batch of about 10 new-item prompts, at least 9
  pass on the first build. It is not 10 trials per item. Results are reported as
  measured, with the command.
- **Storyboard without a human.** When the agent cannot ask (`claude -p`, the
  eval, any non-interactive run) or make-explainer is not installed beside
  make-motion, it skips the storyboard. It builds the clip directly and prints
  one line saying the storyboard was skipped and why. The motion eval copies no
  sibling skill.

### This session's calls after the builder check (owner may override)

- **Benchmark prompt set.** The 12 benchmark prompts live in their own file,
  selected by a new `run-eval.mjs` switch (for example `--set benchmark`). The
  existing `prompts/motion.json` stays, so committed
  `results/summary-*.md` remain comparable.
- **What determinism covers.** It is a test-time claim. Hash tests set
  `SOURCE_DATE_EPOCH`, because `render.mjs` stamps the build date into the MP4
  `comment` tag through `shared/provenance.mjs`. The docs say that frames and
  audio are identical, and that the provenance date differs by day unless
  `SOURCE_DATE_EPOCH` is set. Shared provenance behavior does not change for the
  other skills.
- **Golden contact sheets.** Each block commits a reference PNG for human
  review in the PR. CI does not pixel-diff it, because macOS and Ubuntu
  rasterize fonts differently. In CI, a block is gated by its validate test plus
  a same-machine render-twice hash.
- **WebGL's two machines** are the macOS and Ubuntu CI runners. Today nothing
  Chromium rasterizes matches byte for byte across them, so Phase 4b is planned
  as a short spike and a written report. If the spike passes, WebGL ships. If
  it fails, it is dropped.
- **ffmpeg in CI.** ffmpeg is added to the Ubuntu test job. Without it, render,
  hash and PSNR tests skip themselves and would pass without testing anything.
  macOS stays as it is, and the PR body carries local measured runs for macOS.
- **Gate 1 PR-walkthrough prompt.** It uses mono text in place of a code diff,
  because the `code` element lands in Phase 2. The Gate 3 benchmark uses the
  real `code-diff` block.
- **Captioned eval prompts are SRT- or VTT-sourced.** Voice-sourced captions
  need the on-demand Kokoro install, about 250 MB plus a 90 MB model, which the
  eval does not install. Voice captions are tested locally. `voice.mjs` gains a
  sentence-timing sidecar, because today it keeps only the total duration.

### This session's calls after the plan review (owner may override)

- **Gate 2 uses a benchmark subset.** It runs 10 of the 12 prompts, leaving
  out the two that need Phase 3 features (chart race and map). The bar is at
  least 9 of 10 valid, and all 10 built specs pass the new audits. The full 12
  run at Gate 3.
- **Opacity in transitions.** Opacity is allowed in transitions alongside CSS
  transforms, `clip-path` and `filter`. Fade and crossfade already use it.
- **Eval spend stop rule.** At most one rerun of failed ids per gate. The plan's
  Status block keeps a running total of billed Haiku runs. Before any run that
  would take the total past 75, the agent stops and asks the owner.
- **CI for the WebGL spike.** `test.yml` gains a `workflow_dispatch` trigger and
  a dedicated macOS node job. The spike runs from the branch with
  `gh workflow run`, so no PR is needed first.
- **Trailer.** Commits end with AGENTS.md's
  `Co-Authored-By: Claude <noreply@anthropic.com>`. The orchestrating session
  runs every commit.

## Constraints

- **Gates are sequential.** Phase N+1 starts only after Gate N passes.
- **Order.** The small items land first: explainer KPI polish, then the harness
  edits, then the make-motion phases. Gate 3 work never holds them up.
- **Commit boundaries.** Each gate is a commit boundary the branch could ship
  from: tests green, docs and CHANGELOG synced for what has landed.
- **Status block.** The implementation plan carries a Status block, updated at
  each gate. This work spans many context compactions; a resumed session reads
  the Status block first.
- **Docs move with features.** README, USAGE, `references/schema.md`, SKILL.md,
  CHANGELOG, the feature page and catalog counts all move with each feature.
  AGENTS.md's cross-surface rules and `scripts/sweep_counts.py` apply.
- **Version bumps.** One plugin version bump per gate in the CHANGELOG. The
  final version number is left to the builder.

## Left to the builder

- The exact JSON field names and shapes, within the rules above.
- The video cache format (JPEG quality or per-chunk decode), and where the cache
  lives.
- The 12 benchmark prompt texts, written to cover the six categories as listed.
- The cutout model choice between MODNet and BiRefNet.
- Which make-explainer plan sections the storyboard step uses.
