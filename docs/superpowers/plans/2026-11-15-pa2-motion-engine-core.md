# make-motion 2 engine core and look gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the version 2 canvas engine beside the version 1 engine, far enough to render two silent example films (`desk` and `pop` looks, `statement`, `number` and `clipping` shots) and judge them at the look quality gate.

**Architecture:** A film spec (`version: 2`) is validated and timed in Node (script parsing, word-time estimate, anchors). The page loads pure ES modules from `engine/`, expands each shot through a kind and a look into a scene graph of nodes with keyframe tracks, lays out text glyph run by glyph run, and draws frame `i` at `t = i / fps` on one canvas with a WebGL2 post pass. Node captures PNG frames and encodes with ffmpeg. Version 1 code is not touched.

**Tech Stack:** Node 20+, ES modules, no bundler; headless Chromium through the pinned `playwright` (default launch flags only); Canvas 2D and WebGL2; `ajv` for the schema; system ffmpeg; `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md` (sections 5, 6, 7, 8 and 15 steps 2 and 3).

All paths below are relative to `plugins/portable-artifacts/skills/make-motion/` unless they start with `docs/`. Run test commands from that directory.

## Global Constraints

- Version 1 files (`template/`, `scripts/*.mjs` other than the new `scripts/make.mjs`, `scripts/lib/`) are read-only in this plan. Reuse by import: `template/seeded.mjs` (`mulberry32`), `template/formats.mjs` (`FORMATS`, `safeInsets`), `scripts/lib/browser.mjs` (`launchBrowser`, `guardNetwork`), `scripts/lib/ffmpeg.mjs` (`findFfmpeg`, `encodeArgs`), `shared/errors.mjs` (`didYouMean`, `formatAjvErrors`), `shared/cli.mjs` (`parseCli`, `UsageError`).
- No new npm dependency. No `Math.random`, `Date`, `performance.now` or `requestAnimationFrame` in `engine/` (a test greps for them). Randomness is `mulberry32(seed)` only.
- Browser launch flags: exactly those of `launchBrowser()`. Never `--use-angle=swiftshader`, `--enable-unsafe-swiftshader` or `--ignore-gpu-blocklist` (measured: they break frame repeatability).
- Engine modules are pure functions of their arguments. Modules that need a canvas take the context or a `measure` function as a parameter; nothing in `engine/` outside `engine/page/` touches `document` or `window`.
- Sizes in looks are in **units**: 1 unit = short side / 1080 px. Text never below 28 units.
- Frame `i` samples `t = i / fps`. Default `fps` 30. Formats: `16:9` 1920x1080, `9:16` 1080x1920, `1:1` 1080x1080, `4:5` 1080x1350 (from `FORMATS`).
- Validator errors are `<json.path>: <message>` with a did-you-mean where a name is misspelled. Exit codes: 0 ok, 1 spec or review problems, 2 usage or IO error.
- Files under 800 lines, functions under 50, tests first, immutable data (return new objects).
- One browser-heavy run at a time on this machine: run `pgrep -fl chrome-headless-shell` first; browser tests run with `--test-concurrency=1`.
- Commit message format `<type>: <description>`; commits on `worktree-New-Motion`; stage named files only.
- Looks use genre devices only: no publisher names, marks or proprietary fonts in code, names, comments or docs.

## Review Focus

1. A `say` with punctuation-only tokens, numbers (`$4.2M`, `41%`), or emoji: every token still gets a word time and on-screen text keeps the number on one line. Test in Task 3.
2. Text that cannot fit at the 28-unit floor (a 30-word statement on 9:16): the layout reports `overflow: true` and the review emits a `creative` finding naming the shot; nothing is clipped silently. Tests in Tasks 2 and 12.
3. An `on` anchor naming a word that is not in the narration, or a `target` that the kind does not have: a validator error that lists the shot's words or the kind's targets. Test in Task 4.
4. A `clipping` image that is missing, outside the spec folder, or not an image: exit 2 with the path; never a blank frame. Test in Task 11.
5. Seeking out of order (frame 40, then 3, then 40): frame 40 hashes the same both times, including stepped devices and textures. Test in Task 6.

## File Structure

```
engine/
  registry.mjs            one table per extensible thing (kinds, looks, modes, devices, moves, cuts, fields)
  time/ease.mjs           easing curves and closed-form springs
  time/track.mjs          keyframe tracks, step rate
  script/say.mjs          narration markup parser
  script/timing.mjs       word-time estimate, shot timeline
  script/anchors.mjs      anchor resolution
  text/breaks.mjs         line breaks by sense, balance
  text/layout.mjs         glyph-run layout, fit, optical margin, fixed-advance numerals
  graph/node.mjs          node constructors
  graph/sample.mjs        graph at time t
  graph/camera.mjs        camera and depth
  fields/*.mjs            paper, mesh, halftone generators
  devices/*.mjs           highlight, marks, cutout, card, tag, numeral, punch
  kinds/*.mjs             statement, number, clipping
  looks/desk.mjs, looks/pop.mjs
  modes/pro.mjs, modes/viral.mjs
  cuts/index.mjs          cut, match, slide, punch
  review/frame.mjs        typography and layout audits over a laid-out frame
  page/index.html         the render page
  page/stage.mjs          page entry: fonts, assets, draw loop, window hooks
  page/draw.mjs           Canvas 2D drawing of sampled nodes
  page/post.mjs           WebGL2 post pass and 2D fallback
  fonts/                  two variable families, LICENSES/, SOURCES.md
scripts/make.mjs          the one command
scripts/v2/spec.mjs       schema and validation
scripts/v2/pipeline.mjs   load, validate, time
scripts/v2/server.mjs     loopback server for the page
scripts/v2/render.mjs     capture and encode
scripts/v2/sheets.mjs     review sheets
test/v2/*.test.mjs
references/examples/v2/gate-desk.json, gate-pop.json, clipping.png
```

---

### Task 1: Registry, easing, springs, tracks

**Files:**
- Create: `engine/registry.mjs`, `engine/time/ease.mjs`, `engine/time/track.mjs`
- Test: `test/v2/time.test.mjs`, `test/v2/registry.test.mjs`

**Interfaces:**
- Produces:
  - `createRegistry(kindLabel: string) -> { add(name, def), get(name), has(name), names(): string[] }`. `get` of an unknown name throws `Error` with message `unknown <kindLabel> "<name>"; did you mean "<closest>"? (have: a, b, c)` (the did-you-mean part only when `didYouMean` finds one). `add` of an existing name throws.
  - `registries: { kinds, looks, modes, devices, moves, cuts, fields }` (one `createRegistry` each).
  - `ease(name: string) -> (p: number) => number`. Names: `linear`; `in|out|inOut` + `Quad|Cubic|Quart|Expo|Back`; `spring(<stiffness>,<damping>)`, a closed-form damped spring normalised to settle at 1 by `p = 1`. Unknown name throws with did-you-mean.
  - `track(keys: Array<{ t: number, v: number | number[] | string, ease?: string }>) -> Track`; `sample(track: Track, t: number, stepFps?: number) -> same type as v`. Holds the first value before the first key and the last after the last; the ease of key `n` shapes the segment from `n-1` to `n`; a `#rrggbb` string interpolates per channel; `stepFps` floors `t` to `1 / stepFps` first.

- [ ] **Step 1: Write the failing tests**

