# Portability run: GitHub Copilot CLI (2026-10-15)

All results measured on this macOS machine (Darwin, Node 24.7.0), 2026-10-15.
Copilot CLI: `GitHub Copilot CLI 1.0.98` (`copilot --version`). Skills installed at project scope.

## Commands (exact)

Install (from `.scratch/copilot-run`, after `git init -q`):
`node plugins/portable-artifacts/bin/install.mjs copilot --project .`
(installer also ran `npm install` in each skill, so `node_modules` existed before any run; make-dashboard/data/sales.csv copied from `skills/make-dashboard/test/fixtures/data/sales.csv`.)

Each run (flags from `copilot --help`: `-p` non-interactive, `--allow-all-tools` required for non-interactive), `<SUF>` = `You may install any missing dependencies the skill's doctor reports; I consent. Set generatedBy.agent to "Copilot CLI".`:

1. `copilot -p "/make-dashboard revenue by region and the monthly trend from data/sales.csv. <SUF>" --allow-all-tools`
2. `copilot -p "/make-diagram the checkout request path from the browser to the orders DB. <SUF>" --allow-all-tools`
3. `copilot -p "/make-explainer a concept explainer of how a request moves through a CDN. <SUF>" --allow-all-tools`
4. `copilot -p "/make-motion a 6 second title card that counts up to 18. <SUF>" --allow-all-tools`

Runs were sequential, 15-minute cap, none hit it (each finished in 12-28 s). Logs: `.scratch/copilot-run/logs/<skill>.log` (gitignored).

## Results

| Skill | Picked up | Doctor | generatedBy.agent | validate | build | check.mjs | Output |
|---|---|---|---|---|---|---|---|
| make-dashboard | yes (`skill(make-dashboard)`) | ran, `--json`, clean | "Copilot CLI" via `--agent` flag (page footer shows it; spec has no generatedBy) | exit 0 ("valid") | exit 0 | no check.mjs exists in this skill (N/A) | `.scratch/copilot-run/dist/index.html` |
| make-diagram | yes | ran, `--json`, clean | "Copilot CLI" (+ model "claude-sonnet-5.5") in spec | exit 0 | exit 0 | agent: DENIED (no approval); my manual run: exit 0, "skipped (no browser: playwright is not installed)" | `~/.agent/diagrams/checkout-request-path.html` (skill default; copied to `.scratch/copilot-run/diagram-out.html`) |
| make-explainer | yes | ran, `--json`, clean | "Copilot CLI" in spec | first validate exit 1, then exit 0 after agent fixed it | exit 0 (`--out ./cdn-explainer.html`) | agent did not run it; my manual run: exit 0, "skipped (no browser: playwright is not installed)" | `.scratch/copilot-run/cdn-explainer.html` |
| make-motion | yes | ran, `--json`, clean | "Copilot CLI" in spec | exit 0 | exit 0 | N/A | `.scratch/copilot-run/out/motion.mp4` (6.000 s) |

Motion ffprobe (`ffprobe -v error -show_entries format_tags=comment,artist out/motion.mp4`): `TAG:comment=make-motion · model not reported · effort not reported · Copilot CLI · 15 Oct 2026`. No `artist` tag.

Page checks (grep): dashboard, diagram, explainer HTML each contain one `rel="icon" type="image/svg+xml" href="data:..."` link and the provenance footer text (`... · Copilot CLI · 15 Oct 2026`; explainer: `not reported · effort not reported · Copilot CLI`). Exit codes for validate/build for the dashboard were taken from the log (`validate` printed "valid"; build wrote `dist/index.html`); I re-ran `validate.mjs dashboard.json` myself: exit 0.

## Failures and deviations (verbatim, short)

