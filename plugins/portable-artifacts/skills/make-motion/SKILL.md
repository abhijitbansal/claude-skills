---
name: make-motion
description: Use when the user wants a short explainer video, animated and rendered to MP4 from a script of shots (statements, numbers, lists, quotes, comparisons, charts, maps, timelines, diagrams, code, screenshots, and photos or clips with highlights), in one of several looks from editorial to a hand-drawn whiteboard, as a widescreen film or a vertical short for Reels, TikTok and Shorts, silent or with a local voiceover, a music bed and sound cues, previewed locally. Spec-driven and offline except the one voice model download. Not for a static page or diagram (make-explainer, make-diagram) or a recording of a running app.
argument-hint: what to make, e.g. an 8s clip with Q3 revenue up 18% then a bar chart of Q1-Q3
---

# make-motion

You write one JSON file, `film.json`: a script of shots. Each shot shows one thing (a `statement`, a `number`, a `chart`, a `map` and so on) over the sentences that narrate it. One command, `node <skill-dir>/scripts/make.mjs film.json --json`, checks the film, writes review sheets and renders the MP4. You never write animation code, and you never edit generated output.

Run every command from the project folder (where `film.json` lives), using the full path to the scripts. File paths in the film resolve relative to the film file. If the request is empty, ask what the film should say, how long it should be, and the format. Before writing a film, run the Intake (one round) section below; the answers go into the film, and the hand-off brief carries only paths.

**Audio is opt-in.** Add a `voice`, `music` or `sound` only when the prompt asks for sound (music, soundtrack, voiceover, narration, "read it aloud", a sound effect, a click or a whoosh) or the user confirms when you ask. Never add audio to a prompt that does not mention it. A music or voice file the user names, in the prompt or in the intake round, counts as asking for that track. When the prompt is about sound but unclear (for example "make it feel polished" with an mp3 in the folder), put it in the intake round (see Intake (one round)) rather than asking separately. In `viral` mode the designed sound cues play unless the film says `"sound": "off"`: write that line when the prompt asks for a silent film.

## Director and operator

You are the director: you run the intake, write the spec, view what was built and decide every `creative` finding. A cheaper operator agent only runs the one command and fixes `mechanical` findings.

The command is `node <skill-dir>/scripts/make.mjs <spec> --json` (add `--out <path>` to name the output). It checks the spec, builds, checks the result and prints one report: `ok`, `output`, `stages`, `findings`. A `mechanical` finding names a JSON path to change and makes `ok` false. A `creative` finding is a call for you and never a failure.

Hand off with the first rung that works, unless you are already artifact-builder (then run the command, fix only `mechanical` findings, as your own instructions say, and do not hand off again):

1. Write the spec first. If `artifact-builder` is in your list of available agents (a plugin may list it as `<plugin>:artifact-builder`), start that agent with three things: this skill directory (the full path of the folder that holds this SKILL.md), the spec path (the file already exists) and, optionally, the output path. It has no memory of this conversation and needs nothing else. Do not choose a model for it: its own file names one.
2. No such agent, or it fails or cannot start: run the same command yourself.

Trust the report and the output file, never the operator's prose. You take over (fix it yourself and rerun) when the same `mechanical` finding survives two operator attempts, or when its path is empty (the operator may change nothing).

Before you report, view what was built: the files listed under `sheets` in the report (make-motion), or the page through `node <skill-dir>/shared/shot.mjs <output>` when that file exists, then open each PNG it prints. Fix what you see and decide each `creative` finding.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <film.json>` once the film exists, `--for voiceover` before a voiceover, and `--for cutout` before a cutout). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for voiceover`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Intake (one round)

Before writing the film, ask once. Send one message that lists every option below with its default, so the user can answer in one reply, or say "defaults". Ask before you write the film, and put the answers in the film. Leave out an option the prompt already settles ("a vertical short", "with a voiceover") and say what you took from it. If the prompt already settles every option that matters, skip the round and build. Then build; do not ask again.

- **mode**: `pro` (default), a calm 16:9 explainer, or `viral` for a fast vertical short for Reels, TikTok and Shorts (`"mode": "viral"`: 9:16, the first shot reads from frame 0). A platform in the prompt sets `viral`.
- **look**: how it is drawn. Default: the mode's own, `desk` for `pro` and `pop` for `viral`. Write the name as the film's `look`. The looks, with a line on each:
  - `desk`: editorial paper collage, warm paper, a display serif and a highlighter
  - `pop`: short-form caption collage, a near-black field, one heavy condensed face and an acid accent
  - `cosmos`: flat vector science explainer, deep navy to violet, one glowing accent
  - `ledger`: newsroom data film, off-white paper on a hairline grid, one signal red
  - `poster`: kinetic type and cut paper, heavy condensed capitals on one flat ground a shot
  - `keynote`: product launch film, a near-white ground with a soft mesh and product screens on cards
  - `marker`: whiteboard time-lapse, a hand draws every stroke in one black marker and one accent colour, nothing fades in. A prompt that asks for a whiteboard, a hand-drawn look or "drawn by hand" sets it without asking
