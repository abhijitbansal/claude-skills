# Decisions pending

Owner calls an agent parked instead of asking. Each lists the options and the
default the code ships with; change the code if you pick another.

**Resolved 2026-11-15 (plan item G-73, decision D12):** the owner chose the
shipped defaults for the four entries from PR #35 to the design-refresh branch
below: test-board close (A), diagram legend overlay (A), the dashed legend word
"secondary" (A) and the two `@fontsource` deps kept (A). The entries stay as a
record of what shipped and the other options. The fontsource recommendation (B)
was not taken, so no lockfile change was made.

## Open: machine setup (plan item CAT-99, 2026-11-15)

`setup/setup.sh` was fixed where the fix is mechanical: the self-marketplace
check matches the name line exactly, and a `--dry-run` writes no backup. These
four calls are the owner's. Until you pick, setup does what it did before.

### Which CLAUDE.md the `dotfiles` and `guidelines` steps write

The steps use `~/CLAUDE.md`. Claude Code reads `~/.claude/CLAUDE.md` for every
project, and the owner's live file is that one.

- **A (default, shipped):** keep `~/CLAUDE.md`. No behaviour change.
- **B:** write `~/.claude/CLAUDE.md` and leave `~/CLAUDE.md` alone. Matches where
  Claude Code looks; an existing file there gets the additive guideline merge
  only, never a copy over it.

### Which plugins a fresh machine enables

`claude-setup.toml` lists the plugins the seed installs. A 2026-11 comparison
found 19 plugin specs enabled on the owner's machine that the file does not
list (measured by the mining pass, not re-run here), and the self-marketplace
step installs all eight of this repo's plugins.

- **A (default, shipped):** the toml as it is; the self-marketplace step still
  installs all eight.
- **B:** refresh the toml from a scrubbed `capture.sh` run, then trim it to the
  set you want enabled.
- **C:** install only what the toml names and make the self-marketplace step
  respect it.

### Folder or GitHub source for this repo's own marketplace

`step_local_plugins` adds the checkout (`claude plugin marketplace add
<checkout path>`), so installed plugins track the working tree.

- **A (default, shipped):** a folder source. Right for the owner's dev machine.
- **B:** the GitHub source (`abhijitbansal/claude-skills`) unless a dev flag is
  passed. Right for a machine that only consumes the plugins.

### Site wording that invites strangers to run the machine seed

`site/index.html` and the README present `setup.sh` next to the plugin
installs, though `templates/` and `claude-setup.toml` are the owner's seed data.

- **A (default, shipped):** leave the wording; the README already says public
  users can ignore `templates/` and the toml.
- **B:** reword the site line so the seed reads as the owner's machine setup,
  and keep the plugin install as the public path.

## test-board ✕ and session-compass's `tests` segment (PR #35, 2026-10-11)

Pressing `✕` hides the test-board band but leaves `test-board.latest`
intact, so session-compass's band and pane keep showing `tests N ✓ M ✗` until
the runs expire at 60 minutes (expiry prunes `latest`, so both clear then).

- **A (default, shipped):** `✕` hides the test-board band only. Compass keeps
  the counts until the hour is up. Matches PR #35's stated intent.
- **B:** `✕` also empties `latest`, so compass's segment clears at once. One
  meaning of "closed" everywhere, but closing the band also drops the counts
  from the compass line.
- **C:** compass reads `test-board.dismissed` and hides its segment while the
  newest run is dismissed. Keeps both, at the cost of compass knowing a second
  test-board state key.

## make-diagram page: legend overlay vs the fit, and the legend in Play on phones (PR #39, 2026-10-14)

The standalone page shows the key as an HTML overlay in the stage's top-right
corner (the drawn legend is hidden there).

- **A (default, shipped):** keep the overlay on the stage. The camera fits the
  drawing (`data.drawing`, no legend band, no widening) into the stage below the
  overlay's measured height, on first paint, resize, `0`, Fit and double-click.
  Costs a full-width top band, up to about 90 px on a phone when the key wraps.
  On a phone in Play the overlay is hidden, so the stage keeps its height.
- **B:** put the legend in normal flow, a band above the stage. No camera
  reserve, never overlaps, but the band stays in Play too and takes the same
  height on a phone; the overlay's blurred-glass look goes.
