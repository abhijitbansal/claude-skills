---
name: make-scene
description: Use when the user wants data shown as an explorable 3D world, such as a city of towers, a forest, a galaxy or a terrain, or wants a diagram or dashboard chart lifted into 3D, as one offline HTML page with a camera tour. The agent writes a small JSON spec and scripts build the page. Not for a flat chart (make-dashboard) or hand-written three.js and games.
argument-hint: what to show, e.g. "our commits per week per module as a city, with a tour of the busiest weeks"
---

# make-scene

You write one JSON file, `scene.json`: a title, then either `data` (rows that become a city, forest, galaxy or terrain) or `lift` (an existing diagram or one dashboard chart redrawn in 3D), and usually a short `tour` of camera stops. Scripts check it and build one offline three.js page with orbit, hover, an Explore list and a tour bar. You never write three.js, coordinates, CSS or HTML. Only make a 3D scene when the user asks for 3D or a scene; do not turn a plain chart or diagram request into one.

Run every command from the project folder (where `scene.json` lives), using the full path to the scripts. If the request is empty, ask what to show.

Run every step yourself (or hand off as the Director and operator section says), in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists. The one command is `make.mjs` (see Director and operator); `validate.mjs` and `build.mjs` below remain for stepwise work.

## Director and operator

You are the director: you run the intake, write the spec, view what was built and decide every `creative` finding. A cheaper operator agent only runs the one command and fixes `mechanical` findings.

The command is `node <skill-dir>/scripts/make.mjs <spec> --json` (add `--out <path>` to name the output). It checks the spec, builds, checks the result and prints one report: `ok`, `output`, `stages`, `findings`. A `mechanical` finding names a JSON path to change and makes `ok` false. A `creative` finding is a call for you and never a failure.

Hand off with the first rung that works, unless you are already artifact-builder (then run the command, fix only `mechanical` findings, as your own instructions say, and do not hand off again):

1. Write the spec first. If `artifact-builder` is in your list of available agents (a plugin may list it as `<plugin>:artifact-builder`), start that agent with three things: this skill directory (the full path of the folder that holds this SKILL.md), the spec path (the file already exists) and, optionally, the output path. It has no memory of this conversation and needs nothing else. Do not choose a model for it: its own file names one.
2. No such agent, or it fails or cannot start: run the same command yourself.

Trust the report and the output file, never the operator's prose. You take over (fix it yourself and rerun) when the same `mechanical` finding survives two operator attempts, or when its path is empty (the operator may change nothing).

Before you report, view what was built: the files listed under `sheets` in the report (make-motion), or the page through `node <skill-dir>/shared/shot.mjs <output>` when that file exists, then open each PNG it prints. Fix what you see and decide each `creative` finding.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md.

Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists: a lift needs make-diagram or make-dashboard installed beside this skill; `--for check` before `check.mjs`). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items. On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with. Hand the user the exact command to run themselves for anything the doctor reports as refused, skipped, installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Running the commands

- Run one plain command per call, with literal absolute paths: write `<skill-dir>` out in full, never through a shell variable.
- No heredocs, no sed -i and no inline scripts: write specs and other files with your file-writing tool. If that tool fails, say so; do not work around it with a shell script.
- No cd, no && or ; chains, no shell variables and no pipes. Run from the project folder, and do not follow a command with an echo of its exit code.
- A command prints its own verdict (`valid`, `wrote <path>`, `check: skipped`). That output is the result; the exit codes listed for each script are for reference.

## Workflow

1. Get the data. Rows you already have go in `data.rows`. A CSV goes in `data.csv` with `columns`. Commits per top-level folder per week come from `node <skill-dir>/scripts/rows.mjs git --weeks 12` (options `--depth N`, `--repo DIR`, `--out FILE`; run from a subfolder of a repository, it counts that folder alone), which writes `scene-rows.json`: use it as `"data": { "file": "scene-rows.json" }`. Never retype or reshape generated rows.
2. Write `scene.json`. Copy the closest file in `<skill-dir>/references/examples/` (`city`, `forest`, `galaxy`, `terrain`, `lift-diagram`, `lift-dashboard`). Every field is in `<skill-dir>/references/schema.md`; what each world does is in `<skill-dir>/references/worlds.md`. Set `world` to your pick, or leave it out and the build picks the best fit.
3. `node <skill-dir>/scripts/validate.mjs scene.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error. Add `--allow-outside` (to validate and to build) only if the user wants data from outside the project folder.
4. Set `generatedBy` in the spec with the keys `model`, `effort` and `agent` (your host; `host` is accepted as an alias of `agent`), for example `"generatedBy": { "model": "claude-opus-5-5", "effort": "low", "agent": "Claude Code" }`. Never guess; leave out any key you do not know. `--model`, `--effort` and `--agent` on the build override it. `node <skill-dir>/scripts/build.mjs scene.json` prints `wrote <path>`, the page's `file://` URL on a line of its own and an alternatives table. The page goes to `<git root>/.scratch/<slug>.html` when the spec sits in a git repository, else to `~/.agent/diagrams/<slug>.html`; the `PA_OUTPUT_DIR` environment variable or `--out <file.html|dir>` picks another folder. `--theme dusk|press|poster|paper|blueprint|ink|editorial|mono|brief` overrides the theme (default `dusk`). `--fragment` writes `<slug>.fragment.html` instead: the scene's css, host, runtime and mount call, to paste into a page of your own.
5. Look at it. First run `node <skill-dir>/scripts/doctor.mjs --json --for check`, then `node <skill-dir>/scripts/check.mjs <printed path> --shots shots`. It opens the page at desktop and phone width and fails on console errors, overflow, a blank canvas, a fallback table that stays visible once WebGL runs, or a tour that cannot reach its last beat. `--shots shots` also checks the dark scheme and writes PNGs into the `shots` folder, one per width and colour scheme and one per tour beat, and prints each path: view every PNG before you report (a camera that lands on the wrong thing shows only there), and fix what you see. It needs Playwright and a browser that can run WebGL (`doctor --for check` reports and installs them, after the user agrees). Without them it prints `check: skipped` and exits 0: a skipped check is not a pass, and it writes no PNG.
6. Report: the HTML path, one line on what the scene shows, the alternatives table, the check result as one word (passed, failed or skipped), and "drag to orbit, hover for exact values, Play (or Space) runs the tour, `F` is full screen".

