# shared/

Code and assets used by more than one portable-artifacts skill: error helpers,
themes, fonts and contrast checks. Edit files **here only**, then run, from
`plugins/portable-artifacts`:

    node bin/sync-shared.mjs

That copies this folder (minus `test/` and this README) into
`skills/<skill>/shared/`. Every install path copies whole skill folders,
including `npx skills add … --skill <name>`, so each skill must carry its own
copy. CI runs `node bin/sync-shared.mjs --check` and fails on any drift.

`art.mjs` draws seeded procedural art (`artSvg({ theme, seed, width, height, mode })`) as an inline SVG in the theme's own tokens: no script, no external references, the same arguments give the same bytes.

`stale-copy.mjs` warns once on stderr when a build or render runs from an old copy under `~/.claude/plugins/cache/`: it compares the running script's folder with the `installPath` that `~/.claude/plugins/installed_plugins.json` lists for `portable-artifacts@claude-skills`, and stays silent outside that cache, when the file is missing or unreadable, or when the script sits inside the installed copy. It never throws and never changes an exit code.

Rules: no npm dependencies (skills have separate lockfiles); tests live in
`shared/test/` and run with `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (quote the glob so Node expands it, which needs Node >= 21; CI uses Node 24. The directory form fails on Node 24.7). CI runs them before any skill's `npm ci`, so a test here uses Node built-ins only and never imports the browser library at module top level.

## Entry-script contract

- `cli.mjs`: `parseCli(argv, options, usage)` rejects unknown flags with a did-you-mean. `--help` and `-h` are not errors: `parseCli` throws a help request (a `UsageError` with `help = true`) and `exitUsage` prints `usage: …` on stdout and exits 0, so a script that already calls `exitUsage` in its `UsageError` catch needs no change. A script that catches `UsageError` some other way prints the usage line to stderr with exit 2 until it switches to `exitUsage`.
- `preflight.mjs`: `preflight(skillRoot)` returns `true` when `<skillRoot>/node_modules` exists. Otherwise it prints one line naming `node <skillRoot>/scripts/doctor.mjs --fix node_modules` (JSON on stdout under `--json`), sets `process.exitCode = 2` and returns `false`. It also prints the stale-copy warning first, so that warning fires in the case it was written for. An entry script imports it statically and everything heavy after it: `if (preflight(SKILL_ROOT)) await (await import('./lib/main.mjs')).main(process.argv.slice(2));`.
- `errors.mjs`: `formatAjvErrors` turns Ajv errors into `{ path, message }` lines. Unknown keys consult a synonym table first (`source` to `from`, `summary` to `note`, `host` to `agent`); an item-level `simple` is pointed at the section's `simple.items[n]`; `required` keeps its leading word and adds the expected type or the schema's `description` (`required (string): the page heading`); `pattern` uses the schema's `description` only when the pattern is anchored (`^...$`), where the description is read as a character set (`must contain only letters, digits ...`; `required` on such a field reads `required (string containing only ...)`). An unanchored pattern such as `\S` keeps the plain Ajv message, so a meaning-style description never turns into "must contain only the page heading". `makeResult(errors, warnings)` and `printResult` carry a warnings tier: a warning prints as `path: warning: message`, never changes `ok` or the exit code, and the key is left out of the JSON while the list is empty.
- `provenance.mjs`: `generatedBy` takes `model`, `effort`, `agent`. `host` is accepted as an alias of `agent` (renamed before the closed schema sees it); `[` and `]` are allowed in ids such as `claude-opus-5-5[1m]`.
- `make-report.mjs`: the report of a `scripts/make.mjs`: `newRun()`, `runStage(state, name, fn, log)` (records `{ name, ok, seconds }`, `skipped: true` for a stage that could not run), `finding(kind, path, message, fix?)` (`kind` is `mechanical` or `creative`), `reportOf(state)` (`ok`, `output` only when the file exists, `stages`, `findings`, and `error: { message, hint }` only when set), `exitCodeOf(report)` (0, 1, 2, 130) and `logMake` (one `command: "make"` line to `$EVAL_LOG`). `make-run.mjs` is the body of `make.mjs` in make-dashboard, make-diagram, make-explainer and make-scene: it runs the skill's `doctor`, `validate`, `build` and `check` scripts as child processes with `--json` and maps what they print; `PA_MAKE_TEST_SCRIPTS` (a JSON map of stage to script path) is for tests only. make-motion's own `make.mjs` keeps its richer report and does not use either. The tests every page skill's `make.mjs` shares are in `shared/test/helpers/make-suite.mjs`.
- `output.mjs`: where a page goes. `--out` (file or folder), then `$PA_OUTPUT_DIR`, then `<git root>/.scratch/<slug>.html` when the spec file sits inside a git repo (pass `specPath` to `resolveOutput`), else `~/.agent/diagrams/<slug>.html`. `scratchIgnoreNote(target)` returns one line when `.scratch/` is not gitignored. `fileUrlLine(absPath)` is the bare `file://` URL a builder prints alone on its own line.
- `doctor.mjs`: one doctor for every skill. A stale `node_modules` (older than a pin in `package.json` `overrides`) is reported as `stale (older than the pinned … override)`, still required, still exit 1; the fix keeps the dev packages when `node_modules/playwright` exists. Sizes come from `INSTALL_SIZES` (measured production tree per skill). An unknown `--fix` id lists the accepted ids. `onDemandHint(id, ctx)` is the exact text of the on-demand install step (`kokoro`, `cutout`, `ffmpeg-static`): a script that cannot find the package prints it, so the hint and `--fix` never differ. `stableCacheDir()` is where a model cache goes so it survives a plugin update (`$CLAUDE_PLUGIN_DATA`, else the OS cache folder, else `<skill>/.cache`). Older plugin-cache copies are listed with sizes and an `rm` line for the user to run; the doctor never removes anything. Exit codes: 0 nothing required is missing, 1 a required item is missing or stale (or a `--fix` failed), 2 usage.

