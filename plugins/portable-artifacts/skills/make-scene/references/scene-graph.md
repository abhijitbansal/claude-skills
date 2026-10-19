## Shared contract: scene graph v1

Every world/lift module returns this object; the browser runtime consumes exactly this. Colour values are a **ColourRef**: a theme token name (`cat1`…`cat8`, `page`, `surface`, `text`, `text2`, `line`, `grid`, `accent`, `good`, `warn`, `bad`, `glow`), a `#rrggbb` hex, or `{ "base": "#rrggbb", "tint": <token>, "share": 0..1 }` (mixed at runtime, so it follows the theme toggle). In the mix, `share` is the fraction of the theme `tint` mixed INTO the fixed `base`: `0` is exactly `base`, `1` is exactly the tint, per 8-bit channel. A world keeps its identity this way: the forest meadow is a green `base` with 30% of the page surface, and group steps are the category colour at 60% over white (lighter) or black (darker).

```json
{
  "v": 1,
  "kind": "city|forest|galaxy|terrain|diagram|chart",
  "title": "…",
  "units": "commits",
  "bounds": { "min": [0,0,0], "max": [0,0,0] },
  "camera": { "position": [0,0,0], "target": [0,0,0] },
  "env": { "sky": "theme|space", "ground": null, "fog": true, "stars": false, "water": null, "nightLights": true },
  "groups": [ { "name": "api", "colour": "cat1" } ],
  "items":  [ { "id": "i0", "label": "api · W30", "group": 0, "t": "2026-W30", "value": 12, "display": "12 commits" } ],
  "batches": [ { "id": "b0", "shape": "box|cylinder|sphere|icosa|cone|disc", "colour": "<ColourRef>", "emissive": null, "flat": false,
                 "instances": [ [0,0,0, 1,1,1, 0] ] } ],
  "tubes":   [ { "id": "e0", "points": [[0,0,0],[1,0,0]], "radius": 0.06, "colour": "<ColourRef>", "item": null, "label": "api → web", "display": "6 commits" } ],
  "surfaces":[ { "id": "s0", "nx": 2, "nz": 2, "size": [10,6,4], "heights": [0,0,0,0], "bands": [ { "below": 0.9, "colour": "#d8c38a" } ], "cells": [0] } ],
  "labels":  [ { "text": "api", "at": [0,0,0], "size": 0.6 } ],
  "anim":    { "sway": ["b1"], "orbits": [ { "batch": "b2", "center": [0,0,0], "r": [1.4], "phase": [0.3], "speed": [0.7] } ] },
  "focus":   { "api": { "position": [0,0,0], "target": [0,0,0] } },
  "tour":    [ { "title": "…", "caption": "…", "focus": "api", "path": null, "reverse": false } ],
  "fallback": { "kind": "table|svg", "columns": ["group","t","value"], "rows": [["api","2026-W30","12"]], "svg": null,
                "links": { "columns": ["from","to","value"], "rows": [["api","web","6 commits"]] } }
}
```

- Each instance is `[x, y, z, sx, sy, sz, itemIndex]`. `itemIndex` is −1 for decoration such as trunks and branches.
- `surfaces[].cells` maps each data cell to an item index.
- `focus` keys are lowercased group names, row labels, or node ids.
- Numbers are rounded to 3 decimals, so the goldens are stable.

## Conventions the worlds follow

These pin down what the contract leaves open. The runtime must read them the same way.