- **format**: `16:9` (default for `pro`), `9:16` (default for `viral`), `1:1` or `4:5`. Write the name as the film's `format`; it sets the size.
- **length**: default about 30 s for `pro` and about 15 s for `viral`, unless the content needs more. The narration sets each shot's length, at the mode's pace in words a minute (`--list modes` prints it), so write to the length you want. A film over 20 s also gets the storyboard step (Workflow).
- **assets**: pictures, screenshots, a logo or clips in the project folder. Default: none, so the film is built from type, numbers and drawn shapes. A picture a prompt names is used as given.
- **voice**: narration made on this machine. Default: off; the film then has no sound, and each shot's length is estimated from its words. Saying yes means a one-time install of the voice package (about 227 MB installed) and its model (about 93 MB), and the doctor run in Before the first build reports their size and asks again before it installs. Captions are a separate switch, `"captions": true`, off by default.
- **music**: a synthesised bed (`pulse`, `drift` or `tape`), a music file the user supplies, or none. Default: none. Naming a file here counts as asking for that track.
- **sound**: short synthesised cues (pop, click, whoosh, chime, impact, riser, swoosh, drop, ding, sub, paper, marker, erase), or none. Default: none in `pro` (the film says `"sound": "on"` to have them); in `viral` they play unless the film says `"sound": "off"`. The audio opt-in rule above stands.
- **ask**: the closing line and what to do (for example "Try it free at example.com"), which becomes the closing `end` shot's `ask`. Default: none.

If the prompt asks you to build and you cannot pause for an answer, skip the round and build with the defaults. That covers `claude -p`, `codex exec`, `copilot -p`, the eval, or any run that cannot pause for an answer. Do not ask a question in place of a film. Your final report then carries one line with the value you actually used for each option, not the defaults when the prompt settled something else:

`intake: skipped (<reason>); values used: mode <mode>, look <look>, format <format>, length <seconds> s, assets <files or none>, voice <on or off>, music <bed, file or none>, sound <on or off>, ask <text or none>`

Fill `<reason>` with why you could not ask. `voice`, `music` and `sound` together are the audio: when all three are off, the final report also says `audio: none (opt-in; say "with a voiceover" to add one)`. With nothing settled by the prompt the line reads `mode pro, look desk, format 16:9, length 30 s, assets none, voice off, music none, sound off, ask none`.

## Running the commands

- Run one plain command per call, with literal absolute paths: write `<skill-dir>` out in full, never through a shell variable.
- No heredocs, no sed -i and no inline scripts: write the film and other files with your file-writing tool. If that tool fails, say so; do not work around it with a shell script.
- No cd, no && or ; chains, no shell variables and no pipes. Run from the project folder, and do not follow a command with an echo of its exit code.
- `make.mjs` prints progress lines to stderr and, with `--json`, one JSON report on stdout: `ok`, `output`, `sheets`, `findings` and `error`. That output is the result. Exit 0 ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted.

## Workflow

Run every step yourself, in this same turn, with your shell or file tools. Do not end your reply after showing or describing the JSON: keep going until `make.mjs` has printed its report and the output file exists.

