# portable-artifacts 2.0 design: make-motion 2 (editorial art direction, canvas engine, script-first films) and a plugin refresh

Date: 2026-11-15. Branch: `worktree-New-Motion`. Status: awaiting owner approval.

Paths are relative to `plugins/portable-artifacts/` unless they start with `docs/` or `tools/`. The cache-clock keep-warm work the owner added is a separate project with its own design document.

## 1. Intent

portable-artifacts turns a prompt into a dashboard, diagram, explainer, 3D scene or video by having a model write one small JSON spec that deterministic scripts build. The premise holds. The output does not yet look like the work of a designer: make-motion draws flat rectangles and centred text on a dark page, its stories are block templates, and its voiceover is synced only at sentence level and only in hand-drawn scenes.

The owner wants version 2 to be a showreel, designed the way a creative director would design it:

- make-motion looks like the editorial motion graphics people recognise (the paper-and-collage explainer, the newsroom chart film, the product launch film, kinetic type, short-form captions). **Typography, graphic devices and layout lead.** Effects are supporting texture.
- It tells a story a new way.
- A frontier model writes the plan and the spec; a cheap model runs the mechanical build loop, on Claude Code, Codex and Copilot.
- The user picks a mode: full-on viral, or polished and professional.
- Voice and picture are tightly synced, and the voice has tone, modulation and emphasis.
- Every dependency is evaluated for security and trimmed where not needed.
- The other four skills get a visual refresh.

## 2. Decisions the owner made

| Decision | Choice |
|---|---|
| Scope | make-motion rebuilt in depth; the other four skills refreshed visually; all five audited |
| Compatibility | Clean break. make-motion gets a version 2 spec; version 1 specs are refused |
| Stage | Full canvas scene graph (chosen over my recommendation of DOM plus canvas layers) |
| Timing | Script-first: shots carry narration, durations come from the voice, motion is pinned to spoken words |
| Voice | Local only; one more on-demand model download is allowed |
| Creative direction | Editorial motion graphics in the manner of the well-known explainer channels and other popular styles; typography, design and graphics first |
| Looks | The owner trusts my direction; first seen in the rendered films |
| Showreel | Two films about portable-artifacts itself: one viral 9:16, one professional 16:9 |
| Billed evals | Claude Code only, about ten prompts. Codex and Copilot are verified from docs and install tests and reported as not run live |
| Also review | HyperFrames, raea and comparable code-driven video frameworks (section 4) |

Everything else in this document is my call unless marked otherwise.

## 3. Goals, non-goals, anti-goals

**Goals**

1. A frame paused anywhere in a film looks composed: a grid, a clear hero, real scale contrast, one emphasis system, texture with a reason.
2. A film reads as directed, not assembled: a hero object that survives cuts, graphic devices that point at what the voice is saying, type that moves by word and by sense.
3. Motion lands on the spoken word. Measured median offset between a word's onset in the rendered audio and its anchored visual event is 40 ms or less on a fixture set.
4. Two modes that differ in every register, and seven looks, each a complete art direction.
5. The session model directs; a cheap model operates. A host that cannot delegate still produces the same film.
6. Fewer dependencies in make-motion, and no unpinned or unhashed download anywhere in the plugin.
7. The other four skills look like they come from the same studio as the films.

**Non-goals**

- Rendering version 1 `motion.json` files, or an automatic migrator.
- Cloud voices, cloud image services or any new network call. make-explainer's existing opt-in `--image-api` is untouched.
- A general-purpose animation tool or free code authoring (section 4).
- Character animation, a stock footage or illustration library, real 3D type.
- Lottie playback (removed, section 11).
- Imitating a named publisher's brand. The looks draw on genres; none uses a publisher's name, logo, proprietary typeface or trade dress as its identity.

**Anti-goals** (failures even if everything technically works)

- A template with a nicer background.
- Seven looks that differ only in colour.
- A voice whose emphasis is claimed but was never listened to. I cannot hear; tone and emphasis go on the manual checklist and are reported as unverified until the owner listens.
- A routing split whose correctness depends on a host choosing to delegate.
- README claims carried over from version 1 without being re-measured.

## 4. Approaches considered

**Stage**

| Approach | Trade-off | Outcome |
|---|---|---|
| A. DOM stage plus seeded canvas layers | Keeps the DOM-measured audits, Vega and shiki as they are; lower ceiling for type and continuity | My recommendation; not chosen |
| B. Richer DOM and SVG only | Lowest risk, lowest ceiling, slow SVG filters at 1080p | Dropped |
| C. Full canvas scene graph | Highest ceiling; every element, the audits, charts and code view are rebuilt on canvas | **Chosen by the owner** |

C pays for itself in three ways: the engine lays out every glyph itself, so typography and the audits are exact instead of asked of the browser; charts animate natively; and Vega, anime.js and lottie-web leave the dependency tree.

**Timing**

