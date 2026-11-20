# whats-new: director's notes (revision round 2, after look gate 2)

Film: `whats-new.json` (pro, `desk`, 16:9, voiced `af_heart`, `drift` bed, `"sound": "on"`, seed 7, 30 shots). Built on 2026-11-19 with `SOURCE_DATE_EPOCH=1794960000`. Sheets under `S/whats-new/whats-new.sheets/`: 30 shot sheets (one per shot id) and 29 cut strips (one per cut). **All 30 shot sheets and all 29 cut strips were opened.** They were opened on the build before the last one (3391 frames, poster cut a slide); the last build differs from it in one cut only (`look-poster` is now a hard `cut`), and I re-opened that build's `look-poster` sheet and its two strips (marker to poster, poster to pop). Nobody has listened to this film. Earlier rounds: `gate-whats-new-1.md`, `gate-whats-new-2.md`.

## The marker rule (F1)

One rule, applied to every shot:

1. **A feature new in 2.0 is marked with the word NEW, in the desk slug** where its kind can take one (`statement`, `number`, `clipping`, a `compare` with a kicker): sixteen, sheet, sound, frame-zero, the three redrawn clippings (diagram, explainer, scene), director-operator, locked, same-everywhere. A redrawn skill carries the same word and says "redrawn" in its caption.
2. **A kind that cannot take a slug carries "NEW:" at the start of its title** (looks-draw, map, one-command, findings, and redrawn-dashboard's window title), and the quote's attribution line says "NEW, in the skill's own words".
3. **No NEW mark:** the title card (`hook`), the closing comparison and the `end` card (they frame the film), the `releases` timeline (it dates the release), the `the-file` excerpt, the seven look clips (the `sixteen` shot says "seven looks"), and the two tools beside it.
4. **The two other tools carry ALSO, not NEW**, in the same slug (keepwarm 12 ALSO, compass 13 ALSO), and the hook says so out loud and in type: "Everything new in portable-artifacts 2.0, and two tools beside it."

Slug numbers are the shot's place among the numbered kinds, so they begin at 02 (the untagged title card is 01) and run 02 to 13 with no gap.

## Each shot, as a stranger sees it

1. `hook` (0 to 4.6 s): "Everything new in portable-artifacts 2.0, and two tools beside it." in large serif, the name highlighted, no tag.
2. `the-file`: a printout "whats-new.json, an excerpt" typed on: `id`, `show`, `say: "Everything new in …"` of the hook shot, the say line highlighted.
3. `sixteen`: a huge counting "16 / kinds of shot, in seven looks", slug "02 NEW".
4. `looks-draw`: "NEW: kinds per look", seven bars, DESK highlighted (16), MARKER 9, source "Parked or excluded kinds not counted. SKILL.md look table".
5. `releases`: "Three days from 1.3.0 to 2.0.0", "15 Nov 1.3.0" and "18 Nov 2.0.0".
6. `map`: "NEW: the map kind", a world map on a card, Paris, Nairobi and Tokyo with two red routes, "EXAMPLE PLACES".
7. `one-command`: "NEW: one command", four tags film.json, make.mjs, Sheets, MP4 joined by arrows.
8. `no-animation-code`: a quote card "You never write animation code.", "MAKE-MOTION SKILL.MD / NEW, IN THE SKILL'S OWN WORDS".
9. `findings`: "NEW: TWO KINDS OF FINDING", two slips from make.mjs, "Mechanical: a JSON path to change" and "Creative: a call for the director".
10. `sheet`: the real review sheet of showreel-pro's dashboard shot on a card, slug "03 NEW", caption "A REAL CONTACT SHEET", a push to one panel in a yellow box.
11. `look-cosmos` to `look-desk` (seven shots, 1.7 to 2.1 s each): each look's clip plays muted on a small framed cut-out at left (Jupiter chart with 142,984 km shown; the line chart ending on 277; Orders by region; the hand finishing four boxes; "ONE COMMAND"; the 9:16 "ONE JSON FILE. FIVE KINDS OF ARTIFACT."; the dashboard print), the look's name large at right.
12. `sound`: a huge counting "13 / kinds of sound cue, made here", slug "04 NEW".
13. `frame-zero`: the viral showreel's frame 0 as a card; a push to the whole frame in a yellow box; caption "FRAME ZERO NAMES THE PRODUCT", slug "05 NEW".
14. `redrawn-dashboard`: a window "NEW: make-dashboard, redrawn" with the sales dashboard, then a close-up of the "TOTAL REVENUE / $18,393" tile with a red circle on the caps label and a red underline under the numeral.
15. `redrawn-diagram`: the Checkout diagram on a print; a push to Checkout API, Orders DB, the dotted "charges card" edge and Payments in a yellow box; caption "MAKE-DIAGRAM, REDRAWN", slug "06 NEW".
16. `redrawn-explainer`: the explainer print with a black bracket beside its title; caption "MAKE-EXPLAINER, REDRAWN", slug "07 NEW".
17. `redrawn-scene`: the 3D city; a yellow box on the tallest tower and its tooltip ("web · 2026-W32 / 22 commits", whole, inside the box); caption "MAKE-SCENE, REDRAWN", slug "08 NEW".
18. `director-operator`: Director against Operator, slug "09 NEW".
19. `locked`: "Locked installs. Hashed downloads." slug "10 NEW".
20. `same-everywhere`: "A film reviews the same on Linux and macOS." slug "11 NEW".
21. `keepwarm`: a four-line list "cache-clock keep-warm / Off until you turn it on / It costs money / Tested against a fake Copilot host only", slug "12 ALSO".
22. `compass`: a four-line list "session-compass: up to two lines / /compass more: the full text / /compass hide and /compass show", slug "13 ALSO".
23. `one-against-four`: Version 1 (four scripts; nine themes, 38 blocks; a duration per scene) to Version 2 (one command; seven looks, sixteen kinds; the voice times each shot), no tag.
24. `close`: "Open source. On your machine.", "INSTALL IT IN CLAUDE CODE", a tag "PORTABLE-ARTIFACTS".

(24 entries, 30 shots: the seven look shots are one entry and the three redrawn clippings are three.) Fifteen of the sixteen kinds appear (`free` does not). Pro and viral appear only in the frame-zero line.

## What the film says, and the claims row behind each sentence

Rows are in `S/claims-whats-new.md`. Round 2 changes: the hook adds "and two tools beside it" (rows 1, 27 to 29); `sound` says "thirteen kinds of cue" (row 17, 13 names in `schema.md:95`, not 13 placements: the report counts 50 placements); `keepwarm-commands` and its caveat list became one list (row 28; the two command lines are no longer shown, the row-27 sentence is no longer said).

| Shot | Spoken | Row |
|---|---|---|
| hook | "Everything new in portable-artifacts 2.0, and two tools beside it." | 1; the two tools are rows 27 to 29 |
| the-file | "This film is one JSON file, voiced on this machine." | 2, 3 |
| sixteen | "Sixteen kinds of shot, in seven looks." | 4, 5 |
| looks-draw | "Desk draws all sixteen." | 6 |
| releases | "One point three. Three days later, two point oh." | 8 |
| map | "A map. Paris, Nairobi, Tokyo." | 9 |
| one-command | "One command turns film.json into sheets and an MP4." | 10 |
| no-animation-code | "You never write animation code." | 11 |
| findings | "Mechanical findings name a path. Creative ones are your call." | 12 |
| sheet | "Every shot is reviewed, and a contact sheet is written." | 13 |
| look shots | "Cosmos, for science." and six more | 5, 14 |
| sound | "The voice times each shot. Thirteen kinds of cue." | 16, 17 |
| frame-zero | "In a viral film, frame zero names the product." | 18 |
| redrawn-dashboard | "make-dashboard. A caps label, a big numeral." | 19, 20 |
| redrawn-diagram | "make-diagram. Calls are solid. Event edges are dotted." | 21 |
| redrawn-explainer | "make-explainer. More air above the hero." | 22 |
| redrawn-scene | "make-scene. Every wall has two tones." | 23 |
| director-operator | "The agent you talk to writes the file. A cheaper agent runs the build." | 24 |
| locked | "Locked installs. Hashed downloads." | 25 |
| same-everywhere | "A film reviews the same on Linux and macOS." | 26 |
| keepwarm | "Cache clock can keep the cache warm. Off by default. It costs money. Only a fake host tested it." | 28 |
| compass | "session compass has a two line band." | 29 |
| one-against-four | "One command, not four scripts. Seven looks, not nine themes." | 30 |
| close | "Open source. Install it in Claude Code." | 31, 32 |

No cache-clock card and no session-compass band is drawn. Nothing says keep-warm saves money or ran live.

## Round 2: each gate 2 finding, and what changed

| Finding | Change |
|---|---|
| F1 marker not consistent | the rule above; tags added on the redrawn dashboard (a window title, the kind cannot take a slug), looks-draw, map, one-command, findings and the quote; the redrawn clippings say NEW, not REDRAWN; the hook, the comparison and the close carry none; the keep-warm run now starts with its tag on its first shot (the commands shot was merged into the list) |
| F2 other plugins numbered as part of 2.0 | the hook says "and two tools beside it", spoken and in type; keep-warm and compass carry ALSO, not NEW. A separate divider shot ("Also on this branch") was tried and cut: it cost 3.3 s, and the film would have gone to 116 s |
| F3 scene tooltip clipped | the box is `[0.44, 0.04, 0.36, 0.60]` and takes in the tower and its tooltip, which reads whole at 79.7 s (sheet). The tape caption still overlaps the lower bars |
| F4 phone-size text | partly: the `looks-draw` source line, the map labels and the diagram labels are unchanged (the `redrawn-diagram` push is the same region, wider) |
| F5 look clips cut before their payoff | cosmos re-cut from 6.5 s (the sheet shows "142,984 km" by 43.67 s and a full chart at the cut); ledger from 5.9 s (277 on screen from 45.57 s, cut at 46.5 s); marker from 7.8 s (the hand finishes the fourth box by 49.5 s and stands off by 50.2 s); poster from 3.6 s and the cut into it is now a hard `cut`: the blue "A FILM IS A SCRIPT…" frame that flashed during the slide-in is gone (strip viewed, no blue frame) |
| F6 `match` with nothing shared | `locked` to `same-everywhere` is a plain `cut`; no `match` is used in the film now |
| F7 label collisions | not fixed: the MAKE-EXPLAINER tape covers the verdict chip; "VS" touches the Operator card. The map's TOKYO label is crossed by a line in the map's own drawing |
| F8 sound features have no picture | not changed (the `sound` number and the comparison's last line carry them) |
| F9 asks not concrete | not changed (claims row 32, deliberate) |
| F10 claims | "13": the film now says "thirteen kinds of cue" (13 names, `schema.md:95`); "reviews the same": unchanged wording (claims row 26, reviews not output); "a real contact sheet": the sheet is the committed showreel-pro dashboard sheet (claims row 13) |
| F11 repeated devices | not changed |
| F12 cosmetic | not changed |

Paid for by: cutting the `also-here` divider and merging the two keep-warm shots into one list (about 3 s).

## Ranked notes (round 2)

1. 113.03 s long, 1.97 s inside the 115 s ceiling; 71.2 MB.
2. 41 to 56 s · look shots · each clip is a small framed cut-out and its in-clip text is small at phone size (the look's name beside it is large) → a larger layout needs an engine option; what stays.
3. 71 to 77 s · `redrawn-explainer` · the tape caption lies over the verdict chip and the page runs off the bottom → what stays.
4. 36 to 42 s · `sheet` · the contact sheet's panel text stays small when pushed in (2398 px picture); a real sheet, labelled; what stays.
5. the slug numbers start at 02 because the untagged title card counts; 12 and 13 say ALSO; nothing spoken refers to a number → what stays.
6. 64 to 69 s · `redrawn-dashboard` · its window title says "NEW:" where its three siblings carry a slug (a `screen` shot takes none) → what stays.
7. 23 s · `map` · the routes complete about 1.5 s before the cut (read from the strip and the 24.53 and 25.27 s frames) → what stays.

## Holds (read from the sheets' own time stamps, ±0.2 s, and the cut strips)

`no-animation-code` attribution complete about 32.8 s, cut at 34.4 s (about 1.6 s); `looks-draw` highlight by 15.2 s, slide at 16.9 s (about 1.7 s); `map` routes done about 24.5 s, cut at 26.0 s (about 1.5 s); `the-file` highlight by 9.0 s, slide at 10.4 s (about 1.4 s); `one-command` MP4 shown by 29.8 s, cut at 31.2 s (about 1.4 s); `keepwarm` last item by 99.9 s, wipe at 101.7 s (about 1.8 s); `locked` complete by 87.6 s, cut at 89.6 s (about 2 s); `same-everywhere` complete by 91.7 s, wipe at 93.8 s (about 2 s); `close` complete by 110.7 s, ends at 112.5 s plus a tail (about 2.3 s by the sheet, 113.03 s file). No picture sits still past 6 s.

## Creative findings left in the report, and the decision

None: the final build has 0 findings (0 mechanical, 0 creative). A trial build raised one creative finding (an `on` anchor on `sentence:0` of `redrawn-dashboard` came 1.5 s too early); the event was removed.

## Measurements (copied from `S/whats-new/report.json`, `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 3391 (113.03 s at 30 fps; ffprobe 113.033 s; band 85 to 115 s); `captured`: 3391; `seconds` (render): 327.020; `msPerFrame`: 96.438; `bytes`: 71,237,244; `mbps`: 5.042. Stages: validate 0.081 s, voice 0.004 s (cached), timeline 0.001 s, clips 0.226 s, sound 2.512 s, review 100.88 s, render 327.049 s.
- `timed`: measured. `voice.seconds`: 99.049 (voice `af_heart`, model commit `dd4401a9`; `cached: true`, the same narration as the round's earlier build).
- `audio.lufs`: -16; `audio.truePeakDb`: -4.1; cues: 50.
- Bed: `drift`, fitted tempo 129.5 bpm, 12 of 29 cuts landed on a beat.

## Sync

The only sync measurement is the held-out run of `node scripts/v2/voice/accuracy.mjs --json` on the fixture lines (not this film), as recorded in `showreel-pro.review.md` (n 13, median 9 ms, p90 27 ms at speed 1). Nobody has listened to this audio: voice level against the bed, the 50 cues, and these respelled or flagged words are for the owner's listening pass: "session compass" (two words), "macOS", "JSON", "portable-artifacts", "cache clock".

## Look gate

Three fresh reviewers (Opus, medium, report only), one per round, each judged the contact sheets of one build. Full reports: `.superpowers/sdd/2026-11-16-pa2-run2/gate-whats-new-1.md` to `-3.md`.

| Gate | Build judged | Verdict | Shots marked fail |
|---|---|---|---|
| 1 | round 0: 114.73 s, 3442 frames | SHIP AFTER FIXES | none |
| 2 | round 1: 113.43 s, 3403 frames | SHIP AFTER FIXES | none |
| 3 | round 2 (this file's film): 113.03 s, 3391 frames | **SHIP AFTER FIXES** | none |

The passing rule is the plan's: SHIP, or SHIP AFTER FIXES with no failing shot. Each gate's strongest and weakest frame, quoted from its report:

- Gate 1, strongest: "`one-against-four` at about 107–110 s. Version 1 is greyed, an arrow points to Version 2 in black, three parallel lines on each side. It reads at phone size and lands the release in one picture. Runner-up: `keepwarm-caveats` at 97 s (honest, legible, nothing overstated)."
- Gate 1, weakest: "`redrawn-diagram` at 69.00 s. The yellow highlight box cuts the "Checkout API" node so only "PI" shows inside it. The claim the shot makes, "event edges are lighter", is not visible at phone size. Close second: `look-ledger` at 42.60 s, where the card ends on the headline "Orders at least doubled every quarter" over an empty chart (one point, "6", at Q1)."
- Gate 2, strongest: "`one-against-four` at 108.00 s. The Version 1 card is dimmed and the Version 2 card is lit, with a hand-drawn arrow between them and three short parallel lines on each card. It reads at once, even at phone size."
- Gate 2, weakest: "`redrawn-scene` at 77.90 s. The yellow highlight box cuts the bar tooltip in half: "web · 2026-W32 / 22 commits" is mostly faded outside the box, and "22" is hidden. The MAKE-SCENE label sits over faded bars, and the axis labels are washed out."
- Gate 3, strongest: "`looks-draw` at 16.43 s. The chart has one highlighted bar (DESK, yellow) with values and a source line, the title reads at thumbnail size, and the shot backs up the "seven looks" claim. Runner-up: `one-against-four` at 108.73 s."
- Gate 3, weakest: "`redrawn-diagram` at 70.00 s. The diagram is a thin strip across the frame and its node text can't be read even at full 1080p. At phone size only the "MAKE-DIAGRAM, REDRAWN" sticker reads. `compass` at 104.33 s comes close: it is readable text that doesn't tell a viewer what session-compass is."

The fix items left open under the pass are in `docs/decisions-pending.md`, section "whats-new film: look gate 3 leftovers".

What a reader of this file cannot check: the gate reports and the claims table `S/claims-whats-new.md` cited in this file are unshipped working files, in `.superpowers/` and `.scratch/` (both gitignored), so no row, verdict or quote here can be checked from the repository. **No reviewer heard the audio** (each report says so); the gates judged the picture only.
