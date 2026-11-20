# What's new film: design

Date: 2026-11-19. Branch: `worktree-New-Motion` (PR #58). Owner answers: one `desk` film, about 90 s, first card in the feature page's films section; then widened to every change on the branch, cache-clock's keep-warm included.

## Intent

One film that shows everything this branch delivers and marks what is new, so a viewer understands the release without reading the CHANGELOG. It is checked in and shown on the site.

## Goals

- Every feature of make-motion 2 appears on screen: the one-file script, the sixteen kinds, the seven looks, the local voice timed to the picture, the bed and cues, pro and viral modes (the viral first frame), the review stage with its contact sheets, and one command.
- The other changes appear: the four redrawn skills (dashboard, diagram, explainer, scene), Director and operator, locked and hashed installs, the same results on Linux and macOS, cache-clock keep-warm, and session-compass's two-line band.
- A closing comparison marks what is new against version 1 (one command against four scripts, looks against themes, sixteen kinds against 38 blocks, a local timed voice).
- It passes the same look gate as the showreels, and it is committed with its notes, its gallery copy and a site card.

## Non-goals

- No new engine feature, kind or look. If a shot needs one, the shot changes.
- No re-render of the showreels or look films.

## Anti-goals (a failure even if it renders)

- A claim with no source, or a mock-up shown as real. Every picture is a real file in the repo or a real render; every spoken or shown claim maps to a row of a claims table. cache-clock keep-warm is said to be opt-in and tested against a fake host only; nothing shows it as live or as saving money.
- A list read aloud, or the same cut on every shot (story.md's tells).
- A film so dense that nothing reads at phone size.

## Approaches (owner picked A)

- **A. One `desk` film (picked).** `desk` draws all sixteen kinds with none parked; the seven looks play as short `media` clips of the committed look films. One JSON file, one voice, one bed.
- B. Seven native chapter films stitched with ffmpeg: each look native, but not made by make-motion alone and no single voice. Rejected.
- C. An explainer page with a clip per feature: skimmable, but not one video. Rejected.

## Design (decided)

- File: `plugins/portable-artifacts/skills/make-motion/references/examples/v2/whats-new.json`, `"mode": "pro"`, `"look": "desk"`, `"format": "16:9"`, `"voice": { "name": "af_heart" }`, `"music": { "bed": "drift" }`, `"sound": "on"`, `SOURCE_DATE_EPOCH=1794960000`. About 100 s (90 s asked, widened for the added features); pro rules hold (no picture still past 6 s, statements held 1.6 s, charts 1.2 s, last shot 1.5 s).
- Shape, in order: hook; the film file (`code`); a run of kinds, one shot each and fast (number, chart, compare, list, timeline, map, diagram, quote, feed, screen, clipping); the seven looks as `media` clips of `docs/features/showcase/portable-artifacts/gallery/looks/*/video.mp4` and the showreels; voice and sound; the viral first frame; the review sheets; the redrawn skills (real gallery screenshots); Director and operator and locked installs; the same on Linux and macOS; cache-clock keep-warm; session-compass; the version 1 against version 2 comparison; an `end` shot with the ask.
- Each new-in-2 shot carries a "New" kicker; features that already existed in 1.x carry none.
- Assets: real screenshots or frames from the repo (gallery pages, contact sheets under `.scratch/pa2-release/`, the cache-clock README card text, session-compass's band as rendered by its tests or docs). New PNGs go under `references/examples/v2/whats-new-assets/`.
- Claims: a new `whats-new` section in a claims table (the showreel claims file's format), one row per sentence, each with its source file and line.
- Gate: one fresh Opus reviewer per round (contact sheets only plus the rubric of release Task 2), pass on SHIP or SHIP AFTER FIXES with no failing shot, two revision rounds; a fail after round two goes to the owner.
- Site: `docs/features/showcase/portable-artifacts/gallery/showreel/whats-new/{video.mp4,film.json,poster.jpg}`; a card `id="film-whats-new"`, "What's new", first in the feature page's films section; `test_portable_artifacts_page.py` extended first (failing) for the card, the files and byte-identical `film.json`; a CHANGELOG `[2.0.0]` Added line; the make-motion README's film list. SKILL.md is not changed (byte budget).

## Left to the builder

- The exact script, the order inside the kinds run, which cut each shot takes, and the poster second.
- How session-compass's band and the cache-clock card are shown (a `screen` or `code` shot from real text), as long as each is real and labelled.
