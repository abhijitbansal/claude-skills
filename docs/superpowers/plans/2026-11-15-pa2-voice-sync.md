# make-motion 2: Voice and Measured Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A version 2 film with a `voice` gets locally synthesised narration whose per-word times are read from the model, drive the picture, and are mixed into the MP4 at a mastered level.

**Architecture:** Narration is synthesised in a child process by calling the timestamped Kokoro export directly on `onnxruntime-node`; its `durations` output is mapped to word times by pure functions. The result is a WAV plus a sidecar of word times, cached by content hash; `buildTimeline` takes those words in place of its estimate. ffmpeg shapes, masters and muxes the voice. Sound cues, the music bed and captions are a separate later plan.

**Tech Stack:** Node 20+, `onnxruntime-node` 1.21.0 and `phonemizer` 1.2.1 (both already locked in `optional/voice`), ffmpeg, `node:test`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, section 9.1 and 9.2. Evidence for every constant below: `docs/superpowers/plans/2026-11-15-pa2-voice-spike-report.md` (the spike's report, 2026-11-15; its tools are in the gitignored `.scratch/voice-spike/tools/` and Task 9 moves the measurement into the repo).

**Depends on:** the whole-branch review fix wave being committed first. It changes `engine/script/timing.mjs`, the mode registry (pace read from mode data) and anchors (an anchor outside its shot is a validation error). Each task's implementer reads those files as they are, not as this plan remembers them.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/` unless they start with `docs/` or `bin/`.

## Global Constraints

- Version 1 files (`template/`, `scripts/lib/`, existing `scripts/*.mjs`, existing `test/*.test.mjs`) are not modified. Version 2 code may import from `scripts/lib/` (`pinned-file.mjs`, `optional.mjs`, `ffmpeg.mjs`, `loudness.mjs`).
- No new npm package and no version change. `onnxruntime-node` 1.21.0 and `phonemizer` 1.2.1 are today only transitive in `optional/voice`; Task 1 lists them as direct dependencies at exactly the locked versions, so version 2 does not rely on hoisting. `kokoro-js` and `@huggingface/transformers` stay until cut-over, when version 1 stops using them.
- The timeline owns time. Sidecar word times are relative to their own shot's narration start; the mix places each shot's samples at that shot's start on the timeline. Nothing else decides where a sound falls.
- The only voice name accepted is `af_heart` (the one pinned voice file). Kokoro `speed` comes from mode data (`voiceSpeed`: pro 1.0, viral 1.1) and stays inside 0.8 to 1.25, the range the start rule was measured on.
- The gate films `gate-desk.json` and `gate-pop.json` are the look baseline and are not changed. Voiced films are separate copies.
- Model: `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` at commit `dd4401a9add81ac692d20e240d22ec9dda82cc29`, licence Apache-2.0. Every file is fetched through `ensurePinnedFile` with its byte count and SHA-256:
  - `config.json`, 44 bytes, `df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f`
  - `tokenizer.json`, 3497 bytes, `77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34`
  - `tokenizer_config.json`, 113 bytes, `be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20`
  - `onnx/model_quantized.onnx`, 92361055 bytes, `c0c02b3299fd97c34ea92a98e6d41eaa1a739c8f77bf685aac34bd7b34c1132c`
  - `voices/af_heart.bin`, 522240 bytes, `d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b`
- Tensors: inputs `input_ids` int64 [1, T] (0, one id per kept phoneme character, 0; T at most 512), `style` float32 [1, 256] (row `clamp(T − 2, 0, 509)` of the voice file read as float32 rows of 256), `speed` float32 [1]. Outputs `waveform` float32 [1, N] at 24000 Hz mono, `durations` float32 [1, T].
- Frames: `frames[k] = max(1, round(durations[k]))`; one frame is 600 samples (25 ms). Integers only; never accumulate the floats.
- Word-start rule, context decided from the phoneme string only (ms; `raw` is the start of the word's first phoneme token):
  - first word of a call: `raw − (−119 + 12 × frames[0])`
  - after punctuation: `raw − 42`
  - mid-phrase: `raw − (frames[space before the word] / 2) × 25 − 75`
  - a start never precedes the previous word's start or the call's start.
- Word-end rule: a word followed directly by another word, with only a space between them, ends at that word's start; a word followed by punctuation, or last in its call, ends with its last phoneme token counted as at most 2 frames. (Amended in Task 3: ending at the next word's start across a comma ran a median 308 ms long on the fixtures, n=15, measured by the implementer.)
- Characters the phonemizer produces that are outside the model's vocab («», U+0329) are dropped, as kokoro-js does, and recorded; only a user's own IPA hint with an unknown character is an error. A narration token with no phonemes (a spaced dash) gets a zero-length span.
- Emphasis, the controller's default: no call split and no pause inside a clause; emphasis is a stress promotion in the phonemes where the word has no primary stress, a level lift in the mix, and the picture's own emphasis. Reason: every split restarts the voice's prosody (spike risk 5, unlistened), and a word synthesised alone ran 700 ms against 300 ms in its sentence. Design 9.2 item 1 asks for "a pause before it"; that variant is kept reachable through mode data `emphasisPause` (seconds, default 0; when above 0 the call is split before the word and that silence inserted), and the owner hears both in the listening pass.
- No network access except the pinned model files. Nothing about the user or the project in any request.
- `engine/` stays free of Node-only code: voice code lives in `scripts/v2/voice/`. No `Math.random`, `Date` or wall-clock time in anything that reaches frames or the sidecar.
- Determinism: the same film, seed and sidecar give the same frames. The sidecar is cached by a hash of everything that shapes it.
- Files under 800 lines, functions under 50 lines, named constants, immutable data, no swallowed errors. Validator errors read `<json.path>: <message>` with a did-you-mean.
- Tests first. Tests that need the optional voice install or the model are skipped with a stated reason when it is absent, and never download in CI.
- `make.mjs` exit codes stay 0 ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted; `ok` matches the exit code. A missing voice install is machine trouble with the install command in the hint.
- Licences stated in the plugin README licence table in the task that first uses them: the timestamped model (Apache-2.0) and eSpeak NG through `phonemizer` (GPL-3.0-or-later by the controller's reading, installed on demand, not redistributed; the owner chose to keep it and state it).

## Review Focus

1. Text a tokenizer drops (characters outside the 115-entry vocab, for example `˞` in an IPA hint): it must be a validation error at parse time, never a silent shift of every later word.
2. A `say` whose text token becomes several spoken words (`2024`, `12,500`, `$4.50`, `3:30`) or links with its neighbour (`in the`): each `parseSay` token still gets exactly one start and one end, in order.
3. A film whose voice cannot be made (optional package not installed, model download refused, hash mismatch, onnxruntime fails to load): exit 2 with a hint, no MP4 reported, no silent fall back to estimated times.
4. A narration longer than 512 tokens in one clause, or a shot with no `say`, or a `say` that is only a pause.
5. An anchor (`word:<n>`, `word:<text>`, `sentence:<n>`) in a voiced film resolves against the measured words, and a `hold` shorter than the measured narration is reported, not clipped.

## File Structure

- `scripts/v2/voice/model.mjs`: the pin (URL base, files, hashes), `ensureVoiceModel`.
- `scripts/v2/voice/phonemes.mjs`: `normalize`, `toPhonemes(clause, phonemize)`, `promoteStress`.
- `scripts/v2/voice/tokens.mjs`: `loadVocab(tokenizerJson)`, `toIds(phonemes, vocab)`.
- `scripts/v2/voice/words.mjs`: `framesOf`, `wordSpans`, `wordTimes` (the start and end rules).
- `scripts/v2/voice/calls.mjs`: `planCalls(sayTokens, mode)`: a shot's narration as synthesis calls and silences.
- `scripts/v2/voice/kokoro.mjs`: `openKokoro`, `speak(call)`.
- `scripts/v2/voice/worker.mjs`: the child-process entry (reads a job file, writes WAV and sidecar).
- `scripts/v2/voice/synth.mjs`: `synthesiseFilm(film, opts)`: cache, spawn, read back.
- `scripts/v2/voice/sidecar.mjs`: the sidecar's shape, read, write, validate; `fromWhisper`.
- `scripts/v2/voice/master.mjs`: ffmpeg argument builders for shaping, mastering and the mux.
- `scripts/v2/voice/accuracy.mjs`: the measurement script.
- Modify: `optional/voice/index.mjs`, `engine/script/timing.mjs`, `scripts/v2/spec.mjs`, `scripts/v2/run.mjs`, `scripts/v2/render.mjs`, `scripts/v2/report.mjs`, `bin/test/dependency-pins.test.mjs`, the plugin `README.md` licence table.
- Tests: `test/v2/voice-*.test.mjs`, fixtures in `test/v2/fixtures/voice/`.

---

### Task 1: Model pin and runtime exports

**Files:** Create `scripts/v2/voice/model.mjs`. Modify `optional/voice/index.mjs`, `bin/test/dependency-pins.test.mjs`, plugin `README.md` (licence table). Test `test/v2/voice-model.test.mjs`.

**Interfaces:**
- Produces: `VOICE_MODEL = { id, commit, base, files: [{ path, bytes, sha256 }] }` (frozen); `voiceModelDir(root?)`; `ensureVoiceModel({ dir, fetchImpl, log }) -> Promise<string>` (the directory; fetches only missing or wrong files, through `ensurePinnedFile`).
- Produces from `optional/voice/index.mjs`, added beside the existing exports: `export * as ort from 'onnxruntime-node'` and `export { phonemize } from 'phonemizer'`.
- `optional/voice/package.json` gains `"onnxruntime-node": "1.21.0"` and `"phonemizer": "1.2.1"` under `dependencies`; the lockfile is regenerated with `npm install --package-lock-only --ignore-scripts` in that folder. A test compares the lockfile before and after: the set of `name@version` entries is identical (only the root's dependency list changes). If npm would change any version, stop and report.

- [ ] **Step 1: Failing tests.** `VOICE_MODEL.files` has the five files with the byte counts and hashes from Global Constraints; `base` ends with the commit and a slash; with a fake `fetchImpl` serving wrong bytes for one file, `ensureVoiceModel` rejects naming that file and leaves no file at its path; with every file already present and correct, `fetchImpl` is never called.
- [ ] **Step 2: Run, see them fail.** `node --test plugins/portable-artifacts/skills/make-motion/test/v2/voice-model.test.mjs`
- [ ] **Step 3: Implement** `model.mjs`; add the two exports to `optional/voice/index.mjs`.
- [ ] **Step 4: Rule test.** In `bin/test/dependency-pins.test.mjs`, add: every Hugging Face URL in `scripts/v2/voice/` contains a 40-hex commit, and each pinned file has a 64-hex SHA-256 and a byte count. Show it failing on a temporary `resolve/main/` edit, then restore (report the mutation row).
- [ ] **Step 5: README licence table**: two rows as stated in Global Constraints.
- [ ] **Step 6: Run** the new test file and `node --test bin/test/dependency-pins.test.mjs`; both pass.

### Task 2: Phonemes and tokens

**Files:** Create `scripts/v2/voice/phonemes.mjs`, `scripts/v2/voice/tokens.mjs`. Test `test/v2/voice-phonemes.test.mjs`. Fixtures `test/v2/fixtures/voice/phonemes.json` (the 21 text and phoneme-string pairs the spike verified against kokoro-js; copy from `.scratch/voice-spike/out/` or regenerate with `tools/verify-phonemes.mjs`) and `test/v2/fixtures/voice/tokenizer.json` (the pinned 3497-byte file).

**Interfaces:**
- `normalize(text) -> string` and `toPhonemes(clause, phonemize) -> Promise<string>`: the same string kokoro-js 1.2.1 builds (normalise, split on punctuation, phonemise the rest as `en-us`, join, post-replacements). `phonemize` is injected: `(text, lang) => Promise<string[]>`. Transcribe from `.scratch/voice-spike/tools/kokoro-ts.mjs`, with an Apache-2.0 attribution comment naming kokoro-js 1.2.1.
- `promoteStress(wordPhonemes) -> string`: no primary stress `ˈ` in the word: a secondary `ˌ` becomes `ˈ`; with neither, `ˈ` goes before the first vowel. Already primary: unchanged.
- `loadVocab(tokenizerJson) -> Map<string, number>`; `toIds(phonemes, vocab) -> { ids: number[], kept: string, dropped: Array<{ char, index }> }` where `ids` is `[0, ...one per kept character, 0]`. It never throws: characters outside the vocab are dropped and recorded (amended by ruling; see Global Constraints). `unknownChars(text, vocab)` lists them, and treats the pad character `$` as unknown, for validating a user's hint.
- Words that normalisation reorders ("$5 million" is spoken "5 million dollars") cannot be placed one by one: those adjacent tokens share one merged span and one start and end (amended after the Task 3 review).

- [ ] **Step 1: Failing tests.** With a fake `phonemize` that returns recorded output, `toPhonemes` equals the recorded string for all 21 fixtures; `promoteStress('ɪz') === 'ˈɪz'`, `promoteStress('ˌɑːntuː')` starts with `ˈ`, `promoteStress('ɹˈɪli')` is unchanged; `toIds('bˈæk', vocab).ids.length === 6`; `toIds('a˞', vocab)` throws and its message contains `˞`; ids of a 600-character phoneme string: `toIds` does not truncate (the length rule belongs to Task 4).
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 3: Durations to word times

**Files:** Create `scripts/v2/voice/words.mjs`. Test `test/v2/voice-words.test.mjs`. Fixtures `test/v2/fixtures/voice/durations.json`: for at least 8 spike calls (include `2024`, `12,500`, `in the`, one after-punctuation word, one mid-phrase `s` word, one call at speed 0.8), the kept phoneme string, the float `durations`, the waveform sample count, the `parseSay` tokens and the per-token phoneme strings. Generate with `.scratch/voice-spike/tools/dump.mjs` (extend it in scratch if it does not print all of that).

**Interfaces:**
- `FRAME_SAMPLES = 600`, `SAMPLE_RATE = 24000`, `LEAD = { afterPunctuationMs: 42, callStartBaseMs: -119, callStartPerPadFrameMs: 12, midPhraseMs: 75 }`, `END_CAP_FRAMES = 2`.
- `framesOf(durations) -> number[]`.
- `wordSpans(kept, tokenPhonemes) -> Array<{ first: number, last: number }>`: token index ranges (into the ids, pads included) for each `parseSay` token; by group counts, and by alignment of the per-token phonemes to the clause when the counts differ (stress marks ignored).
- `wordTimes({ kept, frames, spans }) -> Array<{ start: number, end: number }>` in seconds from the call's first sample, by the start and end rules.

- [ ] **Step 1: Failing tests.** For every fixture: `sum(framesOf(d)) * 600 === sampleCount`; `wordSpans` returns one span per say token, ascending and not overlapping, including the `in the` linked case and the multi-word number tokens; `wordTimes` starts are non-decreasing and each `end >= start`; hand-computed cases for the three contexts using small synthetic inputs (give the arithmetic in the test); a word before the call's end has its last token capped at 2 frames; mutation checks written as tests: an off-by-one token shift changes a fixture's starts by more than 20 ms in the median.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 4: Narration to synthesis calls

**Files:** Create `scripts/v2/voice/calls.mjs`. Modify `scripts/v2/spec.mjs` (IPA hint validation). Test `test/v2/voice-calls.test.mjs`, and add cases to `test/v2/spec.test.mjs`.

**Interfaces:**
- Consumes `parseSay(say) -> { tokens, plain, trailingPause }` from `engine/script/say.mjs` (token fields: `text`, `emphasis`, `aside`, `pauseBefore`, `ipa`; read the file for the exact names) and the mode's pace from the mode registry.
- Mode data gains `voiceSpeed` (pro 1.0, viral 1.1) and `emphasisPause` (0 in both); a mode whose `voiceSpeed` is outside 0.8 to 1.25 fails the registry's own validation.
- `planCalls(sayTokens, { speed, emphasisPause }) -> Array<{ kind: 'speech', tokens: number[], speed: number, level: 'normal' | 'aside' } | { kind: 'silence', seconds: number }>`. A call ends at a sentence end, at a pause mark (which becomes a `silence`), and at the edge of an aside (aside speed is `speed * ASIDE_SPEED_FACTOR`, clamped to 1.25). With `emphasisPause` 0, emphasis never ends a call; above 0, the call ends before an emphasised word and a `silence` of that length follows. A call whose ids would exceed 512 is split at its nearest clause boundary (comma, semicolon, colon, dash); with none, `VoiceTextError` naming the shot.
- `ASIDE_SPEED_FACTOR = 1 / 0.85`.
- Spec: an `[word](/ipa/)` hint whose IPA has a character outside the vocab is a validation error at `shots[i].say` naming the characters. The vocab is read from the fixture-identical pinned `tokenizer.json` contents embedded as a frozen character list in `tokens.mjs` (so validation needs no download); a test proves the embedded list equals the pinned file's vocab.

- [ ] **Step 1: Failing tests.** `"One. Two."` gives two speech calls; `"Wait (0.4) now."` gives speech, silence 0.4, speech; `"Fast, _quietly_, done."` gives three speech calls with the middle at `speed * ASIDE_SPEED_FACTOR` and level `aside`; `"It *really* works."` is one call; a 700-token clause with a comma splits at the comma; without one it throws; the IPA validation error and its message; the embedded vocab equals the file's.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 5: Synthesis in a child process, sidecar and cache

**Files:** Create `scripts/v2/voice/kokoro.mjs`, `scripts/v2/voice/worker.mjs`, `scripts/v2/voice/synth.mjs`, `scripts/v2/voice/sidecar.mjs`. Test `test/v2/voice-synth.test.mjs`, `test/v2/voice-sidecar.test.mjs`.

**Interfaces:**
- Sidecar (JSON, version 1): `{ version: 1, model: { id, commit, file, sha256 }, voice, sampleRate: 24000, shots: [{ id, wav, seconds, sentences: [{ start, end, words: [{ text, start, end, emphasis, aside }] }] }] }`. One WAV per shot that has narration (`wav` is its file name beside the sidecar, `null` for a shot without `say`); every time is in seconds from the first sample of that shot's WAV, rounded to 1e-4. The sidecar holds no film-level time. `readSidecar(file)`, `writeSidecar(file, data)`, `validateSidecar(data, film)` (throws with the path of the first mismatch: shot ids, word counts and word texts must match the film's `say`).
- `openKokoro({ ort, modelDir, voice }) -> { speak({ ids, speed }) -> { waveform: Float32Array, durations: Float32Array }, close() }`.
- `voiceHash(film, { voice, modelSha256, lead }) -> string` (SHA-256 hex of a canonical JSON of each shot's `say`, the mode's pace, the voice name, the model hash and the timing constants).
- `synthesiseFilm(film, { outDir, voice, spawn?, log? }) -> Promise<{ dir, sidecar, cached: boolean }>`: files in `<outDir>/.voice/<hash>/` (`voice.json` and `shot-<index>.wav`); a cache hit reads and validates the sidecar and does not spawn; a miss spawns `node worker.mjs <job.json>` with `execFile` (no shell), and fails with the worker's last stderr line on a non-zero exit. Partial files are written under a temporary name and renamed.
- The worker loads the optional package through `importOptional` (the same install hint as version 1), calls `ensureVoiceModel`, runs each call, concatenates a shot's waveforms and silences, applies Task 3, and writes one 24 kHz mono 16-bit WAV per narrated shot and the sidecar. It adds no silence between shots: where a shot sits in the film is the timeline's business.

- [ ] **Step 1: Failing tests (no model needed).** Sidecar round trip and each `validateSidecar` rejection; `voiceHash` changes when a `say`, the voice or a lead constant changes and not when an unrelated field (`look`) changes; with a fake `spawn`, a miss spawns once with an argv array whose elements contain no shell metacharacter interpretation (assert `execFile`-style call, no `shell: true`), and a second call is a cache hit with zero spawns; a worker exit code 1 rejects with its stderr line; a film with a shot without `say` gives that shot an empty `sentences` list.
- [ ] **Step 2: Failing integration test, skipped without the optional install and the model present locally** (`test.skip` with the reason and the install command; never downloads): synthesise the three-shot fixture film (its middle shot has no `say`); each WAV's sample count equals its shot's `seconds` times 24000; every word has `end >= start` (a spaced dash is zero-length) and lies inside its shot's WAV; the middle shot has `wav: null`.
- [ ] **Step 3 to 4:** implement; run both test files.

### Task 6: The film takes measured words

**Files:** Modify `engine/script/timing.mjs`, `scripts/v2/spec.mjs`, `scripts/v2/run.mjs`, `scripts/v2/report.mjs`. Test `test/v2/timing.test.mjs` (add), `test/v2/spec.test.mjs` (add), `test/v2/make.test.mjs` (add).

**Interfaces:**
- Spec: optional film field `voice`: `{ "name": "af_heart" }` (synthesise; any other name is an error listing the accepted one) or `{ "src": "vo.wav", "words": "vo.json" }` (the user's file, Task 8). Unknown keys rejected with a did-you-mean. Absent: silent film, estimated times, as today.
- `buildTimeline(film, { fps, modes, words })`: `words` is the sidecar's `shots` list or undefined. With words, each shot's word times come from the sidecar (relative to the shot's start), its narration length is its last word's end, and the timeline's `timed` is `'measured'`; without, behaviour is byte-identical to today (`'estimated'`).
- A shot whose `hold` is shorter than its measured narration: mechanical finding at `shots[i].hold` ("hold 2 s is shorter than the narration, 3.4 s").
- Anchors are resolved against the timeline that is used. For a voiced film the anchor-outside-its-shot error is raised after the measured timeline is built (an anchor valid on estimated times can fall outside on measured ones, and the reverse); it is reported as an invalid film, exit 1, with the usual path form. State in the report where the check runs.
- `make.mjs` stages become validate, voice (only when the film has `voice`), timeline, review, render. The report gains `voice: { cached, seconds, model } | null`, and `timed` reports what was used. A voice stage failure is exit 2 with the hint; nothing is rendered.

- [ ] **Step 1: Failing tests.** Timeline with a words fixture places `word:<n>` anchors at the measured times; without words the timeline deep-equals the current one for both gate films (snapshot the current output first, in the test, from the function itself with `words: undefined`); the `hold` finding; spec accepts both `voice` shapes and rejects `{ "nam": "af_heart" }` with a did-you-mean; `make.mjs --no-render` on a voiced film with a fake synthesiser reports `timed: "measured"`; with a synthesiser that throws the install hint, exit 2 and `ok: false`.
- [ ] **Step 2 to 4:** run red, implement, run green. Run the whole v2 suite once at the end of the task.

### Task 7: Shaping, mastering and the mux

**Files:** Create `scripts/v2/voice/master.mjs`. Modify `scripts/v2/render.mjs`. Test `test/v2/voice-master.test.mjs`.

**Interfaces:**
- `LEVELS = { emphasisDb: 2, asideDb: -3 }`; mode data gains `loudness: { lufs, truePeakDb, lra }` (pro −16 / −1.5 / 11, viral −14 / −1 / 9), read from the mode registry.
- `shapingFilter(sidecar) -> string`: one `volume` filter per emphasised word and per aside, enabled between its start and end with a 20 ms ramp on each side (ffmpeg `volume=...:enable='between(t,a,b)'`, or `afade`-style envelope; the implementer chooses and states it).
- `masterArgs({ wav, out, filter, loudness, measured? }) -> string[]`: high-pass at 80 Hz, a gentle compressor, a de-esser, then `loudnorm` (first pass measures and prints JSON, second pass applies the measured values). Reuse `scripts/lib/loudness.mjs` for parsing the first pass if its interface fits; otherwise say why not.
- `voiceTrackArgs({ shots, timeline, out }) -> string[]`: builds the film's voice track by placing each narrated shot's WAV at that shot's narration start on the timeline (`adelay` per input in whole samples, then `amix` without normalisation), padded to the film's length. Shaping times are the sidecar's word times plus the same shot starts.
- `renderFilm` muxes the mastered voice into the MP4 as AAC 48 kHz, 160 kbit/s, without re-encoding video, and reports `audio: { lufs, truePeakDb } | null`.
- No film value reaches a shell: arguments are arrays; times are numbers formatted by the builder.

- [ ] **Step 1: Failing tests.** `shapingFilter` for a sidecar with one emphasised word and one aside contains exactly two gain stages with the right decibel values and times; `masterArgs` contains the mode's targets and never a film string; an argument injection attempt (a word text containing `';` and a quote) does not appear in any argument; with a fake `ffmpeg` runner, the two passes run in order and the second receives the first pass's measured values.
- [ ] **Step 2: Alignment test, no model, skipped only without ffmpeg.** A fake synthesiser writes per-shot WAVs that are silent except for a 5 ms click at each word start, for a film whose middle shot has no `say` and whose first shot has a long `hold`. Build the voice track with the real timeline; detect the clicks (read the PCM, find samples above a threshold); each click lies within one frame (1 / fps) of its word's time on the timeline. Mutation row: adding 0.2 s to one shot's offset fails it.
- [ ] **Step 2b: Integration test, skipped without ffmpeg or the fixture WAV**: master a short generated tone-burst WAV with a fixture sidecar; `ffprobe` shows one AAC stream of the same duration within 50 ms in the muxed file; measured integrated loudness is within 1 LU of the target.
- [ ] **Step 3 to 4:** implement; run.

### Task 8: A user's own voice file

**Files:** Modify `scripts/v2/voice/sidecar.mjs`, `scripts/v2/voice/synth.mjs`, `scripts/v2/run.mjs`. Test `test/v2/voice-external.test.mjs`. Fixture: a small Whisper word-timestamp JSON.

**Interfaces:**
- `fromWhisper(json, film) -> sidecar`: maps Whisper `segments[].words[] { word, start, end }` onto the film's `say` tokens in order, tolerant of case and punctuation; a word-count mismatch in a shot is a validation error at `voice.words` naming the shot and both counts. A version 1 sidecar from version 2 itself is accepted as is.
- With `voice.src`, no synthesis: the file is decoded by ffmpeg to the mastering input; paths are resolved inside the film's folder (reject a path that leaves it, same rule as assets).

- [ ] **Step 1: Failing tests.** The mapping on the fixture; the mismatch error; a `src` of `../x.wav` is rejected; a voiced film with `src` reports `timed: "measured"` and `voice.model: null`.
- [ ] **Step 2 to 4:** run red, implement, run green.

### Task 9: Accuracy measured, films voiced

**Files:** Create `scripts/v2/voice/accuracy.mjs`, and `references/examples/v2/voiced-desk.json` and `voiced-pop.json` (copies of the gate films plus `"voice": { "name": "af_heart" }`; no test may require them to render). Test `test/v2/voice-accuracy.test.mjs`. Record: append a "Voice" section to `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`.

**Interfaces:**
- `node scripts/v2/voice/accuracy.mjs [--voice af_heart] [--json]`: synthesises the 16 spike fixtures (copy `.scratch/voice-spike/tools/fixtures.mjs` into `test/v2/fixtures/voice/accuracy-fixtures.mjs`) through the real version 2 path, detects onsets with ffmpeg `silencedetect` at −40 dB and 80 ms on the joined WAV (dropping the end-of-file onset and any onset whose sound lasts under 100 ms), pairs by mutual nearest neighbour, and prints `{ n, medianMs, p90Ms, held: { n, medianMs, p90Ms } }` where `held` is the odd-numbered fixtures. Exit 1 when the held-out median exceeds 40 ms.
- Mid-phrase check, reported separately as `midPhrase: { n, medianMs, p90Ms }`: because emphasis no longer splits a call, emphasised words are mid-phrase and silence detection cannot see them. Port the spike's high-band method (`.scratch/voice-spike/tools/midphrase.mjs`: `highpass=f=5000` twice, `silencedetect` at −35 dB and 30 ms, on words that start with s or ʃ after a vowel or sonorant, chosen from the phoneme string), and include emphasised s/ʃ words in the set (add at least 6 such lines to the fixtures). Print how the pairing was done; the report says this check covers s/ʃ onsets only.
- The unit test covers only the pairing and statistics functions on synthetic numbers. The real measurement is run by the controller.

- [ ] **Step 1: Failing unit tests** for pairing (a mispair is not counted twice; an unpaired onset is dropped) and for median and 90th percentile.
- [ ] **Step 2: Implement.** Run red then green.
- [ ] **Step 3: Controller runs** `node plugins/portable-artifacts/skills/make-motion/scripts/v2/voice/accuracy.mjs --json` and both voiced films, and renders `voiced-desk` a second time with `emphasisPause` 0.12 through a test mode for the listening comparison; records the numbers, the command, the machine and the model hash in the gate report; states plainly that the lead constants were fitted with the same onset method on the even fixtures, on one voice, and that nobody has listened yet.
- [ ] **Step 4: Owner's listening pass** goes on the manual-test checklist: the two voiced MP4s, with what to listen for (clipped word starts, a restart of prosody at an aside, an emphasised word that sounds no different).

## Not in this plan

Sound cues from events, the synthesised music bed and ducking, captions, the remaining voices' pins, and removing `kokoro-js` and `@huggingface/transformers` from `optional/voice` (cut-over). Each is in the design's order of work, steps 4 (second half) to 6.
