---
name: make-diagram
description: Use when the user wants an architecture diagram, flowchart, sequence diagram or state diagram as a polished offline HTML page that plays named stories of beats along its edges with a transport bar, lets the reader explore nodes and routes in a side panel, goes full screen and exports; the agent writes a small JSON topology and scripts lay it out with ELK and render it.
argument-hint: what to draw, e.g. "checkout request path from browser to orders DB, with the order story"
model: haiku
effort: low
---

# make-diagram

You write one JSON file, `diagram.json`: a title, a type, nodes with edges (or participants with messages), and usually one or two stories: named chapters of beats, each beat one hop along an edge with a title and a caption. Scripts lay it out with ELK, check the geometry and build one offline HTML page with a story player, an Explore panel and full screen. You never write coordinates, CSS, SVG or HTML.

`<skill-dir>` is the folder that contains this SKILL.md. Run every command from the project folder (where `diagram.json` lives), using the full path to the scripts. If the request is empty, ask what to draw.

Run every step yourself, in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

First use: if `<skill-dir>/node_modules` is missing, say it is a one-time local install and run `npm ci --omit=dev --prefix <skill-dir>`.

## Workflow

1. Pick the type and write `diagram.json` (examples below; every field in `<skill-dir>/references/schema.md`; ready-made files in `<skill-dir>/references/examples/`, `story.diagram.json` among them).
2. Icons and emoji are optional. Find an icon: `node <skill-dir>/scripts/icons.mjs search <word>` prints refs like `lucide:database` or `brand:postgresql`. Use a ref exactly as printed. Skip icons if unsure: most kinds have a default icon (see `<skill-dir>/references/kinds.md`); flow `start`, `end`, `decision` and state `start`, `end`, `choice` are drawn as shapes and take no icon or emoji.
3. `node <skill-dir>/scripts/validate.mjs diagram.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error.
4. `node <skill-dir>/scripts/build.mjs diagram.json` prints the HTML path. Default folder is `~/.agent/diagrams/` (or `$PA_OUTPUT_DIR`); `--out <file.html|dir>` picks another; `--theme paper|blueprint|ink|editorial` overrides the theme (default `blueprint`).
5. `node <skill-dir>/scripts/check.mjs <printed path>` opens the page at desktop and phone width and fails on overflow, console errors or a node under the legend overlay. It skips cleanly (exit 0) when Playwright or a browser is missing; do not install either for it.
6. Report: the HTML path, one line on what the diagram shows, and "Play story (or `P`) opens beat 1, Space plays it, `E` explores, `F` is full screen".

For a change ("rename the cache", "add a beat for the retry"), edit only those fields of `diagram.json`, then validate and build again.

## Types and kinds

- `architecture`: `service` (default), `client`, `user`, `database`, `storage`, `queue`, `cache`, `function`, `gateway`, `external`, `other`. Optional `groups` (nest up to 3 deep); an edge may end at a group.
- `flow`: `step` (default), `start`, `end`, `decision`, `io`, `subprocess`, `wait`. Default direction is down.
- `state`: `state` (default), `start`, `end`, `choice`. A transition from a state to itself is allowed.
- `sequence`: participants of kind `service` (default), `actor`, `database`, `queue`, `external`; messages of kind `sync` (default), `async`, `reply`, `self` (from = to).

Every node and participant may carry `emoji` (exactly one emoji, drawn in the icon tile instead of the icon; not on the bare shapes above) and `detail` (up to 400 characters of plain text, shown in the Explore panel when the reader clicks the node). Each kind has a colour family that tints its card and its outgoing edges (`<skill-dir>/references/kinds.md`); `tone` (neutral, accent, good, warn, bad) overrides only the border and icon.

Writing rules: labels are nouns ("Orders DB"), edge and message labels are verbs ("writes order"). Labels stay under 48 characters, notes under 60 (one line), edge labels under 40, the title under 120 and the subtitle under 160. Ids are lowercase letters, digits, `-`, `_`, starting with a letter. At most 12 nodes reads best; split a bigger system into several diagrams (hard limits: 60 nodes, 120 edges, 12 participants, 60 messages). `direction` (right or down) applies to graph types, not sequence.

## Architecture example

```json
{
  "title": "Checkout request path",
  "type": "architecture",
  "groups": [{ "id": "vpc", "label": "Private VPC" }],
  "nodes": [
    { "id": "web", "label": "Web app", "kind": "client", "emoji": "🛒" },
    { "id": "api", "label": "Checkout API", "group": "vpc", "detail": "Owns the order. Writes it, then answers the app." },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "vpc", "icon": "brand:postgresql" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "posts order" },
    { "from": "api", "to": "db", "label": "writes order", "style": "async" }
  ],
  "stories": [
    { "id": "order", "title": "Place an order", "beats": [
      { "title": "The app posts the order", "from": "web", "to": "api", "caption": "One POST with an idempotency key." },
      { "title": "The API writes it", "from": "api", "to": "db", "caption": "Committed before the app hears back." },
      { "title": "The app gets its answer", "from": "api", "to": "web", "caption": "Against the arrow: a reply plays backwards." }
    ] }
  ]
}
```

Edge `style`: `solid` (default; legend key "call"), `dashed` (legend key "secondary": use it for a reply, a "no" branch or a lesser path), `async` (legend key "event"); `"both": true` draws arrows at both ends. A sequence message prints "call", "event", "reply" or "self".

## Stories

`stories` is up to 8 chapters `{ "id", "title", "beats" }` (title up to 40 characters: the chapter chip), 60 beats in all, played as one timeline. Each beat has a `title` (up to 48 characters) and an optional `caption` (up to 160: the one sentence the reader hears while the camera holds), and exactly one target:

- `"from"` and `"to"`: the one edge between two nodes (a group counts in architecture; participants in a sequence). Naming the ends against the arrow plays the hop backwards, for replies. Two edges running the same way between the same ends, or none, is an error that asks for `"edge"`; a request and its reply are fine.
- `"edge"`: an edge id (an edge without an id is `edge-<index>`), or a message id in a sequence.
- `"focus"`: node, group or participant ids the camera fits and lights, with no travelling dot: an establishing or closing shot.

Write one story for the main path (3 to 8 beats) and one per side path (the retry, the failure, the event). Beat titles are short present-tense sentences ("The app calls the API"); captions add the one fact the title leaves out. Leave `stories` out only when there is nothing to narrate: the build then makes one beat per layout layer (per message in a sequence). Set `autoplay` to `true` to start the player when the page opens (ignored under reduced motion). `steps` is the older walkthrough form; do not write it for new diagrams (`references/schema.md` still documents it).

## Sequence example

```json
{
  "title": "Login",
  "type": "sequence",
  "participants": [
    { "id": "user", "label": "User", "kind": "actor", "emoji": "🧑" },
    { "id": "api", "label": "Auth API" },
    { "id": "db", "label": "Users DB", "kind": "database" }
  ],
  "messages": [
    { "id": "m1", "from": "user", "to": "api", "label": "sends credentials" },
    { "id": "m2", "from": "api", "to": "db", "label": "looks up user" },
    { "id": "m3", "from": "api", "to": "user", "label": "returns token", "kind": "reply" }
  ],
  "frames": [{ "kind": "opt", "label": "user found", "messages": ["m3"] }],
  "stories": [{ "id": "login", "title": "Log in", "beats": [
    { "title": "Credentials go in", "edge": "m1" },
    { "title": "The user is looked up", "edge": "m2", "caption": "One indexed read." },
    { "title": "A token comes back", "edge": "m3" }
  ] }]
}
```

Frames (`loop`, `alt`, `opt`, `par`) cover one unbroken run of message ids; they may nest. `notes` put a short text over participants after a message. In a sequence a beat's `edge` is a message id.

## Degraded mode

If you cannot run shell commands, write `diagram.json` and give the user the exact commands from steps 3, 4 and 5 with the real `<skill-dir>` path.

## Security

Labels, captions and ids are escaped in the page, never read as markup. Specs accept no URLs, CSS, SVG or HTML. The page makes no network requests, and its CSP blocks them. Keep secrets out of labels and captions.
