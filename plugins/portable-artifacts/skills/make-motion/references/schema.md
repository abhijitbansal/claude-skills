# The film file, version 2

A film is one JSON object: the root fields below and a list of shots. `node scripts/make.mjs film.json --outline` checks a film with no browser. Every error is `<path>: <message>`, where the path names the field (`shots[2].say`) and the message says what to write instead.

This page lists the root fields, the fields every shot takes, the markup in `say`, anchors, sound, cuts, the `--list` names, the report and the exit codes. It does not copy the fields of each kind. For those, run `node scripts/make.mjs --list kinds`: it prints each kind's fields (`*` marks a required one) and one example shot to copy.

```json
{
  "version": 2,
  "mode": "pro",
  "look": "desk",
  "shots": [
    { "id": "hook", "show": "statement", "say": "Numbers need *sources*.", "kicker": "The problem" },
    { "id": "rows", "show": "number", "say": "Four hundred fifty nine rows. One file.", "value": 459, "suffix": "rows", "label": "in one file" }
  ]
}
```

## Root fields

An unknown root field is an error. Only `shots` and `version` are required.

| Field | Type | Meaning |
|---|---|---|
| `version` | `2` | Required. Any other value is an error; a version 1 spec gets the message in `references/migrating.md` |
| `shots` | array of 1 to 60 shots | Required. The script of the film |
| `mode` | `"pro"` or `"viral"` | Default `pro`: 16:9, 150 words a minute. `viral`: 9:16, 175 words a minute (`--list modes`) |
| `look` | a look name | Default: the mode's own look (`desk` for `pro`, `pop` for `viral`). A look serves the modes it names (`--list looks`) |
| `format` | `"16:9"`, `"9:16"`, `"1:1"` or `"4:5"` | Default: the mode's own format |
| `fps` | 24, 25, 30 or 60 | Default 30 |
| `seed` | integer, 0 to 7918 | Default 1. Looks draw their random marks from it, so one seed gives the same frames |
| `accent` | `"#rrggbb"` | Replaces the look's accent colour |
| `cut` | a cut | The default cut of every shot after the first (see Cuts) |
| `voice` | `{ "name": "af_heart" }` or `{ "src": "vo.wav", "words": "vo.json" }` | Narration. The first shape is made on this machine. The second is a recording of your own with its word times. See Sound |
| `music` | `{ "bed": "pulse", "bpm": 92 }` or `{ "src": "track.mp3", "beats": "track.beats.json", "snap": true }` | A music bed or a file. See Sound |
| `sound` | `"on"` or `"off"` | `on` plays the designed sound cues. In `viral` they play unless the film says `off` |
| `cues` | array of up to 64 `{ "at", "cue" }` | Your own sound cues. See Sound |
| `audio` | array of up to 20 `{ "src", "at" }` | Extra sound files. See Sound |
| `captions` | boolean | Draws the narration as captions, on shots whose kind does not show its own words. Off by default |
| `loop` | boolean | `true`: the review checks that the last frame matches the first |
| `vars` | object | Typed names for `{{name}}` in the film (see Variables) |
| `generatedBy` | `{ "model", "effort", "agent" }` | Which model wrote the film. Each value is 1 to 60 letters, digits, spaces and `. _ : / ( ) + [ ] -`. Written into the MP4's metadata |
| `provenance` | boolean | `false` leaves the authoring tags out of the MP4, as `--no-provenance` does |

## Fields every shot takes

A kind adds its own fields on top (`--list kinds`). A shot with a field its kind does not have is an error.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Required. A lowercase letter, then lowercase letters, digits and hyphens. Unique in the film |
| `show` | string | Required. The kind: one of the sixteen in `--list kinds` |
| `say` | string, 1 to 400 characters | The narration of the shot. It sets how long the shot lasts |
| `hold` | number, 1 to 30 | Seconds a shot with no `say` lasts. A shot takes `say` or `hold`, never both |
| `cut` | a cut | How the film arrives at this shot (see Cuts). The first shot takes only `"cut"` |
| `on` | array of up to 8 events | Devices placed on words of the narration (see Anchors) |

## Narration markup

Marks inside `say`. On-screen text never shows them.

| Mark | Meaning |
|---|---|
| `*word*` | Emphasis: stress, a short slow-down, and the look's emphasis mark on the matching words on screen |
| `_word_` | An aside: quicker |
| `...` or `…` | A pause of 0.35 seconds |
| `(0.4)` | A pause of that many seconds, 0.05 to 3. Only a number with a decimal point is a pause, so `(2024)` is text |
| `[word](/ipa/)` | A pronunciation hint, in the phoneme characters of the voice |
| `\*`, `\_`, `\\` | A literal star, underscore or backslash |

Marks inside a word (`snake_case`, `a*b`) are text. Two of the same mark in a row (`**x**`) are text. Nested marks of one kind are an error.

## Anchors

An anchor says when in a shot something happens. It is a number of seconds from the start of the shot, or one of these, each optionally followed by `+<seconds>` or `-<seconds>`:

| Form | Where |
|---|---|
| `start` | The first moment of the shot |
| `end` | The last moment of the shot |
| `word:<n>` | The start of word `n`, counting from 0 |
| `word:<text>` | The start of the first word that matches the text, ignoring case and punctuation |
| `sentence:<n>` | The start of sentence `n`, counting from 0 |

`beat:<n>` is refused. Cut to music with `music.beats` and `music.snap`. An anchor that lands more than one frame outside its shot is an error.

