# portable-artifacts design refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three art-directed themes (`dusk` default, `press`, `poster`) with a procedural art generator, and rebuild make-explainer (page and deck) and make-motion on them.

**Architecture:** Themes are new JSON files in `plugins/portable-artifacts/shared/themes/` using the existing token schema, so every existing consumer keeps working. `shared/` is the single source; `node bin/sync-shared.mjs` copies it into each skill. Explainer and motion get their own default-theme constants (the pattern make-diagram uses with `DIAGRAM_THEME`) so the shared `DEFAULT_THEME = 'paper'` and make-dashboard are untouched. A seeded SVG art generator lives in `shared/art.mjs`; templates and renderers consume it.

**Tech Stack:** Node >= 21 ESM with no npm deps in skills, `node --test`, plain CSS with custom properties, woff2 fonts from `@fontsource/*` (OFL), headless Chrome for visual checks.

**Spec:** `docs/superpowers/specs/2026-10-17-portable-artifacts-design-refresh-design.md`. Visual reference: the three specimen sheets in `.scratch/specimens/{A-print-editorial,B-technical-poster,C-soft-modern}/index.html` (gitignored; copy tokens and CSS from them, do not re-derive).

## Global Constraints

All paths below are relative to `plugins/portable-artifacts/` unless they start with `docs/`, `tests/` or `scripts/`.

