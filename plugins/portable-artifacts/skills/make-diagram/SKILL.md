---
name: make-diagram
description: Use when the user wants an architecture diagram, flowchart, sequence diagram or state diagram as a polished offline HTML page, with named stories that play along the edges and a side panel to explore nodes and routes. The agent writes a small JSON topology and scripts lay it out and render it. Not for ER diagrams, Gantt charts or C4 models, nor charts of numbers (make-dashboard).
argument-hint: what to draw, e.g. "checkout request path from browser to orders DB, with the order story"
model: haiku
effort: low
---

# make-diagram

You write one JSON file, `diagram.json`: a title, a type, nodes with edges (or participants with messages), and usually one or two stories: named chapters of beats, each beat one hop along an edge with a title and a caption. Scripts lay it out with ELK, check the geometry and build one offline HTML page with a story player, an Explore panel and full screen. You never write coordinates, CSS, SVG or HTML.

Run every command from the project folder (where `diagram.json` lives), using the full path to the scripts. If the request is empty, ask what to draw.

Run every step yourself (or hand off as the Cheaper model section says), in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

## Cheaper model

Skip this section if you are running in Claude Code (it already runs this skill on the model named in the frontmatter), or if `artifact-builder` is not in your list of available agents. Otherwise, if you can start another agent, start the `artifact-builder` agent to do the work, unless you are already artifact-builder. If you are already artifact-builder, skip the rest of this section and do the work yourself.

Give it a self-contained brief. It has no memory of this conversation, so the brief must say:

1. What to build, and every fact and choice from this conversation that affects it (data, names, wording, theme, what the user asked for and what they ruled out).
2. This skill directory: the full path of the folder that holds this SKILL.md.
3. The spec path: where it should write the JSON spec.
4. Optionally, an output folder for the build (it passes this to the build script as `--out`).

Relay only the output path it returns. Do not repeat its work.

If the `artifact-builder` agent is not installed, or you cannot start another agent, continue with the steps below yourself.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, so it can report the vendor icon packs its `cloud:` icons need, and `--for check` before `check.mjs`). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Running the commands

- Run one plain command per call, with literal absolute paths: write `<skill-dir>` out in full, never through a shell variable.
- No heredocs, no sed -i and no inline scripts: write specs and other files with your file-writing tool. If that tool fails, say so; do not work around it with a shell script.
- No cd, no && or ; chains, no shell variables and no pipes. Run from the project folder, and do not follow a command with an echo of its exit code.
- A command prints its own verdict (`valid`, `wrote <path>`, `check: skipped`). That output is the result; the exit codes listed for each script are for reference.

## Workflow