| Approach | Trade-off | Outcome |
|---|---|---|
| Script-first | Durations and anchors come from the voice; the spec reads as a script | **Chosen by the owner** |
| Seconds-first with optional anchors | Smaller change; story stays templated | Dropped |

**JSON spec or model-written code** (reviewed at the owner's request)

| Project | Licence | Authoring | What it teaches |
|---|---|---|---|
| HyperFrames | Apache-2.0 | HTML with GSAP, captured from headless Chrome | Needs about 146 lint rules to keep free HTML deterministic and safe; a strong visual review loop; a searchable registry; shader transitions; caption styles. Its registry items load GSAP and fonts from CDNs, so they are not offline |
| raea | FSL-1.1 (not OSI) | React compiled to a Rust and GPU engine | Everything drawn is queryable as data, so an agent can inspect a frame. Licence rules out reuse |
| Remotion | Company licence (not OSI) | React | In-browser WebCodecs render; not reusable |
| Motion Canvas, Revideo | MIT | TypeScript generators on canvas | Canvas scene graphs work; no agent support |
| VideoFlow, Editly | Apache-2.0, MIT | JSON specs | The JSON route is established; shader effects over a 2D frame |

Verdict: the closed JSON spec stays. Word-level sync, the audits and the cheap operator all depend on a vocabulary the engine understands; free code would need a lint wall to get back what the spec gives for nothing. Adopted from the review:

1. A three-sheet visual review written to a notes file (section 8.5).
2. Storylines before specs for longer films (section 6.5).
3. A queryable catalogue: `make.mjs --list kinds|moves|cuts|captions|looks|devices` (section 12).
4. Shader cuts on the gl-transitions contract (MIT), about ten ported with their notices (section 8.4).
5. Caption styles as a registry fed by the word sidecar (section 9).

Deferred, not in scope: a per-shot fragment shader written by the model, a sandboxed draw function, audio-reactive nodes, and replacing the ffmpeg transcode.

**Renderer host** (my call): the canvas engine stays in headless Chromium. One runtime serves preview and render, WebGL2 is available for the post pass, bundled fonts load as today, and no native dependency is added.

### Spike result (measured, 2026-11-15)

`.scratch/spike/canvas-spike.mjs` (throwaway, not committed), Playwright 1.64.0 headless shell on an Arm Mac, 1920x1080, a 2D scene plus a WebGL2 post pass:

| Measure | Result |
|---|---|
| WebGL2 with the default launch flags | Available; renderer string is SwiftShader |
| Same frame, 2 launches x 2 pages, after an out-of-order seek | PNG and raw pixel hashes equal |
| Same test with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` | Hashes differ on every page. Do not pass these flags |
| Post pass (12-tap bloom, chromatic offset, grain, vignette) | 27 ms per frame |
| `page.screenshot` PNG | 221 ms per frame on a grainy frame; JPEG quality 95 is 30 ms |
| In-page WebCodecs encode (draw, post pass and encode) | 65 ms per frame; H.264, VP9 and AV1 reported supported |

Consequences: default flags; two capture paths (section 8.6); same-machine repeatability is claimed, cross-machine equality is not, as today.

## 5. Art direction

This section is the heart of the redesign. The research behind it found few published specifications for the reference styles, so the systems below are my direction, built from the genres and confirmed only where a source is cited in the research notes. They are judged by the rendered films.

### 5.1 Looks

A **look** is a complete art direction: typefaces, palette, texture, the styling of every graphic device, a layout grid and a motion grammar. A film names one look. Seven ship, in priority order (`cosmos` is built third, right after the two showreel looks); the first two carry the showreel and are finished first. `cosmos` has no characters: the genre's mascots and illustrated figures are out of scope, and its scenes are built from shapes, scale and light. A look that does not reach the bar of those two is cut, not shipped weak.

| Look | Genre | Mode | Type | Palette and texture | Signature devices | Motion grammar |
|---|---|---|---|---|---|---|
| `desk` | Editorial paper collage | pro (default) | Display serif with optical size and soft axes; grotesque text; mono caps labels | Warm paper, near-black ink, one highlighter yellow, one red. Paper grain, soft contact shadows | Photo cut-outs with a white keyline and offset shadow; highlighter swipe; marker circle, underline, arrow and bracket; clipping zoom with a highlighted sentence; taped and torn cards | Camera looks down at a desk and slides between items. Hard cuts. Hand devices step at 12 fps ("on twos"); everything else is smooth |
| `pop` | Short-form captions and collage | viral (default) | One heavy condensed sans in caps, with width as an animated axis | Saturated field, black, white, one acid accent. Halftone and sticker edges | Word-pop captions with the spoken word recoloured; punch-in zooms; stickers and cut-outs with thick outlines; big numerals; arrows that jab | Fast, overshoot, a change at least every 3 s, cuts on the beat |
| `ledger` | Newsroom data film | pro | Narrow grotesque for labels and numbers; text serif for annotations | White or off-white, one signal red, greys, a short categorical set. No texture beyond a hairline grid | A coloured tag and thin rule at top-left with the claim as a title; direct labels instead of legends; dim everything but the series being discussed; an annotation with a leader line landing on the spoken figure | Lines draw left to right, bars grow from the baseline, eased and unhurried. Cuts are plain |
| `keynote` | Product launch film | pro | One neutral sans from hairline to black; weight sweeps on emphasis | Near-black or near-white, soft mesh gradient, one brand accent. Fine grain | A huge headline; a weight sweep across a word; product screens as cards with depth and parallax; a light sweep over type; a zoom to a UI region with a ring | Long ease-out settles, continuous camera, mask reveals, match cuts |
| `poster` | Kinetic type and cut paper | viral or pro | A grotesque with a wide width range, set flush left on a strict grid; type used as image | Two or three flat colours and paper white. Flat cut-paper shapes, slight misregistration | Words that scale to fill the frame; rotated and stacked lines; cut-paper bars and circles that wipe as transitions; a giant numeral; a grid that shows | Hard, rhythmic, cut to the beat; width and weight change on the beat |
| `cosmos` | Flat vector science explainer (added at the owner's request) | pro or viral | A rounded sans, medium weights, generous size; labels in rounded callouts | Deep navy to violet field, saturated shape colours, one glowing accent. Layered gradients and glow falloff, no paper | Scale-comparison rows; cutaway circles that open a shape to show its inside; orbit rings; particle and star fields; rounded callouts with leader lines; simple geometric objects built from primitives | Smooth ease-in-out with small overshoot, a 60 fps feel, constant gentle float, zooms across scale |
| `marker` | Whiteboard time-lapse | pro | A handwriting face for all text | White board, one black marker, one accent colour | A hand draws strokes, boxes, arrows and scribble fills; one element per sentence; an erase between boards | Drawing speed follows the narration; nothing fades in |

`marker` is the hand-drawn film of 1.2.0 rebuilt as a look; the pure geometry in `template/sketch/geometry.mjs` is reused.

Looks replace `theme` in make-motion. A film may override a look's accent with `"accent": "#rrggbb"` and nothing else; a look is a designed whole, not a set of knobs. The nine shared themes stay for the four HTML skills.

### 5.2 Typography system

The engine lays out text itself, glyph by glyph, which is what makes these rules enforceable.

- **Scale contrast.** Each look has a type scale of five steps. A hero is at least three times the size of the supporting text on the same frame. No more than three sizes on one frame.
- **Words on screen.** Viral: one to three words per caption beat, at most seven in a hook. Professional: at most twelve words a line and three lines for body text.
- **Breaks by sense.** Lines break at phrase boundaries, not at the box edge: after punctuation, before prepositions and conjunctions, never leaving one short word alone. The director can force a break with `|`. Lines are balanced.
- **Fit.** Text is fitted to its box between a minimum and maximum size; the minimum is the reading floor (28 px at 1080 on the short side), and a text that cannot fit is a `creative` finding that tells the director to cut words.
- **Optical alignment.** Flush-left edges are aligned optically (round and angled glyphs overhang), and opening quotes and punctuation hang outside the margin.
- **Tracking and case by size.** Caps and small labels are tracked out; large display type is tracked in; each look sets the curve.
- **Numerals.** Counters use fixed digit advances so a number does not jitter while it counts; units are set smaller and aligned to the cap height.
- **One emphasis system per look.** `desk` highlights, `pop` recolours and scales, `ledger` changes weight and colour of one series, `keynote` sweeps weight, `poster` changes scale, `marker` underlines. Emphasis in the narration (`*word*`) triggers that system and nothing else.
- **Motion of type.** By word or by line, never by letter except in `pop` and `poster`. Reveals use masks and cuts more than fades. Variable-font weight and width animate where the look calls for it.
- **Grid.** Every format has a twelve-column grid with margins set by the look; every node snaps to it; the hero position is a property of the shot kind and the look, not chosen per film.

**Fonts.** Looks use the fonts already bundled where they fit (Geist for `keynote`, Caveat for `marker`, the bundled serifs and monos). Two OFL variable families are added, inside make-motion only so the other skills do not carry them: a display serif with optical-size and softness axes (Fraunces is the candidate) and a grotesque with wide weight and width ranges (Archivo is the candidate). Budget: 600 KB of new font files, Latin subset, each with its licence file and a `SOURCES.md` row. Whether canvas text can reach every axis is checked first (section 16).

### 5.3 Graphic devices

A **device** is a small piece of graphic language that points at meaning. Devices are engine features; each look styles them or declines them. A shot kind uses the ones that suit it, and the director can place one with an `on` event anchored to a word.

| Device | What it is |
|---|---|
| `highlight` | A marker swipe behind a phrase, slightly uneven, drawn in a few stepped frames |
| `circle`, `underline`, `arrow`, `bracket` | Hand-drawn or ruled marks that draw on around or toward a target |
| `cutout` | A photo or person cut from its background, with a keyline and a contact shadow, placed as an object |
| `clipping` | A document, article or screenshot shown as a physical piece; the camera pushes in and one sentence is highlighted |
| `card` | Paper, taped, torn or elevated, per look; carries a quote, a figure or a picture |
| `tag` | A small coloured label in caps: a section name, a source, a date |
| `label` | A direct label with a leader line onto a chart mark or a place on a map |
| `focus` | Dim everything except one target |
| `route` | A line that draws between places or items; pins and a thread in `desk` |
| `numeral` | One very large figure that the layout is built around |
| `sticker` | An outlined cut shape with a slight rotation; `pop` only |
| `sweep` | A band of light crossing type or a screen |
| `punch` | An instant scale-up on a word or a cut |
| `duotone`, `halftone` | Photo treatments that tie a picture to the palette |

All textures (paper grain, halftone, photocopy noise, misregistration) are generated from the seed. No image assets are bundled for them.

### 5.4 Layout

Each shot kind has a designed composition per look and per format, with an asymmetric default: the hero sits on a grid line, not the centre, unless the look centres by design (`pop`). Negative space is kept; a frame with more than one hero is a `creative` finding. Vertical formats are designed, not reflowed.

## 6. The new way of telling a story

A version 2 film is a **script of shots**. The director writes what is said and what is shown; the engine works out when.

```json
{
  "version": 2,
  "mode": "pro",
  "look": "desk",
  "voice": { "name": "bf_emma" },
  "music": { "bed": "drift", "bpm": 92 },
  "shots": [
    { "id": "hook", "show": "statement",
      "say": "Most dashboards can't tell you *where a number came from*.",
      "text": "Where did this | number come from?" },
    { "id": "proof", "show": "clipping", "src": "dashboard.png",
      "say": "This one shows the query behind every chart.",
      "on": [{ "at": "word:query", "do": "highlight", "target": "region:query" }] },
    { "id": "scale", "show": "number", "cut": "match",
      "say": "Four hundred fifty nine rows. One file. No server.",
      "value": 459, "label": "rows, one file" }
  ]
}
```

### 6.1 Shots

Each shot has an `id`, a `show` (its kind) and usually a `say`. A shot lasts as long as its narration plus a short tail; a shot with no `say` gives `hold` in seconds or `beats`. Nobody writes durations or keyframe times unless they choose the escape hatch.

**`say` without a voice (my call).** The root `voice` field is what turns narration into sound, and it is set only when the prompt or the intake asks for a voiceover. A film with `say` lines and no `voice` is a silent film: `say` is its script, shot lengths and word anchors come from the word-count estimate that `--outline` uses, and the script can be shown as captions. This is a shipped path, not a fallback: tests, CI and make-explainer's embedded renders need no voice model. The sync target of section 3 applies only to films with a voice; the report states for every film whether word times were measured or estimated.

Shot kinds replace the 38 blocks. Each is one idea on screen, composed for every look that supports it and every format:

| Kind | What it shows |
|---|---|
| `statement` | A line of type as the whole frame; words arrive as spoken |
| `number` | One hero figure with a label and optional delta |
| `chart` | A native animated chart: `bar`, `column`, `line`, `area`, `donut`, `scatter`, `race` |
| `compare` | Two sides: options, or before and after |
| `list` | Points or numbered steps, one per sentence |
| `quote` | A quotation, attribution, optional portrait cut-out |
| `clipping` | A document or screenshot as an object, with a push-in and a highlight |
| `screen` | A product screen in a frame, with zoom-to-region |
| `media` | A photo or clip, full-bleed or as a cut-out, with a treatment |
| `map` | A world or US map with places, labels and routes |
| `diagram` | Nodes and labelled arrows that draw on |
| `timeline` | Dated events along a line |
| `code` | Code typed, diffed, or a terminal run |
| `feed` | Chat bubbles or notifications arriving |
| `end` | Logo, closing line and ask |
| `free` | The escape hatch: raw nodes with explicit keyframes |

The fields of each kind and the final list are fixed in the plan after `statement`, `number` and `clipping` are built end to end in `desk` and `pop`. The count stays under 20.

### 6.2 Narration markup

| Mark | Meaning |
|---|---|
| `*word*` | Emphasis: stress, a slight slow-down, a short pause before, a small lift in level, and the look's emphasis device on the matching words on screen |
| `_phrase_` | Aside: quicker and quieter |
| `...` or `(0.4)` | A pause, default or in seconds |
| `[word](/ipa/)` | Pronunciation override |

On-screen text never shows the marks. One mark drives both sound and picture.

### 6.3 Anchors

Any timed thing (a device, a move, a cue, a caption, a cut) is placed with `word:<n>` or `word:<text>`, `sentence:<n>`, `beat:<n>`, `start`, `end`, or seconds within the shot, with an optional offset (`word:query-0.08`). Entrances are scheduled to **land** on their anchor. The resolver runs in Node where `scripts/lib/beat-refs.mjs` runs today, so validate, review, preview and render all see resolved times.

### 6.4 Continuity

- **Hero object.** A node whose `id` appears in consecutive shots is the same object. With `"cut": "match"` it travels and morphs across the cut. A number becomes a bar; a highlighted phrase becomes the next headline.
- **Camera.** One camera runs through the film. Layers have depth, so a push or a slide gives parallax. Each look defines the camera's character (over a desk, locked off, drifting).
- **Cuts.** `cut` names how a shot arrives; each mode and look offers a set (section 7).

### 6.5 Story structure

`references/story.md` (new) gives the director the craft:

- **Write for the picture.** Every line of narration names what is on screen while it is said. A line with nothing to show is cut or rewritten. The script is settled before any design.
- **Arcs.** Viral: hook on frame 0 in three to seven words, promise by 5 s, a change at least every 3 s, one open loop paid off before the end, a soft ask last. Professional: problem, the idea, proof, ask; one idea per shot; shots of 3 to 6 s; narration near 150 words a minute.
- **Storylines first.** For a film over 15 s in an interactive session, the director offers three storylines in a few lines each and the user picks one. A non-interactive run picks the first and says so.
- **Tells to avoid.** A short list of default-looking choices (centred everything, a fade on every element, a bullet list read aloud, a chart with a legend).

The arc is first written as shots with only `id`, `show` and `say`. `make.mjs --outline` prints the timed outline from a word-count estimate, with no voice model, so the script is fixed before synthesis or render.

## 7. Modes

A mode is behaviour; a look is appearance. `mode` defaults to `pro`. Viral is chosen when the prompt names Reels, TikTok, Shorts or "viral", or the intake picks it. Each mode has a default look and each look says which modes it serves.

| | `viral` | `pro` |
|---|---|---|
| Default look | `pop` | `desk` |
| Format default | 9:16 with platform safe zone | 16:9 |
| Pacing check | A change at least every 3 s; hook on frame 0 | One idea per shot; shots 3 to 6 s |
| Motion | Fast, overshoot, slams, shake on hits | Slow ease, mask reveals, continuous camera |
| Cuts | `cut` on the beat, `whip`, `punch`, `flash`, `glitch` | `cut`, `match`, `wipe`, `slide`, `dissolve` |
| Captions | On; word by word, spoken word emphasised | Off by default; a quiet line when on |
| Sound design | Dense: whoosh into cuts, hit on emphasis, riser into the reveal | Sparse: a paper or soft transition sound, one accent on the proof |
| Music duck under voice | 8 dB | 10 dB |
| Loudness | -14 LUFS, -1 dBTP | -16 LUFS, -1.5 dBTP |
| Voice delivery | Pace 1.08, stronger emphasis | Pace 0.96, gentler emphasis |

Modes and looks live in registries (`template/modes/`, `template/looks/`); the eight `isViral` call sites go away.

## 8. The engine

### 8.1 Pipeline

```
film.json ─▶ validate ─▶ voice (synthesise, measure words) ─▶ resolve anchors ─▶ expand shots to a scene graph
          ─▶ review (audits, sheets) ─▶ render (canvas frames ─▶ encode) ─▶ master audio ─▶ MP4
```

Every stage is a pure function of the spec, the seed and the voice sidecar.

### 8.2 Scene graph

Node types: `group`, `text`, `path` (any path; rect, ellipse and line are sugar), `image`, `video`, `chart`, `code`, `field` (a generated surface: paper, mesh gradient, halftone, grid). Every node takes transform, opacity, depth, blend mode, clip or mask, shadow and a step rate (for "on twos"). Fills accept gradients and generated textures. Text is laid out by the engine into runs of words and glyphs (section 5.2).

State at time `t` is computed directly from tracks of keyframes with easing curves and closed-form springs; anime.js is removed. A shot kind is a function from its fields, the look, the mode and the canvas to nodes and tracks. Node types, kinds, devices, moves, cuts and captions are each registered in one table.

### 8.3 Moves

Shot kinds and `on` events use named moves (`rise`, `wipe`, `slam`, `pop`, `draw`, `count`, `settle`). Each look maps a name to its own curve, distance, duration and step rate. `free` shots may write keyframes directly.

### 8.4 Graphics support

- **Fields** behind every shot, seeded from the shot id, moved by the camera.
- **Post pass**: one WebGL2 fragment shader over the finished 2D frame for grain, halftone, soft bloom, a light sweep, and the shader cuts. A canvas 2D fallback covers a machine with no WebGL; the report says which ran.
- **Shader cuts** on the gl-transitions contract, about ten ported, each file keeping its licence header and listed in `THIRD_PARTY_NOTICES.md`.
- **Motion blur** by sub-frame accumulation on fast cuts that ask for it, paid for by not re-capturing frames whose resolved state did not change.
- **Native charts** with animated marks and anchored labels. Maps use `d3-geo` and `topojson-client` directly with the bundled atlases.

### 8.5 Review

`check.mjs` is rebuilt on the scene graph.

- **Audits kept**: safe area, overlap, contrast against rendered pixels, reading time, dead stretch, text size, blank first frame, caption zone.
- **New audits**: typography (scale contrast, sizes per frame, words per line, orphans), layout (more than one hero, off-grid node), sync (every anchor resolves inside its shot), pacing per mode, continuity (a `match` cut has a shared id), a film over 15 s with no sound, title-safe and action-safe boxes.
- **Sheets**: the start and middle of every shot; a strip across every cut (0.2 s either side); the anchored moments at phone width.
- **Notes**: after viewing the sheets, the director writes `review.md` next to the spec: each shot described in one sentence as a stranger would see it, then ranked notes in the form `time · where · problem → change · what stays`. Measurements outrank the eye; audio is measured, never judged by the model.

Each finding is tagged `mechanical` or `creative`.

### 8.6 Capture

- **Exact**: PNG screenshots. Used by tests, review, sheets, `--poster`, and any render with `--exact`.
- **Fast**: frames encoded in the page with WebCodecs at high bitrate, then transcoded by ffmpeg to the delivered H.264 yuv420p. Default when available, with fallback to exact.

The plan measures both on a 20 s film before the default is fixed. `--workers` stays.

### 8.7 Preview and carry-overs

The same engine runs in the preview page: scrubber, audio, hit testing for click-to-copy-path. The provenance footer, `vars` and `--batch`, `beats.mjs`, `cutout.mjs` (now also the source of `cutout` devices), `--poster` and `--contact-sheet` carry over.

### 8.8 What a version 1 spec gets

`validate.mjs` exits 1 with: `this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md`. That page maps each block to a shot kind. No migrator.

## 9. Voice, sync and sound

### 9.1 Measured word times

Kokoro's duration predictor knows how long each phoneme lasts. Version 2 reads it: the `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` export on `onnxruntime-node` (already the pinned runtime for cutouts), giving `sentences[].words[] = { text, start, end, emphasis }` in the sidecar.

The tensor name and the conversion recipe are unconfirmed from primary sources, so the first voice task is a spike with a fallback ladder:

1. The timestamped Kokoro export, run directly or through HeadTTS (MIT), whichever needs fewer dependencies.
2. A small forced aligner on the synthesised audio (licence verified first).
3. Version 1's estimate, with the report stating that word times are estimated.

Downloads (my reading of the owner's allowance): the timestamped export replaces the current Kokoro model, so it is not the extra download; the aligner of rung 2, if needed, is the one extra model. The old model is not kept beside the new one.

Whichever rung ships is verified by an independent measurement on a fixture set (target: median absolute error 40 ms or less; method chosen in the plan), and the number goes in the README as measured. A user-supplied voice file with a Whisper JSON keeps working.

### 9.2 Tone, modulation, emphasis

1. **Synthesis.** Narration is split at marks into segments, each with its own speed; `*word*` gets a stress promotion through the phonemizer and a pause before it. The mode sets the base pace.
2. **Shaping** with ffmpeg: a level lift on emphasis, quieter asides, inserted pauses. No per-word pitch shifting.
3. **Mastering**: high-pass, gentle compression and de-essing on the voice; music ducked by an envelope built from the word spans; two-pass `loudnorm` to the mode's target.

Honest limit: Kokoro has no emotion control. This gives pacing, stress, pauses and level, not acting. If the owner finds it flat after listening, a second local voice with an aligner is the follow-up, outside this scope.

### 9.3 Captions

Caption styles are registry entries fed by the measured words and the emphasis flags; each look has its own. Rules checked: a caption leaves cleanly when its words end, a scaled emphasis word is never clipped, and captions stay inside their zone.

### 9.4 Sound design and music

- Cues are placed from events: each cut, device, emphasis and count-landing asks the mode and look for a sound. `"sound": "off"` silences them; an explicit `cues` list replaces them. The synth in `scripts/lib/cues.mjs` is kept and gains a sub drop, a riser that ends on its anchor, and paper and marker sounds for `desk` and `marker`.
- **Music bed.** `"music": { "src": "track.mp3" }` uses the user's file with `beats.mjs`. `"music": { "bed": "pulse" | "drift" | "tape", "bpm": 124 }` synthesises a simple bed locally from the seed; its beat grid is exact, so cuts land on beats without detection. It is a backing texture, not a composition.
- Audio stays opt-in in `pro`. In `viral`, cues are on by default as today.

## 10. Director and operator

Today `model: haiku` puts everything, creative direction included, on the cheap model. Version 2 reverses it in all five skills.

- **Director** = the session model. It runs the intake, writes the storylines and the spec, views the sheets, writes the review notes and decides every `creative` finding. No `model:` pin in `SKILL.md`.
- **Operator** = a cheap model. It runs one command and fixes only `mechanical` findings.
- **One command**: `node <skill-dir>/scripts/make.mjs <spec> --json` runs doctor, validate, voice, review and build or render, and prints one report: `{ ok, output, stages, findings: [{ kind, path, message, fix? }] }`. Each skill gets a `make.mjs` over its existing scripts.

Hand-off ladder, first that works:

1. Claude Code: the plugin ships `agents/artifact-builder.md` (`model: haiku`), invoked through the Agent tool. This is the only deterministic pin among the three hosts.
2. Codex and Copilot: the installed `artifact-builder` agent files (rewritten: run `make.mjs`, never write or restyle the spec), requested by name. Delegation there is model-decided.
3. No delegation, or it fails: the director runs the same line itself.

The artifact is identical on every rung; only cost differs. The operator receives a path and the command and returns the report. The director trusts the output file and the report, never the operator's prose. A higher model for the operator is justified only when the same mechanical finding survives two operator attempts; then the director takes over.

Fixed along the way: the builder brief that names a build script make-motion does not have; the missing Claude agent file; `shared/agents.mjs`.

Evidence: about ten motion prompts on Claude Code (billed, approved), reporting first-build validity, who ran each stage, and the operator's model from the session's own records. Codex and Copilot: install tests and docs only, labelled not run live.

## 11. Dependencies and security

Measured by `npm audit --package-lock-only` on 2026-11-15: 0 advisories in all five skills. The exposure is in what the lockfiles do not cover.

| Item | Change |
|---|---|
| Kokoro model loaded from Hugging Face at branch head, unhashed (`scripts/lib/voice.mjs:12`) | Pin the revision and check a SHA-256 before use, as `cutout.mjs` does |
| `kokoro-js` installed with `npm install --no-save`, transitive versions floating | A locked on-demand install: a small `optional/voice/` package with its own `package-lock.json`, installed with `npm ci`. If the direct onnxruntime path ships, `kokoro-js` and `@huggingface/transformers` leave entirely |
| `onnxruntime-node` on-demand install | Same locked mechanism |
| `ffmpeg-static` suggested unpinned, with a postinstall download (`scripts/lib/doctor-hint.mjs:14`) | Pin the version and state the download, or drop the hint in favour of the system ffmpeg |
| `@fontsource/inter`, `@fontsource/jetbrains-mono` in make-motion | Remove (unused) |
| `animejs` | Remove |
| `vega`, `vega-lite`, `vega-interpreter`, `vega-util` in make-motion | Remove (native charts). make-dashboard keeps Vega |
| `lottie-web` and the Lottie guard | Remove |
| `d3-geo`, `topojson-client` | Become direct, pinned dependencies of make-motion |
| `shiki` | Keep, tokens only, drawn on canvas |
| `sharp`, `global-agent` overrides | Remove if `kokoro-js` leaves; otherwise move into the locked optional package |
| `playwright` | Keep, pinned. Evaluate `playwright-core`; change only if it saves install size without changing output |
| The other four skills | No dependency changes found necessary |

Standing rules, checked by tests: no dependency range in any manifest, no install without a lockfile, every model or binary download pinned and hashed, and the offline guarantees of version 1 (CSP, request abort, loopback server, no `url` in specs) carried over. A separate agent reviews the new server, the capture path and every download for security before the branch is pushed for review.

## 12. Authoring support

- `make.mjs --list kinds|moves|cuts|captions|looks|devices` prints each entry's fields and one example. `SKILL.md` tells the director to look there before inventing.
- `SKILL.md` is rewritten around the director's job: intake, storylines, script, look, review. The long field reference moves to `references/`.
- Intake asks for mode, look (with a one-line feel for each), format, length, assets, voice, music and the ask; defaults are stated; non-interactive runs skip it and report the values used, as today.

## 13. Refresh of the other four skills

One studio, one hand, and the same priorities: typography, graphic design, layout. Most of it lands in `shared/`, so all four inherit it.

- **Type**: a shared scale with real contrast between display and text, optical sizes where the font has them, tabular numerals in tables and KPIs, consistent caps labels.
- **Themes**: the nine palettes retuned for depth (surface steps, an elevation scale, one confident accent), and seeded art for the six themes that have none.
- **make-dashboard**: charts in the newsroom manner (a claim as the title, direct labels where they fit, quieter grid, a restrained series palette), KPI tiles with real numerals and sparklines where the data allows. No change to SQL, provenance or security.
- **make-diagram**: node and edge styling, label typography, a calmer story player.
- **make-explainer**: hero, section rhythm, pull quotes, cards, and the deck's title and closing slides.
- **make-scene**: lighting, materials, fog, label type and tour camera easing.

Each skill's refresh starts by building its examples, viewing them, and writing a short list of changes; that list is its scope. The work is routed through the `design-router` skill, one rulebook at a time. Reduced-motion preferences are honoured. Existing contrast checks must still pass.

## 14. The showreel

Two films about portable-artifacts, with voice, a synthesised bed and placed cues, written by the director from what the plugin really does:

| Film | Mode and look | Format | Length | Shape |
|---|---|---|---|---|
| `showreel-viral` | viral, `pop` | 9:16 | about 20 s | Hook, five capabilities in fast cuts, soft ask |
| `showreel-pro` | pro, `desk` | 16:9 | about 45 s | The problem, the one-spec idea, the five skills as pieces on a desk with one hero object that becomes each artifact, proof, ask |

Their specs become the canonical examples, with one short example per remaining look. The renders replace the motion clips in `docs/features/img/portable-artifacts/` and the site gallery. Each film passes the review stage, has its sheets viewed and notes written, and has its sync measured; listening is on the manual checklist.

## 15. Order of work

Each step leaves the tree green and is committed and pushed on this branch.

1. **Security pins and trims** that do not depend on the new engine.
2. **Engine core and type**: scene graph, tracks, text layout and the typography rules, fields, capture, preview; a font and axis check on canvas.
3. **Two looks, three kinds**: `desk` and `pop` with `statement`, `number` and `clipping`, the core devices, end to end. This is the quality gate. I judge it, since the owner trusts my direction, against a written bar: every frame on the sheets passes the typography and layout audits of section 8.5, and a fresh reviewer agent that has not seen the design ranks the frames against the tells in `references/story.md` and finds none. The same bar decides whether each later look ships. The frames are sent to the owner as a status update, without waiting for a reply. If the bar is not met after two rounds of revision, I stop the engine work and bring the frames to the owner; steps 1, 7 and 8 do not depend on the gate and continue.
4. **Voice and sync**: the timing spike, measured words, anchors, narration markup, mastering, music bed, cues from events, captions.
5. **Remaining kinds, looks, modes, review**: all kinds, the other five looks (`cosmos` first), both modes, the rebuilt audits and sheets.
6. **Cut-over**: delete the version 1 engine and its dependencies; rewrite `SKILL.md`, `references/`, examples, tests, eval prompts and seeds; update make-explainer's motion section and `storyboard.mjs`.
7. **Director and operator** across the five skills, agent files, install tests.
8. **Refresh** of the other four skills.
9. **Showreel films**, site gallery, README and USAGE with re-measured claims, CHANGELOG, version 2.0.0, inventory counts.
10. **Verification**: full test suites, security review, the Claude eval, the manual-test checklist, pull request.

Browser-heavy runs are serialised: one render or browser test suite at a time on this machine, including across parallel agents.

## 16. Constraints

- Offline, open-source (OSI licences only), Node 20 or later, macOS, Windows and Linux.
- Deterministic on one machine: the same spec, seed and sidecar give the same frames.
- The spec stays writable by a model in one pass: validator errors keep the `<json.path>: <message>` form with did-you-mean.
- Repo rules: files under 800 lines, functions under 50, tests first, inventory counts updated with the change, site copy-button contract.
- No pull request is merged by me.

## 17. Left to the builder

- Exact fields of each shot kind and the final list.
- Each look's palette values, type scale, grid margins, move table and device styling, within section 5.
- The two font families, after the licence and canvas-axis checks.
- Texture generators, shader code, spring constants.
- Which rung of the voice ladder ships, and the verification method.
- Fast or exact capture as the default.
- `playwright-core` or `playwright`.
- The per-skill refresh lists.

## 18. Risks

| Risk | Handling |
|---|---|
| The rebuild is large: about 18,000 lines and 77 test files are replaced | Steps 2 to 5 build beside the old engine; nothing is deleted until step 6 |
| Canvas text cannot reach a variable axis, or shapes text worse than the DOM | Checked in step 2 on every candidate font before any look depends on it; fall back to static instances of the same family |
| Seven looks dilute quality | Two are finished first and set the bar; the rest ship only if they meet it |
| The looks read as imitation of a publisher | Genre devices only; own names, palettes and open fonts; no publisher marks |
| Word times less accurate than the target | Fallback ladder in 9.1; the measured number is reported whatever it is |
| The voice sounds flat | Unverified until the owner listens; follow-up voice named in 9.2 |
| Fast capture differs visibly from exact | Exact stays available and is the test path |
| Delegation silently not happening on Codex or Copilot | The ladder makes it a cost issue only; the report says who ran each stage |
| Refresh regressions in four mature skills | Existing suites and contrast checks must pass; each refresh is scoped by a viewed before-list |
