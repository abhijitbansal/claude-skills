# Portable Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two host-agnostic, offline, open-source agent skills: `dashboard-builder` (prompt → SQL + Vega-Lite → static HTML with per-chart provenance) and `motion-explainer` (prompt → scene spec → preview + MP4).

**Architecture:** The model writes one JSON spec. Deterministic Node scripts validate it (Ajv plus a cross-field pass with did-you-mean errors) and then build, preview or render it. Each skill folder is self-contained: its own `package.json`, lockfile, scripts, template and references.

**Tech Stack:** Node 24 ESM (`.mjs`), `node --test`, ajv 8, @duckdb/node-api 1.5.6-r.1, vega 6 / vega-lite 6 / vega-embed 7, animejs 4.5, playwright 1.64, @fontsource/inter + @fontsource/jetbrains-mono, system ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-09-portable-artifacts-design.md`. It holds the authoritative schemas; the executor reads it in full.

## Global Constraints

- Every dependency has an OSI licence. No Remotion, no GSAP, no CDN URLs anywhere in the output.
- Scripts are `.mjs` only, with no shell scripts (CI shellcheck doesn't cover new paths). Use the Node 24 built-ins only, plus the deps listed above.
- `SKILL.md` frontmatter `description:` is **one line**. No `>-` or `|` (the registry parser truncates them).
- Nothing under `plugins/portable-artifacts/skills/` except skill folders, because CI requires `SKILL.md` in every entry.
- No network at build, preview or render time. Vendor JS is read from the skill's own `node_modules` and inlined or served locally.
- Credentials are never in the spec or in the output. Postgres and MySQL use `env` var names only.
- Validator text output is `<json.path>: <message>` per line. Exit codes: `0` ok, `1` spec errors, `2` usage or IO error.
- `scripts/lib/errors.mjs` is byte-identical in both skills.
- Agents do not commit. The orchestrator commits.

## Review Focus

1. **A spec path given relative to some other cwd.** `node skills/x/scripts/build.mjs ../proj/dashboard.json` must resolve source and image paths relative to the *spec file*, not the cwd. Test: run build from a different cwd.
2. **Query results with BIGINT, DECIMAL, DATE, TIMESTAMP, NULL or very large ints.** The page must render instead of crashing on `JSON.stringify` BigInt. Test: a fixture query that casts each type.
3. **Malicious strings in data, titles or SQL** (`</script><img onerror>`). They must not execute in `dist/index.html`. Test: assert the raw HTML has no unescaped `</script` in the data block and that the title is escaped.
4. **An empty result set or a `LIMIT` truncation.** The chart renders empty with "0 rows", and truncation shows "truncated at N". Test: a build fixture with `WHERE false` plus `maxRows: 2`.
5. **A motion spec where keyframes don't start at t=0 or set only some props.** The value holds before the first keyframe and between keyframes for props that weren't set. Test: timeline sampling at t before the first keyframe and between keyframes.

---

### Task 1: Plugin scaffold, shared errors module, CI job

**Files:**
- Create: `plugins/portable-artifacts/.claude-plugin/plugin.json` (version `0.1.0`)
- Create: `plugins/portable-artifacts/README.md` (stub; filled in Task 6)
- Create: `plugins/portable-artifacts/skills/{dashboard-builder,motion-explainer}/scripts/lib/errors.mjs`
- Create: `plugins/portable-artifacts/skills/{dashboard-builder,motion-explainer}/test/errors.test.mjs`
- Modify: `.claude-plugin/marketplace.json` (add entry)
- Modify: `.github/workflows/test.yml` (add `node` job)

**Interfaces — Produces:**
- `levenshtein(a: string, b: string): number`
- `didYouMean(word: string, candidates: string[]): string | null`: returns the closest candidate when its distance is ≤ 2, or ≤ ⌊len/3⌋ for longer words, or when one string is a prefix of the other.
- `formatAjvErrors(errors: AjvError[]): {path: string, message: string}[]`: converts the Ajv `instancePath` `/charts/0/query` into `charts[0].query`. It maps `additionalProperties` to `<path>.<prop>: unknown property; did you mean "<x>"?` (with the suggestion taken from the schema's `properties` keys via `parentSchema`), `enum` to `must be one of a, b, c; did you mean "b"?`, `required` to `<path>.<prop>: required`, and `type` to `must be <type>`. Errors are deduplicated, and `anyOf`/`oneOf` noise is collapsed to the most specific branch error.
- `printResult({ok, errors}, {json: boolean, label?: string}): void`: writes to stdout.
- `pathJoin(base: string, key: string|number): string`: a helper used by the cross-field passes.

- [ ] Write `errors.test.mjs`: levenshtein basics, didYouMean hit and miss, formatAjvErrors on real Ajv output (compile a tiny strict schema with an enum, additionalProperties false and required, then validate bad data and assert the exact strings), and the printResult JSON shape.
- [ ] Run it; it fails (no module).
- [ ] Implement `errors.mjs`, then copy it byte-identically to the other skill.
- [ ] CI job `node`: ubuntu-latest, `actions/setup-node@v4` with node 24, then for each skill `npm ci && npm test`, then `cmp` the two `errors.mjs` files.
- [ ] Commit `feat(portable-artifacts): scaffold plugin + shared validator error module`.

### Task 2: Dashboard — spec validation

**Files:** `skills/dashboard-builder/{package.json, scripts/validate.mjs, scripts/lib/spec.mjs, scripts/lib/sql.mjs, references/schema.md, references/examples/{sales-overview,minimal}.json, test/fixtures/data/{sales.csv,sales.parquet}, test/validate.test.mjs}`

**Interfaces — Produces:**
- `spec.mjs`: `SCHEMA` (the JSON Schema object), `loadSpec(path) → {spec, dir}` (throws `UsageError` on unreadable or invalid JSON), and `validateSpec(spec, {dir}) → Promise<{ok, errors}>` (schema → cross-refs → SQL → Vega-Lite compile).
- `sql.mjs`: `openDb() → {conn, close}`, `checkSelect(conn, sql) → string|null` (null when ok, otherwise a message: "must be a single SELECT statement" / parse error), and `wrapLimit(sql, n) → string`.
- `validate.mjs` CLI: `node scripts/validate.mjs <spec> [--json]`. When `process.env.EVAL_LOG` is set, it appends one JSON line `{ts, ok, errors: n}` to that file.

- [ ] Tests: both examples are valid. Unknown top-level prop → did-you-mean. Bad source type → enum message. A chart query typo → `charts[0].query: "rev_by_regin" not found; did you mean "rev_by_region"?`. A duplicate chart id. A missing source file → `sources.sales.path: file not found: …`. `DELETE` / `SELECT 1; SELECT 2` / `COPY` all rejected. `vegaLite.data` present → `charts[0].vegaLite.data: remove — data is injected from the query`. An invalid Vega-Lite mark → a compile error surfaced under `charts[0].vegaLite`. CLI exit codes 0/1/2. `EVAL_LOG` line written.
- [ ] Generate the fixture parquet from the csv with a one-off DuckDB `COPY` inside the test setup, or commit a small parquet (< 20 KB).
- [ ] Implement until green. Commit.

### Task 3: Dashboard — build, serve, SKILL.md

**Files:** `scripts/{build.mjs,serve.mjs}`, `scripts/lib/{data.mjs,html.mjs}`, `template/page.html`, `SKILL.md`, `test/build.test.mjs`

**Interfaces:**
- Consumes: `loadSpec`, `validateSpec`, `openDb`, `wrapLimit`, `didYouMean`.
- Produces:
  - `data.mjs`: `toJsonSafe(value)` (BigInt → Number if safe, else string; DuckDB DECIMAL/DATE/TIMESTAMP value objects → number/ISO string; null kept) and `runQueries(spec, dir, {now}) → Promise<{[name]: {rows, columns, rowCount, truncated, sql, refreshedAt}}>` (attach/create views → lock down → run).
  - `html.mjs`: `escapeHtml(s)`, `jsonForScript(obj)` (escapes `<`, U+2028 and U+2029), `renderPage(spec, results, {vendor}) → string`.
  - `build.mjs` CLI: `node scripts/build.mjs <spec> [--out <dir>]`. The default out is `<specdir>/dist`. It prints the output path and a per-query row-count summary.
  - `serve.mjs` CLI: `node scripts/serve.mjs [dir] [--port n] [--open]`, bound to 127.0.0.1.
- Lockdown order: create the views and attachments → `SET allowed_directories=[<abs source dirs>]` → `SET enable_external_access=false` → `SET lock_configuration=true`. Verify `allowed_paths` exists in 1.5.6 and prefer it for file sources if it does.
- Field check after the queries run: walk `encoding.*.field` (including inside `layer[]`) and KPI `field` against `columns`. Fail with `charts[0].vegaLite.encoding.y.field: "revnue" is not a column of query "rev_by_region" (columns: region, revenue); did you mean "revenue"?`.
- Page: grid of cards (`half` = 2-col on ≥ 900px), KPI tiles row, header with title, description and "Refreshed <local time>". Each card has `<details><summary>Query · N rows · refreshed HH:MM</summary><pre>SQL</pre></details>`. vega, vega-lite and vega-embed UMD come from `node_modules/*/build/*.min.js`, inlined. vega-embed uses `actions: false`. The theme follows `prefers-color-scheme` (Vega `config` background transparent, axis/label colors from CSS vars read at runtime). Load the `dataviz` skill for palette and mark guidance; don't load any other design rulebook.
- [ ] Tests: build the example to a temp dir, assert the file exists and contains no `http://`/`https://` script src, no unescaped `</script` in the data, the SQL text and row counts. Review Focus 1–4 (cwd, types, XSS, empty/truncated). The field typo error. The lockdown: a query reading an undeclared file fails at build with a permission error.
- [ ] `SKILL.md`: when to use, the workflow (write `dashboard.json` → validate → fix errors → build → serve), "edit only `dashboard.json`, never `dist/`", a compact spec shape, exact commands, the degraded mode (print the commands for the user), a security note. Keep it ≤ 120 lines. Detail goes in `references/schema.md`.
- [ ] Implement until green. Commit.

### Task 4: Motion — validation + timeline (Node-testable core)

**Files:** `skills/motion-explainer/{package.json, scripts/validate.mjs, scripts/lib/spec.mjs, template/timeline.mjs, references/schema.md, references/examples/{q3-revenue,how-it-works,chart-reveal}.json, test/{validate,timeline}.test.mjs}`

**Interfaces — Produces:**
- `spec.mjs`: `SCHEMA`, `EASES` (string[]), `ANIMATABLE` (the per-type allowed animatable props), `loadSpec(path)`, `validateSpec(spec, {dir}) → {ok, errors}` (sync is fine), and `withDefaults(spec) → spec` (a pure copy that fills in size, fps, background, element base values, scale 1, opacity 1, rotate 0, draw 1, reveal 1, value = from).
- Cross-field checks: unique ids (scene and element, global), keyframes sorted by `t` and with `t ≤ scene.duration` (message names both values), an animatable prop not valid for the type (e.g. `draw` on text → `…keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate`), total duration ≤ 120, image `src` exists relative to the spec dir, and chart `vegaLite` compiles and has inline `data.values`.
- `timeline.mjs`: `buildTimeline(spec) → {timeline, states: Map<id, object>, duration /*sec*/, sceneStarts: number[], sceneOf: Map<id, sceneIndex>}`. It uses `createTimeline({autoplay:false, defaults:{ease:'linear'}})`, with one state object per element seeded from `withDefaults`. For each element and each prop, the track segments come from consecutive keyframes that set the prop, added with `{[prop]: {from, to, duration, ease}}` at offset `(sceneStart + kf.t) * 1000`. It also exports `seekTo(tl, sec)`. The scene-level `opacity` state for the fade transition is keyed `scene:<id>`. Import anime as `import { createTimeline } from 'animejs'` in Node; the browser gets an import map that points `animejs` at `/vendor/animejs/anime.esm.js`.
- [ ] Tests: examples valid, each cross-field error message exact. Timeline: linear midpoint value. Ease applied (outQuad at 50% ≠ 0.5). Hold before the first keyframe and after the last. A prop absent from the middle keyframe interpolates across it (Review Focus 5). The second scene's offsets shift by the first scene's duration. Fade scene opacity goes 0 → 1 over 0.4 s. Seek is idempotent (seek 1.5 → 0.2 → 1.5 gives the same state).
- [ ] Implement until green. Commit.

### Task 5: Motion — renderer, preview, render, SKILL.md

**Files:** `template/{index.html,renderer.mjs,preview-ui.mjs,styles.css}`, `scripts/{preview.mjs,render.mjs}`, `scripts/lib/{server.mjs,browser.mjs,ffmpeg.mjs}`, `SKILL.md`, `test/{server,ffmpeg,render-smoke}.test.mjs`

**Interfaces:**
- Consumes: `buildTimeline`, `seekTo`, `loadSpec`, `validateSpec`, `withDefaults`.
- Produces:
  - `server.mjs`: `startServer({specPath, mode}) → {url, close}`, bound to 127.0.0.1 on port 0. Routes: `/` → index.html, `/template/*`, `/vendor/animejs/*` → `node_modules/animejs/dist/bundles/`, `/vendor/vega*/*`, `/vendor/fonts/*` → @fontsource files, `/spec.json` → the spec re-read on every request, `/assets/*` → the spec dir (path-traversal-safe: resolve and require the path to start with the spec dir), and `/events` → SSE that emits `reload` on spec change (`fs.watch`, debounced 100 ms).
  - `renderer.mjs`: on load, fetch `/spec.json`, run `withDefaults`, build the DOM, render charts via `vega.View(...).toSVG()` and inline them, then wait for `document.fonts.ready`. It sets `window.__motion = {ready, duration, fps, size, sceneStarts, seek(sec)}`. `seek` calls `seekTo`, then `apply()`, which writes the transform `translate(-50%,-50%) translate(x,y) scale() rotate()`, opacity, scene layer visibility (only the active scene is visible), the line/rect `stroke-dashoffset` from `draw`, the chart `clip-path: inset(0 X% 0 0)` from `reveal`, and the counter text from `value.toFixed(decimals)` plus prefix and suffix.
  - `preview-ui.mjs`: in non-render mode it scales the stage to fit the window and adds a scrubber, play/pause (requestAnimationFrame → seek), a time readout, scene markers, keyboard shortcuts (space, ←/→ = 1 frame) and SSE reload that keeps the current time.
  - `browser.mjs`: `launchBrowser() → Browser`. It tries `chromium.launch()`, then on the "Executable doesn't exist" error falls back to `chromium.launch({channel:'chrome'})` with a stderr warning. If both fail it throws a message containing `npx playwright install chromium`.
  - `ffmpeg.mjs`: `findFfmpeg() → string`, checking `$FFMPEG_PATH`, then PATH, then a dynamic `import('ffmpeg-static')`. If none is found it throws an install hint. Also `encodeArgs({fps, out}) → string[]` = `['-y','-f','image2pipe','-framerate',fps,'-c:v','png','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',out]`.
  - `render.mjs` CLI: `node scripts/render.mjs <spec> [--out <file>] [--fps n] [--size WxH] [--contact-sheet]`. The default out is `<specdir>/out/<spec-basename>.mp4`. It validates first, uses a viewport equal to the size with deviceScaleFactor 1, waits for `__motion.ready`, and runs the per-frame seek → `page.screenshot({type:'png'})` → write to ffmpeg stdin (honouring backpressure). It prints progress every 10% and finally the output path and frame count. `--contact-sheet` writes `out/contact/<scene-id>.png` at `sceneStart + 0.85*duration`.
  - `preview.mjs` CLI: `node scripts/preview.mjs <spec> [--open]` prints the URL.
- [ ] Tests: the server serves `/spec.json` fresh after the file changes, blocks `/assets/../secret`, and has the vendor routes return 200. `encodeArgs` shape. The render smoke test renders `q3-revenue.json` at 320x180 and 10 fps when a browser and ffmpeg are both available (`t.skip` otherwise), then asserts `ffprobe` reports the expected duration ±1 frame and size 320x180. The contact sheet writes N PNGs.
- [ ] Manually verify: render all 3 examples, view the contact sheets (Read the PNGs), and fix visual bugs.
- [ ] `SKILL.md` (≤ 120 lines): workflow (write `motion.json` → validate → contact sheet self-check → preview → render), "edit only `motion.json`, change only the fields the request names", the spec shape, exact commands, one-time installs (`npm ci`, `npx playwright install chromium`, ffmpeg), degraded mode.
- [ ] Commit.

### Task 6: Eval harness + smoke run

**Files:** `plugins/portable-artifacts/eval/{run-eval.mjs, hosts.json, prompts/dashboard.json, prompts/motion.json, fixtures/(symlink-free copies of sales.csv etc.), README.md}`, `.gitignore` (`eval/results/` ignored except committed summaries in `eval/results/summary-*.md`)

- `hosts.json`: `{ "<host>": { "cmd": ["claude","-p","{prompt}","--permission-mode","acceptEdits", "--allowedTools", "Bash,Read,Write,Edit"], "check": ["claude","--version"] } }`, plus codex (`codex exec --full-auto --skip-git-repo-check {prompt}`), codex-oss (`codex exec --oss -m {model} --full-auto --skip-git-repo-check {prompt}`), gemini (`gemini -p {prompt} --yolo`) and copilot (`copilot -p {prompt} --allow-all-tools`).
- `run-eval.mjs --skill dashboard|motion --host <h> [--limit n] [--model m] [--timeout s]`: for each prompt it creates a temp dir (`os.tmpdir()`), copies the skill (symlinking `node_modules` back to the source skill to avoid a reinstall) plus fixtures, runs the host with `cwd` = temp dir and `EVAL_LOG` set, then scores (spec file exists; final `validate` ok; `validateRuns` from EVAL_LOG; build ok / `render --contact-sheet` ok; seconds). It copies artifacts to `eval/results/<stamp>/<host>/<id>/` and writes `results.json` + `summary.md`.
- [ ] Unit test the scoring function with a fake host command (`node -e` writing a known spec) so the harness is tested without an LLM.
- [ ] Smoke run: `--host claude --limit 2` for each skill, and `--host codex --limit 2` if it authenticates. Commit the summary.
- [ ] Commit.

### Task 7: Extras — external DB sources, setup, refresh docs

**Files:** dashboard `scripts/lib/spec.mjs` (schema), `scripts/lib/data.mjs`, `scripts/setup.mjs`, `references/{schema.md,refresh.md}`, `test/sources.test.mjs`

- Source types `sqlite` (`path`, `ATTACH … (TYPE sqlite, READ_ONLY)`), `postgres` and `mysql` (`env`, `ATTACH '<value of env>' AS name (TYPE postgres|mysql, READ_ONLY)`). Validate errors when the env var is unset at build (not validate) time: `sources.db.env: environment variable PG_URL is not set`.
- `setup.mjs [spec]`: `INSTALL <ext>` for every extension the spec's sources need (with no spec it installs all three) and prints where they are cached.
- Lockdown still runs after attaching. Verify that attached sqlite remains queryable after `enable_external_access=false`; if it doesn't, attach first and document it.
- [ ] Tests: a sqlite fixture created in the test via `sqlite3` CLI or DuckDB itself, built end to end (skip if the extension can't be installed offline). An ATTACH statement builder unit test for postgres and mysql (no server). Unset env error.
- [ ] `refresh.md`: crontab line plus a launchd plist example running `node scripts/build.mjs`.
- [ ] Commit.

### Task 8: Docs + inventory sweep + checklist

- [ ] Plugin `README.md`: what, install (`npm ci` per skill, Chromium, ffmpeg), the AGENTS.md / `.github/copilot-instructions.md` fallback line, using it from non-Claude hosts (copy the skill dir), licences table.
- [ ] Inventory: a scripted sweep for plugin and skill counts across `docs/skills-catalog.md`, `docs/architecture.*`, `docs/catalog.html`, `site/*` and `README.md`. Add a feature page `docs/features/portable-artifacts.html` that follows the per-line copy-button contract.
- [ ] Manual-test checklist HTML in `.scratch/feat-portable-artifacts-test-checklist.html`.
- [ ] Final whole-branch review (reviewer tier), fix CRITICAL/HIGH, push, open PR.
