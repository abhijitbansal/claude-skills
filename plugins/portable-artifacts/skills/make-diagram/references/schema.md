# diagram.json reference

Validate with `node scripts/validate.mjs diagram.json`. Unknown properties are errors. There are no coordinates, colours, CSS, SVG, HTML or URLs anywhere in the spec; layout is automatic. Every error starts with a JSON path, and names the fix (with a did-you-mean when the value comes from a closed set).

Two families share one file format:

- **Graph types** (`architecture`, `flow`, `state`) use `nodes` and `edges`, and optionally `groups` and `direction`.
- **`sequence`** uses `participants` and `messages`, and optionally `frames` and `notes`.

A field from the other family is an error, for example `direction: not allowed for sequence diagrams; remove it`.

## Root

| field | type | default | notes |
|---|---|---|---|
| `title` | string | required | page title; also the output file name (`<slug>.html`) |
| `subtitle` | string | none | one line under the title |
| `type` | `architecture` \| `flow` \| `sequence` \| `state` | required | |
| `theme` | `paper` \| `blueprint` \| `ink` \| `editorial` \| `dusk` \| `press` \| `poster` | `blueprint` | `build.mjs --theme` overrides it |
| `generatedBy` | object `{ model?, effort?, agent? }` | none | who made the diagram, shown under the title and in the page's generator meta; each field is 1-60 characters of letters, digits, space and `. _ : / ( ) + -`; `build.mjs --model`, `--effort` and `--agent` override it; a missing field shows as "not reported" |
| `direction` | `right` \| `down` | `right` (architecture, state), `down` (flow) | graph types only |
| `animate` | boolean | `false` | start with edge-flow animation on; the toolbar toggle still works; off under reduced motion |
| `groups` | array | none | graph types only |
| `nodes`, `edges` | arrays | graph types: at least 1 node | |
| `participants`, `messages`, `frames`, `notes` | arrays | sequence: at least 1 participant | |
| `autoplay` | boolean | `false` | start the story player when the page opens; ignored under `prefers-reduced-motion: reduce`; loop defaults on |
| `stories` | array, up to 8 | built from the layout | named chapters of beats, played as one timeline (below) |
| `steps` | array, up to 25 | | the older walkthrough form; a spec with both `stories` and `steps` is an error |

## Ids

Ids are lowercase letters, digits, `-` and `_`, starting with a letter (`^[a-z][a-z0-9_-]*$`). They must be unique across groups and nodes (graph types) or participants and messages (sequence). Edges may carry an optional `id`; it must not reuse a group or node id or another edge's id (an unnamed edge gets `edge-<index>`).

## groups[] (graph types)

`id`, `label` (required; up to 48 characters, like a node label), `parent` (another group id; nesting up to 3 deep, no cycles). A node joins a group with `nodes[].group`. In architecture diagrams an edge may end at a group; an edge between a group and something inside it is an error.

## nodes[]

| field | notes |
|---|---|
| `id`, `label` | required. Label up to 48 characters, wraps to at most 2 lines |
| `kind` | per type, see [kinds.md](kinds.md); the first kind listed is the default |
| `icon` | `lucide:<name>` or `brand:<slug>`; default is the kind's icon. Find one with `node scripts/icons.mjs search <word>`. Kinds drawn as bare shapes (flow `start`, `end`, `decision`; state `start`, `end`, `choice`) take no icon |
| `group` | a group id |
| `note` | up to 60 characters, one line, shown under the label |
| `tone` | `neutral` (default) \| `accent` \| `good` \| `warn` \| `bad`; colours only the border and icon |
| `emoji` | exactly one emoji (a pictograph with its skin tone or joins, a flag, a keycap); drawn in the icon tile instead of the icon. Not on kinds drawn as bare shapes |
| `detail` | up to 400 characters of plain text, shown in the Explore panel |

## edges[]

`from`, `to` (node ids; architecture may also use a group id) are required. Optional `id`, `label` (up to 40 characters; a verb phrase: "writes order"), `style` (`solid` default, legend key "call" \| `dashed`, legend key "secondary" \| `async`, legend key "event"), `both` (true draws an arrowhead at each end). An edge from a node to itself is allowed in every graph type. An edge between a group and itself is an error.

## participants[], messages[], frames[], notes[] (sequence)

- `participants[]`: `id`, `label` (required), `kind` (`service` default, `actor`, `database`, `queue`, `external`), `icon`, `emoji`, `detail`.
- `messages[]`: `id`, `from`, `to` (participant ids) are required. `label` up to 40 characters, `kind`: `sync` (default; solid line, filled arrow), `async` (solid line, open arrow), `reply` (dashed line, open arrow), `self` (a loop; `from` must equal `to`, and equal ends must use `self`). Messages are drawn top to bottom in array order.
- `frames[]`: `kind` (`loop` \| `alt` \| `opt` \| `par`), `messages` (message ids), optional `label`. The ids must form one unbroken run in message order. Two frames may nest or be disjoint; partial overlap is an error.
- `notes[]`: `over` (one or more participant ids), `text` (up to 60 characters), optional `after` (a message id; the note is drawn right after that message, and a note with no `after` goes at the top).

