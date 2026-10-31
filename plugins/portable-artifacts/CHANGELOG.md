# Changelog

All notable changes to the `portable-artifacts` plugin. Newest first; the version is the one in
[`.claude-plugin/plugin.json`](.claude-plugin/plugin.json). Dates are the commit dates in this repository's history.
Entries for 0.4.0 to 0.7.0 name only what the commit subject of that release says.

## [Unreleased]

### Security

- **Patched `fast-uri` in all five skills.** `ajv` pulls in `fast-uri` 3.0.0 to 3.1.8, which has four moderate advisories
  ([GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
  [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
  [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr),
  [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp), fixed in 3.1.9). Each skill's `package.json`
  now overrides `fast-uri` to 3.1.9 and the lockfiles are regenerated: `npm audit` goes from 1 moderate vulnerability to 0
  in make-dashboard, make-diagram, make-explainer, make-motion and make-scene, and in make-motion's voiceover install.
- **Existing installs are flagged.** The doctor now reports `node_modules` as missing when an installed package in the
  skill's own lockfile tree differs from an exact version pinned in the skill's `overrides`, so an install made before this
  change is offered `npm ci` instead of keeping `fast-uri` 3.1.8. A sister skill (for example make-diagram seen from
  make-explainer) is checked the same way against its own `package.json`. A stale `sharp` or `global-agent` from an old
  voiceover install still turns only the optional `kokoro` item red, not `node_modules`. Run
  `node scripts/doctor.mjs --fix node_modules` once in each skill you already installed. The fix prints what it removes:
  - make-diagram, make-explainer and make-scene install without dev packages, so afterwards run `--fix dev_deps` if you
    use `check.mjs`.
  - make-dashboard installs without dev packages too, but its doctor has no `dev_deps` id; run
    `npm ci --prefix <skill-dir>` if you need them (they are only used by its tests).
  - make-motion keeps its dev packages (a plain `npm ci`) but removes a voiceover install, so run `--fix kokoro` again if
    you use voiceover.

### Added and changed

- **Even KPI rows (make-explainer).** The one-line values in a `kpis` section now share one size. A wide value (11 to 16
  characters) or a long one (over 16, which wraps) keeps its own size. In a section with a wide tile the tiles wrap in rows,
  and the one-line values in a row share a size. make-dashboard is unchanged.
- **Wide-screen check (make-explainer).** `check.mjs` now checks a page at 1800 px as well as 1280 and 390 px. A trimmed page
  built by 0.8.0 fails at 1800 px; it passed before this change.
- **Stale plugin copy warning.** When a build or render runs from a folder under the plugin cache that is not the recorded
  `installPath`, all five skills print one line to stderr. It is silent on other hosts, in repo checkouts and when the
  record is missing, and it never fails a build.
- **Plan mode explains before it asks (make-explainer).** The `plan` scaffold now opens with the summary and numbers, then a
  card per workstream, goals, the tasks as steps, a table of choices already made, a diagram, phases and risks, and only
  then the decisions, approvals and questions. `validate.mjs` warns `a plan asks before it explains` when a decision,
  approval or question comes before any steps, cards, table, files or text section (any page with answerable items). A plan
  page may hold 1,800 words of prose; other pages keep 900. The checked-in plan example is reordered to match.

## [1.0.0] - 2026-10-22

Numbers that stay on one line, cheaper-model routing on GitHub Copilot and Codex, and a plan preset for make-explainer.

### Added and changed

- **Numbers stay on one line.** A number with its unit or percent sign (`1,204 ms`, `18%`, `$4.2k`) is kept whole in
  make-explainer pages and decks (each token in a no-wrap span), make-dashboard KPI values (no-wrap and sized to their
  tile) and make-motion text (a no-break space in place of the space). The token pattern lives once, in
  `shared/nowrap.mjs`. `check.mjs` in make-explainer and make-motion fails on a token that wraps. Typed-out make-motion text
  is bound the same way.
- **Cheaper model on Copilot and Codex (optional).** A small `artifact-builder` agent file (Haiku 5.5 on Copilot, falling
  back to GPT-5.4 nano; `gpt-6-luna` on Codex) that builds from a finished spec. `node bin/install.mjs <copilot|codex|agents>`
  writes it, and so does `doctor.mjs --fix builder_agent` for skills installed with `npx skills`, which copies only skill
  folders. The doctor offers it only when `~/.copilot` or `~/.codex` exists and never writes through a symlink. Measured on
  Copilot CLI 1.0.98: 19 of 19 runs logged `claude-haiku-5.5`; Codex and VS Code Copilot Chat were not tested.
- **Plan mode (make-explainer).** The `plan` preset, with the `decision`, `approval`, `question`, `review` and `verdict`
  sections, builds a page a reviewer answers in the browser. Copy answers or Download `plan-answers.json`, and
  `scripts/answers.mjs` checks the file against the plan and refuses a summary marked invalid. **Save as HTML**, a sticky
  button in the contents menu, downloads the page itself with the answers inside; `answers.mjs` reads that file too. A saved
  page is a full web page, not inert data: open only files you trust. The `mono` and `brief` themes were added for it.
- **Security scanner alerts.** The two skills.sh/Socket "anomaly" alerts on make-diagram and make-explainer are fixed (an
  `fs`-patching test fixture was removed; a page chip tone is now checked against an allow-list). Scores change when
  skills.sh scans again.

## [0.8.1] - 2026-10-22

make-motion: voiceover dependencies on patched versions.

### Security

- **Patched voiceover dependencies.** `kokoro-js@1.2.1` (its latest release) pins `@huggingface/transformers` 3.x, which
  pins `sharp ^0.34`: three high-severity advisories in its bundled libvips, libheif and librsvg
  ([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
  [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), fixed in `sharp` 0.35.5). It also reaches
  `global-agent` 3.x, whose `roarr` dependency pulls in `sprintf-js`
  ([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate, no fix). make-motion's
  `package.json` now overrides `sharp` to 0.35.5 and `global-agent` to 4.1.3 (which no longer uses `roarr`): `npm audit`
  on the voiceover install goes from 7 vulnerabilities (3 high, 4 moderate) to 0.

### Fixed

- **The kokoro install runs from inside the skill folder.** The doctor, `voice.mjs`'s install hint and the docs now use
  `cd <skill-dir> && npm install kokoro-js@1.2.1 --no-save` instead of `--prefix <skill-dir>`, so npm always reads the
  skill's `overrides`. (`--prefix` was reported to skip them on macOS with npm 10.8.2; it applied them in Linux tests.)
- **Existing voiceover installs are flagged.** The doctor now reports kokoro as missing when an installed package differs
  from an exact version pinned in the skill's `overrides`, so an install made before 0.8.1 is offered a reinstall instead
  of keeping `sharp` 0.34.5. If you already use voiceover, run `node scripts/doctor.mjs --fix kokoro` once.

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
