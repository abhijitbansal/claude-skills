# make-explainer — Design (SP3 of the visual-artifacts program)

*2026-10-12 · branch `feat/visual-artifacts` · status: spec (user pre-approved building without a review stop)*

Program decisions D1–D8 and the shared core: `2026-10-12-make-dashboard-v2-design.md`.
Diagram embedding API: `2026-10-12-make-diagram-design.md`.

## User decisions (2026-10-12)

- Our own replacement for visual-explainer (no dependency on it), producing the kind of artifacts the user already builds: branch explainers/recaps, interactive test checklists, concept/plan explainers, slide decks.
- Presets in v1: **branch recap / diff review**, **test checklist**, **concept / plan explainer**, **slides deck**.
- Embeds make-diagram figures, make-dashboard charts and make-motion videos when asked; the installer may install those sibling skills as dependencies (`npx skills add` must still work: missing siblings fail with the exact install command).
- Default output: **`~/.agent/diagrams/<slug>.html`** (`--out` / `PA_OUTPUT_DIR` override).
- Cheap model (Haiku, `effort: low`) after the eval passes. Paid evals approved.
- After evals pass: add design-router rows; uninstall the visual-explainer plugin; remove archify.

## Goal

The model fills one JSON document of typed sections (often starting from a script-generated scaffold that already contains the facts), and scripts validate, lint the prose for slop, and render one offline, themed, accessible HTML page or slide deck. No HTML, CSS or SVG is ever written by the model.

## Non-goals