## stories[]

Up to 8 stories `{ "id", "title", "beats" }`; `title` up to 40 characters (the chapter chip); story ids follow the id rule and are unique among stories (they may equal a node id). All stories hold at most 60 beats and play as one timeline in array order. A beat:

| field | notes |
|---|---|
| `title` | required, up to 48 characters |
| `caption` | up to 160 characters; the caption line reads `06 / 13 · CHAPTER · Title — caption` |
| `edge` | an edge id (an edge without one is `edge-<index>`), or a message id in a sequence. Exactly one of `edge`, `from` + `to`, `focus` |
| `from`, `to` | node ids (groups too in architecture; participants in a sequence). An edge from `from` to `to`, plain or two-headed, plays forward. Failing that, a two-headed edge authored the other way, then a plain edge the other way, plays backwards (the dot travels `to` → `from`), for replies. More than one edge in the winning tier is an error naming both ends and asking for `edge`; a request `a`→`b` plus its reply `b`→`a` is not ambiguous. No edge at all is also an error |
| `focus` | node, group or participant ids; the camera fits and lights them, no dot |

A hop beat glides the camera to both ends (450 ms), runs a dot along the edge (900 ms) and holds for 1.8 s plus 30 ms per caption character, up to 4.5 s; every duration divides by the speed (0.5× to 2×). Everything outside the beat dims. With no `stories` the build makes one beat per layout layer (per message in a sequence; see steps below) in one chapter titled `Walkthrough`.

## steps[] (the older form)

Prefer stories. A spec with both is an error (use stories; steps is the older form). Each step becomes one beat of a Walkthrough chapter; its note (up to 200 characters) is the beat's caption. Each step: `title` (required, up to 60 characters), optional `note` (up to 200), `show` (ids revealed from this step on, cumulative), `focus` (ids the camera fits; default is this step's own `show`), `highlight` (ids emphasised in this step). Ids named in `focus` or `highlight` are also revealed with the step, just like `show`. Ids can be groups, nodes, participants or messages.

- Revealing a node reveals its ancestor groups. Revealing a message reveals both its participants. An edge appears once both of its ends are visible.
- The viewer hides everything no step has revealed. So when ids are left out of every step, the build appends a final step titled `Everything` that shows the rest and fits the whole diagram (at the 25-step limit the rest joins the last step instead).
- With no `steps`, the build makes one step per layout layer in a graph (titled after the layer's first node) and one step per message in a sequence (the first step also shows every participant; with more messages than steps they are chunked; a sequence with no messages gets one `Participants` step).

## Limits

| | limit |
|---|---|
| nodes / edges | 60 / 120 |
| participants / messages | 12 / 60 |
| steps | 25 |
| group nesting | 3 |
| node, group or participant label | 48 characters (wraps to 2 lines) |
| note | 60 characters (1 line) |
| edge or message label, frame label | 40 characters |
| page title / subtitle | 120 / 160 characters |
| step title / note | 60 / 200 characters |
| stories / beats in all | 8 / 60 |
| story title / beat title / caption | 40 / 48 / 160 characters |
| detail | 400 characters |
| built page | 1024 KB |

A diagram reads best with 12 nodes or fewer. Past that, split it.

## Errors you will see

```
nodes[0].kind: kind "databse" is not valid for architecture diagrams; did you mean "database"?
edges[0].to: "dbb" not found; did you mean "db"?
direction: not allowed for sequence diagrams; remove it
messages[0].kind: from and to are both "a"; set kind to "self"
```

Beyond the spec checks, validation lays the diagram out and lints the geometry. A spec that passes is buildable. If it fails there, the message names the path and what to shorten or split: `text is <N> px wide; the box fits <M> px — shorten the label`, `node "b" overlaps node "a" (nodes[0]); split the diagram or shorten the labels`.

## Output

`build.mjs` writes one offline HTML file (inline CSS, JS, fonts and icons; CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`). The same spec and versions give byte-identical pages; nothing in the file depends on when it was built.

In the page: wheel or pinch to zoom, drag to pan, `0`, the Fit button or double-click to fit, `+` and `-` to zoom, arrow keys to pan. `F` or the Full screen button goes full screen (where the browser refuses, as inside a sandboxed iframe, the page fills its window instead); `Esc` leaves. Play story (`P`): Space plays and pauses, ←/→ step the beats, Home/End jump to the first and last, chapter chips and the scrubber jump, the speed button cycles 0.5× to 2×, Loop restarts the timeline; a click or drag on the canvas pauses; the wheel zooms and playback keeps running. On a phone the toolbar and transport scroll sideways instead of wrapping and the legend overlay is hidden in Play, so the canvas keeps about half the screen. Explore (`E`): hover for a tooltip, click a node or edge for the side panel (what it sends and receives, the beats that use an edge), shift-click a second node for the shortest route, `/` for Find. `A` toggles edge-flow animation. The toolbar exports SVG or PNG and cycles the colour mode (auto, light, dark). `Esc` closes the panel, then leaves full screen, then leaves Play, then clears Find, then clears the trace.
