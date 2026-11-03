# Explainer KPI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one-line KPI values in a make-explainer section render at one size (within one visual row where a wide tile makes the section wrap), `check.mjs` also measures a wide window and is proven to catch the 0.8.0 wrap there, and a portable-artifacts build run from a stale plugin-cache copy says so on stderr.

**Architecture:** The renderer moves the character count the CSS sizes by (`--n`) from each tile to the `.kpis` container, where custom-property inheritance hands one count to every one-line value; `kpi-wide` and `kpi-long` values keep their own. `check.mjs` gains a third viewport, and a hand-trimmed page built by 0.8.0 becomes the fixture that fails only there. A new `shared/stale-copy.mjs` compares the running script's path with the `installPath` in `installed_plugins.json` and the five build entry points print its one line.

**Tech Stack:** Node >= 20 ES modules, `node --test`, Playwright (browser tests and `check.mjs`), plain CSS with container queries.

**Spec:** `docs/superpowers/specs/2026-10-30-explainer-kpi-polish-design.md`

All paths below are relative to `plugins/portable-artifacts/` unless they start with `docs/`. Run commands from the folder named in each step. Every `node --test` run of make-explainer's browser tests needs that skill's `npm ci` and Chromium (`npx playwright install chromium`); without them those tests skip, which is not a pass. A RED or GREEN run of a browser test counts only if the run summary reads `skipped 0` and the named test is listed as passing or failing, not as `# SKIP`.

## Global Constraints

- Tests first: a failing test for row sizing, the RED run of the wide check on the 0.8.0 page, and a warning test with a fake `installed_plugins.json`, each before its implementation.
- `shared/` is edited once and copied with `node bin/sync-shared.mjs` (run from `plugins/portable-artifacts`); CI fails on drift (`--check`). `shared/` takes no npm dependency.
- Do not change the 1.0.0 one-line rule, `KPI_WIDE_CHARS` (10), `KPI_LONG_CHARS` (16), or `kpi-long` wrapping. make-dashboard tiles are out of scope.
- The warning compares paths only and parses no versions. It fires only when the running script sits under `<home>/.claude/plugins/cache/` and outside every recorded `installPath`. It is silent when `installed_plugins.json` is missing, unreadable or malformed, and it never changes an exit code. It informs; it never switches copies or installs anything.
- `SKILL.md` stays host-neutral: `bin/test/portability.test.mjs` rejects `~/.claude`, `$HOME/.claude`, `&&`, `$(`, `2>&1` and `~/` in it. Concrete paths go in README and USAGE only.
- Any user-visible behavior change updates `skills/make-explainer/SKILL.md`, the READMEs, `USAGE.md`, `CHANGELOG.md` and `docs/features/portable-artifacts.html`. A command shown on the site page uses one `.code.cmds` copy button per line with comments stripped from `data-copy`.
- Golden baselines (`skills/make-explainer/test/golden/*.body.html`) change only with `UPDATE_GOLDEN=1` after reading the diff, and the commit says why.
- Commits: conventional type, one logical change, tree green, ending with exactly one trailer line, `Co-Authored-By: Claude <noreply@anthropic.com>` (AGENTS.md "Commit / PR trailers"; no `Claude-Session` line, no model name). The orchestrating session runs every commit; implementer subagents never commit or push.
- Dispatch: implementers are executor tier (Sonnet, effort high). Phase and gate reviewers are reviewer tier (Opus, effort medium), report-only, and their prompt carries the report-everything sentence from `~/.claude/rules/ecc/common/code-review.md` verbatim.
- The repo is public: no other project's name in code, fixtures, docs or commit messages; say "another repo" or "the owner-supplied old page". The guarded names live in `tests/bats/no_private_names.bats`; run `bats tests/bats/no_private_names.bats` after Task 2 Step 1.

## Review Focus

