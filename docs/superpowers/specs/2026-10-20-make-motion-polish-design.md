# make-motion polish and claude-motion adoptions — Design

*2026-10-20 · branch `feat/motion-polish` · owner approved the scope in chat ("do it all in 1 branch")*

Builds on `2026-10-19-inspired-by-claude-motion-design.md`, which excluded four claude-motion ideas.
Two fresh-context reviews (a Fable 5.1 product review and an Opus 5.5 render-and-look polish audit) re-judged
them, and the owner asked for more polished boxes and shapes. Measurements below were made by those reviewers
with `animejs@4.5.0` and Playwright Chromium; the implementer re-measures anything a test depends on.
Ideas and numbers are paraphrased from [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT); no code or prose is copied. Zero new npm dependencies.

## Why

1. Cards, lines and charts in rendered videos look flat and coarse: hex-only colours mean a theme change only swaps
   fonts, card borders vanish on dark themes, charts carry 13 gridlines and 8 px ticks.
2. Every scene change is a hard cut. Sound needs files the user must find. A clip has no texture.
3. Two of the four earlier exclusions rested on reasons that did not hold when measured.

## Goals

- Boxes, lines, shapes and charts read as polished in every theme, with additive, opt-in spec fields where a change
  could alter existing specs, and better defaults where it cannot.
- Scene crossfade; procedural sound cues; vignette and static grain; a typing text reveal.
- Determinism kept: same spec, same MP4 (and same WAV).

## Non-goals and anti-goals

