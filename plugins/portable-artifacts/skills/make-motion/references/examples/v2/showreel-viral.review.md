# showreel-viral: director's notes (revision round 3)

Film: `showreel-viral.json` (viral, `pop`, 9:16, voiced `af_heart`, `pulse` bed at 124, cues on by default). Voice path: voiced (owner's answer of 2026-11-18). Built on 2026-11-18 with `SOURCE_DATE_EPOCH=1794960000`. Sheets looked at: every PNG under `S/showreel-viral/showreel-viral.sheets/` (8 shot sheets and 7 cut strips). The hook, spec, close and all seven cut strips and the video sheet were opened from the final build; the dashboard, diagram, explainer and scene shot sheets were opened from the build before it, which differs from the final build only in the hook, spec and close pauses (the pictures are the same files; only the time stamps move by 0.2 to 0.5 s). Nobody has listened to this film. The sections down to "Sync" describe the round 2 build; round 3 (owner-authorised, beyond the two rounds the plan allows) changed the hook and the explainer shot, and the section "Revision round 3" and its measurements replace the round 2 ones where they differ. Round 0 and the round 1 look gate notes are in `.superpowers/sdd/2026-11-16-pa2-run2/gate-showreel-1.md`, the round 2 gate's findings (V1 to V18) in `gate-showreel-2.md`.

## Each shot, as a stranger sees it

1. `hook` (0.00 to about 4.3 s): the lime tag "PORTABLE-ARTIFACTS" over five heavy lines "ONE JSON / FILE. / FIVE / KINDS OF / ARTIFACT."; on frame 0 the tag and "ONE JSON FILE." are fully drawn (round 3) and the rest is dim; it lights up as it is said, FIVE in acid green; the last word is lit by 2.5 s and the full line holds to the cut at about 4.3 s.
2. `spec` (about 4.3 to 7.2 s): a dark code panel titled "SALES.JSON" with five lines of JSON typed on (`kind` bar, `x` region, `y` revenue, `query` sales); the `query` line highlighted lime.
3. `dashboard` (about 7.2 to 9.2 s): a white card cut out on the dark field, inside the platform safe band: the "East earns the most revenue" bar chart (East in teal) with the Query disclosure open, showing the SELECT text; the caption "DASHBOARD" in heavy white type under it; one light glint across the card on "query".
4. `diagram` (about 9.2 to 11.1 s): the same device: the Web app, the AWS region and VPC holding Checkout API and Orders DB, caption "DIAGRAM".
5. `explainer` (about 11.1 to 13.6 s): the same device: the explainer page's own header and verdict (title "Diagram sections: make-diagram figures inside an explainer", subtitle, date / branch / repo / status, "THE VERDICT" with its prose; round 3, replacing the embedded flowchart), caption "EXPLAINER".
6. `scene` (about 13.6 to 15.7 s): the same device: the 3D block city with the API, WEB, DOCS labels, a tooltip "web · 2026-W32, 22 commits" on the tallest block, and the legend; caption "SCENE".
7. `video` (about 15.7 to 18.4 s): the same device around a real make-motion frame ("5 skills, one JSON file each" on paper, with its own "04 IN NUMBERS" tape) letterboxed on black; caption "VIDEO".
8. `close` (about 18.4 to 22.7 s): "OPEN SOURCE. / INSTALL / IT IN / CLAUDE CODE." in four heavy lines, then a lime plate "PORTABLE-ARTIFACTS" under them; everything ends at about 60% of the frame height (read off the sheet).

## What the film says, and the claims row behind each sentence

| Shot | Spoken | Row of `S/claims-showreel.md` |
|---|---|---|
| hook | "One JSON file. Five kinds of artifact." (the tag names the product) | 1 (five skills), 4 (one JSON file) |
| spec | "You write one file." | 4; the JSON on screen is a four-key excerpt in the dashboard spec's own format (`kind`, `x`, `y`, `query`), example content, not a claim |
| dashboard | "Every chart shows its query." | 6 (the picture now shows the Query disclosure open with the SELECT text, row count and refresh time; the claim and the picture agree) |
| diagram | "How a system fits together." | 1 |
| explainer | "Explainers, with diagrams inside." | 1; the picture (round 3) is the bundled explainer example page's own header and verdict, whose title names diagram sections (the make-explainer skill description says it embeds make-diagram figures); `viral-explainer-page.png` is listed under "Added in Task 2 revision round 3" in `S/claims-showreel.md` |
| scene | "A 3D scene you can explore." | 1 (the make-scene skill description: an explorable 3D world); the tooltip is the page's own hover, example content |
| video | "And video. This one is one file." | 1; true by construction (this film is a `make.mjs` output of one JSON file); no row names it |
| close | "Open source. Install it in Claude Code." | 9 (open source, never "all MIT"), 10 in part: the install command is not on screen (note 4) |

New assets are listed in `S/claims-showreel.md` under "Added in Task 2 revision round 2".

## What changed after the round 2 gate (V1 to V18)

| Finding | Change |
|---|---|
| V1 HIGH, text in the 9:16 unsafe zones | the four artifact shots are now `media` with `fit: "cutout"`: the picture is a card inside the pop composition band (15 to 75 percent of the height, the left 120 px to 885 px of 1080) with the skill name under it; the pictures were re-cropped to that card's shape (`viral-*.png`, about 0.72 wide to tall) so nothing is cut or padded by the engine. On the sheets no picture or caption reaches the top 14 percent, the bottom 20 percent or the right 12 percent. The old `phone-*.png` full-bleed assets are no longer used |
| V2 HIGH, video never shown | new `video` shot: a real make-motion frame (`motion.png`) in the same card, caption "VIDEO"; the "5 skills" counter shot is gone |
| V3 MEDIUM, no shot names its skill | every picture carries its skill name as a caption (Dashboard, Diagram, Explainer, Scene, Video) |
| V4 MEDIUM, dangling dashed edge | the diagram is a variant of the bundled example without the Payments node and its edge (and without the "POST /checkout" label), captured whole, so no edge leaves the picture |
| V5 MEDIUM, off-message explainer | the explainer picture was changed to the build-path figure (Explainer JSON to Validate to buildDiagram), not the branch stats (round 2; round 3 replaced it with the explainer page's own header and verdict) |
| V6 LOW, 1,107 against 1107 | gone with V5 |
| V7 MEDIUM, scene undersells 3D, nothing highlighted | the scene capture has the page's own hover tooltip open on the tallest block ("web · 2026-W32, 22 commits"); page buttons are cropped out. Not fixed: the picture is a still, so the camera does not turn (see note 3) |
| V8 MEDIUM, close repeats the hook | partly fixed: no tag on top, the product name moves to a lime plate at the bottom, four lines instead of five, different wording. The type and the word-by-word reveal are the look's own and stay (note 5) |
| V9 MEDIUM, hook held under 1.6 s | the hook's `say` ends with a 1.4 s pause; the last word is fully lit by 2.5 s and the cut is at about 4.3 s, so the full line holds about 1.7 s by the sheet stamps (hook sheet: 2.50 s lit, 3.70 and 4.03 s unchanged) |
| V10 LOW, lines near the right rail | not changed; the hook and close lines end at about 82 percent of the width, the rail starts near 88 |
| V11 LOW, small UI text | partly: tighter crops raise the dashboard text to roughly 27 px at 1080 wide; the diagram and explainer labels are about 19 to 26 px and stay small (note 1) |
| V12 LOW, light pages break the dark look | reduced: the pages are cards with a lime keyline on the dark field instead of full-bleed light pages |
| V13 LOW, spec and dashboard do not match | the spec is a bar chart (`kind`, `x`, `y`, `query`) and the dashboard shot is that one bar chart with its query open |
| V14 LOW, odd wrap | the `title` key is gone; no line wraps |
| V15 LOW, residue at 13.00 s | not reproduced: the explainer to scene strip shows no sliver; the only overlap is the frame stamp over the outgoing caption at 13.83 s |
| V16 LOW, punch on three cuts | two punches now (hook to spec, video to close); the others are slide, cover up, cut, slide up and wipe left |
| V17 LOW, clock time in the footer | not changed: "refreshed 03:56 PM" is the product's own footer text in the real capture |
| V18 LOW, hook is type only | not changed: the hook names the product and says the promise; no artifact picture sits behind it |

## Ranked notes

1. 7.2 to 18.4 s · the five picture shots · the pictures are about 70 percent of the frame width (the safe band is 765 px of 1080) and the diagram and explainer labels are small at phone size · the band is the platform's limit; a taller crop would need a different picture · what stays.
2. 15.7 to 18.4 s · `video` · the real frame is 778 px wide on a 778 by 778 black field; the engine's cover crop trims about 85 px on each side, so the "04 IN NUMBERS" tape is clipped at its right edge, and the frame carries its own number, which the film does not otherwise use · the frame is shown as made, the pad is plain black · what stays.
3. 13.6 to 15.7 s · `scene` · the picture is a still; the cut-out card does not move, only the glint · nothing in the `media` kind turns a 3D scene · what stays.
4. 18.4 to 22.7 s · `close` · the install command is not shown. The `pop` look sets an `end` shot's `ask` in capitals, and a viewer who copies a capitalised command may type it wrong; the page carries the copyable lower-case command (the lead's ruling) · what stays: "Install it in Claude Code", "Open source" and the plate.
5. 18.4 to 22.7 s · `close` · the reveal and the type are the same as the hook's (one look) · only the engine's end shot could change that · what stays.
6. 4.3 to 7.2 s · `spec` · the typing finishes by about 6.0 s and holds to the cut at about 7.2 s, about 1.2 s, the chart rule rather than the 1.6 s statement rule · the film is at 22.7 s of 23 · what stays.

## Creative findings left in the report, and the decision

None: the last build has 0 findings (0 mechanical, 0 creative).

## Measurements, round 2 (superseded by "Measurements, round 3" below; copied from `S/showreel-viral/report.json`, `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 682 (22.73 s at 30 fps; band 18 to 23 s); `captured`: 545; `seconds` (render): 36.027; `msPerFrame`: 52.825; `bytes`: 10,367,453; `mbps`: 3.648.
- `timed`: measured. `voice.seconds`: 19.126 (voice `af_heart`, model commit `dd4401a9`).
- `audio.lufs`: -14.1; `audio.truePeakDb`: -3.1; cues: 14.
- Bed: `pulse`, fitted tempo 122.72 bpm (asked 124), 5 of 7 cuts landed on a beat.
- Audio stream, `ffprobe -select_streams a -show_entries stream=codec_name`: `aac`.

## Sync

There is no per-film sync check other than `timed: "measured"` and the figures above. The only sync measurement that exists is the held-out run of `node scripts/v2/voice/accuracy.mjs --json` on the fixture lines (not this film), repeated on 2026-11-18 in round 2 with the same figures as in round 0: speed 1, held-out words that follow a silence, n 13, median 9 ms, p90 27 ms; speed 1.1, n 12, median 7 ms, p90 18 ms. The reviewer's limits in `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` ("What this supports") apply. Nobody has listened to this audio: voice level against the bed, cue level (14 cues, five of them light glints) and the respelled word "query" (`[query](/kwˈɪɹi/)`, phonemes only) are for the owner's listening pass.

## Revision round 3 (owner-authorised, the two gate-3 fails only)

Built on 2026-11-18 with `SOURCE_DATE_EPOCH=1794960000`. Every sheet PNG (8 shot sheets, 7 cut strips) of the final build was opened. Nobody has listened to this film. The measurements below replace the round 2 ones above.

| Gate 3 finding | Change |
|---|---|
| `hook` FAIL (V-1): no PORTABLE-ARTIFACTS tag at frame 0, every word grey | engine: in a viral film's first statement the kicker tag is set at 0, and the words up to the first full stop ("ONE JSON FILE.") are full ink from frame 0 (`engine/kinds/statement.mjs` `firstSentence`, `engine/kinds/stack.mjs` `opening`). The rest of the line is still a ghost and lights as spoken; a one-sentence hook keeps every word a ghost and only its tag is set at 0. Checked on frames 0, 1 and 2 of the built MP4 (ffmpeg): the lime tag is drawn and ONE JSON FILE. is white on all three; FIVE KINDS OF ARTIFACT. is grey. Test: `kinds-statement.test.mjs` "viral hook, frame 0"; with the fix off it fails on the tag assertion |
| `explainer` FAIL (V-2): a flowchart that reads as a second diagram, arrow cut at the card bottom | new picture `showreel-assets/viral-explainer-page.png` (the bundled explainer page's own header and verdict at phone width: title, subtitle, date / branch / repo / status, "THE VERDICT" and its prose), cut between two text lines so nothing is cropped at the card edge. The shot's JSON is otherwise unchanged. On the sheets the card top is at about 14.4 percent of the height, the caption ends at about 74 percent, and nothing is inside the right 12 percent or the bottom 20 percent |
| V-9 (spec hold about 1.2 s), only if free | spec pause (1.1) became (1.5) and the hook's closing pause (1.4) became (1.0), so the film is the same length. The spec's finished state is on screen from the 5.63 s frame to the cut at about 7.2 s: at least 1.57 s. The hook's last word is lit by 2.50 s and the cut to the spec is at 4.30 s: 1.8 s |

Other shots are unchanged (same JSON). The video shot still shows its own "04 IN NUMBERS" tape and a letterboxed frame (notes 2 to 6 above stand; note 6 is now the hold above).

## Measurements, round 3 (copied from `S/showreel-viral/report.json`, `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 682 (22.73 s at 30 fps; band 18 to 23 s); `captured`: 531; `seconds` (render): 34.868; `msPerFrame`: 51.126; `bytes`: 11,255,071; `mbps`: 3.961.
- `timed`: measured. `voice.seconds`: 19.126 (voice `af_heart`, model commit `dd4401a9`).
- `audio.lufs`: -14.1; `audio.truePeakDb`: -3.2; cues: 14.
- Bed: `pulse`, fitted tempo 123.58 bpm (asked 124), 5 of 7 cuts landed on a beat.
- Audio stream, `ffprobe -select_streams a -show_entries stream=codec_name`: `aac`.

## Look gate

Four fresh reviewers (Opus, medium, report only) judged the sheets. Full reports: `.superpowers/sdd/2026-11-16-pa2-run2/gate-showreel-1.md` to `-4.md`.

What a reader of this file cannot check: the gate reports and the claims table `S/claims-showreel.md` cited in this file live in the run's working folders (`.superpowers/` and `.scratch/`), which are gitignored and not shipped, so no row or verdict here can be checked from the repository. Also, the reviewers of the look films (gate-looks-1 and gate-looks-2) did not see only contact sheets and the rubric: they also read the film files (`look-cosmos.json`, `look-poster.json`) and the build reports, and gate-looks-2 read the header of `scripts/make.mjs`. The showreel gates pulled frames from the MP4 with ffmpeg as well as reading the sheets.

| Gate | Build judged | Verdict | Shots marked fail |
|---|---|---|---|
| 1 | round 0 | NOT YET | `diagram` |
| 2 | round 1 | NOT YET | `explainer`, `film` |
| 3 | round 2 | NOT YET | `hook` (no tag at frame 0, every word grey), `explainer` (read as a second diagram) |
| 4 | round 3 (owner-authorised, this file) | **SHIP AFTER FIXES** | none |

The plan allows two revision rounds; the owner authorised a third, limited to gate 3's two failing shots, on 2026-11-18. Gate 4 passes the film under the plan's rule (SHIP AFTER FIXES with no failing shot). Gate 4's words, copied from `gate-showreel-4.md`. Strongest frame: "dashboard at about 8.9 s. "East earns the most revenue" is the title, the East bar is teal and the other bars grey, and the SQL with its refresh time is visible." Weakest frame: "the video shot at about 17 s. It is a still "5 skills / ONE JSON FILE EACH" frame letterboxed inside a near-square card." On frame 0: "frame 0 (`f1.png`) shows the PORTABLE-ARTIFACTS tag"; ""ONE JSON FILE." is in full white. "FIVE KINDS OF ARTIFACT." is in dim grey."; "Frames 1 and 2 are identical to frame 0."

Gate 4's fix items (F1 to F14: the video shown as a still, the explainer headline that is about diagrams, five skill shots in one composition, label sizes, the small scene card, the garbled wipe labels, card tops on the 14% line, and the LOW items) are left open under the pass and listed in `docs/decisions-pending.md`.
