# Artifact polish, provenance, doctor and portability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page the four portable-artifacts skills produce carries a favicon, an icon theme toggle, a model/effort stamp and the Geist type system; make-explainer pages lead with a hero and warn on long text; each skill can diagnose and (with consent) install what it is missing; and the skills are proven portable to other agents.

**Architecture:** Hybrid sharing. New dependency-free modules in `plugins/portable-artifacts/shared/` (`icons.mjs`, `provenance.mjs`, `theme-toggle.mjs`, `type.mjs`, `doctor.mjs`) hold the data and behaviour; `node bin/sync-shared.mjs` copies them into each skill; each skill's template owns markup and placement through its existing `<!--@KEY-->` fill. Specs gain an optional `generatedBy` object; build CLIs gain `--model/--effort/--agent`.

**Tech Stack:** Node ≥ 20 ES modules, `node:test`, Ajv schemas (JS objects, `additionalProperties:false`), Playwright for browser tests, Fontsource woff2 embedded as base64.

**Spec:** `docs/superpowers/specs/2026-10-14-artifact-polish-design.md`

## Global Constraints

- Branch `feat/diagram-stories`; never commit to `main`. Commit after each task; push after each phase.
- Edit shared code only in `plugins/portable-artifacts/shared/`, then run `node plugins/portable-artifacts/bin/sync-shared.mjs`; never edit `skills/*/shared/` directly. CI runs `sync-shared.mjs --check`.
- `shared/` has no npm dependencies; `shared/doctor.mjs` and every `scripts/doctor.mjs` import only Node built-ins and `shared/` files (doctor must run before `node_modules` exists).
- Pages stay offline: no network URLs; favicon is an inline `data:image/svg+xml` URI; existing CSPs are unchanged except where a task says so.
- `generatedBy` = `{ model?, effort?, agent? }`, each a string of 1–60 chars matching `^[A-Za-z0-9 ._:/()+-]+$`; missing → rendered "not reported"; never guessed.
- Fonts: Fontsource `@fontsource/*@5.3.0` latin subsets, OFL-1.1. paper and blueprint: Geist 600 / Geist 400,600 / Geist Mono 400; ink: Bricolage Grotesque 600 / Geist 400,600 / Geist Mono 400; editorial: Newsreader 600 / Atkinson Hyperlegible 400,700 / Geist Mono 400.
- Type tokens: `--fs-xs 12px`, `--fs-sm 14px`, `--fs-base 17px`, `--fs-md 21px`, `--fs-lg 27px`, `--fs-xl 34px`, `--fs-hero clamp(40px, 6vw, 60px)`; line-height body 1.6, headings 1.15, hero 1.05; tracking display −0.02em, hero −0.03em.
- Soft caps warn, never fail: title 8 words, label 4 words, paragraph 3 sentences or 60 words, text section 120 words, card body 30 words, list item 20 words, page prose 900 words, tldr 3 points.
- Golden baselines change only when the visual change is intended; regenerate with the skill's documented env var (`PA_WRITE_GOLDEN=1` for make-diagram and make-dashboard, `UPDATE_GOLDEN=1` for make-explainer) and say why in the commit body.
- Test commands (run from the named directory):
  - shared: `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (repo root)
  - bin: `node --test "test/*.test.mjs"` in `plugins/portable-artifacts/bin`
  - each skill: `npm test` in `plugins/portable-artifacts/skills/<skill>`
  - drift: `node plugins/portable-artifacts/bin/sync-shared.mjs --check` (repo root)
- SKILL.md provenance sentence (identical in all four skills' Workflow, next to the build step): "Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. `--model`, `--effort` and `--agent` on the build override it."
- Commit messages: conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), ending with the two trailer lines `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018YfmqkMQiRF2PGzpn4Brw7`. Subagent implementers do **not** commit; the controller commits (memory: subagents stamp wrong trailers).

## Review Focus

1. **Storage blocked** (Safari private window, `file://` in a sandboxed iframe): `localStorage` throws; the toggle must still cycle and label correctly. Pinned in Task 3 (vm test with a throwing storage).
2. **Hostile provenance values** (`--model 'x"><script>'`, 61-char strings, unicode): must fail validation with exit 1 and never reach the page. Pinned in Task 2 (unit) and Task 4 (build CLI).
3. **Explainer embedding a diagram**: the embedded figure must not add a second favicon, generator meta or theme toggle. Pinned in Task 4.
4. **Fresh install with no `node_modules`**: `scripts/doctor.mjs` must run and report `node_modules` missing instead of crashing on an `ajv` import. Pinned in Task 13.
5. **Windows host**: doctor must emit `winget` for ffmpeg and run fixes through a shell on `win32`. Pinned in Task 12 (injected platform).

---

## Phase 1 — Shared chrome

### Task 1: `shared/icons.mjs` — toggle icons and per-skill favicons

**Files:**
- Create: `plugins/portable-artifacts/shared/icons.mjs`
- Test: `plugins/portable-artifacts/shared/test/icons.test.mjs`

**Interfaces:**
- Consumes: `loadTheme(name)` from `shared/theme.mjs` (returns `{ light: { accent, surface, … }, dark: { accent, page, … } }`).
- Produces:
  - `SKILLS: string[]` = `['make-dashboard','make-diagram','make-explainer','make-motion']`
  - `SUN`, `MOON`, `AUTO`: SVG strings (24×24, `stroke="currentColor"`, `aria-hidden="true"`)
  - `faviconSvg(skill: string, theme: Theme): string`
  - `faviconHref(skill, theme): string` → `data:image/svg+xml,…`
  - `faviconLink(skill, theme): string` → `<link rel="icon" type="image/svg+xml" href="…">`

- [ ] **Step 1: Write the failing test**

```js
// plugins/portable-artifacts/shared/test/icons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, SUN, MOON, AUTO, faviconSvg, faviconHref, faviconLink } from '../icons.mjs';
import { loadTheme, listThemes } from '../theme.mjs';

test('toggle icons are decorative inline SVGs drawn in currentColor', () => {
  for (const icon of [SUN, MOON, AUTO]) {
    assert.match(icon, /^<svg [^>]*aria-hidden="true"/);
    assert.match(icon, /currentColor/);
  }
  assert.notEqual(SUN, MOON);
});

test('every skill has a distinct favicon in the theme accent, light and dark', () => {
  const theme = loadTheme('paper');
  const svgs = SKILLS.map((s) => faviconSvg(s, theme));
  assert.equal(new Set(svgs).size, SKILLS.length);
  for (const svg of svgs) {
    assert.ok(svg.includes(theme.light.accent));
    assert.ok(svg.includes(theme.dark.accent));
    assert.match(svg, /@media \(prefers-color-scheme: ?dark\)/);
  }
});

test('faviconHref is a data URI with no raw quotes or angle brackets', () => {
  for (const name of listThemes()) {
    const href = faviconHref('make-diagram', loadTheme(name));
    assert.match(href, /^data:image\/svg\+xml,/);
    assert.doesNotMatch(href.slice('data:image/svg+xml,'.length), /["<>]/);
  }
});

test('faviconLink is one rel=icon link tag', () => {
  const link = faviconLink('make-explainer', loadTheme('ink'));
  assert.match(link, /^<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]+">$/);
});

test('unknown skill throws, naming the known ones', () => {
  assert.throws(() => faviconSvg('make-nope', loadTheme('paper')), /make-dashboard, make-diagram, make-explainer, make-motion/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (repo root): `node --test "plugins/portable-artifacts/shared/test/icons.test.mjs"`
Expected: FAIL — `Cannot find module '../icons.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// plugins/portable-artifacts/shared/icons.mjs
// Shared SVG icons: the theme toggle's three states and one favicon per skill.
// Zero dependencies; every skill gets a copy through bin/sync-shared.mjs.

export const SKILLS = ['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion'];