Non-goals: web-sims (needs per-piece JS, contradicts "you never write animation code", make-scene's lane); spring presets (covered by `outBack`, `outElastic`, `land`; make-motion is mostly type); auto-mastering to −14 LUFS (`amix normalize=0` and literal volume are deliberate); persistent objects across scenes; animated per-frame grain (an in-page seed change does not repaint, and per-frame cost is about 2.5×); a `card` primitive and a default rect radius (deferred, listed in the PR).
Anti-goals: round line caps as a default (`q3-revenue` draws bars as thick lines); a guardrail that is red on shipped examples; any new network request or new dependency; sound that is on unless the user asks.

## Verified facts that shape the plan

- Named eases are functions (`template/timeline.mjs:12`); anime.js `Spring` objects override segment duration, `spring().ease` functions do not (not used here).
- `shared/art.mjs:87` already ships `feTurbulence`; same seed renders byte-identical PNGs. `shared/art.mjs:50` has `mulberry32`.
- Audio mixes through `scripts/lib/ffmpeg.mjs:60` (`amix normalize=0`); `template/audio.mjs:7` has `trackStart`; `references/schema.md:30` says volume is literal.
- `renderer.mjs:259-262` shows only the active scene layer; `fade` is a fade-in from the background (`timeline.mjs:62-65`).
- Shapes: `makeShape` `renderer.mjs:94-98`, rect `rx: el.radius ?? 0` at `:101`; text style `:79`, `fontKind` `:37` and `:82-83` (title role beats `font: "mono"`); chart reveal uses `clip-path` at `:268`; `VEGA_CONFIG` `renderer.mjs:14-23`; colour validation `references/schema.md:51`.
- `test/theme-render.test.mjs:71` reads the first `.el.shape rect` fill. There are no MP4 hash goldens; the only byte test is for art (`test/render-smoke.test.mjs:247`).
- `check.mjs` reads boxes, not pixels. Preview audio sync is approximate (`template/preview-audio.mjs:2`).

## Plan (one branch, one commit per phase, tree green after each)

### P1 — Polish (shapes, lines, charts)

- **Theme colour tokens** in `fill`, `stroke` and `color`: `surface`, `line`, `accent`, `accentSoft`, `good`, `bad`, `warn`, `text`, `text2`, `text3`, `cat1`..`cat6`. Resolved from the active theme (dark/light variant as the theme already does) in `makeShape` and `textStyle`; the validator accepts a token as well as hex and names the token list in its error. Additive: hex specs render unchanged.
- **`elevated: true` on a rect**: a 1 px inset highlight (`rgba(255,255,255,.06)` stroke on an inset rect, drawn after the main rect) and a fill one step toward `text`. No drop shadow (invisible on dark pages). Respect `theme-render.test.mjs:71`.
- **Line `cap: "round"`** (opt-in; endpoints inset by half the stroke width so the cap does not overshoot) and **`arrow: "end"`** (a filled triangle path whose opacity follows `draw >= 0.98`; not an SVG `marker`). Round caps never default. The `draw` dashoffset animation stays clean.
- **Mono precedence**: `font: "mono"` wins over `role: "title"` in `fontKind`; update the schema line that says otherwise. Changes bytes of the sql-guard reject scene.
- **Chart defaults** in `VEGA_CONFIG` and `themedLook`: y `tickCount` 5, no domain line and no tick marks on y, no ticks on x; `bandPaddingInner` 0.3; bar `cornerRadiusEnd` 10; line `strokeWidth` 4 with round cap and join; points with a page-coloured 3 px ring. Chart reveal uses a soft `mask-image` edge in place of the hard `clip-path`.
- **Guidance** in `references/motion-design.md`: drop an axis title that repeats the chart title; use `chart`, not thick `line`s, for bars; no long dead holds on a chart scene.
- Tests (RED first): token resolution and rejection; `elevated` adds one extra node after the rect; `cap` insets endpoints; `arrow` appears only at `draw >= 0.98`; mono precedence; chart config values; a screenshot of dusk and one of press/poster, viewed.

### P2 — Scene crossfade and frame-0 warning

- **`transition: "crossfade"`** on a scene (and a root default): the previous layer stays visible and fades out over 0.4 s under the new one. One extra opacity track; two visible layers in `makeApply`; the render loop and the contact sheet sample it; `check.mjs` overlap and empty-end rules are told about the window so they neither false-fail nor miss.
- **Frame-0 warning** in `check.mjs`: a warning (not a failure) when scene 1 shows nothing at t = 0; one SKILL.md line "no `fade` on scene 1".
- Tests: a mid-crossfade frame has two layers visible; no transition keeps today's output; the warning fires on a fade-in first scene and not on a shown title; `check.mjs` on a crossfade pair is green.

### P3 — Procedural sound cues

- Root `cues` array: `{ "cue": "pop"|"click"|"whoosh"|"chime"|"impact", "scene", "at", "volume", "pan"?, "note"? }`, timed with `trackStart` so retiming keeps cues aligned; capped in number (validator error names the cap). Five generators in a new Node module, PCM to a 16-bit WAV with `Buffer`, noise seeded with `mulberry32`; same spec gives the same WAV bytes. Fed into the existing `amix` graph as one more track; volume stays literal; policy stays opt-in (no `cues`, no audio change; a silent clip stays silent).
- After any render with audio, print ffmpeg `ebur128` integrated loudness and true peak.
- Preview may skip cue playback.
- Reference rules in `motion-design.md`: one impact and one riser per clip; continuous motion stays silent.
- Tests: WAV hash per generator; a spec with cues adds a track and a spec without does not; the doctor/requirements path needs nothing new (no install); validator rejects an unknown cue, a bad `at`, and too many cues.

### P4 — Texture and typing

- Root `texture: { "vignette": true, "grain": 0..0.15 }`. Vignette: one CSS radial-gradient layer (clear to about 55 %, about 0.55 black at the edge). Grain: one static `feTurbulence` layer per scene, seeded from the scene id, as `background: "art"` does. Opt-in; default off.
- `"typing": true` on a text element: characters revealed 0 to N at 0.035 s per character with a caret, driven by the same timeline as counters; honours reduced-motion/preview the way other text does.
- Tests: vignette adds one layer; same spec renders byte-identical grain frames; typing reveals the right count at a given time; `check.mjs` is unaffected.

### P5 — Docs, schema, version, site

`references/schema.md`, `SKILL.md`, `README.md`, `references/motion-design.md`; `docs/features/portable-artifacts.html` feature page text for make-motion; bump `plugins/portable-artifacts/.claude-plugin/plugin.json` (CI guard); `python3 scripts/sweep_counts.py --check`. Re-rendering committed gallery videos is **not** part of this branch (the press and poster voiceover WAVs are not committed, so those specs cannot render as they stand); the PR says so.

## Verification

Per phase: `npm test` in make-motion; at the end the make-diagram, make-explainer and make-dashboard suites (shared code), `bats tests/bats`, `pytest tests/pytest -q`, `sweep_counts.py --check`. Visual work is not done until a rendered frame in at least two themes was viewed.

## Dispatch

One branch; phases run in sequence (they share `renderer.mjs`, `schema.md` and `spec.mjs`). Executors: Sonnet 5, high; they may commit on this branch and must not push. A fresh Opus 5.5 reviewer reads the whole diff at the end (report only). The orchestrator pushes, opens the PR and merges only on the owner's word.
