# Portable artifacts: polish, provenance, preflight and portability

**Date:** 2026-10-14
**Branch:** `feat/diagram-stories` (lands on the current branch)
**Plugin:** `plugins/portable-artifacts` (make-dashboard, make-diagram, make-explainer, make-motion)

## Intent

The owner wants every page the four skills produce to look deliberate and be
read, not skimmed past, and to work the same whatever agent generated it.

What the owner asked for:

1. Explainers that are more impactful and polished.
2. Better fonts.
3. Less text — people do not read walls of it.
4. Deliberate formatting, font sizes and underlines.
5. A favicon on every diagram, explainer or other HTML artifact any skill generates.
6. A theme switch that uses icons (day to night) instead of a text label.
7. Each artifact records which model and which effort level generated it.
8. The skills work on other agents (Copilot, Codex, …), not only Claude Code.
9. Skills detect a missing sister skill or tool (e.g. ffmpeg), guide the user,
   and install it for them when the user agrees.

Decisions made during brainstorming:

| Question | Decision |
|---|---|
| Where the model/effort stamp comes from | The agent self-reports; anything it cannot know shows as "not reported". No env fallback, never required. |
| Default type direction | Geist + Geist Mono. Serif display only in the editorial theme. |
| How hard to push on text length | Soft caps: validator warns, exit code stays 0. |
| Which agents to test live | Copilot CLI live; Codex and Gemini static audit only. |
| Sharing approach | Hybrid: shared data/behaviour in `shared/`, each skill's template owns markup and placement. |

Assumptions (confirmed by section approval):

- "Logos" for the theme switch means sun / moon icons.
- "Every HTML artifact" means the dashboard, diagram and explainer pages plus
  the make-motion preview page. MP4 output carries provenance in its metadata.

## Success criteria

- Every HTML page from all four skills has a `rel="icon"`, a
  `<meta name="generator">` and a visible provenance line; every page except
  the dark-only make-motion preview has the icon theme toggle.
- Fonts are Geist / Geist Mono by default; no template names an unbundled font.
- Explainer pages lead with a hero (title, one-line subtitle, TL;DR card) and
  KPIs; the TOC shows short labels; the validator warns on over-long text.
- `doctor.mjs` in each skill reports every missing dependency with a
  per-platform fix, and `--fix` installs the non-sudo ones.
- A portability lint passes on all four SKILL.md files, and one live Copilot
  CLI run per skill builds a page that passes `check.mjs` (results recorded,
  failures included).
- All existing test suites stay green; `bin/sync-shared.mjs --check` passes.

## 1. Shared chrome

### In `shared/` (copied into each skill by `node bin/sync-shared.mjs`)

**`shared/icons.mjs`**

- Theme toggle icons as SVG strings: `SUN`, `MOON`, `AUTO` (half-filled circle).
- One favicon glyph per skill: dashboard = three bars, diagram = three linked
  nodes, explainer = a page with lines, motion = a play triangle.
- `favicon(skill, theme)` returns an `image/svg+xml` data URI drawn in the
  theme accent. The SVG carries an internal `@media (prefers-color-scheme: dark)`
  rule for the dark accent; browsers that ignore it (Safari) show the light one.

**`shared/provenance.mjs`**

- Input: the spec's optional `generatedBy: { model, effort, agent }`, overridden
  field by field by build flags `--model`, `--effort`, `--agent`.
- Validation: each value a string of at most 60 characters from
  `[A-Za-z0-9 ._:/()+-]`; anything else is a validation error naming the field.
  Output is HTML-escaped regardless.
- A missing field renders as "not reported"; it is never guessed.
- `footer(skill, gen, date)` → e.g.
  `make-explainer · Claude Opus 5.5 · high effort · Claude Code · 14 Oct 2026`.
- `meta(skill, gen)` →
  `<meta name="generator" content="portable-artifacts make-explainer; model=…; effort=…; agent=…">`.
- The stamp lives in the spec, so a make-dashboard refresh (no LLM involved)
  keeps the original author; the page's existing refresh time is shown beside it.

**`shared/theme-toggle.mjs`**

