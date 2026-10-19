# Worlds and lifts

A scene is one of four **worlds** (rows become a place) or one of two **lifts** (an existing diagram or chart redrawn in 3D). Every number stays exact: height scales start at zero, hover and tap show the exact label and value, and the Explore list and data table list every item. Rendering stops when the scene is off-screen or the tab is hidden; reduced motion turns off auto-orbit and sway and makes tour beats cut instead of fly.

Common to every scene: auto-orbit on open (stops at the first touch), drag, scroll or pinch to orbit and zoom, a legend (group to colour), an Explore list (click an entry to fly to it), a tour bar (Play or Space, arrow keys for beats), full screen (`F`), PNG export of the current view and a theme toggle. Without WebGL the page shows a data table (worlds) or the 2D drawing plus its table (lifts).

## How the build recommends a world

`build.mjs` ranks the worlds from the data shape and builds the first unless `world` is set. The first match wins:

1. `links` present: galaxy.
2. Any row has `parent`: forest.
3. Every row has a plain numeric `t` (`1`, `2.5`; not a date, week, month, quarter or year string) and the group by `t` grid is at least 60% filled, with one row per group and `t`: terrain.
4. Otherwise: city. This includes a full grid of dates, months or weeks, such as commits per folder per week: time reads as a city. Terrain is still listed as an eligible alternative.

Then it prints the alternatives table. A world the data cannot feed shows "not available: needs ...", and a world whose page would be over the page limit shows "not available: over the page limit"; neither has a switch command. A lift is never second-guessed and has no alternatives.

## Field mapping

| Field | city | forest | galaxy | terrain |
|---|---|---|---|---|
| `group` | district (a row of buildings) | tree | star system | row of the grid |
| `t` | position along the street | branch height, bottom is oldest | orbit radius by rank | column of the grid |
| `value` | building height | leaf-cluster size | planet size | elevation |
| `parent` | ignored | sub-tree on a limb of the parent's tree | ignored | ignored |
| `links` | ignored | ignored | light trails between stars | ignored |
| `label` | hover and Explore | hover and Explore | hover and Explore | hover and Explore |

## city

A district per group, laid out as rows. Buildings stand along the street in `t` order (numbers numerically, then text), one shared column per distinct `t`; without `t` they follow in value order, tallest first. Height is value, from zero. A duplicate `(group, t)` takes the next slot beside it. Light mode is day; dark mode is night with lit windows whose density follows value. Use it for a time or sequence per group, such as commits per folder per week. Example: `examples/city.scene.json`.

## forest

One tree per root group on a meadow. Its rows are branches that spiral up the trunk in `t` order (row order without `t`); each branch ends in a leaf cluster whose size is its value (a minimum size for zero), ringed by two smaller puffs of the same colour so the crown reads full. Lower branches reach out further than higher ones, so the top cluster crowns the trunk. A group with `parent` grows as a smaller sub-tree on a limb of its parent's tree. Leaves sway gently. Use it for a hierarchy or for parts that belong to a whole, such as skills per squad with sub-teams. Without any `parent`, every group is its own tree. Example: `examples/forest.scene.json`.

## galaxy

One star per group, self-lit. Planets orbit it, one per row, at a radius set by `t` rank (value rank without `t`), size set by value, on a faint orbit ring. Each link is a light trail between two stars with its value readable on hover. A planet's position in its orbit is seeded from its group and row, so the same spec gives the same scene. Use it for linked things: services and calls, people and who they talk to. Without `links` the stars drift as a cluster. Example: `examples/galaxy.scene.json`.

## terrain

A group by `t` grid interpolated smoothly into an island. Groups run along one axis and sorted `t` along the other; elevation is value, every data cell is exactly its value, and the land slopes down to the sea all round the edge (the grid sits inside a margin of empty sea cells). A sea level marks the low values and colour bands follow height. It needs `t` on every row and exactly one row per `(group, t)`; a missing cell sits at zero. Use it for a dense grid of numbers, such as a measurement per row and column position. A grid of dates or weeks is recommended as a city; ask for terrain with `--world terrain`. Example: `examples/terrain.scene.json`.

## Lifts

### Diagram lift

`"lift": { "diagram": "<path or object>" }`. make-diagram's ELK layout is laid flat on a floor. Nodes are blocks whose shape follows the kind (cylinder for a database or storage, stacked boxes for a queue, a disc for start and end, a cone for a decision). Groups are raised platforms by nesting depth. Edges are tubes along the layout's edge points (solid, dashed and async are drawn differently). A sequence diagram stands up: participants become pillars and messages beams stepping down in time. Frames and notes are not drawn. With no `tour`, the diagram's `stories` replay as hops along the edge tubes with a travelling light; a reply plays backwards. Tour `focus` entries are node, group or participant ids. Example: `examples/lift-diagram.scene.json` (with `examples/story.diagram.json`).

### Dashboard lift

`"lift": { "dashboard": "<dashboard.json>", "chart": "<chart id>" }`. One chart of a make-dashboard dashboard, with axes and tick labels from the chart's own roles.

| Chart kind | In 3D |
|---|---|
| `bar` | a tower per x; rows that share an x stack in that column, each row its own hoverable item with its exact value |
| `stacked-bar` | towers stacked in one column per x |
| `grouped-bar` | each colour in its own lane of depth; rows that share an x and colour stack in that lane |
| `histogram` | touching towers, one per bin; the value is the row count |
| `line` | one tube per series with a marker on every point (repeated x values are not stacked) |
| `area` | a ribbon tube, 1.6 times the line radius |
| `scatter`, `bubble` | spheres in a box; a bubble's area follows its size |
| `heatmap` | a terrain-like surface (no negative values) |
| `donut` | a ring of tube arcs, clockwise from 12 o'clock |

Boxplot and `vegaLite` charts cannot be lifted. A heatmap value, a donut `y` and a bubble `size` must be 0 or more. Needs make-dashboard installed beside this skill. Example: `examples/lift-dashboard.scene.json` (with `examples/dashboard.json` and `examples/data/sales.csv`).

## Picking one

- Linked things: galaxy. Hierarchy: forest. Dense numeric grid: terrain. Anything over time or sequence, dated grids included: city (terrain is one switch away).
- Do not choose a world for looks. Switching is free of model tokens: the printed command is the same build (same `--out`, `--theme`, `--allow-outside`) with `--world <world>`.
