# One-line numbers, cheap-model routing and plan mode for portable-artifacts

Date: 2026-10-21. Branch: `worktree-improve-skills`. One branch, one PR.

## Intent

Three changes in `plugins/portable-artifacts`, delivered together (Part 3, plan mode,
is a new feature added after the first two were agreed; see the end of this file):

1. **Numbers wrap.** A percentage or number-plus-unit ("87%", "12 files",
   "120 ms") sometimes breaks across lines in explainer pages, slide decks,
   motion text and dashboards. It reads badly. Each such token must stay on one
   line.
2. **The cheap-model hint only works in Claude Code.** The skills say
   `model: haiku` in SKILL.md frontmatter. No other host reads that key, so on
   GitHub Copilot (CLI and VS Code chat) and OpenAI Codex the work runs on the
   user's expensive default model. The user wants the render work (explainer,
   motion, diagram, dashboard, scene) to run on a cheaper, faster model in those
   hosts too, as close to guaranteed as the hosts allow.

## Goals

- No number, percentage or number-plus-unit token spans two lines in:
  explainer pages, explainer slide decks, make-motion text, make-dashboard KPIs.
- A check that fails when one does, shown failing on today's code first.
- A cheap-model "builder" agent installed for Claude Code, Copilot (CLI and
  VS Code) and Codex, plus SKILL.md wording that tells the running agent to
  delegate to it.
- Documented deterministic fallbacks per host, and an honest statement of what
  is advisory.

## Non-goals

- Reflowing prose or changing line breaks in ordinary sentences.
- Changing stored text: the spec JSON keeps ordinary spaces; wrapping control
  happens at render time.
- Guaranteeing delegation. No host lets a skill force a subagent; this is
  stated, not hidden.
- New npm dependencies.
- Changing make-motion's output for specs without such tokens (same spec, same
  MP4).

## Anti-goals

- A fix that clips or overflows a long value instead of shrinking it.
- A guardrail that has only ever passed.
- Claiming the cheap model ran when only the instruction to use it was given.

## Part 1: one-line numbers

Cause, from reading the code (not yet reproduced in a browser):

- `make-explainer/template/base.css:121`: `.kpi-value` has
  `overflow-wrap: anywhere`, which allows a break inside "87%" and also shrinks
  the minimum width the `auto-fit` KPI grid uses, squeezing tiles. The same
  rule is on the dashboard's `.kpi-value` (`make-dashboard/template/page.html:34`).
- `.cl-pct`, `.cl-count`, `.cl-tally`, `.deck-count` have no `nowrap`.
- Prose can wrap between a number and its unit ("87" / "%", "12" / "files").
- make-motion `text` uses `white-space: pre-wrap` (optional `maxWidth`), so a
  number can separate from its unit. Counters are already `white-space: pre`.

Changes:

1. **CSS.** `overflow-wrap: anywhere` becomes `overflow-wrap: break-word` on KPI
   values (explainer, dashboard). Add `white-space: nowrap` to the **whole** KPI
   value, the checklist counters, `.deck-count`, and numeric table cells (found by
   content or by the column's `align`). KPI values may be any string
   (`schema.mjs:57`), so a long one must not spill: make the tile a size container
   (`container-type: inline-size`) and size the value in `cqi` units, with a floor.
   Validate warns when a KPI `value` is longer than 12 characters and suggests
   moving the words to `note`. *(Builder-check call.)*
2. **Build step, explainer.** In `scripts/lib/markdown.mjs` inline rendering,
   wrap number-plus-unit matches in a `nowrap` span. Patterns: optional sign or
   currency, digits with `,` or `.`, optional space, then `%`, a unit
   (`ms s min h d KB MB GB TB px x k M B`), or `×`. A number followed by an
   ordinary noun ("12 files", "3 options") is **not** matched: that would reflow
   prose. Stored text is unchanged.
3. **Render step, motion.** In `template/renderer.mjs`, replace the space inside
   a matched token with U+00A0 when setting text. Applied at render only, so the
   spec and determinism are untouched for specs with no such token.
4. **Check.** Add to `scripts/check.mjs` of make-explainer and make-motion (and
   the dashboard's equivalent browser test): find matched tokens in the rendered
   DOM and fail when a token's `Range.getClientRects()` spans more than one line.
   The same check also fails when a KPI value overflows its tile
   (`scrollWidth > clientWidth`), since the line check cannot catch spill.
5. **Tests.** A fixture with narrow KPI tiles, a slide, a checklist and motion
   text with "87%", "1,204 ms", "$4.2k", "+12 %", and a 22-character KPI value.
   Browsers already refuse to break inside "87%" in plain prose, so in prose the
   RED run mainly fails on the spaced tokens ("1,204 ms", "+12 %") and on the KPI
   tiles. RED first: run against today's code and confirm the check fails, then
   fix, then confirm it passes.

## Part 2: cheap-model routing across hosts

Facts (researched 2026-10-21 from host docs; items marked unverified need a live
test on the target version):

- No host honors a `model:` key in SKILL.md. Claude Code honors it for the
  skill's own turns; Copilot CLI/VS Code honor `name`, `description` and a few
  others; Codex honors `name` and `description`.
- The deterministic route in every host is a **custom agent file that pins the
  model**. A skill telling the running agent to spawn it is advisory.
- Copilot: `~/.copilot/agents/*.agent.md` or `.github/agents/*.agent.md`.
  VS Code accepts `model` as a string or an array in preference order (first
  available wins). The Copilot CLI agent page does not list `model`; the CLI
  precedence reference implies it works. **Unverified.**
- Codex: `~/.codex/agents/*.toml` or `.codex/agents/*.toml` with `name`,
  `description`, `developer_instructions`, optional `model` and
  `model_reasoning_effort`. A forum report of "unknown agent_type" rejections is
  **unverified**.
- Cheap models (from host model lists, per-client availability unverified):
  Copilot: Claude Haiku 5.5, then GPT-5.4 nano as fallback. Codex: `gpt-6-luna`.

Changes:

1. **Agent definition, one source, two outputs.** `artifact-builder`:
   - Copilot: `artifact-builder.agent.md`, `model: ['Claude Haiku 5.5', 'GPT-5.4 nano']`.
   - Codex: `artifact-builder.toml`, `model = "gpt-6-luna"`,
     `model_reasoning_effort = "low"`.
   - **No Claude Code agent file.** Claude Code already applies a skill's
     `model: haiku` to the skill's own turns; a spawned subagent on top would be a
     second cheap hop that loses context. *(Builder-check call.)*
   Its instructions: read the named SKILL.md, write the spec JSON from the brief,
   validate, build, return only the output path and the validator result.
2. **Installer.** `bin/install.mjs` writes the agent file by default for the
   `codex`, `copilot` and `agents` hosts (the latter writes both files), at user
   level (`~/.copilot/agents`, `~/.codex/agents`) and with `--project` into the
   target repo (`.github/agents`, `.codex/agents`). `claude` and `gemini` write no
   agent file. Existing files are not overwritten without `--force`. Users who
   install with `npx skills add` get no agent file; doctor reports that and prints
   the install command, with no auto-fix. *(Builder-check call.)*
3. **SKILL.md preamble, all five skills.** A short block: if your host did not
   already apply this skill's `model:` key, can spawn subagents, and you are not
   already `artifact-builder`, spawn it with a **self-contained brief** (what to
   build, the facts and choices from the conversation, and this skill's
   directory) and relay its output path; otherwise continue yourself. The parent
   writes the brief because a fresh subagent has no conversation; the builder
   still writes the JSON. Add `model: haiku` to make-motion (missing today).
   *(Builder-check call.)*
4. **Fallbacks documented** in the plugin README and USAGE: `copilot --agent
   artifact-builder`, the VS Code agent picker, Codex `[agents]
   default_subagent_model`. Each marked deterministic or advisory.
5. **Doctor.** `doctor.mjs` reports whether the agent file is installed and which
   model it pins. The check is optional (`required: false`): a missing file never
   makes doctor exit 1. Doctor does not know its host, so it looks for the file in
   every host folder.
6. **Evidence (user decision: Copilot only, on the user's $20 Copilot test plan;
   no Codex account, so Codex is not tested).**
   - Before any run, look up the premium-request multiplier of the cheap model
     and estimate the cost; stop if the estimate exceeds what the plan has left,
     and tell the user.
   - Smoke run on Copilot CLI: 2 prompts per skill, read the provenance footer
     (`generatedBy.model`) to confirm the cheap model ran and the output
     validated. Self-reported, so recorded as evidence, not proof.
   - **make-motion gate (user decision: the PR blocks on it).** Run the motion
     prompts (up to 10) on the cheap model via Copilot CLI. Pass rule, my call:
     at least 8 of 10 specs valid and built; if it passes, motion keeps
     `model: haiku` and the delegation line. If it fails, run the same prompts on
     Copilot's default model for a baseline and report both; motion then drops
     `model: haiku` and the delegation line, and the README says why. The
     2026-10-10 Codex "6/10" is not used as a baseline: four of its prompts were
     stopped by a usage limit, so it was 6 valid of 6 that ran.
   - Codex files ship untested: README and USAGE say "written from the Codex
     docs, not run live".

## Part 3: plan mode for make-explainer

A plan page a senior developer or engineering manager would put in front of
reviewers: it says what needs a decision, shows just enough to make the call, and
lets reviewers answer on the page. The answers go back to the AI agent as a file.

Shape (user decision): a **fifth preset, `plan`, of make-explainer**, not a new
skill. It adds a few section types and two plan themes. No new skill count.

### Page structure: decision-first, not information overload

User asked for "just enough for people to make the call", then additional context
as needed, "maybe a touch of what Elon Musk might like". My reading of that last
phrase (my guess, correct me): blunt first-principles framing, one-line verdict,
hard numbers and dates, delete-the-requirement thinking, bold and minimal. Not
decoration.

1. **Hero:** the plan as a one-line verdict, a "ship by / cost / risk" KPI strip.
2. **Needs your decision** (open by default): the approvals and decisions, each
   answerable in place. This is the top of the page.
3. **Review these first:** the 3 to 5 places a reviewer should look hardest, each
   with a link to the detail below.
4. **The plan:** goals and non-goals, architecture diagram (existing `diagram`
   section), phases (`steps` or `timeline`), what it deliberately does not do.
5. **Why these choices:** for each decision, the options considered, trade-offs,
   the recommendation and the reason (`decision` section, below).
6. **Risks, open questions, rollout.** Collapsed by default (`details`).
7. **Verdict bar:** overall Approve / Approve with changes / Not yet, reviewer
   name, Export.

### New section types

- `decision`: `question`*, `options[]`* (2 to 5: `label`*, `pros[]`, `cons[]`),
  `recommended`* (an option label), `why`* (markdown-lite, the stated reason),
  `default` (what happens if left unanswered). Reader picks an option or writes an
  override.
- `approval`: `item`*, `why`*, `impact`, `owner`. Reader chooses Approve /
  Needs changes / Reject with an optional comment.
- `question`: `text`*, `default`. Free-text answer; a blank answer means the
  default applies and the export says so.
- `verdict`: the overall verdict control (one per page, last section).

Existing sections reused unchanged: `tldr`, `kpis`, `callout`, `steps`,
`timeline`, `compare`, `risks`, `diagram`, `details`, `cards`, `table`.

### Answers back to the agent

- Answers save in the reader's browser as they go (same `localStorage` approach as
  the checklist, keyed by the plan's `key`; blocked storage is tolerated and
  stated).
- **Export:** a "Copy answers" button (compact JSON block) and a "Download
  plan-answers.json" button. Each answer carries the section `id`, the question
  text, the chosen option or answer, whether it is the recommendation or an
  override, and any comment. The file also carries the plan `key`, a hash of the
  plan's JSON and the reviewer name.
- **Agent side:** `scripts/answers.mjs <plan.json> <answers.json>` validates the
  answers against the plan (unknown ids, stale hash, unanswered required items)
  and prints a plain summary the agent can act on: decisions made, overrides,
  items needing changes, open questions answered. Exit codes follow the other
  scripts (0 ok, 1 problems, 2 usage).
- Chosen by the user: copy or download only. No save server.

### Themes

Two plan themes added to `shared/themes/` (names are my call):

- **`mono`**: super-techie. Dark by default, monospace display, dense, sharp
  corners, terminal-like accent, numbers prominent.
- **`brief`**: executive. Light by default, large numerals, serif or wide sans
  display, generous spacing, restrained accent, fewer visible controls.

Both must pass the existing contrast checks (`shared/contrast.mjs`) and ship the
same keys as the seven existing themes, so every skill can use them. The preset
defaults to `mono`; `--theme brief` or the spec's `theme` picks the other.

### Slides

A plan can render as a deck like other presets. Interactive controls do not run
in a deck; the deck shows the recommended choice and the question, and the page
form says answers are collected in the page version. *(My call.)*

### Tests and checks

- Schema tests for each new type and its limits.
- Browser test: answering each control, reloading restores it, export JSON
  matches the plan, `answers.mjs` accepts it, and rejects an answers file whose
  plan hash is stale. Show the stale-hash rejection failing before trusting it.
- The Part 1 no-wrap check runs on a plan fixture too.
- Page is driven through the browser and a screenshot is viewed for both themes
  (light and dark), at desktop and phone width.

## Constraints

- Edit shared code in `plugins/portable-artifacts/shared/` and run
  `node bin/sync-shared.mjs`; CI fails on drift.
- No inventory-count changes expected (no new skills). If the agent file counts
  as a new asset anywhere, run `python3 scripts/sweep_counts.py --check`.
- Site pages with commands keep per-line copy buttons (CLAUDE.md contract).
- Tests: node tests in each skill, `bats tests/bats` after any `setup/` change.

## Decisions made by the user (2026-10-21)

- Dashboard gets the same fix.
- Installer may write user-level agent folders and supports `--project`.
- Models: Haiku 5.5 with GPT-5.4 nano fallback on Copilot; `gpt-6-luna` on Codex.
- One branch, one PR.
- Plan mode is a preset of make-explainer, with two new themes (one techie, one
  executive); answers return as copied or downloaded JSON; reviewers can pick an
  option per decision, approve or request changes per item, answer open questions
  in free text, and give an overall verdict with a name; decision-first structure
  that avoids information overload.

## Left to the builder

- Exact regex and unit list for number-plus-unit tokens (start from the patterns
  above; add cases found in the fixtures).
- Exact `clamp()` values for KPI font size.
- Wording of the SKILL.md delegation block and loop guard.
- How the three agent files are generated from one source (script or template).
- Whether the doctor check needs the host's CLI present or only reads files.