1. A `kpis` section mixing a wide value (11 to 16 characters) or a long one (over 16) with short ones: the short values share the size of the longest short value; `kpi-wide` and `kpi-long` values keep their own size (a long one wraps inside its tile). A section without a wide tile is an equal-track grid, so one size holds across all of it. With a wide tile the section wraps as flex rows whose tiles grow unevenly (and `cqi` is each tile's own width), so equality holds for the short tiles within one visual row, not across rows. Pinned by Task 1 Step 1 (unit), Step 2 (grid, in the browser) and Step 6 (`nowrap-kpi-mix`, measured first).
2. KPIs on a deck slide at 1800 px, where `deck-flavors.css` floors at `--fs-sm`: one size per slide group, no spill. Pinned by Task 1 Step 2 (slides build at 1800).
3. `installed_plugins.json` present but without the plugin key, with an empty array, or not JSON: silent. Pinned by Task 3 Step 1.
4. An `installPath` written with a trailing separator, or a second entry in the array that does match: silent. Pinned by Task 3 Step 1.
5. The new viewport must not fail today's own pages: the four reference examples that `check-cli.test.mjs` loops over (concept, checklist, slides, recap) and the deck still pass at 1800 px, including the arrow-key run to the last slide. The fifth example, `plan`, is not in that loop and stays unchecked here. Pinned by Task 2 Step 5 (`check-cli.test.mjs` with `viewports === 3`).

---

### Task 1: One size per KPI group

**Files:**
- Modify: `skills/make-explainer/scripts/lib/render/kpis.mjs:9-11,35-44`
- Modify: `skills/make-explainer/template/base.css:122-129` (comment only; the formula at line 138 already reads `var(--n, 8)`, which now inherits from `.kpis`)
- Modify: `skills/make-explainer/test/nowrap.test.mjs:66-71` (the `--n` assertions)
- Create: `skills/make-explainer/test/fixtures/kpi-rows.explainer.json`
- Create: `skills/make-explainer/test/kpi-rows-browser.test.mjs`
- Modify: `skills/make-explainer/test/golden/{recap,concept,plan,core}.body.html` (regenerated)
- Modify: `skills/make-explainer/references/sections.md:17`, `README.md:97`

**Interfaces:**
- Consumes: `render(section)` in `kpis.mjs`; `buildFile`, `buildSpec`, `openPage`, `closeSharedBrowser`, `haveBrowser` from `skills/make-explainer/test/helpers/browser.mjs`; `overflowProblems(page, selector)` from `shared/nowrap-probe.mjs`.
- Produces: `<dl class="kpis" style="--n: N">` where `N` is the largest code-point count over the section's items that are neither `kpi-wide` nor `kpi-long`; omitted when no such item exists. A one-line value carries no inline `--n`; a `kpi-wide` or `kpi-long` value keeps `style="--n: <its count>"`. Decision (the spec leaves it to the builder): a wide tile keeps its own size, so group equality is asserted for the non-wide tiles only. Task 2's fixture and later docs rely on this markup.

- [ ] **Step 1: Write the failing unit tests**

In `skills/make-explainer/test/nowrap.test.mjs`, replace the test `'a KPI value is printed as written, with its length for the CSS to size it by'` with:

```js
test('a KPI section carries the length of its longest one-line value; short values carry none, wide and long values keep their own', () => {
  const html = renderKpis({ items: [{ label: 'S', value: '87%' }, { label: 'M', value: '1,204 ms' }, { label: 'N', value: 123456789 }, { label: 'L', value: 'On track for Q4 launch' }] });
  assert.match(html, /^<dl class="kpis" style="--n: 8">/);
  assert.match(html, /<dd class="kpi-value">87%<\/dd>/);
  assert.match(html, /<dd class="kpi-value">1,204 ms<\/dd>/);
  assert.match(html, /<dd class="kpi-value" style="--n: 11">123,456,789<\/dd>/);
  assert.match(html, /<dd class="kpi-value" style="--n: 22">On track for Q4 launch<\/dd>/);
});

test('a section whose every value is wide or long carries no length of its own', () => {
  assert.match(renderKpis({ items: [{ label: 'N', value: 123456789 }, { label: 'L', value: 'On track for Q4 launch' }] }), /^<dl class="kpis">\n/);
});
```

- [ ] **Step 2: Write the failing browser test (the equal-track grid case)**

Create `skills/make-explainer/test/fixtures/kpi-rows.explainer.json`: `title` "KPI rows", `preset` "recap", `mode` "page", `theme` "dusk", one `kpis` section titled "Measured" with items `{ "label": "Files indexed", "value": "3,576", "note": "in 16.3 s" }`, `{ "label": "Repos refreshed", "value": 20 }`, `{ "label": "Largest write", "value": "39 ms", "note": "limit 500 ms" }`, `{ "label": "Tests passing", "value": "10 / 10" }`.

Create `skills/make-explainer/test/kpi-rows-browser.test.mjs` (imports: `buildFile`, `buildSpec`, `openPage`, `closeSharedBrowser`, `haveBrowser` from `./helpers/browser.mjs`; `overflowProblems` from `../shared/nowrap-probe.mjs`; `fs`; the `fixture` and `skipUnlessBrowser` helpers as written in `nowrap-browser.test.mjs`; `after(closeSharedBrowser)`). `mode: 'slides'` is how `isSlides()` in `scripts/lib/slides.mjs:65` picks the deck. The fixture has no `kpi-wide` value (the longest is "10 / 10", 7 characters), so every group is an equal-track grid and one size must hold across the whole group.

```js
// Per .kpis group: { hasWide, rows }; rows lists, per visual row (rounded top of the tile), the distinct computed
// font sizes of the group's one-line values. kpi-wide and kpi-long values size themselves and are left out.
const sizesPerGroup = (page) => /* page.evaluate(...) returning [{ hasWide: boolean, rows: string[][] }] */;
// Every row holds one size; a group without a wide tile is an equal-track grid, so its rows also agree with each other.
function assertEvenRows(groups, label) { /* every row has length 1; if (!hasWide) new Set(rows.flat()).size === 1 */ }

const WIDTHS = [390, 1280, 1800];
const spec = JSON.parse(fs.readFileSync(fixture('kpi-rows.explainer.json'), 'utf8'));

// The theme is always named: buildFile passes --theme only when it is set and the fixture's own theme is dusk, so an unnamed iteration would test dusk twice.
// paper stands for every classic theme (ink, blueprint, editorial, mono, brief share base.css with it); the three flavors have their own kpi rules.
for (const theme of ['paper', 'dusk', 'press', 'poster']) {
  test(`page and deck: every one-line value in a KPI group has one font size at 390, 1280 and 1800 (${theme})`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const builds = [buildFile(fixture('kpi-rows.explainer.json'), { theme }), buildSpec({ ...spec, mode: 'slides', theme }, { name: 'deck' })];
    for (const { url } of builds) {
      const { page, problems, context } = await openPage(url);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 1000 });
        assertEvenRows(await sizesPerGroup(page), `${url} at ${width}px (${theme})`);
        assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `${url} at ${width}px`);
      }
      assert.deepEqual(problems, []);
      await context.close();
    }
  });
}
```

- [ ] **Step 3: Run both files to verify they fail**

Run (from `skills/make-explainer`): `node --test test/nowrap.test.mjs test/kpi-rows-browser.test.mjs`
Expected: the two unit tests FAIL on the `<dl class="kpis"` match; the dusk/press/poster browser tests FAIL with two sizes at 1800 px ("20" at the cap, "10 / 10" smaller). The paper test may already pass (its cap is `--fs-xl`, below the fitted size); it stays as regression cover. Other tests in the two files pass. Confirm per the `skipped 0` rule above that the browser tests ran.

- [ ] **Step 4: Implement the group count in `render(section)` in `kpis.mjs`**

Compute `chars` and `wide` for every item first, then `const groupN = Math.max(0, ...items.filter((i) => !i.wide).map((i) => i.chars))` (`wide` is true for both `kpi-wide` and `kpi-long`). Emit `style="--n: ${chars}"` on a value only when it is wide; emit ` style="--n: ${groupN}"` on the `<dl>` only when `groupN > 0`. Rewrite the comment at lines 9-11 to say the count sits on the section (one size for the one-line values: the size that fits the longest) and a wide or long value keeps its own. Update the `base.css:122-124` comment the same way, and note there that `cqi` is each tile's own width, so sizes agree across a whole section only while its tracks are equal (no `kpi-wide`). No CSS rule changes.

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `skills/make-explainer`): `node --test test/nowrap.test.mjs test/kpi-rows-browser.test.mjs test/nowrap-browser.test.mjs`
Expected: PASS, all four dusk/press/poster/paper cases listed as passing (the "probes fire" test in `nowrap-browser` still fires because its `.kpi-value { --n: 1 !important }` rule beats the inherited value).

