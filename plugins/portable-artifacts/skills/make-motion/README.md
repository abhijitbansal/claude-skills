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
- **Faster renders**: `--workers 4` (1-16, or `auto`) captures frames on several
  pages of one browser and gives the same MP4 as `--workers 1`; `--quality draft`
  renders half the size on each side with a faster encode, for a quick look.
- **Variables and batch renders**: a root `vars` declares typed names (`string` or `number`, with a
  `default`), and `{{name}}` in any string of the spec becomes the value. `--batch rows.json --out
  "renders/{name}.mp4"` renders one MP4 per row of values, checks every row before the first frame, and
  writes a `manifest.json` with each row's status and `sha256`.
- **Beats**: `beats.mjs music.wav` finds the beat grid of a track (ffmpeg, own FFT, 60-200 BPM) and writes a
  `.beats.json`; a root `beats` names it, and a keyframe `t` or a cue, audio or captions `at` may be
  `"beat:<n>"`, resolved to seconds before anything else reads the spec (so a var can pick the beat).
  A track with no steady beat exits 1 instead of guessing, and `--bpm` or `--min-bpm`/`--max-bpm` fix a tempo it reads at half or double.
- **Self-check for models**: `--contact-sheet` writes one tiled, timestamped PNG
  per scene, so a model that can read images can review its own work before
  rendering; `check.mjs` then flags text or counters outside the safe area, overlapping text,
  a scene that ends with nothing visible, low text contrast, text that is not up long enough to read,
  stretches where nothing changes (opt out with `"hold": true`) and text under 28 px, and warns (exit stays 0) when the first
  frame, the video's thumbnail, is blank.
- **Polished by default**: charts draw with about five ticks per axis, no tick marks, no
  y-axis line and no vertical gridlines, bars with rounded ends and a gap, 4 px round
  lines and ringed points. Shapes and text take **theme colour tokens**
  (`"fill": "surface"`, `"color": "accent"`) that follow the theme, rects can be
  `elevated` cards, and lines can have round caps and an arrow head.
- **Blocks**: fifteen parameterised building blocks (`title-card`, `lower-third`, `kpi-counter`, `step-flow`, `quote-card`, `checklist`, `logo-outro`, `cta-close`, four for short-form video: `cta-soft`, `story-beats`, `listicle` and `before-after-swipe`, and three for code: `code-typing`, `code-diff` and `terminal-run`), each
  written as one `block` element with a few params (`"block": "lower-third", "params": { "name": "Ada" }`) and
  expanded into plain elements laid out for the canvas, coloured with theme tokens. `blocks.mjs list` and
  `blocks.mjs show <name>` print each block's params and an example; `references/blocks/` holds a contact sheet
  of each.
- **Scene transitions**: `"transition": "crossfade"` fades the new scene in over the previous one (which
  stays fully visible beneath) over 0.4 s; `push`, `slide`, `wipe`, `zoom`, `blur` and `iris` move, clip,
  scale or blur it in, and `{ "type": "push", "direction": "up", "duration": 0.6 }` picks the edge and the
  length; a root `transition` sets the default.
- **Scene camera**: a scene's `camera` keyframes `zoom` (0.5–3), a pan (`x`, `y` px) and a roll (`rotate`) of
  every element in the scene about the canvas centre, and `shake` (`amount` px, `hz`, `seed`) adds a seeded
  handheld jitter; the same spec always shakes the same way. The background, captions, grain and the vignette stay put.
- **Captions**: a `captions` track from an SRT, VTT or Whisper JSON file, or the voiceover's
  sentence timings, shown two to six words at a time in the caption zone in one of six styles
  (`plain`, `pill`, `karaoke`, `kinetic`, `boxed`, `typewriter`); `check.mjs` keeps other text out
  of the zone.
- **Procedural sound cues**: a `cues` array (`pop`, `click`, `whoosh`, `chime`, `impact`,
  `riser`, `swoosh`, `typing`, `drop`, `ding`) is synthesised locally in layers (transient,
  body, short reverb tail; stereo width above about 120 Hz on the noise sweeps) with no files and
  no extra dependency, deterministically, and mixed in; a `typing` cue with `follow` clicks
  along with a typing text; after any render with audio, `render.mjs` prints the integrated loudness and
  true peak. Twelve recorded clicks and hits (Kenney, CC0, 48 kHz WAV, about 261 KB in all) are
  bundled as `"cue": "kenney:<name>"` (click, tick, switch, select, confirm, error, open, close,
  pluck, glass, thud, metal); they need no download and fetch nothing at render. Opt-in: no `cues`, no sound
  (except in viral mode, below, which places cues unless the spec writes `cues`).
- **Viral mode**: `"mode": "viral"` for Reels, TikTok and Shorts: 9:16 at 1080x1920, a
  platform safe zone (top 290, bottom 675, left 120, right 195 px; `viral.safeZone` overrides it)
  with captions lifted above the bottom band, the first scene's title on screen from frame 0 as the
  hook, cues placed on cuts, entrances and counter landings, and a −14 LUFS / −1 dBTP loudness
  target that `render.mjs` reports against. `check.mjs` warns (never fails) on a hook outside 3–7
  words, text under a platform band, more than 3 s with no change, audio without captions, a
  non-9:16 canvas and, with `viral.loop`, an ending that does not match the start. The numbers are
  tunable defaults from platform ad specs, not platform rules.
