# make-motion 2: Sound Cues, Music Bed and Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A version 2 film gets sound design placed from its own events, an optional music bed that ducks under the voice, and captions for shots whose narration is not already the picture.

**Architecture:** Cues are planned as data from the timeline's events (cuts, devices, emphasis, a number landing), asking the mode and the look which sound each event makes. A synthesised bed has an exact beat grid whose tempo and phase are fitted to the film's cuts. Voice, cues and bed are mixed in the one mastering chain that exists, with the bed ducked by an envelope computed from the word spans. Captions are scene-graph nodes produced by a caption style per look, fed by the same words that drive the picture.

**Tech Stack:** Node 20+, ffmpeg, the version 1 cue synth (`scripts/lib/cues.mjs`, read-only until cut-over) and beat detector (`scripts/lib/beats.mjs`), `node:test`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, sections 9.3 and 9.4 (and 9.2 item 3 for ducking). Builds on `docs/superpowers/plans/2026-11-15-pa2-voice-sync.md`.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/` unless they start with `docs/` or `bin/`.

## Global Constraints

- Version 1 files (`template/`, `scripts/lib/`, top-level `scripts/*.mjs`, top-level `test/*.test.mjs`) are not modified; version 2 may import `scripts/lib/cues.mjs`, `beats.mjs`, `ffmpeg.mjs`.
- No new npm package. No network.
- The timeline owns time: a cue, a beat and a caption fall where the timeline says. Sound code lives in `scripts/v2/sound/`; `engine/` stays free of Node-only code.
- Deterministic: the same film, seed and sidecar give the same cue list, the same bed samples and the same frames. Randomness only through the seeded generator in `engine/seeded.mjs`. No `Math.random`, `Date` or wall-clock time.
- Everything that depends on a look or a mode is data in that look or mode; no branch on a name. A new look or mode registers its sounds and caption style or validation fails with the usual `<json.path>: <message>` form.
- Audio is opt-in in a mode whose data says `cues: false` (pro) and on by default where it says `cues: true` (viral). `"sound": "off"` silences cues and bed in any mode; `"sound": "on"` enables cues in pro. An explicit `cues` list replaces the planned ones.
- One mastering chain: voice, cues and bed are mixed, then judged against the mode's loudness target exactly as the voice is today. A film with no voice but with cues or a bed gets an audio stream; a film with none of the three has no audio stream and renders as before.
- Levels (dB relative to the voice bus, named constants): cues −12, bed −18 at rest, bed ducked by a further 9 under any narrated word, with a 60 ms attack and 300 ms release, never louder than the voice.
- No film text reaches an ffmpeg argument; numbers go through the existing number formatter; child processes take argument arrays.
- A user's music file is read under the same rules as a user's voice recording after the Task 8 fix: a regular file inside the film's folder by real path, probed, plain audio containers only, a format whitelist on every ffmpeg call that opens it.
- Captions never cover the hero, stay inside the look's caption zone (and the mode's platform safe zone), are never smaller than the look's minimum text size, and leave when their words end. A statement shot shows its own words and gets no caption.
- Files under 800 lines, functions under 50 lines, named constants, immutable data, no swallowed errors. Tests first; a test written after its code needs a mutation row.
- `make.mjs` exit codes are unchanged (0, 1, 2, 130); `ok` matches the exit code.

## Review Focus

1. A cue or caption placed from an event that falls in a cut window, at time 0, or on the film's last frame.
2. A film with cues but no voice, a film with a bed but no cues, and a film with all three: each must master and report honestly, and a film with none must be byte-for-byte what it is today.
3. A bed whose fitted tempo cannot put cuts on beats (one cut, irregular cuts): it must still play, and the report must say how many cuts landed on a beat rather than claim sync.
4. Captions for a long narration line that needs several caption groups, an emphasised word at the edge of the zone, and merged words (one time for two tokens).
5. A user's music file that is a playlist, shorter than the film, or silent.

## File Structure

- `scripts/v2/sound/events.mjs`: `soundEvents(film, timeline)`: the film's events as data.
- `scripts/v2/sound/cues.mjs`: `planCues(film, timeline, { looks, modes })`, the cue list.
- `scripts/v2/sound/synth.mjs`: new cue voices and `renderCues(cues, outFile)`.
- `scripts/v2/sound/bed.mjs`: `fitBeatGrid`, `renderBed`, `musicInput`.
- `scripts/v2/sound/duck.mjs`: `duckEnvelope(words, …)`.
- Modify `scripts/v2/voice/master.mjs` (the mix), `scripts/v2/render.mjs`, `run.mjs`, `report.mjs`, `spec.mjs`, `engine/looks/*.mjs`, `engine/modes/*.mjs`.
- `engine/captions/index.mjs`, `engine/captions/lower.mjs`, `engine/captions/stack.mjs`: caption styles; `engine/registry.mjs` gains `captions`.
- Modify `engine/graph/film.mjs` (captions into the shot graph), `engine/review/frame.mjs` (caption rules).
- Tests: `test/v2/sound-*.test.mjs`, `test/v2/captions*.test.mjs`.

---

### Task 1: Events and the cue plan

**Files:** Create `scripts/v2/sound/events.mjs`, `scripts/v2/sound/cues.mjs`. Modify `engine/looks/desk.mjs`, `pop.mjs`, `index.mjs`, `engine/modes/pro.mjs`, `viral.mjs`, `index.mjs`. Test `test/v2/sound-cues.test.mjs`, and add to `looks.test.mjs`, `modes.test.mjs`.

**Interfaces:**
- `soundEvents(film, timeline) -> Array<{ kind: 'cut' | 'device' | 'emphasis' | 'land', t: number, shot: string, cut?: string, device?: string }>` in film seconds, sorted by `t`. `cut` is the first frame of the incoming shot; `device` is each `on` event's resolved time; `emphasis` is the start of each emphasised word's run (one per run); `land` is the moment a `number` shot's figure reaches its value.
- Look data gains `sounds: { cut: { cut, slide, punch, match }, device: { <device name>: <cue> }, emphasis, land }`, each value a cue name or `null`. Mode data gains `cues: boolean`. Both validated at registration; a look must name a value (or `null`) for every cut and device registered.
- `CUE_GAIN_DB = -12`, `MIN_CUE_GAP = 0.12` (seconds).
- `planCues(film, timeline, { looks, modes }) -> Array<{ t, cue, gainDb, pan }>`: nothing when the mode's `cues` is false and the film does not say `"sound": "on"`, or when it says `"sound": "off"`; the film's own `cues` list (`[{ at: <anchor>, cue }]`, anchors resolved like `on` events against the film) replaces the planned list; two cues closer than `MIN_CUE_GAP` keep the first; `pan` is 0.
- desk: cut `paper`, slide `paper`, punch `null`, match `null`; devices highlight `marker`, underline `marker`, circle `marker`, card `paper`, others `null`; emphasis `null`; land `click`. pop: cut `click`, slide `whoosh`, punch `impact`, match `null`; devices highlight `pop`, punch `impact`, others `null`; emphasis `pop`; land `sub`.

- [ ] **Step 1: Failing tests.** Events for a three-shot film (statement with an emphasised run, clipping with a highlight event, number) at the right times from a fixture timeline; `planCues` is empty in pro without `sound`, non-empty with `"sound": "on"`, empty with `"sound": "off"` in viral; an explicit `cues` list replaces the plan; two events 0.05 s apart give one cue; a look missing a `sounds` entry for a registered cut fails registration; a cue name that no synth knows is a validation error listing the known names.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 2: Cue voices

**Files:** Create `scripts/v2/sound/synth.mjs`. Test `test/v2/sound-synth.test.mjs`.

**Interfaces:**
- Consumes version 1 `cueWav({ cue, note, pan })` and `SAMPLE_RATE` (48000) from `scripts/lib/cues.mjs` for the cues it already has (`pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `drop`, `ding`).
- Adds, as pure sample generators seeded from the film seed: `sub` (a sine drop from 90 to 40 Hz, 0.35 s), `paper` (band-passed noise burst, 0.12 s), `marker` (a short squeak: filtered noise with a rising band, 0.18 s), and `riserTo(seconds)` (a riser whose peak is its last sample, so it can be placed to end on an anchor).
- `KNOWN_CUES` (frozen list of every cue name); `cueSamples(cue, { seed }) -> Float32Array` (mono, 48 kHz, peak at most 0.9); `renderCues(cues, { seconds, seed, out }) -> Promise<string>`: writes a stereo 48 kHz WAV of the film's length with each cue's samples added at `round(t × 48000)`, scaled by its gain, hard-limited at 0.98. A riser is placed so its last sample falls at `t`.

- [ ] **Step 1: Failing tests.** Every `KNOWN_CUES` name yields finite samples with a peak in (0.05, 0.9]; the same seed gives identical samples and a different seed differs for the noise cues; `renderCues` puts a click's first non-zero sample within one sample of `round(t × 48000)` and a riser's last non-zero sample within 2 ms of its anchor; overlapping cues never exceed 0.98; a cue past the end of the film is dropped and counted in the return value's `dropped`.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 3: The music bed

**Files:** Create `scripts/v2/sound/bed.mjs`. Test `test/v2/sound-bed.test.mjs`.

**Interfaces:**
- Spec shapes (validated in Task 5): `music: { bed: 'pulse' | 'drift' | 'tape', bpm?: number }` or `music: { src: 'track.mp3' }`.
- `fitBeatGrid(cutTimes, { bpm, tolerance = 0.04, seconds }) -> { bpm, offset, landed, cuts }`: searches tempo within `bpm × (1 ± tolerance)` and phase so that as many cuts as possible fall within one frame of a beat (ties: nearest the requested tempo); with no `bpm`, searches 84 to 132. `landed` and `cuts` are counts for the report.
- `renderBed({ bed, grid, seconds, seed, out }) -> Promise<string>`: a 48 kHz stereo WAV: `pulse` is a soft kick on each beat and an off-beat tick; `drift` is a two-note pad that changes on each bar; `tape` is a filtered-noise wash with a slow tremolo at the beat. A backing texture, not a composition. Peak at most 0.5; a 0.5 s fade in and a 1 s fade out.
- `musicInput(film, dir) -> Promise<{ file, beats: number[] | null }>` for `src`: the file checked and probed under the Task 8 rules (reuse that code; do not copy it), beats from `scripts/lib/beats.mjs` when detection succeeds, `null` otherwise. Shorter than the film: it ends where it ends, with a 1 s fade, and the report says so.

- [ ] **Step 1: Failing tests.** `fitBeatGrid` on cuts at 2.0, 4.0 and 6.0 s with bpm 120 lands all three with offset 0; cuts at 2.1, 4.1, 6.1 land all three with offset 0.1; irregular cuts land fewer and say so; one cut lands it; the bed's kick onsets are within 1 ms of the grid's beats (read the PCM); the same seed gives identical files; peak at most 0.5; fades present.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 4: One mix

**Files:** Create `scripts/v2/sound/duck.mjs`. Modify `scripts/v2/voice/master.mjs`, `scripts/v2/render.mjs`. Test `test/v2/sound-mix.test.mjs`, and add to `voice-master.test.mjs`.

**Interfaces:**
- `duckEnvelope(wordSpans, { depthDb = -9, attack = 0.06, release = 0.3, seconds }) -> Array<{ t, gainDb }>`: breakpoints for a gain curve that is `depthDb` while any word sounds, joining spans closer than `release`; `wordSpans` are film times.
- `master.mjs` takes optional `cues` and `music` tracks beside the voice: bed at `BED_GAIN_DB = -18` with the duck envelope applied, cues at their own gains, summed with the shaped voice before the static gain; the level judgement and report are unchanged in shape. With no voice, the mix is cues and bed alone and the loudness target is the mode's.
- `renderFilm` receives the sound plan from the run and produces `audio: { lufs, truePeakDb, note, cues: <count>, music: { kind: 'bed' | 'file', bpm, landed, cuts } | null }`.

- [ ] **Step 1: Failing tests.** `duckEnvelope` for two words 0.1 s apart is one dip; the bed measured under a word is 9 dB (within 1 dB) below the bed between sentences in the real mix (tone bed, tone voice); a cue's onset in the decoded MP4 is within one frame of its planned time; a film with cues and no voice has one audio stream; a film with nothing has none and its video bytes are unchanged; the voice-only path's existing tests still pass unchanged.
- [ ] **Step 2 to 4:** run red, implement, run green. Whole v2 suite once.

### Task 5: Spec, run and report

**Files:** Modify `scripts/v2/spec.mjs`, `scripts/v2/run.mjs`, `scripts/v2/report.mjs`. Test `test/v2/spec.test.mjs`, `test/v2/make-sound.test.mjs`.

**Interfaces:**
- Film fields: `sound: 'on' | 'off'`, `cues: [{ at, cue }]`, `music: { bed, bpm? } | { src }`. Unknown keys rejected with a did-you-mean; `bpm` 60 to 180; a `cue` must be in `KNOWN_CUES`.
- A new `sound` stage after `timeline` (it needs the timeline) and before `review`: plans cues, fits the bed, checks a music file. Its failures: an invalid film (exit 1) for the film's own mistakes, machine trouble (exit 2) for ffmpeg. Honours the abort signal.
- The text report prints one line for sound: cue count, bed kind and tempo, cuts on beats.

- [ ] **Step 1: Failing tests.** Validation of each field and each error; `--no-render` on a viral film reports the planned cue count; a pro film reports none; `"music": { "bed": "pulse" }` reports a tempo and `landed` of `cuts`; a playlist as `music.src` is an invalid film; an interrupt during the sound stage exits 130.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 6: Captions

**Files:** Create `engine/captions/index.mjs`, `lower.mjs`, `stack.mjs`. Modify `engine/registry.mjs`, `engine/looks/desk.mjs`, `pop.mjs`, `index.mjs`, `engine/modes/*.mjs`, `engine/graph/film.mjs`, `engine/review/frame.mjs`, `scripts/v2/spec.mjs`. Test `test/v2/captions.test.mjs`, `test/v2/captions-browser.test.mjs`.

**Interfaces:**
- `registries.captions`; a caption style is `{ summary, zone(ctx) -> rect in units, compose(words, ctx) -> nodes }`. Look data names its style: desk `lower` (label caps on a paper card at the bottom of the grid, up to two lines, the group swaps when its last word ends), pop `stack` (display face, flush left on the stack edge inside the platform safe zone, three words at a time, the spoken word in the accent). Mode data gains `captions: boolean` (viral true, pro false); the film field `captions: true | false` overrides.
- Captions are made for a shot only when it has narration and its kind does not show its own words (a kind declares `showsWords: true`; statement does). Words come from the timeline (measured or estimated). Caption text nodes carry `props.furniture` and role `caption`.
- Grouping: `captionGroups(words, { maxWords, maxChars }) -> groups`, breaking at sentence ends first, then at clause punctuation, never splitting a merged pair, never leaving a one-word group unless the sentence is one word.
- Review rules (mechanical): a caption outside its zone; a caption overlapping the hero's ink; a caption still on screen more than 0.3 s after its last word ends; an emphasised caption word clipped by the zone.

- [ ] **Step 1: Failing tests.** Grouping cases (a sentence end, a long clause, a merged pair, a one-word sentence); a clipping shot with narration gets caption nodes and a statement shot does not; each look's style places text inside its zone at 16:9 and 9:16; the four review rules each fire on a synthetic graph and none fires on the gate films with captions on; a film without captions is unchanged (snapshot of the node ids of both gate films before and after).
- [ ] **Step 2: Browser test**: real fonts, a caption with an emphasised word at the zone's edge is not clipped.
- [ ] **Step 3 to 4:** implement; run; whole v2 suite once.

### Task 7: Films with sound, measured and heard

**Files:** Create `references/examples/v2/sound-desk.json` and `sound-pop.json` (the voiced films plus `"sound": "on"`, a bed, and captions on where the mode does not default them). Record: append a "Sound" section to `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`.

- [ ] **Step 1: Controller renders** both films through `make.mjs`, records exit, findings, the report's `audio` (loudness, cue count, bed tempo, cuts on beats) and file size, views the caption frames on the sheets, and sends both MP4s to the owner.
- [ ] **Step 2: Owner's listening pass** on the checklist: cue level against the voice, the bed's ducking, whether the bed helps or distracts, caption timing.

## Not in this plan

The remaining shot kinds and looks (each new look brings its own `sounds` and caption style), the version 1 cut-over (which moves the cue synth out of `scripts/lib/`), and voices other than `af_heart`.
