# portable-artifacts design refresh

Status: draft for review. Branch: `feat/portable-artifacts-design-refresh`.

## Problem

The `make-explainer` page and deck and the `make-motion` preview and video work, but look basic. They use common fonts (Geist, Inter, Atkinson Hyperlegible, Newsreader), flat layouts and few images. The goal is output that looks art-directed by a designer and not like generic AI output.

## Agreed intent

- Pages, decks and motion clips look designed: better type, spacing, colour, images, emoji.
- Avoid common AI fonts and looks. Use faces that are distinctive but readable.
- Work was run Claude-Design style: three specimen sheets (`.scratch/specimens/A|B|C`, gitignored) were built and compared. The user liked all three and picked C as the default.
- Emoji lint ban is removed. AI image generation is optional; procedural art is the default.

## Scope

In: `make-explainer` (page and deck) and `make-motion` (preview UI and MP4), plus the shared theme, type and art code they use.

Out: `make-dashboard` and `make-diagram` keep their current default theme. The new themes become selectable there for free if the token schema matches; no default changes.

## Themes

Three new theme files in `shared/themes/`, each with light and dark modes hand-tuned (not inversions). The four existing themes stay.

| Theme | Source | Display / body / mono | Feel | Best for |
|---|---|---|---|---|
| `dusk` (default) | Specimen C | Funnel Display (Unbounded only for short big numerals) / Host Grotesk / Commit Mono | Aubergine to peach, coral and mint, film grain, tilted cards | Anything, or unclear |
| `press` | Specimen A | Young Serif / Schibsted Grotesk / JetBrains Mono | Bone paper, ink, vermilion, marginal numerals, overprint art | Dense docs, long reads, branch recaps |
| `poster` | Specimen B | Big Shoulders / Familjen Grotesk / Martian Mono | Near-black, acid lime and orange, condensed caps, halftone, registration marks | Launch decks, pitches, energetic clips |

Display faces chosen over the alternates because: Gloock's hairline serifs are fragile below ~28px; Anybody at 50% width is clumsy next to Big Shoulders; Unbounded is too wide beyond short text.

All fonts are SIL OFL 1.1, bundled as latin woff2 in `shared/fonts/` with licences in `shared/fonts/LICENSES`. The theme JSON schema is the existing one (fonts, light/dark colour tokens, categorical and sequential ramps) so existing consumers keep working. Avoided faces: Inter, Geist, Space Grotesk, Instrument Serif, Fraunces, Playfair, Roboto.

## Theme selection

1. An explicit `--theme <name>` or a user phrase ("use poster") wins.
2. Otherwise the agent infers from the prompt and says which theme and why in one line: dense docs, long reads, changelogs, branch recaps → `press`; launch decks, pitches, demos, energetic clips → `poster`; everything else or unclear → `dusk`.
3. If the prompt is genuinely split between two themes the agent asks once, listing the three with a one-line feel each. If it cannot ask, it uses `dusk`.
4. `SKILL.md` for explainer and motion carries this table. The build prints the chosen theme; the page footer records it.

## Changes per area

- **shared/**: three theme JSONs, fonts, a type scale and spacing scale as tokens, a seeded procedural art generator (SVG, deterministic, seeded from the title; per-theme styles: grainy blobs and duotone orbs for `dusk`, halftone and contours for `press`, halftone grids and registration marks for `poster`). Edit here only, then `node bin/sync-shared.mjs`.
- **make-explainer page**: new `base.css` from theme tokens (asymmetric layout, large numerals, hairlines, grain). Existing section types and JSON schema unchanged.
- **make-explainer deck**: per-theme slide layouts including full-bleed art slides; emoji accents allowed.
- **Emoji lint**: ban removed. A soft warning (not an error) fires on high emoji density so decks do not become confetti.
- **AI images (optional)**: an opt-in `--image-api` flag and a documented hook. It needs the user's own key and sends the prompt off the machine, so it is off by default and the docs say so. Procedural art is always available.
- **make-motion**: preview UI and MP4 render use the same tokens, fonts and art; per-theme kinetic-type presets.
- **Docs**: plugin README, USAGE, the three skill READMEs and the site page; showcase assets regenerated. Counts sweep (`scripts/sweep_counts.py --check`) must stay clean.

## Constraints

- Offline and deterministic: same spec gives same output. Only provenance date varies.
- No new npm dependencies in skills.
- Text must meet WCAG AA contrast in every theme and mode. Vermilion in `press` light is display-only (4.0:1 on surface).
- Respect `prefers-reduced-motion`; phone width has no horizontal scroll.

## Testing

- Existing tests stay green; emoji-lint tests updated for the new behaviour.
- New tests: theme resolution (explicit, inferred default, fallback), contrast pass for every theme and mode, art generator determinism (same seed, same SVG).
- Visual: each theme in light and dark at desktop and phone width, screenshotted and viewed; one mid-animation motion frame per theme (specimens only showed static frames).
- `bats tests/bats`, shared tests, CI manifest checks, `sync-shared.mjs --check`.

## Known gaps from specimens (to resolve in build)

- Motion loops were never seen playing; only static frames.
- Specimen C light-mode deck, art and motion sections and phone-width layout below the top were not viewed.
- True 375px phone width not tested (headless Chrome minimum is 500px; use the iframe trick).
- Specimen emoji looked dim on the lime slide (`poster`).

## Risks

- Font payload size per page grows with three families per theme; keep to the weights actually used and subset to latin.
- `dusk` grain and blurred blobs are heavy on low-end devices; provide a reduced-effects path.
- `poster` all-caps condensed display needs short headings; the heading budget warning already caps titles at 8 words.