- Exports one inline script string. It cycles Auto → Light → Dark using the
  existing `pa-theme` localStorage key (reads and writes wrapped in try/catch),
  sets or clears `data-theme` on `<html>`, swaps the icon, and updates
  `aria-label` ("Theme: Light. Switch to Dark") and `title`.
- The existing pre-paint script that applies a stored theme before first render
  stays in each template.

### In each skill's template (markup and placement)

| Output | Toggle | Provenance |
|---|---|---|
| make-explainer page (`template/page.html`) | header, top right | footer line |
| make-explainer slides (`template/slides.html`) | top-right corner | last slide footer and the print footer |
| make-diagram (`template/viewer.html`) | toolbar; still hidden in fill / full screen | small line under the title |
| make-dashboard (`template/page.html`) | header | footer, beside the refresh time |
| make-motion preview (`template/index.html`) | none — the preview is a dark-only local tool and the video follows the spec theme (owner decision, 2026-10-14) | footer; the MP4 gets `-metadata comment=<footer>` and `-metadata artist=<model>` |

### SKILL.md

Each skill tells the agent to set `generatedBy` with the model it is running as,
its effort level if it knows it, and its host (examples: Claude Code, Codex,
Copilot CLI, Gemini CLI). Never guess; leave an unknown field out.

### Tests

- Unit: `favicon()` per skill (valid data URI, accent colour present), the
  provenance formatter (escaping, 60-char cap, charset rejection, missing
  fields → "not reported"), the toggle cycle order.
- Per-skill build tests: page contains `rel="icon"`, the generator meta and a
  toggle with an `aria-label`.
- Per-skill Playwright test: click the toggle three times; assert `data-theme`
  goes auto → light → dark → auto and the icon swaps each time.

## 2. Type system

### Fonts

From Fontsource `@fontsource/*@5.3.0`, latin subsets, OFL-1.1, embedded base64
by `shared/theme.mjs` as today.

| Theme | Display | Body | Mono |
|---|---|---|---|
| paper (default) | Geist 600 | Geist 400/600 | Geist Mono 400 |
| blueprint | Geist 600 | Geist 400/600 | Geist Mono 400 |
| ink | Bricolage Grotesque 600 | Geist 400/600 | Geist Mono 400 |
| editorial | Newsreader 600 | Atkinson Hyperlegible 400/700 | Geist Mono 400 |

- Remove IBM Plex Sans, IBM Plex Mono and JetBrains Mono from `shared/fonts/`
  with their `LICENSES/` entries and `SOURCES.md` rows; add Geist and Geist Mono
  files, licence and rows. Swap the matching `@fontsource/*` devDependencies in
  `skills/make-diagram/package.json` (the metrics generator reads them) and
  update its lockfile.
- Regenerate `shared/fonts/metrics.json` for the new families with
  `skills/make-diagram/scripts/dev/font-metrics.mjs` so diagram and motion text
  measurement stays accurate (`shared/test/text.test.mjs` covers it).

### Type scale — `shared/type.mjs`

Exports CSS custom properties every template uses instead of ad-hoc `rem` values:

- Sizes (1.25 ratio): `--fs-xs 12px`, `--fs-sm 14px`, `--fs-base 17px`,
  `--fs-md 21px`, `--fs-lg 27px`, `--fs-xl 34px`, `--fs-hero clamp(40px, 6vw, 60px)`.
- Line height: body 1.6, headings 1.15, hero 1.05.
- Tracking: display −0.02em, hero −0.03em.
- Two weights: 400 and 600 (bold in body is 600; editorial body keeps Atkinson 700).
- Prose measure at most 66ch; `font-variant-numeric: tabular-nums` on numbers.
- One small-label style (eyebrows, table heads, chips): `--fs-xs`, uppercase,
  +0.06em tracking, `text-3` colour.

### Links and underlines

- Links in running text: underlined, 1px thick, 0.22em offset, underline colour
  accent at 45% (full accent on hover).
- Navigation, TOC, buttons, cards, chips and heading anchors: no underline.
- Underline is never used for emphasis.
- Every link and button has a visible `:focus-visible` ring in the accent.

### Tests

- `shared/contrast.mjs` checks rerun for all four themes, light and dark.
- `type.mjs` unit test: every token emitted.
- Per-skill build test: every `font-family` in the output names a bundled family
  or a generic fallback.