- make-diagram, agent's `check.mjs` call: `Permission denied because no interactive user response was available.` Cause: build default output is `~/.agent/diagrams/`, outside the project; Copilot refuses paths outside the workspace without `--allow-all-paths`. Side effect: the run wrote `~/.agent/diagrams/checkout-request-path.html` (239 KB), against the "never touch ~/.agent" constraint. Not cleaned up by me; owner may delete it. Not rerun (a rerun would write there again).
- make-explainer: `Create explainer.json` -> `Path already exists` (scaffold `--out` had already written it; agent then `rm`'d and rewrote it). First validate: `sections[5].title: required`, `explainer.json: 1 error`; agent fixed and passed.
- make-dashboard: `node .../make-dashboard/scripts/check.mjs` -> `MODULE_NOT_FOUND`; the script does not exist in this skill (my scoring assumption was wrong, not a skill failure).
- make-dashboard: the agent said it would set generatedBy via flags and did not read the built HTML; I confirmed the footer myself.

## Not exercised

- Interactive "ask once before installing" consent (R37: `copilot -p` cannot ask; consent was pre-granted in the prompt).
- Doctor install/`--fix` path: doctor reported nothing missing on every run because `install.mjs` had already run `npm install`; the doctor never saw a missing `node_modules`.
- Doctor `--for check`: Playwright/Chromium was absent, so `check.mjs` skipped for diagram/explainer; no agent ran doctor `--for check` first, so the browser dependency was never reported or installed. The check never actually loaded a page.
- Dashboard/explainer/diagram never opened in a browser by the agent; no screenshot reviewed.
- `npx skills add ... --skill make-diagram`: not attempted by any run (sister skills were copied locally).
- make-motion voiceover, serve/live modes.

## Proposed SKILL.md fixes (not applied)

1. make-diagram, `Workflow` step 4: when the host cannot write outside the project (Copilot CLI, sandboxed hosts) pass `--out ./diagram.html`; state "inside a project, prefer `--out ./diagram.html` over the `~/.agent/diagrams/` default". Fixes the denied `check.mjs` and avoids writing to the home dir.
2. make-diagram / make-explainer / make-dashboard: before `check.mjs`, run `node <skill-dir>/scripts/doctor.mjs --json --for check` and install the browser on consent; the agents here skipped `check.mjs` or never saw that the browser was missing.
3. make-explainer: "`scaffold.mjs ... --out explainer.json` already creates the file; edit it with the Edit tool rather than Create" (avoids the `Path already exists` detour).

## Doctor install path (live), R38/R26 (measured, macOS, 2026-10-15)

Fresh project `.scratch/copilot-run2`, installed with `node plugins/portable-artifacts/bin/install.mjs copilot --project . --no-deps` (no node_modules in any skill).

Doctor before (`node .github/skills/make-explainer/scripts/doctor.mjs --json --for recap-spec.json`, spec = copy of `references/examples/recap.explainer.json`, has diagram sections), exit 1, `ok:false`, `missing` ids: `node_modules` (required; "installs the skill's own npm packages"; fix `npm ci --omit=dev --prefix <...>/make-explainer`), `make-diagram` (required; "make-diagram is installed but its dependencies are not"; fix `npm ci --omit=dev --prefix <...>/make-diagram`), and `make-dashboard` (same wording). Full JSON: `.scratch/copilot-run2/logs/doctor-before.json`.

Command: `copilot -p "/make-explainer recap the CDN concept as a one-page explainer with a small architecture diagram. <SUF>" --allow-all-tools` (same consent sentence). Exit 0, 32 s. Log: `.scratch/copilot-run2/logs/make-explainer.log`.

What Copilot did, in order:
1. Ran `doctor.mjs --json` (no `--for`), then "User consented; installing". Ran `doctor.mjs --fix node_modules` -> succeeded (make-explainer/node_modules populated).
2. `scaffold.mjs concept --out explainer.json`, wrote the spec (again hit `Path already exists`, rm + Create).
3. validate FAILED: `sections[1].diagram: make-diagram is installed but its dependencies are missing (ajv); run npm ci --omit=dev --prefix .../make-diagram (doctor: ..., id make-diagram)` plus a title-length warning. The plain doctor run without `--for` had not listed make-diagram.
4. Agent: "Consent covers doctor-reported dependencies; running the doctor for the spec." Ran `doctor.mjs --json --for explainer.json`, then `doctor.mjs --fix make-diagram` -> succeeded (make-diagram/node_modules populated).
5. validate exit 0 (I re-ran it: `explainer.json: valid`), build exit 0, `cdn.html` written.

Outcome: both installs succeeded; the page has the diagram (`diagram` section in spec, inline SVG in HTML), one data-URI favicon link, and "Copilot CLI" in the provenance footer. make-dashboard deps were not installed (not needed). No browser check run (playwright absent). The ask-once step was pre-consented, so not exercised.

Finding: the first doctor call (no `--for <spec>`) cannot know a diagram section is coming, so it only reported node_modules; make-diagram surfaced later through the validate error. It worked via the error's own pointer, at the cost of one failed validate. Possible wording fix: SKILL.md says to re-run `doctor.mjs --json --for explainer.json` once the spec exists and before validate. (Step 1 already mentions `--for <spec.json>` once the spec exists; the agent skipped it.)

## Rerun after SKILL.md fixes (R39; measured, macOS, 2026-10-15)

SKILL.md edits (no frontmatter or shared-block change): make-explainer step 1 (`--out` already creates the file; edit in place), step 3 (rerun `doctor --json --for explainer.json` and handle anything new before validate), step 5 (run `doctor --json --for check` before `check.mjs`); make-diagram step 4 (`--out ./<name>.html` inside a project), step 5 (run `doctor --json --for check` first). Tests after the edit: `node --test "test/*.test.mjs"` in bin 56/56 pass; `npm test` make-explainer 674/674, make-diagram 635/635.

Rerun: fresh `.scratch/copilot-run3`, `install.mjs copilot --project . --no-deps`, same explainer prompt and consent sentence, `--allow-all-tools`. Exit 0, 36 s. Log: `.scratch/copilot-run3/logs/make-explainer.log`.

Scoring:
- Ran `doctor --fix node_modules`: yes. Both installs succeeded: yes (make-explainer, then make-diagram).
- Ran `doctor --json --for explainer.json` before validate: partly. It ran it chained in the same command as validate (`doctor.mjs --json --for explainer.json; node validate.mjs explainer.json`), so the doctor reported make-diagram missing but validate also failed once in that same call (`sections[2].diagram: make-diagram is installed but its dependencies are missing (ajv)`); then it ran `--fix make-diagram`. Doctor-before-validate is now agent behaviour (previously it only ran `--for` after the failed validate), but it did not stop between the two.
- "Path already exists" detour: NOT avoided. The agent again tried Create on `explainer.json` (`Path already exists`), then `rm explainer.json` and Create. The step 1 sentence did not change this. The agent also tried to Create `/tmp/cdn-explainer.json` first (denied: no approver).
- validate exit 0 (I re-ran: `explainer.json: valid`), build exit 0, page has diagram (6 `<svg`), one favicon link, "Copilot CLI" in footer.
- No background processes left from this run.

Conclusion: fix 1 helped partly; fix 2 had no measurable effect (the agent writes the whole file with Create regardless). A stronger wording would be "Do not use a file-create tool on explainer.json; edit the scaffolded file", or accept the detour as harmless (one rm).
