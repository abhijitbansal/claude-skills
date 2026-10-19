# motion.json reference

Validate with `node scripts/validate.mjs motion.json`. Unknown properties are errors (with did-you-mean). All coordinates are canvas pixels (origin top-left); an element's `x`,`y` is its **centre**.

## Root
| field | type | default | notes |
|---|---|---|---|
| `size` | `[w, h]` ints 16–3840 | `[1920, 1080]` | logical canvas; `render --size` rescales output |
| `fps` | 24 \| 25 \| 30 \| 60 | 30 | |
| `background` | CSS colour | the theme's page colour | |
| `theme` | shared theme name (`dusk`, `press`, `poster`, `paper`, `ink`, `blueprint`, `editorial`) | `dusk` | optional; see below |
| `generatedBy` | `{ model?, effort?, agent? }`, each 1–60 chars of `A-Za-z0-9 ._:/()+-` | none | provenance; shown in the preview footer and written to the MP4 `comment`/`artist` tags; missing fields read "not reported" |
| `scenes` | array, 1–50 | required | total duration ≤ 120 s |

### theme
Without `theme` the spec draws as `dusk` (`render --theme` can pick another for a spec that names none). The theme's **dark** colours and fonts become the defaults: `background` is its page colour, text is its text colour, shapes without a `fill` or `stroke` use its accent, charts take its palette and axis colours, `sans` text uses its body font, `"font": "mono"` its mono font and `"role": "title"` text its display font. A weight the theme font does not ship is mapped to the nearest one it does (no synthetic bold), mono default included. Anything the spec sets itself (`background`, `color`, `fill`, a chart `config`) still wins. Fonts come from the skill's bundled `shared/fonts`, no network. An unknown name is an error with a did-you-mean.

