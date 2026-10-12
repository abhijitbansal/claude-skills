---
name: make-diagram
description: Use when the user wants an architecture diagram, flowchart, sequence diagram or state diagram as a polished offline HTML page with zoom, hover tracing, a step-by-step presentation mode and export; the agent writes a small JSON topology and scripts lay it out with ELK and render it.
argument-hint: what to draw, e.g. "checkout request path from browser to orders DB"
model: haiku
effort: low
---

# make-diagram

You write one JSON file, `diagram.json`: a title, a type, and nodes with edges (or participants with messages). Scripts lay it out with ELK, check the geometry and build one offline HTML page. You never write coordinates, CSS, SVG or HTML.

`<skill-dir>` is the folder that contains this SKILL.md. Run every command from the project folder (where `diagram.json` lives), using the full path to the scripts. If the request is empty, ask what to draw.

Run every step yourself, in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

First use: if `<skill-dir>/node_modules` is missing, say it is a one-time local install and run `npm ci --omit=dev --prefix <skill-dir>`.

## Workflow

1. Pick the type and write `diagram.json` (examples below; every field in `<skill-dir>/references/schema.md`; ready-made files in `<skill-dir>/references/examples/`).
2. Icons are optional. Find one: `node <skill-dir>/scripts/icons.mjs search <word>` prints refs like `lucide:database` or `brand:postgresql`. Use a ref exactly as printed. Skip icons if unsure: most kinds have a default icon (see `<skill-dir>/references/kinds.md`); flow `start`, `end`, `decision` and state `start`, `end`, `choice` are drawn as shapes and take no icon.
3. `node <skill-dir>/scripts/validate.mjs diagram.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error.
4. `node <skill-dir>/scripts/build.mjs diagram.json` prints the HTML path. Default folder is `~/.agent/diagrams/` (or `$PA_OUTPUT_DIR`); `--out <file.html|dir>` picks another; `--theme paper|blueprint|ink|editorial` overrides the theme.
5. `node <skill-dir>/scripts/check.mjs <printed path>` opens the page at desktop and phone width and fails on overflow or console errors. It skips cleanly (exit 0) when Playwright or a browser is missing; do not install either for it.
6. Report: the HTML path, one line on what the diagram shows, and "press P to present it step by step".

For a change ("rename the cache", "add a queue between api and worker"), edit only those fields of `diagram.json`, then validate and build again.

## Types and kinds

- `architecture`: `service` (default), `client`, `user`, `database`, `storage`, `queue`, `cache`, `function`, `gateway`, `external`, `other`. Optional `groups` (nest up to 3 deep); an edge may end at a group.
- `flow`: `step` (default), `start`, `end`, `decision`, `io`, `subprocess`, `wait`. Default direction is down.
- `state`: `state` (default), `start`, `end`, `choice`. A transition from a state to itself is allowed.
- `sequence`: participants of kind `service` (default), `actor`, `database`, `queue`, `external`; messages of kind `sync` (default), `async`, `reply`, `self` (from = to).

Writing rules: labels are nouns ("Orders DB"), edge and message labels are verbs ("writes order"). Labels stay under 48 characters, notes under 60 (one line), edge labels under 40, the title under 120 and the subtitle under 160. Ids are lowercase letters, digits, `-`, `_`, starting with a letter. At most 12 nodes reads best; split a bigger system into several diagrams (hard limits: 60 nodes, 120 edges, 12 participants, 60 messages). `tone` (neutral, accent, good, warn, bad) recolours only the border and icon. `direction` (right or down) applies to graph types, not sequence.

## Architecture example

```json
{
  "title": "Checkout request path",
  "type": "architecture",
  "groups": [{ "id": "vpc", "label": "Private VPC" }],
  "nodes": [
    { "id": "web", "label": "Web app", "kind": "client" },
    { "id": "api", "label": "Checkout API", "group": "vpc" },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "vpc", "icon": "brand:postgresql" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "posts order" },
    { "from": "api", "to": "db", "label": "writes order", "style": "async" }
  ]
}
```

Edge `style`: `solid` (default), `dashed`, `async`; `"both": true` draws arrows at both ends.

## Sequence example

```json
{
  "title": "Login",
  "type": "sequence",
  "participants": [
    { "id": "user", "label": "User", "kind": "actor" },
    { "id": "api", "label": "Auth API" },
    { "id": "db", "label": "Users DB", "kind": "database" }
  ],
  "messages": [
    { "id": "m1", "from": "user", "to": "api", "label": "sends credentials" },
    { "id": "m2", "from": "api", "to": "db", "label": "looks up user" },
    { "id": "m3", "from": "api", "to": "user", "label": "returns token", "kind": "reply" }
  ],
  "frames": [{ "kind": "opt", "label": "user found", "messages": ["m3"] }]
}
```

Frames (`loop`, `alt`, `opt`, `par`) cover one unbroken run of message ids; they may nest. `notes` put a short text over participants after a message.

## Presentation steps

Optional `steps` is a list of `{ "title", "note", "show", "focus", "highlight" }` with ids to reveal, fit the camera to, and emphasise. Leave `steps` out for most diagrams: the build makes one step per layer (per message for a sequence), and any id no step reveals gets a final "Everything" step.

## Degraded mode

If you cannot run shell commands, write `diagram.json` and give the user the exact commands from steps 3, 4 and 5 with the real `<skill-dir>` path.

## Security

Labels and ids are escaped in the page, never read as markup. Specs accept no URLs, CSS, SVG or HTML. The page makes no network requests, and its CSP blocks them. Keep secrets out of labels.