- **Texture and typing**: an opt-in root `texture` adds a vignette and static film grain
  (measured cost below), and `"typing": true` types a line out at 0.035 s per character
  with a caret.
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
node $SKILL/scripts/check.mjs motion.json                 # safe area, overlaps, empty endings, contrast, reading time, dead stretches, small text
node $SKILL/scripts/preview.mjs motion.json --open         # scrubber, play/pause, live reload
node $SKILL/scripts/render.mjs motion.json                 # out/motion.mp4, 1920x1080 @ 30 fps
```

From an agent, just ask: *"Make an 8-second clip: Q3 revenue up 18%, then a
bar chart of Q1–Q3."* In Claude Code or Copilot you can call `/make-motion …`,
and in Codex `$make-motion …`.

Before it writes the spec, the agent runs one intake round: one message of
questions with the defaults already picked: format (1920x1080, or 1080x1920 for Reels, TikTok and
Shorts), length, your own photos, logo, music or voice file, a voiceover,
sound cues, theme and a closing line. Answer once, or say "defaults". Run
non-interactively (`claude -p`, `codex exec`, `copilot -p`), it skips the round,
builds with the defaults and its report says so.

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
| `text` | `text`, `role` (`title`: display font, plus the theme's entrance when it has no `keyframes`), `fontSize`, `fontWeight`, `color`, `align`, `maxWidth`, `font` (`sans`/`mono`; mono wins over the title role), `typing` | `opacity x y scale rotate` (+ `value`, the characters typed, with `typing`) |
| `counter` | `from`, `to`, `decimals`, `prefix`, `suffix` + text styling | + `value` (with no `value` keyframes it counts from→to automatically) |
| `shape` | `shape` (`rect`/`ellipse`/`line`), `width`, `height`, `radius`, `fill`, `stroke`, `strokeWidth`, `elevated` (rect), `cap` and `arrow` (line) | + `draw` (0–1 stroke reveal) |
| `image` | `src` (relative to the spec), `width`, `height`, `fit` | `opacity x y scale rotate` |
| `video` | `src` (an mp4, mov, webm or m4v relative to the spec), `width`, `height`, `fit`, `trimStart`, `trimEnd`, `offset`, `mute`, `volume`; decoded once into a frame cache (`.cache/video`, cleared by `doctor.mjs --fix cache`) so every frame is exact; its sound joins the mix unless muted | `opacity x y scale rotate` |
| `chart` | `vegaLite` with inline `data.values`, `width`, `height` | + `reveal` (0–1 left-to-right wipe) |
| `group` | `children` (1–40 elements, up to 3 groups deep), each placed relative to the group's centre | `opacity x y scale rotate`, applied to every child at once |
| `code` | `code`, `lang` (`text`, `javascript`, `typescript`, `json`, `bash`, `python`, `diff`, `go`, `rust`, `swift`, `yaml`, `html`, `css`, `markdown`), `width`, `height`, `fontSize` (28), `highlight` (line numbers), `diff`, `typing`; highlighted offline with shiki (JavaScript regex engine, no wasm) in the theme's colour tokens, drawn as text, never markup | `opacity x y scale rotate` (+ `value`, the characters typed, with `typing`) |
| `block` | `block` (one of the eight block names), `params` (that block's own fields); expands into a group of parts named `<id>/<part>`, so validator errors name `params.<field>` | `opacity x y scale rotate`, applied to the whole block |

A scene's `background` is a CSS colour or `"art"`: the theme's seeded art,
full-bleed behind the elements and seeded by the scene `id`. A shape `fill` or
`stroke` and a text `color` may be a theme token (`surface`, `line`, `accent`,
`accentSoft`, `good`, `bad`, `warn`, `text`, `text2`, `text3`, `cat1`..`cat6`) instead of
a colour; it resolves to the active theme's dark colour.

Root-level options (all off unless set): `transition` (a name, `none`, `fade`, `crossfade`, `push`, `slide`, `wipe`, `zoom`, `blur` or `iris`, or
`{ type, direction?, duration? }`; the default for every scene), `cues` (up to 30 sound cues, timed from the video or a scene
start), `captions` (up to 20 tracks, each an SRT, VTT or JSON file and a `style`), `texture` (`vignette`, and `grain` from 0 to 0.15). Texture costs render time, measured
on 1920x1080 frames (seek plus PNG screenshot, headless Chromium, one Apple-silicon Mac): about
17 to 33 ms per frame with none, 42 ms with the vignette, 100 ms with grain and 187 ms with both.

Keyframes are `{ "t": seconds-in-scene, "ease": "outCubic", …props }`. Each
property holds its value before its first keyframe, interpolates between
keyframes using the later keyframe's ease, and holds after the last one.
There are 28 anime.js eases, from `linear` to `inOutElastic`. The full reference
is [`references/schema.md`](references/schema.md), and there are 4 complete
examples in [`references/examples/`](references/examples/).

## Scripts

| Command | Does | Flags |
|---|---|---|
| `validate.mjs <spec>` | Schema plus cross-field checks (unique ids, keyframe times, per-type props, image, video and audio paths, video trims against the clip length (needs ffprobe), audio scene/start/fade fits, captions files parsed (a cue out of order names its line), chart compile, no remote URLs) | `--json` |
| `blocks.mjs list` / `blocks.mjs show <name>` | One line per block with its params (optional ones marked `?`); or one block's params table (type, required, default, description), where it goes on each format, and a ready-to-paste element. An unknown name exits 2 with the closest one and the list | none |
| `voice.mjs "<text>"` | Local Kokoro voiceover → 24 kHz wav for `audio[].src` (kokoro-js installed on demand, ~250 MB + 90 MB model once) | `--out <file.wav>`, `--voice`, `--speed`, `--list-voices` |
| `beats.mjs <audio>` | Beat grid of an audio file (ffmpeg; the first five minutes) → `<stem>.beats.json` for a spec's root `beats`; prints the path and `<bpm> BPM, <n> beats`; exit 1 with `no steady beat found in <file> (confidence …; needs 0.5)` | `--out <file>.json`, `--min-confidence <0-1>`, `--bpm <n>` (force the tempo), `--min-bpm <n>` / `--max-bpm <n>` (narrow the search) |
| `preview.mjs <spec>` | Local preview on `127.0.0.1`: scrubber, play/pause, scene markers, Space and ←/→ for single frames, and live reload when the file changes (invalid specs show their errors in the page). Audio tracks play in sync, approximately; `M` mutes. The MP4 timing is exact | `--open` |
| `render.mjs <spec>` | MP4 (H.264, yuv420p; AAC audio when the spec has `audio` tracks, `cues` or an unmuted `video` clip with sound, followed by one `audio: … LUFS integrated, true peak … dBTP` line) via Playwright frame capture → ffmpeg. The provenance stamp (`generatedBy` or the flags) goes into the MP4's `comment` tag, and the model into `artist` when reported | `--out <file>`, `--fps <n>`, `--size WxH`, `--theme <name>`, `--model <m>`, `--effort <e>`, `--agent <a>`, `--workers <n or auto>`, `--quality <draft or final>`, `--contact-sheet`, `--batch <rows.json>` (with an `--out` template holding `{index}` or a `{var}`) |
| `check.mjs <spec>` | Seeks the render page to every contact-sheet moment and reads each element's box: a visible text or counter outside the safe area (60 px at 1080 on the short side, on every side) while it is not moving, visible texts or counters overlapping while neither is moving or fading (a cross-fade swap is fine), a scene that ends with nothing on screen; text whose colour has less than 4.5:1 (3:1 for large text) contrast against the pixels behind it, a text on screen for less than 0.75 × (0.5 + 0.3 × words) seconds (a last line under 2 s is only an `info:` note), more than 3 s in which nothing changes (not in the last 3 s, not for `"hold": true` elements) and text under 28 px at 1080 on the short side for 0.5 s or more (a contrast or size finding at one moment only is a warning); with `captions`, a text or counter held in the caption zone while a caption shows and a captions layer that leaves it (measured once per caption group). An element that has left the frame entirely is gone, not clipped. It also warns on stderr (never a failure) when the first scene shows nothing at t = 0. Exit 0 ok, 1 problems, 2 usage; without a browser it prints `check: skipped (no browser: …)` and exits 0 | `--json`, `--theme <name>` |
| `doctor.mjs` | What the skill needs and is missing (ffmpeg, a browser, `node_modules`), with the fix for your OS; `--fix <ids>` installs the ones that need no `sudo`. Lists the video frame cache once it passes 2 GB; `--fix cache` deletes it. Runs before `npm ci` | `--json`, `--for <spec.json\|check\|voiceover>`, `--fix <id[,id]>` |

Two renders of the same spec and media give identical frames and audio; the MP4 `comment` tag carries the build date, so the files differ by day unless `SOURCE_DATE_EPOCH` is set.

Limits: up to 50 scenes and 120 s in total, up to 20 audio tracks, 30 cues and 20 captions tracks; fps is 24, 25, 30 or 60; each side
is 16–3840 px. Frame *i* samples `t = i / fps`, so put a final keyframe at
least one frame before the scene ends.

**Chromium**: rendering uses Playwright's bundled Chromium, which gives the
same output on every machine. If it isn't installed, rendering falls back to
installed Google Chrome with a warning. **ffmpeg**: found via `$FFMPEG_PATH`,
then `PATH`, then an optional `ffmpeg-static` install. It is never bundled.

## Security

- The preview server binds `127.0.0.1`, rejects non-local `Host` headers (DNS
  rebinding) and serves only its own files plus the image, video, audio and
  captions files the spec names (and the frames decoded from those videos). Media
  paths can't leave the spec's folder.
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
