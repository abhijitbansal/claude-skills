# Voiceover and audio notes

What the voice and audio scripts do, and why (the section of SKILL.md of this name). Copied from SKILL.md unchanged.

## Voiceover and audio notes

What the scripts do, and why:

- `voice.mjs` disposes the ORT session (`tts.model.dispose()`) in a `finally`; on failure it sets `process.exitCode` (never `process.exit()`) and lets the event loop drain. Exiting with a live session, or calling `process.exit()`, aborts with exit 134 / `mutex lock failed`. Keep it that way if you edit or wrap the script.
- Long narration is synthesised sentence by sentence: the text is split into sentences capped at 300 characters, each goes through its own `tts.stream()` call (with a closed `TextSplitterStream`, which `stream()` waits on forever if left open) and the clips are joined, because Kokoro truncates one call at about 27 s. `stream()` also reports the phonemes Kokoro spoke, which is what `--phonemes` prints and the sidecar stores. Pass the text with `--text-file`, never as a quoted argument.
- `amix` takes the first input's sample rate and channel layout, so every track is normalised with `aformat=sample_rates=48000:channel_layouts=stereo` before mixing and the encode pins `-ac 2`. Without it a mono 24 kHz voice listed first collapses stereo music.