For a change ("rename the title", "add a beat for the spike"), edit only those fields of `scene.json`, then validate and build again with the same `--out` and `--theme`; never edit the built page.

Sharing: a built page is one file you can send as is. Keep scenes built from private data local unless the user asks to publish. If your host can publish a page to a link, publish the single HTML file.

## Recommend, build, then offer

The build prints an alternatives table: each world, why it fits (or "not available: needs ..." / "not available: over the page limit"), the page size, a render weight and the exact command to switch. Show the table the build printed to the user verbatim, unchanged, then ask if they want another world. Switching is free of model tokens: run the printed command, which is the same build (same `--out`, `--theme` and `--allow-outside`) with `--world <world>`. It rewrites `world` in `scene.json` and builds again. A lift has no alternatives.

## Data rules

Each row is `{ "group", "t", "value", "label", "parent" }`; only `group` and `value` are required.

- Exactly one source: `data.rows`, `data.file` (a JSON file `{ "rows": [...], "links": [...] }`) or `data.csv` with `columns` mapping CSV headers to `group`, `t`, `value`, `label`, `parent`. Local files only, no URLs.
- `group` is free display text, at most 48 characters. `value` is a number, never negative. At most 2000 rows and 24 groups: aggregate or drop the rest.
- `t` orders things. Use sortable values: numbers, ISO dates (`2026-07-14`), ISO weeks (`2026-W09`, zero-padded) or months (`2026-07`). A string `t` sorts as text, so `W9` lands after `W10`.
- `parent` (forest) names another `group`. `links` (galaxy) are `{ "from", "to", "value" }` between two different groups: top-level in `scene.json` or inside `data.file`, never in a CSV. A self-link is an error.
- Terrain needs `t` on every row and exactly one row per group and `t`. Duplicate pairs are never summed.

## Worlds

- `city`: a district per group, buildings by `t`, height is value. Picked first for dates and weeks, and for anything else that does not fit another world.
- `forest`: a tree per group, branches by `t`, leaf size is value. Fits `parent` hierarchies.
- `galaxy`: a star per group, planets by `t` rank, size is value. Fits `links`.
- `terrain`: a group by `t` grid as a landscape, height is value. Picked first only for a mostly full grid (60% or more of group by `t` filled) whose `t` is a plain number, not a date or week; a dated grid still lists it as an alternative.

If an explicit `world` cannot show the data, validate names the worlds that can.

## Lifts

- `"lift": { "diagram": "flow.diagram.json" }`: a path to a make-diagram file, or the diagram object inline. Any diagram type works.
- `"lift": { "dashboard": "dashboard.json", "chart": "<chart id>" }`: one chart. Bar, stacked-bar, grouped-bar, histogram, line, area, scatter, bubble, heatmap and donut lift; boxplot and `vegaLite` charts do not.
- A lift has no `data`, `world` or top-level `links`. Paths stay inside the project folder. A diagram lift with no `tour` replays the diagram's own stories along its edges.

## Tour

`tour` is up to 12 beats `{ "title", "caption", "focus" }`: title up to 48 characters, caption up to 160, `focus` a list of group names or row labels (case-insensitive), or for a diagram lift a node, group or participant id. A dashboard lift focuses an x value, colour value or label. Write 3 to 6 beats that point at the real story in the data. Set `autoplay` to `true` to start the tour on open (ignored under reduced motion).

## Degraded mode

If you cannot run shell commands, write `scene.json` and give the user the exact commands from steps 3, 4 and 5 with the real `<skill-dir>` path.

## Security

Labels, captions and group names are escaped in the page, never read as markup. Specs accept no URLs, CSS, SVG or HTML. The page makes no network requests, and its CSP blocks them. Keep secrets out of labels and captions.