const icon = (body) =>
  `<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const SUN = icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
export const MOON = icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
export const AUTO = icon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>');

// Glyphs drawn in class "g" on a 32x32 accent tile (class "t").
const GLYPHS = {
  'make-dashboard': '<rect class="g" x="8" y="17" width="4" height="8" rx="1"/><rect class="g" x="14" y="12" width="4" height="13" rx="1"/><rect class="g" x="20" y="7" width="4" height="18" rx="1"/>',
  'make-diagram': '<path class="s" d="M11 11l4 9M21 11l-4 9M12 9h8"/><circle class="g" cx="9" cy="9" r="3.5"/><circle class="g" cx="23" cy="9" r="3.5"/><circle class="g" cx="16" cy="23" r="3.5"/>',
  'make-explainer': '<rect class="g" x="9" y="6" width="14" height="20" rx="2"/><path class="l" d="M12 12h8M12 16h8M12 20h5"/>',
  'make-motion': '<path class="g" d="M12 8.5v15l12-7.5Z"/>',
};

export function faviconSvg(skill, theme) {
  const glyph = GLYPHS[skill];
  if (!glyph) throw new Error(`unknown skill "${skill}"; known: ${SKILLS.join(', ')}`);
  const { light, dark } = theme;
  const style =
    `.t{fill:${light.accent}}.g{fill:${light.surface}}.s,.l{stroke:${light.surface};stroke-width:2.5;stroke-linecap:round;fill:none}.l{stroke:${light.accent}}` +
    `@media (prefers-color-scheme: dark){.t{fill:${dark.accent}}.g{fill:${dark.page}}.s{stroke:${dark.page}}.l{stroke:${dark.accent}}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>${style}</style><rect class="t" width="32" height="32" rx="7"/>${glyph}</svg>`;
}

export const faviconHref = (skill, theme) => `data:image/svg+xml,${encodeURIComponent(faviconSvg(skill, theme))}`;

export const faviconLink = (skill, theme) => `<link rel="icon" type="image/svg+xml" href="${faviconHref(skill, theme)}">`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "plugins/portable-artifacts/shared/test/icons.test.mjs"`
Expected: PASS (5 tests).

- [ ] **Step 5: Look at the favicons** — write each skill's `faviconSvg(…, loadTheme('paper'))` to `.scratch/favicons/<skill>.svg`, open in Chrome light and dark (`colorScheme` in Playwright), screenshot at 64 px, and view the screenshot. Adjust glyph geometry only if a glyph is unreadable at 16 px.

- [ ] **Step 6: Commit** (controller) — `feat(portable-artifacts): shared favicon and theme toggle icons`

---

### Task 2: `shared/provenance.mjs` — model / effort / agent stamp

**Files:**
- Create: `plugins/portable-artifacts/shared/provenance.mjs`
- Test: `plugins/portable-artifacts/shared/test/provenance.test.mjs`

**Interfaces:**
- Produces:
  - `GENERATED_BY_SCHEMA` — Ajv-ready JSON schema object for the spec's `generatedBy` (closed object).
  - `PROVENANCE_OPTIONS` — `parseArgs` options `{ model, effort, agent }` (all `type:'string'`).
  - `mergeGeneratedBy(fromSpec: object|undefined, flags: {model?,effort?,agent?}): object|undefined` — flags win field by field; returns `undefined` when every field is absent.
  - `buildDate(env = process.env): Date` — honours `SOURCE_DATE_EPOCH` (integer seconds), else now.
  - `provenanceText(skill, gen, date): string`
  - `provenanceHtml(skill, gen, date): string` → `<p class="pa-provenance">…</p>`
  - `generatorMeta(skill, gen): string` → `<meta name="generator" content="…">`

- [ ] **Step 1: Write the failing test**

```js
// plugins/portable-artifacts/shared/test/provenance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATED_BY_SCHEMA, PROVENANCE_OPTIONS, mergeGeneratedBy, buildDate,
  provenanceText, provenanceHtml, generatorMeta,
} from '../provenance.mjs';

const DATE = new Date(Date.UTC(2026, 9, 14, 12));
// shared/ has no npm deps and CI runs these tests before any skill's npm ci, so no Ajv here:
// check the schema's own constraints directly. The Ajv round-trip is pinned in Task 4.
test('schema is closed and its field rule accepts realistic values, rejects hostile or long ones', () => {
  assert.equal(GENERATED_BY_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(GENERATED_BY_SCHEMA.properties).sort(), ['agent', 'effort', 'model']);
  const f = GENERATED_BY_SCHEMA.properties.model;
  const ok = (v) => v.length >= f.minLength && v.length <= f.maxLength && new RegExp(f.pattern).test(v);
  assert.ok(ok('Claude Opus 5.5') && ok('gpt-5.4 (codex)') && ok('Claude Code') && ok('high'));
  assert.ok(!ok('x"><script>alert(1)</script>'));
  assert.ok(!ok('a'.repeat(61)));
  assert.ok(!ok(''));
});

test('flags override the spec field by field; nothing given → undefined', () => {
  assert.deepEqual(mergeGeneratedBy({ model: 'A', effort: 'low' }, { effort: 'high' }), { model: 'A', effort: 'high' });
  assert.deepEqual(mergeGeneratedBy(undefined, { agent: 'Copilot CLI' }), { agent: 'Copilot CLI' });
  assert.equal(mergeGeneratedBy(undefined, {}), undefined);
  assert.deepEqual(Object.keys(PROVENANCE_OPTIONS).sort(), ['agent', 'effort', 'model']);
});

test('text names the skill, model, effort, agent and UTC date; missing fields say not reported', () => {
  assert.equal(
    provenanceText('make-explainer', { model: 'Claude Opus 5.5', effort: 'high', agent: 'Claude Code' }, DATE),
    'make-explainer · Claude Opus 5.5 · high effort · Claude Code · 14 Oct 2026');
  assert.equal(
    provenanceText('make-diagram', undefined, DATE),
    'make-diagram · model not reported · effort not reported · agent not reported · 14 Oct 2026');
});

test('html and meta escape their values', () => {
  const gen = { model: 'A&B' };
  assert.equal(provenanceHtml('make-motion', gen, DATE),
    '<p class="pa-provenance">make-motion · A&amp;B · effort not reported · agent not reported · 14 Oct 2026</p>');
  assert.equal(generatorMeta('make-motion', gen),
    '<meta name="generator" content="portable-artifacts make-motion; model=A&amp;B; effort=not reported; agent=not reported">');
});

test('buildDate honours SOURCE_DATE_EPOCH and ignores junk', () => {
  assert.equal(buildDate({ SOURCE_DATE_EPOCH: '1792000000' }).getTime(), 1792000000 * 1000);
  const now = Date.now();
  assert.ok(Math.abs(buildDate({ SOURCE_DATE_EPOCH: 'soon' }).getTime() - now) < 5000);
  assert.ok(Math.abs(buildDate({}).getTime() - now) < 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "plugins/portable-artifacts/shared/test/provenance.test.mjs"`
Expected: FAIL — `Cannot find module '../provenance.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// plugins/portable-artifacts/shared/provenance.mjs
// Who generated an artifact: the model, its effort level and the agent host.
// The agent self-reports; anything it cannot know renders as "not reported".

export const FIELDS = ['model', 'effort', 'agent'];
export const MAX_FIELD = 60;
const PATTERN = '^[A-Za-z0-9 ._:/()+-]+$';
const field = { type: 'string', minLength: 1, maxLength: MAX_FIELD, pattern: PATTERN };

export const GENERATED_BY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { model: field, effort: field, agent: field },
};

export const PROVENANCE_OPTIONS = { model: { type: 'string' }, effort: { type: 'string' }, agent: { type: 'string' } };

export function mergeGeneratedBy(fromSpec, flags = {}) {
  const merged = {};
  for (const k of FIELDS) {
    const v = flags[k] ?? fromSpec?.[k];
    if (v !== undefined) merged[k] = v;
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function buildDate(env = process.env) {
  const epoch = env.SOURCE_DATE_EPOCH;
  return /^\d+$/.test(epoch ?? '') ? new Date(Number(epoch) * 1000) : new Date();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DATE_FMT = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };

export function provenanceText(skill, gen = {}, date = buildDate()) {
  return [
    skill,
    gen?.model ?? 'model not reported',
    gen?.effort ? `${gen.effort} effort` : 'effort not reported',
    gen?.agent ?? 'agent not reported',
    date.toLocaleDateString('en-GB', DATE_FMT),
  ].join(' · ');
}

export const provenanceHtml = (skill, gen, date) => `<p class="pa-provenance">${esc(provenanceText(skill, gen, date))}</p>`;

export function generatorMeta(skill, gen = {}) {
  const parts = FIELDS.map((k) => `${k}=${gen?.[k] ?? 'not reported'}`).join('; ');
  return `<meta name="generator" content="${esc(`portable-artifacts ${skill}; ${parts}`)}">`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "plugins/portable-artifacts/shared/test/provenance.test.mjs"`
Expected: PASS (5 tests). If `toLocaleDateString` yields a different format on the CI Node (24), pin it with a manual formatter (`['Jan',…,'Dec'][d.getUTCMonth()]`) instead of changing the expected string.

- [ ] **Step 5: Commit** (controller) — `feat(portable-artifacts): shared provenance stamp for generated artifacts`

---

### Task 3: `shared/theme-toggle.mjs` — sun/moon toggle behaviour

**Files:**
- Create: `plugins/portable-artifacts/shared/theme-toggle.mjs`
- Test: `plugins/portable-artifacts/shared/test/theme-toggle.test.mjs`

**Interfaces:**
- Consumes: `SUN`, `MOON`, `AUTO` from `shared/icons.mjs`.
- Produces:
  - `MODES = ['auto','light','dark']`, `THEME_KEY = 'pa-theme'`
  - `nextMode(mode): string` — junk counts as auto (so → `'light'`), matching the old `PA.nextTheme`.
  - `toggleIcons(): string` — three `<span class="pa-ti pa-ti-<mode>">` wrappers.
  - `TOGGLE_CSS: string` — shows only the icon matching the button's `data-mode`; 36 px hit area.
  - `TOGGLE_JS: string` — self-contained IIFE: delegated click on any `[data-theme-toggle]`, cycles modes, stores `pa-theme` (try/catch), sets/clears `data-theme` on `<html>`, sets `data-mode`, `aria-label` and `title` ("Theme: Light. Switch to Dark") on every toggle, dispatches `document` event `pa:theme` with `detail.mode`.
  - Template button contract: `<button type="button" class="… " data-theme-toggle data-mode="auto" aria-label="Theme: Auto. Switch to Light" title="Theme: Auto. Switch to Light"><!--@TOGGLE_ICONS--></button>`

- [ ] **Step 1: Write the failing test**

```js
// plugins/portable-artifacts/shared/test/theme-toggle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MODES, THEME_KEY, nextMode, toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../theme-toggle.mjs';

test('nextMode cycles auto → light → dark → auto; junk counts as auto', () => {
  assert.deepEqual(MODES, ['auto', 'light', 'dark']);
  assert.equal(nextMode('auto'), 'light');
  assert.equal(nextMode('light'), 'dark');
  assert.equal(nextMode('dark'), 'auto');
  assert.equal(nextMode('weird'), 'light');
  assert.equal(THEME_KEY, 'pa-theme');
});

test('icons and css cover all three modes', () => {
  for (const m of MODES) {
    assert.match(toggleIcons(), new RegExp(`class="pa-ti pa-ti-${m}"`));
    assert.match(TOGGLE_CSS, new RegExp(`\\[data-mode="${m}"\\] \\.pa-ti-${m}`));
  }
});

// Minimal DOM: enough for TOGGLE_JS (attributes, querySelectorAll, one delegated click listener).
function fakeDom(storage) {
  const attrs = (init = {}) => {
    const a = { ...init };
    return {
      getAttribute: (k) => (k in a ? a[k] : null),
      setAttribute: (k, v) => { a[k] = String(v); },
      removeAttribute: (k) => { delete a[k]; },
      attrs: a,
    };
  };
  const root = attrs();
  const button = { ...attrs({ 'data-mode': 'auto' }), closest: (sel) => (sel === '[data-theme-toggle]' ? button : null) };
  const events = [];
  let clickHandler;
  const document = {
    documentElement: root,
    querySelectorAll: () => [button],
    addEventListener: (type, fn) => { if (type === 'click') clickHandler = fn; },
    dispatchEvent: (e) => events.push(e),
  };
  const window = {};
  Object.defineProperty(window, 'localStorage', { get: () => { if (storage === 'throws') throw new Error('blocked'); return storage; } });
  const context = { document, window, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };
  vm.runInNewContext(TOGGLE_JS, context);
  return { root, button, events, click: () => clickHandler({ target: button }) };
}

test('clicking cycles data-theme, stores the mode, relabels and fires pa:theme', () => {
  const saved = {};
  const dom = fakeDom({ setItem: (k, v) => { saved[k] = v; } });
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Auto. Switch to Light');
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'light');
  assert.equal(dom.button.attrs['data-mode'], 'light');
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Light. Switch to Dark');
  assert.equal(dom.button.attrs.title, 'Theme: Light. Switch to Dark');
  assert.equal(saved['pa-theme'], 'light');
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'dark');
  dom.click();
  assert.equal('data-theme' in dom.root.attrs, false);
  assert.deepEqual(dom.events.map((e) => e.detail.mode), ['light', 'dark', 'auto']);
});

test('blocked storage: toggle still cycles without throwing', () => {
  const dom = fakeDom('throws');
  dom.click();
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'dark');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "plugins/portable-artifacts/shared/test/theme-toggle.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// plugins/portable-artifacts/shared/theme-toggle.mjs
// The icon theme toggle shared by every page: Auto -> Light -> Dark.
// Templates own the <button>; this module owns its icons, CSS and behaviour.
import { SUN, MOON, AUTO } from './icons.mjs';

export const MODES = ['auto', 'light', 'dark'];
export const THEME_KEY = 'pa-theme';

export function nextMode(mode) {
  const i = MODES.indexOf(mode);
  return MODES[((i < 0 ? 0 : i) + 1) % MODES.length];
}

export const toggleIcons = () =>
  `<span class="pa-ti pa-ti-auto">${AUTO}</span><span class="pa-ti pa-ti-light">${SUN}</span><span class="pa-ti pa-ti-dark">${MOON}</span>`;

export const TOGGLE_CSS = [
  '[data-theme-toggle]{display:inline-grid;place-items:center;min-width:36px;min-height:36px;padding:0;line-height:0;cursor:pointer}',
  '.pa-ti{display:none}',
  ...MODES.map((m) => `[data-theme-toggle][data-mode="${m}"] .pa-ti-${m}{display:inline-flex}`),
  '@media print{[data-theme-toggle]{display:none}}',
].join('\n');

// Plain ES5 so it runs inline on every page; mirrors nextMode() above.
export const TOGGLE_JS = `(function () {
  var MODES = ${JSON.stringify(MODES)};
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var root = document.documentElement;
  function next(m) { var i = MODES.indexOf(m); return MODES[((i < 0 ? 0 : i) + 1) % MODES.length]; }
  function current() { var t = root.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function paint(m) {
    var label = 'Theme: ' + LABEL[m] + '. Switch to ' + LABEL[next(m)];
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('data-mode', m);
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
    }
  }
  function apply(m) {
    if (m === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    paint(m);
    try { document.dispatchEvent(new CustomEvent('pa:theme', { detail: { mode: m } })); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var m = next(current());
    try { window.localStorage.setItem(${JSON.stringify(THEME_KEY)}, m); } catch (err) {}
    apply(m);
  });
  paint(current());
})();`;
```

- [ ] **Step 4: Run tests** — `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` → all PASS.

- [ ] **Step 5: Sync and check drift**

Run: `node plugins/portable-artifacts/bin/sync-shared.mjs && node plugins/portable-artifacts/bin/sync-shared.mjs --check`
Expected: `shared/ copies are in sync`.

- [ ] **Step 6: Commit** (controller) — `feat(portable-artifacts): shared icon theme toggle` (include the synced `skills/*/shared/` copies).

---

### Task 4: Wire chrome into make-explainer (page and slides)

**Files:**
- Modify: `skills/make-explainer/scripts/lib/schema.mjs:135-143` (ROOT_SCHEMA gains `generatedBy`)
- Modify: `skills/make-explainer/scripts/build.mjs:17` (OPTIONS gains `PROVENANCE_OPTIONS`), `:26-28` (merge flags into spec)
- Modify: `skills/make-explainer/scripts/lib/page.mjs:225-235` (parts gain FAVICON, GENERATOR, TOGGLE_ICONS, TOGGLE_CSS, TOGGLE_JS, PROVENANCE)
- Modify: `skills/make-explainer/template/page.html` (head, toggle button lines 39-43, footer after line 50)
- Modify: `skills/make-explainer/template/slides.html` (head) and `skills/make-explainer/scripts/lib/slides.mjs:103-113` (`chrome()` button) and the cover/last slide footer
- Modify: `skills/make-explainer/template/runtime.js:20-35` (delete old toggle block), `template/pa-lib.js` (delete `nextTheme` and its export — now unused), `test/page.test.mjs:169-…` (delete the `nextTheme` test; its behaviour is covered by `shared/test/theme-toggle.test.mjs`)
- Modify: `skills/make-explainer/template/base.css` (`.theme-toggle` rule lines 31-32 → icon button style; add `.pa-provenance`)
- Modify: `skills/make-explainer/SKILL.md` (Workflow step 2: set `generatedBy`), `references/schema.md`
- Test: `skills/make-explainer/test/chrome.test.mjs` (new), `test/chrome-browser.test.mjs` (new)

**Interfaces:**
- Consumes: Task 1 `faviconLink`; Task 2 `GENERATED_BY_SCHEMA`, `PROVENANCE_OPTIONS`, `mergeGeneratedBy`, `buildDate`, `provenanceHtml`, `generatorMeta`; Task 3 `toggleIcons`, `TOGGLE_CSS`, `TOGGLE_JS`.
- Produces: spec field `generatedBy`; CLI flags `--model/--effort/--agent` on `build.mjs`; footer element `<footer class="pa-footer"><p class="pa-provenance">…</p></footer>`.

- [ ] **Step 1: Write the failing tests**

```js
// skills/make-explainer/test/chrome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../references/examples/', import.meta.url));
const run = (args) => spawnSync(process.execPath, [BUILD, ...args], {
  encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', SOURCE_DATE_EPOCH: '1792000000' },
});
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-chrome-')));

function buildExample(name, extra = []) {
  const out = path.join(tmp(), `${name}.html`);
  const r = run([path.join(EXAMPLES, `${name}.explainer.json`), '--out', out, ...extra]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return fs.readFileSync(out, 'utf8');
}

for (const name of ['recap', 'slides']) {
  test(`${name}: one favicon, one generator meta, one icon toggle, a provenance line`, () => {
    const html = buildExample(name, ['--model', 'Claude Opus 5.5', '--effort', 'high', '--agent', 'Claude Code']);
    assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
    assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
    assert.match(html, /content="portable-artifacts make-explainer; model=Claude Opus 5.5; effort=high; agent=Claude Code"/);
    assert.equal(html.match(/data-theme-toggle/g)?.length >= 1, true);
    assert.match(html, /data-mode="auto"/);
    assert.match(html, /class="pa-ti pa-ti-light"/);
    assert.doesNotMatch(html, />Theme: Auto</);
    assert.match(html, /make-explainer · Claude Opus 5.5 · high effort · Claude Code · /);
  });
}

test('generatedBy in the spec renders; flags override it', () => {
  const dir = tmp();
  const spec = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'concept.explainer.json'), 'utf8'));
  spec.generatedBy = { model: 'Claude Haiku 4.5', effort: 'low' };
  const file = path.join(dir, 'c.explainer.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = path.join(dir, 'c.html');
  assert.equal(run([file, '--out', out, '--agent', 'Codex']).status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /Claude Haiku 4\.5 · low effort · Codex/);
});

test('hostile --model fails validation with exit 1 and writes nothing', () => {
  const out = path.join(tmp(), 'x.html');
  const r = run([path.join(EXAMPLES, 'recap.explainer.json'), '--out', out, '--model', 'x"><script>alert(1)</script>']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /generatedBy/);
  assert.equal(fs.existsSync(out), false);
});

test('an embedded diagram adds no second favicon, meta or toggle', () => {
  const out = path.join(tmp(), 'all.html');
  const fixture = fileURLToPath(new URL('./fixtures/all-types.explainer.json', import.meta.url)); // has a diagram section
  const r = run([fixture, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
  assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
  assert.equal(html.match(/<button[^>]*data-theme-toggle/g)?.length, 1);
});
```

```js
// skills/make-explainer/test/chrome-browser.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { haveBrowser, buildFile, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

test('toggle click cycles data-theme and icon in the real page', { skip: !(await haveBrowser()) }, async () => {
  const file = await buildFile('recap'); // helper signature: see test/helpers/browser.mjs:35
  const page = await openPage(file);
  const mode = () => page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('data-mode')]);
  assert.deepEqual(await mode(), [null, 'auto']);
  for (const want of ['light', 'dark', 'auto']) {
    await page.click('[data-theme-toggle]');
    const [theme, m] = await mode();
    assert.equal(m, want);
    assert.equal(theme, want === 'auto' ? null : want);
    assert.equal(await page.isVisible(`.pa-ti-${want}`), true);
  }
});
```

Adapt `buildFile`/`openPage` calls to their real signatures in `test/helpers/browser.mjs:35,65` before running.

- [ ] **Step 2: Run to verify failure** — `npm test -- --test-name-pattern="favicon|generatedBy|hostile|embedded|toggle click"` in `skills/make-explainer` (or `node --test test/chrome.test.mjs test/chrome-browser.test.mjs`). Expected: FAIL (no `rel="icon"`, unknown option `--model`).

- [ ] **Step 3: Implement**

  1. `schema.mjs` — import and add to ROOT_SCHEMA properties:
     ```js
     import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
     // inside ROOT_SCHEMA properties:
     generatedBy: GENERATED_BY_SCHEMA,
     ```
  2. `build.mjs` — `const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, json: { type: 'boolean' }, ...PROVENANCE_OPTIONS };` and in `build()` after the theme merge:
     ```js
     const generatedBy = mergeGeneratedBy(spec.generatedBy, { model, effort, agent });
     const withGen = generatedBy ? { ...spec, generatedBy } : spec;
     ```
     Pass `withGen` to validation and rendering so invalid flag values fail Ajv (exit 1) with path `/generatedBy/model`. Thread `model/effort/agent` from the CLI entry (`build.mjs:92`) into `build()` options.
  3. `page.mjs` parts (both modes):
     ```js
     FAVICON: faviconLink('make-explainer', themeData),
     GENERATOR: generatorMeta('make-explainer', spec.generatedBy),
     TOGGLE_ICONS: toggleIcons(),
     TOGGLE_CSS,
     TOGGLE_JS: inlineCode(TOGGLE_JS),
     PROVENANCE: provenanceHtml('make-explainer', spec.generatedBy, buildDate()),
     ```
  4. `page.html` head: after `<title>` add `<!--@FAVICON-->` and `<!--@GENERATOR-->`; add `<style><!--@TOGGLE_CSS--></style>` after the BASECSS style. Replace lines 39-43 with:
     ```html
     <button type="button" class="theme-toggle" data-theme-toggle data-mode="auto" aria-label="Theme: Auto. Switch to Light" title="Theme: Auto. Switch to Light"><!--@TOGGLE_ICONS--></button>
     <script><!--@TOGGLE_JS--></script>
     ```
     After the closing `</div>` of `.layout` (line 50) add `<footer class="pa-footer"><!--@PROVENANCE--></footer>`.
  5. `slides.html` head: same FAVICON / GENERATOR / TOGGLE_CSS; before `</body>` add `<script><!--@TOGGLE_JS--></script>`. In `slides.mjs` `chrome()` replace the text button with the icon button markup above (insert `toggleIcons()` directly since chrome() is JS). Add the provenance line to the last slide (`<footer class="pa-footer">…</footer>` inside the final slide) and to the print footer.
  6. Delete the old toggle block in `runtime.js:20-35`, `nextTheme` in `pa-lib.js` (and from its export list), and the `nextTheme` test in `test/page.test.mjs`.
  7. `base.css`: replace `.theme-toggle` (lines 31-32) with `.theme-toggle { flex: none; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; color: var(--text-2); } .theme-toggle:hover { color: var(--text); border-color: var(--text-3); }` and add `.pa-footer { max-width: 76rem; margin: 64px auto 32px; padding: 16px 24px 0; border-top: 1px solid var(--line); } .pa-provenance { margin: 0; color: var(--text-3); font-size: 0.8rem; }`.
  8. `SKILL.md` Workflow step 2 add: "Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (e.g. Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave a field out if you do not know it." Document the field and the three flags in `references/schema.md`.

- [ ] **Step 4: Run the whole suite** — `npm test` in `skills/make-explainer`. Expected: new tests PASS. Goldens (`test/golden.test.mjs`) will FAIL because the masthead changed: inspect the diff, confirm only the toggle markup changed, then `UPDATE_GOLDEN=1 node --test test/golden.test.mjs` and rerun `npm test` → PASS. The exact-stdout test in `test/build.test.mjs` must still pass (no new warnings).

- [ ] **Step 5: Look at it** — build `references/examples/recap.explainer.json` and `slides.explainer.json` to `.scratch/`, screenshot light and dark at 1440 and 390 (iframe trick for 390, `reducedMotion:'reduce'`), view, and confirm the toggle and footer look intentional.

- [ ] **Step 6: Commit** (controller) — `feat(make-explainer): favicon, icon theme toggle and provenance stamp` with body "Goldens regenerated: masthead toggle markup changed (text button → icon button)."

---

### Task 5: Wire chrome into make-diagram

**Files:**
- Modify: `skills/make-diagram/scripts/lib/schema.mjs:45-98` (SCHEMA gains `generatedBy`)
- Modify: `skills/make-diagram/scripts/build.mjs:19-26,54` (USAGE, OPTIONS, flag merge)
- Modify: `skills/make-diagram/scripts/lib/viewer.mjs:112-124` (parts)
- Modify: `skills/make-diagram/template/viewer.html` (line 8 meta → `<!--@GENERATOR-->`; favicon; toggle button line 141 and its relabel script 142-145; provenance line under the title block lines 118-122)
- Modify: `skills/make-diagram/template/toolbar.js:13-29` (delete theme block; keep `pa-theme-css` export logic at 105-117)
- Modify: `skills/make-diagram/SKILL.md`, `references/schema.md`
- Test: `skills/make-diagram/test/chrome.test.mjs` (new), extend `test/browser.test.mjs` or new `test/chrome-browser.test.mjs`

**Interfaces:** Consumes the same Task 1–3 exports. `buildDiagram` (api.mjs:115) is **not** changed — embeds stay chrome-free.

- [ ] **Step 1: Write the failing tests** — same shape as Task 4's `chrome.test.mjs`, using `build` from `../scripts/build.mjs` and `example('flow')` (see `test/build.test.mjs` helpers `run`, `example`):

```js
// skills/make-diagram/test/chrome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDiagram } from '../scripts/lib/api.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const example = (n) => fileURLToPath(new URL(`../references/examples/${n}.diagram.json`, import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-chrome-'));
const run = (args) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', env: { ...process.env, PA_OUTPUT_DIR: tmp(), HOME: tmp(), SOURCE_DATE_EPOCH: '1792000000' } });

test('viewer page has favicon, generator meta, icon toggle and provenance', () => {
  const out = path.join(tmp(), 'a.html');
  const r = run([example('flow'), '--out', out, '--model', 'Claude Haiku 4.5', '--effort', 'low', '--agent', 'Claude Code']);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(html.match(/<link rel="icon"/g)?.length, 1);
  assert.equal(html.match(/<meta name="generator"/g)?.length, 1);
  assert.match(html, /portable-artifacts make-diagram; model=Claude Haiku 4\.5; effort=low; agent=Claude Code/);
  assert.match(html, /<button[^>]*data-theme-toggle[^>]*data-mode="auto"/);
  assert.match(html, /make-diagram · Claude Haiku 4\.5 · low effort · Claude Code · /);
});

test('hostile --agent fails with exit 1', () => {
  const r = run([example('flow'), '--out', path.join(tmp(), 'b.html'), '--agent', '<img src=x>']);
  assert.equal(r.status, 1);
});

test('buildDiagram (the embed API) stays chrome-free', async () => {
  const spec = JSON.parse(fs.readFileSync(example('flow'), 'utf8'));
  const built = await buildDiagram(spec, {});
  assert.doesNotMatch(built.svg + built.css, /data-theme-toggle|rel="icon"|pa-provenance/);
});
```

Browser test: build `flow`, click `[data-theme-toggle]` three times, assert `data-theme` and `data-mode` as in Task 4; also assert the toggle is hidden in full screen (`F`) as before.

- [ ] **Step 2: Run to verify failure** — `node --test test/chrome.test.mjs` → FAIL.

- [ ] **Step 3: Implement** — as Task 4 steps 3.1–3.3 with skill name `make-diagram` and `theme` (the resolved theme object in `renderViewer`). In `viewer.html`: replace line 8 with `<!--@GENERATOR-->` and add `<!--@FAVICON-->` after it; add `<style><!--@TOGGLE_CSS--></style>` after the static style block; replace lines 141-145 with the icon button plus `<script><!--@TOGGLE_JS--></script>`; add `<!--@PROVENANCE-->` after `<!--@SUBTITLE-->` (line 121), styled `.pa-provenance { margin: 2px 0 0; color: var(--text-3); font-size: 11px; }` and hidden in fill/full screen alongside `.titles` (line 44 rule already hides `.titles`). Delete toolbar.js lines 13-29. Keep the existing full-screen hide rule for `[data-theme-toggle]` (line 44). Size check: the page must stay under `MAX_PAGE_BYTES` (`build.test.mjs` near-limit tests cover this).

- [ ] **Step 4: Run the suite** — `npm test` in `skills/make-diagram` → PASS. No golden changes expected here (SVG goldens do not include the viewer chrome); if `render.test.mjs` goldens fail, stop and report — that means the change leaked into the SVG.

- [ ] **Step 5: Look at it** — build all four example types to `.scratch/`, screenshot light/dark, view.

- [ ] **Step 6: Commit** (controller) — `feat(make-diagram): favicon, icon theme toggle and provenance stamp`

---

### Task 6: Wire chrome into make-dashboard

**Files:**
- Modify: `skills/make-dashboard/scripts/lib/spec.mjs:27-31` (SCHEMA gains `generatedBy`)
- Modify: `skills/make-dashboard/scripts/build.mjs:12-19,30` (USAGE, OPTIONS, pass `generatedBy` flags into `buildDashboard`)
- Modify: `skills/make-dashboard/scripts/lib/pipeline.mjs` (merge flags into the spec before validation, as Task 4 step 3.2)
- Modify: `skills/make-dashboard/scripts/lib/html.mjs:95-122` (parts)
- Modify: `skills/make-dashboard/template/page.html` (head; toggle line 78-82; add `<footer class="pa-footer"><p class="refreshed">Refreshed <!--@REFRESHED--></p><!--@PROVENANCE--></footer>` before the data script at line 87 and remove the header refresh line 76 — the refresh time moves into the footer beside the stamp)
- Modify: `skills/make-dashboard/template/runtime.js:20-36` (delete toggle block; add `document.addEventListener('pa:theme', render);` so charts re-render on theme change), `template/pa-lib.js` (delete `nextTheme`), `test/pa-lib.test.mjs:18-21` (delete)
- Modify: `skills/make-dashboard/scripts/serve.mjs` only if it rebuilds through a path that bypasses `buildDashboard` options — the stamp must survive `serve.mjs --watch` rebuilds because it lives in the spec.
- Modify: `skills/make-dashboard/SKILL.md`, `references/schema.md`
- Test: `skills/make-dashboard/test/chrome.test.mjs` (new), browser test in `test/browser.test.mjs`

- [ ] **Step 1: Write the failing tests** — same assertions as Task 5's first two tests, using `BUILD`, `EXAMPLE` and `readPage(out)` from `test/build.test.mjs:13-45` (copy the helpers), plus:

```js
test('refresh time sits in the footer beside the stamp', () => {
  // build EXAMPLE as above
  assert.match(html, /<footer class="pa-footer"><p class="refreshed">Refreshed [^<]+<\/p><p class="pa-provenance">make-dashboard · /);
});
```

Browser test: click the toggle once; assert `data-theme="light"` and that the Vega charts re-rendered (e.g. the first chart's `svg` background or a text fill changed between light and dark — read `getComputedStyle` of a chart label before and after a second click to dark).

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — as Tasks 4–5, skill name `make-dashboard`. Existing test `build.test.mjs:65-77` asserts `<details>\s*<summary>Query · 4 rows · refreshed` (per-card, unchanged) — keep it passing.
- [ ] **Step 4: Run the suite** — `npm test` → PASS. View goldens (`test/views.test.mjs`) should not change; if they do, stop and report.
- [ ] **Step 5: Look at it** — build the example to `.scratch/`, screenshot light/dark/390, view.
- [ ] **Step 6: Commit** (controller) — `feat(make-dashboard): favicon, icon theme toggle and provenance footer`

---

### Task 7: make-motion — favicon, preview stamp, MP4 metadata

**Files:**
- Modify: `skills/make-motion/scripts/lib/spec.mjs:105-109` (SCHEMA gains `generatedBy`)
- Modify: `skills/make-motion/scripts/lib/server.mjs:82-89` (`loadIndex`) and the `/` route (157-159): fill `{{FAVICON}}` and `{{PROVENANCE}}` per request from the current spec (read fresh; on an invalid spec fall back to `provenanceHtml('make-motion', undefined)`)
- Modify: `skills/make-motion/template/index.html` (`<link rel="icon" …>` via `{{FAVICON}}` after `<title>`; `<footer class="pa-footer">{{PROVENANCE}}</footer>` after `#ui`)
- Modify: `skills/make-motion/template/styles.css` (`.pa-footer` / `.pa-provenance`, dark-only colours)
- Modify: `skills/make-motion/scripts/lib/ffmpeg.mjs:62-68` (`encodeArgs` gains `metadata`)
- Modify: `skills/make-motion/scripts/render.mjs:25,55,154` (USAGE; `--model/--effort/--agent` via `takeValue`; pass metadata)
- Modify: `skills/make-motion/SKILL.md`, `references/schema.md`
- Test: `skills/make-motion/test/ffmpeg.test.mjs` (extend), `test/server.test.mjs` (extend), `test/validate.test.mjs` (extend)

**Interfaces:**
- Produces: `encodeArgs({ fps, out, audio, duration, metadata })` where `metadata` is `{ comment?: string, artist?: string }`; flags are inserted as `'-metadata', 'comment=<text>'` and `'-metadata', 'artist=<model>'` immediately before `out`.

- [ ] **Step 1: Write the failing tests**

```js
// append to skills/make-motion/test/ffmpeg.test.mjs
test('encodeArgs writes provenance metadata before the output path', () => {
  const args = encodeArgs({ fps: 30, out: 'o.mp4', metadata: { comment: 'make-motion · Claude Sonnet 5 · effort not reported · Claude Code · 14 Oct 2026', artist: 'Claude Sonnet 5' } });
  assert.deepEqual(args.slice(-5), ['-metadata', 'comment=make-motion · Claude Sonnet 5 · effort not reported · Claude Code · 14 Oct 2026', '-metadata', 'artist=Claude Sonnet 5', 'o.mp4']);
});

test('encodeArgs without metadata is unchanged', () => {
  assert.deepEqual(encodeArgs({ fps: 30, out: 'o.mp4' }).at(-1), 'o.mp4');
  assert.equal(encodeArgs({ fps: 30, out: 'o.mp4' }).includes('-metadata'), false);
});
```

Server test (extend `test/server.test.mjs` with its existing harness): `GET /` returns HTML containing `<link rel="icon" type="image/svg+xml"` and `<p class="pa-provenance">make-motion · ` and the response CSP header is unchanged. Validate test: a spec with `generatedBy: { model: '<x>' }` fails validation.

- [ ] **Step 2: Run to verify failure** — `node --test test/ffmpeg.test.mjs test/server.test.mjs test/validate.test.mjs` → FAIL.

- [ ] **Step 3: Implement**
  ```js
  // ffmpeg.mjs
  const META = (m = {}) => Object.entries(m).filter(([, v]) => v).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  export function encodeArgs({ fps, out, audio = [], duration, metadata }) {
    if (!audio.length) return [...VIDEO_INPUT(fps), ...VIDEO_CODEC, ...META(metadata), out];
    // existing audio branch, with ...META(metadata) inserted immediately before out
  }
  ```
  In `render.mjs`, after loading the spec: `const gen = mergeGeneratedBy(spec.generatedBy, { model, effort, agent });` (validate the merged spec as today) and `metadata: { comment: provenanceText('make-motion', gen, buildDate()), artist: gen?.model }`. No theme toggle on the preview (owner decision).

- [ ] **Step 4: Run** `npm test` in `skills/make-motion` → PASS. Then a real render: `node scripts/render.mjs references/examples/<any>.json --out .scratch/m.mp4 --model "Claude Opus 5.5" --agent "Claude Code"` and `ffprobe -v error -show_entries format_tags=comment,artist .scratch/m.mp4` → shows both tags. Open the preview (`node scripts/preview.mjs <spec>`), screenshot, view the favicon tab and footer.

- [ ] **Step 5: Commit** (controller) — `feat(make-motion): favicon, preview provenance and MP4 metadata`; then push the branch (end of Phase 1).

---

## Phase 2 — Type system

### Task 8: Swap fonts to Geist, regenerate metrics and goldens

**Files:**
- Add: `shared/fonts/geist-sans-latin-400-normal.woff2`, `geist-sans-latin-600-normal.woff2`, `geist-mono-latin-400-normal.woff2`; `shared/fonts/LICENSES/` Geist OFL text
- Delete: `shared/fonts/ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2`, `ibm-plex-mono-latin-400-normal.woff2`, `jetbrains-mono-latin-400-normal.woff2` and their LICENSES entries
- Modify: `shared/fonts/SOURCES.md`, `shared/themes/{paper,blueprint,ink,editorial}.json` (`fonts` blocks), `shared/fonts/metrics.json` (regenerated)
- Modify: `skills/make-diagram/package.json` + `package-lock.json` (devDependencies: add `@fontsource/geist-sans@5.3.0`, `@fontsource/geist-mono@5.3.0`; remove `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@fontsource/jetbrains-mono`)
- Modify: `shared/test/theme.test.mjs` (add family assertions)
- Regenerate: make-diagram goldens (`test/golden/*.svg`, `*.layout.json`), any make-dashboard/make-motion/make-explainer baseline that encodes font names or widths

**Interfaces:** Theme font family names become `"Geist"` and `"Geist Mono"`; `fontFor(theme, role)` and `metricsFor({family, weight})` (shared/text.mjs:23,103) must resolve them.

- [ ] **Step 1: Write the failing test** (append to `shared/test/theme.test.mjs`):

```js
test('themes use the Geist type system; editorial keeps its serif display', () => {
  const fam = (t, role) => loadTheme(t).fonts[role].family;
  for (const t of ['paper', 'blueprint']) {
    assert.equal(fam(t, 'display'), 'Geist');
    assert.equal(fam(t, 'body'), 'Geist');
  }
  assert.equal(fam('ink', 'display'), 'Bricolage Grotesque');
  assert.equal(fam('ink', 'body'), 'Geist');
  assert.equal(fam('editorial', 'display'), 'Newsreader');
  assert.equal(fam('editorial', 'body'), 'Atkinson Hyperlegible');
  for (const t of listThemes()) assert.equal(fam(t, 'mono'), 'Geist Mono');
});
```

- [ ] **Step 2: Run** `node --test "plugins/portable-artifacts/shared/test/theme.test.mjs"` → FAIL.

- [ ] **Step 3: Implement**
  1. In `skills/make-diagram`: `npm install --save-dev @fontsource/geist-sans@5.3.0 @fontsource/geist-mono@5.3.0 && npm uninstall @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono @fontsource/jetbrains-mono`.
  2. Copy `node_modules/@fontsource/geist-sans/files/geist-sans-latin-{400,600}-normal.woff2` and `node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2` into `plugins/portable-artifacts/shared/fonts/`; copy each package's `LICENSE` into `shared/fonts/LICENSES/` following the existing naming there; delete the four retired woff2 files and their licence files; update `SOURCES.md` rows.
  3. Theme `fonts` blocks (paper shown; blueprint identical; ink keeps `display` Bricolage; editorial keeps `display` Newsreader and `body` Atkinson):
     ```json
     "fonts": {
       "display": { "family": "Geist", "fallback": "-apple-system, 'Segoe UI', sans-serif", "weights": { "600": "geist-sans-latin-600-normal.woff2" } },
       "body": { "family": "Geist", "fallback": "-apple-system, 'Segoe UI', sans-serif", "weights": { "400": "geist-sans-latin-400-normal.woff2", "600": "geist-sans-latin-600-normal.woff2" } },
       "mono": { "family": "Geist Mono", "fallback": "ui-monospace, Menlo, Consolas, monospace", "weights": { "400": "geist-mono-latin-400-normal.woff2" } }
     }
     ```
     Newsreader moves from paper to editorial (`editorial.display`); the newsreader woff2 stays.
  4. Regenerate metrics: in `skills/make-diagram` run `node scripts/dev/font-metrics.mjs` (it derives the package from the text before `-latin-`, so `geist-sans-latin-400-normal.woff2` → `@fontsource/geist-sans` ✓). Confirm `shared/fonts/metrics.json` gains `Geist|400`, `Geist|600`, `Geist Mono|400` and loses the retired families. Note: the script writes `skills/make-diagram/shared/fonts/metrics.json`; copy that file to the plugin-level `shared/fonts/metrics.json`, then `node bin/sync-shared.mjs`.
  5. `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` → PASS (font budget ≤ 200 KB per theme; contrast unchanged).

- [ ] **Step 4: Run every skill suite.** Expected golden failures in make-diagram (widths change with metrics). For each failing golden, inspect a diff sample to confirm only geometry/font changed, then regenerate: `PA_WRITE_GOLDEN=1 npm test` in `skills/make-diagram`, then `npm test` → PASS. Same for any make-dashboard (`PA_WRITE_GOLDEN=1`) or make-explainer (`UPDATE_GOLDEN=1`) baseline that fails, after inspection. make-motion `theme-render.test.mjs`: if it compares pixels, regenerate per its documented method; if none documented, stop and report. Check the explainer recap page stays ≤ 600 KB (`golden.test.mjs:30`) and diagram near-limit tests still pass.

- [ ] **Step 5: Look at it** — rebuild one page per skill to `.scratch/`, screenshot, view: labels must not clip in diagram nodes.

- [ ] **Step 6: Commit** (controller) — `feat(portable-artifacts): Geist type system across themes` with body naming every regenerated golden set and why ("font metrics changed: Geist replaces IBM Plex / JetBrains Mono").

---

### Task 9: `shared/type.mjs` — type scale, link rules, style lint

**Files:**
- Create: `shared/type.mjs`, `shared/test/type.test.mjs`
- Modify: `shared/theme.mjs:69-80` (`themeCss` appends `typeCss()`)
- Modify: every template CSS that hard-codes sizes or underlines: `skills/make-explainer/template/base.css`, `slides.html` inline style, `skills/make-diagram/template/viewer.html` style block, `skills/make-dashboard/template/page.html` style block. Replace ad-hoc `rem`/`px` font sizes for text roles with tokens; remove any `text-decoration: underline`.
- Create: `plugins/portable-artifacts/bin/test/style-lint.test.mjs`

**Interfaces:**
- Produces: `TYPE_TOKENS` (object name → value), `typeCss(): string` (emits `:root{…}` tokens, small-label class `.pa-label`, link rules, focus ring). Prose-link selector list: `.prose a, p a, li a, td a, dd a, figcaption a`.

- [ ] **Step 1: Write the failing tests**

```js
// shared/test/type.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_TOKENS, typeCss } from '../type.mjs';
import { themeCss, loadTheme } from '../theme.mjs';

test('every token is emitted with its spec value', () => {
  assert.deepEqual(TYPE_TOKENS, {
    '--fs-xs': '12px', '--fs-sm': '14px', '--fs-base': '17px', '--fs-md': '21px', '--fs-lg': '27px', '--fs-xl': '34px',
    '--fs-hero': 'clamp(40px, 6vw, 60px)', '--lh-body': '1.6', '--lh-head': '1.15', '--lh-hero': '1.05',
    '--track-display': '-0.02em', '--track-hero': '-0.03em',
  });
  for (const [k, v] of Object.entries(TYPE_TOKENS)) assert.ok(typeCss().includes(`${k}:${v}`), k);
});

test('links: underline only inside running text; never for nav or buttons; visible focus', () => {
  const css = typeCss();
  assert.match(css, /a\{[^}]*text-decoration:none/);
  assert.match(css, /\.prose a, p a, li a, td a, dd a, figcaption a\{[^}]*text-decoration-line:underline[^}]*text-decoration-thickness:1px[^}]*text-underline-offset:0\.22em/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\)/);
});

test('themeCss carries the type tokens', () => {
  assert.ok(themeCss(loadTheme('paper')).includes('--fs-base:17px'));
});
```

```js
// bin/test/style-lint.test.mjs — guards templates against ad-hoc underlines and unbundled fonts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const SOURCES = ['make-explainer/template/base.css', 'make-explainer/template/slides.html', 'make-explainer/template/page.html',
  'make-diagram/template/viewer.html', 'make-diagram/scripts/lib/css.mjs', 'make-dashboard/template/page.html', 'make-motion/template/styles.css'];

export const findUnderlines = (css) => [...css.matchAll(/text-decoration(?:-line)?\s*:\s*[^;}]*underline/g)].map((m) => m[0]);
export const findFontFamilies = (css) => [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
const ALLOWED_FAMILY = /^(var\(--(font|font-display|mono)\)|inherit|monospace|ui-monospace|system-ui|sans-serif|serif)(,|$)/;

test('lint catches what it should (guardrail proof)', () => {
  assert.deepEqual(findUnderlines('a{text-decoration: underline}'), ['text-decoration: underline']);
  assert.equal(ALLOWED_FAMILY.test("'Comic Sans MS'"), false);
});

for (const rel of SOURCES) {
  test(`${rel}: no ad-hoc underline; fonts come from theme variables`, () => {
    const src = fs.readFileSync(path.join(SKILLS, rel), 'utf8');
    assert.deepEqual(findUnderlines(src), []);
    for (const fam of findFontFamilies(src)) assert.match(fam, ALLOWED_FAMILY, `${rel}: font-family ${fam}`);
  });
}
```

- [ ] **Step 2: Run** both → FAIL (no `type.mjs`; existing templates may fail the lint — that is the RED for the template edits).

- [ ] **Step 3: Implement `shared/type.mjs`**

```js
// plugins/portable-artifacts/shared/type.mjs
// One type scale and one link style for every page. Emitted by themeCss().
export const TYPE_TOKENS = {
  '--fs-xs': '12px', '--fs-sm': '14px', '--fs-base': '17px', '--fs-md': '21px', '--fs-lg': '27px', '--fs-xl': '34px',
  '--fs-hero': 'clamp(40px, 6vw, 60px)', '--lh-body': '1.6', '--lh-head': '1.15', '--lh-hero': '1.05',
  '--track-display': '-0.02em', '--track-hero': '-0.03em',
};

const PROSE_LINKS = '.prose a, p a, li a, td a, dd a, figcaption a';

export function typeCss() {
  const tokens = Object.entries(TYPE_TOKENS).map(([k, v]) => `${k}:${v}`).join(';');
  return [
    `:root{${tokens}}`,
    'a{color:var(--accent);text-decoration:none}',
    `${PROSE_LINKS}{text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:0.22em;text-decoration-color:var(--accent)}`,
    `@supports (color: color-mix(in srgb, red, red)){${PROSE_LINKS}{text-decoration-color:color-mix(in srgb, var(--accent) 45%, transparent)}}`,
    `${PROSE_LINKS.split(', ').map((s) => `${s}:hover`).join(', ')}{text-decoration-color:var(--accent)}`,
    ':focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.pa-label{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600}',
    'body{font-variant-numeric:tabular-nums}',
  ].join('\n');
}
```

  In `theme.mjs` `themeCss()`: import `typeCss` and append it as the last array element. Then edit the templates: body `font: var(--fs-base)/var(--lh-body) var(--font)`; `h1` `var(--fs-hero)`/`var(--lh-hero)`, `letter-spacing: var(--track-hero)`; section headings `var(--fs-lg)`/`var(--lh-head)`, `letter-spacing: var(--track-display)`; small labels (`.meta dt`, `thead th`, `.toc summary`, chips) use `.pa-label` values; prose max-width `66ch`; weights 400/600 only (editorial body 700 stays via theme). Diagram SVG text sizes in `sizes.mjs` are layout-measured — **do not change them** (only the viewer chrome uses tokens). The explainer's existing `a { color; text-underline-offset }` rule (base.css:5) and `.toc a`/`.anchor` `text-decoration:none` rules become redundant — delete them.
  `node bin/sync-shared.mjs`.

- [ ] **Step 4: Run** shared, bin and all skill suites → PASS. Explainer goldens cover body markup only, so CSS-only changes should not move them; if they move, stop and report.
- [ ] **Step 5: Look at it** — screenshot one page per skill light/dark/390 and view; confirm link underlines appear only inside paragraphs.
- [ ] **Step 6: Commit** (controller) — `feat(portable-artifacts): shared type scale and link rules`; push (end of Phase 2).

---

## Phase 3 — Explainer impact pass

### Task 10: Section labels, hero TL;DR, KPIs and rhythm

**Before writing code:** the implementer invokes `redesign-existing-projects` (design-router: redesign row; stack gate fails — no React/Tailwind) and runs its audit on `.scratch/` builds of the four example presets, then applies the changes below. Do not load any other design rulebook.

**Files:**
- Modify: `skills/make-explainer/scripts/lib/schema.mjs:57-60` (`section()` gains `label: text`)
- Modify: `skills/make-explainer/scripts/lib/page.mjs:118-139,163-178` (TOC uses `label ?? title`; eyebrow; hero TL;DR)
- Modify: `skills/make-explainer/scripts/lib/render/tldr.mjs`, `render/kpis.mjs` (classes only; markup shape stays)
- Modify: `skills/make-explainer/scripts/lib/slides.mjs:83-89` (label as slide eyebrow)
- Modify: `skills/make-explainer/template/base.css`, `template/page.html` (masthead → hero), `template/slides.html`
- Modify: `references/examples/*.explainer.json` (add `label` to every titled section), `references/schema.md`, `references/sections.md`, `SKILL.md` (Writing rules: "`label` ≤ 4 words for the contents list; `title` states the finding in ≤ 8 words")
- Test: `test/labels.test.mjs` (new); goldens regenerated

**Interfaces:**
- Produces: section field `label` (string); page DOM: `<p class="sec-eyebrow pa-label">Label</p>` immediately before `<h2 class="sec-title">`; TOC entries `<a href="#id">label ?? title</a>`; hero: when `sections[0].type === 'tldr'`, it renders inside `<header class="hero">` as `<div class="hero-tldr">…</div>` and is not repeated in `<main>`.

- [ ] **Step 1: Write the failing tests**

```js
// skills/make-explainer/test/labels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const doc = (sections) => ({ title: 'T', sections });
const text = (title, label) => ({ type: 'text', title, ...(label ? { label } : {}), text: 'Short paragraph.' });
async function html(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-labels-'));
  const file = path.join(dir, 's.explainer.json');
  const out = path.join(dir, 's.html');
  fs.writeFileSync(file, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [BUILD, file, '--out', out], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return fs.readFileSync(out, 'utf8');
}

test('TOC uses label when present, title otherwise', async () => {
  const h = await html(doc([text('Haiku passed all thirty prompts', 'Eval results'), text('Second'), text('Third'), text('Fourth')]));
  assert.match(h, /<nav class="toc"[\s\S]*>Eval results<\/a>[\s\S]*>Second<\/a>/);
});

test('label renders as an eyebrow above the heading', async () => {
  const h = await html(doc([text('Finding', 'Context')]));
  assert.match(h, /<p class="sec-eyebrow pa-label">Context<\/p>\s*<h2 class="sec-title"/);
});

test('a leading tldr renders in the hero, once', async () => {
  const h = await html(doc([{ type: 'tldr', text: 'Lead.', points: ['a', 'b'] }, text('Next')]));
  assert.match(h, /<header class="hero"[\s\S]*class="hero-tldr"[\s\S]*Lead\.[\s\S]*<\/header>/);
  assert.equal(h.match(/Lead\./g).length, 1);
});

test('a tldr that is not first stays in the flow', async () => {
  const h = await html(doc([text('First'), { type: 'tldr', text: 'Later.' }]));
  assert.doesNotMatch(h, /class="hero-tldr"/);
});
```

- [ ] **Step 2: Run** → FAIL (`label` rejected by the closed schema; no eyebrow).

- [ ] **Step 3: Implement** — schema `label: text`; `renderToc` uses `entry.label ?? entry.title`; `renderSection` emits the eyebrow when `label` is set; `pageParts` lifts a leading tldr into the hero (rename `.masthead` → `.hero`, keep `.mast-text` content; meta `<dl>` styled as chips). CSS per the spec: hero title `var(--fs-hero)`; `.hero-tldr` card with `var(--fs-md)` lead, 3px accent left rule, `var(--surface)` background; `.kpi-value` `var(--fs-xl)`; `.sec + .sec { margin-top: 96px }` (remove the divider border); `.sec-kpis, .sec-cards, .sec-compare, .sec-diagram, .sec-chart` get `background: var(--surface); border-radius: 16px; padding: 32px` alternating via `:nth-of-type`-free class toggling in `pageParts` (add `sec-alt` to every second visual section); TOC current item `box-shadow: inset 2px 0 0 var(--accent)`. Add `label` to every titled section in the four `references/examples/*.explainer.json`.

- [ ] **Step 4: Run** `npm test`; inspect golden diffs (hero/eyebrow/TOC only), then `UPDATE_GOLDEN=1 node --test test/golden.test.mjs`; `npm test` → PASS. Run `node scripts/check.mjs` on each example build (1440 + 390) → no overflow.

- [ ] **Step 5: Look at it** — before/after screenshots (light, dark, 390) of the recap and concept examples saved to `.scratch/explainer-before|after/`; view both sets side by side. The after set must read: hero → TL;DR → KPIs without scrolling at 1440×900.

- [ ] **Step 6: Commit** (controller) — `feat(make-explainer): section labels, hero TL;DR and section rhythm` with golden-regeneration note.

---

### Task 11: Soft text caps and leaner scaffold

**Files:**
- Create: `skills/make-explainer/scripts/lib/budget.mjs`
- Modify: `skills/make-explainer/scripts/lib/lint.mjs:100-105` (retire `PARAGRAPH_WORDS` 120 paragraph warning — superseded by `budget.mjs`), `scripts/lib/spec.mjs:138` (add `...warnBudget(spec)` to warnings)
- Modify: `skills/make-explainer/scripts/lib/presets.mjs:21-115` (emit `label` TODOs, shorter TODO prompts)
- Modify: `SKILL.md` Workflow step 3 ("resolve budget warnings before building where you can; report any you leave"), `references/style.md`
- Test: `test/budget.test.mjs` (new), extend `test/scaffold.test.mjs`

**Interfaces:**
- Produces: `SOFT_CAPS = { titleWords: 8, labelWords: 4, paragraphWords: 60, paragraphSentences: 3, textSectionWords: 120, cardWords: 30, itemWords: 20, pageWords: 900, tldrPoints: 3 }`; `warnBudget(spec): Array<{ path: string, message: string }>`; `words(s): number`; `sentences(s): number`.
- Prose = strings under keys `text`, `lead`, `body`, `note`, `points[]`, `items[]` (string items or `.text`), card `body`/`points`; excluded: section types `code`, `table`, `files`, `timeline`, `checklist`, `diagram`, `chart`, `motion`, `image`, and keys `id`, `type`, `tone`, `severity`, `lang`, `src`, `href`, `label`, `title`. Paragraphs = prose strings split on blank lines.

- [ ] **Step 1: Write the failing tests**

```js
// skills/make-explainer/test/budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOFT_CAPS, warnBudget, words, sentences } from '../scripts/lib/budget.mjs';

const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const spec = (sections) => ({ title: 'T', sections });
const paths = (s) => warnBudget(s).map((x) => x.path);

test('counting helpers', () => {
  assert.equal(words('one two  three'), 3);
  assert.equal(sentences('One. Two! Three? e.g. not split'), 3);
});

test('title: 8 words silent, 9 warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', id: 'a', title: w(8), text: 'x' }])), []);
  assert.deepEqual(paths(spec([{ type: 'text', id: 'a', title: w(9), text: 'x' }])), ['/sections/0/title']);
});

test('label: 4 silent, 5 warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', label: w(5), text: 'x' }])), ['/sections/0/label']);
});

test('paragraph: 60 words silent, 61 warns; 4 sentences warns', () => {
  assert.deepEqual(paths(spec([{ type: 'text', title: 'T', text: w(60) }])), []);
  assert.ok(paths(spec([{ type: 'text', title: 'T', text: w(61) }])).includes('/sections/0/text'));
  assert.ok(paths(spec([{ type: 'text', title: 'T', text: 'A. B. C. D.' }])).includes('/sections/0/text'));
});

test('text section over 120 words warns even when every paragraph is short', () => {
  const text = [w(50), w(50), w(30)].join('\n\n');
  assert.ok(warnBudget(spec([{ type: 'text', title: 'T', text }])).some((x) => /120 words/.test(x.message)));
});

test('card body over 30, list item over 20, tldr over 3 points warn', () => {
  assert.ok(paths(spec([{ type: 'cards', title: 'T', cards: [{ title: 'c', body: w(31) }] }])).includes('/sections/0/cards/0/body'));
  assert.ok(paths(spec([{ type: 'text', title: 'T', text: 'x', points: [w(21)] }])).includes('/sections/0/points/0'));
  assert.ok(paths(spec([{ type: 'tldr', text: 'x', points: ['a', 'b', 'c', 'd'] }])).includes('/sections/0/points'));
});

test('page over 900 words of prose warns once at the root', () => {
  const sections = Array.from({ length: 10 }, () => ({ type: 'text', title: 'T', text: w(55) + '.\n\n' + w(40) + '.' }));
  assert.deepEqual(warnBudget(spec(sections)).filter((x) => x.path === '').length, 1);
});

test('code, tables and file lists are not prose', () => {
  assert.deepEqual(paths(spec([{ type: 'code', title: 'T', code: w(500) }])), []);
});

test('every warning suggests a conversion', () => {
  for (const x of warnBudget(spec([{ type: 'text', title: 'T', text: w(200) }]))) assert.match(x.message, /→|cards|steps|split/);
});

test('the four shipped examples are inside the caps', async () => {
  const fs = await import('node:fs');
  for (const n of ['recap', 'checklist', 'concept', 'slides']) {
    const s = JSON.parse(fs.readFileSync(new URL(`../references/examples/${n}.explainer.json`, import.meta.url)));
    assert.deepEqual(warnBudget(s), [], n);
  }
});
```

Field names (`cards[].body`, `points`, `code`) must match `SECTION_SCHEMAS` (schema.mjs:62-126) — check and adjust the fixtures before running. Validator CLI test (extend `test/validate-cli.test.mjs`): a spec with a 9-word title prints `…/title: warning: …` and exits 0.

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement `budget.mjs`** with the interface above; each warning message names the cap and a conversion, e.g. `title is 9 words; keep it to 8 — state the finding, move detail into the text`, `paragraph is 74 words; keep it under 60 → split it, or turn it into cards or steps`, `page has 1,240 words of prose; aim for 900 → cut, or convert sections to kpis, cards or steps`. Wire into `spec.mjs:138`, retire the old 120-word paragraph lint (update its tests in `test/lint.test.mjs` accordingly — the behaviour moves, it is not lost). Edit the four examples until `warnBudget` returns `[]`. `presets.mjs`: every titled TODO section gains `label: 'TODO: 2-4 word label'`; TODO prompts read `TODO: one finding, ≤ 8 words` etc.
- [ ] **Step 4: Run** `npm test` → PASS; `test/build.test.mjs` exact-stdout tests still pass (core fixture inside caps — if not, shorten the fixture, do not loosen the assertion). Regenerate goldens only if examples' text changed them, with a note.
- [ ] **Step 5: Commit** (controller) — `feat(make-explainer): soft text caps and leaner scaffold`; push (end of Phase 3).

---

## Phase 4 — Doctor

### Task 12: `shared/doctor.mjs` library

**Files:**
- Create: `shared/doctor.mjs`, `shared/test/doctor.test.mjs`

**Interfaces:**
- `ctx` (injectable; defaults from the real process): `{ platform, env, skillDir, exists(p): boolean, which(cmd): boolean, nodeVersion: string }`
- Requirement shape: `{ id, why, required: boolean, size: string, check(ctx): boolean|Promise<boolean>, fix(ctx): { auto: string[][]|null, manual: { darwin: string, linux: string, win32: string } }, needsSudo(ctx): boolean }`
- Factories and the ids they report: `nodeVersion(min = 20)` → `node` (required); `nodeModules({ omitDev = true } = {})` → `node_modules` (required); `sisterSkill(name)` → `<name>` (required when asked for); `ffmpeg()` → `ffmpeg` (required); `browser({ required = false } = {})` → `chromium`; `kokoro()` → `kokoro` (optional)
- `diagnose(requirements, ctx): Promise<{ ok: boolean, missing: Array<{ id, why, required, size, fix: { auto: string|null, manual }, needsSudo }> }>` — `auto` is rendered as one display string (`a b c && d e`); `ok` = no **required** item missing.
- `runFixes(ids, requirements, ctx, run = defaultRun): Promise<Array<{ id, ok, ran?: string, refused?: string, manual?: string }>>` — runs each `auto` argv array in order with `spawnSync(cmd, args, { stdio: 'inherit', shell: ctx.platform === 'win32' })`; refuses ids not in `requirements`, ids with `needsSudo`, ids with no `auto`.
- `doctorMain(argv, { skill, skillDir, requirementsFor(target): Requirement[] }): Promise<void>` — CLI: `[--json] [--for <spec.json|voiceover|check>]` or `--fix <id[,id]>`; exit 0 ok / 1 required missing or a fix failed / 2 usage (unknown flag lists accepted ones via `parseCli`).

Fix table (spec §4): `node_modules` → `[['npm','ci','--omit=dev','--prefix',skillDir]]` (`omitDev: false` drops `--omit=dev`, used by make-motion); sister → `[['npx','skills','add','abhijitbansal/claude-skills','--skill',name,'-y', …(global ? ['-g'] : [])], ['npm','ci','--omit=dev','--prefix',sisterDir]]` where `global` = skillDir is under `os.homedir()` and not under `process.cwd()`; ffmpeg darwin `[['brew','install','ffmpeg']]` only when `which('brew')`, win32 `[['winget','install','Gyan.FFmpeg']]`, linux `null` + `needsSudo` (manual `sudo apt-get install ffmpeg`); browser `[['npx','playwright','install','chromium']]` run with `cwd: skillDir` (store as `['npx','--prefix',skillDir,'playwright','install','chromium']`); kokoro `[['npm','install','kokoro-js@1.2.1','--no-save','--prefix',skillDir]]`. Presence checks: ffmpeg = `env.FFMPEG_PATH` exists, or `which('ffmpeg')`, or `exists(skillDir/node_modules/ffmpeg-static)`; browser = Playwright's chromium dir exists (`exists(skillDir/node_modules/playwright-core)` and a dynamic `import()` of `playwright` resolving `chromium.executablePath()` that exists) or a system Chrome at the platform's standard path; kokoro = `exists(skillDir/node_modules/kokoro-js)`.

**Before Step 3:** verify `npx skills add … -y` installs non-interactively next to an existing skill: run it with `HOME=$(mktemp -d)` in a temp project and confirm where it writes and that it never prompts. If it prompts or lands elsewhere, set sister `auto` to `null` (manual only) and note it in the commit body.

- [ ] **Step 1: Write the failing tests**

```js
// shared/test/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeVersion, nodeModules, sisterSkill, ffmpeg, kokoro, diagnose, runFixes } from '../doctor.mjs';

const ctx = (over = {}) => ({
  platform: 'darwin', env: {}, skillDir: '/s/make-motion', nodeVersion: '24.7.0',
  exists: () => false, which: () => false, ...over,
});

test('node version below the floor is a required miss', async () => {
  const r = await diagnose([nodeVersion(20)], ctx({ nodeVersion: '18.19.0' }));
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].id, 'node');
});

test('guardrail proof: a stub that reports everything present yields ok', async () => {
  const r = await diagnose([nodeModules(), ffmpeg(), kokoro()], ctx({ exists: () => true, which: () => true }));
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('ffmpeg missing, no brew: manual command only', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx());
  assert.equal(missing[0].id, 'ffmpeg');
  assert.equal(missing[0].fix.auto, null);
  assert.match(missing[0].fix.manual.darwin, /brew install ffmpeg/);
});

test('ffmpeg missing, brew present: auto is brew install ffmpeg', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ which: (c) => c === 'brew' }));
  assert.equal(missing[0].fix.auto, 'brew install ffmpeg');
});

test('Windows: winget is the auto fix', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ platform: 'win32' }));
  assert.equal(missing[0].fix.auto, 'winget install Gyan.FFmpeg');
});

test('Linux: ffmpeg needs sudo and has no auto fix', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ platform: 'linux' }));
  assert.equal(missing[0].needsSudo, true);
  assert.equal(missing[0].fix.auto, null);
  assert.equal(missing[0].fix.manual.linux, 'sudo apt-get install ffmpeg');
});

test('FFMPEG_PATH that exists counts as present', async () => {
  const r = await diagnose([ffmpeg()], ctx({ env: { FFMPEG_PATH: '/x/ffmpeg' }, exists: (p) => p === '/x/ffmpeg' }));
  assert.equal(r.ok, true);
});

test('sister skill: missing folder is reported with its install command', async () => {
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer' }));
  assert.equal(missing[0].id, 'make-diagram');
  assert.match(missing[0].fix.auto, /npx skills add abhijitbansal\/claude-skills --skill make-diagram -y/);
});

test('optional misses do not flip ok', async () => {
  const r = await diagnose([kokoro()], ctx());
  assert.equal(r.ok, true);
  assert.equal(r.missing[0].required, false);
});

test('runFixes runs only requested auto fixes and refuses sudo and unknown ids', async () => {
  const ran = [];
  const run = (cmd, args) => { ran.push([cmd, ...args].join(' ')); return { status: 0 }; };
  const reqs = [ffmpeg(), kokoro()];
  const res = await runFixes(['kokoro', 'ffmpeg', 'nope'], reqs, ctx({ platform: 'linux' }), run);
  assert.deepEqual(ran, ['npm install kokoro-js@1.2.1 --no-save --prefix /s/make-motion']);
  assert.equal(res.find((r) => r.id === 'ffmpeg').refused, 'needs sudo');
  assert.match(res.find((r) => r.id === 'ffmpeg').manual, /sudo apt-get install ffmpeg/);
  assert.equal(res.find((r) => r.id === 'nope').refused, 'unknown id');
});

test('a failing fix reports ok:false', async () => {
  const res = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: 1 }));
  assert.equal(res[0].ok, false);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `shared/doctor.mjs`** to the interface and fix table above (builtins only: `node:fs`, `node:os`, `node:path`, `node:child_process`, `./cli.mjs`). `defaultCtx(skillDir)` uses `fs.existsSync`, `which` via `spawnSync(platform === 'win32' ? 'where' : 'which', [cmd]).status === 0`. `doctorMain` text output: one line per missing item — `missing (required): ffmpeg — renders the MP4 (≈80 MB). Run: brew install ffmpeg` — and `ok: everything make-motion needs is installed` when clean.
- [ ] **Step 4: Run** shared tests → PASS; `node bin/sync-shared.mjs`.
- [ ] **Step 5: Commit** (controller) — `feat(portable-artifacts): shared doctor for missing dependencies`

---

### Task 13: Per-skill doctor wrappers and SKILL.md preflight

**Files:**
- Create: `skills/<skill>/scripts/doctor.mjs` for all four skills
- Modify: `skills/make-explainer/scripts/lib/render/diagram.mjs:24` and its chart/motion siblings' `loadSibling` error, `skills/make-motion/scripts/lib/ffmpeg.mjs:4-5` (HINT), `skills/make-motion/scripts/lib/browser.mjs:3`, `skills/make-motion/scripts/lib/voice.mjs:21-22` — append `(doctor: node <skill-dir>/scripts/doctor.mjs)` naming the doctor id
- Modify: all four `SKILL.md` — replace the "First use" paragraphs (dashboard 22-23, diagram 17, explainer 17, motion 15-20) with the shared preflight block below; motion's "Never install system packages yourself" is removed
- Test: `skills/<skill>/test/doctor.test.mjs` for each skill

**Interfaces:** Wrapper template (make-explainer shown; others differ only in `skill` and `requirementsFor`):

```js
#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorMain, nodeVersion, nodeModules, sisterSkill, browser } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SECTION_SISTERS = { diagram: 'make-diagram', chart: 'make-dashboard', motion: 'make-motion' };

function sistersFor(specFile) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const types = new Set((spec.sections ?? []).map((s) => s?.type));
  return Object.entries(SECTION_SISTERS).filter(([t]) => types.has(t)).map(([, name]) => sisterSkill(name));
}

await doctorMain(process.argv.slice(2), {
  skill: 'make-explainer',
  skillDir: SKILL_DIR,
  requirementsFor: (target) => [
    nodeVersion(20),
    nodeModules(),
    ...(target === 'check' ? [browser()] : []),
    ...(target?.endsWith('.json') ? sistersFor(target) : []),
  ],
});
```

make-motion: `[nodeVersion(20), nodeModules({ omitDev: false }), ffmpeg(), browser({ required: true }), ...(target === 'voiceover' ? [kokoro()] : [])]`. make-diagram / make-dashboard: `[nodeVersion(20), nodeModules(), ...(target === 'check' ? [browser()] : [])]`. `--for` accepts only `check`, `voiceover` (motion) or an existing `*.json` path; anything else exits 2 listing them.

SKILL.md preflight block (identical wording in all four; replaces "First use"):

```markdown
## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, `--for voiceover` for a voiceover, `--for check` before `check.mjs`). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command. Ask once. On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>`. Anything it refuses (it needs sudo) or that fails, give the user the exact command to run themselves; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.
```

- [ ] **Step 1: Write the failing tests** (make-explainer shown; one per skill with its own assertions):

```js
// skills/make-explainer/test/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const run = (cwdSkill, args) => spawnSync(process.execPath, [path.join(cwdSkill, 'scripts/doctor.mjs'), ...args], { encoding: 'utf8' });

test('runs on a fresh copy with no node_modules and reports it missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fresh-'));
  const copy = path.join(dir, 'make-explainer');
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  const r = run(copy, ['--json']);
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.missing.find((m) => m.id === 'node_modules').required, true);
});

