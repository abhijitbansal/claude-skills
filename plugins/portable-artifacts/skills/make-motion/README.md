# make-motion

**Prompt → scene spec → live preview → deterministic MP4.** Short animated
explainers (titles, counters, shapes, lines that draw in, Vega-Lite charts,
images), rendered locally from open-source parts by any agent that can run
shell commands.

<p>
  <img src="../../../../docs/features/img/portable-artifacts/motion-q3-revenue.gif" alt="A counter animates to +18%, then three revenue bars grow" width="49%">
  <img src="../../../../docs/features/img/portable-artifacts/motion-how-it-works.gif" alt="Three step cards appear while connecting lines draw in" width="49%">
</p>

- **One spec, `motion.json`**: scenes → elements → keyframes. The agent
  never writes animation code.
- **Targeted edits**: "slow scene 2" or "change the number to 25" edits one
  field, and everything else renders the same.
- **Deterministic**: every frame is captured after seeking the timeline to
  exactly `i / fps`, never in real time, so the same spec always gives the
  same video.
- **Self-check for models**: `--contact-sheet` writes one tiled, timestamped PNG
  per scene, so a model that can read images can review its own work before
  rendering; `check.mjs` then flags text outside the safe area, overlapping text
  and a scene that ends with nothing visible.
- **Stamped**: the preview has a favicon, a `<meta name="generator">` and a provenance footer (model, effort
  and agent from the spec's `generatedBy`; "not reported" when unknown; `preview.mjs`
  takes no flags), and the MP4 carries the same in its metadata (`render.mjs` also
  takes `--model`/`--effort`/`--agent`). The preview has no theme
  toggle: it is a dark-only local tool, and the video follows the spec's theme.
  `scripts/doctor.mjs` reports a missing ffmpeg or browser before the first render.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This
> README is for people.

## Quick start

```bash
cd make-motion && npm ci && npx playwright install chromium && cd -   # one-time
node make-motion/scripts/doctor.mjs   # optional: reports ffmpeg, the browser and anything else missing
# plus ffmpeg on PATH:
#   macOS:   brew install ffmpeg
#   Windows: winget install Gyan.FFmpeg   (then open a new terminal)
#   Linux:   sudo apt-get install ffmpeg  (and use: npx playwright install --with-deps chromium)

SKILL=path/to/make-motion
cp $SKILL/references/examples/q3-revenue.json motion.json
node $SKILL/scripts/validate.mjs motion.json              # `valid`, or path-precise errors
node $SKILL/scripts/render.mjs motion.json --contact-sheet # out/contact/<scene>.png
node $SKILL/scripts/check.mjs motion.json                 # safe area, overlaps, empty endings
node $SKILL/scripts/preview.mjs motion.json --open         # scrubber, play/pause, live reload
node $SKILL/scripts/render.mjs motion.json                 # out/motion.mp4, 1920x1080 @ 30 fps
```

From an agent, just ask: *"Make an 8-second clip: Q3 revenue up 18%, then a
bar chart of Q1–Q3."* In Claude Code or Copilot you can call `/make-motion …`,
and in Codex `$make-motion …`.

## The spec

```json
{
  "size": [1920, 1080], "fps": 30, "background": "#0b0d12",
  "scenes": [
    { "id": "intro", "duration": 4, "transition": "fade",
      "elements": [
        { "id": "title", "type": "text", "text": "Q3 revenue", "x": 960, "y": 380,
          "fontSize": 72, "fontWeight": 700, "color": "#ffffff",
          "keyframes": [ { "t": 0, "opacity": 0, "y": 420 },
                         { "t": 0.6, "opacity": 1, "y": 380, "ease": "outCubic" } ] },
        { "id": "pct", "type": "counter", "from": 0, "to": 18, "prefix": "+", "suffix": "%",
          "x": 960, "y": 560, "fontSize": 200, "fontWeight": 800, "color": "#5eead4" }
      ] }
  ]
}
```