- **Instances.** A unit shape (box 1x1x1, cylinder diameter 1 and height 1, sphere diameter 1, cone, disc, icosahedron) is scaled by `[sx, sy, sz]` and centred on `[x, y, z]`. There is no rotation. A building of height `h` on the ground is `[x, h/2, z, w, h, w, i]`.
- **Items.** `items[i]` is input row `i`. `t`, when present, is a string. `label` is the row's `label`, else `"<group> · <t>"`, else the group. `items[].value` is the exact input value (the one number that is not rounded to 3 decimals) and `display` shows it in full with en-US digit grouping.
- **`batches[].emissive`** is `null` or `{ "colour": <ColourRef>, "density": 0..1 }`: the share of lit windows. City buckets buildings into four density levels by `value / max`, so one batch holds one level of one group.
- **`env.ground`** is `null` or a ColourRef for a ground plane sized from `bounds`.
- **`env.water`** is `null` or `{ "y": <normalized height 0..1> }`. The runtime scales it by `surfaces[0].size[2]`.
- **Surfaces.** `size` is `[sx, sz, sy]`: the world width (x), depth (z) and the height that `heights == 1` maps to. The mesh is centred on x and z, sits on y = 0, and `heights` is row-major (`heights[iz * nx + ix]`) in 0..1. Band `below` values are in the same 0..1 units; a height at or above the last `below` takes the last band.
- **Terrain cells.** Data column `ti` (by sorted `t`, along x) and data row `gi` (by group, along z) is cell `gi * T + ti`, on vertex `(ix, iz) = (ti * 5, gi * 5)` of the 5x-upsampled grid. A grid with one column or one row is padded to two vertices, flat. A cell with no row has item index `-1` and height 0.
- **City layout.** Districts (groups) are rows along z in order of first appearance. Within a row, buildings go along x by `t` (numbers numerically, then strings, no locale), with one shared column per distinct `t`. Duplicate `(group, t)` rows take neighbouring slots and are never summed. Rows with no `t` follow, tallest first. Height is `0.15 + value / max * 9`; value 0 draws a flat 0.05 marker.
- **Group colours.** Groups 0–7 are `cat1`…`cat8`. Groups 8–15 are `{ base: "#ffffff", tint: catN, share: 0.6 }` (lighter step) and 16–23 are `{ base: "#000000", tint: catN, share: 0.6 }` (darker step), so all 24 are distinct.
- **Focus.** One entry per group name and per non-empty row label, keys lowercased (own keys, so a group named `constructor` or `__proto__` still has one); a group wins over a label of the same name.
- **Tubes and links.** A galaxy link is one tube. `tubes[].label` (optional) is `"<from> → <to>"`; `tubes[].display` (optional) is the link's exact value through the same formatter as `items[].display` (digit grouping, then units), and is omitted when the link has no value. `fallback.links` (optional, galaxy only, present when there is at least one drawn link) is a second table `{ columns: ["from","to","value"], rows: [[from, to, valueText]] }` of 3 strings per row; `valueText` is `""` without a value. Links are between two different groups; the validator rejects `from === to`, and the galaxy skips one defensively. `assertGraph` checks these fields.
- **Orbits.** `anim.orbits[k]` animates the instances of batch `batch`, one entry per planet batch; `center`, `r[]`, `phase[]` and `speed[]` run parallel to that batch's `instances`. At time `T` seconds the angle is `φ = phase + speed * T` (radians; `speed` is radians per second, `0.9 / sqrt(r)`), and the position is `x = cx + r·cos φ`, `z = cz + r·sin φ`, `y` unchanged. With +y up, increasing φ turns clockwise seen from +y (counter-clockwise seen from below). The stored instance `[x, y, z, …]` is already the time-0 position (`T = 0`), so a static render needs no animation. `r` is `1.4 + rank * pitch` with `pitch = min(0.32, 6.6 / max(1, n − 1))` for `n` planets in the system, so no orbit exceeds r = 8. Phases are seeded from `seedFrom("<group>|<row index>")`, never random.
- **Bounds.** `bounds` also covers each orbit disc: `center ± max(r)` in x and z.
- **Sway.** `anim.sway` lists the id of every leaf batch (one entry per `icosa` batch), and only those; trunk and branch batches stay still.
- **Emissive density.** For city windows, `density` is the share of lit windows (0..1). For a galaxy star it is `1`: the whole sphere is self-lit, and the runtime must not treat it as a window mask.
- **Tour.** Worlds return `tour: []`. The build step fills it from the spec's beats: `focus` is the first of the beat's focus entries (lowercased) that is a key of `graph.focus`, else its first entry; `caption` is `""` when the beat has none; `path` is `null` and `reverse` is `false`. A beat whose focus is not a key shows its caption and leaves the camera where it is. A diagram lift with no spec `tour` builds its own beats from the diagram's `stories` (at most 12), with `path` set to the id of the tube to ride and `reverse` true when the beat plays against the edge's direction (a reply).
- **Labels.** `labels[]` is drawn by the page as HTML text over the canvas, never as 3D geometry: each label is projected from `at` after every frame, sized from `size` and its depth (clamped to a readable range), and hidden when it is behind the camera or off the frame. They are not occluded by the scene. The PNG export paints them onto the saved image.
- **Tooltip.** An item shows `label` and `display`. A tube with `label` or `display` shows those (a link's value is readable exactly); a tube is hoverable when it has either or an `item`.
- **Fallback.** `fallback.rows` is a table of strings (`columns` names them) and `fallback.links` a second one. A lift adds `fallback.svg` (its 2D drawing), optionally `fallback.svgDark` (the dark-theme drawing: both ship and the page theme chooses, as in make-explainer's charts) and `fallback.css` (styles for that svg, included once on the page). The data block that carries the graph in the page leaves `fallback` out: the runtime never reads it.
- **Travelling light.** When a tour beat has a `path`, the runtime flies the camera to the beat's `focus` and sends a glowing sphere (the `glow` colour, a halo around it) along the tube with that `id`: from its first point to its last, or last to first when `reverse`, over 1.8 seconds, eased. It stays at the end until the next beat; a beat with no `path`, or closing the tour, hides it. Under reduced motion the sphere appears at the far end at once (the start when `reverse`). The sphere follows the same curve the tube is drawn along and is never hoverable.
- **Diagram lift.** `kind` is `"diagram"`, 2D px / 40 is world units. Graph layouts (architecture, flow, state) lie on the floor: ELK x is world x, ELK y is world z, nodes are blocks (`database`/`storage` cylinder, `queue` three stacked boxes, `start`/`end` disc, `decision`/`choice` cone, else box), groups are `line` platforms 0.1 thick whose top is `0.1 * depth` (a nested group stands on its parent), and edges are tubes at y 0.3 along ELK's points with rounded corners (solid `text`, `dashed` `text2`, `async` `accent`). A sequence diagram stands up: participants are pillars at their lifeline x, and message `i` is a tube at `y = top - i * 0.9` (the first message is the highest). `graph.groups` are the node kinds (the legend), `items` are the nodes or participants (`value` 0; `display` is the node's `detail`, cut at 120 characters, else its kind), and `tubes[].label` is the edge label (else `"<from> → <to>"`) with `display` `"<from> → <to>"`. Tube ids are make-diagram's edge or message ids. `focus` has every node, group and participant id and every label, lowercased. `fallback` is `{ kind: "svg", svg, css }`: make-diagram's drawing, `css` once per page. Frames and notes are not drawn in 3D.
