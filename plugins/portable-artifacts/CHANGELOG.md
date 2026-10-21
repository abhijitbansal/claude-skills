# Changelog

All notable changes to the `portable-artifacts` plugin. Newest first; the version is the one in
[`.claude-plugin/plugin.json`](.claude-plugin/plugin.json). Dates are the commit dates in this repository's history.
Entries for 0.4.0 to 0.7.0 name only what the commit subject of that release says.

## [0.8.0] - 2026-10-21

make-motion: polish, crossfade, sound cues, texture and typing.

### Added

- **Theme colour tokens.** A shape `fill` or `stroke` and a text or counter `color` can name a token of the active theme
  (`surface`, `line`, `accent`, `accentSoft`, `good`, `bad`, `warn`, `text`, `text2`, `text3`, `cat1` to `cat6`), so a theme
  change recolours it. Backgrounds still take only colours; an unknown token is an error that lists the tokens.
- **`elevated` rects.** A card: the fill moves 6 % toward the text colour and a 1 px inner highlight follows the edge
  (drawn in with `draw`, omitted on a stroke-only rect).
- **Round caps and arrows on lines.** `"cap": "round"` and `"arrow": "end"`. The validator names the minimum width a line
  needs for them.
- **Scene crossfade.** `"transition": "crossfade"` (also a root default): the new scene fades in over the previous one for
  0.4 s while the previous one stays fully visible, so the stage colour never shows through (two white scenes keep a mean
  luma of 255 through the window).
- **Procedural sound cues.** A root `cues` array (up to 30) of `pop`, `click`, `whoosh`, `chime` and `impact`, synthesised
  locally with no files and no new dependency, the same bytes every time, mixed with any `audio` tracks. Opt-in: a spec
  without `cues` is unchanged. A render with audio now ends with one line, for example
  `audio: -20.6 LUFS integrated, true peak -9.1 dBTP` (ffmpeg `ebur128`; a report, not a gate).
- **Texture.** A root `texture` with `vignette` and a static `grain` (0 to 0.15), off by default. Grain is
  luminance-neutral (the mean luma of a frame stays within 1 of the grain-free frame at 0.15 in dusk, paper and press).
  Measured cost at 1920x1080 (seek plus PNG screenshot, 90 frames, headless Chromium on one Apple-silicon Mac): about
  17 to 33 ms per frame with no texture, 42 ms with the vignette, 100 ms with grain and 187 ms with both.
- **Typing text.** `"typing": true` types a line at 0.035 s per character with a caret, counted in graphemes; its box is
  the full text at every moment, so it never reflows. `value` keyframes take over its pace; a line that cannot finish
  inside its scene (also at `render.mjs --fps`) is an error naming the fix.
- **`check.mjs` warnings** (exit stays 0): a blank first frame, which is the video's thumbnail (the message names the cause:
  a `fade`, an opacity 0 first keyframe such as a title's theme entrance, an undrawn line or chart, an empty typing
  text), and text of the outgoing and incoming scene that overlap inside a crossfade.
- A new showcase clip in the gallery (`relay-teaser`) that uses these features.

### Changed

- **Calmer chart defaults.** About five ticks per axis, no tick marks, no y-axis line, no vertical gridlines, bars with
  10 px rounded ends and a gap between them, 4 px lines with round caps and joins, filled points ringed in the page
  colour (a hollow `filled: false` point keeps its outline), and a chart reveal with a soft edge.
- `"font": "mono"` now wins over `"role": "title"` (a mono title draws in the mono font and keeps the entrance preset).
- The four bundled `references/examples` show something at frame 0.
- The dusk gallery clips `prompt-to-dashboard`, `sql-guard-explainer` and `quarterly-highlights-square` were re-rendered
  from their committed specs.

## [0.7.0] - 2026-10-19

- make-scene: interactive 3D scenes (city, forest, galaxy, terrain) with diagram and dashboard lifts.

## [0.6.0] - 2026-10-19

- claude-motion-inspired diagram and motion upgrades; chrome-form-widgets folded in.

## [0.5.0] - 2026-10-19

- Design refresh with the `dusk`, `press` and `poster` themes.

## [0.4.0] - 2026-10-15

- make-dashboard v2, make-diagram and make-explainer.