- Free-form HTML/SVG sections, Mermaid, CDN fonts or libraries (visual-explainer's default path).
- PPTX export (browsers print slides to PDF via the print stylesheet).
- Editing or fact-checking existing HTML pages.
- Interactive charts inline (v1 renders charts as static SVG; `interactive: true` builds the full dashboard next to the page and links it).

## Spec contract (`explainer.json`)

```json
{
  "title": "feat/visual-artifacts: dashboards, diagrams and explainers",
  "subtitle": "What shipped, how it works, how to test it",
  "preset": "recap",
  "mode": "page",
  "theme": "paper",
  "meta": { "date": "2026-10-12", "branch": "feat/visual-artifacts", "author": "…" },
  "sections": [
    { "type": "tldr", "title": "Verdict", "text": "Three skills, one shared core; ready for review.", "points": ["…"] },
    { "type": "kpis", "items": [ { "label": "Commits", "value": "42" }, { "label": "Tests", "value": "612 pass" } ] },
    { "type": "diagram", "title": "How the pieces connect", "diagram": "arch.diagram.json", "caption": "…" },
    { "type": "files", "title": "Files changed", "items": [ { "path": "shared/theme.mjs", "change": "added", "note": "theme tokens → CSS" } ] },
    { "type": "checklist", "title": "Manual tests", "key": "feat-visual-artifacts", "groups": [ { "title": "Install", "items": [ { "text": "npx skills add … works", "tag": "device" } ] } ] }
  ]
}
```

Top level: `title` (≤ 90), `subtitle` (≤ 140), `preset` (`recap`\|`checklist`\|`concept`\|`slides`\|`none`, default `none`), `mode` (`page`\|`slides`; `slides` preset implies slides), `theme`, `meta` (string values ≤ 60 each; keys `date`, `branch`, `repo`, `author`, `version`, `status`), `sections` (1–40).

Section types (every section: optional `id` `^[a-z][a-z0-9-]*$`, optional `title` ≤ 90 — a claim, not a label):

| type | fields | renders as |
|---|---|---|
| `tldr` | `text` (≤ 400), `points[]` (≤ 6, ≤ 160 each), `tone` | verdict block at the top, first viewport |
| `text` | `text` (markdown-lite, ≤ 4000) | paragraphs; **bold**, *italic*, `code`, `[link](https://…)`, `- ` lists |
| `kpis` | `items[]` (1–6): `label`, `value`, `delta`?, `tone`?, `note`? | stat band |
| `cards` | `items[]` (1–12): `title`, `text`, `icon`? (make-diagram catalog ref), `tone`?, `tag`? ; `columns` 2–4 | card grid |
| `table` | `columns[]` (≤ 8), `rows[][]` (≤ 60 rows; cells strings/numbers), `caption`?, `align`? | table, sticky header, numeric right-aligned |
| `risks` | `items[]`: `risk`, `severity` (`low`\|`medium`\|`high`\|`critical`), `mitigation`, `owner`? | severity table (shape + label, never colour alone) |
| `files` | `items[]` (≤ 200): `path`, `change` (`added`\|`modified`\|`deleted`\|`renamed`), `note`?, `add`?, `del`? | collapsible file tree grouped by folder |
| `steps` | `items[]`: `title`, `text`?, `status`? (`done`\|`doing`\|`todo`) | numbered steps |
| `timeline` | `items[]`: `date`, `title`, `text`? | vertical timeline |
| `compare` | `columns[]` (2–3): `title`, `points[]`, `tone`? ; `verdict`? | side-by-side comparison |
| `callout` | `tone` (`info`\|`warn`\|`good`\|`bad`), `title`, `text` | callout box with icon + label |
| `code` | `code` (≤ 120 lines), `language`?, `caption`? | code block with copy button |
| `details` | `summary`, `text` (markdown-lite) | `<details>` |
| `checklist` | `key` (localStorage namespace), `groups[]`: `title`, `items[]`: `text`, `tag`? (`regression`\|`device`\|`manual`\|`visual`), `note`? ; `intro`?, `onFail`? | checkboxes saved in `localStorage`, sticky progress bar, per-group tallies, reset button, "If something fails" footer |
| `diagram` | `diagram` (inline make-diagram spec object, or a path to `*.diagram.json`), `caption`? | inline SVG figure with hover tracing + "Present" (full-screen overlay using make-diagram's runtime) |
| `chart` | either `dashboard` (path to `dashboard.json`) + `chart` (chart id), or inline `data[]` (≤ 500 rows) + `kind`/`x`/`y`/`color`/`format` (make-dashboard kinds) ; `caption`? ; `interactive`? | static SVG rendered with Vega in Node; `interactive: true` also builds the dashboard next to the page and links it |
| `motion` | `video` (path to `.mp4`) and/or `spec` (path to `motion.json`, rendered with make-motion if no video given), `poster`?, `caption`? | `<video controls>`; the MP4 (and poster) are copied into `<slug>.assets/` next to the page |
| `image` | `src` (local png/jpg/webp/svg ≤ 1.5 MB), `alt` (required), `caption`? | inline `data:` image |

Slides mode: each section is one slide (a `title` becomes the slide heading). Content budget per slide (lint errors): ≤ 6 points/bullets, ≤ 8 table rows, ≤ 12 code lines, ≤ 80 words of text; a section over budget must be split.

## Pipeline

```
gather.mjs (optional) --> facts.json --scaffold.mjs--> explainer.json (TODO markers)
explainer.json --validate.mjs--> schema + refs + files exist + text lint + slide budget + TODO markers
               --build.mjs-----> sections -> HTML (+ diagram via make-diagram API, chart via make-dashboard
                                 views + vega toSVG, motion assets copied) -> theme CSS + fonts + runtime
                                 -> <out>/<slug>.html (+ <slug>.assets/)
               --check.mjs-----> optional headless check (overflow at 1280/390, console errors, slides navigate)
                                 (built: scripts/check.mjs <page.html> [--json]; skips cleanly without a browser)
```

- **Evidence scripts (cheap-model affordance).** `scripts/gather.mjs git [--base main] [--repo .]` prints JSON facts:
  - branch, base, commit list (sha, subject)
  - files changed with change type and +/− counts
  - test-file list, date
  
  `scripts/scaffold.mjs <preset> [--facts facts.json]` prints a starter `explainer.json`.
  - **recap:** `kpis` from the facts, `files` filled from the diff, `timeline` from commits, and `tldr`/`text`/`risks` with `"TODO: …"` text.
  - **checklist:** a group per area of changed files, with TODO items.
  - **concept** and **slides:** the section skeleton only.
  
  `validate` fails while any `TODO:` string remains, so the model must replace every placeholder.
- **Text lint (deterministic anti-slop, errors with path + suggestion):**
  - Emoji / Extended_Pictographic characters anywhere.
  - A banned phrase list with replacements in `references/style.md` ("delve", "elevate", "seamless", "unleash", "game-changer", "revolutionize", "cutting-edge", "in today's fast-paced", "robust and scalable", "leverage" → "use", "utilize" → "use", "a testament to", …).
  - Headings ending in `!`.
  - `01/02/03` numbering in titles of unordered sections.
  - Placeholder text (`TODO:`, `lorem ipsum`).
  - Paragraphs > 120 words, which are a warning.
- **Sibling skills:** `scripts/lib/siblings.mjs` resolves `make-diagram`, `make-dashboard` and `make-motion` as directories next to `make-explainer` (all install paths place skills side by side). It loads them lazily, only when a section needs one. `validate` calls make-diagram's `validateSpec` (re-exported from `api.mjs`) on each embedded diagram, and make-dashboard's and make-motion's own validators for charts and motion specs. A missing sibling gives the error: `make-diagram skill not found next to make-explainer (looked in <dir>); install it with: npx skills add abhijitbansal/claude-skills --skill make-explainer make-diagram`.
- **Installer:** `bin/install.mjs` reads `"portableArtifacts": { "requires": [...] }` from each skill's `package.json` and installs required skills too (deduplicated, before the dependent). make-explainer requires `make-diagram` and `make-dashboard`. make-motion is optional (motion sections with an existing MP4 do not need it).
- **Page (single file):**
  - CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src 'self' file: blob:` (the `media-src` part is added only when a motion section exists).
  - Theme CSS + embedded fonts (shared), with the pre-paint theme script and the "Theme:" toggle.
  - Meta band (title, subtitle, meta chips). TL;DR first, then sections in order.
  - Sticky TOC from 4 sections up (desktop), collapsed on mobile.
  - Body measure 68ch; figures and tables wider.
  - Print stylesheet.
  - Rise-in on first view only, disabled under reduced motion.
  - Heading ids for deep links.
- **Slides:**
  - `100dvh` scroll-snap slides.
  - Keyboard: ←/→, Space, PgUp/PgDn, Home/End.
  - `O` toggles an outline overlay; `#slide-N` deep links work.
  - A progress bar shows position, and the last position is restored from `localStorage`.
  - Print gives one slide per page.
  - Slide-number footer.
- **Runtime:**
  - **TOC:** the active section is highlighted.
  - **Code:** copy buttons via the clipboard API.
  - **Checklist:** state is saved in `localStorage` under `pa-checklist:<key>`, and blocked storage is tolerated. The page shows a sticky progress bar with done/total, per-group tallies, and a reset button that asks for confirmation inline (never `window.confirm`).
  - **Diagrams:** hover tracing, and an overlay presenter using `viewerRuntime()` from make-diagram.
  - **Section registry:** `scripts/lib/sections.mjs` maps each type to `{ render, assets?, prepare?, page?, check? }`. `page(ctx)` returns the css and scripts a type ships once for the whole page (diagram, chart and motion use it), so ten diagrams do not repeat the viewer.
  - **Video:** native controls; the video never autoplays.
- **make-motion theming (SP3 scope):** make-motion specs gain an optional `theme` (shared theme name). Text defaults to the theme's body/display fonts and colours instead of Inter, served from make-motion's synced `shared/fonts`. Specs without `theme` render exactly as today (backward compatible; render-smoke unchanged).

## Testing

- **Unit:**
  - Schema, with every error pinned.
  - The markdown-lite renderer: escaping, links limited to `https?:` with `rel="noopener"`, no raw HTML passthrough.
  - Text lint, with each rule shown to fire.
  - Slide budget.
  - TODO markers.
  - Sibling resolution and its missing-sibling message.
  - `gather.mjs` against a temp git repo fixture.
  - `scaffold.mjs` output validating once its TODOs are replaced.
  - Installer `requires`, including dedup and a cycle guard.
  - Golden HTML per preset, normalised.
- **Browser:**
  - Each preset example at 1280 and 390 px: no console errors or warnings, no overflow.
  - TOC.
  - Copy button.
  - Checklist: persistence across reload, reset, progress, blocked storage.
  - Slides: keyboard navigation, deep link, outline, resume.
  - Diagram hover and the presenter overlay.
  - Chart SVG present.
  - Video element with its asset copied.
  - Theme toggle.
  - Screenshots viewed.
- **make-motion:** a themed spec renders (contact sheet) with the theme font and colours; existing tests unchanged.
- **Eval:** `SKILLS.explainer` (spec `explainer.json`, output `out/explainer.html`). There are 8 prompts:
  - recap from a gathered fixture repo
  - checklist
  - concept with a diagram
  - slides
  - chart from an inline CSV
  - edit (with a seed)
  - two mixed prompts
  
  gemma4 runs first, then Haiku and Sonnet. Haiku must reach ≥ 7/8 valid builds. Pin `model: haiku`, `effort: low` only if that passes.

## Cut-over (end of program, after all evals pass)

1. `design-router` (`~/.agents/skills/design-router/SKILL.md`, not in this repo):
   - Add rows routing "explain this / visual recap / branch explainer / test checklist / slides" to `make-explainer`.
   - Add a row routing "architecture/flow/sequence/state diagram" to `make-diagram`.
   - Add a row routing "dashboard from data files" to `make-dashboard`.
   - Remove the visual-explainer and archify mentions.
2. Uninstall the visual-explainer plugin (Claude Code plugin uninstall).
3. Remove `~/.claude/skills/archify` (symlink) and its `~/.agents/skills/archify` source, via the tool that installed it if one exists.
4. Record what was removed and how to restore it in the final report.
