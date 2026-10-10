# portable-artifacts

**Dashboards and animated explainers from a prompt — built locally, offline,
from open-source parts, by any coding agent.**

Two agent skills that do what hosted "artifact" features do, without a cloud,
an account or a particular model:

| Skill | You say | You get |
|---|---|---|
| [`make-dashboard`](skills/make-dashboard/) | "Revenue by region and the monthly trend from `data/sales.csv`" | One self-contained `index.html`: KPI tiles + Vega-Lite charts. Every chart expands to show **its SQL, row count and refresh time**. Rerun one command to refresh — no LLM involved. |
| [`make-motion`](skills/make-motion/) | "8-second clip: Q3 revenue up 18%, then a bar chart of Q1–Q3" | A live preview with a scrubber and a deterministic **1080p MP4**. "Slow scene 2" changes one field, not the whole video. |

[**See them in action**](https://abhijitbansal.github.io/claude-skills/features/portable-artifacts.html#showcase): a real dashboard and video an agent generated from one prompt each, with the prompts and specs.

<p>
  <img src="../../docs/features/img/portable-artifacts/dashboard-light.jpg" alt="A make-dashboard page: four KPI tiles and four charts, each with a Query disclosure" width="49%">
  <img src="../../docs/features/img/portable-artifacts/motion-q3-revenue.gif" alt="A make-motion render: a +18% counter, then animated revenue bars" width="49%">
</p>

## How it works

The model writes **one small JSON spec**. Deterministic Node scripts do
everything else.

```
prompt ──▶ any agent ──▶ spec.json ──▶ validate ──▶ build / preview / render
                ▲                          │
                └── field-level errors ◀───┘   e.g. charts[0].query: "rev_by_regin"
                                                    not found; did you mean "rev_by_region"?
```

- **Small model job** — "write JSON that matches this schema" works on weak
  and local models too; the validator's did-you-mean errors drive the retry
  loop.
- **Targeted edits** — a change is one field in the spec, never regenerated
  code, so everything else stays exactly the same.
- **Reproducible** — the same spec always produces the same page or video.
- **Offline** — after a one-time install nothing touches the network except
  your own data sources. Specs that try (remote chart data, `url()` colours)
  are rejected, and the outputs carry a strict CSP.

## Install

### Claude Code

```bash
/plugin marketplace add abhijitbansal/claude-skills
/plugin install portable-artifacts@claude-skills
```

Then ask for a dashboard or a video, or call the skill directly:
`/make-dashboard …` or `/make-motion …`. On first use the agent runs the
one-time `npm ci` inside the skill folder.

### Any agent, with `npx skills`

[`skills`](https://github.com/vercel-labs/skills) installs the two skill
folders into whichever agents you pick (Claude Code, Codex, Copilot,
Cursor, Gemini CLI, and others):

```bash
npx skills add abhijitbansal/claude-skills --skill make-dashboard make-motion
npx skills add abhijitbansal/claude-skills --skill make-dashboard make-motion -a claude-code codex github-copilot -y
```

It copies the folders but doesn't install their dependencies, so the agent
runs `npm ci` inside each skill folder on first use (the SKILL.md tells it
to).

### Codex, GitHub Copilot, Gemini CLI (or Claude Code without the marketplace)

Each host reads skill folders from its own directory, and the skill itself is
the slash command. The installer copies both skills to the right place and
installs their dependencies:

```bash
git clone https://github.com/abhijitbansal/claude-skills
node claude-skills/plugins/portable-artifacts/bin/install.mjs codex             # ~/.agents/skills
node claude-skills/plugins/portable-artifacts/bin/install.mjs copilot --project .  # ./.github/skills
```

| Host | `install.mjs` host | User dir | Project dir (`--project <dir>`) | Invoke |
|---|---|---|---|---|
| Claude Code | `claude` | `~/.claude/skills` | `.claude/skills` | `/make-dashboard …` |
| Codex CLI | `codex` | `~/.agents/skills` | `.agents/skills` | `$make-dashboard …` (or `/skills`) |
| GitHub Copilot (CLI + VS Code) | `copilot` | `~/.copilot/skills` | `.github/skills` | `/make-dashboard …` |
| Gemini CLI | `gemini` | `~/.gemini/skills` + `~/.gemini/commands/*.toml` | `.gemini/…` | `/make-dashboard …` |
| Anything reading `.agents/skills` | `agents` | `~/.agents/skills` | `.agents/skills` | host-specific |

Flags: `--skills make-motion` (just one), `--link` (symlink to this checkout
so `git pull` updates it), `--force` (replace an existing install),
`--no-deps` (skip `npm ci`).

**Any other agent** that can read files and run shell commands: copy a skill
folder into your project, run `npm ci` inside it, and add one line to your
`AGENTS.md` (or `.github/copilot-instructions.md`):

```markdown
To build a dashboard or an animated explainer, read and follow skills/make-dashboard/SKILL.md or skills/make-motion/SKILL.md.
```

### Requirements

| | make-dashboard | make-motion |
|---|---|---|
| Node.js ≥ 20 | ✓ | ✓ |
| `npm ci` in the skill folder (once) | ✓ | ✓ |
| Chromium for frame capture (once, ≈150 MB) | — | `npx playwright install chromium` (falls back to installed Google Chrome) |
| ffmpeg on `PATH` | — | `brew install ffmpeg` / `apt-get install ffmpeg` |

## Usage

Full walkthroughs, spec reference and troubleshooting: **[USAGE.md](USAGE.md)**.
Each skill folder also has its own README.

## Security model

- **Dashboards run model-written SQL.** Each query must parse (DuckDB's own
  parser) as a single SELECT, and an allowlist over its syntax tree lets it read
  only the declared sources and its own CTEs (table functions: `range`,
  `generate_series`, `unnest`; no `query()`, `read_*`, `duckdb_*`, system
  catalogs or `sqlite_*`/`postgres_*`/`mysql_*` bridges). It runs wrapped in a
  row limit and a timeout, against a DuckDB connection locked to the exact
  declared files (`allowed_paths`, external access off, configuration locked).
  Sources must live under the spec's folder unless you pass `--allow-outside`.
  Attached DuckDB files with views or macros are refused. For Postgres and
  MySQL, `READ_ONLY` only limits DuckDB: **use a read-only database role**.
  Credentials come only from environment variables and are scrubbed from
  errors and result cells (defence in depth: the SQL allowlist is the control).
- **Built pages embed the query results.** Publishing `index.html` publishes
  the data.
- **No network from specs.** Chart `url`/`data`/`usermeta` keys are rejected at
  any depth; motion colours can't be `url()`; pages run under a CSP without
  `unsafe-eval`; the renderer aborts any non-local request; local servers bind
  `127.0.0.1` and check the `Host` header.

## Cross-host eval

[`eval/`](eval/) runs a fixed set of 10 prompts per skill through `claude`,
`codex`, `codex --oss` (Ollama), `gemini` and `copilot`, and scores spec
written / valid / validate retries / build or render ok / changed paths on edit
prompts. Results summaries live in `eval/results/summary-*.md`.

## Licences

Everything this plugin depends on is open source:

| Component | Licence |
|---|---|
| [DuckDB](https://duckdb.org) (`@duckdb/node-api`) | MIT |
| [Vega](https://vega.github.io), Vega-Lite, vega-embed, vega-interpreter | BSD-3-Clause |
| [anime.js](https://animejs.com) v4 | MIT |
| [Playwright](https://playwright.dev) | Apache-2.0 |
| [Ajv](https://ajv.js.org) | MIT |
| Inter, JetBrains Mono (via Fontsource) | OFL-1.1 |
| ffmpeg (system binary, not vendored) | LGPL/GPL |

Not used, by design: Remotion and GSAP (free to use, but not under OSI
licences).
