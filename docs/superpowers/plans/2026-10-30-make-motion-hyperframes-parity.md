# make-motion HyperFrames Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring make-motion to coverage of HyperFrames' six "What you can build" categories (footage, captions, a block library, quality audits, transitions, camera, code, batch, beats, maps, cutouts) while staying spec-first, small-model writable, deterministic and offline.

**Architecture:** Every feature is a JSON field, element type or block. Browser-safe logic (block expansion, caption grouping, format presets, transition and camera math) lives under `template/` beside `defaults.mjs` and `audio.mjs`, so the validator, the render page, `check.mjs` and `render.mjs` share one implementation. Node-only work (ffprobe, the video frame cache, beat detection, loudness, cutouts) lives under `scripts/lib/`. Four phases, three gates; each gate is a commit boundary with a Haiku eval run, a render-twice hash check and synced docs.

**Tech Stack:** Node >= 20 ESM, `node:test`, Playwright Chromium (existing dependency), ffmpeg/ffprobe (system), Ajv, anime.js 4, Vega-Lite. New, exact-pinned: shiki (MIT), lottie-web (MIT), world-atlas and us-atlas (ISC); on demand: onnxruntime-node plus MODNet weights (Apache-2.0).

**Spec:** `docs/superpowers/specs/2026-10-30-make-motion-hyperframes-parity-design.md` (read it first; this plan only decides what the spec leaves open).

## Status

A resumed session reads this table first, then `git log --oneline main..HEAD`; the newest `feat(make-motion)` subject names the task in flight. Update the table in the same commit as the gate. A commit cannot hold its own SHA, so a gate row reads `passed (this commit)` in the gate commit, and the next commit that edits this table (the next gate's; Task 28's for Gate 3) replaces it with the real SHA. The last row keeps `(this commit)`.

