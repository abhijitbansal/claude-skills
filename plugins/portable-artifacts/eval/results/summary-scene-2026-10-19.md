# make-scene eval — 2026-10-19

The 10 prompts cover:
- a city from inline rows
- a forest with sub-teams
- a galaxy whose links come from a data file
- terrain from `web_traffic.csv`
- git history rows from a fixture repo
- a diagram lift
- a dashboard chart lift
- three edits of a seed: add a tour, switch to forest, and rename a group

Measured with `node eval/run-eval.mjs --skill scene --host claude --model haiku` against branch head `d1dc7c5`, in one billed run (the budget allowed at most 5).

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **10/10** | 1.5 | 40 | `scene-haiku-2026-10-19/` (local, not committed) |

| id | valid | validate runs | output | seconds | notes |
|---|---|---|---|---|---|
| city-inline | ✓ | 1 | ✓ | 43 | |
| forest-parent | ✓ | 2 | ✓ | 33 | |
| galaxy-links | ✓ | 1 | ✓ | 29 | |
| terrain-traffic | ✓ | 2 | ✓ | 45 | |
| git-activity | ✓ | 1 | ✓ | 49 | |
| lift-diagram | ✓ | 2 | ✓ | 37 | |
| lift-dashboard | ✓ | 1 | ✓ | 53 | |
| edit-add-tour | ✓ | 1 | ✓ | 23 | changed: tour |
| edit-switch-forest | ✓ | 2 | ✓ | 36 | changed: world, generatedBy |
| edit-rename-group | ✓ | 2 | ✓ | 45 | changed: 4 group rows, tour[0].title, tour[0].focus[0], generatedBy |

## Gate

Pass bar: at least 90% valid builds. Result: **pass** at 10/10 on the first run, so no re-runs were spent.

## Shape audit (by hand)

The harness only scores "valid and builds". Each spec was also checked against what its prompt asked for:

| id | asked for | written |
|---|---|---|
| city-inline | city | `world: city`, inline rows, 3-beat tour |
| forest-parent | sub-teams | `world: forest`, rows with `parent` |
| galaxy-links | links from a file | `world: galaxy`, `data.file: data/service_calls.json` (the file carries the links) |
| terrain-traffic | CSV landscape | `world: terrain`, `data.csv` with `columns` |
| git-activity | commits as buildings | `world: city`, `data.file` written by `rows.mjs git` |
| lift-diagram | 3D of the diagram | `lift.diagram`, no `world` |
| lift-dashboard | 3D of one chart | `lift.dashboard` + `lift.chart`, no `world` |
| edit-add-tour | tour | only `tour` added |
| edit-switch-forest | forest | `world` changed |
| edit-rename-group | rename | every row and the tour focus renamed, so the tour still resolves |

Every spec used the world or lift its prompt asked for.

## Known limits

- The `git-activity` fixture commits are dated 2026-10-01 to 2026-10-04. `rows.mjs git` looks 12 weeks back from today, so from about 2026-12-21 the prompt measures error recovery (a larger `--weeks`), not the skill. The make-explainer repo prompt shares these dates.