1. Write `film.json` in the project: `{ "version": 2, "shots": [...] }` with the `mode`, `look` and `format` the intake settled. Start from a shot's example (see Looking things up) or a finished film in `<skill-dir>/references/examples/v2/`. Actually create the file: describing it or announcing a patch is not enough. Confirm the file exists before running anything. If your file tool fails, say so and give the user the JSON and the path; do not work around it with a shell script. The root fields, the fields every shot takes and the report are in `<skill-dir>/references/schema.md`. How to write for the picture is in `<skill-dir>/references/story.md`. A version 1 spec (one with `scenes`) is refused at validation; `<skill-dir>/references/migrating.md` says how to move it.
2. Outline: `node <skill-dir>/scripts/make.mjs film.json --outline` checks the film and prints each shot with its start, end and narration, with times estimated from the word counts. It needs the skill's npm packages (`--fix node_modules`), not a browser or ffmpeg: no voice is made. Fix every line it prints (`<json.path>: <message>`).
3. Storyboard (only for a film over 20 s): `node <skill-dir>/scripts/storyboard.mjs film.json --out plan.json` writes a make-explainer `plan` page for the user to answer, and prints its path and the command that builds it. Pass `--non-interactive` when you cannot ask (the cases in the intake). If it prints `storyboard: skipped (<reason>)` it wrote nothing: build the film directly and repeat that line in your final report.
4. Preview (only when a person is there to stop it): `node <skill-dir>/scripts/make.mjs film.json --preview` serves a page on localhost with a scrubber and keeps running until you stop it; `--open` also opens it. Never start it in a run that cannot be stopped (the eval, `claude -p`).
5. Voice (only when asked; run the doctor with `--for voiceover` first, and if the user declines the install, build the film silent): write `"voice": { "name": "af_heart" }` at the root. `node <skill-dir>/scripts/make.mjs --list voices` prints the voices there are. `--phonemes` prints how each sentence will be read; use it on a word with more than one pronunciation (resume and résumé, lead, read, live, record) and respell a misread word in the `say` text until it reads as you want.
6. Build: `node <skill-dir>/scripts/make.mjs film.json --json` validates the film, measures its timeline, reviews every shot in a browser, writes the sheets and renders the MP4 to `out/<name>.mp4` beside the film (`--out <file>.mp4` names it); the sheets go to `<name>.sheets/` beside the MP4, one PNG per shot and one strip per cut. Add `--sheets-only` to write the sheets without the MP4. Every finding in the report is `mechanical` (a JSON `path` and a message: change that and run again; it makes `ok` false) or `creative` (a call for you, never a failure).
7. Look: open every sheet PNG and look for clipped or overlapping text, an empty frame, a picture that hides its words, and a look that does not suit the content. Then write `review.md` next to the film: each shot described in one sentence as a stranger would see it, then ranked notes in the form `time · where · problem → change · what stays`. Measurements outrank the eye: you cannot listen, so never write that the audio sounds right, only what the report printed. Fix the film (only the shots the notes name) and run step 6 again until `ok` is true.
8. Set `generatedBy` in the film with the keys `model`, `effort` and `agent` (your host), for example `"generatedBy": { "model": "claude-opus-5-5", "effort": "low", "agent": "Claude Code" }`. Never guess; leave out any key you do not know. `--model`, `--effort` and `--agent` on `make.mjs` override it, and `--no-provenance` leaves the authoring tags out of the MP4.
9. When asked for more: `--poster <seconds> [--poster-out <file>.jpg|.jpeg|.png]` writes one still instead of the MP4; `--subtitles srt` (or `vtt`) writes a subtitle file; `--workers 4` (or `auto`) captures frames in parallel; `--exact` captures every frame as a PNG. For one film per row (a name, a city, a customer) declare `vars` in the film, `{ "name": { "type": "string", "default": "Ada" } }`, write `{{name}}` where each value goes, give every var a default, put the values in a rows file (a JSON array of objects whose keys are the var names) and run `node <skill-dir>/scripts/make.mjs film.json --batch rows.json --out "renders/{name}.mp4"` (the `--out` needs `{index}` or a `{var}`).
10. Cutting to the user's music (only when the prompt names music to cut to; needs ffmpeg): `node <skill-dir>/scripts/beats.mjs data/music.wav` finds the beat grid and writes `data/music.beats.json` beside it, printing the path and `120.17 BPM, 20 beats` (`--out file.json` names it; it never overwrites the audio). Then write `"music": { "src": "data/music.wav", "beats": "data/music.beats.json", "snap": true }` so the cuts move onto the beats. Exit 1 with `no steady beat found` means the track has no steady beat: let the narration set the cuts, or lower `--min-confidence` only if you can hear a beat. Check the `bpm` it prints against the track: it can be half, double or 2/3 of the tempo you hear. `--bpm 128` forces the grid at an exact tempo; for a tempo you know only roughly, give `--min-bpm` and `--max-bpm` from about 0.8 to 1.25 times it. Known misreads, each fixed one of those two ways: a kick on 1 and 3 from about 115 BPM (half), a slow groove with ghost notes below about 75 (double), bossa (half, 2/3 or double), polka (2/3), 6/8 (its eighth notes) and anything below 60 BPM (no beat). A reggae one-drop reads at double and a swing of 70 ms or more reads at half on the straight hits: keep those reads. Sparse clicks under heavy noise are refused: give `--bpm`. Narration can pass the gate: `--min-confidence 0.6` refuses it. No flag fixes a ritardando or a song that changes tempo.