- Template lint: no `text-decoration: underline` outside the prose-link rule.

## 3. Explainer impact pass

The visual work is routed through `redesign-existing-projects` (design-router:
redesign row, stack gate fails — no React/Tailwind). That skill audits first;
proof is before/after screenshots in light, dark and at 390 px.

### Schema (backward compatible)

- Every section gains an optional `label` (≤ 4 words, e.g. "Eval results").
  The TOC and a small eyebrow above the heading use it. `title` stays the
  finding sentence. Without `label` the TOC falls back to `title`, as today.

### Page

- Hero: title at `--fs-hero`, a one-line subtitle, meta (branch, PR, date) as
  chips. The `tldr` section renders inside the hero as a card: `--fs-md` type,
  an accent rule, at most 3 bullets.
- KPIs: values at `--fs-xl` with coloured delta chips; the first thing after the hero.
- Rhythm: ≈96px between sections (from ≈48); visual sections (kpis, cards,
  compare, diagram, chart) alternate onto a surface background; the thin
  dividers between sections go.
- TOC: labels only, compact; the current section is marked by an accent bar,
  not colour alone.
- Slides: same tokens; larger headline, smaller body.

### Soft text caps (validator warnings; exit code stays 0)

| Unit | Warn when over |
|---|---|
| section `title` | 8 words |
| `label` | 4 words |
| paragraph | 3 sentences or 60 words |
| one `text` section | 120 words |
| card body | 30 words |
| list item | 20 words |
| whole-page prose | 900 words |

Each warning names the section id and suggests a conversion (e.g.
"text → cards or steps"). SKILL.md tells the agent to resolve warnings before
building where it can and to report any it leaves. `scaffold.mjs` emits
`label` fields and shorter TODO prompts so a fresh spec starts inside the caps.

### Tests

- Validator: each cap — at the limit silent, one over warns, exit code 0.
- `label` fallback rendering in TOC and eyebrow.
- Existing explainer suite stays green; `check.mjs` at 1440 and 390 px.

## 4. Doctor and preflight

### Pieces

- `shared/doctor.mjs`: the checks, per-platform fix commands and the runner.
- `skills/<skill>/scripts/doctor.mjs`: a thin wrapper declaring the skill's needs.

| Skill | Required | Optional (checked on demand) |
|---|---|---|
| all | Node ≥ 20; the skill's own `node_modules` | Playwright + a browser (only for `check.mjs`, `--for check`) |
| make-explainer | — | sister skills make-diagram, make-dashboard, make-motion — only when the spec has diagram, chart or motion sections. (`bin/install.mjs` already installs make-diagram and make-dashboard through `portableArtifacts.requires`; doctor covers installs that skipped it, e.g. `npx skills add --skill make-explainer` alone.) |
| make-motion | ffmpeg; Chromium or installed Chrome | `kokoro-js` (`--for voiceover`) |
| make-diagram, make-dashboard | — | — |

### Interface (agent-facing: never prompts)

```
node <skill-dir>/scripts/doctor.mjs [--json] [--for <spec.json|voiceover|check>]
node <skill-dir>/scripts/doctor.mjs --fix <id[,id]>
```

- `--for spec.json` derives the needed sister skills from the spec's section types.
- `--json` prints
  `{ ok, missing: [{ id, why, required, size, fix: { auto, manual: { darwin, linux, win32 } }, needsSudo }] }`.
- Unknown or misspelled arguments exit 2 and list the accepted ones.
- `--fix` runs only the `auto` command of each named id and reports each result.
  It refuses ids with `needsSudo` or no `auto`, printing the manual command instead.

### Fix commands

| Id | Auto | Manual / notes |
|---|---|---|
| `node_modules` | `npm ci --omit=dev --prefix <skill-dir>` | ≈30–60 MB |
| sister skill | `npx skills add abhijitbansal/claude-skills --skill <name>` | same command `validate` prints today |
| ffmpeg (macOS) | `brew install ffmpeg` only when `brew` is on PATH | else link to ffmpeg.org builds |
| ffmpeg (Windows) | `winget install Gyan.FFmpeg` | then open a new terminal |
| ffmpeg (Linux) | — | `sudo apt-get install ffmpeg` (`needsSudo`; in Claude Code suggest `! sudo apt-get install ffmpeg`) |
| chromium | `npx playwright install chromium` in `<skill-dir>` | ≈150 MB; Linux missing libs → `npx playwright install --with-deps chromium` (`needsSudo`) |
| kokoro | `npm install kokoro-js@1.2.1 --no-save --prefix <skill-dir>` | ≈250 MB + 90 MB model on first use |