- **C:** collapse the key behind a "Key" button on phones. Smallest footprint,
  one more control; the key is no longer visible at a glance.

## make-diagram legend word for a dashed graph edge (PR #39, 2026-10-14)

The key prints one word per edge style. The word for `dashed` was "optional", a
meaning no author doc gives a dashed line (the shipped examples use it for a
reply, a "no" branch, a transition and a two-way link). Sequence diagrams print
"reply" and are unaffected.

- **A (default, shipped):** "secondary". Neutral: it says the line matters less
  than the solid ones without claiming a meaning. SKILL.md and schema.md now
  state the words (`call`, `secondary`, `event`) so authors pick a style knowing
  the key. The word is about 11 px wider than "optional" in the legend row.
- **B:** "alternate". Fits a "no" branch or a fallback, less so a reply.
- **C:** "dashed". Describes the line, not a meaning; the most literal and the
  least informative.

Change `STYLE_WORD` in `scripts/lib/legend.mjs`, the pinned legend tests, the
goldens and the two docs if you pick another.

## make-motion: the two unused `@fontsource` npm deps (branch feat/portable-artifacts-design-refresh, 2026-10-17)

`skills/make-motion/package.json` still pins `@fontsource/inter` and
`@fontsource/jetbrains-mono` (5.3.0). make-motion no longer reads either since
`dusk` became its default look: every theme now loads its faces from the
bundled `shared/fonts/` (which still carries JetBrains Mono for the `press`
theme). The deps only cost install size; nothing imports them.

- **A (was the default):** keep both in `package.json` and
  `package-lock.json`. Installs stay byte-identical to before the branch.
- **B (recommended):** remove both and regenerate `package-lock.json`.
  Smaller installs; nothing in the skill reads them.

**Resolved 2026-11-15: B.** The security pins change (docs/superpowers/plans/2026-11-15-pa2-security-pins.md, Task 1)
removed both packages from `skills/make-motion/package.json` and its lockfile, and the Inter row from the plugin
README's licence table.

## make-motion 2: look findings left after the gate (branch worktree-New-Motion, 2026-11-15)

The look gate closed on the owner's choice of one targeted fix pass and no fourth review
(`docs/superpowers/plans/2026-11-15-pa2-gate-report.md`). These were left; each has a default the work proceeds on.

- **Motion smear on slide and punch cuts.** Two builds read as echoes, not blur.
  - **A (default, shipped):** off in `desk` and `pop`, opt-in by look data; films use hard cuts.
  - **B:** build a real blur in the WebGL post pass (velocity along the cut direction) in the showreel plan.
- **`pop` stack lines of unequal size ("NO ACCOUNT." smaller than its neighbours, wider gap in "NO CLOUD.").** Review 1
  disliked three equal centred lines; reviews 2 and 3 disliked the unequal ones.
  - **A (default, shipped):** each line fitted to the safe width, flush left.
  - **B:** one size for the block, ragged right, with only the emphasised line larger.
- **`desk` push slices content at the frame edge** (a "459" tile reads "59", faint under the paper scrim).
  - **A (default, shipped):** paper scrim at 0.8 over everything outside the region.
  - **B:** an author field for the push window, as `crop` is for the establishing window.
- **Statement shots share one layout in both looks; no end card or lockup.** Default: left for the showreel plan,
  with the remaining shot kinds and looks.
- **Sheet labels and slug text are about 5 px tall at phone size in `desk`.** Default: accepted as furniture; nothing
  essential is set in them.

## make-motion 2 voice and sound: where the build differs from the design (2026-11-16)

Each has a default the work proceeds on; all are one-value changes in mode data unless noted.