When asked for a change ("slow shot 2", "make the title shorter"), edit only the fields the request names in `film.json`, then run step 6 again. Do not rewrite the film from scratch.

When done, report the film path, the MP4 path with its duration and size, one line per shot, the folder of sheets you looked at, the findings left, and the audio: `voice`, `music` and `sound` as used, or `audio: none (opt-in; say "with a voiceover" to add one)`.

Sharing: the MP4 is one file you can send as is; the preview page is for this machine. If your host can publish a file to a link, publish the MP4 (check its size first). Keep films that show personal contacts or private data local unless the user asks to publish.

## Narration and anchors

- `say` is the narration of a shot, and it sets the shot's length: its words at the mode's pace, plus a short tail. A shot with no narration takes `hold` (seconds). A shot takes `say` or `hold`, never both.
- Write for the ear: short sentences, one idea each. A list, a timeline or a feed shows one item per sentence, in order. Mark the words that carry the point with stars (`*came from*`), but only a few.
- An anchor ties an event to a spoken word: `"on": [{ "at": "word:query", "do": "highlight", "target": "region:query" }]`. `at` names a word of this shot's narration as `word:<word>`, `do` is a device (`--list devices`) and `target` is a region of the shot or one of its parts. An anchor that falls outside its shot is a `mechanical` finding.
- `cut` on a shot names how the film arrives at it (`"cut"`, `"slide"`, `"crossfade"`, `"punch"`, `"match"` and the rest of `--list cuts`); each cut lists the looks whose palette has it. In `viral` a picture may sit still for 3 s, in `pro` for 6 s (`--list modes`).
- `music` is `{ "bed": "pulse", "bpm": 92 }` or a file (step 10). `"sound": "on"` turns on the designed cues; a `cues` list, `[{ "at": 2.5, "cue": "pop" }]`, places your own. `audio` adds extra sound files, `[{ "src": "ding.wav", "at": 3 }]`. All of it stays off unless asked for.

## Looking things up

Look here before you invent a field. `node <skill-dir>/scripts/make.mjs --list kinds` prints every kind of shot with its fields and one example to copy; `--list looks`, `modes`, `devices`, `moves`, `cuts`, `fields` and `voices` print the rest. `--all` adds the experimental looks and the parked kinds. The sixteen kinds are `statement`, `number`, `clipping`, `end`, `list`, `quote`, `compare`, `chart`, `media`, `screen`, `map`, `diagram`, `timeline`, `code`, `feed` and `free`. `free` takes raw nodes, for what the others do not cover.

Each look serves the modes it names, and some kinds are not drawn in some looks. A parked kind renders with a note and the report's `kinds` lists it. An excluded kind is refused with the looks that have it. This table is checked against the code:

| Look | Modes | Parked kinds | Excluded kinds |
|---|---|---|---|
| `desk` | pro | none | none |
| `pop` | viral | none | none |
| `cosmos` | pro, viral | none | none |
| `ledger` | pro | `number` | none |
| `poster` | pro, viral | `number`, `feed` | none |
| `keynote` | pro | `number`, `clipping` | none |
| `marker` | pro | `number`, `feed`, `chart`, `timeline`, `free` | `screen`, `code` |

The `pop` look has no `ripple` cut. Finished films to start from, in `<skill-dir>/references/examples/v2/`: `gate-desk.json` (pro, `desk`), `gate-pop.json` (viral, `pop`), `gate-marker.json` (the whiteboard look), `voiced-desk.json` (a voice), `sound-desk.json` (a music bed and cues), `kinds-b-desk.json` (a map and code) and `batch-welcome.json` (`vars`).

## Rules

- Audio is opt-in in `pro` mode: no `voice`, `music` or `sound` unless asked. You cannot listen, so never say the voice or any audio sounds right, clear or in sync; say what the run printed.
- Never edit generated output (the MP4, the sheets, a subtitle file): change `film.json` and run again.
- A kind a look does not support is an error that names the looks that do (`--list kinds --json` has each kind's `looks`). A kind a look only parks renders with a note, and the report's `kinds` lists it. Pick another kind or look unless the user asked for it.
- If Chromium or ffmpeg cannot be installed here, still write the film and run the outline (it needs the npm packages only), then give the user the build command. Without the npm packages, give the doctor and build commands: the outline cannot run.
- Renders are offline. The one download is the voice model, once, on the first voiced render (93 MB, pinned, SHA-256 checked); the doctor asks first.
