# motion.json reference: cross-field errors, with examples

Part of the reference indexed in ../schema.md.

## Cross-field errors (examples)
- `scenes[1].elements[0].id: duplicate id "title" (first used at scenes[0].elements[0].id); scene ids and element ids share one namespace; rename one`
- `scenes[0].elements[0].keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate`
- `scenes[0].elements[0].keyframes[2].t: 5 exceeds scene duration 3`
- `scenes[0].elements[0].keyframes[0].value: not animatable on text; animatable: opacity, x, y, scale, rotate (value needs "typing": true)`
- `texture.grain: must be <= 0.15`
- `scenes[0].elements[0].text: typing 100 characters takes 3.50s but scene "one" lasts 1s (it must finish a frame before the scene ends at 30 fps); shorten the text or lengthen the scene to at least 3.54s` (render.mjs asks again with its `--fps`, which replaces the spec's)
- `audio[0].src: unsupported audio format ".wma"; use mp3, wav, m4a, aac, ogg or flac`
- `audio[1].scene: scene "outro" not found; scenes: intro, chart`
- `audio[1].at: starts at 9s (scene "chart" + 4s), but the video ends at 8s`
- `cues[1].cue: must be one of "pop", "click", "whoosh", "chime", "impact", "riser", "swoosh", "typing", "drop", "ding", "kenney:click", "kenney:tick", "kenney:switch", "kenney:select", "kenney:confirm", "kenney:error", "kenney:open", "kenney:close", "kenney:pluck", "kenney:glass", "kenney:thud", "kenney:metal"; did you mean "chime"?` (a mistyped alias gets the same list and `did you mean "kenney:click"?`)
- `cues[0].at: 2s is past the end of scene "two", which lasts 2s; use a smaller at, or put the cue in a later scene`
- `cues[0].note: click has no pitch; note is for pop, chime, impact, drop and ding` (the same for `kenney:click`)
- `cues[0].follow: element "title" is not a typing text (set "typing": true on it, or drop follow)` (also `only typing takes follow`, and `cues[0].at: not with follow; the cue starts when "title" starts typing`)
- `cues[0].follow: "title" types past the end of scene "one"`
- `captions[0].src: cue 3 (line 9): end 00:00:04,000 is before start` (also `unsupported captions format ".txt"; use srt, vtt or json`, `no captions found; expected SRT or WebVTT cues …`, `cue 2 (line 5): no timing line such as "00:00:01,000 --> 00:00:02,500"`, `cue 1 (line 1): end 00:00:01,000 is not after start 00:00:01,000; make the cue last at least 1 ms`, `nothing would show: every word ends by 0.1 s into the video; start the track later with at, or fix the times in the file`, and for JSON `words[3]: end 1.2 is before start 1.5` or `words[0]: no "word" or "text"; give every word its text`)
- `captions[1]: on screen at 1.50s together with captions[0]; only one captions track can show at a time: move one with at or scene, or merge the files`
- `audio[0].fadeOut: fadeIn 1s + fadeOut 2.5s exceed the 3s the track plays (from 2s to the video end at 5s)`
- `scenes[0].elements[1].src: file not found: pic.png` (also `must stay inside the spec folder`, `hidden files are not allowed`)
- `scenes[0].elements[2].trimEnd: trimEnd 12 exceeds the clip length 8.5s` (also `trimStart: trimStart must be less than trimEnd`, `src: unsupported video format ".gif"; use mp4, mov, webm or m4v`, `src: ffprobe not found (needed to check video elements); install ffmpeg: node …/doctor.mjs --fix ffmpeg`)
- `scenes[0].elements[0].fill: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour) or a theme token: surface, line, accent, ...`
- `scenes[0].transition: crossfade needs a previous scene to fade in over; use "fade" or "none" on the first scene` (also `push needs a previous scene to come in over; …` for each of `push`, `slide`, `wipe`, `zoom`, `blur`, `iris`, `gl-ripple`, `gl-cube`)
- `scenes[1].transition.direction: must be one of "left", "right", "up", "down" for push; got "sideways"` (also `blur takes no direction; remove it`, `gl-ripple takes no direction; remove it`, `transition.duration: must be >= 0.1`; an unknown name lists every name with `; did you mean "gl-ripple"?`)
- `scenes[0].camera.keyframes[0].zoom: must be >= 0.5` (also `must be <= 3`, `keyframes[1].t: 1 is before previous keyframe t=2; keyframes must be sorted by t`, `keyframes[1].t: 4.5 exceeds scene duration 4`, `camera.zoomm: unknown property; allowed: keyframes, shake`, `shake.amount: must be <= 100`, `shake.seed: must be <= 7918`, `camera: this camera does nothing; give a keyframe that sets zoom, x, y or rotate away from rest (zoom 1, x 0, y 0, rotate 0), or a shake with an amount above 0`)
- `scenes[0].elements[1].cap: only valid on a line shape` (also `elevated: only valid on a rect shape`, `arrow: only valid on a line shape`)
- `scenes[0].elements[0].vegaLite.layer[1].data.url: remote data is not allowed — inline data.values`
- `background: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour)` (for `"art"` on the root: `; "art" is only valid as a scene background`)
- `scenes[0].elements[0].role: unknown role "heading"; did you mean "title"?`
- `scenes[0].elements[0].vegaLite.data.values: required — chart needs inline data.values`
- `cues[0].at: beat:40 does not exist; the file has 16 beats` (also `scenes[1].elements[0].keyframes[0].t: beat:12 is at 6.0s, outside scene "two" (4s to 5.5s)`, `audio[0].at: "beat:3" needs a root "beats" file`, `beats: data/music.beats.json: "beats" has no beats; list at least one`, `beats: must stay inside the spec folder`, `beats: file not found: data/music.beats.json`)
- `scenes[0].elements[0].text: unknown variable "citty"; declared: city, name` (also `vars.city: no default and the row gives no value`, `vars.Name: a var name starts with a lowercase letter, then letters, digits or _ (like city or firstName)`, `vars: declares 31 vars; at most 30`)