- **Captions in the viral mode.** The design (section 7) says on by default.
  - **A (default, shipped):** opt-in in every mode (`"captions": true`). On by default they changed the approved `pop`
    test film (a smaller picture, spoken-word captions beside the author's own caption line), which would have
    bypassed the look gate.
  - **B:** on by default in viral, after the `pop` clipping composition is revised to make room and re-reviewed.
- **Pause before an emphasised word.** The design (6.2, 9.2) asks for a short pause before it.
  - **A (default, shipped):** no pause and no call split; emphasis is stress promotion, a 2 dB lift and the picture's
    own emphasis. Each split restarts the voice's prosody.
  - **B:** `emphasisPause` above 0 in mode data (built, off). Decide after listening.
- **Voice pace.** The design says 1.08 in viral and 0.96 in pro. Shipped: 1.1 and 1.0 (`voiceSpeed`). Decide after
  listening.
- **Music duck depth.** The design says 8 dB in viral and 10 dB in pro. Shipped: 9 dB in both, one constant. Default:
  keep until the listening pass; then move it into mode data if the two modes should differ.
- **Loudness true-peak ceilings.** As designed (-1 and -1.5 dBTP). No decision needed.
- **Motion of a music bed against cuts.** The design says cuts land on beats. For a voiced film the cuts are fixed by
  the narration, so the bed's tempo and phase are fitted to them and the report says how many cuts landed (3 of 4 in
  both example films). Default: keep; the alternative is to let a bed nudge shot tails, which changes film length.
- **Word-timing claim for the README.** The only sentence the measurement supports is in the gate record's Voice
  section. Default: use it verbatim, or say nothing.

## Parked from the same branch (2026-11-15)

- **Docs site typography lint findings** ("single font", "flat type hierarchy" on feature pages) come from the shared
  stylesheet. Default: untouched; fix once in the stylesheet in the visual refresh of the other skills.
- **Unpinned `npx skills`, `npx playwright install chromium` and `npm install -g cartoon-wrap` in docs.** Default:
  allowed in docs only by the dependency rule tests; pin if the owner wants docs commands reproducible.
- **Workflow actions pinned to tags, not commit SHAs.** Default: left; SHA pinning is a repo-wide choice.
- **session-compass: old stored goals are not re-stripped of control characters on display**, and the hover reveal is
  not built (`/compass more` expands instead). Default: left.
- **make-motion 2 cut-outs with alpha (people) are not supported yet.** Default: later plan, with the optional
  cut-out package.
- **cache-clock keep-warm ceiling is per session and resets if the ledger file is deleted.** Default: documented;
  a machine-wide ceiling would need a shared ledger.

## Shot kinds, first wave: look review 3 leftovers (2026-11-16)

Both all-kinds films got "ship after fixes" from the third independent reviewer; no kind failed. The two allowed revision rounds are used, so these are open. Default: ship the kinds as they are and fix the first group in the next fix wave; the owner may ask for more.

- Fix in the next wave (defects, not taste): the last shot of a film holds its final state for under half a second (hold 1.5 to 2 s); a number under 10 opens on a bare grey 0 and the digit jitters sideways as it counts (land on the value, or count with fixed advances); desk chart plot is about 20 percent of the frame height (make it about twice as tall, drop the axis and gridlines when marks are labelled directly, no olive frame in the colour change); desk compare arrow tail meets the left card; desk quote text nearly touches the card edge; pop quote breaks "FALLS / SHORT" and sets the last line smaller; pop list items come out at different sizes; a pop clipping caption sits under the picture shadow; several first frames show half-entered parts.
- Owner taste: pop on tall frames leaves the lower 35 to 55 percent empty in most shots (type is width-limited; options: allow word-per-line breaks for short hooks, or centre the block lower); every statement, quote and end card uses the same grey-to-ink word reveal; desk mono labels are small at phone size (raising them breaks the 3x hero rule on some frames).
- Copy of the example films (mine): "nine kinds of shot" over a film that shows eight; "every stage added tests" over running totals; a quote attributed to the product; asks that name no destination.

## Cut-over timing (2026-11-16)

The cut-over plan (docs/superpowers/plans/2026-11-16-pa2-cutover.md) deletes the version 1 engine. Version 2 today has 9 of 16 designed shot kinds and 3 of 7 looks, and no counterpart for: preview, vars and --batch, --poster, --workers, storyboard, footage, maps, code, .srt captions, the hand-drawn style, themes, the beats command. The design puts the remaining kinds and looks before the cut-over.

- Default taken for the unattended run: do the parts that remove nothing a user has (Task 1: version 2 stands on its own files; the voice half of Task 4: drop kokoro-js and @huggingface/transformers from optional/voice, which version 2 no longer imports). Do NOT delete version 1 (Tasks 2, 3, 5, 6) until the owner says so or the remaining kinds and looks exist.
- Options for the owner: (a) wait for the remaining kinds and looks, then cut over (the design order); (b) cut over now and list every dropped feature in migrating.md and the CHANGELOG; (c) ship version 2 beside version 1 behind the spec version field for one release.
- The plan lists 12 smaller decisions with defaults (shiki and atlas packages, optional/cutout, the sketch template, version number timing, site clips).