## shot.mjs: look at the page

    node shared/shot.mjs <file.html | folder> [--widths 390,1280] [--out <dir>] [--json]

Serves the page on loopback, shoots every width in light and dark, writes `<page>-<width>-<scheme>.png` to `<out>` (default `<git root>/.scratch/shots`), prints the paths, and exits 1 when any request is non-2xx. It checks `pgrep -fl chrome-headless-shell` first and refuses (exit 2) while another headless browser runs; `ALLOW_BROWSER_RUN=1` is the deliberate override. The browser library loads lazily from this skill's `node_modules`, else a sibling skill's. **Open every PNG and look at it before reporting**, and say where it is.

Traps, using the browser library:

- A mobile shot needs a real narrow viewport. The library's viewport honours 390 px (the Chrome command line clamps a window below about 500 px; see the last section). It is still emulation: it can hide a layout bug that depends on the real window, such as a fixed-height image. When a size is in doubt, measure it (`getBoundingClientRect`, `getComputedStyle`) instead of trusting the picture.
- `colorScheme` on the context replaces the operating system's preference, so light and dark shots do not depend on the machine. Shoot both.
- Use `deviceScaleFactor: 1` for long pages. Chromium wraps a full-page capture taller than about 16384 device pixels; `shot.mjs` cuts at 16000 px and warns.
- A cache-busting `?v=` on the page does not bust a separately cached stylesheet. Every shot here uses a fresh context and the server sends `no-store`; do the same when you drive a browser by hand.
- A percentage `max-width` on an SVG that has only a `viewBox` can collapse to 0 by 0. Only computed sizes show it.
- A page that reveals blocks with an `IntersectionObserver` renders them faded in a full-page shot. Scroll first, or shoot the sections.

Outside the browser library:

- The Chrome command line clamps `--window-size` below about 500 px wide, so a "390 px" shot is a 500 px layout; branded Chrome refuses `--load-extension`; an autoplaying video keeps a headless Chrome from exiting.
- `chrome-devtools` needs a Chrome started with a debug port (otherwise `Could not find DevToolsActivePort`); `claude-in-chrome` cannot open `chrome://` pages.
- A README on a hosting site shows an SVG as an image, so its animation is frozen there.

## Adding a sibling skill

A new `skills/<name>/` touches more than its own folder. Nothing generates this list, so walk it:

1. `skills/<name>/SKILL.md` with the frontmatter rules, `package.json` (with the same `overrides` pins as the others: `doctor.mjs` reads them) and `package-lock.json`, `scripts/doctor.mjs` and `scripts/lib/requirements.mjs`.
2. `node bin/sync-shared.mjs` so the new skill gets its `shared/` copy (the tests below fail until it exists).
3. Folder-driven tests need no edit: `bin/test/frontmatter.test.mjs`, `portability.test.mjs` and `delegation.test.mjs` read `skills/` and will hold the new skill to the same rules (the Director and operator section, no host-only tool names, valid frontmatter).
4. Hard-coded lists to extend: `shared/icons.mjs` (`SKILLS` and its icon), `skills/make-explainer/scripts/lib/requirements.mjs` (`SECTION_SISTERS`, only if explainer embeds the new skill), `eval/lib.mjs` and `eval/test/lib.test.mjs`, the template paths in `bin/test/style-lint.test.mjs`, `tests/pytest/test_portable_artifacts_page.py`.
5. CI in `.github/workflows/test.yml`: the skill's entry in the test matrix (and shard count) and the `npm ci` loop.
6. Docs and manifests: the plugin's `.claude-plugin/plugin.json`, `README.md`, `USAGE.md` and `CHANGELOG.md`, the root `README.md` and `USAGE.md`, the pages under `docs/`, and the counts that `python3 scripts/sweep_counts.py --write` rewrites.
7. Bump the plugin version: CI fails a change under `plugins/portable-artifacts/` that leaves `plugin.json` at the same version.