```js
// test/v2/time.test.mjs
test('sample holds before the first key and after the last', () => {
  const tr = track([{ t: 1, v: 10 }, { t: 2, v: 20, ease: 'linear' }]);
  assert.equal(sample(tr, 0), 10); assert.equal(sample(tr, 1.5), 15); assert.equal(sample(tr, 9), 20);
});
test('stepFps quantises time ("on twos" at 12 fps)', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 1, v: 12, ease: 'linear' }]);
  assert.equal(sample(tr, 0.16, 12), 1); assert.equal(sample(tr, 0.17, 12), 2);
});
test('colours interpolate per channel', () => {
  assert.equal(sample(track([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'linear' }]), 0.5), '#808080');
});
test('a spring overshoots then settles at exactly 1', () => {
  const s = ease('spring(170,12)');
  assert.equal(s(0), 0); assert.equal(s(1), 1); assert.ok(Math.max(...[0.2, 0.3, 0.4, 0.5].map(s)) > 1);
});
test('an unknown ease names the closest', () => {
  assert.throws(() => ease('outCubik'), /did you mean "outCubic"/);
});
```

```js
// test/v2/registry.test.mjs
test('get of an unknown name lists what exists', () => {
  const r = createRegistry('look'); r.add('desk', {}); r.add('pop', {});
  assert.throws(() => r.get('dsk'), /unknown look "dsk"; did you mean "desk"\? \(have: desk, pop\)/);
  assert.throws(() => r.add('desk', {}), /already registered/);
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/time.test.mjs test/v2/registry.test.mjs` fails with a module-not-found error.
- [ ] **Step 3: Implement the three modules** to the signatures above.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/registry.mjs engine/time test/v2/time.test.mjs test/v2/registry.test.mjs` ; message `feat: v2 engine registry, easing and tracks`.

### Task 2: Text layout

**Files:**
- Create: `engine/text/breaks.mjs`, `engine/text/layout.mjs`
- Test: `test/v2/text.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `Font = { family: string, size: number, weight: number, width?: number, tracking?: number (em), lineHeight?: number (multiple of size, default 1.1) }`.
  - `Measure = (text: string, font: Font) -> { width: number, ascent: number, descent: number }`.
  - `breakBySense(words: string[], widths: number[], spaceWidth: number, maxWidth: number) -> number[][]` (word indexes per line). Rules, in order: a forced break after a word that ends with `|` (the `|` is stripped by the caller); never exceed `maxWidth` unless one word alone is wider; prefer to break after `, ; : . ! ? —` and before a word in `PREPOSITIONS` (`of in on at to for with by from and or but that which`); never leave a last line of one word when the line above has three or more (pull one down); among valid breakings choose the one with the smallest difference between longest and shortest line.
  - `layoutText({ text, font, maxWidth, align?: 'left' | 'center' | 'right', measure, optical?: boolean }) -> Layout`, where `Layout = { size, width, height, lines: Array<{ x, y, width, words: Array<{ text, index, x, width }> }>, overflow: false }`. `y` is the baseline. With `optical: true` and `align: 'left'`, a line starting with one of `" ' “ ‘ ( [` is shifted left by that glyph's width (hanging punctuation). A token matching `NUMBER_TOKEN` (digits with `$ € £ % , .` and a unit suffix up to 3 letters) is never split across lines.
  - `fitText(opts, { min: number, max: number, maxHeight: number, maxLines?: number }) -> Layout`: the largest whole-number `font.size` between `min` and `max` whose layout fits `maxHeight` and `maxLines`; if none fits, the layout at `min` with `overflow: true`.
  - `numeralAdvance(measure, font) -> number`: the widest of the digits `0`–`9`, used as a fixed advance for counters.

- [ ] **Step 1: Write the failing tests** with a fake measure (`width = text.length * font.size * 0.5`, ascent `0.8 * size`, descent `0.2 * size`):