- [ ] **Step 6: Measure the mixed-width fixture, then pin it**

A section with a `kpi-wide` value is not an equal-track grid: `base.css:131-133` switches it to flex-wrap, tiles grow to fill their row, and `cqi` is each tile's own width. One `--n` therefore does not give one size across such a section; short tiles in one visual row have equal widths (same `flex` basis, same growth) and so share a size, while tiles in different rows may not. Measure before asserting.

Write a throwaway script with the Write tool at `.scratch/measure-kpi-mix.mjs` (gitignored; never committed) that imports `buildFile`, `openPage`, `closeSharedBrowser` from `skills/make-explainer/test/helpers/browser.mjs`, builds `test/fixtures/nowrap-kpi-mix.explainer.json` in `dusk`, and at 390, 1280 and 1800 px prints, for every value in every `.kpis` group: group index, `kpi-wide`/`kpi-long` flags, tile top, tile width, computed font size. Read the numbers, then add to `kpi-rows-browser.test.mjs` (reusing `sizesPerGroup` and `assertEvenRows`):

```js
test('a mixed group (wide and long values among short ones): short values in one visual row share a size, nothing spills, at 390, 1280 and 1800', async (t) => { /* nowrap-kpi-mix in dusk; assertEvenRows; overflowProblems on '.kpi-value' and '.kpi' */ });
```