An event in `on` is `{ "at": <anchor>, "do": <device>, "target": <target> }`. `at` and `do` are required. `do` is one of `--list devices`. `target` is a region of the shot (`region:query`) or one of the parts the kind names. A device the look does not draw is an error that lists the devices it does.

## Sound

Sound is opt-in. A film with none of `voice`, `music`, `sound`, `cues` or `audio` has no sound track.

- **`voice`**: `{ "name": "af_heart" }` makes the narration on this machine (`--list voices`). `{ "src": "vo.wav", "words": "vo.json" }` uses a recording of your own, with the word times as a Whisper JSON file; it takes both, and a name and a recording together is an error.
- **`music`**: `{ "bed": "pulse" | "drift" | "tape", "bpm": 60 to 180 }` is a bed made on this machine, and it follows the cuts. `{ "src": "track.mp3" }` is a file of your own. A file may add `beats` (the grid file `scripts/beats.mjs` wrote for it) and `snap: true`, which moves the cuts onto the beats. `snap` needs a film with no narration. A bed and a `src` together is an error.
- **`cues`**: `[{ "at": 2.5, "cue": "pop" }]`. `at` is seconds from the start of the film, or an anchor. The cue is one of `pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `drop`, `ding`, `sub`, `paper`, `marker`, `erase`.
- **`audio`**: `[{ "src": "sounds/ding.wav", "at": 3 }]`. `at` is seconds from the start, 0 or more.

Every `src` is a file inside the film's folder. A URL, an absolute path or a path that leaves the folder is an error.

## Variables

`vars` declares up to 30 typed names: `{ "name": { "type": "string", "default": "Ada" } }`. A type is `string` or `number`, and every var has a default. `{{name}}` in any string of the film becomes the value; `{{{{` is a literal `{{`. A file path (`src`, `words`, `beats`) takes no var. A value placed in a `say` has its marks escaped. `make.mjs film.json --batch rows.json --out "renders/{name}.mp4"` renders one film per row of values; the `--out` needs `{index}` or a `{var}`.

## Cuts

A cut is a name (`"slide"`) or an object `{ "type": "slide", "direction": "up", "duration": 0.5, "smear": true }`. Only `type` is required. `direction`, `duration` and `smear` apply to the cuts that take them. `--list cuts` prints each cut with its family, directions, default length and an example. A cut must be one the look lists: the error names the cuts it has. `"cut": "match"` carries the node two shots share across the cut, so both shots need a node with the same id (see `hero` in `--list kinds`).

## The `--list` names

`node scripts/make.mjs --list <name>` prints one of these. Add `--json` for JSON. `--all` adds the experimental looks and the parked kinds.

| Name | Prints |
|---|---|
| `kinds` | Every kind of shot: its fields and one example |
| `looks` | The looks |
| `modes` | The modes, with their pace |
| `devices` | The devices an `on` event can place |
| `moves` | The motion values each look gives each move |
| `cuts` | The cuts, their directions and lengths |
| `fields` | The backgrounds a look can draw |
| `voices` | The voices `voice.name` accepts |

## The report

`make.mjs --json` prints one object on stdout. Every path gives the same keys.

| Key | Meaning |
|---|---|
| `ok` | `true` when the film validated, no finding is `mechanical`, and nothing stopped the run |
| `output` | The MP4 path, or `null` when none was written |
| `sheets` | The review PNGs, one per shot and one strip per cut |
| `timed` | `"measured"` or `"estimated"`: whether shot lengths come from a made voice or from word counts. `null` before a timeline exists |
| `voice` | `{ cached, seconds, model }` for a film whose voice was made, else `null` |
| `audio` | `{ lufs, truePeakDb, note, cues, music }` of the sound, else `null` |
| `post`, `capture` | How the frames were drawn and captured |
| `stages` | `[{ name, ok, seconds }]` for each stage that ran |
| `frames`, `captured` | Frames in the film, and frames actually captured |
| `seconds`, `msPerFrame`, `bytes`, `mbps` | Render time, time per frame, file size and bit rate |
| `findings` | `[{ kind, shot, path, message }]` (see below) |
| `provenance` | `{ comment, artist }` as stamped into the MP4, or `null` |

These keys appear only when they apply: `poster`, `workers`, `subtitles`, `cuts`, `look` (an experimental look), `kinds` (the parked kinds the film uses), `error`.

A finding is `mechanical` or `creative`. A `mechanical` finding names a JSON `path` and says what to change; it makes `ok` false. A `creative` finding is a call for the author and never fails the run. A parked kind is not a finding: it renders, and the report's `kinds` lists it.

`error` is `{ message, hint }`. It is set when something about the machine stopped the run (a missing film file, no browser, no ffmpeg, a crashed page, an interrupt). A fault in the film is a finding, not an error.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The film is valid and has no mechanical finding |
| 1 | The film is invalid, or a mechanical finding exists (the MP4 is still written when the film validated) |
| 2 | A usage error, or trouble with the machine. `error` says which and how to fix it |
| 130 | Stopped by SIGINT or SIGTERM. The report keeps what was done |

## Limits

| What | Limit |
|---|---|
| Shots in a film | 60 |
| Characters in a `say` | 400 |
| `hold` | 1 to 30 seconds |
| Events in `on` | 8 per shot |
| Variables | 30 |
| Sound cues | 64 |
| Extra audio files | 20 |
| `--workers` | 1 to 8, or `auto` |