- Edit `shared/` only, then run `node bin/sync-shared.mjs` from `plugins/portable-artifacts`. CI runs `node bin/sync-shared.mjs --check`. Never edit `skills/*/shared/`.
- No npm dependencies in skills. Shared tests run with `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` from the repo root (quote the glob).
- Per theme: at most 6 distinct font files and at most 200 KiB of woff2 (`shared/test/theme.test.mjs`). This constrains weights; the specimens used more.
- Every theme defines every token in `TOKENS` (`shared/theme.mjs`) in both `light` and `dark`, as `#rrggbb`, including the six `kind*` hues and `glow`.
- `checkTheme` (`shared/contrast.mjs`) must return no errors for each theme: text/text2/text3 at 4.5:1 on page and surface; accent/warn/good/bad at 3:1 on surface; kind hues 4.5:1 on surface and on their 10% tint and 3:1 on page; `seq1..seq7` strictly stronger against surface and `seq7` at 3:1.
- All fonts SIL OFL 1.1, latin woff2, with licence text in `shared/fonts/LICENSES/` and a row in `shared/fonts/SOURCES.md`. Do not use Inter, Geist, Space Grotesk, Instrument Serif, Fraunces, Playfair or Roboto in the new themes.
- Output stays offline and deterministic: same spec gives same HTML (only the provenance date varies; tests pin `SOURCE_DATE_EPOCH=1792000000`). Pages carry the strict CSP; no external `url()`.
- Golden baselines (`skills/make-explainer/test/golden/`) change only on purpose: regenerate with `UPDATE_GOLDEN=1 node --test test/golden.test.mjs` after reading the diff, and say why in the commit.
- Respect `prefers-reduced-motion`; no horizontal scroll at phone width; headless Chrome minimum window is 500px, so check narrower widths with an iframe.
- Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`), one logical change each, ending with the attribution lines from the session reminder. Do not push, open a PR or merge: the orchestrator does that.
- After any change under `shared/` or a skill, run `bats tests/bats` from the repo root only if `setup/` changed (it should not).

## Review Focus

1. A theme passes the contrast gate in the JSON but the template hard-codes a colour that fails it (for example white text on the `poster` lime fill). Expect: the build's page uses only tokens; the screenshot check in Task 9 catches any literal.
2. Prompt with no signal for theme choice, or one that names a theme that does not exist. Expect: unknown name errors with the list of themes (existing `ThemeError`); no signal gives `dusk`.
3. A spec with emoji in a title, list item, table cell and code span. Expect: build succeeds; density warning only when the ratio threshold is crossed; no error.
4. `--theme poster` on a long recap (thousands of words, 8-word title budget exceeded). Expect: still builds; heading budget warnings still fire; layout does not overflow at 500px.
5. A diagram or dashboard built with a new theme name (`--theme dusk`). Expect: builds and is legible; the `kind*` hues work; the old defaults are unchanged without the flag.

---

### Task 1: Font assets for the three themes

**Files:**
- Create: `shared/fonts/<family>-latin-<weight>-normal.woff2` for each file listed below; `shared/fonts/LICENSES/<Family>-OFL.txt` for each new family
- Modify: `shared/fonts/SOURCES.md`
- Create: `bin/font-metrics.py` (one-off generator; documents the sanctioned invocation in its header)
- Modify: `shared/fonts/metrics.json`
- Test: `shared/test/text.test.mjs`, `shared/test/theme.test.mjs`

**Interfaces:**
- Produces: the files named in the font table below, and `metrics.json` keys `"<Family>|<weight>"` in the existing shape (`unitsPerEm`, `ascender`, `descender`, `lineGap`, `fallback`, `advance` keyed by codepoint) for every body and mono face. `measure()` in `shared/text.mjs` must work for them.

Font plan (per theme: at most 6 files; display weight used for headings, body 400 and 700, mono 400):

| Theme | display | body | mono |
|---|---|---|---|
| dusk | Funnel Display 700 | Host Grotesk 400, 700 | Commit Mono 400 |
| press | Young Serif 400 | Schibsted Grotesk 400, 700 | JetBrains Mono 400 |
| poster | Big Shoulders Display 900 | Familjen Grotesk 400, 700 | Martian Mono 400 |

Decision: Unbounded is dropped. The theme loader has exactly three font roles and the budget is tight, so `dusk` uses Funnel Display 700 for headings and numerals (4 files).

- [ ] **Step 1: Write the failing test.** In `shared/test/text.test.mjs` add `test('every shipped theme's body and mono faces have metrics')`: for each `listThemes()` name, `loadTheme`, and for `body` and `mono` roles and every weight, assert `measure('Hello', { family, weight, size: 14 })` is a positive finite number. Fails now only after Task 2 adds themes; for this task add the assertion for the six new families directly: `Host Grotesk|400`, `Host Grotesk|700`, `Schibsted Grotesk|400`, `Schibsted Grotesk|700`, `Familjen Grotesk|400`, `Familjen Grotesk|700`, `Commit Mono|400`, `JetBrains Mono|400`, `Martian Mono|400` exist as keys in `METRICS`.
- [ ] **Step 2: Run it to see it fail.** `node --test shared/test/text.test.mjs` from `plugins/portable-artifacts`. Expected: FAIL naming a missing key.
- [ ] **Step 3: Fetch the fonts.** In a throwaway directory under the session scratchpad, `npm pack` each `@fontsource/<name>` (pin the version, record it in `SOURCES.md`) and copy only the latin woff2 files in the table into `shared/fonts/`, plus each package's licence into `LICENSES/`. Append rows to `SOURCES.md` in the existing table format.
- [ ] **Step 4: Generate metrics.** Implement `bin/font-metrics.py`: `python3 bin/font-metrics.py <woff2>... --merge shared/fonts/metrics.json`, reading each file with fontTools and writing the same JSON shape as the existing entries (copy an existing entry's field names exactly; `advance` covers codepoints 32-126 plus Latin-1 and common punctuation the existing entries cover). Run it inside a venv under the scratchpad (`python3 -m venv <scratch>/v && <scratch>/v/bin/pip install fonttools brotli`); do not install into the system Python. The script is not run in CI.
- [ ] **Step 5: Run tests.** `node --test shared/test/text.test.mjs shared/test/theme.test.mjs`. Expected: PASS (theme tests still list four themes at this point).
- [ ] **Step 6: Commit** `feat(portable-artifacts): bundle fonts and metrics for dusk, press, poster themes`.

### Task 2: The three theme JSON files

**Files:**
- Create: `shared/themes/dusk.json`, `shared/themes/press.json`, `shared/themes/poster.json`
- Modify: `shared/test/theme.test.mjs`, `shared/test/contrast.test.mjs` (add the new names to whatever list it iterates), 
- Test: `shared/test/theme.test.mjs`, `shared/test/contrast.test.mjs`

**Interfaces:**
- Consumes: Task 1 font files; `TOKENS`, `loadTheme`, `checkTheme`.
- Produces: `listThemes()` returns `['blueprint','dusk','editorial','ink','paper','poster','press']`. Each theme has `name`, `label`, `fonts.{display,body,mono}` (`family`, `fallback`, `weights` mapping weight to filename), `light` and `dark` token maps.

Palette sources: copy hex values from the specimen `:root` blocks (C for `dusk`, A for `press`, B for `poster`), then adjust until `checkTheme` is clean. Known adjustments from the specimens: `press` light vermilion `#c8321a` is 4.0:1 on surface, which passes the 3:1 UI gate and is display-only; `poster` light lime fails as text, so `accent` in light is a darker olive and lime exists only in `glow`/fills; `dusk` light coral and mint as accent/good use `#c2371d` and `#0b7560`. Define `kind*` hues, `glow`, `cat1..8` and `seq1..7` for each theme (the specimens' categorical and sequential ramps are the starting point).

- [ ] **Step 1: Write the failing tests.** In `theme.test.mjs`: `listThemes()` deep-equals the seven names above; `loadTheme('dusk').fonts.display.family === 'Funnel Display'`, `press` is `'Young Serif'`, `poster` is `'Big Shoulders Display'`. In `contrast.test.mjs` assert `checkTheme(loadTheme(name))` equals `[]` for the three new names (read the existing test for how errors are printed; follow it).
- [ ] **Step 2: Run to see failure.** `node --test shared/test/theme.test.mjs shared/test/contrast.test.mjs`. Expected: FAIL (unknown theme).
- [ ] **Step 3: Author the three JSON files.** Iterate on hex values until `checkTheme` returns `[]`. The font-budget test (6 files, 200 KiB) must also pass; if a theme exceeds 200 KiB drop the heaviest weight, never subset-skip.
- [ ] **Step 4: Run all shared tests.** `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` from the repo root. Expected: PASS. Also update the title of the existing test in `theme.test.mjs` ("four candidate themes ship") to match.
- [ ] **Step 5: Sync and commit.** `node bin/sync-shared.mjs`, then commit `feat(portable-artifacts): add dusk, press and poster themes`.

### Task 3: Per-skill default themes and the font allowlist

**Files:**
- Create: `skills/make-explainer/scripts/lib/default-theme.mjs`, `skills/make-motion/scripts/lib/default-theme.mjs` (each exports one constant)
- Modify: `skills/make-explainer/scripts/lib/page.mjs:233`, `skills/make-explainer/scripts/lib/checks.mjs:113`, `skills/make-motion/scripts/lib/server.mjs:94-95`, `bin/test/style-lint.test.mjs` (the `BASE_BUNDLED` and `MOTION_BUNDLED` lists)
- Test: `skills/make-explainer/test/page.test.mjs`, `skills/make-motion/test/theme-render.test.mjs`, `bin/test/style-lint.test.mjs`

**Interfaces:**
- Produces: `EXPLAINER_THEME = 'dusk'` exported from the explainer file and `MOTION_THEME = 'dusk'` from the motion file. The shared `DEFAULT_THEME` stays `'paper'` (dashboard) and `DIAGRAM_THEME` stays `'blueprint'`.

- [ ] **Step 1: Write failing tests.** Explainer: building the `concept` example with no `--theme` and no `spec.theme` yields HTML containing `data-theme-name="dusk"` if such an attribute exists, otherwise containing the `"Funnel Display"` font-face; with `--theme press` it contains `"Young Serif"`. Motion: `themeOrDefault(undefined)` returns the `dusk` theme data. Style-lint: `allowedFamily('make-explainer')` accepts `'Funnel Display'`, `'Host Grotesk'`, `'Commit Mono'`, `'Young Serif'`, `'Schibsted Grotesk'`, `'JetBrains Mono'`, `'Big Shoulders Display'`, `'Familjen Grotesk'`, `'Martian Mono'`.
- [ ] **Step 2: Run to see failure.** `node --test skills/make-explainer/test/page.test.mjs skills/make-motion/test/theme-render.test.mjs bin/test/style-lint.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the two constants, use them in the three call sites in place of `DEFAULT_THEME`, extend the two font lists in `style-lint.test.mjs`. Keep `Inter` and `JetBrains Mono` allowed for make-motion only while the old look still exists in `styles.css`; Task 8 removes them.
- [ ] **Step 4: Run** the three test files again. Expected: PASS. Run `node --test skills/make-explainer/test/golden.test.mjs`; it will fail because the font changed. Regenerate with `UPDATE_GOLDEN=1` and inspect the diff: only font-face and theme-token markup may move.
- [ ] **Step 5: Commit** `feat(make-explainer, make-motion): default to the dusk theme`.

### Task 4: Procedural art generator

**Files:**
- Create: `shared/art.mjs`, `shared/test/art.test.mjs`
- Modify: `shared/README.md` (one line listing it)

**Interfaces:**
- Produces: `export function artSvg({ theme: string, seed: string, width: number, height: number, mode?: 'light'|'dark' }): string` returning a standalone `<svg>` string with no external references, no script and no `<foreignObject>`; and `export function seedFrom(text: string): number` (a stable 32-bit hash used for the PRNG). Per theme style: `dusk` grainy blobs and duotone orbs and wave bands; `press` halftone dots and contour lines in multiply-blended overprint; `poster` halftone gradient, grid-warp and registration marks. All colours come from the theme tokens (`loadTheme(theme)[mode]`), not literals. Port the generators from the three specimen sheets' inline scripts.

- [ ] **Step 1: Write failing tests.** (a) `artSvg` with the same arguments twice returns identical strings; a different seed returns a different string. (b) The result starts with `<svg`, contains `viewBox`, and has no `http`, `<script`, `<foreignObject` or `url(http`. (c) For each of the three theme names it returns an SVG under 60 KB for 1280x720. (d) Unknown theme throws `ThemeError`. (e) `seedFrom('a') !== seedFrom('b')` and is a non-negative integer.
- [ ] **Step 2: Run to see failure.** `node --test shared/test/art.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with a small seeded PRNG (mulberry32 over `seedFrom`) and string-built SVG; no dependencies. Grain uses an SVG `feTurbulence` filter; keep filter use to one per SVG.
- [ ] **Step 4: Run** `node --test shared/test/art.test.mjs`. Expected: PASS. Render one SVG per theme to the scratchpad with a one-off node call, screenshot with headless Chrome and view each; adjust until they resemble the specimens.
- [ ] **Step 5: Sync and commit** `feat(portable-artifacts): seeded procedural art generator`.

### Task 5: Emoji lint becomes a density warning

**Files:**
- Modify: `skills/make-explainer/scripts/lib/lint.mjs:19-31,92-98`, `skills/make-explainer/scripts/lib/budget.mjs` (add the warning), `skills/make-explainer/references/style.md` (the "Other lint rules" paragraph)
- Test: `skills/make-explainer/test/lint.test.mjs`, `skills/make-explainer/test/budget.test.mjs`

**Interfaces:**
- Consumes: the existing `EMOJI` regex, which is kept and exported.
- Produces: `lintEmoji` no longer returns an error. A new exported `emojiDensityWarnings(spec): Array<{ path, message }>` in `budget.mjs`, where a warning is emitted when emoji make up more than 1 in 40 characters of a section's prose or more than 3 emoji appear in one title. Warnings never fail validate (exit 0).

- [ ] **Step 1: Write failing tests.** `lint.test.mjs`: replace the emoji-rejected cases with a case that a title `'Launch 🚀 day'` yields no lint errors. `budget.test.mjs`: a section whose text has 5 emoji in 100 characters gives one warning whose message contains `emoji`; one emoji in 200 characters gives none; a title with 4 emoji warns.
- [ ] **Step 2: Run to see failure.** `node --test skills/make-explainer/test/lint.test.mjs skills/make-explainer/test/budget.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire the warning into validate's warnings output where budget warnings are collected (`scripts/validate.mjs` or `lib/spec.mjs`; follow where `budget.mjs` is already called). Update `style.md`: remove emoji from the rejected list and describe the warning thresholds. Check `skills/make-explainer/SKILL.md` Writing-rules text that says validate rejects emoji and fix it.
- [ ] **Step 4: Run** the two test files plus `skills/make-explainer/test/validate-cli.test.mjs` and `bin/test/style-lint.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-explainer): allow emoji, warn on density`.

### Task 6: Explainer page redesign

**Files:**
- Modify: `skills/make-explainer/template/base.css`, `skills/make-explainer/template/page.html`, `shared/type.mjs` (type and spacing scale tokens), `skills/make-explainer/scripts/lib/page.mjs` (hero art slot, footer theme record), `skills/make-explainer/scripts/lib/render/{tldr,kpis,cards,timeline,files,risks,callout,steps,compare}.mjs` only where markup must change for the new layout (large marginal numerals, tilted TL;DR card, hairlines)
- Test: `skills/make-explainer/test/page.test.mjs`, `skills/make-explainer/test/golden.test.mjs`, `skills/make-explainer/test/final-*.test.mjs`

**Interfaces:**
- Consumes: Task 2 themes, Task 4 `artSvg`, `themeCss`.
- Produces: `shared/type.mjs` `TYPE_TOKENS` gains a spacing scale `--sp-1` through `--sp-9` and fluid display sizes (`--fs-display`, `--fs-numeral`); the page hero embeds `artSvg({ theme, seed: spec.title, width: 1280, height: 720, mode })` inline in a `.hero-art` element with `aria-hidden="true"`; the footer states `Theme: <name>`. Existing CSS variable names in `VARS` stay.

Design rules to carry from the specimens: structure from type and rules, not card grids; asymmetric hero; large display type with tight tracking; per-theme grain via a CSS `::before` using an inline SVG data-URI noise; `[data-theme]` light/dark hand-tuned through tokens only; drop caps and marginal numerals only under `press`; condensed uppercase headings only under `poster` (selected by a `data-flavor` attribute on `<html>` set from the theme name, since themes differ in CSS beyond tokens). Add `flavor` handling in `page.mjs`.

- [ ] **Step 1: Write failing tests.** In `page.test.mjs`: built HTML for the `concept` example contains exactly one `.hero-art` with `<svg`; contains `data-flavor="dusk"` by default and `data-flavor="press"` with `--theme press`; contains no `url(http`; the CSS contains `--sp-1` and `--fs-numeral`.
- [ ] **Step 2: Run to see failure.** `node --test skills/make-explainer/test/page.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the template, CSS and renderer changes. Work in this order so each is checkable: tokens in `shared/type.mjs` (then sync), hero and art slot, section chrome and numerals, KPI and timeline and file lists, checklist and code, footer. Keep every existing class name that `runtime.js` or tests select on.
- [ ] **Step 4: Visual check.** Build the four preset examples under each of the three themes to the scratchpad. Screenshot each at 1280 and at 500 wide (light and dark via `?theme=` or `data-theme`), view them, and fix problems (overflow, clipped text, unreadable contrast). Check phone width below 500 with an iframe at 375. Record findings in the commit body.
- [ ] **Step 5: Run the full explainer suite** `node --test "skills/make-explainer/test/*.test.mjs"` from `plugins/portable-artifacts`. Regenerate goldens with `UPDATE_GOLDEN=1` after reading each diff. Expected: PASS. If `check.mjs` is available (Playwright installed) run `node skills/make-explainer/scripts/check.mjs <built page>` for each theme; otherwise note it skipped.
- [ ] **Step 6: Sync and commit** `feat(make-explainer): redesign the explainer page on the new themes`.

### Task 7: Deck redesign

**Files:**
- Modify: `skills/make-explainer/template/slides.html`, `skills/make-explainer/template/slides.js` (only if navigation markup changes), `skills/make-explainer/scripts/lib/slides.mjs`
- Test: `skills/make-explainer/test/slides.test.mjs`, `skills/make-explainer/test/slides-browser.test.mjs`, `skills/make-explainer/test/golden.test.mjs`

**Interfaces:**
- Consumes: Task 4 `artSvg`, Task 6 tokens and flavor.
- Produces: each slide renders in a 16:9 stage; slide kinds in the existing `slides` preset keep their JSON shape; the title slide and the closing slide get a full-bleed `.slide-art` from `artSvg({ theme, seed: <title>+<slide index>, width: 1920, height: 1080, mode })`; per-flavor layouts: `dusk` large rounded art with tilted accent card, `press` ruled columns with a pull-quote style, `poster` condensed oversized numerals and registration marks. Emoji render in a bundled-safe emoji stack and are never required.

- [ ] **Step 1: Write failing tests.** In `slides.test.mjs`: the built `slides` example has `.slide-art` on the first and last slides only; contains `data-flavor`; slide count, outline entries (`O` key) and section ids are unchanged versus the golden; no inline element exceeds the slide caps validate enforces (6 points, 8 rows, 12 code lines, 80 words).
- [ ] **Step 2: Run to see failure.** `node --test skills/make-explainer/test/slides.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the template and renderer changes.
- [ ] **Step 4: Visual check** like Task 6, for each theme, light and dark: every slide of the `slides` example screenshotted and viewed at 1280x720; also step through with the keyboard in a headless run (`slides-browser.test.mjs` already drives this) and confirm the last slide is reachable.
- [ ] **Step 5: Run** `node --test "skills/make-explainer/test/*.test.mjs"`; regenerate goldens after reading diffs. Expected: PASS.
- [ ] **Step 6: Sync and commit** `feat(make-explainer): redesign the deck with full-bleed art slides`.

### Task 8: make-motion on the new system

**Files:**
- Modify: `skills/make-motion/template/styles.css`, `skills/make-motion/template/renderer.mjs`, `skills/make-motion/template/preview-ui.mjs`, `skills/make-motion/template/defaults.mjs`, `skills/make-motion/scripts/lib/theme.mjs` (load the display font and expose `--font-display`), `skills/make-motion/scripts/lib/server.mjs` (serve the display font file), `skills/make-motion/references/schema.md`, `bin/test/style-lint.test.mjs` (drop `Inter` and `JetBrains Mono` from `MOTION_BUNDLED` only if nothing references them any more)
- Test: `skills/make-motion/test/theme-render.test.mjs`, `skills/make-motion/test/server.test.mjs`, `skills/make-motion/test/render-smoke.test.mjs`

**Interfaces:**
- Consumes: Task 2 themes, Task 3 `MOTION_THEME`, Task 4 `artSvg`.
- Produces: `themeCss(theme)` in `skills/make-motion/scripts/lib/theme.mjs` emits `--sans`, `--mono` and a new `--display` variable, with `@font-face` for the display role served from `/theme/fonts/`; a scene `background` of `"art"` renders `artSvg` seeded from the scene id; per-theme kinetic-type presets named in `defaults.mjs` as `TYPE_PRESETS = { dusk: 'rise', press: 'ink-in', poster: 'slam' }` applied to a `title` element when the spec sets no explicit `enter`. Existing spec fields and example specs stay valid.

- [ ] **Step 1: Write failing tests.** `theme-render.test.mjs`: with no `spec.theme` the page CSS includes `"Funnel Display"` and a `--display` variable; with `theme: "poster"` it includes `"Big Shoulders Display"`; unknown theme still falls back to the default. `server.test.mjs`: `GET /theme/fonts/<display file>` returns 200 `font/woff2`. `defaults` test: `TYPE_PRESETS` has the three keys.
- [ ] **Step 2: Run to see failure.** `node --test skills/make-motion/test/theme-render.test.mjs skills/make-motion/test/server.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the preview UI to the same tokens (scrubber, controls) without changing control behaviour (`preview-controller.test.mjs` must stay green).
- [ ] **Step 4: Verify motion visually.** Run the preview for each example spec under each theme, capture a frame at 0%, 50% and 100% of a title scene with headless Chrome by seeking the timeline (use the existing `?t=` or renderer seek used by `render-smoke.test.mjs`; read that test first) and view the frames. If ffmpeg is available, render a 1080p MP4 for one spec per theme and extract three frames with `ffmpeg -ss`; otherwise record that render was not run.
- [ ] **Step 5: Run** `node --test "skills/make-motion/test/*.test.mjs"` and `node --test bin/test/style-lint.test.mjs`. Expected: PASS (ffmpeg-gated tests may skip; say so).
- [ ] **Step 6: Sync and commit** `feat(make-motion): render on the new themes with per-theme type presets`.

### Task 9: Theme selection guidance and the optional image hook

**Files:**
- Modify: `skills/make-explainer/SKILL.md`, `skills/make-motion/SKILL.md`, `skills/make-explainer/scripts/build.mjs` and `skills/make-explainer/scripts/lib/spec.mjs` (the `--image-api` flag), `skills/make-explainer/references/schema.md`
- Create: `skills/make-explainer/scripts/lib/image-hook.mjs`, `bin/test/theme-guidance.test.mjs`
- Test: `bin/test/theme-guidance.test.mjs`, `skills/make-explainer/test/hardening.test.mjs`

**Interfaces:**
- Produces: a "Choosing a theme" section in both SKILL.md files containing the four rules from the spec (explicit wins; infer and say why in one line; ask once if genuinely split, listing the three with a one-line feel each; fall back to `dusk` if it cannot ask), naming only themes that exist. `image-hook.mjs` exports `async function fetchHeroImage({ prompt, endpoint, key }): Promise<{ bytes: Buffer, mime: string }>`; it is used only when `build.mjs` is run with `--image-api <endpoint>` and the environment variable `PA_IMAGE_API_KEY` is set. It rejects a non-https endpoint, refuses to run without the key (error names the variable), and the build prints one line saying the prompt was sent off the machine. Returned bytes pass through the existing image safety check in `lib/image.mjs` before inlining. Without the flag nothing touches the network.

- [ ] **Step 1: Write failing tests.** `theme-guidance.test.mjs`: both SKILL.md files contain the heading `Choosing a theme`, and every backticked theme name in that section is in `listThemes()`; the section names `dusk` as the fallback. `hardening.test.mjs` (or a new file next to it): `build.mjs` with `--image-api http://x` exits 2 with a message about https; with `--image-api https://x` and no `PA_IMAGE_API_KEY` exits 2 naming `PA_IMAGE_API_KEY`; and a default build makes no network call (existing offline assertion stays green).
- [ ] **Step 2: Run to see failure.** `node --test bin/test/theme-guidance.test.mjs skills/make-explainer/test/hardening.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the SKILL.md sections, the flag and the hook. Document in `schema.md` and the README that the flag sends the prompt off the machine and needs the user's own key and may cost money.
- [ ] **Step 4: Run** the two test files and `node --test bin/test/*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-explainer, make-motion): theme selection guidance and optional image hook`.

### Task 10: Docs, showcase and counts

**Files:**
- Modify: `README.md`, `USAGE.md`, `skills/make-explainer/README.md`, `skills/make-motion/README.md`, the portable-artifacts site page under `docs/features/` and its images under `docs/features/img/portable-artifacts/`, `shared/README.md` if not done
- Test: `tests/pytest/test_sweep_counts.py`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Update the README "Easy to read" bullet (it names Geist) and the themes section to describe `dusk`, `press`, `poster`, how a theme is chosen, emoji allowed with a density warning, and the optional image API with its data-leaves-the-machine warning. Fix any other statement the new behaviour makes false (grep `Geist`, `emoji`, `editorial`, `four themes` across `plugins/portable-artifacts` and `docs/`).
- [ ] **Step 2:** Regenerate the showcase: build an explainer, a deck and a motion clip in `dusk` from the existing example prompts, then replace the images the page references (keep file names; follow the per-line copy-button contract in `CLAUDE.md` for any command shown on the site: one button per command, no `# comment` in `data-copy`).
- [ ] **Step 3:** Run `python3 scripts/sweep_counts.py --check` and `pytest tests/pytest/test_sweep_counts.py` from the repo root. Expected: PASS (no skill was added or removed, so counts should not change).
- [ ] **Step 4: Commit** `docs: describe the new themes and theme selection`.

### Task 11: Whole-branch verification

**Files:** none (read-only)

- [ ] **Step 1:** From the repo root run, one per command and unpiped: `node plugins/portable-artifacts/bin/sync-shared.mjs --check` (from `plugins/portable-artifacts`), `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`, then from `plugins/portable-artifacts` each of `node --test "skills/make-explainer/test/*.test.mjs"`, `node --test "skills/make-motion/test/*.test.mjs"`, `node --test "skills/make-dashboard/test/*.test.mjs"`, `node --test "skills/make-diagram/test/*.test.mjs"`, `node --test "bin/test/*.test.mjs"`, then `pytest tests/pytest` and `bats tests/bats` from the root. Expected: all PASS; dashboard and diagram suites must be green and unchanged. Report any skipped (browser, ffmpeg) tests by name.
- [ ] **Step 2:** Run `claude plugin validate` equivalent used by CI if present (see `.github/workflows/test.yml`; use exactly its manifest-validation command) and `shellcheck` on any shell touched (expected none).
- [ ] **Step 3:** Dispatch one fresh code reviewer on `git diff main...HEAD` with the report-everything sentence from the repo's review rules; apply the gate (CRITICAL and HIGH block).
- [ ] **Step 4:** Generate the interactive manual-test checklist (`.scratch/portable-artifacts-design-refresh-test-checklist.html`) covering what automated checks cannot: motion playing in a real browser, MP4 playback, phone-size layouts, theme feel in light and dark, the image hook against a real endpoint if the user supplies one.
- [ ] **Step 5:** Stop and hand the branch to the user for push and PR approval; do not merge.