| Milestone | State | Commit |
|---|---|---|
| Base: last commit of the two sibling plans (Gate 1's review diff starts here) | — | — |
| Phase 0: verification machinery (Tasks 1–3) | not started | — |
| Gate 1 (Task 10) | not started | — |
| Gate 2 (Task 17) | not started | — |
| Gate 3 (Task 27) | not started | — |
| Phase 4a: cutouts (Task 28) | not started | — |
| Phase 4b: WebGL spike (Task 29) | not started | — |

Billed Haiku runs so far: **0 of 75** (the spec's budget is 65–75). Planned: Gate 1 15 (13 items + 2 benchmark), Gate 2 18 (8 items + 10 benchmark), Gate 3 28 (16 items + 12 benchmark), Phase 4 up to 2 (`item-block-text-behind-subject`; `item-transition-gl` only if GL ships) = 63. Each gate allows one rerun of its failed ids, no more. After every eval run, add the number of prompts it ran to this line in the same commit. Before any run that would take the total past 75, stop and ask the owner.

Dependency pins (filled in by the task that adds each; `npm view <pkg> version` at that moment):

| Package | Pin | Added in | `npm audit` |
|---|---|---|---|
| shiki | — | Task 14 | — |
| lottie-web | — | Task 21 | — |
| world-atlas | — | Task 22 | — |
| us-atlas | — | Task 22 | — |
| onnxruntime-node (on demand) | — | Task 28 | audit-on-demand-deps.sh: — |
| MODNet weights URL + sha256 | — | Task 28 | — |

## Global Constraints

Paths: `<skill>` = `plugins/portable-artifacts/skills/make-motion`, `<pa>` = `plugins/portable-artifacts`. Every other path is repo-relative. The eval folder is `<pa>/eval/`.

- **Spec-first.** The model writes only JSON. Every capability is a field, an element type or a block; the model never writes code (spec design rule 1).
- **Small-model writable.** Each new field or block gets one Haiku eval prompt in `<pa>/eval/prompts/motion-items.json`, run once. Of each batch of about 10 new-item prompts, at least 9 must be valid on the first build; for a batch of n the bar is `ceil(0.9 × n)` (13 → 12, 8 → 8, 16 → 15). Results are reported as measured, with the exact command.
- **Backward-compat hash step.** Before a task that touches the renderer, timeline, server or encoder, run `renderHash` on `references/examples/q3-revenue.json` and `test/fixtures/ok-crossfade.json` (`--fps 10 --size 320x180`) and note both hashes; after the change the same command gives the same hashes on that machine. A step, never a committed constant: hashes differ between macOS and Ubuntu.
- **Deterministic.** Same spec, same media, byte-identical MP4. Every feature task adds a render-twice-and-hash test through `renderHash()` (Task 2), which sets `SOURCE_DATE_EPOCH=1793318400` (30 Oct 2026 00:00 UTC) because `plan()` in `render.mjs` stamps `buildDate()` (`<pa>/shared/provenance.mjs:36`) into the MP4 `comment`. Docs say: frames and audio are identical; the provenance date differs by day unless `SOURCE_DATE_EPOCH` is set. Shared provenance behaviour does not change.
- **Offline at render.** No network at validate, preview, check or render. The CSP (`scripts/lib/server.mjs:92`) and `guardNetwork()` (`scripts/lib/browser.mjs:29`) are the guarantee. The only downloads are one-time installs the user agreed to through the doctor.
- **OSI licences only.** No GSAP, no Remotion, no non-commercial weights. Approved: shiki, lottie-web, world-atlas, us-atlas, onnxruntime-node, MODNet or BiRefNet weights. Each pinned to an exact version (`"pkg": "x.y.z"`, no caret), installed with `npm --prefix <skill> install <pkg>@x.y.z --save-exact`, then `npm --prefix <skill> audit` must report 0 vulnerabilities (fix transitive advisories with exact `overrides`). On-demand installs go through `scripts/audit-on-demand-deps.sh` instead. Add a row to the Licences table in `<pa>/README.md` for each.
- **Opt-in and backward compatible.** A spec without a new field renders as before: every existing test keeps passing with its expectations unchanged, every file in `references/examples/` stays valid, and the exact argument arrays in `test/ffmpeg.test.mjs` stay unchanged. The only edits to existing test files are Task 1's `requireRender` swap and Task 5's skip for video examples. New ffmpeg args appear only when a new field is used. **Examples folder rule:** `validate.test.mjs` and `check.test.mjs` loop over every `*.json` directly in `references/examples/` and require a valid motion spec of 15 s or less that passes `check.mjs` with no stderr. So only motion specs go there; data side-files (batch rows, beats, Lottie JSON) go in `references/examples/data/`, and the 30 s benchmark spec in `test/fixtures/`. Neither folder is read by those loops.
- **Fails helpfully.** Each feature ships validator errors that name the fix, a `check.mjs` rule wherever it can go wrong visually, and one example in `references/examples/`.
- **Where new code goes.** Anything the render page needs is browser-safe (no Node imports) under `template/`; Node-only code under `scripts/lib/`. `withDefaults()` (`template/defaults.mjs:132`) is imported by the renderer, the timeline, `check.mjs` and `render.mjs`: block expansion and format presets happen inside it so all four see plain elements.
- **A new element field or type touches all of:** `element.properties`, `FIELDS[type]`, `REQUIRED[type]` and `ANIMATABLE[type]` in `scripts/lib/spec.mjs:23-97`; `buildElement()` in `template/renderer.mjs:207`; the state object in `template/timeline.mjs:82`; the Elements table in `references/schema.md`; the Types bullet in `SKILL.md`; the make-motion rows in the skill `README.md` and `<pa>/README.md`. (`<pa>/USAGE.md` section 5 and `docs/features/portable-artifacts.html` update at the gate commit; see Docs move with features.)
- **New asset kinds** (video, captions, lottie, cutouts) must be added to `referencedAssets()` (`scripts/lib/server.mjs:150`) and `MIME` (`server.mjs:26`) or the preview 404s them; new vendor packages to `VENDOR_ROOTS` (`server.mjs:35`).
- **Shared code** is edited only in `<pa>/shared/`, then `node <pa>/bin/sync-shared.mjs` copies it into every `skills/*/shared/`; CI runs `--check`. Never edit a `skills/*/shared/` copy.
- **SKILL.md frontmatter** stays single-line `key: value` (`<pa>/bin/test/frontmatter.test.mjs`).
- **Docs move with features.** In the task that lands a feature: `references/schema.md`, `SKILL.md`, the skill `README.md` and `<pa>/README.md` rows, and the eval prompt (Tasks 2, 7 and 25 also name `<pa>/USAGE.md` in their own steps). At each gate commit, covering every task since the previous gate: `<pa>/CHANGELOG.md`, `<pa>/USAGE.md` section 5, `docs/features/portable-artifacts.html` and the `plugin.json` bump. Run `python3 scripts/sweep_counts.py --check` before each gate commit.
- **Version model.** The KPI sibling plan writes a `## [Unreleased]` section in `<pa>/CHANGELOG.md` and does not bump `plugin.json`; the harness sibling plan never touches the CHANGELOG. Gate 1 renames that `## [Unreleased]` section into its first version heading (the next minor above `plugin.json`'s current version), appends this plan's bullets under it, bumps `plugin.json` to that version, and retitles the feature page's 'Next release' heading (KPI's entry) to it. Gate 2, Gate 3 and Task 29 Step 3 each add their own heading and one minor bump. CI's `plugin-version-guard` requires a bump on the PR.
- **Gates are sequential.** Phase N+1 starts only after Gate N passed and its Status row reads `passed (this commit)` or carries the SHA. Each gate is a commit the branch could ship from.
- **The bash guard** in this worktree refuses the literal word `eval` in a command. Write the eval folder as `ev[a]l` in every shell command (`node ev[a]l/run-eval.mjs …`, `ls ev[a]l/prompts`); the plan writes `eval/` in prose only.
- **Haiku eval command** (host `claude`, model `haiku`): `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set <benchmark|items> [--only id,id]`. Copy each gate's `summary.md` to `<pa>/eval/results/summary-motion-gate<N>-<date>.md`. **Spend:** at most one rerun of failed ids per gate; the Status block keeps the running total of billed runs against the 75 cap, and the agent stops and asks the owner before any run that would exceed it.
- **Porting from HyperFrames** (Apache-2.0, https://github.com/heygen-com/hyperframes): rules and ideas need no attribution; code or assets need a `NOTICE` entry at `<pa>/NOTICE` and a file-header line.
- **Commits** are per task, conventional (`feat(make-motion): …`, `test(make-motion): …`, `chore(ci): …`). The orchestrating session runs every commit and push; implementer subagents never commit or push (each task's last step says "Commit" for the orchestrator). Every message ends with exactly one trailer line, per AGENTS.md "Commit / PR trailers" (no `Claude-Session` line, no model name):

  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

  Push the branch at each gate. Open no PR from this plan; the orchestrator does.
- **Dispatch.** Implementers are executor tier (Sonnet, effort high). Gate reviewers are reviewer tier (Opus, effort medium), report-only (never write files, logs or docs), and their prompt carries this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them." The orchestrator applies the gate afterwards: CRITICAL or HIGH findings are fixed before the gate commit; MEDIUM are fixed or listed as follow-ups under Status.
- **Command forms.** No `cd`, no `&&` chains, no shell variables and no `/tmp` paths in a step (the worktree Bash guard refuses them): run from the repo root with path prefixes, put scratch files under the gitignored `.scratch/`, and write any multi-step procedure as a script with the Write tool. Test commands: `npm --prefix <skill> test` (= `node --test "test/**/*.test.mjs"` in `<skill>`); `node --test "<pa>/ev[a]l/test/**/*.test.mjs"`; `node --test "<pa>/bin/test/*.test.mjs"`; `node --test "<pa>/shared/test/*.test.mjs"`. Anywhere else this plan writes a bare `npm test`, `node --test test/…`, `node scripts/…` or `node ev[a]l/run-eval.mjs`, read it as the same command with the prefix (`node --test <skill>/test/x.test.mjs`, `node <skill>/scripts/render.mjs …`, `node <pa>/ev[a]l/run-eval.mjs …`); neither the skill scripts nor `run-eval.mjs` depend on the working directory. Render tests skip without a browser or ffmpeg unless `PA_REQUIRE_RENDER=1` (Task 1).
- **Sibling plans** (`2026-10-30-explainer-kpi-polish.md`, `2026-10-30-harness-learnings.md`) land on this branch first. Start Task 1 from their last commit and record it in the Status Base row; do not edit files they changed except where a task here names them. The KPI plan inserts an import and a `warnIfStaleCopy()` call into `main()` of `scripts/render.mjs`, so this plan anchors `render.mjs` by function name (`parseArgs`, `planAudio`, `plan`, `renderVideo`, `openPage`, `main`), never by line number; every other line number is a hint from before the sibling plans, so find the symbol.

## Review Focus

Failure modes the spec implies that no task's happy path covers, most likely to bite first. Each has a test in the task named.

1. A video whose frame rate differs from the output fps, or whose clip is shorter than the time it is on screen: frames are resampled exactly at the output fps, the last frame holds after `trimEnd`, and a `trimEnd` past the clip length is a validator error naming the clip length. (Task 5)
2. A captions file with out-of-order cues, a cue with no words, a 200-word cue, or emoji and CJK words: grouping never yields an empty group, a zero-length group, a group of more than 6 words or 42 characters, or a one-word group beside a neighbour within 0.5 s; a long-word or CJK group wraps inside the caption zone; an order problem names the cue line. (Task 8)
3. Block params with hostile or oversized text (a 40-word title, `</script>` in a label, an empty `items` list): each block caps lengths and counts in its params schema with an error at `params.<field>`, and every block example passes `check.mjs`. (Task 9)
4. `--workers 4` on a spec with fewer frames than workers or an odd frame count, and a worker page that crashes mid-range: ranges never overlap or drop a frame, and a crash fails the render naming the frame index and leaves no `.partial.mp4`. (Task 15)
5. A `{{var}}` whose value turns a `src` into `../x.png` or a colour into `url(x)`, and a batch row missing a declared variable with no default: the validator reports the row index and the JSON path before any frame renders. (Task 16)

## File Structure

New (under `<skill>` unless noted):

- `template/groups.mjs` — `flattenElements()`; group path and depth helpers (browser-safe).
- `template/formats.mjs` — `FORMATS`, `safeMargin()`, `captionZone()`.
- `template/captions.mjs` — caption file parsers, word timing, grouping, style timing (browser-safe).
- `template/blocks/index.mjs` + `template/blocks/<name>.mjs` — one file per block; `expandBlocks()`.
- `template/transitions.mjs` — the nine transition names and the style of a layer at progress p.
- `template/camera.mjs` — camera transform and seeded shake.
- `template/vars.mjs` — `{{name}}` substitution.
- `template/code-theme.mjs` — TextMate theme built from the active theme's tokens.
- `template/grade.mjs` — SVG filter markup for grade presets.
- `template/lottie-guard.mjs` — rejects remote assets and expressions in a Lottie JSON.
- `template/maps.mjs` — named atlas datasets.
- `scripts/lib/video.mjs` — ffprobe, frame cache key, frame decode.
- `scripts/lib/audits.mjs` — the four Phase 2 audits, pure functions over samples.
- `scripts/lib/workers.mjs` — parallel frame capture feeding one encoder.
- `scripts/lib/batch.mjs` — batch rows, output templates, manifest.
- `scripts/lib/beats.mjs`, `scripts/beats.mjs` — onset detection and the CLI.
- `scripts/lib/loudness.mjs` — two-pass loudnorm.
- `scripts/lib/cutout.mjs`, `scripts/cutout.mjs` — MODNet matting (Phase 4a).
- `scripts/blocks.mjs`, `scripts/storyboard.mjs` — CLIs.
- `references/examples/blocks/<name>.json`, `references/blocks/<name>.png` — one example and one golden contact sheet per block.
- `test/helpers/render.mjs` — `renderHash()`, `requireRender()`, test media generators.
- `<pa>/eval/prompts/motion-benchmark.json`, `<pa>/eval/prompts/motion-items.json`, `<pa>/eval/fixtures/data/{captions.srt,captions.vtt,clip.mp4,music.wav,rows.json}`.

Modified (main ones): `scripts/lib/spec.mjs`, `template/defaults.mjs`, `template/renderer.mjs`, `template/timeline.mjs`, `template/styles.css`, `template/preview-ui.mjs`, `scripts/render.mjs`, `scripts/check.mjs`, `scripts/lib/ffmpeg.mjs`, `scripts/lib/server.mjs`, `scripts/lib/voice.mjs`, `scripts/lib/requirements.mjs`, `<pa>/shared/doctor.mjs`, `<pa>/eval/run-eval.mjs`, `<pa>/eval/lib.mjs`, `.github/workflows/test.yml`, `scripts/audit-on-demand-deps.sh`, docs listed in Global Constraints.

---

# Phase 0: verification machinery

### Task 1: ffmpeg in CI and a skip that can be made to fail

**Files:**
- Modify: `.github/workflows/test.yml` (`on:` gains `workflow_dispatch:`; the `node` job gains an ffmpeg install step and `PA_REQUIRE_RENDER` on its make-motion step)
- Create: `test/helpers/render.mjs`
- Modify: `test/render-smoke.test.mjs:53-55` (and every test that skips on "browser or ffmpeg unavailable")
- Test: `test/helpers/render.test.mjs`

**Interfaces:**
- Produces: `async requireRender(t, { skipStatic = false } = {}) -> { ffmpeg: string, ffprobe: string } | null` (`skipStatic` is forwarded to `findFfmpeg`) — returns the binaries, or calls `t.skip('browser or ffmpeg unavailable')` and returns null; when `process.env.PA_REQUIRE_RENDER === '1'` it throws `new Error('PA_REQUIRE_RENDER=1 but <what> is unavailable')` instead of skipping.
- Produces: `findFfprobe({ ffmpeg } = {}) -> string | null` in `scripts/lib/ffmpeg.mjs`, synchronous (the validator calls it with no argument): `$FFPROBE_PATH` if executable, else `ffprobe` on PATH, else the `ffprobe` sibling of `ffmpeg` (the argument, else `$FFMPEG_PATH`) (the `ffprobeFor()` logic from `test/render-smoke.test.mjs:25` moves here), else null.

- [ ] **Step 1: Write the failing tests**

```js
test('requireRender throws instead of skipping when PA_REQUIRE_RENDER=1 and ffmpeg is missing', async () => {
  // child process: spawnSync(process.execPath, [script], { env: { PATH: '/nonexistent', PA_REQUIRE_RENDER: '1' } }). The env is replaced, not inherited,
  // so neither PATH nor FFMPEG_PATH finds ffmpeg; the script calls requireRender(t, { skipStatic: true }) to rule out an installed ffmpeg-static.
  assert.match(r.stderr, /PA_REQUIRE_RENDER=1 but ffmpeg is unavailable/); assert.notEqual(r.status, 0);
});
test('findFfprobe honours FFPROBE_PATH and falls back to the ffmpeg sibling', () => { /* temp dir with executable "ffprobe" beside a fake ffmpeg */ });
```

- [ ] **Step 2: Run to verify they fail** — `node --test <skill>/test/helpers/render.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** `test/helpers/render.mjs` and `findFfprobe()`; replace each test file's local `haveBrowser`/`haveFfmpeg`/`ffprobeFor` with `requireRender(t)` (behaviour without the env var is identical: skip).
- [ ] **Step 4: Add ffmpeg to CI.** Add `workflow_dispatch:` under `on:`. In the `node` job, add a step before make-motion named `install ffmpeg` with `run: sudo apt-get update` and `sudo apt-get install -y ffmpeg` (two lines of one `run: |` block), and give the make-motion step `env: { PA_REQUIRE_RENDER: '1' }`. The macOS `test` job is unchanged (the PR body carries local macOS measured runs). CI cannot show this working before it runs: Gate 1 Step 7 has the orchestrator trigger the workflow by dispatch.
- [ ] **Step 5: Prove the guard fires** — the Step 1 child-process test is the proof that `PA_REQUIRE_RENDER=1` fails instead of skipping. Then break it once: temporarily make the `PA_REQUIRE_RENDER` branch of `requireRender` call `t.skip` instead of throwing, run `node --test <skill>/test/helpers/render.test.mjs` → that test FAILS, restore the branch → PASS. Finally `npm --prefix <skill> test` → PASS (skips or runs as before).
- [ ] **Step 6: Commit** — `chore(ci): ffmpeg on the Ubuntu node job; PA_REQUIRE_RENDER turns render skips into failures`.

### Task 2: render-twice hash helper and the determinism docs sentence

**Files:**
- Modify: `test/helpers/render.mjs`
- Test: `test/determinism.test.mjs`
- Modify: `references/schema.md` (CLI section), `README.md` (Scripts), `<pa>/USAGE.md` section 5

**Interfaces:**
- Produces: `async renderHash(specPath, args = [], { env = {} } = {}) -> { sha256: string, out: string, stdout: string }` — runs `scripts/render.mjs <spec> --out <tmp>/v.mp4 …args` with `SOURCE_DATE_EPOCH=1793318400` merged into `env`, asserts exit 0, returns the file's SHA-256.
- Produces: `async assertRendersIdentically(t, specPath, args) -> string` — two `renderHash` runs, `assert.equal(a.sha256, b.sha256)`, returns the hash.
- Produces: `makeTestVideo(ffmpeg, file, { seconds = 2, fps = 10, size = '320x180', source = 'movingbox', audio = false })` — `ffmpeg -f lavfi -i <graph> [-f lavfi -i sine=frequency=440:duration=…] -pix_fmt yuv420p -y file`, where `movingbox` is `color=c=0x224466:size=<size>:rate=<fps>:duration=<seconds>,drawbox=x='t*100':y=40:w=60:h=60:color=white:t=fill` (every frame differs, flat areas compress near-losslessly, so a one-frame misalignment is visible) and `smptebars` is `smptebars=size=…:rate=…:duration=…` (for the committed eval `clip.mp4` only).

- [ ] **Step 1: Write the failing tests** (`test/determinism.test.mjs`)

```js
test('q3-revenue renders byte-identical twice at 320x180 / 10 fps', async (t) => { if (!await requireRender(t)) return; await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']); });
test('without SOURCE_DATE_EPOCH the comment tag carries today, with it 30 Oct 2026', async (t) => { /* ffprobe -show_entries format_tags=comment on both renders */ });
```

- [ ] **Step 2: Run** → FAIL (helper missing). **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs.** Add to schema.md CLI, README Scripts and USAGE §5 the sentence: "Two renders of the same spec and media give identical frames and audio; the MP4 `comment` tag carries the build date, so the files differ by day unless `SOURCE_DATE_EPOCH` is set."
- [ ] **Step 6: Commit** — `test(make-motion): render-twice hash helper; document SOURCE_DATE_EPOCH`.

### Task 3: eval `--set`, the 12 benchmark prompts, a `check` column and fixtures

**Files:**
- Modify: `<pa>/eval/run-eval.mjs:12-23,55`, `<pa>/eval/lib.mjs:16-22,238-278,280-300`
- Create: `<pa>/eval/prompts/motion-benchmark.json`, `<pa>/eval/prompts/motion-items.json` (empty array now; Tasks 4–26 append), `<pa>/eval/fixtures/data/captions.srt` (6 cues, 24 words, English), `captions.vtt` (same text, WebVTT header), `clip.mp4` (2 s, 320x180, `smptebars`, silent, committed), `music.wav` (10 s mono 8 kHz click track at 120 BPM: a 20 ms 1 kHz burst every 0.5 s on silence, from `writeWav({ clickBpm: 120 })`; a steady tone has no onsets, and Task 18's `item-beats` needs beats), `rows.json` (3 rows: `{ "name", "city", "count" }`)
- Modify: `<pa>/eval/README.md`, `<skill>/test/helpers/wav.mjs` (new options `clickBpm`, default off, and `clickHz = 1000`)
- Test: `<pa>/eval/test/lib.test.mjs`, `<skill>/test/helpers/wav.test.mjs`

**Interfaces:**
- Produces: `--set <name>` → reads `prompts/<skill>-<name>.json`; default (no flag) stays `prompts/<skill>.json`; unknown set exits 2 with `unknown --set "x"; available for motion: benchmark, items`; `--only` applies after `--set`.
- Produces: `SKILLS.motion.checkCmd: (skill, spec) => [path.join(skill, 'scripts/check.mjs'), spec, '--json']`; `scoreRun` adds `checkOk: boolean | null` (null when the skill has no `checkCmd`, or the check printed `skipped`), run only when `outputOk`; `summarize` adds a `check` column (`✓`, `✗`, `-`).
- Produces: the 12 benchmark prompt ids, two per category, in this order: product launch `launch-teaser`, `launch-feature-trio`; PR walkthrough `pr-walkthrough` (asks for the diff "as monospace text lines starting with + and -"), `pr-code-diff` (asks for "a code-diff block"); data viz `chart-race`, `map-regions`; captioned social `captioned-social` (16:9, `data/captions.srt`, "plain captions"), `captioned-vertical` (9:16, `data/captions.vtt`, karaoke captions, `data/music.wav`); docs-to-video `docs-steps`, `docs-faq`; templated batch `batch-welcome` (declares `vars` name and city, "so it can be rendered per row of data/rows.json"), `batch-kpi-cards`. Every prompt names a duration of 10–30 s.

- [ ] **Step 1: Write the failing tests**

```js
test('--set picks prompts/<skill>-<set>.json and an unknown set exits 2 listing the sets', ...);   // spawn run-eval with a fake host dir
test('scoreRun records checkOk from checkCmd and null when the check skips', ...);               // fake skill with scripts/check.mjs printing {"ok":true} / {"ok":true,"skipped":true}
test('the motion benchmark file has 12 prompts, unique ids, two per category tag', ...);          // each prompt carries "category": one of the six
test('writeWav clickBpm 120 at 8 kHz: 160 samples of burst at sample 0, 4000, 8000 …, exact zeros between; without clickBpm the tone output is byte-identical to before', ...);   // wav.test.mjs
```

- [ ] **Step 2: Run** `node --test "<pa>/ev[a]l/test/**/*.test.mjs"` and `node --test <skill>/test/helpers/wav.test.mjs` → FAIL. **Step 3: Implement.** Generate `clip.mp4` with `makeTestVideo` once and commit it (about 30 KB). **Step 4: Run** → PASS.
- [ ] **Step 5: README.** Document `--set`, the `check` column and the fixtures.
- [ ] **Step 6: Commit** — `feat(eval): --set prompt sets, motion benchmark prompts, check column`.

---

# Phase 1: footage, captions, blocks

### Task 4: `group` element

**Files:**
- Create: `template/groups.mjs`
- Modify: `scripts/lib/spec.mjs` (schema, `FIELDS`, `ANIMATABLE`, `checkIds`, `checkElement` recursion), `template/defaults.mjs:141-152`, `template/timeline.mjs:80-90`, `template/renderer.mjs:207-248,383-414`, `template/styles.css`, `scripts/check.mjs:64-83,181-190`
- Create: `references/examples/group-card.json`
- Test: `test/group.test.mjs`

**Interfaces:**
- Produces: element `{ "type": "group", "id", "x", "y", "opacity"?, "scale"?, "rotate"?, "keyframes"?, "children": [element…] }`; a child's `x`,`y` are relative to the group centre; `ANIMATABLE.group = ['opacity','x','y','scale','rotate']`; `MAX_GROUP_DEPTH = 3`; `children` 1–40 items.
- Produces: `flattenElements(elements, basePath = '') -> Array<{ el, path, depth }>` (depth-first, document order; `path` like `scenes[0].elements[2].children[1]` once the caller prefixes the scene) and `isGroup(el)`.
- Renderer: a group is a `.el.group` node of width and height 0 (so `translate(-50%,-50%)` is a no-op) holding its children's nodes; the same transform formula as `renderer.mjs:399`. Every node carries `data-path`.
- Timeline: each child gets its own state entry keyed by id; `sceneOf` covers children.
- check.mjs: `measure` returns `layer.querySelectorAll('.el:not(.group)')` in document order; `sampleScene` compares ids against `flattenElements(scene.elements).filter(!isGroup)`; rules read boxes as before (a child's box is already in canvas pixels through `getBoundingClientRect`).

- [ ] **Step 1: Write the failing tests**

```js
test('child ids are global: a duplicate inside a group is reported at its nested path', () => assert.deepEqual(errs(spec), ['scenes[0].elements[1].children[0].id: duplicate id "a" (first used at scenes[0].elements[0].id)']));
test('depth 4 is rejected naming the limit', () => assert.match(errs(spec)[0], /scenes\[0\].elements\[0\].children\[0\].children\[0\].children\[0\].children: groups nest at most 3 deep/));
test('a keyframe prop not in POSE is rejected on a group', () => assert.match(errs(spec)[0], /not animatable on group; animatable: opacity, x, y, scale, rotate/));
test('nested spec renders pixel-identical to its hand-flattened equivalent at 0.5 s and 1.5 s', async (t) => {
  // group at (960,540) with text child at (0,-100) and rect child at (0,60) vs flat text at (960,440) and rect at (960,600)
  assert.ok(Buffer.compare(await framed(nested, 0.5), await framed(flat, 0.5)) === 0);
});
test('check.mjs judges a child: a child text held outside the safe area is a problem at its nested path', ...);
test('group-card example renders byte-identical twice', ...);
```

- [ ] **Step 2: Run** `node --test test/group.test.mjs` → FAIL. **Step 3: Implement** (spec, defaults, timeline, renderer, check). **Step 4: Run** `npm test` → PASS, existing suites untouched.
- [ ] **Step 5: Docs + eval prompt.** schema.md Elements row; SKILL.md Types bullet ("`group` holds children positioned relative to its centre and moves them as one"); append `{ "id": "item-group", "prompt": … }` to `motion-items.json`.
- [ ] **Step 6: Commit** — `feat(make-motion): group element`.

### Task 5: `video` element, frame cache, clip audio in the mix

**Files:**
- Create: `scripts/lib/video.mjs`
- Modify: `scripts/lib/spec.mjs` (schema, `FIELDS.video`, `REQUIRED.video = ['src','width','height']`, `checkVideo`), `scripts/lib/ffmpeg.mjs:47-54` (`trackChain`), `scripts/render.mjs` (`planAudio`, `plan`), `scripts/lib/server.mjs:26,150,205` (MIME, `referencedAssets`, routes `/frames.json` and `/frames/<key>/<n>.jpg`), `template/renderer.mjs` (`buildElement`, `makeApply`, `makeMotion.seek` returns a promise), `scripts/lib/requirements.mjs`, `references/schema.md`, `SKILL.md`, `test/validate.test.mjs` and `test/check.test.mjs` (the example loops only, see Interfaces)
- Create: `references/examples/footage-intro.json` + `references/examples/footage/clip.mp4` (2 s smptebars, 320x180)
- Test: `test/video.test.mjs`

**Interfaces:**
- Element: `{ "type": "video", "id", "x", "y", "src", "width", "height", "fit"? ("contain"|"cover"|"fill", default contain), "trimStart"? (seconds into the file, default 0), "trimEnd"? (default clip length), "offset"? (scene seconds before playback starts, default 0; the first frame holds before it, the last frame holds after the trimmed range ends), "mute"? (false), "volume"? (0–1, default 1), "keyframes"? }`. `ANIMATABLE.video = POSE`. Extensions `VIDEO_EXTENSIONS = ['mp4','mov','webm','m4v']`.
- `probeVideo(ffprobe, file) -> { duration, width, height, fps, hasAudio, hasAlpha } | { error }` (`ffprobe -v error -show_streams -show_format -of json`; `hasAlpha` when `pix_fmt` matches `/^(yuva|rgba|argb|bgra|gbrap)/`).
- Validator (`checkVideo`): path rules as image; extension; when the spec has any video element, `findFfprobe()` null → one error at `scenes[i].elements[j].src`: `ffprobe not found (needed to check video elements); install ffmpeg: <doctorCommand('--fix','ffmpeg')>`; `trimEnd > duration` → `trimEnd 12 exceeds the clip length 8.5s`; `trimStart >= trimEnd` → `trimStart must be less than trimEnd`.
- `frameCacheKey({ sha256, trimStart, trimEnd, fps, width, height, fit, alpha }) -> string` (sha256 hex of the JSON); `CACHE_ROOT = <skill>/.cache/video` (already gitignored by `plugins/portable-artifacts/**/.cache/`); `decodeFrames(ffmpeg, { file, trimStart, trimEnd, fps, width, height, fit, alpha, dir }) -> { count }`: `ffmpeg -y -ss trimStart -to trimEnd -i file -vf "fps=<fps>,scale=W:H:force_original_aspect_ratio=<decrease|increase>" <-q:v 1 dir/%06d.jpg | dir/%06d.png when alpha>`; `fit: fill` scales to exactly W:H. Writes `dir/done.json` `{ count }` last; a dir without it is re-decoded.
- `prepareVideo(spec, dir, ffmpeg, ffprobe, fps) -> { [elementId]: { key, count, fps, ext } }` in render.mjs's `plan()`; ffmpeg is looked up whenever the spec has a video element, contact sheets included. Server: `startServer({ …, videoFrames, frameRoot = CACHE_ROOT })`; `GET /frames.json` → `videoFrames`; `GET /frames/<key>/<n>.<ext>` only for keys in `videoFrames`.
- Renderer: render mode fetches `/frames.json`; a video element is an `<img>` whose `src` is frame `clamp(round((sceneT - offset) * fps), 0, count - 1)`; `seek(sec)` returns `Promise.all(pending img.decode())` (`renderVideo` in `render.mjs` already awaits `page.evaluate`). Preview mode uses a `<video preload="auto" muted>` seeked to `trimStart + (sceneT - offset)` (approximate, documented).
- Audio: `planAudio` adds, for each video element with `hasAudio && !mute`, `{ file, start: sceneStart + offset, end: min(total, start + trimEnd - trimStart), volume, fadeIn: 0, fadeOut: 0, clipStart: trimStart }`; `trackChain` prepends `atrim=start=<clipStart>,asetpts=PTS-STARTPTS` only when `track.clipStart > 0` (existing `encodeArgs` arrays unchanged).
- Example loops: `specHasVideo(spec) -> boolean` in `video.mjs` (via `flattenElements`). `validate.test.mjs` ('every example is valid') and `check.test.mjs` (the per-example tests) skip an example for which `specHasVideo` is true when `findFfprobe()` (validate) or `requireRender(t)` (check, which needs the frame cache) finds no binary, and fail instead when `PA_REQUIRE_RENDER=1`. Without this, a machine with no ffmpeg fails 'every example is valid' with `ffprobe not found` instead of skipping. No other edit to those loops.
- Doctor: new requirement `videoCache()` in `requirements.mjs` (local object, id `cache`, `required: false`): `check` passes while `.cache/video` is under `CACHE_LIMIT_BYTES = 2 * 1024 ** 3`; `why` says `video frame cache is <n> GB; --fix cache clears it`; `fix.auto` removes the directory. The implementer reads `runFixes` (`<pa>/shared/doctor.mjs:478`) and, if it refuses a fix for a passing check, adds a `fixable: true` flag there (shared edit + sync) so `--fix cache` always runs.

- [ ] **Step 1: Write the failing tests**

```js
test('probeVideo reads duration, size, fps and hasAudio from a generated clip', ...);           // makeTestVideo with audio: true
test('trimEnd past the clip length and trimStart >= trimEnd are errors naming the numbers', ...);
test('a 15 fps clip rendered at 10 fps: decodeFrames yields round((trimEnd-trimStart)*10) frames', ...);   // Review Focus 1
test('frameCacheKey changes with every input and is stable', ...);
test('trackChain with clipStart 2 prepends atrim=start=2,asetpts=PTS-STARTPTS; without it the chain is unchanged', ...);
test('MP4 frame k matches cache frame k at PSNR >= 45 dB', async (t) => {
  // movingbox clip (the box moves 10 px per frame, so an off-by-one drops PSNR below 20 dB). This isolates the x264 loss only.
  // 320x180 canvas, video element 320x180 at (160,90), fps 10, render, then
  // ffmpeg -i out.mp4 -framerate 10 -i <cache>/%06d.jpg -lavfi "[0:v][1:v]psnr" -f null -  → parse "average:(\d+\.\d+)"
  assert.ok(average >= 45, `PSNR ${average}`);
});
test('MP4 frame k matches the source decoded independently, with trimStart 0.5 and a 15 fps source, at PSNR >= 40 dB', async (t) => {
  // The cache comparison above is circular for decode alignment: a wrong -ss/-to placement or fps rounding in decodeFrames shifts the
  // cache and the MP4 together. So decode the source a second way that shares no code with decodeFrames: ffmpeg -i clip.mp4 -vf fps=10 <tmp>/src_%06d.png
  // (no -ss, no -to), and compare MP4 frame k with source frame k + trimStart * fps (here k + 5), by the same psnr filter.
  // A one-frame shift gives < 20 dB; JPEG q1 plus x264 stays above 40 dB.
  assert.ok(average >= 40, `PSNR ${average}`);
});
test('a 1.5 s movingbox clip in a 2 s scene holds its last frame: frames at 1.6 s and 1.9 s equal the frame at 1.4 s, and differ from the frame at 1.0 s', ...);  // Review Focus 1
test('a video element without mute adds one AAC-mixed track; with mute the MP4 has no audio stream', ...);
test('footage-intro renders byte-identical twice', ...);
test('preview mode serves the clip under /assets with byte ranges and the render page under /frames/<key>/000001.jpg; an unknown key is 404', ...);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Docs + eval prompt** (`item-video`, uses `data/clip.mp4`). Document the cache location, format and `doctor --fix cache` in schema.md and README.
- [ ] **Step 6: Commit** — `feat(make-motion): video element with an exact-frame cache and clip audio in the mix`.

### Task 6: format presets and the caption zone

**Files:**
- Create: `template/formats.mjs`
- Modify: `scripts/lib/spec.mjs` (root `format`, cross-check with `size`), `template/defaults.mjs:134` (size from format), `scripts/check.mjs:33-46` (import `safeMargin` from formats; keep the `safeMargin` export), `references/schema.md` Root table, `SKILL.md`
- Create: `references/examples/vertical-hook.json` (9:16)
- Test: `test/formats.test.mjs`

**Interfaces:**
- Produces: `FORMATS = { '16:9': { size: [1920,1080], captionTop: 0.78 }, '9:16': { size: [1080,1920], captionTop: 0.72 }, '1:1': { size: [1080,1080], captionTop: 0.78 }, '4:5': { size: [1080,1350], captionTop: 0.72 } }`; `SAFE_MARGIN_PX = 60`, `SAFE_REFERENCE_SIDE = 1080`, `safeMargin(size)` (moved from check.mjs, same formula); `captionZone(size, format) -> { left, top, right, bottom }` = `{ safe, round(h * captionTop), w - safe, h - safe }` with `captionTop` 0.78 when `format` is undefined.
- Validator: `format` is an enum of the four; `format` with a `size` that differs → `size: [1920,1080] does not match format "9:16" (1080x1920); drop one of them`.

- [ ] **Step 1: Tests** — `withDefaults({format:'9:16',…}).size` is `[1080,1920]`; mismatch error text exact; `captionZone([1920,1080])` is `{60, 842, 1860, 1020}`; `captionZone([1080,1920],'9:16')` is `{60, 1382, 1020, 1860}`; vertical-hook example valid, passes check, renders identically twice.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs + eval prompt** (`item-format-vertical`). SKILL.md gains: "For a vertical or square clip set `format` (`16:9`, `9:16`, `1:1`, `4:5`) instead of `size`; keep captions in the caption zone the format defines."
- [ ] **Step 6: Commit** — `feat(make-motion): format presets with safe and caption zones`.

### Task 7: voice sentence-timing sidecar

**Files:**
- Modify: `scripts/lib/voice.mjs:119-133`, `scripts/voice.mjs:20-27`, `SKILL.md` step 2, `references/schema.md` CLI
- Test: `test/voice.test.mjs`

**Interfaces:**
- Produces: `sentenceTimes(chunks: Array<{ text, samples }>, sampleRate) -> Array<{ text, start, end }>` (cumulative, seconds rounded to 3 decimals); `sidecarPath(out) -> string` (`.wav` → `.json`); `synthesize()` returns `{ seconds, sentences }` and writes the sidecar `{ "sampleRate": 24000, "voice": "<voice>", "sentences": [...] }` beside the wav; `voice.mjs` prints a third line `<sidecar path>`.

- [ ] **Step 1: Tests** — `sentenceTimes([{text:'A.',samples:24000},{text:'B.',samples:12000}], 24000)` → `[{A,0,1},{B,1,1.5}]`; `sidecarPath('voice/intro.wav') === 'voice/intro.json'`; the existing synthesize test (mock tts) asserts the sidecar file content.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs.** SKILL.md step 2: "it also writes `voice/<scene-id>.json` with sentence times; use it as a captions `src`."
- [ ] **Step 6: Commit** — `feat(make-motion): voice.mjs writes a sentence-timing sidecar`.

### Task 8: captions track, six styles, caption-zone check

**Files:**
- Create: `template/captions.mjs`
- Modify: `scripts/lib/spec.mjs` (root `captions`), `template/defaults.mjs`, `template/renderer.mjs` (a stage-level `.captions` layer above scenes, below grain), `template/timeline.mjs` (nothing animates; captions are a pure function of time), `template/styles.css`, `scripts/lib/server.mjs` (`referencedAssets` + MIME `.srt`, `.vtt`), `scripts/check.mjs` (caption-zone rule), `references/schema.md`, `SKILL.md`
- Create: `references/examples/captioned-clip.json` + `references/examples/captioned-clip.srt`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Root: `"captions": [{ "src", "style"? ("plain"|"pill"|"karaoke"|"kinetic"|"boxed"|"typewriter", default "plain"), "scene"?, "at"? }]`, up to `MAX_CAPTION_TRACKS = 20`; timing anchors like audio (`trackStart`). `src` extension `srt`, `vtt` or `json`.
- `parseCaptions(text, ext) -> Array<{ text, start, end }>` words: SRT and VTT cues split into words, each weighted by its characters plus one separating space for every word but the last in the cue; word start = `cue.start + (cue.end − cue.start) × (weights before it) / (total weight)`, rounded to 3 decimals, and the last word ends exactly at `cue.end`; JSON: Whisper (`segments[].words[]` with `word|text`, `start`, `end`, or top-level `words`) used as given, or a voice sidecar (`sentences[]`) with the same weighting. Throws `CaptionError(message, line)`: `cue 3 (line 9): end 00:00:04,000 is before start`, `no captions found`.
- `groupWords(words, { maxWords: 6, minWords: 2, maxChars: 42, pauseSeconds: 0.15, mergeGapSeconds: 0.5, firstAt: 0.1 }) -> Array<{ start, end, words }>`: a new group starts after a word ending in `.`, `!` or `?`, after a gap of >= 0.15 s, when the group holds 6 words, or when adding a word would take the group past 42 characters (a CJK character counts as 1; a word is never split). Then every group of fewer than `minWords` (a 1-word group) is merged: into the next group when the gap to it is <= 0.5 s and the result keeps <= 6 words and <= 42 characters, else into the previous group under the same conditions, else it stays alone (a one-word track, or a word isolated by long pauses). The first group starts at `max(start, 0.1)`; each group ends at `min(own end, next start)` so one group is on screen at a time.
- `captionState(groups, style, t) -> { group, wordIndex, chars, popScale }`: `karaoke` marks the word with `start <= t < end`; `kinetic` scales a word from 1.15 to 1 over the 0.15 s after its start; `typewriter` shows `floor((t - group.start) / 0.035)` characters capped at the group length; others show the whole group.
- Renderer: one `.captions.style-<name>` div per track, centred in `captionZone(size, format)` with `max-width` = the zone width, `overflow-wrap: anywhere` and `text-wrap: balance` (a 42-character group wraps to at most two lines, which fit the zone height at every format), font size `48 * shortSide / 1080`, theme text colour, `pill`/`boxed` background the theme `surface` at 0.85 alpha; words are `<span class="word">`. Groups are computed once at mount; `apply(sec)` sets the text, `.on` and transforms.
- check.mjs rules (only when `spec.captions` is non-empty): (a) a visible text or counter whose box intersects the caption zone while held → problem `text "sub" sits in the caption zone (y >= 842) at 1.00s`; (b) `captionBoxProblem(box, zone, t) -> string | null` (pure, exported) reports `captions leave the caption zone (right) at 1.00s` when a visible `.captions` box is not inside the zone; check.mjs calls it for each captions layer at every sample.

- [ ] **Step 1: Tests** (exact values)

```js
test('a 4 s cue "Hello there big world" (weights 6, 6, 4, 5 of 21) gets starts 0 / 1.143 / 2.286 / 3.048 and ends 1.143 / 2.286 / 3.048 / 4 (shares 1.143 / 1.143 / 0.762 / 0.952 s, summing to 4)', ...);
test('6 words then a 7th starts a new group; a sentence end breaks; a 0.15 s gap breaks; 0.149 s does not', ...);
test('a trailing single word joins the previous group (gap <= 0.5 s); a one-word track stays one group', ...);   // Review Focus 2
test('a mid-track one-word sentence ("Yes." then "Then we ship it today.", gap 0.1 s) merges into the next group; with a 1 s gap it stays alone; a merge never makes 7 words or 43 characters', ...);   // Review Focus 2
test('the first group never starts before 0.1 s; groups never overlap', ...);
test('out-of-order cue, empty cue, 200-word cue, emoji and CJK words: no empty or zero-length group, error names the cue line', ...);   // Review Focus 2
test('6 words of 20 letters at 1080x1920 (9:16) and a 30-character CJK word wrap inside captionZone: the in-page .captions box is within the zone', ...);   // Review Focus 2
test('captionBoxProblem: a box 1 px past the zone right edge returns the exact message; a box inside returns null', ...);   // proves the rule fires
test('voice sidecar and whisper JSON both parse to the same word list for the same text', ...);
test('captionState: karaoke word index at t, kinetic popScale 1.15 at word start and 1 after 0.15 s, typewriter chars at 0.035 s each', ...);
test('captioned-clip renders byte-identical twice, in every style', ...);   // six renders, one assertion each
test('check.mjs: a body text at y 900 on 1920x1080 with captions is a caption-zone problem; the same spec without captions passes', ...);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs + eval prompts** (`item-captions-srt`, `item-captions-karaoke`; SRT- and VTT-sourced, never voice-sourced, because the eval does not install Kokoro). Docs say that with a voice sidecar the sentence edges are exact and word times inside a sentence are estimates, so `karaoke` and `kinetic` from a sidecar are approximate; Whisper word alignment is a later spike, not part of this plan. Port note: the grouping rules follow HyperFrames' rules (no attribution needed).
- [ ] **Step 6: Commit** — `feat(make-motion): captions from SRT, VTT, Whisper JSON or the voice sidecar, six styles`.

### Task 9: blocks v1, `blocks.mjs`, golden contact sheets

**Files:**
- Create: `template/blocks/index.mjs`, `template/blocks/{title-card,lower-third,kpi-counter,step-flow,quote-card,checklist,logo-outro,cta-close}.mjs`, `scripts/blocks.mjs`, `references/examples/blocks/<name>.json` (8), `references/blocks/<name>.png` (8)
- Modify: `scripts/lib/spec.mjs` (element type `block`; params validation; expansion before the full check), `template/defaults.mjs:132` (`expandBlocks` first), `references/schema.md` (Blocks section), `SKILL.md` (Blocks section + workflow step 1: "start from a block when one fits"), `README.md`
- Test: `test/blocks.test.mjs`

**Interfaces:**
- Element: `{ "type": "block", "id", "x", "y", "block": "<name>", "params": {…}, "opacity"?, "scale"?, "rotate"?, "keyframes"? }`.
- `BLOCKS: { [name]: { params: <JSON schema, additionalProperties false>, describe: { [param]: string }, example: <params>, expand(el, ctx: { theme, sceneDuration, fps, size }) -> groupElement } }`; `expandBlocks(spec) -> spec` (pure copy; a spec without blocks is `deepEqual` to its input); child ids are `<blockId>/<part>` (`kpi/label`, `steps/box-2`); colours are theme tokens only (`surface`, `line`, `accent`, `text`, `text2`, `good`); entrances `enter` ease, 0.6 s, staggered 0.2 s per item; nothing animates after 85 % of the scene.
- Validator order: unknown `block` → `unknown block "kpi"; did you mean "kpi-counter"? (blocks: …)`; `params` errors from the block's Ajv schema at `scenes[i].elements[j].params.<field>`; then the expanded spec goes through the normal checks. Expansion of valid params must never produce an error (tested).
- Params (required first; strings capped `maxLength` 80 unless noted; arrays capped as shown): `title-card { title, subtitle?, kicker? }`; `lower-third { name, role?, side?: left|right }`; `kpi-counter { label, to, from?, prefix?, suffix?, decimals?, delta? }`; `step-flow { steps: 2–6 strings (24 chars), direction?: row|column }`; `quote-card { quote (200), attribution? }`; `checklist { items: 2–8 strings (40), tickAfter?: seconds per item (default 0.25) }`; `logo-outro { src, tagline?, width? }`; `cta-close { headline, action (24), url? (shown as text) }`.
- `node scripts/blocks.mjs list` → one line per block: `<name>  params: title, subtitle?, kicker?`; `show <name>` → a table (param, type, required, default, description) then the example as JSON; unknown → exit 2 with did-you-mean.
- Golden sheet: `references/blocks/<name>.png` is `out/contact/<scene>.png` from `render.mjs references/examples/blocks/<name>.json --contact-sheet`. Committed for human review; CI never pixel-diffs it (macOS and Ubuntu rasterize fonts differently).

- [ ] **Step 1: Tests** (table-driven over `Object.keys(BLOCKS)`)

```js
for (const name of names) {
  test(`${name}: example params validate, expand, and the expanded spec is valid`, ...);
  test(`${name}: references/examples/blocks/${name}.json is valid and references/blocks/${name}.png exists`, ...);
  test(`${name}: renders byte-identical twice`, ...);
  test(`${name}: passes check.mjs`, ...);   // Review Focus 3
}
test('expandBlocks leaves a spec without blocks deepEqual', ...);
test('a 40-word title, a </script> label and an empty items list are params errors at params.<field>, never at the expansion', ...);   // Review Focus 3
test('blocks.mjs list names every block; show kpi-counter prints the params table; show nope exits 2 with a suggestion', ...);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Draft each block's schema and expansion from HyperFrames' block list (ideas only; no code copied). **Step 4: Run** → PASS; look at every golden PNG before committing it.
- [ ] **Step 5: Docs + eval prompts.** Eight prompts `item-block-<name>` appended to `motion-items.json`, each asking for the block by its purpose, not its name.
- [ ] **Step 6: Commit** — `feat(make-motion): eight blocks, blocks.mjs, golden contact sheets`.

### Task 10: Gate 1

**Files:**
- Modify: `<pa>/CHANGELOG.md`, `<pa>/.claude-plugin/plugin.json`, `README.md`, `<pa>/README.md`, `<pa>/USAGE.md`, `docs/features/portable-artifacts.html`, this plan's Status
- Create: `<pa>/eval/results/summary-motion-gate1-<date>.md`

- [ ] **Step 1: New-item eval** (13 prompts from Tasks 4–9: `item-group`, `item-video`, `item-format-vertical`, `item-captions-srt`, `item-captions-karaoke`, eight `item-block-*`): `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set items`. Pass: at least 12 of 13 valid on the first build. Below that, fix the SKILL.md wording or the validator message the failures point at, rerun only the failed ids with `--only` (the gate's one rerun), and record both runs.
- [ ] **Step 2: Benchmark pair**: `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set benchmark --only pr-walkthrough,captioned-social`. Pass: both `valid ✓` and `output ✓`. Update the Status billed-run total (15 planned for this gate, plus the rerun if any).
- [ ] **Step 3: Hash check**: `PA_REQUIRE_RENDER=1 node --test <skill>/test/determinism.test.mjs <skill>/test/group.test.mjs <skill>/test/video.test.mjs <skill>/test/captions.test.mjs <skill>/test/blocks.test.mjs <skill>/test/formats.test.mjs` → every render-twice test PASS (none skipped).
- [ ] **Step 4: Full suites** green: `npm test`, eval tests, `node <pa>/bin/sync-shared.mjs --check`, `node --test "<pa>/bin/test/*.test.mjs"`, `python3 scripts/sweep_counts.py --check`.
- [ ] **Step 5: Docs and version.** Per the Version model: rename KPI's `## [Unreleased]` section into `## [<next minor>]`, append group, video, format, voice sidecar, captions, blocks, `--set`, CI ffmpeg; bump plugin.json to that version; retitle the feature page's 'Next release' heading to it; add the feature page rows; USAGE §5.
- [ ] **Step 6: Gate review.** Dispatch the reviewer (Dispatch bullet) over the diff from the Status Base row to the working tree, with the Review Focus list and a security lens on `server.mjs`, `guardNetwork` and asset-path handling. Fix CRITICAL and HIGH before Step 7.
- [ ] **Step 7: Status + commit + push** — Gate 1 row `passed (this commit)`: `feat(make-motion): gate 1 — footage, captions, blocks (<version>)`; `git push -u origin worktree-skills-improvement`. Then the orchestrator runs `gh workflow run test.yml --ref worktree-skills-improvement` (the `workflow_dispatch` trigger from Task 1; no PR needed), and reads the result with `gh run list --workflow test.yml --branch worktree-skills-improvement --limit 1`. The Ubuntu `node` job (ffmpeg installed, `PA_REQUIRE_RENDER=1`) must be green; a red run is fixed in a follow-up commit before Phase 2 starts. If GitHub rejects the dispatch, the orchestrator stops and tells the owner.

---

# Phase 2: quality gates, motion, speed

### Task 11: four `check.mjs` audits and `hold`

**Files:**
- Create: `scripts/lib/audits.mjs`
- Modify: `scripts/check.mjs` (new sampling pass, backdrop capture, severity), `scripts/lib/spec.mjs` (common field `hold: boolean`), `references/schema.md`, `SKILL.md`
- Create: `test/fixtures/bad-contrast.json`, `bad-reading-floor.json`, `bad-dead-stretch.json`, `bad-text-floor.json`, `ok-hold.json`
- Test: `test/audits.test.mjs`

**Interfaces:**
- Sampling: besides `sheetTimes`, `check.mjs` samples every scene at `AUDIT_STEP = 0.25` s (`page.evaluate` of opacity, box, computed font size and weight, colour and the timeline state; no screenshot) → `steps: Array<{ t, els }>`.
- Backdrop: `backdropColors(page, boxes) -> string[]` hides every `.el.<type>` for the types in `CHECKED` (`visibility:hidden`; Task 14 adds `code` to `CHECKED` and the selector follows), takes one PNG screenshot, restores, then decodes it in the page (`Image` from a data URL, canvas `getImageData`) and returns the mean colour of each box as `#rrggbb`. Run at each `sheetTimes` sample only.
- `contrastFindings(scene, i, samples, theme, size) -> { problems, warnings }`: ratio `contrastRatio(textHex, backdropHex)` (`shared/contrast.mjs:16`); needs `4.5`, or `3` when large (`fontSize >= 24 * k`, or `>= 18.67 * k` at weight `>= 700`, `k = shortSide / 1080`); message `text "sub" has 2.9:1 contrast against its backdrop at 1.00s; needs 4.5:1; nearest passing token: text2` (the passing `COLOR_TOKENS` colour of the theme with the smallest ratio above the need; or `no theme token passes; change the background`).
- `readingFloorProblems(scene, i, steps, fps)`: a text's contiguous visible span (opacity > 0.05) must be `>= 0.75 * (0.5 + 0.3 * words)` s; the last text visible in the video `>= 2` s. Message `text "sub" (7 words) shows for 1.25s; needs 2.08s`.
- `deadStretchProblems(spec, steps)`: a stretch longer than 3 s in which no non-`hold` element's state (x, y, opacity, scale, rotate, draw, reveal, value) and no scene index changes; the final 3 s of the video are exempt. Message `nothing changes from 4.00s to 7.50s (3.5s); add motion or mark the elements "hold": true`.
- `textFloorFindings(scene, i, samples, steps, size)`: rendered font size `< 28 * k` px visible for `>= 0.5` s → problem; seen at a single sample → warning. Message `text "fine-print" is 22px (below 28px at 1080); shown 1.50s`.
- Severity: a contrast or text-floor finding at exactly one sampled moment goes to `warnings`; at two or more consecutive samples to `problems`. Reading floor and dead stretch are always problems.

- [ ] **Step 1: Tests** — one fixture per audit asserting the exact message line and exit 1; `ok-hold.json` (a 10 s static title with `"hold": true`) exits 0; a single-sample contrast dip (a text crossing a bright shape for one sample) is a warning only; every `references/examples/*.json` still exits 0 (adjust an example only if an audit finds a real problem, and say so in the commit body).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs + eval prompt** (`item-hold`). SKILL.md step 4 lists the four audits in one sentence each.
- [ ] **Step 6: Commit** — `feat(make-motion): contrast, reading-floor, dead-stretch and text-floor audits`.

### Task 12: six transitions

**Files:**
- Create: `template/transitions.mjs`, `references/examples/transitions.json`
- Modify: `scripts/lib/spec.mjs:99` (transition schema: string enum or object), `template/defaults.mjs:138-140`, `template/timeline.mjs:68-78` (progress track per scene), `template/renderer.mjs:383-396` (layer styles from progress), `scripts/check.mjs:166-179,231` (overlap windows for every transition), `references/schema.md`, `SKILL.md`
- Test: `test/transitions.test.mjs`

**Interfaces:**
- `TRANSITIONS = ['none','fade','crossfade','push','slide','wipe','zoom','blur','iris']`; `transition` is a name, or `{ "type", "direction"?, "duration"? }`; directions: push/slide/wipe `left|right|up|down` (default `left`), zoom `in|out` (default `in`), iris `in|out` (default `in`), blur and fade none; `duration` 0.1–2 s, default 0.4, capped at the scene duration as `FADE_SECONDS` is. On scene 0 every name but `none` and `fade` is the existing error (`needs a previous scene …`).
- `normalizeTransition(value) -> { type, direction, duration }`; `layerStyles(transition, p, size) -> { incoming: { opacity, transform, clipPath, filter }, outgoing: {…} }` for progress `p` 0→1 (ease `inOutCubic`): push moves outgoing out by the canvas size and incoming in from the opposite side; slide moves only incoming; wipe sets incoming `clip-path: inset(…)` growing from the direction's edge; zoom scales incoming from 1.2 (in) or 0.8 (out) to 1 with opacity 0→1; blur sets incoming `filter: blur(24px → 0)` with opacity 0→1; iris in: incoming `clip-path: circle(0% → 71%)`; iris out: outgoing `circle(71% → 0%)` over the incoming. The outgoing layer stays mounted until `p = 1`, as crossfade does. Opacity is allowed in transitions beside CSS transforms, `clip-path` and `filter` (zoom, blur and fade use it; fade and crossfade already did).
- Timeline exposes `built.overlaps` (`crossfades` renamed; `window.__motion.crossfades` keeps its name as an alias for check.mjs) with `{ from, to, start, end, type }`.

- [ ] **Step 1: Tests** — `layerStyles` exact values at p 0, 0.5, 1 for each type and direction; schema: `{ "type": "push", "direction": "sideways" }` → error listing directions; `push` on scene 0 → the first-scene error; `transitions.json` (seven scenes, one per new transition, 1.2 s each) passes check and renders byte-identical twice; the backward-compat hash step (Global Constraints) holds for the old string forms.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Docs + eval prompt** (`item-transition-push`).
- [ ] **Step 6: Commit** — `feat(make-motion): push, slide, wipe, zoom, blur and iris transitions`.

### Task 13: scene camera

**Files:**
- Create: `template/camera.mjs`, `references/examples/camera-push-in.json`
- Modify: `scripts/lib/spec.mjs` (scene `camera`), `template/timeline.mjs` (camera tracks per scene), `template/renderer.mjs` (a `.camera` wrapper inside each scene layer holding the elements; transform-origin centre), `template/styles.css`, `references/schema.md`, `SKILL.md`
- Test: `test/camera.test.mjs`

**Interfaces:**
- Scene: `"camera": { "keyframes": [{ "t", "zoom"? (0.5–3), "x"? (px pan), "y"?, "rotate"? (deg), "ease"? }], "shake"?: { "amount" (px, 0–100), "hz"? (default 8), "seed"? (int, default 1) } }`; defaults zoom 1, x 0, y 0, rotate 0; keyframe `t` rules as element keyframes.
- `cameraTransform({ zoom, x, y, rotate }, shake, t) -> string` = `translate(sx, sy) scale(zoom) translate(-x, -y) rotate(rotate)`; `shakeOffset(shake, t) -> { sx, sy }` = `amount × lerp(noise(i), noise(i+1), frac)` per axis with `i = floor(t × hz)`, `noise` from `mulberry32(seed + axis × 7919)` (move `mulberry32` from `scripts/lib/cues.mjs:18` to `template/seeded.mjs` and import it there), so the same seed always gives the same shake.
- check.mjs needs no change: `getBoundingClientRect` already includes the wrapper transform; tests prove it.

- [ ] **Step 1: Tests** — `shakeOffset` is identical across two calls and differs across seeds; `cameraTransform` string at a keyframe midpoint; a text 70 px from the top with `zoom` 1.2 held → `leaves the safe area (top)` from check.mjs (measured after the camera); the example renders byte-identical twice.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-camera`). **Step 6: Commit** — `feat(make-motion): scene camera with keyframed zoom, pan, rotate and seeded shake`.

### Task 14: `code` element with shiki, plus three blocks

**Files:**
- Modify: `package.json` (add `shiki` exact pin), `scripts/lib/server.mjs:35` (`VENDOR_ROOTS.shiki`), `template/index.html` importmap, `scripts/lib/spec.mjs` (`FIELDS.code`, `REQUIRED.code = ['code','lang','width']`, `checkCode`), `template/renderer.mjs`, `template/timeline.mjs` (typing `value` track reused), `template/styles.css`, `scripts/check.mjs:32` (`CHECKED` gains `code`), `references/schema.md`, `SKILL.md`, `<pa>/README.md` Licences
- Create: `template/code-theme.mjs`, `template/blocks/{code-typing,code-diff,terminal-run}.mjs`, examples and golden sheets for the three, `references/examples/code-highlight.json`
- Test: `test/code.test.mjs`

**Interfaces:**
- Element: `{ "type": "code", "id", "x", "y", "code", "lang", "width", "height"?, "fontSize"? (28), "highlight"?: [line numbers], "diff"?: boolean, "typing"?: boolean }`; `ANIMATABLE.code = [...POSE, 'value']` when typing (as text). `CODE_LANGS = ['text','javascript','typescript','json','bash','python','diff','go','rust','swift','yaml','html','css','markdown']`; unknown → `unknown lang "js"; did you mean "javascript"? (langs: …)`. `typing` must finish a frame before the scene ends (reuse `checkTyping` generalised to `el.type === 'code'`).
- Dependency: `npm --prefix <skill> install shiki@<exact> --save-exact`, then `npm --prefix <skill> audit` (0 vulnerabilities); record the pin in Status. Browser delivery: current shiki is split across several packages (`@shikijs/core`, `@shikijs/engine-javascript`, `@shikijs/langs`, `@shikijs/types`, `@shikijs/vscode-textmate` and their own dependencies), so serving `node_modules/shiki/dist` alone leaves bare-specifier imports the browser cannot resolve. Use the fine-grained entry: `shiki/core` (`createHighlighterCore`), the JavaScript regex engine from `@shikijs/engine-javascript` (no wasm fetch), only the grammars for `CODE_LANGS` from `@shikijs/langs/<lang>`, and no bundled themes (`codeTheme` supplies the theme). The implementer lists every package the browser actually imports by walking the import specifiers from those entry files (`npm --prefix <skill> ls shiki --all` shows the tree), adds each to `VENDOR_ROOTS` (`server.mjs:35`) and to the `template/index.html` importmap, and records the list in Status. They are transitive dependencies already pinned by the lockfile; none becomes a direct dependency.
- `codeTheme(look) -> TextMate theme object`: keyword → `accent`, string → `good`, comment → `text3`, number/constant → `warn`, function → `cat1`, type → `cat2`, default → `text`; background transparent. Rendered once at load to spans; `highlight` lines get a `surface` row background; `diff` tints lines starting with `+` `good` and `-` `bad` at 15 % alpha; `typing` reveals characters by the `value` track (0.035 s/char, caret as text typing).
- Blocks: `code-typing { code (2000), lang, title? }`; `code-diff { before (2000), after (2000), lang, title? }` (expansion computes a line LCS diff into a `diff: true` code element); `terminal-run { command (120), output: 1–12 lines (80), prompt?: "$" }` (types the command, then output lines appear staggered 0.15 s).

- [ ] **Step 1: Tests** — unknown lang message; every `CODE_LANGS` entry highlights offline (the render page makes no blocked request: `guardNetwork` counter is 0, and the preview server answers every `/vendor/` import with 200, so no specifier is unresolved); `code-diff` expansion of a two-line change yields `-old`/`+new` lines in order; typing cut-off error text; three block examples valid + golden PNG present + byte-identical twice; `code-highlight.json` byte-identical twice; `npm audit --json` reports 0 vulnerabilities (a test that spawns `npm audit --json --omit=dev` and asserts `metadata.vulnerabilities.total === 0`, skipped offline when the registry is unreachable).
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompts** (`item-code`, `item-block-code-typing`, `item-block-code-diff`, `item-block-terminal-run`). **Step 6: Commit** — `feat(make-motion): code element on shiki; code-typing, code-diff and terminal-run blocks`.

### Task 15: `--workers` and `--quality draft`

**Files:**
- Create: `scripts/lib/workers.mjs`
- Modify: `scripts/render.mjs` (`parseArgs`, `renderVideo`, `openPage`: `--workers N|auto`, `--quality draft|final`, `renderVideo` consumes frames in order), `scripts/lib/ffmpeg.mjs:67-73` (`encodeArgs({ …, quality })`), `references/schema.md`, `README.md`, `SKILL.md`
- Test: `test/workers.test.mjs`

**Interfaces:**
- `--workers N` (1–16) or `auto` = `max(1, min(8, os.availableParallelism() - 1))`; default 1. `--quality draft|final`, default `final` (today's args unchanged); `draft` halves each side (rounded down to even) and adds `-crf 30 -preset veryfast` to `VIDEO_CODEC`; prints `quality: draft (960x540)` to stderr. `workers: N` goes to stderr when N > 1 (stdout unchanged).
- `frameRanges(frames, workers) -> Array<[start, endExclusive]>` — contiguous, non-overlapping, covering every frame; `min(workers, frames)` ranges.
- `captureInOrder({ pages, ranges, fps, dir, onFrame }) -> Promise<void>`: each page captures its range to `dir/<index>.png` (one `seek` + screenshot per frame); the consumer awaits frame `j`'s file in order, calls `onFrame(buffer)` (the encoder write), deletes it. A page error or missing file rejects with `worker <k> failed at frame <j>: <message>`; `cleanup()` then removes the partial as today.

- [ ] **Step 1: Tests** — `frameRanges(10, 4)` → `[[0,3],[3,6],[6,8],[8,10]]`; `frameRanges(3, 4)` → three ranges; `frameRanges(7, 2)` covers 0–6 exactly (Review Focus 4); `--workers 1` and `--workers 4` on `q3-revenue` at 320x180/10 fps give the same SHA-256 (`renderHash`); a page that throws at frame 5 (inject through a test-only `PA_WORKER_FAIL_AT=5` env read by `workers.mjs`) exits 1 with `worker … failed at frame 5` and leaves no `.partial.mp4` (Review Focus 4); `--quality draft` output is 160x90 for a 320x180 spec and `encodeArgs({quality:'draft'})` contains `-crf 30`; `encodeArgs` without `quality` is unchanged.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs.** **Step 6: Commit** — `feat(make-motion): parallel frame capture (--workers) and a draft quality`.

### Task 16: variables and batch render

**Files:**
- Create: `template/vars.mjs`, `scripts/lib/batch.mjs`, `references/examples/batch-welcome.json` (every var has a `default`, so the example loops validate it alone) + `references/examples/data/batch-welcome.rows.json` (a rows file is not a motion spec, so it stays out of the examples loops)
- Modify: `scripts/lib/spec.mjs` (root `vars`; substitution before validation; unknown-variable errors), `template/defaults.mjs` (substitute defaults in `withDefaults`), `scripts/render.mjs` (`--batch <rows.json>`, `--out` template, manifest), `references/schema.md`, `SKILL.md`
- Test: `test/vars.test.mjs`

**Interfaces:**
- Root: `"vars": { "<name>": { "type": "string"|"number", "default"? } }`, name pattern `^[a-z][a-zA-Z0-9_]*$`, up to 30. `{{name}}` is replaced in every string value of the spec (numbers become `String(value)`); a reference to an undeclared name → `scenes[0].elements[0].text: unknown variable "citty"; declared: city, name`; a declared variable without a default and no row value → `vars.city: no default and the row gives no value`.
- `substituteVars(spec, values) -> spec` (pure; `values` merged over defaults); `findVarRefs(spec) -> Array<{ path, name }>`.
- `render --batch rows.json --out "renders/{name}.mp4"`: `rows.json` is an array of objects; `--out` must contain `{<var>}` or `{index}` (else `--batch needs an --out template with {index} or a {var}, so outputs do not collide`); every row is substituted and validated before the first frame (all failures printed as `row 2: scenes[0].elements[1].src: must stay inside the spec folder`, exit 1); then rows render one after another; `manifest.json` next to the outputs: `{ "rows": [{ "index", "vars", "status": "ok"|"failed", "out", "sha256", "duration", "error"? }] }`.

- [ ] **Step 1: Tests** — substitution in text, prefix and a chart title; unknown name error text; `{{name}}` producing `../x.png` in `src` and `url(x)` in `color` are rejected at the normal validator paths with the row index (Review Focus 5); a missing variable without default (Review Focus 5); `--batch` without a template `--out` exits 2; a 2-row batch at 160x90 writes two MP4s and a manifest whose `sha256` values match the files; the example renders byte-identical twice.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-vars`). **Step 6: Commit** — `feat(make-motion): typed vars with {{name}} and render --batch with a manifest`.

### Task 17: Gate 2

**Files:**
- Create: `test/fixtures/benchmark-30s.json` (30 s, 1080p, 30 fps, eight scenes: titles, counters, two charts, a step-flow block, a kpi-counter block, one push and one wipe transition; no texture; in `test/fixtures/`, not `references/examples/`, because the examples loops cap specs at 15 s), `.scratch/gate2-speed.mjs` (not committed), `<pa>/eval/results/summary-motion-gate2-<date>.md`
- Modify: CHANGELOG, plugin.json, docs, Status

- [ ] **Step 1: Speed.** Write `.scratch/gate2-speed.mjs` with the Write tool: it renders `test/fixtures/benchmark-30s.json` with `node <skill>/scripts/render.mjs … --out .scratch/gate2/w1-<n>.mp4 --workers 1` twice and `--workers 4` twice (`SOURCE_DATE_EPOCH=1793318400` in the child env), times each with `performance.now()`, and prints the four times, the machine (`os.cpus()` model and count) and the SHA-256 of all four files. Run `node .scratch/gate2-speed.mjs`. Pass: the faster of the two 4-worker runs is at least 2× faster than the slower 1-worker run, and all four SHA-256 values are equal. "Today" is `--workers 1` on the same machine and spec. Record the four times and the machine in the CHANGELOG as measured.
- [ ] **Step 2: Items eval** for Tasks 11–16 (8 prompts): `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set items --only item-hold,item-transition-push,item-camera,item-code,item-block-code-typing,item-block-code-diff,item-block-terminal-run,item-vars`. Pass: 8 of 8 valid on the first build (`ceil(0.9 × 8)`); on a miss, fix the wording and make the gate's one rerun of the failed ids.
- [ ] **Step 3: Benchmark subset (10 of 12).** `chart-race` needs the race block (Task 23) and `map-regions` needs the bundled atlases (Task 22), both Phase 3, so Gate 2 runs the other ten and the full 12 run at Gate 3: `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set benchmark --only launch-teaser,launch-feature-trio,pr-walkthrough,pr-code-diff,captioned-social,captioned-vertical,docs-steps,docs-faq,batch-welcome,batch-kpi-cards`. Pass: at least 9 of 10 valid, median validate runs ≤ 2, and the `check` column is `✓` for every one of the ten built specs (the new audits; the spec's 'all 12 pass the new audits' is met at Gate 3 for the last two). Update the Status billed-run total (18 planned for this gate, plus the rerun if any).
- [ ] **Step 4: Hash + suites** as in Gate 1, plus `transitions`, `camera`, `code`, `workers`, `vars` and `audits` test files (`<skill>/test/<name>.test.mjs`) under `PA_REQUIRE_RENDER=1`.
- [ ] **Step 5: Docs and version.** CHANGELOG heading and one minor bump per the Version model, feature page rows, USAGE §5.
- [ ] **Step 6: Gate review.** Reviewer dispatch as in Gate 1 Step 6, over the diff from the commit whose subject starts `feat(make-motion): gate 1` to the working tree; add a security lens on `code` (shiki vendor serving) and `--batch` path handling. Fix CRITICAL and HIGH first.
- [ ] **Step 7: Status, commit, push** — Gate 2 row `passed (this commit)` and Gate 1's `(this commit)` replaced by its SHA: `feat(make-motion): gate 2 — audits, transitions, camera, code, workers, batch (<version>)`.

---

# Phase 3: media and data

### Task 18: beats

**Files:**
- Create: `scripts/lib/beats.mjs`, `scripts/beats.mjs`, `references/examples/on-the-beat.json` + `references/examples/data/on-the-beat.wav` (8 s click track, 120 BPM, from `writeWav({ clickBpm: 120 })`, Task 3) + `references/examples/data/on-the-beat.beats.json` (a beats file is not a motion spec, so it lives in `data/`, outside the examples loops)
- Modify: `scripts/lib/spec.mjs` (root `beats`; `t` and `at` accept `"beat:<n>"`; `resolveBeats`), `scripts/render.mjs`, `scripts/check.mjs`, `scripts/preview.mjs` (all resolve before `withDefaults`), `references/schema.md`, `SKILL.md`
- Test: `test/beats.test.mjs`

**Interfaces:**
- `node scripts/beats.mjs <audio> [--out <file>.json] [--min-confidence 0.5]` → writes `{ "source": "<rel>", "bpm", "confidence", "beats": [seconds…] }` (default `<audio-stem>.beats.json`), prints the path, bpm and count; exit 1 with `no steady beat found in music.wav (confidence 0.31; needs 0.5)`.
- `decodePcm(ffmpeg, file) -> Float32Array` (mono, 22050 Hz, `-f f32le`); `onsetEnvelope(pcm, { frame: 1024, hop: 512 }) -> Float32Array` (spectral flux with an own radix-2 FFT, half-wave rectified, normalised to max 1); `estimateTempo(env, hopSeconds) -> { bpm, confidence }` (autocorrelation over 60–200 BPM; confidence = peak / mean of the autocorrelation in that range, clamped 0–1); `beatGrid(env, bpm, hopSeconds) -> number[]` (the phase maximising the envelope sum); `detectBeats(pcm) -> { bpm, confidence, beats }`.
- Spec: root `"beats": "data/on-the-beat.beats.json"`; a keyframe `"t": "beat:12"` resolves to `beats[12] - sceneStart` (error when outside the scene: `beat:12 is at 6.0s, outside scene "two" (4s to 5.5s)`); a cue or audio `"at": "beat:12"` resolves to `beats[12]` (absolute) or `beats[12] - sceneStart` when `scene` is set; index out of range → `beat:40 does not exist; the file has 16 beats`; `beat:` without a `beats` file → `"beat:3" needs a root "beats" file`. `resolveBeats(spec, beats) -> spec` (pure) runs before validation; the resolved spec is what the page gets (`specBody` serves it resolved).

- [ ] **Step 1: Tests** — 120 BPM clicks → `bpm` within ±1 and every beat within 20 ms of a click; seeded white noise → confidence < 0.5 and the CLI exits 1 with the message; the eval fixture `<pa>/eval/fixtures/data/music.wav` (a click track, Task 3) gives confidence >= 0.5 and 20 beats ±1, so `item-beats` can succeed; resolution and the three error texts; the example renders byte-identical twice.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-beats`, with `data/music.wav`; the prompt says to run `beats.mjs` first). **Step 6: Commit** — `feat(make-motion): beats.mjs and beat-anchored keyframes and cues`.

### Task 19: loudness target

**Files:**
- Create: `scripts/lib/loudness.mjs`
- Modify: `scripts/render.mjs` (`--loudness <lufs>`, −30 to −5; after the encode: two passes, then rename), `references/schema.md`, `README.md`
- Test: `test/loudness.test.mjs`

**Interfaces:**
- `measureLoudnorm(ffmpeg, file, target) -> { input_i, input_tp, input_lra, input_thresh, target_offset }` (pass 1: `-af loudnorm=I=<target>:TP=-1.5:LRA=11:print_format=json`, parsed from stderr); `normalizeArgs({ input, out, target, measured }) -> string[]` (pass 2: `-i input -c:v copy -af loudnorm=I=…:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true -c:a aac -b:a 192k -ar 48000 -ac 2 out`); the existing LUFS report line prints after the second pass. A spec without audio ignores the flag with a stderr note.

- [ ] **Step 1: Tests** — `normalizeArgs` exact array; a tone spec rendered with `--loudness -16` measures within ±1 LU of −16 (`measureLoudness`); byte-identical twice with the flag; without the flag the backward-compat hash step holds.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs.** **Step 6: Commit** — `feat(make-motion): render --loudness runs a two-pass loudnorm`.

### Task 20: grade presets on image and video

**Files:**
- Create: `template/grade.mjs`, `references/examples/graded-photo.json` + `photo.png`
- Modify: `scripts/lib/spec.mjs` (`grade` on image and video), `template/renderer.mjs` (one `<svg><defs>` on the stage; `filter: url(#grade-<id>)`), `references/schema.md`, `SKILL.md`
- Test: `test/grade.test.mjs`

**Interfaces:**
- `"grade": { "preset"?: "warm"|"cool"|"mono"|"film", "exposure"? (−2–2, stops, default 0), "contrast"? (0.5–2, default 1), "saturation"? (0–2, default 1) }`.
- `gradeFilter(id, grade) -> string` SVG `<filter id>` markup: `feColorMatrix type="saturate" values="<saturation × presetSaturation>"`, then the preset matrix (`warm`: `1.08 0 0 0 0.02 / 0 1.02 0 0 0 / 0 0 0.90 0 -0.02`; `cool`: `0.92 0 0 0 -0.02 / 0 1 0 0 0 / 0 0 1.10 0 0.02`; `mono`: saturation 0, contrast × 1.1; `film`: saturation × 0.85, contrast × 1.15, then `feComponentTransfer` lifting blacks with `type="table" tableValues="0.06 1"`), then `feComponentTransfer` with `type="linear" slope="<2^exposure × contrast>" intercept="<0.5 − 0.5 × contrast>"` on R, G and B.

- [ ] **Step 1: Tests** — markup exact for `{ preset: 'warm' }`; `saturation: 0` gives `R == G == B` at the frame centre (via `framed` + canvas sample); `exposure: 1` raises mean luma of a mid-grey image to about 2× (within 10 %); byte-identical twice; a spec without `grade` passes the backward-compat hash step.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-grade`). **Step 6: Commit** — `feat(make-motion): grade presets and exposure, contrast and saturation on image and video`.

### Task 21: `lottie` element

**Files:**
- Modify: `package.json` (`lottie-web` exact pin), `scripts/lib/server.mjs` (`VENDOR_ROOTS['lottie-web']`, `referencedAssets` for `.json` lottie srcs), `scripts/lib/spec.mjs` (`FIELDS.lottie`, `REQUIRED.lottie = ['src','width','height']`, `checkLottie`), `template/renderer.mjs`, `references/schema.md`, `SKILL.md`, `<pa>/README.md` Licences
- Create: `template/lottie-guard.mjs`, `references/examples/lottie-badge.json` + `references/examples/data/badge.lottie.json` (a hand-written 2 s shape animation; Lottie JSON is not a motion spec, so it lives in `data/`, outside the examples loops, and the spec's `src` is `data/badge.lottie.json`), `test/fixtures/lottie-remote.json`, `test/fixtures/lottie-expression.json`
- Test: `test/lottie.test.mjs`

**Interfaces:**
- Element: `{ "type": "lottie", "id", "x", "y", "src", "width", "height", "offset"? (default 0), "speed"? (0.25–4, default 1) }`, `ANIMATABLE.lottie = POSE`; frame at scene time `t` is `clamp((t − offset) × speed × fr, ip, op)`; the renderer calls `anim.goToAndStop(frame, true)` (renderer `svg`, `autoplay: false`, `loop: false`, `animationData` fetched from `/assets/`).
- `lottieProblems(json) -> Array<{ path, message }>`: any `assets[i].u` non-empty or `assets[i].p` not starting with `data:` → `assets[2].p: remote assets are not allowed; embed the image as a data URL`; any animatable property object (an object with both `a` and `k` keys) whose `x` is a string (an expression) → `layers[0].ks.p.x: expressions are not supported`; a string `x` on any other object (for example a text-layer field some exporters write) is not flagged; missing `v`, `fr`, `ip`, `op` or `layers` → `not a Lottie file (missing fr)`.

- [ ] **Step 1: Tests** — the two bad fixtures produce the exact messages; a valid file with a string `x` outside any `a`/`k` object passes `lottieProblems`; the badge example at `t` 0.5 s and 1.5 s renders different frames and byte-identical across two renders; the render page makes zero blocked requests; `npm audit` clean.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-lottie`, with a fixture `data/badge.lottie.json` added to eval fixtures). **Step 6: Commit** — `feat(make-motion): lottie element on lottie-web, remote assets and expressions rejected`.

### Task 22: maps and two map blocks

**Files:**
- Modify: `package.json` (`world-atlas`, `us-atlas` exact pins), `scripts/lib/server.mjs` (`VENDOR_ROOTS` for both), `scripts/lib/spec.mjs:289-309` (`checkChart` accepts a named atlas), `template/renderer.mjs:168-185` (`renderChart` resolves the atlas), `references/schema.md`, `SKILL.md`, `<pa>/README.md` Licences
- Create: `template/maps.mjs`, `template/blocks/{map-highlight,flow-map}.mjs` + examples + golden sheets, `references/examples/world-map.json`
- Test: `test/maps.test.mjs`

**Interfaces:**
- `ATLASES = { 'world-110m': { pkg: 'world-atlas', file: 'countries-110m.json', feature: 'countries' }, 'world-50m': { pkg: 'world-atlas', file: 'countries-50m.json', feature: 'countries' }, 'us-states-10m': { pkg: 'us-atlas', file: 'states-10m.json', feature: 'states' }, 'us-counties-10m': { pkg: 'us-atlas', file: 'counties-10m.json', feature: 'counties' } }`; `atlasUrl(name) -> '/vendor/<pkg>/<file>'`.
- A chart whose `vegaLite.data` is `{ "name": "<atlas>" }` passes without `datasets`; at render the data becomes `{ values: <topojson>, format: { type: 'topojson', feature } }`; the validator compiles with the real file read from `node_modules` (same substitution) so projection errors surface at validate. Unknown name → the existing `dataset "x" not found` message extended with `; bundled maps: world-110m, …`.
- Blocks: `map-highlight { map: "world"|"us", highlight: 1–20 names (country ISO numeric id or state name), label?, projection?: "equalEarth"|"albersUsa"|"mercator" }` → a layered geoshape chart (all features `surface`, highlighted `accent`) with `reveal`; `flow-map { map, flows: 1–12 of { from: [lon, lat], to: [lon, lat], label? } }` → geoshape plus `rule` marks on `longitude`/`latitude` encodings, revealed in order.

- [ ] **Step 1: Tests** — named atlas validates and compiles; unknown name message; `world-map.json` and both block examples byte-identical twice and pass check; no blocked network request; `npm audit` clean.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompts** (`item-map`, `item-block-map-highlight`, `item-block-flow-map`). **Step 6: Commit** — `feat(make-motion): bundled world and US atlases; map-highlight and flow-map blocks`.

### Task 23: `race` block

**Files:**
- Create: `template/blocks/race.mjs` + example + golden sheet
- Modify: `references/schema.md`, `SKILL.md`
- Test: `test/blocks.test.mjs` (table-driven cases pick it up) + `test/race.test.mjs`

**Interfaces:**
- `race { rows: 4–200 of { period (string), name (string, 24), value (number) }, top?: 3–10 (default 5), periodSeconds?: 0.5–4 (default 1), title?, prefix?, suffix?, decimals? }`.
- `rankByPeriod(rows, top) -> Array<{ period, ranked: Array<{ name, value, rank }> }>` (value desc, ties by name); expansion: for each name ever in the top N a bar, a label `text` and a `counter`, with one keyframe per period (`t = i × periodSeconds`, ease `move`). The bar is a `shape` with `shape: "line"` (`stroke` `cat1..cat6` by first appearance, `width` = the full bar length, `strokeWidth` = 0.7 × `rowHeight`, so the line draws as a bar): `y` by rank (rank × `rowHeight`) and `draw` = `value / maxValue`, where `maxValue` is the largest value in any row, so lengths compare across periods; counters carry `value`; a name outside the top N at a period goes to `opacity` 0 one row below the last. One `text` per period label fading in at its period and out at the next. Validation: `scene.duration >= periods × periodSeconds` else `params.periodSeconds: 6 periods × 1s need a scene of at least 6s`.

- [ ] **Step 1: Tests** — `rankByPeriod` exact on a 3-period, 4-name fixture; a name entering the top 5 at period 3 has opacity 0 before and 1 after; scene-too-short error text; example byte-identical twice and check ok.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-block-race`). **Step 6: Commit** — `feat(make-motion): race block`.

### Task 24: pick in preview

**Files:**
- Modify: `template/preview-ui.mjs`, `template/renderer.mjs` (`data-path` is set since Task 4; nothing else), `template/styles.css` (toast), `SKILL.md` step 5, `README.md`
- Test: `test/preview-pick.test.mjs`

**Interfaces:**
- Preview mode only: clicking an element copies `<path>  id=<id>` (two spaces) to the clipboard (`navigator.clipboard.writeText`) and shows a toast `copied scenes[1].elements[3] (id "title")` for 2 s; nested children copy their nested path. A click on empty stage does nothing.

- [ ] **Step 1: Tests** — in a Playwright context with `grantPermissions(['clipboard-read','clipboard-write'])`, click a child text of a group in preview mode → `navigator.clipboard.readText()` equals `scenes[0].elements[1].children[0]  id=sub` and the toast text matches; render mode has no handler (no toast after a click).
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs.** **Step 6: Commit** — `feat(make-motion): click an element in the preview to copy its spec path`.

### Task 25: storyboard step and its skip rule

**Files:**
- Create: `scripts/storyboard.mjs`, `scripts/lib/storyboard.mjs`
- Modify: `SKILL.md` (Workflow step 0), `README.md`, `<pa>/USAGE.md` §5
- Test: `test/storyboard.test.mjs`

**Interfaces:**
- `node scripts/storyboard.mjs <brief.json> --out plan.json [--non-interactive]`; brief `{ "title", "seconds", "scenes": [{ "id", "beat", "seconds" }], "theme"? }`.
- `storyboardDecision({ seconds, explainerDir, nonInteractive }) -> { action: 'write' } | { action: 'skip', reason }` with `STORYBOARD_MIN_SECONDS = 20`; reasons, verbatim: `not needed (12s is 20s or less)`; `make-explainer is not installed beside make-motion (looked in <path>)` where `<path>` = `<skill>/../make-explainer/SKILL.md`; `no one to ask (non-interactive run)` when `--non-interactive` is passed. A script cannot tell an interactive agent session from `claude -p` (a tool-run shell never has a TTY either way), so the agent declares it: SKILL.md tells it to pass `--non-interactive` under `claude -p`, `codex exec`, `copilot -p`, the eval, or any run that cannot pause for an answer. A skip prints one line `storyboard: skipped (<reason>)` to stdout, writes nothing and exits 0.
- `storyboardPlan(brief) -> explainerSpec`: a make-explainer `plan` page with sections, in order: `tldr` (what the clip says, in one line), `timeline` (one event per scene: `<seconds>s · <id>`, text = beat), `steps` (the beats), `decision` (`decision-1`: theme, options `dusk`/`press`/`poster`, recommendation from the SKILL.md theme rules, default dusk), `approval` (`approval-1`: the storyboard), `question` (`question-1`: anything to change), `verdict`. `key` = slug of the title. When written, the CLI prints the path and `build: node <explainer>/scripts/build.mjs plan.json`.
- SKILL.md step 0: for a clip over 20 s, write the brief, run storyboard.mjs (with `--non-interactive` when you cannot pause for an answer); if it writes `plan.json`, build it, send the page, read answers only through `answers.mjs`, then write the spec from the answers; if it prints `storyboard: skipped …`, build the clip directly and repeat that line in the final report. The eval copies no sibling skill (`SKILLS.motion` has no `siblings`), so eval runs always take the skip path.

- [ ] **Step 1: Tests** — the three skip reasons (exact lines, exit 0, no file; the sibling check runs on a temp copy of the skill with no `../make-explainer`); a 30 s brief with a fake `../make-explainer/SKILL.md` beside a temp copy and no `--non-interactive` writes `plan.json`; when the real make-explainer is beside the skill, `node ../make-explainer/scripts/validate.mjs plan.json` exits 0 (skip otherwise); `bin/test/style-lint` and `frontmatter` tests still pass after the SKILL.md edit.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs.** **Step 6: Commit** — `feat(make-motion): storyboard step for clips over 20 s, skipped when no one can answer`.

### Task 26: blocks to 24

**Files:**
- Create: `template/blocks/{comparison-split,before-after,notification-stack,chat-thread,timeline,testimonial,lower-third-tag,lower-third-social,lower-third-ticker}.mjs` + nine examples + nine golden sheets
- Modify: `references/schema.md` Blocks table, `SKILL.md`, `README.md`

**Interfaces** (params; counts and string caps as in Task 9):
- `comparison-split { left: { title, points: 1–5 }, right: { title, points: 1–5 }, headline? }`; `before-after { before: { label, value, suffix? }, after: {…}, headline? }`; `notification-stack { items: 1–5 of { app, title, body }, stagger?: 0.3 }`; `chat-thread { messages: 1–8 of { from: "me"|"them", text (160) }, typingDots?: true }`; `timeline { events: 2–8 of { when (16), what (40) }, direction?: row|column }`; `testimonial { quote (240), name, role?, avatar? (image src) }`; `lower-third-tag { name, tag }`; `lower-third-social { handle, platform: one of x|github|linkedin|youtube|instagram (text label only, no logos) }`; `lower-third-ticker { items: 2–8 strings (40), speed?: 80 px/s }` (scrolling by `x` keyframes).
- Total after this task: 8 (Task 9) + 3 (Task 14) + 2 (Task 22) + 1 (Task 23) + 9 = 23, plus `text-behind-subject` in Task 28 = 24.

- [ ] **Step 1: Tests** — the table-driven suite from Task 9 covers all nine automatically; add `test('BLOCKS has 23 entries after Phase 3')`.
- [ ] **Step 2–4:** RED (count test fails), implement, GREEN; look at every golden PNG. **Step 5: Docs + nine eval prompts** (`item-block-<name>`). **Step 6: Commit** — `feat(make-motion): nine more blocks (23 total)`.

### Task 27: Gate 3

- [ ] **Step 1: Items eval** for Tasks 18–26 (16 prompts: `item-beats`, `item-grade`, `item-lottie`, `item-map`, `item-block-map-highlight`, `item-block-flow-map`, `item-block-race`, nine `item-block-*` from Task 26): `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set items --only <those 16 ids>`. Pass: at least 15 of 16 valid on the first build; on a miss, the gate's one rerun of the failed ids.
- [ ] **Step 2: Full benchmark**: `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set benchmark`. Pass: 12 of 12 build (`spec ✓ valid ✓ output ✓`), `check ✓` for all 12 (this meets the spec's 'all 12 pass the new audits'), median validate runs ≤ 2. Update the Status billed-run total (28 planned for this gate, plus the rerun if any).
- [ ] **Step 3: Determinism over the 12 saved specs.** The eval deletes its workdir, so each saved spec's `data/…` assets are gone. Write `.scratch/gate3-rehash.mjs` with the Write tool (not committed): for each id it copies `<pa>/ev[a]l/results/<stamp>/claude-motion/<id>/motion.json` and `<pa>/ev[a]l/fixtures/data/` into `.scratch/gate3/<id>/`, runs `node <skill>/scripts/render.mjs .scratch/gate3/<id>/motion.json --out .scratch/gate3/<id>/a.mp4 --fps 10 --size 320x180` twice (second to `b.mp4`) with `SOURCE_DATE_EPOCH=1793318400` in the child env, and prints `id  sha256(a)  sha256(b)  equal`. Run `node .scratch/gate3-rehash.mjs <stamp>`; all 12 pairs equal. Record the table in the summary file.
- [ ] **Step 4: Suites** green under `PA_REQUIRE_RENDER=1`; sweep counts; sync-shared check.
- [ ] **Step 5: Docs and version.** CHANGELOG heading and one minor bump per the Version model, feature page rows, USAGE §5.
- [ ] **Step 6: Gate review.** Reviewer dispatch as in Gate 1 Step 6, over the diff from the commit whose subject starts `feat(make-motion): gate 2` to the working tree; add a security lens on the atlas and Lottie asset paths, `beats` file resolution and `lottie-guard`. Fix CRITICAL and HIGH first.
- [ ] **Step 7: Status, commit, push** — Gate 3 row `passed (this commit)` and Gate 2's `(this commit)` replaced by its SHA: `feat(make-motion): gate 3 — beats, loudness, grade, lottie, maps, race, pick, storyboard, 23 blocks (<version>)`.

---

# Phase 4: conditional

### Task 28: cutouts on demand and the `text-behind-subject` block

**Files:**
- Create: `scripts/lib/cutout.mjs`, `scripts/cutout.mjs`, `template/blocks/text-behind-subject.mjs` + example + golden sheet
- Modify: `<pa>/shared/doctor.mjs` (`CUTOUT_PIN`, `cutout()` requirement; sync), `scripts/lib/requirements.mjs` (`targets` gains `cutout`), `scripts/lib/doctor-hint.mjs` (`npmInstallCutout()`), `scripts/audit-on-demand-deps.sh:22-36` (loop over `KOKORO_PIN` and `CUTOUT_PIN`), `package.json` `overrides` (as advisories require), `scripts/lib/video.mjs` (alpha sources cache PNG; already keyed by `alpha`), `README.md`, `<pa>/README.md`, `<pa>/USAGE.md`, `references/schema.md`, `SKILL.md`, `<pa>/bin/test/install-commands.test.mjs` (the new install string in docs)
- Test: `test/cutout.test.mjs`

**Interfaces:**
- Model: MODNet (`modnet_photographic_portrait_matting.onnx`, Apache-2.0). `MODEL_URL` and `MODEL_SHA256` are constants in `scripts/lib/cutout.mjs`, recorded in Status; downloaded once into `<skill>/.cache/models/modnet/` (the Kokoro pattern, `scripts/lib/voice.mjs:10`), verified by sha256 before use. On-demand package: `CUTOUT_PIN = 'onnxruntime-node@<exact>'`, installed only by `npm --prefix <skill> install onnxruntime-node@<exact> --no-save` (`doctor --fix cutout`); never by `npm ci`.
- `node scripts/cutout.mjs <photo.png|clip.mp4> [--out <dir>] [--fps n]` → for an image writes `<out>/<stem>.png` (RGBA); for a video writes `<out>/<stem>.webm` (VP9 `yuva420p`, from the alpha PNG sequence written to `.cache/cutout/<sha>/`), prints the path(s). Image decode and encode go through a Playwright page canvas (no `sharp`). Exit 2 with the install hint when `onnxruntime-node` is missing.
- Doctor: `cutout()` requirement (`required: false`, in target `cutout` and `ALL`): check = `node_modules/onnxruntime-node` present and `staleOverrides(ctx)` empty (so a pre-pin install goes red, as kokoro does); `why` names the model download size.
- Block: `text-behind-subject { src (the original image or clip), cutout (the file cutout.mjs wrote), text, fontSize?, color? }` → group of image-or-video (`src`), text, image-or-video (`cutout`) in that order.
- Audit: `bash scripts/audit-on-demand-deps.sh` must exit 0 with both pins; `shellcheck scripts/audit-on-demand-deps.sh` clean; `.github/workflows/audit-on-demand-deps.yml` paths already cover the files that change.

- [ ] **Step 1: Tests** — `cutout.mjs` on a synthetic portrait (a skin-toned ellipse on a flat background drawn in a page) yields alpha > 0.9 at the centre and < 0.1 at a corner (skipped when `onnxruntime-node` or the model is absent, unless `PA_REQUIRE_CUTOUT=1`); the doctor reports `cutout` missing on a fresh copy and red with a stale override (prove with a real pre-pin install: install without the pin, restore it, run the doctor, run `--fix`, confirm the version moved; record in the commit body); the block example byte-identical twice; `audit-on-demand-deps.sh` exit 0.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Docs + eval prompt** (`item-block-text-behind-subject`, with a pre-cut fixture pair in eval fixtures so the eval installs nothing).
- [ ] **Step 6: Phase 4 item eval.** Run `node <pa>/ev[a]l/run-eval.mjs --skill motion --host claude --model haiku --set items --only item-block-text-behind-subject` (1 billed run; bar `ceil(0.9 × 1)` = valid on the first build; on a miss fix the wording and make the one rerun). Update the Status billed-run total. The GL transition prompt is run the same way in Task 29 if GL ships.
- [ ] **Step 7: Commit, Status row** — replace Gate 3's `(this commit)` with its SHA in the same edit; `feat(make-motion): cutouts on demand (MODNet on onnxruntime) and the text-behind-subject block`.

### Task 29: WebGL spike, ship or drop

**Files:**
- Create: `test/webgl-spike.test.mjs`
- Modify: `.github/workflows/test.yml` (the `workflow_dispatch:` trigger already exists from Task 1; add (a) a dedicated job `webgl-spike-macos` with `runs-on: macos-latest` and `if: github.event_name == 'workflow_dispatch'`, whose steps are checkout, `actions/setup-node@v4` (node 24), then in `working-directory: plugins/portable-artifacts/skills/make-motion` `npm ci`, `npx playwright install chromium`, and `node --test test/webgl-spike.test.mjs` with `env: { PA_WEBGL_SPIKE: '1' }`; the existing `test` matrix job has no node setup, so the spike must not go there; (b) a step `webgl spike` in the Ubuntu `node` job after make-motion, same `if` and env), `<pa>/CHANGELOG.md`, this plan's Status
- If it passes: `template/gl-transitions.mjs`, `scripts/lib/gl-composite.mjs`, `scripts/render.mjs`, `test/gl-transitions.test.mjs`

**Interfaces:**
- The spike (runs only with `PA_WEBGL_SPIKE=1`): a 256x256 WebGL canvas (`--use-angle=swiftshader` launch arg) drawing a gradient and a rotated triangle, screenshotted twice; the test asserts the two SHA-256 are equal within the run and prints `webgl-spike: <platform> <sha>`. The orchestrator reads the macOS and Ubuntu hashes from the CI logs (`gh run view <run id> --log`) and the executor copies them into Status and the CHANGELOG.
- Decision rule: hashes equal across the two runners → implement `gl-ripple` and `gl-cube` through the transition object form (`{ "type": "gl-ripple" }`): during the window `render.mjs` screenshots the outgoing and incoming layers separately, uploads both as textures to a second page running the shader, and screenshots that canvas as the frame; a hash test and a byte-identical-across-workers test gate it. Hashes differ → no transition ships (the two spike CI pieces are removed in the same commit; on the ship path the macOS job stays and also runs `test/gl-transitions.test.mjs`); the CHANGELOG entry reads "WebGL transitions: dropped; the swiftshader frame hashed `<a>` on macOS and `<b>` on Ubuntu", and the PR body says so.

- [ ] **Step 1:** Write the spike test and the two workflow pieces; run locally twice (`PA_WEBGL_SPIKE=1 node --test <skill>/test/webgl-spike.test.mjs`). The orchestrator commits `test(make-motion): WebGL determinism spike`, pushes, runs `gh workflow run test.yml --ref worktree-skills-improvement` (no PR needed; branch pushes do not trigger this workflow), waits for the run, and reads both spike lines from the logs.
- [ ] **Step 2:** Apply the decision rule. Ship path: RED/GREEN on `gl-transitions.test.mjs`, docs, eval prompt `item-transition-gl` run once (`--only item-transition-gl`, 1 billed run, bar valid on the first build, counted in the Status total), commit `feat(make-motion): gl-ripple and gl-cube transitions`. Drop path: CHANGELOG + Status note, commit `docs(make-motion): WebGL transitions dropped after the determinism spike`.
- [ ] **Step 3:** Final: bump plugin.json one minor (cutouts are user-facing), CHANGELOG entry for Phase 4, update every Status row (Task 28's SHA replaces its `(this commit)`; this row keeps `(this commit)`), dispatch the reviewer over the Phase 4 diff (Dispatch bullet; fix CRITICAL and HIGH first), then `git push`.

---

## Self-review notes

- Spec coverage: every roadmap bullet maps to a task (Phase 1 → 4–9; Phase 2 → 11–16; Phase 3 → 18–26; Phase 4 → 28–29); the "What competes means" measurements are the gate steps (Tasks 10, 17, 27); the "This session's calls" items are Tasks 1 (CI ffmpeg), 2 (SOURCE_DATE_EPOCH), 3 (`--set`), 9 (golden sheets, CI does not pixel-diff), 7 and 8 (sidecar, SRT/VTT eval prompts), 25 (storyboard skip), 29 (two CI runners).
- Names used across tasks: `renderHash`/`assertRendersIdentically`/`requireRender`/`makeTestVideo` (Task 2) in every later test; `flattenElements` (Task 4) in Tasks 8, 24; `captionZone`/`safeMargin` (Task 6) in Tasks 8, 11; `expandBlocks`/`BLOCKS` (Task 9) in Tasks 14, 22, 23, 26, 28; `built.overlaps` (Task 12) in Task 13; `frameCacheKey`'s `alpha` (Task 5) in Task 28; `staleOverrides` (existing) in Task 28.
- Billed Haiku runs: Gate 1 13 + 2, Gate 2 8 + 10, Gate 3 16 + 12, Phase 4 1 (+1 if GL ships) = 62 (63), against a cap of 75 that leaves 12 for the one rerun per gate. The Status block keeps the running total; the agent stops and asks before any run that would pass 75.
- Out of scope by the spec's own words: Whisper word alignment (a v2 spike); HeyGen, GSAP, cloud render, `capture <url>`, Remotion import.
- Decided here, not in the spec: ffprobe is required at validate only when a `video` element exists; caption zone top at 78 % (72 % for 9:16 and 4:5); WCAG large text at 24 px / 18.67 px bold scaled by short side; video frame cache as JPEG `-q:v 1` under `<skill>/.cache/video` (PNG for alpha sources), cleared by `doctor --fix cache`; Gate 2's "today" is `--workers 1` on the same machine; WebGL candidates `gl-ripple` and `gl-cube`; MODNet over BiRefNet; Gate 2 runs 10 of the 12 benchmark prompts (the two Phase 3 ones wait for Gate 3), per the spec's post-review calls; opacity is allowed in transitions beside transforms, `clip-path` and `filter`; the example loops read only `references/examples/*.json`, so data side-files live in `references/examples/data/` and the 30 s benchmark in `test/fixtures/`; the version model (Gate 1 renames KPI's `[Unreleased]` section) and the single `Co-Authored-By: Claude <noreply@anthropic.com>` trailer follow the orchestrator's resolutions.