```js
const measure = (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 });
const font = { family: 'x', size: 100, weight: 700 };
test('breaks before a preposition rather than at the box edge', () => {
  const l = layoutText({ text: 'Where did this number come from', font, maxWidth: 900, measure });
  assert.deepEqual(l.lines.map((x) => x.words.map((w) => w.text).join(' ')), ['Where did this', 'number come from']);
});
test('a | forces a break and is not drawn', () => {
  const l = layoutText({ text: 'One file | no server', font, maxWidth: 5000, measure });
  assert.deepEqual(l.lines.map((x) => x.words.map((w) => w.text).join(' ')), ['One file', 'no server']);
});
test('no one-word last line under a long line', () => {
  const l = layoutText({ text: 'Every chart here shows its query', font, maxWidth: 1350, measure });
  assert.ok(l.lines.at(-1).words.length >= 2);
});
test('a number with its unit stays on one line', () => {
  const l = layoutText({ text: 'Revenue grew $4.2M this quarter', font, maxWidth: 700, measure });
  assert.ok(l.lines.some((x) => x.words.some((w) => w.text === '$4.2M')));
});
test('fitText reports overflow at the floor instead of clipping', () => {
  const long = Array(30).fill('paragraph').join(' ');
  const l = fitText({ text: long, font, maxWidth: 800, measure }, { min: 28, max: 200, maxHeight: 300 });
  assert.equal(l.size, 28); assert.equal(l.overflow, true);
});
test('optical alignment hangs an opening quote', () => {
  const l = layoutText({ text: '“Fast” they said', font, maxWidth: 5000, measure, align: 'left', optical: true });
  assert.ok(l.lines[0].x < 0);
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/text.test.mjs`.
- [ ] **Step 3: Implement.** `breakBySense` enumerates breakings by dynamic programming over word positions with a cost of `(maxWidth - lineWidth)^2` plus a penalty of `maxWidth^2 / 4` for a break that is not at a preferred point and `maxWidth^2` for a one-word last line.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/text test/v2/text.test.mjs` ; `feat: v2 text layout with sense breaks and fit`.

### Task 3: Narration parser and timing

**Files:**
- Create: `engine/script/say.mjs`, `engine/script/timing.mjs`
- Test: `test/v2/script.test.mjs`

**Interfaces:**
- Produces:
  - `parseSay(say: string) -> { plain: string, tokens: Array<{ text: string, emphasis: boolean, aside: boolean, pauseBefore: number, sentenceEnd: boolean, ipa?: string }> }`. Marks: `*…*` emphasis on each enclosed word; `_…_` aside; `...` adds 0.35 s to the next token's `pauseBefore`; `(0.4)` adds that many seconds (0.05 to 3, else a thrown `SayError` naming the value); `[word](/ipa/)` sets `ipa`. `plain` is the text with all marks removed and single spaces. A token is a whitespace-separated word with its punctuation attached; `sentenceEnd` is true when it ends with `. ! ?`. An unclosed `*` or `_` throws `SayError('unclosed * in "<say>"')`.
  - `estimateWords(tokens, { wpm: number }) -> Array<{ text, start, end, emphasis, aside }>` in seconds from 0. A word lasts `(60 / wpm) * clamp(letters / 5, 0.6, 1.8)`, times 1.15 when `emphasis`, times 0.85 when `aside`; before it comes `pauseBefore`, plus 0.12 when `emphasis`; after a `sentenceEnd` word comes 0.25. `letters` counts letters and digits only, minimum 1.
  - `MODE_PACE = { pro: { wpm: 150, tail: 0.6 }, viral: { wpm: 175, tail: 0.3 } }`.
  - `buildTimeline(film, { fps }) -> { fps, duration, frameCount, timed: 'estimated', shots: Array<{ id, index, start, end, duration, words, sentences: Array<{ start, end, first, last }> }> }`. A shot with `say` lasts its last word's `end` plus the mode's `tail`; a shot without `say` lasts `hold` (default 2); minimum 1 s; each duration is rounded up to a whole frame; `words` and `sentences` are shot-local seconds.

- [ ] **Step 1: Write the failing tests**

```js
test('marks are parsed and removed from plain', () => {
  const p = parseSay('Your dashboard is *lying* to you... _honestly_.');
  assert.equal(p.plain, 'Your dashboard is lying to you honestly.');
  assert.deepEqual(p.tokens.filter((t) => t.emphasis).map((t) => t.text), ['lying']);
  assert.equal(p.tokens.at(-1).aside, true); assert.equal(p.tokens.at(-1).pauseBefore, 0.35);
});
test('an unclosed mark is an error that quotes the line', () => {
  assert.throws(() => parseSay('this is *broken'), /unclosed \* in "this is \*broken"/);
});
test('numbers, symbols and emoji each get a word time', () => {
  const w = estimateWords(parseSay('$4.2M up 41% 🚀').tokens, { wpm: 150 });
  assert.equal(w.length, 4); assert.ok(w.every((x) => x.end > x.start));
});
test('emphasis is slower and preceded by a pause', () => {
  const [a] = estimateWords(parseSay('lying').tokens, { wpm: 150 });
  const [b] = estimateWords(parseSay('*lying*').tokens, { wpm: 150 });
  assert.ok(b.start - a.start >= 0.12 - 1e-9); assert.ok(b.end - b.start > a.end - a.start);
});
test('timeline durations are whole frames and shots are back to back', () => {
  const tl = buildTimeline({ mode: 'pro', shots: [{ id: 'a', show: 'statement', say: 'One file.' }, { id: 'b', show: 'statement', hold: 1.5 }] }, { fps: 30 });
  assert.equal(tl.shots[1].start, tl.shots[0].end);
  assert.ok(Number.isInteger(Math.round(tl.shots[0].duration * 30 * 1e6) / 1e6));
  assert.equal(tl.shots[1].duration, 1.5); assert.equal(tl.timed, 'estimated');
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/script.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/script/say.mjs engine/script/timing.mjs test/v2/script.test.mjs` ; `feat: v2 narration markup and estimated timing`.

### Task 4: Spec schema, validation and anchors

**Files:**
- Create: `scripts/v2/spec.mjs`, `scripts/v2/pipeline.mjs`, `engine/script/anchors.mjs`
- Test: `test/v2/spec.test.mjs`, `test/v2/anchors.test.mjs`

**Interfaces:**
- Consumes: `registries` (Task 1), `parseSay`, `buildTimeline` (Task 3).
- Produces:
  - `resolveAnchor(ref: number | string, shot: TimelineShot) -> number` (shot-local seconds, clamped to `[0, shot.duration]`). Forms: a number; `start`; `end`; `word:<n>` (0-based) ; `word:<text>` (first word whose letters and digits match case-insensitively); `sentence:<n>`; any of these followed by `+<s>` or `-<s>`. `beat:<n>` throws `AnchorError('beat anchors need music, which this build does not have yet')`. An unknown word throws `AnchorError('no word "<text>" in shot "<id>"; its words are: <w1>, <w2>, …')`.
  - `validateFilm(spec: unknown, { specDir: string }) -> { ok: boolean, errors: Array<{ path: string, message: string }> }`.
    - `version` must be `2`. Any other value, or a spec with a root `scenes` array, gives the single error `{ path: '', message: 'this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md' }`.
    - Root fields: `version`, `mode` (`pro` default, `viral`), `look` (default: the mode's `defaultLook`), `format` (`16:9` default for `pro`, `9:16` for `viral`), `fps` (24, 25, 30, 60), `seed` (integer 0–7918, default 1), `accent` (`#rrggbb`), `generatedBy`, `shots` (1–60). Unknown root fields are errors with did-you-mean.
    - A look that does not list the film's mode in its `modes` is an error: `look "<name>" does not serve mode "<mode>" (it serves: …)`.
    - Shot: `id` (unique, `^[a-z][a-z0-9-]*$`), `show` (a registered kind), `say` (1–400 chars, must parse), `hold` (0.5–30, only without `say`), `cut` (a name in the look's `cuts`; not allowed on the first shot except `cut`), `on` (0–8 of `{ at, do, target? }`), plus the kind's own fields validated by the kind's `schema` (a JSON schema fragment on the kind definition).
    - Each `on[i].at` must resolve with `resolveAnchor` (error message is the `AnchorError` message); `do` must be a registered device the look supports; `target` must be one of the kind's `targets(shot)` or the error lists them.
    - A `src` field must be a relative path inside `specDir` that exists.
  - `loadFilm(specPath: string) -> { film, timeline, specDir }` (reads, validates, applies defaults, builds the timeline; throws `SpecError` carrying `errors`).

- [ ] **Step 1: Write the failing tests** (register a stub kind `statement` with `schema: { properties: { text: { type: 'string' } } }`, `targets: () => ['text']`, and stub looks `desk` (`modes: ['pro']`, `cuts: ['cut','match']`) and `pop` (`modes: ['viral']`) in the test's setup):

```js
test('a version 1 spec gets one clear error', () => {
  const r = validateFilm({ scenes: [] }, { specDir });
  assert.deepEqual(r.errors, [{ path: '', message: 'this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md' }]);
});
test('a misspelled field gets a did-you-mean with its path', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statment', say: 'Hi.' }] }, { specDir });
  assert.match(r.errors[0].path, /^shots\[0\]\.show$/); assert.match(r.errors[0].message, /did you mean "statement"/);
});
test('an anchor to a word that is not spoken lists the words', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 'word:server', do: 'highlight', target: 'text' }] }] }, { specDir });
  assert.match(r.errors[0].message, /no word "server" in shot "a"; its words are: One, file\./);
});
test('a target the kind does not have lists its targets', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 'word:file', do: 'highlight', target: 'label' }] }] }, { specDir });
  assert.match(r.errors[0].message, /targets of statement are: text/);
});
test('a look that does not serve the mode is refused', () => {
  const r = validateFilm({ version: 2, mode: 'viral', look: 'desk', shots: [{ id: 'a', show: 'statement', say: 'Hi.' }] }, { specDir });
  assert.match(r.errors[0].message, /look "desk" does not serve mode "viral"/);
});
```
```js
// test/v2/anchors.test.mjs
const shot = { id: 'a', duration: 2, words: [{ text: 'One', start: 0, end: 0.3 }, { text: 'file.', start: 0.3, end: 0.8 }], sentences: [{ start: 0, end: 0.8 }] };
test('word by index, by text, with an offset, clamped', () => {
  assert.equal(resolveAnchor('word:1', shot), 0.3); assert.equal(resolveAnchor('word:FILE', shot), 0.3);
  assert.equal(resolveAnchor('word:file-0.08', shot), 0.22); assert.equal(resolveAnchor('start-1', shot), 0); assert.equal(resolveAnchor('end', shot), 2);
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/spec.test.mjs test/v2/anchors.test.mjs`.
- [ ] **Step 3: Implement.** The root and shot schemas are ajv schemas with `additionalProperties: false`; kind schemas are merged per shot by `show`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add scripts/v2/spec.mjs scripts/v2/pipeline.mjs engine/script/anchors.mjs test/v2/spec.test.mjs test/v2/anchors.test.mjs` ; `feat: v2 film schema, validation and anchors`.

### Task 5: Scene graph, sampling and camera

**Files:**
- Create: `engine/graph/node.mjs`, `engine/graph/sample.mjs`, `engine/graph/camera.mjs`
- Test: `test/v2/graph.test.mjs`

**Interfaces:**
- Consumes: `track`, `sample` (Task 1).
- Produces:
  - `node(type, id, props, { tracks?, children?, depth?, step?, wordTracks? }) -> Node`, frozen. Types: `group`, `text`, `path`, `image`, `field`. Static `props` by type: `text { layout: Layout, font: Font, fill: string }`; `path { d: string, fill?, stroke?, strokeWidth?, cap?: 'round' | 'butt', rough?: number }`; `image { src, w, h, fit?: 'cover' | 'contain', clip?: [x, y, w, h], treatment?: 'none' | 'duotone' | 'halftone' }`; `field { field: string, w, h, params? }`; `group {}`. Common animatable props (static value in `props`, or a `Track` in `tracks`): `x, y, scale, scaleX, scaleY, rotate, opacity, draw, reveal, blur`. `wordTracks` (text only): an array, one entry per word index, of `{ opacity?, x?, y?, scale?, fill? }` tracks. `step` is a frame rate for stepped sampling. `depth` is a number, 0 at the picture plane, positive is farther.
  - `sampleGraph(nodes: Node[], t: number) -> Sampled[]`: the same tree with every animatable prop resolved to a value (defaults `x 0, y 0, scale 1, rotate 0, opacity 1, draw 1, reveal 1, blur 0`), each word's resolved props under `words[i]`, and `step` applied. Nodes with `opacity <= 0` are kept (the review needs them) but marked `visible: false`.
  - `camera({ tracks, canvas }) -> (t) => { x, y, zoom, rotate }` and `applyCamera(sampled, cam, canvas) -> Sampled[]`: a node at `depth d` moves by the camera pan divided by `1 + d` and scales by `1 + (zoom - 1) / (1 + d)` about the canvas centre; nodes with `props.fixed: true` are untouched.
  - `stateKey(sampled) -> string`: a stable JSON string of everything that affects pixels, used to skip capturing a frame whose key equals the previous frame's.

- [ ] **Step 1: Write the failing tests**

```js
test('sampling resolves tracks and defaults', () => {
  const n = node('path', 'bar', { d: 'M0 0H10', x: 5 }, { tracks: { opacity: track([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'linear' }]) } });
  const [s] = sampleGraph([n], 0.5);
  assert.equal(s.x, 5); assert.equal(s.opacity, 0.5); assert.equal(s.scale, 1); assert.equal(s.visible, true);
});
test('a stepped node holds between steps', () => {
  const n = node('path', 'mark', { d: 'M0 0H10' }, { step: 12, tracks: { draw: track([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'linear' }]) } });
  assert.equal(sampleGraph([n], 0.10)[0].draw, sampleGraph([n], 0.16)[0].draw);
});
test('farther layers move less under a camera pan', () => {
  const near = sampleGraph([node('group', 'near', { x: 0 })], 0), far = sampleGraph([node('group', 'far', { x: 0 }, { depth: 1 })], 0);
  const cam = { x: 100, y: 0, zoom: 1, rotate: 0 }, canvas = { w: 1920, h: 1080 };
  assert.equal(applyCamera(near, cam, canvas)[0].x, -100); assert.equal(applyCamera(far, cam, canvas)[0].x, -50);
});
test('equal states give equal keys, a moved node a different one', () => {
  const n = node('group', 'g', { x: 1 });
  assert.equal(stateKey(sampleGraph([n], 0)), stateKey(sampleGraph([n], 5)));
  assert.notEqual(stateKey(sampleGraph([n], 0)), stateKey(sampleGraph([node('group', 'g', { x: 2 })], 0)));
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/graph.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/graph test/v2/graph.test.mjs` ; `feat: v2 scene graph sampling and camera`.

### Task 6: Page stage, drawing, server, and frame repeatability

**Files:**
- Create: `engine/page/index.html`, `engine/page/stage.mjs`, `engine/page/draw.mjs`, `scripts/v2/server.mjs`, `test/v2/helpers/stage.mjs`
- Test: `test/v2/stage-browser.test.mjs`, `test/v2/purity.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 2, 5; `launchBrowser`, `guardNetwork`; `mulberry32`.
- Produces:
  - `startV2Server({ film, timeline, specDir }) -> Promise<{ url: string, close(): Promise<void> }>`. Binds `127.0.0.1` on port 0; refuses any `Host` header that is not `127.0.0.1:<port>` or `localhost:<port>` with 403; serves `/` (the page), `/engine/**` (this skill's `engine/` only, `.mjs` `.html` `.woff2` `.glsl`), `/v1/seeded.mjs` and `/v1/formats.mjs` (the two reused version 1 modules), `/film.json` (`{ film, timeline }`), and `/asset/<n>` for each `src` the film names (by index, never by path from the request). Sends `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'` and `X-Content-Type-Options: nosniff`.
  - In the page: `window.__ready: Promise<{ frameCount, fps, size: [w, h], post: 'webgl2' | '2d' }>`, `window.__seek(i: number) -> void` (draws frame `i` synchronously and calls `gl.finish()` when the post pass is WebGL), `window.__snapshot(i) -> Sampled[]` (the laid-out, camera-applied nodes of frame `i` with each text node's `layout` and each node's bounding box `bbox: [x, y, w, h]` in canvas pixels), `window.__stateKey(i) -> string`.
  - `draw.mjs`: `drawFrame(ctx, sampled, { assets, canvas, fields }) -> void`. Text is drawn word by word from `layout` using `ctx.font = '<weight> <size>px "<family>"'`, `ctx.fontStretch` for `width`, `ctx.letterSpacing` for `tracking`; `path.draw` trims with a dash pattern from `Path2D` length (measured once per path with an offscreen `SVGGeometryElement.getTotalLength()` and cached); `reveal` clips a node to the left `reveal` fraction of its bbox; `rough` displaces a path's points with `mulberry32(hash(id))`.
  - `test/v2/helpers/stage.mjs`: `openStage(filmObject) -> { page, info, hashFrame(i): Promise<string>, close() }`, which registers nothing itself (the film names registered kinds), starts the server and a browser, and hashes `page.screenshot({ type: 'png' })` with SHA-256. It returns `null` (so tests call `t.skip`) when no browser is available, unless `PA_REQUIRE_BROWSER=1`.

- [ ] **Step 1: Write the failing tests.** The browser test uses a film of one `free` shot whose nodes are given inline (`show: 'free'`, `nodes: [...]`, `hold: 2`); register the `free` kind in `engine/kinds/free.mjs` as part of this task (its `expand` returns the shot's `nodes` built through `node()`).

```js
// test/v2/stage-browser.test.mjs  (run with --test-concurrency=1)
test('frame 40 hashes the same after seeking 40, 3, 40, and in a second browser', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const h1 = await a.hashFrame(40); await a.hashFrame(3); const h2 = await a.hashFrame(40); await a.close();
  const b = await openStage(FILM); const h3 = await b.hashFrame(40); await b.close();
  assert.equal(h1, h2); assert.equal(h1, h3);
});
test('the page makes no request off the loopback server', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  assert.deepEqual(a.blocked, []); await a.close();
});
test('a request with a foreign Host header is refused', async () => {
  const s = await startV2Server({ film: FILM, timeline: TL, specDir });
  const res = await fetch(s.url, { headers: { host: 'evil.example' } }).catch((e) => e);
  assert.ok(res.status === 403 || res instanceof Error); await s.close();
});
```
```js
// test/v2/purity.test.mjs
test('engine code never reads a clock or Math.random', () => {
  for (const file of walk('engine')) if (file.endsWith('.mjs'))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame/, file);
});
test('only engine/page touches document or window', () => {
  for (const file of walk('engine')) if (file.endsWith('.mjs') && !file.includes('/page/'))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(document|window)\./, file);
});
```

- [ ] **Step 2: Run and see them fail** — `node --test --test-concurrency=1 test/v2/stage-browser.test.mjs test/v2/purity.test.mjs`.
- [ ] **Step 3: Implement.** Prove the purity guard fires: add `Math.random()` to a scratch line in `engine/time/ease.mjs`, run `node --test test/v2/purity.test.mjs`, see it fail, remove the line, confirm `git diff --stat engine/time/ease.mjs` is empty.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/page engine/kinds/free.mjs scripts/v2/server.mjs test/v2/helpers/stage.mjs test/v2/stage-browser.test.mjs test/v2/purity.test.mjs` ; `feat: v2 canvas stage, loopback server and repeatable frames`.

### Task 7: Fonts and the canvas axis check

**Files:**
- Create: `engine/fonts/<family files>.woff2`, `engine/fonts/LICENSES/<family>.txt`, `engine/fonts/SOURCES.md`, `engine/fonts/index.mjs`
- Test: `test/v2/fonts-browser.test.mjs`, `test/v2/fonts.test.mjs`

**Interfaces:**
- Produces: `FONTS: Array<{ family: string, file: string, axes: { wght?: [min, max], wdth?: [min, max], opsz?: [min, max], SOFT?: [min, max] }, reach: { wght: boolean, wdth: boolean, opsz: boolean, SOFT: boolean } }>` and `fontFaces() -> Array<{ family, url, descriptors }>` consumed by `engine/page/stage.mjs`, which loads every face and awaits `document.fonts.ready` before resolving `__ready`. It also lists the already bundled faces the two looks use from `shared/fonts/` (served at `/engine/fonts/shared/<file>` by adding that one directory to the server's allow-list).

- [ ] **Step 1: Obtain the two families.** Candidates: Fraunces (display serif: `wght`, `opsz`, `SOFT`, `WONK`) and Archivo (grotesque: `wght`, `wdth`). In the session scratchpad run `npm view @fontsource-variable/fraunces version` and `npm view @fontsource-variable/archivo version`, then `npm pack @fontsource-variable/fraunces@<that exact version>` and the same for Archivo; extract; copy only the Latin variable `.woff2` files that carry the axes above and each package's `LICENSE`. Record in `SOURCES.md` one row per file: package, exact version, file name inside the package, SHA-256 (`shasum -a 256`), licence (must read OFL-1.1; if it does not, stop and report). The total of new `.woff2` files must be at most 600 KB (`du -k`); if over, drop the italic or the full-axis file in favour of the `wght`-only one and say so in `SOURCES.md`.
- [ ] **Step 2: Write the failing tests**

```js
// test/v2/fonts.test.mjs
test('every bundled font file has a SOURCES row with a matching sha256 and a licence file', () => { /* parse SOURCES.md table; hash each file; assert equality and LICENSES/<family>.txt exists and contains "SIL OPEN FONT LICENSE" */ });
test('new font files total at most 600 KB', () => { assert.ok(totalBytes <= 600 * 1024); });
```
```js
// test/v2/fonts-browser.test.mjs — for each family and each axis it declares:
test('canvas text changes when the axis changes, where reach says it does', async (t) => {
  // draw "Rag" at the axis minimum and maximum on a 600x200 canvas, hash both; assert (hashMin !== hashMax) === font.reach[axis]
});
```

- [ ] **Step 3: Implement `index.mjs`.** `wght` is reached through the weight in `ctx.font`; `wdth` through `ctx.fontStretch` as a percentage; `opsz` and `SOFT` through extra `FontFace` instances registered under derived family names (`"Fraunces Soft"`) with `variationSettings`. Set each `reach` flag to what the browser test measures; an axis that cannot be reached stays `false` and the looks in Task 9 must not animate it.
- [ ] **Step 4: Run and see them pass** — `node --test --test-concurrency=1 test/v2/fonts.test.mjs test/v2/fonts-browser.test.mjs`.
- [ ] **Step 5: Commit** — `git add engine/fonts test/v2/fonts.test.mjs test/v2/fonts-browser.test.mjs scripts/v2/server.mjs` ; `feat: v2 variable display fonts with licence and axis checks`.

### Task 8: Fields and textures

**Files:**
- Create: `engine/fields/paper.mjs`, `engine/fields/mesh.mjs`, `engine/fields/halftone.mjs`, `engine/fields/index.mjs`
- Test: `test/v2/fields.test.mjs`

**Interfaces:**
- Produces: each field registered in `registries.fields` as `{ plan({ w, h, seed, params, palette }) -> FieldPlan, paint(ctx, plan, t) -> void }`. `plan` is pure and returns plain data (`paper`: fibre and speck positions, tint, a grain tile seed; `mesh`: 4 to 6 blobs `{ x, y, r, color, drift: [dx, dy] }`; `halftone`: `{ cell, angle, color, falloff }`); `paint` draws it. `paper` and `halftone` paint once into a cached offscreen canvas keyed by the plan and are then blitted; `mesh` moves its blobs by `drift * t`.

- [ ] **Step 1: Write the failing tests**

```js
test('the same seed plans the same field and a different seed a different one', () => {
  const f = registries.fields.get('paper'), a = f.plan({ w: 1920, h: 1080, seed: 7, palette }), b = f.plan({ w: 1920, h: 1080, seed: 7, palette });
  assert.deepEqual(a, b); assert.notDeepEqual(a, f.plan({ w: 1920, h: 1080, seed: 8, palette }));
});
test('mesh blobs stay within one radius of the canvas', () => {
  const p = registries.fields.get('mesh').plan({ w: 1080, h: 1920, seed: 3, palette });
  assert.ok(p.blobs.length >= 4 && p.blobs.length <= 6);
  assert.ok(p.blobs.every((b) => b.x > -b.r && b.x < 1080 + b.r && b.y > -b.r && b.y < 1920 + b.r));
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/fields.test.mjs`.
- [ ] **Step 3: Implement.** `paper`: a flat tint, low-contrast large blotches (8 to 14 radial gradients at 3% alpha), 2,000 to 4,000 fibres (1-unit strokes, 4 to 14 units long, random angle, 5% alpha) and a 256-px noise tile at 4% alpha, all scaled by units. `halftone`: dots on a rotated grid whose radius falls off along `falloff`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/fields test/v2/fields.test.mjs` ; `feat: v2 seeded paper, mesh and halftone fields`.

### Task 9: Looks and modes

**Files:**
- Create: `engine/looks/desk.mjs`, `engine/looks/pop.mjs`, `engine/looks/index.mjs`, `engine/modes/pro.mjs`, `engine/modes/viral.mjs`, `engine/modes/index.mjs`
- Test: `test/v2/looks.test.mjs`

**Interfaces:**
- Consumes: `FONTS` (Task 7), fields (Task 8), `ease` (Task 1).
- Produces:
  - `Look = { name, modes: string[], fonts: { display: Font-without-size, text, label }, palette: { paper, ink, ink2, accent, accent2, rule }, scale: [number, number, number, number, number] (units, small to large), grid: { columns: 12, margin: number, gutter: number } (units), tracking: (sizeUnits) => em, caps: { display: boolean, label: boolean }, field: { field: string, params }, emphasis: 'highlight' | 'recolor-scale', moves: Record<'enter' | 'exit' | 'emphasize' | 'draw' | 'count', { ease: string, dur: number, dist?: number, step?: number, overshoot?: number }>, wordStagger: number, camera: { drift: number, style: 'desk' | 'locked' }, cuts: string[], devices: Record<string, object>, post: { grain: number, halftone: number, bloom: number } }`.
  - `Mode = { name, defaultLook, defaultFormat, wpm, tail, maxStillSeconds, captions: boolean }`. `pro`: `desk`, `16:9`, 150, 0.6, 6, false. `viral`: `pop`, `9:16`, 175, 0.3, 3, true.
  - `gridX(look, canvas, column) -> px` and `unit(canvas) -> px per unit`.
  - `desk` (serves `pro`): display = the serif from Task 7 at weight 600, sentence case; text = `Schibsted Grotesk` 400; label = `JetBrains Mono` 400 caps tracked +0.08 em; palette `paper #f3eee3`, `ink #15130f`, `ink2 #5b554a`, `accent #ffe14a` (highlighter), `accent2 #d63a2f`, `rule #cfc7b6`; scale `[30, 44, 72, 132, 220]`; margin 96, gutter 24; field `paper`; emphasis `highlight`; moves: `enter` `outCubic` 0.5 s rise 24 units; `draw` linear 0.5 s at `step: 12`; `emphasize` 0.25 s at `step: 12`; `wordStagger` 0 (words follow their spoken times); camera `desk` with drift 12 units; cuts `['cut', 'match', 'slide']`; post grain 0.05.
  - `pop` (serves `viral`): display = the grotesque from Task 7 at weight 900, width at its narrowest reachable value, caps, tracking −0.02 em; text and label the same family at 700; palette `paper #111111`, `ink #ffffff`, `ink2 #b8b8b8`, `accent #d7ff3f`, `accent2 #ff4d2e`, `rule #2a2a2a`; scale `[36, 56, 96, 180, 320]`; margin 72, gutter 20; field `halftone` over a flat `paper`; emphasis `recolor-scale` (accent colour, scale 1.12); moves: `enter` `spring(260,16)` 0.28 s from scale 0.6; `emphasize` `spring(300,12)` 0.2 s; `draw` `outExpo` 0.2 s; camera `locked`; cuts `['cut', 'punch', 'slide']`; post grain 0.03, halftone 0.2.
  - A film's `accent` replaces `palette.accent` in a copy of the look.

- [ ] **Step 1: Write the failing tests**

```js
test('every look meets the type rules', () => {
  for (const name of registries.looks.names()) { const l = registries.looks.get(name);
    assert.ok(l.scale[4] / l.scale[1] >= 3, name + ' hero is at least 3x the supporting text');
    assert.ok(l.scale[0] >= 28, name + ' floor'); assert.equal(l.grid.columns, 12);
    for (const m of Object.values(l.moves)) assert.doesNotThrow(() => ease(m.ease));
    for (const c of l.cuts) assert.ok(['cut', 'match', 'slide', 'punch'].includes(c)); }
});
test('ink on paper passes 4.5:1 and the accent is used behind ink, not as text on paper', () => {
  for (const name of ['desk', 'pop']) { const { palette: p } = registries.looks.get(name); assert.ok(contrast(p.ink, p.paper) >= 4.5); assert.ok(contrast(p.ink2, p.paper) >= 4.5); }
  assert.ok(contrast('#15130f', registries.looks.get('desk').palette.accent) >= 4.5);
});
test('looks never animate an axis the canvas cannot reach', () => { /* for each look font with an animated axis in moves, assert FONTS reach flag is true */ });
test('each mode names a default look that serves it', () => {
  for (const n of registries.modes.names()) { const m = registries.modes.get(n); assert.ok(registries.looks.get(m.defaultLook).modes.includes(n)); }
});
```
(`contrast` is imported from `shared/contrast.mjs`; check its export name first with `grep -n "^export" shared/contrast.mjs`.)

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/looks.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/looks engine/modes test/v2/looks.test.mjs` ; `feat: v2 desk and pop looks, pro and viral modes`.

### Task 10: Devices

**Files:**
- Create: `engine/devices/highlight.mjs`, `marks.mjs` (circle, underline, arrow, bracket), `cutout.mjs`, `card.mjs`, `tag.mjs`, `punch.mjs`, `index.mjs`
- Test: `test/v2/devices.test.mjs`

**Interfaces:**
- Consumes: `node`, `track` (Tasks 1, 5), `Look` (Task 9), `mulberry32`.
- Produces: each device registered as `{ supports(look) -> boolean, build({ id, box: [x, y, w, h], at: number, look, unit, seed }) -> Node[] }`, where `box` is the target's bounding box in canvas pixels and `at` is the shot-local second on which the device must have **landed** (its tracks end at `at`, starting at `at - look.moves.draw.dur`, never before 0).
  - `highlight`: one `path` behind the target: a quadrilateral band 1.18 times the box height, corners jittered by up to 3 units from the seed, fill `palette.accent`, `reveal` 0 to 1, with the look's draw `step`. Sits at a z-order below the text (returned with `props.under: true`).
  - `underline`: a `path` stroke 6 units wide under the box, with two slight waves in `desk`, straight in `pop`. `circle`: a closed rough ellipse 1.25 times the box with a 12-unit overlap at the ends. `arrow`: a curved stroke from `from: [x, y]` (extra param) to the box edge with a two-stroke head. `bracket`: a square bracket on the box's left. All animate `draw` 0 to 1.
  - `cutout`: wraps an `image` node: a white keyline 8 units wide (the image's alpha dilated; for an image without alpha, a rounded rectangle), and a contact shadow offset `[10, 14]` units, blur 18 units, 25% alpha. In `pop` the keyline is 14 units and the shadow is a hard offset in `palette.accent2` with no blur.
  - `card`: a `path` rectangle with the look's paper tint one step lighter, a shadow, and in `desk` two tape strips (`props.tape: true`) or a torn bottom edge from the seed.
  - `tag`: a filled rectangle in `accent2` with a `text` node in the label font, caps.
  - `punch`: no nodes; returns `{ camera: [{ t: at, zoom: 1.12 }, { t: at + 0.12, zoom: 1.0, ease: 'outExpo' }] }` keys to merge into the shot camera (`build` may return `{ nodes, camera }`).

- [ ] **Step 1: Write the failing tests**

```js
test('a device lands on its anchor and never starts before 0', () => {
  const look = registries.looks.get('desk'), d = registries.devices.get('highlight');
  const [n] = d.build({ id: 'h', box: [100, 100, 400, 80], at: 1.0, look, unit: 1, seed: 1 });
  const keys = n.tracks.reveal.keys; assert.equal(keys.at(-1).t, 1.0); assert.equal(keys.at(-1).v, 1); assert.ok(keys[0].t >= 0);
  const [early] = d.build({ id: 'h', box: [100, 100, 400, 80], at: 0.1, look, unit: 1, seed: 1 });
  assert.equal(early.tracks.reveal.keys[0].t, 0);
});
test('desk marks are stepped at 12 fps, pop marks are not', () => {
  const mk = (l) => registries.devices.get('underline').build({ id: 'u', box: [0, 0, 300, 60], at: 1, look: registries.looks.get(l), unit: 1, seed: 1 })[0];
  assert.equal(mk('desk').step, 12); assert.equal(mk('pop').step, undefined);
});
test('the same seed draws the same wobble', () => {
  const b = () => registries.devices.get('circle').build({ id: 'c', box: [0, 0, 300, 100], at: 1, look: registries.looks.get('desk'), unit: 1, seed: 5 })[0].props.d;
  assert.equal(b(), b());
});
```

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/devices.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** — `git add engine/devices test/v2/devices.test.mjs` ; `feat: v2 graphic devices`.

### Task 11: Shot kinds, cuts and hero match

**Files:**
- Create: `engine/kinds/statement.mjs`, `number.mjs`, `clipping.mjs`, `index.mjs`, `engine/cuts/index.mjs`, `engine/graph/film.mjs`
- Test: `test/v2/kinds.test.mjs`, `test/v2/kinds-browser.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - Kind definition: `{ schema, targets(shot) -> string[], expand(shot, ctx) -> { nodes: Node[], camera?: keys, boxes: Record<target, [x, y, w, h]>, hero?: string } }`, with `ctx = { look, mode, canvas: { w, h }, unit, gridX, timing: TimelineShot, at(ref) -> seconds, measure, seed, asset(src) -> { url, w, h } }`.
  - `statement` fields: `text?` (defaults to the plain narration; `|` forces breaks), `kicker?` (label above, up to 40 chars). Targets: `text`, and `word:<n>` for each word. Composition: `desk` sets the text flush left from column 2 across 8 columns on 16:9 (10 columns on vertical formats), vertically at 42% of the height, fitted between scale steps 3 and 5 with at most 4 lines, optical alignment on; `pop` centres it across 10 columns, fitted between steps 4 and 5, at most 3 lines. Each on-screen word's entrance lands on the start of the spoken word it matches (matched in order by letters and digits; an on-screen word with no spoken match lands with the nearest earlier matched word; with no `say`, words stagger by 0.09 s from 0.2 s). An emphasised spoken word applies the look's emphasis to its on-screen word at its start time: `desk` builds a `highlight` on that word's box; `pop` tracks the word's `fill` to `accent` and `scale` to 1.12.
  - `number` fields: `value` (number), `prefix?`, `suffix?`, `decimals?` (0–3), `label` (up to 60), `delta?` (up to 24). Targets: `value`, `label`, `delta`. The figure counts from 0 to `value` with the look's `count` move, landing on the first spoken word that contains a digit or a number word (`one` … `twelve`, `hundred`, `thousand`, `million`, `percent`), else at 60% of the shot. Digits use `numeralAdvance`. Figure at scale step 5; `suffix` at 45% of the figure size on the cap line; label at step 2. `desk`: figure flush left at column 2, label under a `rule`-coloured hairline; `pop`: figure centred, label in a `tag`.
  - `clipping` fields: `src`, `regions?: Record<name, [x, y, w, h]>` (fractions of the image, each 0–1), `caption?`. Targets: `image`, `caption`, `region:<name>`. The image is a `cutout` in a `card`, rotated −2° in `desk` (0° in `pop`), filling 62% of the short side, entering from below; a `highlight` or `circle` on a `region:` target is positioned from the region's fractions; the camera pushes to zoom 1.25 centred on the first targeted region, landing at that event's time.
  - `on` events: for each `{ at, do, target }`, `devices.get(do).build({ box: boxes[target], at: ctx.at(at), … })`, merged into the shot's nodes (or camera).
  - `cuts`: `registries.cuts` entries `{ dur: number, apply({ from: Sampled[], to: Sampled[], p: number, canvas, look }) -> Sampled[] }`. `cut`: `dur` 0. `slide`: 0.4 s, the outgoing frame moves left one canvas width while the incoming enters from the right, `inOutCubic`. `punch`: 0.2 s, incoming starts at zoom 1.15 and settles, `outExpo`. `match`: 0.5 s; nodes whose `id` exists in both shots interpolate `x, y, scale, rotate, opacity` and `bbox` from their last outgoing state to their first incoming state with `inOutCubic`; all other outgoing nodes fade in the first 40%, all other incoming nodes in the last 60%. A `match` cut between shots with no shared id is a validator error added in `validateFilm`: `shots[i].cut: "match" needs a node id shared with shot "<prev>"; shared ids come from "hero"` — and each kind accepts an optional `hero: "<id>"` field that names its main node (the statement text, the number figure, the clipping image).
  - `buildFilm({ film, timeline, measure, assets }) -> { duration, frameCount, sampleAt(t) -> Sampled[] }`: expands every shot once, places each shot's nodes on the global clock, runs cuts inside the first `dur` seconds of the incoming shot, applies the camera. `engine/page/stage.mjs` now uses it.

- [ ] **Step 1: Write the failing tests** (fake measure as in Task 2; `ctx` built by a small helper in the test file):

```js
test('statement words land on their spoken words', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', say: 'One file. No server.' }, 'desk');
  const text = nodes.find((n) => n.type === 'text'), spoken = timing.words;
  text.wordTracks.forEach((w, i) => assert.ok(Math.abs(w.opacity.keys.at(-1).t - spoken[i].start) < 1e-6));
});
test('an emphasised word gets the look\'s emphasis and nothing else', () => {
  const desk = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'desk').nodes;
  assert.equal(desk.filter((n) => n.props.under).length, 1);
  const pop = expandShot({ id: 'a', show: 'statement', say: 'It is *lying* to you.' }, 'pop').nodes;
  assert.equal(pop.filter((n) => n.props.under).length, 0);
  assert.ok(pop.find((n) => n.type === 'text').wordTracks[2].fill);
});
test('a number lands its count on the spoken figure', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', say: 'We saved forty one percent.', value: 41, suffix: '%', label: 'saved' }, 'desk');
  const fig = nodes.find((n) => n.id === 'n.value'); assert.ok(Math.abs(fig.tracks.value.keys.at(-1).t - timing.words[2].start) < 1e-6);
});
test('a match cut with no shared id is a validator error', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hi.' }, { id: 'b', show: 'number', cut: 'match', value: 1, label: 'x', hold: 2 }] }, { specDir });
  assert.match(r.errors[0].message, /"match" needs a node id shared with shot "a"/);
});
test('a missing clipping image is an error with its path, exit 2', () => { /* loadFilm throws SpecError naming shots[0].src and the path */ });
test('a 30-word statement on 9:16 reports overflow', () => {
  const { nodes } = expandShot({ id: 'a', show: 'statement', hold: 3, text: Array(30).fill('paragraph').join(' ') }, 'pop', '9:16');
  assert.equal(nodes.find((n) => n.type === 'text').props.layout.overflow, true);
});
```
`kinds-browser.test.mjs`: render frame at 80% of a one-shot film for each of the three kinds in each look and assert the screenshot is not a flat colour (more than 500 distinct pixel values) and equals itself on a second seek.

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/kinds.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — also `node --test --test-concurrency=1 test/v2/kinds-browser.test.mjs`.
- [ ] **Step 5: Commit** — `git add engine/kinds engine/cuts engine/graph/film.mjs engine/page/stage.mjs scripts/v2/spec.mjs test/v2/kinds.test.mjs test/v2/kinds-browser.test.mjs` ; `feat: v2 statement, number and clipping shots with cuts`.

### Task 12: Post pass, frame review, render, sheets and the one command

**Files:**
- Create: `engine/page/post.mjs`, `engine/review/frame.mjs`, `scripts/v2/render.mjs`, `scripts/v2/sheets.mjs`, `scripts/make.mjs`
- Test: `test/v2/review.test.mjs`, `test/v2/make.test.mjs`, `test/v2/post-browser.test.mjs`

**Interfaces:**
- Consumes: all tasks above; `findFfmpeg`, `encodeArgs`; `parseCli`, `UsageError`.
- Produces:
  - `post.mjs`: `createPost(canvas, { grain, halftone, bloom, seed }) -> { kind: 'webgl2' | '2d', render(sourceCanvas, t) }`. WebGL2: one fragment shader sampling the 2D frame: bloom (8 taps above 0.7 luminance, strength `bloom`), halftone overlay (strength `halftone`), grain from a hash of pixel position and `floor(t * 12)` (strength `grain`), `preserveDrawingBuffer: true`, `antialias: false`. If `getContext('webgl2')` returns null, `2d`: draw the source and a cached noise tile at `grain` alpha.
  - `auditFrame(sampled: Sampled[], { look, canvas, mode, shotId, t }) -> Finding[]`, `Finding = { kind: 'mechanical' | 'creative', path: string, message: string }`. Rules: a text `layout.overflow` → creative `shots[<id>]: text does not fit at the 28-unit floor; cut words`; more than 3 distinct text sizes visible → creative; hero (largest visible text) less than 3 times the smallest visible text when both exist → creative; a visible text bbox outside the safe insets (`safeInsets`) while its entrance has landed → mechanical; two visible text bboxes overlapping by more than 4 units → mechanical; a visible text smaller than 28 units → mechanical; a text line of more than 12 words in `pro` or a statement of more than 7 words in the first shot of `viral` → creative.
  - `renderFilm({ specPath, out, exact: true, onProgress? }) -> { out, frames, captured, seconds, post }`: starts the server and browser, for each frame calls `__stateKey(i)`; when equal to the previous key reuses the previous PNG buffer, else `__seek(i)` and `page.screenshot({ type: 'png' })`; pipes PNGs to ffmpeg (`image2pipe`, H.264, yuv420p, `encodeArgs`). `captured` counts real screenshots.
  - `writeSheets({ specPath, dir }) -> string[]`: per shot, one PNG tiling frames at the shot's start + 0.1 s, its middle, 85%, and each `on` event's landing time + 0.05 s, plus the 85% frame at 360 px wide; per cut, one strip of 5 frames from 0.2 s before to 0.2 s after. Tiles are stamped `<shot id> · <seconds>s`. Runs `auditFrame` on each sampled frame and returns the findings too: `{ files, findings }`.
  - `scripts/make.mjs <film.json> [--out <file.mp4>] [--json] [--sheets-only] [--outline] [--list kinds|looks|modes|devices|cuts|fields]`. Unknown flags and unknown `--list` values exit 2 listing the accepted ones. Stages in order: validate → timeline → sheets and review → render. With `--json` it prints exactly one JSON object: `{ ok, output, timed: 'estimated', post, stages: [{ name, ok, seconds }], findings }`; `ok` is false when validation fails or any `mechanical` finding exists (the MP4 is still rendered when validation passed). Without `--json` it prints `valid`, then one line per finding (`<kind>: <path>: <message>`), then the output path, frame count and `captured`. `--outline` prints one line per shot (`<id>  <show>  <start>–<end>s  "<plain narration>"`) and stops. Output defaults to `out/<spec name>.mp4` next to the spec; sheets go to `out/sheets/`.

- [ ] **Step 1: Write the failing tests**

```js
// test/v2/review.test.mjs — sampled frames built by hand
test('overflow is a creative finding that names the shot', () => {
  const f = auditFrame([textNode({ overflow: true })], ctx); assert.deepEqual(f.map((x) => x.kind), ['creative']); assert.match(f[0].message, /cut words/);
});
test('text outside the safe area is mechanical', () => { /* bbox x = 10 on 1920 wide: one mechanical finding */ });
test('a clean frame has no findings', () => { assert.deepEqual(auditFrame([textNode({ size: 132 }), textNode({ size: 44, y: 700 })], ctx), []); });
```
```js
// test/v2/make.test.mjs
test('--outline needs no browser and prints one line per shot', () => { /* spawnSync node scripts/make.mjs gate.json --outline; status 0; lines === shots */ });
test('an unknown flag exits 2 and lists the accepted ones', () => { /* --fast → status 2, stderr matches /--out, --json, --sheets-only, --outline, --list/ */ });
test('--json prints one object with stages and findings', async (t) => { /* skip without browser or ffmpeg; parse stdout; assert keys and that the mp4 exists and ffprobe reports h264 yuv420p and the expected frame count */ });
test('a held shot is not re-captured every frame', async (t) => { /* a 2 s shot whose entrance ends at 0.5 s with camera drift 0: report.captured < report.frames */ });
```
`post-browser.test.mjs`: a frame with the post pass on differs from the same frame with `grain: 0, halftone: 0, bloom: 0`, and hashes the same twice.

- [ ] **Step 2: Run and see them fail** — `node --test test/v2/review.test.mjs test/v2/make.test.mjs`.
- [ ] **Step 3: Implement.** Prove the mechanical gate fires: run `make.mjs` on a film with a text forced off-canvas through a `free` shot and confirm `ok: false`.
- [ ] **Step 4: Run and see them pass** — browser tests with `--test-concurrency=1`. Then the whole version 2 suite: `node --test --test-concurrency=1 "test/v2/**/*.test.mjs"`, and the version 1 suite untouched: `npm test` (report its result; it must be as green as before this plan).
- [ ] **Step 5: Commit** — `git add engine/page/post.mjs engine/review scripts/v2/render.mjs scripts/v2/sheets.mjs scripts/make.mjs test/v2/review.test.mjs test/v2/make.test.mjs test/v2/post-browser.test.mjs` ; `feat: v2 post pass, frame review, render, sheets and make.mjs`.

### Task 13: Gate films and the look quality gate

**Files:**
- Create: `references/examples/v2/gate-desk.json`, `references/examples/v2/gate-pop.json`, `references/examples/v2/clipping.png`
- Create: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` (the gate's record)

**Interfaces:**
- Consumes: `scripts/make.mjs`.

- [ ] **Step 1: Write the two films** (the orchestrator, as director, writes these; not delegated). Each has five shots using all three kinds, at least one `match` cut, one `on` event per kind, and emphasis in the narration. `gate-desk.json`: `mode: pro`, `look: desk`, 16:9. `gate-pop.json`: `mode: viral`, `look: pop`, 9:16. Subject: what portable-artifacts does. `clipping.png` is a screenshot produced by building one of make-dashboard's own examples (`node ../make-dashboard/scripts/build.mjs <example>` then a Playwright screenshot of the page), so no outside image is used.
- [ ] **Step 2: Render both** — `node scripts/make.mjs references/examples/v2/gate-desk.json --json` and the same for `gate-pop.json`, one after the other. Both must report `ok: true`.
- [ ] **Step 3: View every sheet** in `out/sheets/` with the Read tool and write, per shot, one sentence describing the frame as a stranger would see it, then ranked notes `time · where · problem → change · what stays`.
- [ ] **Step 4: Independent look review.** Dispatch one fresh reviewer agent (reviewer tier, report only) with the sheet paths and this brief and nothing else: the frames come from an editorial paper-collage look and a short-form caption look; list every place a frame looks default, templated or unbalanced (centred by habit, weak scale contrast, uneven margins, awkward line breaks, texture without purpose, a device that does not point at anything); rank by severity; say for each frame whether it would pass as professional work.
- [ ] **Step 5: Revise and repeat** Steps 2–4 at most twice. The bar: zero `mechanical` findings, zero `creative` findings, and the reviewer passes every frame. Record in the gate report: the commands run, the findings of each round, the final sheet paths, and the verdict. If the bar is not met after two revisions, stop engine work and take the frames to the owner.
- [ ] **Step 6: Send the owner the final sheets** as a status update (no reply awaited), commit `git add references/examples/v2 docs/superpowers/plans/2026-11-15-pa2-gate-report.md` ; `feat: v2 gate films for the desk and pop looks`.

---

## After this plan

Written when the gate passes, because the design fixes their interfaces only then: voice and sync (design section 9); the remaining kinds, the other five looks (`cosmos` first), captions, full review and fast capture; cut-over and docs; director and operator across the five skills; the refresh of the other four skills; the showreel.
