# What's New Film Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One voiced `desk` film of about 100 s that shows every change on this branch and marks what is new, committed with its notes and shown first in the feature page's films section.

**Architecture:** A make-motion 2 film (`whats-new.json`) built from real repo assets and claims rows, reviewed by fresh look reviewers on its contact sheets, then copied into the gallery with a page card pinned by tests.

**Tech Stack:** make-motion 2 (`make.mjs`), ffmpeg, pytest (`tests/pytest/test_portable_artifacts_page.py`), node test (`bin/test/make-motion-docs.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-19-whats-new-film-design.md`

Paths: `W` = `/Users/abhijitbansal/projects/claude-skills/.claude/worktrees/New-Motion`. `M` = `W/plugins/portable-artifacts/skills/make-motion`. `X` = `M/references/examples/v2`. `GAL` = `W/docs/features/showcase/portable-artifacts/gallery`. `PAGE` = `W/docs/features/portable-artifacts.html`. `S` = `W/.scratch/pa2-release`. Write every path out in full in a command.

## Global Constraints

- Root fields: `"version": 2`, `"mode": "pro"`, `"look": "desk"`, `"format": "16:9"`, `"voice": { "name": "af_heart" }`, `"music": { "bed": "drift" }`, `"sound": "on"`; build with `SOURCE_DATE_EPOCH=1794960000`.
- Length about 100 s by the build report (accept 85 to 115 s). Pro holds: no picture still past 6 s; a statement held 1.6 s, a chart 1.2 s, the last shot 1.5 s.
- No new engine feature, kind or look; no re-render of the showreels or look films.
- Every picture is a real repo file or a real render; every spoken or shown claim is a row of `S/claims-whats-new.md` with its source file and line. cache-clock keep-warm is said to be opt-in and tested against a fake host only.
- A "New" kicker on every shot whose feature is new in this branch; none on features that existed in 1.x.
- One headless browser at a time (`pgrep -fl chrome-headless-shell` before every build or browser test).
- Repo commit trailer only: `Co-Authored-By: Claude <noreply@anthropic.com>`. Implementers do not commit; the lead does.

## Review Focus

1. A shot that shows a mock-up as real (a cache-clock card or a session-compass band drawn from invented numbers): each such picture must be text copied from a named repo file, labelled as such.
2. A claim that overstates: keep-warm "saves money", "tested live", make-scene "faster", or any figure with no claims row.
3. Clip shots that play a look film with its own voice under the narration: every `media` shot of a look film or showreel is `"muted": true`.
4. Text unreadable at phone size in the dense kinds run (diagram, map, feed, screen shots).
5. The page card's figures drifting from the build report (length, size) after a rebuild.

---

### Task 1: Claims and assets

**Files:**
- Create: `S/claims-whats-new.md` (scratch, gitignored, like `S/claims-showreel.md`)
- Create: `X/whats-new-assets/*.png` (only images not already in the repo)

**Interfaces:**
- Produces: a claims table with columns `#`, claim (exact wording allowed), source (`file:line`), and one row per feature in the spec's Goals; asset paths relative to `X` for Task 2.

- [ ] **Step 1:** Read the spec's Goals and `W/plugins/portable-artifacts/CHANGELOG.md` `[2.0.0]`, `W/tools/cache-clock/README.md` "Keep-warm", `W/plugins/session-compass/README.md` (or its docs), `S/claims-showreel.md` for the format.
- [ ] **Step 2:** Write `S/claims-whats-new.md`, one row per goal feature and one per version 1 vs 2 comparison point, each with its source line. Keep-warm's row carries "off until you turn it on" and "tested against a fake Copilot host only" (`tools/cache-clock/README.md:212`).
- [ ] **Step 3:** Pick assets: the look films and showreels under `GAL/looks/*/video.mp4` and `GAL/showreel/*/video.mp4` (used in place, as relative paths from `X` if the film's `src` resolves them; otherwise copy trimmed clips into `X/whats-new-assets/` with one `ffmpeg -ss … -t … -an` per clip), one real contact sheet from `S/showreel-pro/showreel-pro.sheets/`, real gallery screenshots for the redrawn skills (`X/showreel-assets/*.png` already holds dashboard, diagram, explainer, scene). For cache-clock and session-compass, use `code` or `screen` shots whose text is copied from a named file; note the file in the claims row.
- [ ] **Step 4:** Verify: every asset path exists (`ls` each), and `S/claims-whats-new.md` has a row for every Goals item.

### Task 2: The film, built and noted

**Files:**
- Create: `X/whats-new.json`, `X/whats-new.review.md`
- Test: `W/plugins/portable-artifacts/bin/test/make-motion-docs.test.mjs` (validates every film under `X`; no change)

**Interfaces:**
- Consumes: Task 1's claims and asset paths.
- Produces: `S/whats-new/whats-new.mp4`, `S/whats-new/whats-new.sheets/*.png`, `S/whats-new/report.json` (`ok: true`, no `mechanical` finding).

- [ ] **Step 1:** Write `X/whats-new.json` in the spec's order (hook; `code` film file; kinds run: number, chart, compare, list, timeline, map, diagram, quote, feed, screen, clipping; seven looks as muted `media` clips; voice and sound; viral first frame; review sheets; redrawn skills; Director and operator and locked installs; Linux and macOS; cache-clock keep-warm; session-compass; 1.x vs 2 `compare`; `end`). Start from `X/showreel-pro.json` for structure; `node M/scripts/make.mjs --list kinds` for fields.
- [ ] **Step 2:** `node M/scripts/make.mjs X/whats-new.json --outline`. Expected: exit 0, total 85 to 115 s.
- [ ] **Step 3:** `node --test W/plugins/portable-artifacts/bin/test/make-motion-docs.test.mjs`. Expected: pass.
- [ ] **Step 4:** `node M/scripts/make.mjs X/whats-new.json --phonemes`; respell in `say` anything read wrongly (JSON, SQL, MP4, portable-artifacts, cache-clock, macOS).
- [ ] **Step 5:** `pgrep -fl chrome-headless-shell`, then `env SOURCE_DATE_EPOCH=1794960000 node M/scripts/make.mjs X/whats-new.json --json --out S/whats-new/whats-new.mp4`; save the JSON as `S/whats-new/report.json`. Expected: `ok: true`, no `mechanical` finding.
- [ ] **Step 6:** View every sheet PNG; write `X/whats-new.review.md` (each shot as a stranger sees it; the claims row behind each sentence; ranked notes; measurements copied from the report: seconds, frames, bytes, timed, voice.seconds, audio.lufs, audio.truePeakDb, bed tempo and cuts on beat). Fix and rebuild until your own viewing finds no HIGH issue.

### Task 3: Look gate (lead)

- [ ] **Step 1:** Dispatch one fresh reviewer (Opus, medium, report only) with every sheet path, the spec's Intent and Anti-goals quoted, `M/references/story.md:31-41` quoted, the release Task 2 rubric, and the finding-stage sentence verbatim; no script, notes or change list. Report to `W/.superpowers/sdd/2026-11-16-pa2-run2/gate-whats-new-<n>.md`.
- [ ] **Step 2:** Pass on SHIP, or SHIP AFTER FIXES with no failing shot. Otherwise Task 2 Steps 5-6 again with a new reviewer; two revision rounds; a fail after round two goes to the owner. Fix items left under a pass go to `W/docs/decisions-pending.md`; verdicts are quoted verbatim in `X/whats-new.review.md`.

### Task 4: Gallery, page card, docs

**Files:**
- Create: `GAL/showreel/whats-new/video.mp4`, `film.json`, `poster.jpg`
- Modify: `PAGE` (films section), `W/tests/pytest/test_portable_artifacts_page.py`, `W/plugins/portable-artifacts/CHANGELOG.md` (`[2.0.0]` Added), `M/README.md` (film list)

**Interfaces:**
- Consumes: Task 2's MP4 and report; Task 3's pass.

- [ ] **Step 1: Failing tests** in `test_portable_artifacts_page.py`: `FILMS` gains `"whats-new"`; a test that the films block's first card is `id="film-whats-new"` (its index is below `id="film-pro"`); `GAL/showreel/whats-new/film.json` byte-identical to `X/whats-new.json`; video and poster exist; its `gal-meta` line says "voiceover" and its seconds match the report rounded to 0.1.
- [ ] **Step 2:** `uv tool run pytest W/tests/pytest/test_portable_artifacts_page.py -q`. Expected: the new tests fail.
- [ ] **Step 3:** Copy the MP4 and film file (one `cp` each); poster with `env SOURCE_DATE_EPOCH=1794960000 node M/scripts/make.mjs X/whats-new.json --poster <seconds> --poster-out GAL/showreel/whats-new/poster.jpg` at a second that shows the subject; view it.
- [ ] **Step 4:** Add the card first in `PAGE`'s films section ("What's new", aria-label and `film-sub` from the review notes, `gal-meta` from the report, View film and Download MP4 links), the CHANGELOG Added line, and the README film-list entry.
- [ ] **Step 5:** `uv tool run pytest W/tests/pytest/ -q`, `node --test "W/plugins/portable-artifacts/bin/test/*.test.mjs"`, `python3 W/scripts/sweep_counts.py --check`. Expected: all pass.
- [ ] **Step 6 (lead):** Commit the film, notes and assets; then the gallery, page, tests and docs; push; watch CI; update PR #58's body and the checklist (listen to and watch the new film).