**Resolved 2026-11-18: (b), cut over now.** Version 1 is deleted on branch worktree-New-Motion (cut-over Tasks 1 to 6), and every dropped feature is named with what replaces it in `skills/make-motion/references/migrating.md` and in the CHANGELOG `[Unreleased]`. Outcomes of the plan's smaller decisions:

- **Decision 2 (shiki and the atlas packages):** kept. All five (`shiki` 4.5.0, `us-atlas` 3.0.1, `world-atlas` 2.0.2, `d3-geo` 3.1.1, `topojson-client` 3.1.0) are imported by version 2, and their licence rows stay.
- **Decision 3 (`optional/cutout`):** kept, with `scripts/cutout.mjs`, its tests and its doctor target. The `cutout` device takes a picture with transparency. A cut-out clip in a film is not claimed.
- **Decision 4 (`template/sketch/`):** deleted with version 1, with the vendor script and its test. Caveat now ships from `engine/fonts/`.
- **Decision 5 (version 2.0.0):** not bumped. The bump happens once, with step 9, before the pull request.
- **Decision 8 (site and gallery):** a minimum-truth pass only. The version 1 clips stay and are labelled as made with make-motion 1.x. Step 9 replaces the films and re-measures the claims.
- **Decisions 10 and 11 (old files, voice detection):** the CHANGELOG names the folders to delete and says an old voice install still works.

Still open, default is to leave as is:

- **Decision 1's removed features.** Lottie, themes, the 38 blocks, scenes and keyframes, colour grades, caption files as input, the recorded `kenney:` cues, `"beat:<n>"` times, `voice.mjs` as its own command, the sketch icons, and the flags `--contact-sheet`, `--quality`, `--fps`, `--size`, `--loudness` and `--true-peak`. A user may ask for one again; each is a port, not a fix.
- **Decision 6.** The folders `scripts/v2`, `test/v2` and `references/examples/v2` keep their names. A rename is a separate, mechanical change with its own guard edits.
- **Decision 9.** `--list` has eight names; the design also names `captions`. Default: document the eight; add `--list captions` first if wanted.
- **Decision 13.** CI sets `PA_REQUIRE_BROWSER` beside `PA_REQUIRE_RENDER`; the two version 2 test helpers still read only the first. Default: keep both set; make the helpers read either if one is dropped.
- **Decision 15.** The doctor's ffmpeg 5.1 note was written for version 1's `--loudness`. Whether 5.1 is the right floor for version 2's mastering options was not checked.
- **The poster of a marker film.** A `marker` film opens on a nearly empty board, so make-explainer's poster (second 0 of the rendered film) is sparse. Default: leave it; a fuller poster is a follow-up.
- **The installed-size figure.** The README requirements table gives make-motion as about 58 MB, the doctor's `INSTALL_SIZES` figure, from before the six packages left. A `du -sk node_modules` of a clean install measured 55,304 KiB (cut-over Task 5). Default: re-measure with the doctor's own method and update `INSTALL_SIZES` and the table together.

## The cosmos look is parked (2026-11-16)

Three independent reviewers said "not yet" for both gate films; the last after both allowed revision rounds. The look is on the branch as experimental (not listed, not documented). Record: docs/superpowers/plans/2026-11-15-pa2-gate-report.md.

- Default: leave it parked; the other four looks (ledger, keynote, poster, marker) are not started.
- If the owner wants it finished, the shortest path from review 3: put the sun at the orbit centre (or draw a Sun to Earth line instead of an orbit), give the to-scale compare a reveal and one alignment axis, draw the sun one way everywhere, keep gold off orbit strokes, drop the quote card. The reviewers agree the films already hold together and that gold-only-for-light is the idea to keep.
- Copy of the vertical gate film (mine): "Now look up." beside a sun reads as advice to look at the Sun; change it before the film is shown to anyone.

## Code review of the cosmos look: items left with the parked look (2026-11-16)

A code review of the cosmos work (branch-review-C.md in the session folder: 1 critical, 11 important, 17 minor) is fixed only where it touches the shipped looks or test honesty. Left for whoever finishes the look:

- The contrast check does not see the sun, its bloom or any glow, so text over them is judged against the plain field (an end title over the sun disc could pass at about 1.05:1, by the reviewer geometry, not rendered).
- A film accent override changes the accent but not the glow and sun colours.
- Canvas shadowBlur is used at 7 sites (22 to 64 units), redrawn every frame; the plan asked for no blur filters and the guard test only checks a blur property.
- The end wordmark is marked furniture, so the 3x hero rule does not judge it.
- Open for the shipped looks too, in a file another fix owns: the hook-word review rule now counts only lines in the hero role (engine/review/frame.mjs); the plan says no review rule is loosened. To settle in the fix wave.

## Look regressions accepted in the code-review fix wave (2026-11-16)

The fix wave made three texts obey the 3x hero rule honestly instead of through a size-class or tag exemption. Two frames changed for the worse to the controller eye and have had no independent look review:

- Pop chart: the claim is now set at the hero size inside its lime plate, so it is a three-line lime block that competes with the highlighted numeral (kinds-pop, shot tests). Suggested redesign: the claim as a white headline in the stack face with no plate, the numeral as the only accent.
- Pop end ask: now usually one or two steps smaller than the 1.5x the second look review asked for.
- Desk compare (16:9): points are smaller or fewer so the title is 3x them.
- Default: ship as is; redesign the pop chart claim in the next look pass.

## Second-wave kinds: look review 2 leftovers (2026-11-17)

The second independent review of kinds-b-desk and kinds-b-pop gave ship after fixes for both, no shot failing, so the second-wave kinds pass their gate (the cosmos precedent). The race counter lag is a defect and is fixed next. Open fix items, default: fix in the next kinds pass: payoff holds of about 1 s or less; desk uses three yellows (amber in the dashboard picture) and unsystematic title sizes; the lower 35 to 45 percent empty in four desk shots; pop drifts between two display faces and lets some elements reach 76 to 77 percent of the height (keep text above about 72); ghost-grey first frames in pop; the full screenshot holds 2 s before the panel instead of pushing in; the map small and high in desk, low land contrast in pop; a scatter label at the origin collides; pop halftone turns the photo into a grey dot field; pop price title in the wide face crushes the chart. Report: .superpowers/sdd/2026-11-16-pa2-run2/gate-kinds-b-2.md.

## Transitions: final look review leftovers (2026-11-17)

Third independent review of cuts-desk and cuts-pop: desk ship after fixes, pop not yet because of one fail (ripple shows no rings); ripple is parked in pop after the two allowed revision rounds. Every direction now matches its narration. Open fix items, default: fix in the next cuts pass: several cuts fade while they move and ghost both shots mid-cut (curl, slide, match, warp, iris in desk; only dissolve and dip should); ripple, polka dots and glitch in pop pass through a near-black empty frame at 39 to 56 percent and read as two moves; wipe and cover edges vanish when both shots share a ground (give the moving edge a line or shadow from look data); push and slide double outlines (too few smear samples); match travels only about 35 px and blanks at 80 percent; wind mostly fades with edge streaks; window slices interleave letters; cross warp shows no warp in desk; the cube inner turns need their own strip; race rows now swap in one step after the label-lag fix (restore a glide when values cross). Report: .superpowers/sdd/2026-11-16-pa2-run2/gate-cuts-3.md.

## Refresh: final look review leftovers (2026-11-17)

Third review: dashboard ship after fixes; diagram ship after fixes with two desktop fails caused by the strict reading-floor opening rule, so that rule is reverted at desktop widths (fit whole, legibility warning unchanged) while the new styling stays. Open, default: fix in a later refresh pass: phone story pages open on the second node instead of the start (G3) and the pan arrows cover labels (G7); a dashed return line shows as a stray full-width rule at 390 (G6); a live click test that every More-menu control and folded legend key is reachable at 390 (G8, goes on the manual checklist); legend dots imply colour some nodes lack; press light nodes blend into the region; diagram colours ignore the theme; ink heading Q reads as underlined; thin stacked segments in three greys are hard to tell apart; West claimed but not marked; sparkline on one tile only; overview equals paper and brief equals editorial; dusk greys purple-tinted; line end points half-clipped; peak label tight under the top gridline. Report: .superpowers/sdd/2026-11-16-pa2-run2/gate-refresh-3.md.

## pop clipping example fires region-off-frame (2026-11-17)