Write the measured per-row sizes and the cross-row spread (if any) into a comment above the test, so the expected values come from the browser, not from the formula. If short tiles in one visual row disagree, do not change the CSS formula: stop and report the measurement. Decision recorded: `kpi-wide` tiles keep their own size and are not asserted equal to their neighbours.

- [ ] **Step 7: Regenerate the goldens and run the whole suite**

Run (from `skills/make-explainer`): `UPDATE_GOLDEN=1 node --test test/golden.test.mjs` and `UPDATE_GOLDEN=1 node --test test/build.test.mjs` (the latter owns `test/golden/core.body.html`, which `golden.test.mjs` does not regenerate), then `git diff --stat test/golden` and read one diff: the only change is `--n` moving from the one-line `.kpi-value`s to `<dl class="kpis">` (wide and long values keep theirs). Then `npm test`.
Expected: all pass, with `skipped 0` in the summary; nothing but the `--n` placement moved in the goldens.

- [ ] **Step 8: Docs for the behavior**

`references/sections.md:17`: append to the `kpis` description: "The one-line values in a section are drawn at one size, the one that fits the longest; a value of 11 to 16 characters gets a wide tile and keeps its own size, and one over 16 characters wraps and keeps its own size. In a section with a wide tile the tiles wrap in rows, and the one-line values in a row share a size." `README.md:97` (plugin README, "Numbers stay on one line"): in the make-explainer sentence, after "or a KPI value that overflows its tile", add a new sentence: "The one-line values in one `kpis` section are drawn at one size, the one that fits the longest; a wide or long value keeps its own." (The "sized to fit the tile" phrase later in that paragraph is make-dashboard's; leave it.) `SKILL.md` (line 88) and `USAGE.md` (line 333) name `kpis` and its fields only and say nothing about KPI sizing, not even the 1.0.0 one-line rule, so they need no new line; the spec's docs rule is met by `sections.md`, the plugin README, and Task 4's CHANGELOG and feature page.

- [ ] **Step 9: Commit (run by the orchestrating session)**

```bash
git add plugins/portable-artifacts/skills/make-explainer plugins/portable-artifacts/README.md
git commit -m "feat(make-explainer): size the one-line KPI values in a section alike

<one line: wide tiles keep their own size, and why; goldens moved --n from the values to the section>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: A wide viewport in `check.mjs`, proven on a 0.8.0 page

**Files:**
- Create: `skills/make-explainer/test/fixtures/legacy-kpi-wide-wrap.html`
- Modify: `skills/make-explainer/test/fixtures/README.md`
- Modify: `skills/make-explainer/scripts/check.mjs:3,21`
- Modify: `skills/make-explainer/test/check-cli.test.mjs:61-80`, `skills/make-explainer/test/nowrap-browser.test.mjs:218-227`
- Modify: `skills/make-explainer/README.md:91`, `skills/make-explainer/SKILL.md:49`, `USAGE.md:320`

**Interfaces:**
- Consumes: `checkPage(file)` → `{ status, viewports, problems }` and the CLI from `scripts/check.mjs`; `nowrapProblems` labels problems `"<width>px: a number-plus-unit token wraps across lines: \"<token>\""`.
- Produces: `VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 780 }, { width: 1800, height: 1000 }]`; `checkPage(...).viewports === 3`; the ok line reads `check: ok (3 viewports…)`. The deck probe runs per viewport, so a deck is checked at 1800 px by construction.

- [ ] **Step 1: Trim the fixture from the 0.8.0 page**

Source: the owner-supplied old page (path from the dispatch prompt; built by portable-artifacts 0.8.0, theme dusk). The line numbers below refer to that page; if the dispatch names a different page, find the same rules by selector instead. Create `test/fixtures/legacy-kpi-wide-wrap.html` as `<!doctype html><html lang="en" data-flavor="dusk">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>Legacy KPI wrap</title>`, one `<style>` holding, copied verbatim from the source by line: 26 (the Funnel Display 700 `@font-face`, so metrics are the ones the owner saw on every CI OS), 30 and 33 (`:root` tokens; the dark-mode lines 31–32 are not needed), 46–47 (`html`, `body`), 66 (`:root` layout knobs), 105–106 (`.layout`, `.sections`), 128–131 (`.sec`, `.sec-alt`), 134 (`.sec-title`), 159–167 (the kpi rules; line 165 is the `.kpi-value` with no `--kpi-fit`, the bug), 406–407 (flavor knobs), 526–541 (the flavored kpi rules). Body: `<div class="layout"><div class="sections">` around lines 749–758 of the source with the eyebrow "Live figures", the title "Measured", the ids `measured`/`measured-title`, and the labels "Files indexed", "Repos refreshed", "Largest write", "Tests passing"; the four values and notes stay verbatim (`3,576` / `in 16.3 s`, `20` / `from GitHub in 10.3 s` becomes `in 10.3 s`, `39 ms` / `limit 500 ms`, `10 / 10` / `phases 1 and 2`). Last: `<script>window.paReady = true;</script>` (the check waits for it). Drop any comment, path or text in the copied lines that names a project; the fixture carries no project name, no other media, under 40 KB. Then run `bats tests/bats/no_private_names.bats` (from the repo root); it covers the fixture, which sits outside `docs/superpowers`. In `test/fixtures/README.md` add: "`legacy-kpi-wide-wrap.html` is one KPI section and the CSS it needs, trimmed by hand from a dusk page built by portable-artifacts 0.8.0 on 2026-10-26; its values wrap only in a window wider than 1280 px, which the check must catch."

- [ ] **Step 2: Write the failing guardrail test**

In `skills/make-explainer/test/check-cli.test.mjs` add `const fixture = (name) => path.join(ROOT, 'test/fixtures', name);` and:

```js
test('guardrail proof: a 0.8.0 page whose KPI values wrap only in a wide window fails at 1800 px and nowhere else', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(fixture('legacy-kpi-wide-wrap.html'));
  assert.equal(result.status, 'failed', result.problems.join('\n'));
  assert.ok(result.problems.includes('1800px: a number-plus-unit token wraps across lines: "39 ms"'), result.problems.join('\n'));
  assert.deepEqual(result.problems.filter((p) => !p.startsWith('1800px:')), [], 'the two older viewports stay clean');
  const r = cli([fixture('legacy-kpi-wide-wrap.html')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1800px: a number-plus-unit token wraps across lines: "39 ms"\ncheck: 1 problem\n$/);
});
```

- [ ] **Step 3: Run it to verify it fails (the RED run on the old page)**

Run (from `skills/make-explainer`): `node --test test/check-cli.test.mjs`
Expected: the new test FAILS with `status` equal to `'ok'` (today's check passes the old page); the run summary shows `skipped 0`, otherwise the RED proves nothing. If instead a `1280px:` or `390px:` problem appears, the trim is unfaithful (a missing rule or font); fix the fixture, never the assertion. Measured on the untrimmed page while writing this plan (shared probes, Chromium): both probes empty at 390 and 1280, exactly one wrap at 1800, `"39 ms"`. ("10 / 10" is on two lines from 1280 up, but it has no unit, so no probe sees it; that is outside this plan.)

- [ ] **Step 4: Add the viewport**

`scripts/check.mjs:21`: `const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 780 }, { width: 1800, height: 1000 }];`. Line 3 comment: "at 1280, 390 and 1800 px".

- [ ] **Step 5: Update the tests that count viewports, then run them**

`check-cli.test.mjs`: line 61 name "at 1280, 390 and 1800", line 67 `viewports, 3`, line 76 regex `3 viewports`, line 79 `j.viewports, 3`. `nowrap-browser.test.mjs`: lines 218 and 227 loop over `['1280px', '390px', '1800px']` and say "at every viewport".
Run (from `skills/make-explainer`): `node --test test/check-cli.test.mjs test/nowrap-browser.test.mjs`
Expected: PASS with `skipped 0`, including the guardrail test listed as passing (exactly one problem, labelled 1800px, naming "39 ms").

- [ ] **Step 6: Docs**

`skills/make-explainer/README.md:91`: "at 1280, 390 and 1800 px". `USAGE.md:320`: "opens the page at 1280, 390 and 1800 px". `skills/make-explainer/SKILL.md:49`: "opens the page at phone, desktop and wide-window width". Leave make-diagram's and make-scene's 1440/390 lines alone.

- [ ] **Step 7: Full suite, then commit**

Run (from `skills/make-explainer`): `npm test`. Expected: PASS with `skipped 0`. The orchestrating session then commits:

```bash
git add plugins/portable-artifacts/skills/make-explainer plugins/portable-artifacts/USAGE.md
git commit -m "test(make-explainer): check pages at 1800 px too, proven on a 0.8.0 page

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Stale plugin-copy warning