| Element `type` | Key fields | Animatable |
|---|---|---|
| `text` | `text`, `role` (`title`: display font, plus the theme's entrance when it has no `keyframes`), `fontSize`, `fontWeight`, `color`, `align`, `maxWidth`, `font` (`sans`/`mono`) | `opacity x y scale rotate` |
| `counter` | `from`, `to`, `decimals`, `prefix`, `suffix` + text styling | + `value` (with no `value` keyframes it counts from→to automatically) |
| `shape` | `shape` (`rect`/`ellipse`/`line`), `width`, `height`, `radius`, `fill`, `stroke`, `strokeWidth` | + `draw` (0–1 stroke reveal) |
| `image` | `src` (relative to the spec), `width`, `height`, `fit` | `opacity x y scale rotate` |
| `chart` | `vegaLite` with inline `data.values`, `width`, `height` | + `reveal` (0–1 left-to-right wipe) |

A scene's `background` is a CSS colour or `"art"`: the theme's seeded art,
full-bleed behind the elements and seeded by the scene `id`.

Keyframes are `{ "t": seconds-in-scene, "ease": "outCubic", …props }`. Each
property holds its value before its first keyframe, interpolates between
keyframes using the later keyframe's ease, and holds after the last one.
There are 28 anime.js eases, from `linear` to `inOutElastic`. The full reference
is [`references/schema.md`](references/schema.md), and there are 4 complete
examples in [`references/examples/`](references/examples/).

## Scripts

| Command | Does | Flags |
|---|---|---|
| `validate.mjs <spec>` | Schema plus cross-field checks (unique ids, keyframe times, per-type props, image and audio paths, audio scene/start/fade fits, chart compile, no remote URLs) | `--json` |
| `voice.mjs "<text>"` | Local Kokoro voiceover → 24 kHz wav for `audio[].src` (kokoro-js installed on demand, ~250 MB + 90 MB model once) | `--out <file.wav>`, `--voice`, `--speed`, `--list-voices` |
| `preview.mjs <spec>` | Local preview on `127.0.0.1`: scrubber, play/pause, scene markers, Space and ←/→ for single frames, and live reload when the file changes (invalid specs show their errors in the page). Audio tracks play in sync, approximately; `M` mutes. The MP4 timing is exact | `--open` |
| `render.mjs <spec>` | MP4 (H.264, yuv420p; AAC audio when the spec has `audio` tracks) via Playwright frame capture → ffmpeg. The provenance stamp (`generatedBy` or the flags) goes into the MP4's `comment` tag, and the model into `artist` when reported | `--out <file>`, `--fps <n>`, `--size WxH`, `--theme <name>`, `--model <m>`, `--effort <e>`, `--agent <a>`, `--contact-sheet` |
| `check.mjs <spec>` | Seeks the render page to every contact-sheet moment and reads each element's box: visible text outside the safe area (60 px at 1080 on the short side, on every side) once it has landed, overlapping visible text, a scene that ends with every element invisible. Exit 0 ok, 1 problems, 2 usage; without a browser it prints `check: skipped (no browser: …)` and exits 0 | `--json` |
| `doctor.mjs` | What the skill needs and is missing (ffmpeg, a browser, `node_modules`), with the fix for your OS; `--fix <ids>` installs the ones that need no `sudo`. Runs before `npm ci` | `--json`, `--for <spec.json\|check\|voiceover>`, `--fix <id[,id]>` |

Limits: up to 50 scenes and 120 s in total, up to 20 audio tracks; fps is 24, 25, 30 or 60; each side
is 16–3840 px. Frame *i* samples `t = i / fps`, so put a final keyframe at
least one frame before the scene ends.

**Chromium**: rendering uses Playwright's bundled Chromium, which gives the
same output on every machine. If it isn't installed, rendering falls back to
installed Google Chrome with a warning. **ffmpeg**: found via `$FFMPEG_PATH`,
then `PATH`, then an optional `ffmpeg-static` install. It is never bundled.

## Security

- The preview server binds `127.0.0.1`, rejects non-local `Host` headers (DNS
  rebinding) and serves only its own files plus the image files the spec
  names. Image paths can't leave the spec's folder.
- No network from specs: chart `url` keys and `url()` colours are rejected,
  the page runs under a CSP whose script hash covers only its own import
  map, and the renderer aborts any non-local request.
- A render that fails or is interrupted (SIGINT/SIGTERM) kills ffmpeg, closes
  the browser and deletes the partial file.

## Requirements and licences

Node.js ≥ 20, ffmpeg (≥ 4.4 for audio tracks), Chromium (one-time download) or Google Chrome. The
dependencies, pinned by the lockfile, are anime.js v4 (MIT), Playwright
(Apache-2.0), Vega, Vega-Lite and vega-interpreter (BSD-3-Clause), Ajv (MIT),
and the theme fonts in the synced `shared/fonts` (OFL-1.1). The `@fontsource/inter` and
`@fontsource/jetbrains-mono` npm packages are still pinned but no longer read: the
default look now comes from `dusk`, and the `press` theme gets JetBrains Mono from `shared/fonts`.
