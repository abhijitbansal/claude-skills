# motion.json reference

Validate with `node scripts/validate.mjs motion.json`. Unknown properties are errors (with did-you-mean). All coordinates are canvas pixels (origin top-left); an element's `x`,`y` is its **centre**.

The reference is split by topic, one file each, so a single read or search stays small. Open the one you need:

- `schema/root.md`: root fields, variables, beats, viral mode and theme
- `schema/scene.md`: a scene: its fields, transitions and camera
- `schema/audio.md`: audio tracks, texture and sound cues
- `schema/elements.md`: elements: text, counter, shape, image, chart, video, lottie, group, code and their notes
- `schema/blocks.md`: blocks: the parameterised building blocks and their params
- `schema/keyframes-captions.md`: keyframes and captions
- `schema/errors.md`: cross-field errors, with examples
- `schema/cli.md`: the command line: every script and its flags
