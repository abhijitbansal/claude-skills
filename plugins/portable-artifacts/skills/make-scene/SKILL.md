---
name: make-scene
description: Use when the user wants their data shown as an explorable 3D world (a city of towers, a forest, a galaxy or a terrain) or an existing diagram or dashboard chart lifted into 3D, as one offline HTML page with a camera tour; the agent writes a small JSON spec and scripts build the three.js page
argument-hint: what to show, e.g. "our commits per week per module as a city, with a tour of the busiest weeks"
model: haiku
effort: low
---

# make-scene

You write one JSON file, `scene.json`: a title, then either `data` (rows that become a city, forest, galaxy or terrain) or `lift` (an existing diagram or one dashboard chart redrawn in 3D), and usually a short `tour` of camera stops. Scripts check it and build one offline three.js page with orbit, hover, an Explore list and a tour bar. You never write three.js, coordinates, CSS or HTML. Only make a 3D scene when the user asks for 3D or a scene; do not turn a plain chart or diagram request into one.

Run every command from the project folder (where `scene.json` lives), using the full path to the scripts. If the request is empty, ask what to show.

Run every step yourself, in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md.

Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists: a lift needs make-diagram or make-dashboard installed beside this skill; `--for check` before `check.mjs`). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items. On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with. Hand the user the exact command to run themselves for anything the doctor reports as refused, skipped, installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Workflow

1. Get the data. Rows you already have go in `data.rows`. A CSV goes in `data.csv` with `columns`. Commits per top-level folder per week come from `node <skill-dir>/scripts/rows.mjs git --weeks 12` (options `--depth N`, `--repo DIR`, `--out FILE`; run from a subfolder of a repository it counts that folder alone), which writes `scene-rows.json`: use it as `"data": { "file": "scene-rows.json" }`. Never retype or reshape generated rows.
2. Write `scene.json`. Copy the closest file in `<skill-dir>/references/examples/` (`city`, `forest`, `galaxy`, `terrain`, `lift-diagram`, `lift-dashboard`). Every field is in `<skill-dir>/references/schema.md`; what each world does is in `<skill-dir>/references/worlds.md`. Set `world` to your pick, or leave it out and the build picks the best fit.
3. `node <skill-dir>/scripts/validate.mjs scene.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error. Add `--allow-outside` (to validate and to build) only if the user wants data from outside the project folder.
4. Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. `--model`, `--effort` and `--agent` on the build override it. `node <skill-dir>/scripts/build.mjs scene.json` prints the HTML path and an alternatives table. Default folder is `~/.agent/scenes/` (or the folder in the `PA_OUTPUT_DIR` environment variable); `--out <file.html|dir>` picks another (inside a project pass `--out ./<name>.html` so the page lands there); `--theme dusk|press|poster|paper|blueprint|ink|editorial` overrides the theme (default `dusk`).
5. First run `node <skill-dir>/scripts/doctor.mjs --json --for check`, then `node <skill-dir>/scripts/check.mjs <printed path>` opens the page at desktop and phone width and fails on console errors, overflow, a blank canvas or a tour that cannot finish. It needs Playwright and a browser (`doctor --for check` reports and installs them, after the user agrees); without them it skips cleanly (exit 0).
6. Report: the HTML path, one line on what the scene shows, the alternatives table, and "drag to orbit, hover for exact values, Play (or Space) runs the tour, `F` is full screen".

For a change ("rename the title", "add a beat for the spike"), edit only those fields of `scene.json`, then validate and build again.

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
