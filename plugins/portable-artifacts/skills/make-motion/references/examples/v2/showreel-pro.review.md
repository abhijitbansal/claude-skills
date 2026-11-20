# showreel-pro: director's notes (revision round 2)

Film: `showreel-pro.json` (pro, `desk`, 16:9, voiced `af_heart`, `drift` bed at 92, `"sound": "on"`). Voice path: voiced (owner's answer of 2026-11-18). Built on 2026-11-18 with `SOURCE_DATE_EPOCH=1794960000`. Sheets looked at: every PNG under `S/showreel-pro/showreel-pro.sheets/` (9 shot sheets and 8 cut strips). From the final build I opened the problem, idea, dashboard and close sheets and and all eight cut strips; the diagram, explainer, scene, video and proof shot sheets were opened from the build before it, which differs from the final build only in a 0.5 s longer pause after the idea shot (the pictures are the same; the time stamps from the dashboard on move by 0.5 s). Nobody has listened to this film. This is revision round 2 (the last allowed); the round 1 look gate notes are in `.superpowers/sdd/2026-11-16-pa2-run2/gate-showreel-1.md`, the round 2 gate's findings (P1 to P18) in `gate-showreel-2.md`.

**Parked by the owner (ruling of round 2):** the brief's "one hero object that becomes each artifact" (finding P3) is not built. Each skill stays a separate print on the desk. The lead records the decision in `docs/decisions-pending.md`.

## Each shot, as a stranger sees it

1. `problem` (0.00 to about 5.1 s): a browser-style window on the desk titled "Where did this number come from?" holding the dashboard; both are on screen from frame 0. The camera cuts in on the "Total revenue $18,393" tile and a red hand-drawn line underlines the figure; the close-up holds about 2.5 s.
2. `idea` (about 5.1 to 10.2 s): a pinned printout "sales.json" typed on, five lines of JSON, the `query` line highlighted yellow; it holds at least 1.5 s after the highlight lands.
3. `dashboard` (about 10.2 to 16.0 s): a print of the "East earns the most revenue" chart with its Query disclosure open, a push in to the SELECT text inside a yellow box, caption "Every chart shows its query", slug "01 DASHBOARD".
4. `diagram` (about 16.0 to 20.5 s): the whole diagram on a card, then a push to Checkout API, "writes order" and Orders DB inside a yellow box; caption "How a system fits together", slug "02 DIAGRAM".
5. `explainer` (about 20.5 to 26.2 s): a print of the explainer's "Build path / A spec becomes a figure in four steps" section, a push to the figure's first steps inside a yellow box; caption "A recap, on one page", slug "03 EXPLAINER".
6. `scene` (about 26.2 to 30.8 s): a print of the 3D block city with a hover tooltip "web · 2026-W32, 22 commits"; a push to the tallest tower and the tooltip inside a yellow box; caption "Commits per folder", slug "04 3D SCENE".
7. `video` (about 30.8 to 36.0 s): a print of a real make-motion frame ("5 skills, one JSON file each", with its own "04 IN NUMBERS" tape), a push to the frame inside a yellow box; caption "A frame from a film", slug "05 VIDEO".
8. `proof` (about 36.0 to 41.7 s): a very large "10 of 10" counting up, "films built valid", "CLAUDE CODE, 18 NOV 2026"; a thin red hand-drawn line under the figure.
9. `close` (about 41.7 to 46.8 s): "Open source. On your machine." in large serif, "INSTALL IT IN CLAUDE CODE" under it, and a taped tag "PORTABLE-ARTIFACTS".

## What the film says, and the claims row behind each sentence

| Shot | Spoken | Row of `S/claims-showreel.md` |
|---|---|---|
| problem | "A chart is a picture of a number. Where did it come from?" | a rhetorical question; no product claim |
| idea | "That page is one JSON file and one command." | 4; the JSON is a five-key excerpt in the dashboard spec's own format, example content |
| dashboard | "A dashboard. Every chart shows its query, and when it refreshed." | 6 (the picture now shows the Query disclosure open: the SELECT text, "4 rows", "refreshed 03:56 PM") |
| diagram | "Diagrams, to show how a system fits together." | 1 |
| explainer | "Explainers. A recap on one page, with figures inside." | 1; the picture is a figure embedded in the bundled explainer example (the make-explainer skill description says it embeds make-diagram figures) |
| scene | "And 3D scenes, from the same kind of file." | 1, 4 |
| video | "And video, like this film. Five skills, one file each." | 1, 4; true by construction |
| proof | "Ten prompts, one run on Claude Code. Ten of ten films valid." plus on screen "Claude Code, 18 Nov 2026" | 8, in its allowed wording; no rate, no cost |
| close | "Open source, on your machine. Install it in Claude Code." | 9, 5 (no "offline"); the command is not on screen, see note 3 |

New assets are listed in `S/claims-showreel.md` under "Added in Task 2 revision round 2".

## What changed after the round 2 gate (P1 to P18)

| Finding | Change |
|---|---|
| P1 HIGH, video never shown | new `video` shot (a `clipping` print of `motion.png`, a real make-motion frame, slug "05 VIDEO", caption "A frame from a film"); the "5 skills" counter shot is gone |
| P2 HIGH, numbering contradicts "five skills" | the slugs now number only the five skills, 01 to 05. The problem is a `screen` shot, the idea a `code` shot, the proof a `number` shot with no kicker and the close an `end` shot: none of them draws a slug. Left: the real frame in shot 7 carries its own "04 IN NUMBERS" tape (note 2) |
| P3 HIGH, no hero object | parked by the owner (see the top of this file); no device built |
| P4 MEDIUM, query asserted, not shown | the dashboard print is a real capture of the page with the Query disclosure open; the push-in lands on the SELECT text |
| P5 MEDIUM, idea weak and out of order | the order is now problem, idea, the five skills, proof, close. The idea printout is a labelled `sales.json`; it follows the problem ("That page is one JSON file") and the five skills follow it. Not changed: the later skills do not each show a JSON file |
| P6 MEDIUM, frame 0 incomplete | the window's title "Where did this number come from?" and the dashboard are fully drawn at 0.10 s (problem sheet) |
| P7 MEDIUM, stray "[" in proof | the bracket is gone; the mark is now a thin red underline on the figure; the proof sheets (36.8 to 40.4 s) show no stray glyph |
| P8 MEDIUM, scene still, no mark | the scene print is a capture with the page's hover tooltip open on the tallest block; the yellow box is on that tower and its tooltip, not the whole chart; the page header (which repeated the caption) and buttons are cropped out. Not fixed: the picture is a still and does not turn |
| P9 LOW, explainer shows only diff stats | the explainer print is the "Build path" section with its embedded figure; no stats, no "1,107" |
| P10 LOW, proof is inward-facing | not changed: the wording is the allowed claim (row 8); a clearer outward proof is the owner's call |
| P11 LOW, small product name, no command | not changed (the `end` kind sets the mark as a tape tag; see note 3) |
| P12 LOW, small text after push-ins | partly: the problem close-up uses a 4800 px capture so it is sharp; the diagram and explainer labels stay small |
| P13 LOW, note overlaps | not fixed in two places: on the explainer from 23.5 s the caption covers the right end of the faded heading text "A spec becomes a f…"; on the dashboard push-in the slug sits over the faded bars at the top right. The figures and the yellow boxes are not covered |
| P14 LOW, two counters in a row | gone: the video shot is a picture. A transient remains: during the video to proof crossfade (36.2 s) "5" and "4 of 10" overlap faintly |
| P15 LOW, missed `match` cut | not used: the engine's `match` carries one node and fades the rest, and between two different pictures the card carries the old picture (round 1 note); the cuts are crossfade, slide, wipe, page-curl |
| P16 LOW, one print reused | the problem is a close-up of the KPI tile (4800 px dashboard capture); the dashboard shot is a different print (the chart card with its query open) |
| P17 LOW, blank dip in the close fade | not changed: the fade goes through paper (42 s strip) as the `fade` cut is designed |
| P18 LOW, length | 46.77 s measured, against "about 45 s" in the brief (+4 percent); the band is 40 to 50 s |

## Ranked notes

1. 20.5 to 26.2 s · `explainer` · the figure is portrait on a 16:9 desk, so the print is small until the push-in, and the push-in shows only the first two steps (Explainer JSON, Validate) · the whole figure would not fit the box without a mark past the frame edge (the first build of this round hit that: `explainer.on0` ran 63 units past the bottom) · what stays.
2. 30.8 to 36.0 s · `video` · the real frame shows its own "04 IN NUMBERS" tape under the film's "05 VIDEO" slug · the frame is shown as made; cropping or painting out the tape would change a real capture · what stays.
3. 41.7 to 46.8 s · `close` · the command is not shown. The `desk` look sets an `end` shot's `ask` in capitals, and `code` in `desk` would show it in lower case but costs a shot and repeats the ask; the lead's ruling is that the page carries the copyable command · what stays: "INSTALL IT IN CLAUDE CODE" and the tag.
4. 0 to 5.1 s · `problem` · the window title carries the question because the `screen` kind has no caption field; the narration's words also arrive as captions at the bottom of the frame · a `clipping` shot would carry a caption but counts as a numbered shot and would shift every skill's number · what stays.
5. 10.2 to 16.0 s · `dashboard` · the slug "01 DASHBOARD" covers the faded top bars during the push-in · the SQL, the yellow box and the caption are clear · what stays.

## Creative findings left in the report, and the decision

None: the last build has 0 findings (0 mechanical, 0 creative). The first build of this round had two: a creative one on `problem` (the 1200 px dashboard was too small for the full zoom), fixed by a 4800 px capture of the same page and crop (`dashboard-hd.png`); and a mechanical one on `explainer` (a mark past the frame edge), fixed by a smaller region.

## Measurements (copied from `S/showreel-pro/report.json`, `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 1403 (46.77 s at 30 fps; band 40 to 50 s); `captured`: 1403; `seconds` (render): 150.628; `msPerFrame`: 107.362; `bytes`: 26,242,003; `mbps`: 4.489.
- `timed`: measured. `voice.seconds`: 35.643 (voice `af_heart`, model commit `dd4401a9`).
- `audio.lufs`: -16.0; `audio.truePeakDb`: -4.4; cues: 14.
- Bed: `drift`, fitted tempo 93.36 bpm (asked 92), 6 of 8 cuts landed on a beat.
- Audio stream, `ffprobe -select_streams a -show_entries stream=codec_name`: `aac`.

## Sync

There is no per-film sync check other than `timed: "measured"` and the figures above. The only sync measurement that exists is the held-out run of `node scripts/v2/voice/accuracy.mjs --json` on the fixture lines (not this film), repeated on 2026-11-18 in round 2 with the same figures as in round 0: speed 1, held-out words that follow a silence, n 13, median 9 ms, p90 27 ms; speed 1.1, n 12, median 7 ms, p90 18 ms. The reviewer's limits in `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` ("What this supports") apply. Nobody has listened to this audio: voice level against the bed, cue level and the respelled words "query" (`[query](/kwˈɪɹi/)`) and "of" in "picture of a number" (`[of](/ʌv/)`, the phonemizer read it as "r ə") are for the owner's listening pass.

## Look gate

Three fresh reviewers (Opus, medium, report only) judged the sheets. Full reports: `.superpowers/sdd/2026-11-16-pa2-run2/gate-showreel-1.md` to `-3.md`.

What a reader of this file cannot check: the gate reports and the claims table `S/claims-showreel.md` cited in this file live in the run's working folders (`.superpowers/` and `.scratch/`), which are gitignored and not shipped, so no row or verdict here can be checked from the repository. Also, the reviewers of the look films (gate-looks-1 and gate-looks-2) did not see only contact sheets and the rubric: they also read the film files (`look-cosmos.json`, `look-poster.json`) and the build reports, and gate-looks-2 read the header of `scripts/make.mjs`. The showreel gates pulled frames from the MP4 with ffmpeg as well as reading the sheets.

| Gate | Build judged | Verdict | Shots marked fail |
|---|---|---|---|
| 1 | round 0 | SHIP AFTER FIXES | none |
| 2 | round 1 | SHIP AFTER FIXES | `film` ("Labelled "06 VIDEO" but shows the statement "5 skills / one JSON file each". No video artifact appears") |
| 3 | round 2 (this file) | **SHIP AFTER FIXES** | none |

Gate 3 passes the film under the plan's rule (SHIP AFTER FIXES with no failing shot). Its strongest frame: "dashboard at about 12.77 s. The SQL is boxed in yellow and the note says "EVERY CHART SHOWS ITS QUERY", which is the product's claim made visible." Its weakest: "explainer at about 24.17 s. The caption note covers the page title and the highlight sits on an embedded diagram."

The hero object of design section 14 was parked by the owner on 2026-11-18 and not counted by gate 3. Gate 3's fix items (V-P1 to V-P15: the "04"/"05" note collision, the explainer note over the page title and its diagram-only push, the proof's wording, the problem shot's small question, and the LOW items) are left open under the pass and listed in `docs/decisions-pending.md`. On V-P4: the 10 of 10 figure is row 8 of `S/claims-showreel.md`, from the 2026-11-18 director and operator run.
