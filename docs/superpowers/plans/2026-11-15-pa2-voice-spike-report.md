# Voice spike: per-word times for Kokoro narration (make-motion v2)

Date: 2026-11-15. Machine: Apple M4 Pro, 14 cores, 48 GB, Node 24.7.0, macOS. Every number is **measured** on this machine with the command named next to it, unless marked **estimated**. Nobody listened to the audio; the WAVs are in `.scratch/voice-spike/out/` for a listening pass.

## Verdict

**Rung 1 works.** The timestamped Kokoro export, run directly on `onnxruntime-node` 1.21.0 (the pinned runtime), gives per-token durations that reproduce the waveform length exactly. Rungs 2 and 3 were not needed.

**Raw times miss the target.** Audio starts before a word's first phoneme frame, by an amount that depends on context. A lead correction that depends on context meets the target. Its constants were fitted with the same instrument that tests them (see "Independent measurement").

Word-start error, predicted minus measured onset, in ms (`af_heart` voice, q8 model):

| Rule | Set | n | median abs | p90 abs | max | signed bias |
|---|---|---|---|---|---|---|
| Raw (first phoneme token's first frame) | all silence-adjacent starts, speed ×1 | 49 | **45** | 88 | 110 | +45 |
| Raw | mid-phrase s/ʃ starts, ×1 | 18 | **97** | 128 | 150 | +97 |
| Lead rule (below), fitted on even fixtures | held-out odd fixtures, ×1 | 22 | **5** | 20 | 32 | −1 |
| Lead rule | held-out odd fixtures, ×0.8 / ×1 / ×1.25 pooled | 64 | **8** | 24 | 42 | 0 |
| hexgrad mid-phrase rule (no fitting) | mid-phrase s/ʃ starts, ×1 | 18 | **7** | 16 | 50 | −7 |
| Lead rule fitted on `af_heart`, applied to `am_michael` | held-out odd fixtures, all speeds | 64 | **21** | 57 | 521 | −7 |
| hexgrad mid-phrase rule | `am_michael` mid-phrase s/ʃ, ×1 | 18 | **8** | 24 | 82 | −1 |

**Sample sizes.** The held-out n=64 is 22 word positions in 8 sentences, each measured at three speeds. At ×1 those 22 are 10 in-call words (8 of them after punctuation) and 12 call starts. The mid-phrase set is 8 sentences.

**Max values in the hundreds of ms** are measurement mispairs (final fricatives after a stop closure), explained under "Independent measurement".

**Commands:**

- Main sets: `node .scratch/voice-spike/tools/measure.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out`, then `node .scratch/voice-spike/tools/summarize.mjs .scratch/voice-spike/out/results_noise-40dB_d0.08_minrun0.1.json`.
- Second voice: the same `measure.mjs` with `--voice .scratch/voice-spike/rt/node_modules/kokoro-js/voices/am_michael.bin`, then `summarize.mjs .scratch/voice-spike/out/results_noise-40dB_d0.08_minrun0.1_am_michael.json --rule 42,-119,12`.
- Mid-phrase: `env PAIR_BY=hex node .scratch/voice-spike/tools/midphrase.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out <voice.bin> -35dB`.

## Files (Hugging Face `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`)

- Commit: `dd4401a9add81ac692d20e240d22ec9dda82cc29` (main on 2026-11-15; lastModified 2025-02-21).
- Licence: `apache-2.0`, from the README front matter and the API cardData at that commit.
- Base URL: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/dd4401a9add81ac692d20e240d22ec9dda82cc29/`

The table lists the downloaded files. The SHA-256 of each LFS file equals the LFS sha256 in the HF API listing, and every size equals the API size (`tools/fetch.mjs` checks both).

| File | Bytes | SHA-256 |
|---|---|---|
| `config.json` | 44 | `df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f` |
| `tokenizer.json` | 3497 | `77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34` |
| `tokenizer_config.json` | 113 | `be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20` |
| `onnx/model_quantized.onnx` (q8) | 92361055 | `c0c02b3299fd97c34ea92a98e6d41eaa1a739c8f77bf685aac34bd7b34c1132c` |
| `voices/af_heart.bin` | 522240 | `d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b` |

- The three JSON files are byte-identical to the current pins in `scripts/lib/voice.mjs`. Only the model file changes: the current pin is `fbae92…`, 92,361,116 bytes.
- `af_heart.bin` is byte-identical to the copy bundled in `kokoro-js/voices/`. Pin it only if kokoro-js is dropped.
- **Download:** 92.9 MB in all. It replaces the current 92.4 MB model, so the net extra is 0.5 MB, or nothing while kokoro-js stays.
- **Other quantisations at the same commit (not downloaded):** `model.onnx` 325.5 MB, `model_fp16` 163.2 MB, `model_q8f16` 86.1 MB, `model_uint8` 177.5 MB, `model_uint8f16` 114.2 MB, `model_q4` 305.2 MB, `model_q4f16` 154.6 MB. Their LFS hashes are in `dl/hf-api.json`.
- **Documentation:** the model card does not mention the `durations` output. Its meaning here rests on these measurements and on hexgrad's Kokoro source.

## Tensors (measured: `node .scratch/voice-spike/tools/inspect.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model/onnx/model_quantized.onnx`)

| Name | Direction | Type | Shape | Meaning |
|---|---|---|---|---|
| `input_ids` | in | int64 | [1, T] | 0 (pad `$`), one id per phoneme character, then 0. T ≤ 512 |
| `style` | in | float32 | [1, 256] | row `clamp(T−2, 0, 509)` of the voice file, read as float32 [rows, 256] |
| `speed` | in | float32 | [1] | one scalar per call |
| `waveform` | out | float32 | [1, N] | 24 kHz mono |
| `durations` | out | float32 | [1, T] | one per input token, pads included. These are **unrounded** frames, already divided by speed |

transformers.js 3.8.1 also returns both (`model(inputs)` → `{ waveform, durations }`; `node .scratch/voice-spike/tools/tf-probe.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model`). kokoro-js's `generate_from_ids` drops `durations`.

## Duration-to-word mapping (what an implementer writes)

1. **Phonemes.** Build the string exactly as kokoro-js 1.2.1 does: normalise, split on punctuation, phonemise the rest with `phonemizer` (`en-us`), join, then apply the post-replacements.
   - kokoro-js does not export this function (`m` in `dist/kokoro.js`), so transcribe it: about 60 lines, Apache-2.0.
   - `tools/kokoro-ts.mjs` (`normalize`, `toPhonemes`) is a transcription that matched kokoro-js's phoneme string on 21/21 fixture calls (`node .scratch/voice-spike/tools/verify-phonemes.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model`).
   - Phonemise the **whole clause**. Word-alone phonemisation changes the speech: `the` becomes `ðˈə` instead of `ðə`, `a` becomes `ˈeɪ` instead of `ɐ`, and `record` loses its context (`tools/phon-probe.mjs`).
2. **Tokens.** `tokenizer.json` deletes characters outside its 115-entry vocab, then gives one id per character, with pad 0 at both ends. Token k ↔ kept character k−1.
   - Stress `ˈ ˌ`, length `ː`, spaces and punctuation are tokens with real durations (for example `ˈ` in `bˈæk` = 4 frames).
3. **Frames.** `frames[k] = max(1, round(durations[k]))`. A frame is 600 samples (25 ms).
   - This is Kokoro `model.py` lines 108–110 at hexgrad/kokoro `dfb907a0`.
   - Checked: `Σ frames × 600 == waveform.length` on **81/81 calls** (×0.8, ×1, ×1.25) for `af_heart`, and on 81/81 for `am_michael`. Half-even and half-up rounding both pass.
   - Summing the floats (as HeadTTS does) drifts up to 121 ms at ×1 and 579 ms at ×1.25. **Use the integers.**
4. **Position.** `cum[0] = 0` and `cum[k+1] = cum[k] + frames[k]`. Token k spans samples `[cum[k]·600, cum[k+1]·600)`. Token 0 is the lead-in pad: 11–24 frames.
5. **Words.** The unit is the `parseSay` token: one text token can become several phoneme words (`2024`, `12,500`, `$4.50`, `3:30`).
   - Phonemise each token alone, only to **count** its phoneme groups.
   - Hand the clause's groups out in order by those counts.
   - If the counts do not add up, Levenshtein-align the per-token phonemes (stress ignored) to the clause phonemes and label each character (`spansByAlignment`).
   - Measured: counts matched on 26/27 calls; espeak linked `in the` into `ɪnðə`. The alignment agreed with the counts on 123/123 tokens where both applied.
6. **Start time: a lead correction that depends on context.** Decide the context from the phoneme string, never from the audio.

   | Context | Rule | Evidence |
   |---|---|---|
   | First word of a call | start = raw − (−119 ms + 12 ms × `frames[0]`) | Fitted. Lead is 61 / 117 / 25 ms at ×1 / ×0.8 / ×1.25, tracking pad length |
   | After punctuation (`…, ␣word`) | start = raw − 42 ms | Fitted: 42 / 47 / 38 ms across speeds. Equivalent: space-token start + 12 ms (space-start rule on the in-call set, 19 of 23 after punctuation: median 12 ms, p90 31 ms at ×1) |
   | Mid-phrase (`…letter␣word`) | start = raw − frames[space]/2 × 25 ms − 75 ms (hexgrad's rule) | Not fitted. s/ʃ check: median 7 ms (`af_heart`), 8 ms (`am_michael`). The few mid-phrase words in the main set agree: `small` raw +132 / hexgrad −18; `three` +170 / +45 (`am_michael` ×0.8) |

   Here raw = `cum[first phone token]`. hexgrad's published rule (`pipeline.py` lines 295–330: −3 frames plus half of each neighbouring space) applied **everywhere** overshoots by about 44 ms after punctuation and at call starts. That is why the rule above is split by context.
7. **Ends.**
   - Raw ends read +251 ms late before a pause, because phrase-final lengthening holds the pause inside the last phone (for example `ŋ` = 14 frames in `watching.`).
   - Capping the word's last token at 2 frames gave median 30 ms, p90 86 ms (×1, n=49). **Chosen after seeing the data; no held-out test.**
   - Mid-phrase ends can be taken as the next word's start; not measured.
8. **Joining calls.** Offset each call by the cumulative sample count of earlier calls plus inserted silences.

## Independent measurement, and its limits

- **Main method:** ffmpeg `silencedetect` (−40 dB, minimum silence 80 ms) on the final joined WAV. An onset is a `silence_end`. The detector never sees predictions. Onsets are matched to predicted word starts afterwards, by mutual nearest neighbour.
- **Two prediction-free filters:**
  - drop the end-of-file `silence_end`;
  - drop any onset whose sound lasts under 100 ms before the next silence (a word-final stop burst).
- **What the filters did at ×1 (`af_heart`):**
  - Removed all **7 mispairs** (up to 900 ms off), all EOF or final-stop artefacts.
  - Also dropped **one real onset**: `At` (clock fixture, ×1 and ×1.25, +63 ms before filtering). A short word before a stop closure looks like a burst. The filter can drop such words.
  - One mispair remains at ×0.8 (`scratch,`, affricate release, +451 ms), in a fitting fixture. For `am_michael`, final fricatives after a stop (`starts;`, `adapts.`, `notices.`, `scratch,`) pass the filter and appear as the −275 to −592 ms maxima.
- **Mid-phrase method:**
  - A second ffmpeg chain: `highpass=f=5000` twice, then `silencedetect` at −35 dB and 30 ms. Candidates are words starting with s/ʃ after a vowel or sonorant, chosen from the phoneme string.
  - At −50 dB the high band triggers on vowels; that detector is unusable.
  - Pairing by the raw prediction mispaired 5 of 15 words. Confirmed for `six` by reading the envelope (`tools/envelope.mjs`): high-band energy jumps from −55 to −35 dB at about 895 ms, hexgrad predicts 900 ms, raw predicts 1025 ms. The raw-paired match grabbed the later `ks` release.
  - Pairing by the hexgrad prediction therefore needs saying plainly: under that pairing **every** raw error is positive (+84 to +194 ms) for both voices. So the ~100 ms mid-phrase lead does not depend on the pairing choice; the 7–8 ms hexgrad figures do lean on it.
- **Why it is independent:** both methods read only waveform energy through ffmpeg. They share no code with the duration mapping.
- **Mutations: does the check catch a wrong mapping?**

  | Mutation | Speed | Mutant | Correct mapping | Verdict |
  |---|---|---|---|---|
  | Off by one token | ×1 | median 95 ms | 45 ms | killed |
  | Hop of 512 samples instead of 600 | ×1 | p90 664 ms | 88 ms | killed (median 38 ms, since early words barely move) |
  | Float accumulation (HeadTTS style) | ×0.8 | median 137 ms | 68 ms | worse |
- **Coverage:** 49 of 160 word starts at ×1 sit next to silence and are measured. Mid-phrase starts are measured only for s/ʃ onsets (18 per voice). Other mid-phrase onsets (vowels, nasals, stops) are not measured.
- **The threshold defines "start"** (single-constant held-out results, ×1):

  | Threshold | Raw bias | Held-out median / p90 |
  |---|---|---|
  | −30 dB | +40 ms | 15 / 44 ms |
  | −40 dB | +45 ms | 13 / 30 ms |
  | −50 dB | +61 ms | 19 / 34 ms |

  The constants therefore carry about ±10–15 ms of definitional uncertainty. Commands: `measure.mjs … --noise -30dB --speeds 1` and `--noise -50dB --speeds 1`.
- **Voice dependence:**
  - `am_michael` fitted on itself: in-call lead 54 ms (against 42), call-start lead −152 + 12 × pad (against −119 + 12 × pad).
  - With `af_heart`'s constants, `am_michael` scores median 21 ms, p90 57 ms: under the median target, but the constants are not voice-free.
  - The q8 model only; other quantisations not tested.

## Fixtures (`tools/fixtures.mjs`, 16 lines, real v2 path)

- **Content:** short and long lines, numbers (`2024`, `12,500`, `40 percent`, `3:30`), acronyms (`NASA API`, `JSON`, `XML`), money, emphasis, an aside, `(0.5)`, an ellipsis and an IPA hint. Mid-phrase set: 8 lines in `tools/midphrase.mjs`.
- **Synthesis path:** one call per sentence (as `voice.mjs`). A sentence is split further at:
  - a pause (silence inserted);
  - an emphasised word (0.12 s silence before it);
  - an aside (speed 1/0.85).

  The 0.12 and 0.85 constants were copied by hand from `timing.mjs` **as read at session start**. That file has since been modified by someone else (`git status`).

## Speed (measured, same command)

- **3.1–3.2 s of audio per second of wall time** at every speed and for both voices (×1 `af_heart`: 83.0 s of audio in 26.0 s).
- Conditions: q8, CPU, default ORT threads, warm session. Model load and phonemiser excluded.
- The current non-timestamped model was not timed. The files differ by 61 bytes, so the graphs are near-identical (**estimated**).

## What the narration marks can and cannot drive (`node .scratch/voice-spike/tools/probes.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model`)

| Mark | Possible with this export | Measured evidence |
|---|---|---|
| `(0.4)`, `...` pause | Yes: split the call, insert silence, offset the times | `Then,` after a 0.5 s pause: raw +64 ms (call-start class) |
| Per-segment speed | Yes, one scalar per call | One sentence took 152 / 135 / 125 / 112 / 106 frames at ×0.8 / 0.87 / 1 / 1.18 / 1.25 |
| Per-word speed inside a call | **No** | `durations` is an output only |
| `*word*` stress promotion | **Partly:** we edit the phonemes before tokenising | `is`: `ɪz` → `ˈɪz` went 100 → 150 ms, +2.9 dB. `onto`: `ˌ` → `ˈ` went 150 → 175 ms, −0.8 dB. `really` already has primary stress, so no change (300 ms). Most emphasised content words already have `ˈ`, so promotion does nothing for them |
| `*word*` as its own call | Possible but bad | `really` alone: 700 ms against 300 ms in its sentence. Speed 0.87 gives 775 ms |
| `_aside_` | Yes: own call at its own speed; level from ffmpeg | `quietly,` raw +22 ms |
| `[word](/ipa/)` | Yes: replace the token's phoneme span | `GIF`: espeak `ɡˈɪf`; injected `dʒˈɪf` synthesised as 250 ms. Characters outside the vocab are **silently dropped** (for example `˞`, `ɝ`), so validate at parse time |
| Emphasis level | Not from Kokoro | Only ffmpeg shaping (design 9.2 step 2) |

## Dependencies

Nothing new. Rung 1 ran on the packages already locked in `optional/voice` (`npm ci --ignore-scripts` of a copy of its package.json and lockfile):

- `onnxruntime-node` 1.21.0 (MIT): the darwin-arm64 binary ships in the tarball and loads with install scripts skipped;
- `phonemizer` 1.2.1 (declared Apache-2.0).

Calling ORT directly would allow dropping `kokoro-js`, `@huggingface/transformers` and `onnxruntime-web`. The current install is 420 MB: onnxruntime-node 208 MB, onnxruntime-web 91 MB, transformers 48 MB, kokoro-js 29 MB, phonemizer 2.6 MB (`du -sh`). The size of a new lockfile was not measured.

HeadTTS (`met4citizen/HeadTTS` `5ae6d5eb`) is MIT (its LICENSE file was read). It is a reference only and not needed. Its mapping accumulates float durations at 40 fps with a −10 ms start delta and its own G2P.

## Open risks

1. **phonemizer licence.** It declares Apache-2.0 but bundles an Emscripten build of eSpeak NG and its data. eSpeak NG is GPL-3.0-or-later to my knowledge; that is not verified from a file here, because no eSpeak NG licence text ships in the package. It is already in the current voice stack (kokoro-js → phonemizer). The owner should rule on it.
2. **The lead constants are fitted with the instrument that tests them,** per voice (`af_heart` against `am_michael` differ by 12–33 ms) and per onset definition (threshold table). The held-out split guards against overfitting only. The pad term was fitted on three speeds.
3. **The mid-phrase rule is checked only on s/ʃ onsets,** 8 sentences per voice, and the reported precision leans on pairing by that same rule. Raw being ~100 ms late mid-phrase holds under either pairing.
4. **Word ends are weak.** Raw ends run +251 ms late before pauses; the 2-frame cap was chosen after seeing the data.
5. **Splitting at emphasis and asides makes calls without final punctuation,** and each call restarts its prosody. Unlistened.
6. **Linked words** (`ɪnðə`): the boundary inside a linked group comes from the alignment and was not independently measured.
7. **Style rows are indexed by call length,** so very short calls get rarely used rows (see "really" alone).
8. **The tokenizer silently drops unknown characters,** which shifts every later word. Build ids from the kept characters and assert the count.
9. **The emscripten phonemizer installs a process-wide `uncaughtException` hook** that rethrows and prints its source. It masked a transformers.js error during this spike (exit 134). Isolate it.
10. **The 100 ms burst filter in the check drops short words before a stop** (`At`). This matters for any future regression test built on this method.

## Reproduce

All commands run from the worktree root:

```
node .scratch/voice-spike/tools/fetch.mjs .scratch/voice-spike/dl/model config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx voices/af_heart.bin
npm ci --ignore-scripts --no-audit --no-fund --prefix .scratch/voice-spike/rt
node .scratch/voice-spike/tools/inspect.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model/onnx/model_quantized.onnx
node .scratch/voice-spike/tools/measure.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out
node .scratch/voice-spike/tools/summarize.mjs .scratch/voice-spike/out/results_noise-40dB_d0.08_minrun0.1.json --verbose
node .scratch/voice-spike/tools/measure.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out --voice .scratch/voice-spike/rt/node_modules/kokoro-js/voices/am_michael.bin
node .scratch/voice-spike/tools/summarize.mjs .scratch/voice-spike/out/results_noise-40dB_d0.08_minrun0.1_am_michael.json --rule 42,-119,12
env PAIR_BY=hex node .scratch/voice-spike/tools/midphrase.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out .scratch/voice-spike/dl/model/voices/af_heart.bin -35dB
node .scratch/voice-spike/tools/midphrase.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model .scratch/voice-spike/out .scratch/voice-spike/dl/model/voices/af_heart.bin -35dB
node .scratch/voice-spike/tools/probes.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model
node .scratch/voice-spike/tools/tf-probe.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model
node .scratch/voice-spike/tools/verify-phonemes.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl model
node .scratch/voice-spike/tools/dump.mjs .scratch/voice-spike/rt .scratch/voice-spike/dl/model "We owe so much to you."
```

- `fetch.mjs` needs `dl/hf-api.json`, from `curl -sS -o .scratch/voice-spike/dl/hf-api.json "https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped?blobs=true"`.
- `rt/` holds copies of `optional/voice/{package.json,package-lock.json,index.mjs}`.
- The second `midphrase.mjs` line (no `PAIR_BY`) pairs by the raw prediction.
- Primary sources read:
  - hexgrad/kokoro `dfb907a0`: `kokoro/model.py`, `kokoro/pipeline.py`;
  - met4citizen/HeadTTS `5ae6d5eb`: `modules/worker-tts.mjs`, `headtts-node.json`, `LICENSE`;
  - kokoro-js 1.2.1 `dist/kokoro.js`.