## Scene
`id` (string, globally unique), `duration` (0.2–60 s), `elements` (array), optional `background` (a CSS colour, or `"art"`: the theme's seeded art, drawn full-bleed behind the elements in dark mode at the canvas size and seeded by the scene `id`, so the same spec always gets the same art; a light page-colour scrim dims it and text and counters on it get a soft page-colour halo), `transition` (`none` default | `fade`: scene opacity 0→1 over min(0.4 s, duration)).
Scenes play sequentially; scene *n* starts at the sum of earlier durations. Only the active scene is drawn.

## Audio
Optional root `audio` array, up to 20 tracks. Tracks mix over the whole video; contact sheets ignore them.
| field | type | default | notes |
|---|---|---|---|
| `src` | string | required | relative to the spec file; same path rules as image `src`; `mp3` \| `wav` \| `m4a` \| `aac` \| `ogg` \| `flac` |
| `at` | seconds ≥ 0 | 0 | from the video start; with `scene`, from that scene's start |
| `scene` | scene `id` | none | anchors `at` to the scene, so changing an earlier scene's duration keeps the track aligned |
| `duration` | seconds > 0 | whole clip | trim; the track stops at `start + duration`, clamped to the video end |
| `volume` | 0–1 | 1 | literal gain (the mix is not normalised) |
| `fadeIn` | seconds ≥ 0 | 0 | from the track start |
| `fadeOut` | seconds ≥ 0 | 0 | ends at the `duration` trim, else at the video end. `fadeIn + fadeOut` must fit in the time the track plays. A clip that ends earlier gets no fade (the file length is never probed). No `loop`: a short file just stops |

## Elements
Common: `id` (unique across scenes and elements), `type`, `x`, `y` (required), `opacity` (0–1, default 1), `scale` (1), `rotate` (deg, 0), `keyframes`.

| type | extra fields | animatable props |
|---|---|---|
| `text` | `text` (req), `role` (`title` only; see below), `exit` (boolean, false; see below), `fontSize` (48), `fontWeight` 400\|500\|600\|700\|800 (600), `color` (the theme's text colour), `align` left\|center\|right (center), `maxWidth`, `font` sans\|mono | opacity x y scale rotate |
| `counter` | `to` (req), `from` (0), `decimals` (0), `prefix`, `suffix`, + text styling | + `value` (starts at `from`) |
| `shape` | `shape` rect\|ellipse\|line (req), `width`, `height`, `radius`, `fill`, `stroke`, `strokeWidth` | + `draw` 0–1 (stroke reveal; default 1) |
| `image` | `src` (req, relative to the spec file; must stay inside the spec folder, be a regular file, no symlinks out, no dotfiles), `width`, `height` (req), `fit` contain\|cover\|fill | opacity x y scale rotate |
| `chart` | `vegaLite` (req, with inline `data.values`), `width`, `height` (req) | + `reveal` 0–1 (left-to-right wipe; default 1) |

Title role: a `text` with `"role": "title"` uses the theme's display font (also with `"font": "mono"`; the weight maps to the one the display font ships). When it has **no** `keyframes` it gets the theme's kinetic entrance: `dusk` **rise** (fades in and rises 0.35 × `fontSize` into place, 0.9 s), `press` **ink-in** (fades in while settling from 104% scale, no movement, 1.1 s), `poster` **slam** (snaps in from 135% scale with an `outBack` landing, 0.5 s). A preset is a plain function of the scene duration and `fps`, compressed to end at least one frame before a short scene's end, so renders stay reproducible. Any `keyframes` (an empty list too) turn it off. `paper`, `ink`, `blueprint` and `editorial` have no preset.

Exit (opt-in): `"exit": true` on such a title also gives it the theme's exit, with the `exit` ease: `rise` fades as it drops 0.35 × `fontSize`, `ink-in` fades as it grows back to 104%, `slam` fades as it snaps down to 85%. The exit takes half the entrance (0.45 / 0.55 / 0.25 s) and lands one frame before the scene end, but never starts before 90% of the scene (a shorter scene gets a shorter exit, so the 85% contact frame always shows the title fully in). It is skipped on the spec's last scene, when the entrance has not landed by 90% of the scene, and whenever the title has its own `keyframes`. Without `exit` nothing changes.

Counter default: a counter with **no** `value` keyframes counts `from` → `to` from t=0 to `min(2, 0.8 × scene duration)` seconds with `outCubic`. Add any `value` keyframe to take control of the timing.

Colours (`background`, scene `background` other than `"art"`, `color`, `fill`, `stroke`) must be hex (`#rgb`, `#rrggbb`, with optional alpha), `rgb()/rgba()/hsl()/hsla()` or a named CSS colour. `url(...)`, `var(...)` and anything else is rejected.

Shape notes: a `line` has length `width`, thickness `strokeWidth` and is horizontal; angle it with `rotate`. To grow a vertical bar upward from a baseline, use a line with `"rotate": 270` and animate `draw` 0→1. `fill` defaults to the theme accent for rect/ellipse unless only a `stroke` is given.

Chart notes: data must be inline: `data.values`, or `datasets` plus `data: {name}`. Any `url` key anywhere in the Vega-Lite spec (remote `data.url`, lookup `from.data.url`, image-mark `url`) is rejected; the renderer also blocks all non-local network requests. Do not set `width`/`height` inside `vegaLite`; the element's are used. The theme's fonts, axis colours, accent and palette are applied through a built-in Vega-Lite `config`; your own `config` keys override it. The chart is rendered to SVG once at load.

## Keyframes
`{ "t": seconds, "ease": name, <prop>: value, ... }`
- `t` is relative to the scene start, sorted ascending, ≤ scene duration.
- Per property the track is built from the keyframes that set it: before the first, the value is that keyframe's value; between two, it interpolates using the **destination** keyframe's `ease` (default `linear`); after the last, it holds. Properties no keyframe sets keep the element's base value.
- Sampling: frame *i* shows time *i / fps*, so the last frame is one frame **before** the scene/video end. Put the final keyframe at least one frame (1/fps s) before the scene end, or it is never shown fully.
- `ease`: `linear`, or `in|out|inOut` × `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`, or a named ease: `enter` (cubic-bezier 0.16, 1, 0.3, 1: fast out, soft settle, for entrances), `exit` (0.6, 0, 0.9, 0.35: slow start, accelerating away), `move` (0.65, 0, 0.35, 1: symmetric, for a move between two places), `land` (0.55, 0, 0.2, 1.12: overshoots about 1% just before it lands; one hero moment per clip; never on a counter's `value`, where the number would show past its target). See `motion-design.md`.

## Cross-field errors (examples)
- `scenes[1].elements[0].id: duplicate id "title" (first used at scenes[0].elements[0].id)`
- `scenes[0].elements[0].keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate`
- `scenes[0].elements[0].keyframes[2].t: 5 exceeds scene duration 3`
- `scenes: total duration 121s exceeds the 120s limit`
- `audio[0].src: unsupported audio format ".wma"; use mp3, wav, m4a, aac, ogg or flac`
- `audio[1].scene: scene "outro" not found; scenes: intro, chart`
- `audio[1].at: starts at 9s (scene "chart" + 4s), but the video ends at 8s`
- `audio[0].fadeOut: fadeIn 1s + fadeOut 2.5s exceed the 3s the track plays (from 2s to the video end at 5s)`
- `scenes[0].elements[1].src: file not found: pic.png` (also `must stay inside the spec folder`, `hidden files are not allowed`)
- `scenes[0].elements[0].vegaLite.layer[1].data.url: remote data is not allowed — inline data.values`
- `background: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour)` (for `"art"` on the root: `; "art" is only valid as a scene background`)
- `scenes[0].elements[0].role: unknown role "heading"; did you mean "title"?`
- `scenes[0].elements[0].vegaLite.data.values: required — chart needs inline data.values`

## CLI
- `node scripts/validate.mjs <spec> [--json]` — exit 0 / 1 / 2.
- `node scripts/voice.mjs "<text>" | --text-file <file> --out <file.wav> [--voice af_heart] [--speed 0.5–2]` / `--list-voices` — synthesises a voiceover locally with Kokoro (kokoro-js, Apache-2.0; 24 kHz mono wav; prints the path and duration). Needs `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` (on demand, not part of `npm ci`) and a one-time ~90 MB model download into `<skill-dir>/.cache/models`; offline after that. Exit 0 / 2 usage or not installed / 1 synthesis error.
- `node scripts/preview.mjs <spec> [--open]`
- `node scripts/check.mjs <spec> [--json] [--theme name]` — seeks the render page to every contact-sheet moment (all of them, uncapped); flags a visible text or counter outside the safe area (60 px at 1080 on the short side, on every side: 60 px at 1920x1080, 120 px at 3840x2160) while it is not moving (between or after its keyframe tweens), two visible texts or counters overlapping while neither is moving or fading, and a scene that ends with nothing on screen (every element invisible or wholly off the canvas; a title whose `exit` preset was applied counts as present, since it left on purpose). A box wholly off the canvas has left the frame and is never clipped. `--theme` is the theme for a spec that sets none, as in render.mjs (an unknown name exits 2). A crash prints `check crashed: …` alone (JSON `crashed: true`). Exit 0 ok (or `check: skipped (no browser: …)`), 1 problems, 2 usage.
- `node scripts/render.mjs <spec> [--out file.mp4] [--fps n] [--size WxH] [--theme name] [--model m] [--effort e] [--agent a] [--contact-sheet]` — `--model`/`--effort`/`--agent` override the spec's `generatedBy` (hostile values fail validation, exit 1); `--theme` is a shared theme for a spec that sets none (a spec's own `theme` wins; an unknown name exits 2). Default out `<specdir>/out/<name>.mp4`; with `--contact-sheet`, `--out` is a directory and PNGs go to `<out>/contact/<scene-id>.png` (default `<specdir>/out`). `--size` sides must be 16–3840 and even. Output is written to `<name>.partial.mp4` and renamed on success; Ctrl+C removes it (exit 130/143). When the spec has `audio`, the MP4 also carries an AAC 48 kHz stereo track at 192 kb/s, mixed with normalisation off so `volume` is literal; the video length never changes because of audio. Before any frame is captured each audio file gets a decode probe on its first audio stream (a bad or video-only file fails with `audio[i].src: ffmpeg cannot decode …`, exit 1), and the whole mix graph is dry-run for 0.1 s against a generated video (an ffmpeg older than 4.4 fails with `audio: ffmpeg rejected the mix …`, exit 1). Every track is converted to 48 kHz stereo before mixing, so track order never changes the result. A spec without `audio` renders exactly as before, with no audio stream. `--fps` is an output override (integer 1–120); the spec's own `fps` is limited to 24/25/30/60.
- ffmpeg is looked up as `$FFMPEG_PATH`, then `ffmpeg` on PATH, then an optionally installed `ffmpeg-static`. Audio mixing needs ffmpeg ≥ 4.4 (`amix normalize`, `adelay all`); an older build fails at encode time with `Option normalize not found`.