test('--for spec.json asks for the sister skills its sections need', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-spec-'));
  const file = path.join(dir, 'x.explainer.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'T', sections: [{ type: 'diagram' }, { type: 'text' }] }));
  const out = JSON.parse(run(SKILL, ['--json', '--for', file]).stdout);
  const ids = out.missing.map((m) => m.id);
  assert.equal(ids.includes('make-dashboard'), false);
  // make-diagram is present beside this skill in the repo, so it must NOT be missing:
  assert.equal(ids.includes('make-diagram'), false);
});

test('unknown argument exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json|--for|--fix/);
});
```

make-motion test additionally: with `PATH` set to an empty temp dir and no `FFMPEG_PATH`, `--json` reports `ffmpeg` as required-missing (guardrail: first confirm the same test passes with the real PATH on this machine, where ffmpeg exists).

- [ ] **Step 2: Run** each → FAIL.
- [ ] **Step 3: Implement** the four wrappers, the SKILL.md block, and the hint suffixes.
- [ ] **Step 4: Run** all four suites + shared + `sync-shared --check` → PASS. Live check on this machine: `node skills/make-motion/scripts/doctor.mjs` → `ok`; `node skills/make-motion/scripts/doctor.mjs --for voiceover --json` → reports `kokoro` if absent.
- [ ] **Step 5: Commit** (controller) — `feat(portable-artifacts): per-skill doctor and consented install flow`; push (end of Phase 4).

---

## Phase 5 — Portability

### Task 14: Portability lint and install-target audit

**Files:**
- Create: `plugins/portable-artifacts/bin/test/portability.test.mjs`
- Modify: four `SKILL.md` files only as the lint requires
- Modify: `plugins/portable-artifacts/bin/install.mjs:18-24` and `bin/test/install.test.mjs:23-36` only if a host's documented path has drifted
- Create: `plugins/portable-artifacts/eval/results/install-targets-2026-10-14.md` (sources for each host path, with URLs and access date)

**Interfaces:** Complements `bin/test/frontmatter.test.mjs` (already enforces single-line frontmatter, `name` = folder, description 41–1024 chars — do not duplicate those checks).

- [ ] **Step 1: Write the failing test**

```js
// plugins/portable-artifacts/bin/test/portability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const HOST_ONLY = [/AskUserQuestion/, /TodoWrite/, /\bSkill\(/, /\bTask tool\b/, /\bsubagent\b/i, /~\/\.claude\b/];
const BASH_ONLY = [/\$\(/, /2>\/dev\/null/, /\|\s*grep\b/, /^\s*export\s+\w+=/m, /\bsource\s+\S+/];
const SKILL_DIR_LINE = '`<skill-dir>` is the folder containing this SKILL.md.';

// Commands the agent runs: fenced blocks plus inline code that starts with node/npm/npx.
export function commands(md) {
  const fenced = [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const inline = [...md.matchAll(/`((?:node|npm|npx) [^`]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline];
}

export function problems(md) {
  const out = [];
  for (const re of HOST_ONLY) if (re.test(md)) out.push(`host-only: ${re}`);
  for (const cmd of commands(md)) for (const re of BASH_ONLY) if (re.test(cmd)) out.push(`bash-only in "${cmd.trim().slice(0, 60)}": ${re}`);
  if (!md.includes(SKILL_DIR_LINE)) out.push('missing the <skill-dir> definition line');
  return out;
}

test('guardrail proof: a bad SKILL.md trips every rule', () => {
  const bad = 'Use AskUserQuestion. Save to ~/.claude/x.\n```\nnode a.mjs $(pwd) 2>/dev/null | grep x\n```\n';
  const p = problems(bad);
  assert.ok(p.some((x) => x.includes('AskUserQuestion')));
  assert.ok(p.some((x) => x.includes('.claude')));
  assert.ok(p.some((x) => x.includes('$\\(')));
  assert.ok(p.some((x) => x.includes('<skill-dir>')));
});

for (const skill of fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))) {
  test(`${skill}/SKILL.md is host-neutral`, () => {
    assert.deepEqual(problems(fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8')), []);
  });
}
```

- [ ] **Step 2: Run** `node --test "test/portability.test.mjs"` in `bin` → FAIL at least on the `<skill-dir>` line (Task 13's block already contains it — if every skill passes, the guardrail test still proves the lint fires).
- [ ] **Step 3: Fix** any SKILL.md hits. Research each host's current skill locations (Codex `~/.agents/skills` / `.agents/skills`; Copilot CLI `~/.copilot/skills` / `.github/skills`; Gemini CLI `~/.gemini/skills` + `.gemini/commands`) against official docs via WebSearch/WebFetch; record URL + quote + date per host in `eval/results/install-targets-2026-10-14.md`. Change `install.mjs` HOSTS and its test only where the docs disagree.
- [ ] **Step 4: Run** bin tests → PASS.
- [ ] **Step 5: Commit** (controller) — `test(portable-artifacts): portability lint for SKILL.md and verified install targets`

---

### Task 15: Live Copilot CLI run

**Files:**
- Create: `plugins/portable-artifacts/eval/results/summary-portability-copilot-2026-10-14.md`
- Scratch: `.scratch/copilot-run/` (gitignored)

- [ ] **Step 1: Confirm the CLI** — `copilot --help` and `copilot --version`; find the non-interactive prompt flag and the tool-approval flag (expected `-p "<prompt>"` and `--allow-all-tools`; use what `--help` says). Record the version.
- [ ] **Step 2: Install into a throwaway project** — `mkdir -p .scratch/copilot-run && cd .scratch/copilot-run && git init -q && node ../../plugins/portable-artifacts/bin/install.mjs copilot --project .` (do not touch `~/.copilot`). Copy `skills/make-dashboard/test/fixtures/<sales csv>` (pick the CSV the dashboard example uses) to `data/sales.csv`.
- [ ] **Step 3: Run one prompt per skill** from `.scratch/copilot-run`, each with a timeout of 15 minutes, capturing stdout/stderr to `logs/<skill>.log`:
  1. `/make-dashboard revenue by region and the monthly trend from data/sales.csv`
  2. `/make-diagram the checkout request path from the browser to the orders DB`
  3. `/make-explainer a concept explainer of how a request moves through a CDN`
  4. `/make-motion a 6 second title card that counts up to 18`
- [ ] **Step 4: Score each run** (measured): skill picked up (log shows SKILL.md read); doctor run; `generatedBy.agent` set (grep the spec); validate + build exit 0; `check.mjs` on the page (dashboard/diagram/explainer) exits 0; motion: MP4 exists and `ffprobe` shows the `comment` tag. Write the table, the exact commands, Copilot version, and every failure verbatim to the results file. Do not retry a failing run more than once; record both.
- [ ] **Step 5: Fix or file** — a failure caused by SKILL.md wording gets a fix + rerun (record both runs); anything else is recorded as a known gap.
- [ ] **Step 6: Commit** (controller) — `docs(portable-artifacts): live Copilot CLI portability results`; push (end of Phase 5).

---

## Phase 6 — Gallery, docs, review

### Task 16: Rebuild the gallery and refresh docs and site

**Files:**
- Modify: every spec + output under `docs/features/showcase/portable-artifacts/gallery/*/` (dashboards: product-performance, support-ops, traffic-deep-dive; diagrams: pipeline-diagram, delivery-diagram, oauth-sequence, incident-flow; explainers: explainer-page, explainer-deck; motion: launch-announcement, quarterly-highlights-square, sql-guard-explainer) and their `thumb.jpg`
- Modify: `docs/features/portable-artifacts.html` (gallery note, feature rows for doctor/provenance/toggle, tested-hosts line), `docs/img/portable-artifacts/*` screenshots, `plugins/portable-artifacts/USAGE.md`, `plugins/portable-artifacts/README.md`, `site/index.html` if copy changes

- [ ] **Step 1: Set provenance from the existing gallery note** (do not invent): dashboards and motion → `{ model: 'Claude Sonnet', agent: 'Claude Code' }` (effort not recorded → omit); explainers and all four diagrams → `{ model: 'Claude Haiku', effort: 'low', agent: 'Claude Code' }`. Use `--model/--effort/--agent` flags at build time rather than editing the specs, except the explainers, whose specs gain hand-written `label`s (Task 10) — the gallery note says so.
- [ ] **Step 2: Rebuild** each page with its skill's `build.mjs`; re-render each motion clip with `render.mjs` (fonts changed) and regenerate any GIF/MP4 the page references; regenerate every `thumb.jpg` at 1280×720 with a Playwright script in `.scratch/` (light scheme, reduced motion). View each thumb.
- [ ] **Step 3: Docs** — USAGE.md: provenance flags, doctor, toggle, labels and soft caps per skill; feature page: per-line copy buttons for every new command (`.code.cmds` > `.cl` > `code.ct` + `button.copy[data-copy]`, no `# comment` in `data-copy`); tested-hosts sentence from Task 15's measured results.
- [ ] **Step 4: Verify** — stage the site per `.github/workflows/pages.yml`, link-check, screenshot the feature page light/dark/390 and view.
- [ ] **Step 5: Commit** (controller) — `docs(portable-artifacts): rebuild gallery and docs with the new look`; push.

---

### Task 17: Phase-gate review and manual-test checklist

- [ ] **Step 1: Review** — dispatch an Opus 5 reviewer at medium effort, report only (never writes files, never commits), over `git diff main...HEAD -- plugins/portable-artifacts docs/features`, with the verbatim report-everything sentence from `~/.claude/rules/ecc/common/code-review.md` and the security lens (provenance escaping, doctor command execution, `--fix` scope).
- [ ] **Step 2: Gate** — fix every CRITICAL/HIGH (each fix: failing test → fix → green → commit); MEDIUM/LOW → fix or list as follow-ups in the PR body.
- [ ] **Step 3: Checklist** — `.scratch/feat-diagram-stories-test-checklist.html` (+ `.md` twin) per global CLAUDE.md: localStorage-persisted checkboxes keyed by branch, sticky progress bar, per-section tallies, reset, `<details open>` "What's in this branch". Human-only items: favicon visible in Chrome/Safari/Firefox tabs light and dark; toggle in Safari private window; dashboard charts recolour on toggle; diagram toggle hidden in full screen; slides print footer; doctor `--fix` on a machine without ffmpeg; Copilot run reproduction; Windows doctor output if a Windows machine is available. Regression tags for every review-cycle fix.
- [ ] **Step 4: Commit and push** (controller); send the checklist to the user.