**Files:**
- Create: `shared/stale-copy.mjs`
- Create: `shared/test/stale-copy.test.mjs`
- Create: `skills/make-explainer/test/stale-copy-cli.test.mjs`
- Modify: `skills/make-explainer/scripts/build.mjs:123` (inside the `if (process.argv[1] …)` block, first line), `skills/make-diagram/scripts/build.mjs:52`, `skills/make-scene/scripts/build.mjs:127` (same), `skills/make-dashboard/scripts/build.mjs:27` (first line of the top-level `try`), `skills/make-motion/scripts/render.mjs:241` (first line of `main()`)
- Modify: `shared/README.md`, `README.md` (the `### Requirements` section at line 197), `USAGE.md` (after the doctor paragraph that ends at line 86), `skills/make-explainer/SKILL.md:34`
- Generated: `skills/*/shared/stale-copy.mjs` via `node bin/sync-shared.mjs`

**Interfaces:**
- Produces, in `shared/stale-copy.mjs`:
  - `export const PLUGIN_KEY = 'portable-artifacts@claude-skills';`
  - `export function staleCopyWarning({ scriptPath, home = os.homedir(), readFile = fs.readFileSync }): string | null` — `scriptPath` is `path.resolve`d, never realpath'd (the stale case has no symlink, and the end-to-end test below relies on a symlinked cache). `cacheRoot = path.join(home, '.claude', 'plugins', 'cache')`; `within(child, parent)` is `child === parent || child.startsWith(parent + path.sep)` on resolved paths. Returns `null` unless the script is within `cacheRoot` and within none of the `installPath`s under `plugins[PLUGIN_KEY]` (an array) in `path.join(home, '.claude', 'plugins', 'installed_plugins.json')`; any read or parse failure, missing key, empty array or entry without a string `installPath` returns `null`. The running copy is `cacheRoot` plus the next three path segments; the skill is the segment after `skills` (else `make-explainer`). The line, with `I` the first `installPath` and `S` the skill: `warning: this script runs from <running copy>, not the installed copy <I>; run npm ci in <I>/skills/<S> (or node <I>/skills/<S>/scripts/doctor.mjs --fix node_modules), then use that copy` (joined with `path.join`).
  - `export function warnIfStaleCopy(argv1 = process.argv[1], { stderr = process.stderr } = {}): void` — writes the line plus `\n` to `stderr` when `staleCopyWarning` returns one; wraps everything in `try {} catch {}` so it can never throw or change an exit code; does nothing when `argv1` is falsy.