1. Pick the type and write `diagram.json` (examples below; every field in `<skill-dir>/references/schema.md`; ready-made files in `<skill-dir>/references/examples/`, `story.diagram.json` among them).
2. Icons and emoji are optional. Find an icon: `node <skill-dir>/scripts/icons.mjs search <word>` prints refs like `lucide:database`, `brand:postgresql` or `cloud:aws-lambda`. Use a ref exactly as printed. For an AWS or Google Cloud service (Lambda, S3, Cloud Run) use a `cloud:` ref: `search lambda`, `search "cloud run"` or `search gcp`. Cloud icons keep their own colours, and `tone` does not tint them. If the service is not found, do not invent a name: tell the user the official icons can be imported, and give them this: download the vendor's icon pack (AWS Architecture Icons, or Google Cloud's icons), accept the vendor's terms, unpack it, then run `node <skill-dir>/scripts/icons.mjs import <aws|gcp> <folder>` (it reads that folder only, no network, no prompt; it prints the names it added and what it skipped). Then use the names it printed. You must never download or unpack the vendor's pack yourself. Skip icons if unsure: most kinds have a default icon (see `<skill-dir>/references/kinds.md`); flow `start`, `end`, `decision` and state `start`, `end`, `choice` are drawn as shapes and take no icon or emoji.
3. `node <skill-dir>/scripts/validate.mjs diagram.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error.
4. Set `generatedBy` in the spec with the keys `model`, `effort` and `agent` (your host; `host` is accepted as an alias of `agent`), for example `"generatedBy": { "model": "claude-opus-5-5", "effort": "low", "agent": "Claude Code" }`. Never guess; leave out any key you do not know. `--model`, `--effort` and `--agent` on the build override it. `node <skill-dir>/scripts/build.mjs diagram.json` prints `wrote <path>` and the page's `file://` URL on a line of its own. The page goes to `<git root>/.scratch/<slug>.html` when the spec sits in a git repository, else to `~/.agent/diagrams/<slug>.html`; the `PA_OUTPUT_DIR` environment variable or `--out <file.html|dir>` picks another folder. `--format svg` writes one standalone SVG (the light palette only) for a doc or slide instead of the page. `--theme dusk|press|poster|paper|blueprint|ink|editorial|mono|brief` overrides the theme (default `blueprint`). Warnings never fail the build: they print to stderr as `path: warning: message`. Theme by purpose: `blueprint` (the default here) is technical and engineering, `paper` is clean and neutral, `dusk` is warm and soft, `press` is print editorial for dense reads, `poster` is loud and condensed for launches and demos, `mono` is a terminal console, `brief` is calm and executive, `ink` and `editorial` are the older looks. A theme the user names wins; otherwise keep `blueprint` unless the page is for a launch or pitch (`poster`), a dense read (`press`) or a sign-off (`brief`).
5. Look at it. First run `node <skill-dir>/scripts/doctor.mjs --json --for check`, then `node <skill-dir>/scripts/check.mjs <printed path> --shots shots`. It opens the page at desktop and phone width and fails on console errors, page overflow, text overflowing its node box, a node under the legend overlay, labels too small to read at fit, or a story that cannot reach its last beat. `--shots shots` also writes one PNG per width (390 and 1280) and colour scheme (light and dark) into the `shots` folder and prints each path: view every PNG before you report, and fix what you see. It needs Playwright and a browser (`doctor --for check` reports and installs them, after the user agrees). Without them it prints `check: skipped` and exits 0: a skipped check is not a pass.
6. Report: the HTML path, one line on what the diagram shows, the check result as one word (passed, failed or skipped), and "Play story (or `P`) opens beat 1 and plays it, Space pauses, `E` explores, `F` is full screen". Offer once to lift the diagram into a 3D scene with make-scene (a `lift` in `scene.json`).

For a change ("rename the cache", "add a beat for the retry"), edit only those fields of `diagram.json`, then validate and build again with the same `--out` and `--theme`; never edit the built page.

Sharing: a built page is one file you can send as is. Keep diagrams that name private systems or people local unless the user asks to publish. If your host can publish a page to a link, publish the single HTML file; `--format svg` gives a file for a doc or slide.

## Types and kinds

- `architecture`: `service` (default), `client`, `user`, `database`, `storage`, `queue`, `cache`, `function`, `gateway`, `external`, `other`. Optional `groups` (nest up to 3 deep); an edge may end at a group.
- `flow`: `step` (default), `start`, `end`, `decision`, `io`, `subprocess`, `wait`. Default direction is down.
- `state`: `state` (default), `start`, `end`, `choice`. A transition from a state to itself is allowed.
- `sequence`: participants of kind `service` (default), `actor`, `database`, `queue`, `external`; messages of kind `sync` (default), `async`, `reply`, `self` (from = to).

Every node and participant may carry `emoji` (exactly one emoji, drawn in the icon tile instead of the icon; not on the bare shapes above) and `detail` (up to 400 characters of plain text, shown in the Explore panel when the reader clicks the node). Each kind has a colour family that tints its card and its outgoing edges (`<skill-dir>/references/kinds.md`); `tone` (neutral, accent, good, warn, bad) overrides only the border and icon (a `cloud:` icon keeps its own colours).

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