### SKILL.md flow (identical in all four; replaces the "First use" paragraphs)

1. Run `doctor.mjs --json`, adding `--for` when the request needs it.
2. If anything is missing, send the user one message listing each item with
   why, size and command. Ask once.
3. On yes, run `doctor.mjs --fix <ids>`. Anything needing sudo, or failing
   (e.g. a sandbox without network), goes to the user with the exact command.
4. On no, do what the skill can without it (e.g. make-motion still writes and
   validates `motion.json` and hands over the render commands, as today).

make-motion's "Never install system packages yourself" becomes "only after the
user says yes". `build` / `validate` errors for a missing dependency name the
matching doctor id.

### Tests

- Fake PATH without ffmpeg or brew → ffmpeg missing, manual command only.
- Fake PATH with brew → `auto` is `brew install ffmpeg`.
- Sister detection with temp skill dirs; `--for spec.json` picks the right sisters.
- Unknown argument → exit 2 listing accepted arguments.
- `--fix` with a stubbed runner: refuses `needsSudo`, never runs an unrequested id.
- Guardrail proof: each "missing X" test is first run against a stub that
  reports everything present and seen to fail.

## 5. Portability

### Static audit

- New `plugins/portable-artifacts/bin/test/portability.test.mjs` (beside the existing installer tests) lints all four
  SKILL.md files and fails on: host-only tool names (`AskUserQuestion`,
  `TodoWrite`, `Skill(`, `Task tool`, `subagent`); hard-coded `~/.claude`
  paths; a multi-line or folded-scalar `description`; `name` ≠ folder name;
  `description` over 1024 characters; bash-only syntax in commands the agent
  runs. Guardrail proof: seen failing on a fixture containing each banned item.
- Each SKILL.md opens with one line defining `<skill-dir>` as "the folder
  containing this SKILL.md".
- Verify `bin/install.mjs` targets for Codex, Copilot and Gemini against each
  tool's current documentation; fix any drifted path and its test.

### Live Copilot CLI run

- Install into a throwaway project: `node bin/install.mjs copilot --project <scratch dir>`.
  The global `~/.copilot` is not touched.
- One non-interactive prompt per skill (4 runs). Each run must pick up the skill,
  run `doctor.mjs`, set `generatedBy.agent` to "Copilot CLI", validate and build.
  Each output page goes through `check.mjs`.
- Results in `plugins/portable-artifacts/eval/results/summary-portability-copilot-2026-10-14.md`,
  marked measured, with the exact command per run. Failures are recorded.
- Docs state: tested live on Claude Code and Copilot CLI; Codex and Gemini static audit only.

## Rollout

Each step is its own commit with its tests green before the next.

1. Shared chrome — `icons`, `provenance`, `theme-toggle`, wired into all four skills.
2. Type system — fonts, metrics, `type.mjs`, link rules.
3. Explainer impact pass — `label`, hero, rhythm, soft caps, scaffold.
4. Doctor — library, four wrappers, SKILL.md flow.
5. Portability — lint, install-target fixes, Copilot live run.
6. Gallery and docs — rebuild every gallery sample with the new templates;
   `explainer-page` and `explainer-deck` get hand-added `label`s, keep
   `generatedBy` = the original Claude Haiku / low effort, and the gallery note
   says labels were edited. Refresh site screenshots, USAGE.md, README and site copy.
7. Phase-gate review (Opus 5, medium, report only) of the full branch diff;
   then the manual-test checklist HTML in `.scratch/`.

Model routing: implementation by Sonnet 5 at high effort; verification in the
orchestrator's main loop.

## Non-goals

- No redesign of the dashboard or diagram layouts beyond fonts, type tokens,
  favicon, toggle and provenance.
- No auto-detection of model or effort from environment variables.
- No hard failure on text length.
- No live runs on Codex, Gemini or Cursor; no Cursor install target.
- No new section types in make-explainer.