- Consumed by the five build entry points as `import { warnIfStaleCopy } from '../shared/stale-copy.mjs';` and `warnIfStaleCopy();` as the first statement of their CLI path.

- [ ] **Step 1: Write the failing unit tests**

Create `shared/test/stale-copy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staleCopyWarning, PLUGIN_KEY } from '../stale-copy.mjs';

const home = path.resolve('/h');
const cache = path.join(home, '.claude', 'plugins', 'cache', 'claude-skills', 'portable-artifacts');
const script = (root) => path.join(root, 'skills', 'make-explainer', 'scripts', 'build.mjs');
const installed = (...paths) => JSON.stringify({ version: 2, plugins: { [PLUGIN_KEY]: paths.map((installPath) => ({ installPath })) } });
const warn = (scriptPath, body) => staleCopyWarning({ scriptPath, home, readFile: () => { if (body instanceof Error) throw body; return body; } });

test('a script under the plugin cache but outside the installed copy draws one line naming both and the fix', () => {
  const line = warn(script(path.join(cache, '0.8.0')), installed(path.join(cache, '1.0.0')));
  assert.equal(line, `warning: this script runs from ${path.join(cache, '0.8.0')}, not the installed copy ${path.join(cache, '1.0.0')}; run npm ci in ${path.join(cache, '1.0.0', 'skills', 'make-explainer')} (or node ${path.join(cache, '1.0.0', 'skills', 'make-explainer', 'scripts', 'doctor.mjs')} --fix node_modules), then use that copy`);
  assert.equal(line.includes('\n'), false);
});

test('silent from the installed copy, also with a trailing separator or as the second entry', () => {
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '1.0.0'))), null);
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '1.0.0') + path.sep)), null);
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '0.8.0'), path.join(cache, '1.0.0'))), null);
});

test('silent outside the plugin cache, whatever the file says', () => {
  assert.equal(warn(script(path.resolve('/repo/plugins/portable-artifacts')), installed(path.join(cache, '1.0.0'))), null);
  assert.equal(warn(script(path.join(home, '.claude', 'plugins', 'marketplaces', 'x')), installed(path.join(cache, '1.0.0'))), null);
});

test('silent when the file is missing, unreadable, not JSON, or has no usable entry', () => {
  const stale = script(path.join(cache, '0.8.0'));
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  for (const body of [enoent, new Error('EACCES'), 'not json', '{}', '{"plugins":{}}', JSON.stringify({ plugins: { [PLUGIN_KEY]: [] } }), JSON.stringify({ plugins: { [PLUGIN_KEY]: [{ version: '1.0.0' }] } }), JSON.stringify({ plugins: { [PLUGIN_KEY]: 'x' } })]) {
    assert.equal(warn(stale, body), null, String(body));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `plugins/portable-artifacts`): `node --test "shared/test/stale-copy.test.mjs"`
Expected: FAIL, `Cannot find module '../stale-copy.mjs'`.

- [ ] **Step 3: Implement `shared/stale-copy.mjs`**

Per the Interfaces block. Built-ins only (`node:fs`, `node:os`, `node:path`). A header comment names the incident shape it catches: a session running `~/.claude/plugins/cache/<marketplace>/portable-artifacts/<old>/…` while `installed_plugins.json` points at a newer folder.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run (from `plugins/portable-artifacts`): `node --test "shared/test/stale-copy.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Write the failing end-to-end test**