The new region-off-frame finding (engine/review/regions.mjs) fires on pop's clipping example (81 units off at 16:9, 12.3 at 9:16); desk, cosmos and the reference films are clean. Default: fix pop's close-up framing in the cut-over pass, moving the affected pop frozen entries as an intended change listed in the commit.

## Page modules import only served paths (2026-11-17)

A render caught poster's flat.mjs importing shared/contrast.mjs, a path the page server does not serve; no test guards it. Default: add a test that every module under engine/ reachable from the page imports only paths the v2 server serves, in the cut-over pass.

## cosmos second-wave kinds: leftovers (2026-11-18)

The new cosmos kinds passed their look review (ship after fixes on both films). Open, default: fix in the release polish pass: the viral giants source line now sits at 1613 px, below the 1245 px platform line where app chrome may cover it (raise the band or shorten the rows); feed messages do not pop in and carry no sender structure; the list does not use the disc motif; the map's land contrast, label size, Antarctica strip and tall crop; code wraps one statement and its highlight boxes differ in size; the screen zoom leaves sliced pieces and a grey wash; the 16:9 timeline band does not fill; cosmos cuts are hard; the measured tall fill for eight shots. The tall photo keeps its sun only through the film's focus field, and its stair-stepped edges come from the 960x540 test photo, not the engine. Reports: .superpowers/sdd/2026-11-16-pa2-run2/gate-cosmos-b-1.md, c5-report.md, c6-report.md.

## Kinds parked in the four new looks (2026-11-18)

ledger, poster, keynote and marker are listed. Each parks the kinds below: they validate and render in that look, and the look does not list them (`experimental: true` on the kind in `engine/looks/<look>.mjs`). Default: leave them parked. The shortest path to finish each is given; every path ends the same way: drop `experimental`, add the kind to that look's gate films, review once, record it in the gate report.

- **ledger, number.** On 9:16 the desk number composition leaves 76 percent of the height empty (the 35 percent rule). Path: a tall number composition for ledger (figure, label and delta spread down the band).
- **keynote, number.** Same cause: 75 percent of the height empty on 9:16 (`keynote-kinds.test.mjs`). Path: the same tall number composition as ledger, with keynote's data.
- **poster, number.** On 9:16 in viral the digits do not fit at poster's numeral floor and the suffix leaves the platform safe zone. Path: a ruling on the bleeding numeral against ban 10, then a tall composition that keeps the suffix inside the safe zone.
- **poster, feed.** The tall reply card stood blank 1.3 to 2.2 s in the final gate review, the one 9:16 shot that failed. Path: put the reply plate and its first words on screen from the start of the shot, then re-review the 9:16 chat.
- **keynote, clipping.** On 9:16 the author caption enters ghosted on frame 0, the push runs past the picture's top into an empty paper band, and the caption card sits over a bar label inside the ringed region (ban 10). Path: a keynote clipping composition that fixes those three.
- **marker, feed.** The hand speed is 5243 units a second at 16:9 and 8892 at 9:16 against the 2600 cap: speech bubbles are many strokes in one sentence each. Path: fewer strokes per bubble (a plain box or a rule), or one bubble per sentence of narration.
- **marker, chart.** Race is parked in it as well, since a board can only change ranks by erasing. Hand speed is over the cap at both formats (9:16: 10948 units a second against 2600; 16:9: no time left): about 20 strokes in two sentences, and chart-draw gives no element a lesser form the hand can set at once. Path: give chart-draw a lesser "set at once" form for the elements the story does not need drawn, so the hand spends its time on the rest.
- **marker, number.** The review is clean, but at 9:16 the settled board uses 35 percent of the height where `marker-tall.test.mjs` wants 65. Path: a tall number composition (the same one as ledger and keynote can be the start).
- **marker, timeline.** At 16:9 three dates at three times the 60-unit minimum do not fit side by side. 9:16 is clean. Path: a stacked or two-row 16:9 layout for marker.
- **marker, free.** The review is clean at 16:9. The example's bar runs off the right of a 9:16 frame (the stroke-edge audit finds it), and free is author-placed. Path: give the example its own tall layout.
- **marker, screen and code** are excluded, not parked: a film asking for one is refused with the looks that support it. No path planned.

Records: the four look sections of `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` and the comments in `engine/looks/<look>.mjs`.