Create `skills/make-explainer/test/stale-copy-cli.test.mjs`. It makes a temp home, symlinks the real plugin folder (`path.resolve(ROOT, '../..')`) to `<home>/.claude/plugins/cache/claude-skills/portable-artifacts/0.8.0`, writes `installed_plugins.json` with `installPath` `<cache>/1.0.0`, and spawns `node <cache>/0.8.0/skills/make-explainer/scripts/build.mjs <exampleFile('concept')> --out <tmp>/page.html` with `env: { ...process.env, HOME: home, USERPROFILE: home, EVAL_LOG: '' }`:

```js
test('a build run from a stale cache copy warns on stderr, exits 0 and writes the page', ...)
  // assert r.status === 0; fs.existsSync(out); r.stdout includes 'wrote ';
  // r.stderr.trim() === `warning: this script runs from ${path.join(cache, '0.8.0')}, not the installed copy ${path.join(cache, '1.0.0')}; run npm ci in ${path.join(cache, '1.0.0', 'skills', 'make-explainer')} (or node ${path.join(cache, '1.0.0', 'skills', 'make-explainer', 'scripts', 'doctor.mjs')} --fix node_modules), then use that copy`
test('the same build from the installed copy is silent', ...)
  // installed_plugins.json installPath = path.join(cache, '0.8.0'); assert r.status === 0 and r.stderr === ''
test('a build run from the repo checkout is silent even when installed_plugins.json names another folder', ...)
  // spawn node <ROOT>/scripts/build.mjs with the same temp HOME and installPath = path.join(cache, '1.0.0'); assert r.status === 0 and r.stderr === ''
```

Skip the two cache tests with `t.skip` when `fs.symlinkSync` throws `EPERM` (Windows without the privilege). Clean the temp home in `after`.

- [ ] **Step 6: Run it to verify it fails**

Run (from `skills/make-explainer`): `node --test test/stale-copy-cli.test.mjs`
Expected: the first test FAILS (`stderr` is empty); the second and third pass.

- [ ] **Step 7: Wire the five entry points and sync**

Add the import and `warnIfStaleCopy();` at the five sites listed under Files (build and render only; validate and check stay quiet, since a stale page comes from a build and that is the line a session reads). Then, from `plugins/portable-artifacts`: `node bin/sync-shared.mjs` and `node bin/sync-shared.mjs --check`. Expected: `shared/ copies are in sync`.

- [ ] **Step 8: Run the tests to verify they pass**

Run (from `skills/make-explainer`): `node --test test/stale-copy-cli.test.mjs test/build.test.mjs test/golden.test.mjs`
Run (from `plugins/portable-artifacts`): `node --test "shared/test/*.test.mjs"` and, from `bin`, `node --test "test/*.test.mjs"`
Expected: PASS. The third `stale-copy-cli` test is what proves a repo run prints nothing on stderr; `build.test.mjs` and `golden.test.mjs` only print stderr in failure messages and prove nothing about it.

- [ ] **Step 9: Docs**

`shared/README.md`: one line listing `stale-copy.mjs` (what it compares, when it is silent). `README.md` Requirements section: a paragraph "Stale plugin copies" that shows the warning's shape, names `~/.claude/plugins/installed_plugins.json` and `~/.claude/plugins/cache/`, and says the fix is `npm ci` in the installed skill folder or its `doctor.mjs --fix node_modules`. `USAGE.md`, a new paragraph after the doctor paragraph that ends at line 86: the same in two sentences. `skills/make-explainer/SKILL.md:34`: append one host-neutral sentence: "If a build prints `warning: this script runs from …, not the installed copy …`, stop and run the command it names in the installed folder, then use that folder's scripts." Run (from `bin`): `node --test "test/portability.test.mjs"`. Expected: PASS.

- [ ] **Step 10: Commit (run by the orchestrating session)**

```bash
git add plugins/portable-artifacts
git commit -m "feat(portable-artifacts): warn when a build runs from a stale plugin cache copy

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Release notes

**Files:**
- Modify: `CHANGELOG.md:7` (insert above `## [1.0.0]`)
- Modify: `docs/features/portable-artifacts.html:73-80` (the `#whats-new` `.inv` list)

**Interfaces:**
- Consumes: the behavior as shipped by Tasks 1–3 (wide tiles keep their own size, per Task 1 Step 6; build-only warning scope from Task 3).
- Produces: a `## [Unreleased]` CHANGELOG section. Version model (orchestrator decision, shared with the sibling plans): this plan writes `[Unreleased]` and does not bump `plugin.json`. The make-motion plan (`2026-10-30-make-motion-hyperframes-parity.md`) Gate 1 commit renames that section into its first version heading together with its `plugin.json` bump; later make-motion gates bump per gate. The harness plan (`2026-10-30-harness-learnings.md`) never touches the plugin CHANGELOG. The feature-page entry sits under its own "Next release" heading, not under "What's new in 1.0.0".

- [ ] **Step 1: CHANGELOG**

Insert `## [Unreleased]` with a `### Added and changed` list of three bullets in the file's voice: even KPI rows (one size for the one-line values in a `kpis` section; a wide or long value keeps its own; in a section with a wide tile the tiles wrap and the values in one row share a size; make-dashboard unchanged), the 1800 px viewport in make-explainer's `check.mjs` with the sentence that it fails a page built by 0.8.0 at that width and passed it before, and the stale-copy warning (when it fires, that it is silent on other hosts and in repo checkouts, that it never fails a build).

- [ ] **Step 2: Feature page row**

In `#whats-new`, insert, immediately above `<h2>What's new in 1.0.0</h2>`, a separate block: an `<h2>Next release</h2>` (same level and class as that heading) followed by one `.inv` list holding a single `.row` (`<span class="nm">KPI polish</span>` and a `.dc` of one or two sentences covering the three items); no command, so no copy button. The 1.0.0 list stays untouched, so unreleased items never read as part of 1.0.0. Open the page in Chrome (file URL) and confirm the new heading and row render apart from the 1.0.0 list.

- [ ] **Step 3: Verify and commit**

Run (from the repo root): `python3 scripts/sweep_counts.py --check`. Expected: no stale counts (no count changed).

```bash
git add plugins/portable-artifacts/CHANGELOG.md docs/features/portable-artifacts.html
git commit -m "docs(portable-artifacts): changelog and feature page for the KPI polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

The orchestrating session runs this commit.

---

## Decisions this plan made where the spec left them open

- **Row sizing.** `--n` moves to the `.kpis` container and inherits; no CSS rule changes. `kpi-wide` and `kpi-long` tiles keep their own `--n` and their own size (the spec left this to the builder). Equality is asserted for the non-wide tiles: across the whole section when it is an equal-track grid, and within one visual row when a wide tile makes it wrap, because `cqi` is each tile's own width. Task 1 Step 6 measures the mix fixture before any expected value is written.
- **Wide check.** `{ width: 1800, height: 1000 }` as a third viewport, appended so labels of the first two stay as the tests know them. The deck gets it by construction. make-diagram and make-scene keep 1440/390.
- **Warning scope.** Build and render entry points only, in all five skills, through `shared/`. Validate and check stay silent.
- **Path comparison.** `path.resolve` on both sides, no realpath, trailing-separator-safe.
