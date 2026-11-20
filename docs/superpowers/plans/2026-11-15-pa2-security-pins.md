# portable-artifacts security pins and trims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dependency make-motion installs or downloads is locked by a committed lockfile or pinned to a commit plus SHA-256, and standing tests keep it that way.

**Architecture:** The voiceover and cutout stacks move into two locked packages, `make-motion/optional/voice/` and `optional/cutout/`. The doctor installs each with `npm ci --prefix <folder>`, and the scripts load it through an ESM entry file in that folder, imported by file URL. kokoro-js 1.2.1 never passes a `revision` to transformers.js, so we download the four Kokoro files ourselves at a pinned commit with a SHA-256 check on each, and point transformers.js at that folder with remote loading and its file cache off; ffmpeg-static is dropped in favour of system ffmpeg or `FFMPEG_PATH`.

**Tech Stack:** Node 20+ ESM, `node:test`, npm lockfile v3, @huggingface/transformers 3.x `env`, bash (audit script).

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md` (section 11, section 15 step 1).

## Global Constraints

- `<repo>` = `/Users/abhijitbansal/projects/claude-skills/.claude/worktrees/New-Motion`. `P` = `plugins/portable-artifacts`, `M` = `plugins/portable-artifacts/skills/make-motion` (both relative to `<repo>`).
- Line ranges are as of the base commit, before Task 1. Where an earlier task has already shifted a file, the step also names the symbol or test title. Find the site by that name.
- Node 20+. The scripts must run offline after install. Exact versions only: no `^`, `~`, ranges, tags, git or URL specs.
- Write the test first and watch it fail before you implement. Files stay under 800 lines and functions under 50.
- Commit message format: `<type>: <description>`, ending with the one trailer from AGENTS.md (`Co-Authored-By: Claude <noreply@anthropic.com>`). Never commit to `main`. The orchestrator commits.
- Guarded worktree shell rules (AGENTS.md "Shell rules"): one plain command per call, absolute paths, and `npm --prefix <abs dir> …` instead of `cd … &&`. Test commands run from the directory named in the step.
- Run only one browser-heavy run at a time. Run `pgrep -fl chrome-headless-shell` before any make-motion suite that renders (cutout and voice model tests launch Chromium).
- After any edit under `P/shared/`, run `node bin/sync-shared.mjs` from `P`, then `node bin/sync-shared.mjs --check`. Stage all five `P/skills/<skill>/shared/doctor.mjs` copies.
- Network is needed only in the steps marked **(network)**. Every other step works offline.

## Review Focus

1. **A truncated or partial model file at the cache path.** Causes: a killed download, or the old transformers cache, which already uses the same layout, `.cache/models/onnx-community/Kokoro-82M-v1.0-ONNX/`. Pinned by Task 2 "replaces a truncated file and ignores a stray partial" and by Task 5 "reuses a cached file only when its hash matches".
2. **A hash mismatch from the server.** Pinned by Task 2 "keeps nothing on a sha256 mismatch" and by Task 5 "one bad file fails the load and names it".
3. **An old `npm install --no-save` tree in `<skill>/node_modules`.** Node's resolver walks up from `optional/voice/` and would find it. Pinned by Task 4 "an old in-skill install does not count", by Task 4 "the loader never falls back to the skill's own node_modules", and by the Task 4 real pre-pin proof.
4. **No network.** Two cases: `--fix kokoro` while offline, and the first voiceover run while offline. Pinned by Task 4 "offline: a failed npm ci reports that command and runs nothing else", by Task 5 "offline first use names the URL and keeps nothing", and by Task 5 "synthesises with fetch disabled" (no second, unpinned transformers `env`).
5. **Windows paths.** Pinned by Task 4 "win32: one npm ci with the backslash folder quoted" and by Task 4 "loads through a file URL when the path has a space and a #".

### Task 1: Remove the unused Fontsource packages from make-motion

**Files:** Create `M/test/dependencies.test.mjs`. Modify `M/package.json:15-16`, `M/package-lock.json` (regenerated), `P/README.md:320` (delete the Inter row), `M/README.md:256-258`.
**Interfaces:** Consumes nothing. Produces nothing. This task changes only the manifest.

- [ ] Confirm nothing reads them: `grep -rn fontsource <repo>/M/scripts <repo>/M/template <repo>/M/SKILL.md <repo>/M/references`. Expected: only `template/sketch/LICENSES:5` (Caveat, a different, vendored package).
- [ ] Write the failing test in `M/test/dependencies.test.mjs`:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const SKILL = fileURLToPath(new URL('..', import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(SKILL, f), 'utf8'));
test('make-motion declares no unused font package in package.json or its lockfile', () => {
  for (const name of ['@fontsource/inter', '@fontsource/jetbrains-mono']) {
    assert.equal(json('package.json').dependencies[name], undefined, name);
    assert.equal(json('package-lock.json').packages[`node_modules/${name}`], undefined, name);
  }
});
```
- [ ] From `M`, run `node --test test/dependencies.test.mjs`. Expected: FAIL, `'5.3.0' !== undefined` for `@fontsource/inter`.
- [ ] **(network)** Run `npm --prefix <repo>/M uninstall @fontsource/inter @fontsource/jetbrains-mono --package-lock-only --ignore-scripts`. Delete row 320 of `P/README.md`. In `M/README.md:256-258`, replace "The `@fontsource/inter` and `@fontsource/jetbrains-mono` npm packages are still pinned but no longer read: the default look now comes from `dusk`" with "The default look comes from `dusk`". Keep the rest of the sentence.
- [ ] From `M`, run `node --test test/dependencies.test.mjs`. Expected: PASS. Then run `npm --prefix <repo>/M install --package-lock-only --ignore-scripts` and `git -C <repo> diff --stat`. Expected: no further change to `M/package-lock.json`.
- [ ] `git add M/package.json M/package-lock.json M/test/dependencies.test.mjs P/README.md M/README.md` and commit `chore: remove unused fontsource packages from make-motion`.

### Task 2: Share the pinned, hash-checked download

**Files:** Create `M/scripts/lib/pinned-file.mjs` and `M/test/pinned-file.test.mjs`. Modify `M/scripts/lib/cutout.mjs:35` (move `DOWNLOAD_SLACK`) and `M/scripts/lib/cutout.mjs:120-156` (`readLimited` and the body of `ensureModel`).
**Interfaces:** Consumes the existing `cutout.ensureModel` body and its tests. Produces `ensurePinnedFile({ url, sha256, bytes, file, label, fetchImpl = fetch, log = () => {} }) -> Promise<string>`. It returns `file`, an absolute path whose bytes hash to `sha256`. It imports node built-ins only. `cutout.ensureModel(opts)` keeps its signature and its messages.

- [ ] Write the failing tests in `M/test/pinned-file.test.mjs`. Use `BYTES = Buffer.from('pinned bytes')` and `opts(dir, fetchImpl) = { url: 'https://example.invalid/f.bin', sha256: sha256(BYTES), bytes: BYTES.length, file: path.join(dir, 'sub', 'f.bin'), label: 'test file', fetchImpl }`. The tests:
  - `downloads once into a new folder, verifies, and never fetches again while the file is good`: two calls make one fetch; `readdirSync(dir/sub)` deep-equals `['f.bin']`.
  - `keeps nothing on a sha256 mismatch and names both hashes`: rejects `/sha256 mismatch for the test file from https:\/\/example\.invalid\/f\.bin: expected [0-9a-f]{64}, got [0-9a-f]{64}; nothing was kept/`; `existsSync(file)` is false.
  - `replaces a truncated file and ignores a stray partial`: pre-write `BYTES.subarray(0, 4)` to `file` and `'junk'` to `${file}.partial-999-abcd`. The result's bytes deep-equal `BYTES`.
  - `offline: a fetch that throws names the URL and keeps nothing`: rejects `/test file download failed: fetch failed \(https:\/\/example\.invalid\/f\.bin\); check the connection and rerun/`; `existsSync(file)` is false.
  - `refuses an HTTP error and a body over twice the expected size`: rejects `/test file download failed: HTTP 503 from/` and `/larger than the expected 12 bytes/`.
- [ ] From `M`, run `node --test test/pinned-file.test.mjs`. Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `pinned-file.mjs`.
- [ ] Implement. Move `readLimited`, `DOWNLOAD_SLACK` and the download, verify and rename logic of `ensureModel` into `ensurePinnedFile`. Create `path.dirname(file)` recursively. Hash with `createHash('sha256')` over `readFileSync`; do not import `video.mjs`, so the module stays a leaf. The messages: `${label} download failed: ${firstLine(e)} (${url}); check the connection and rerun`, `${label} download failed: HTTP ${status} from ${url}; rerun later`, `${label} download failed: the response from ${url} is larger than the expected ${bytes} bytes; nothing was kept`, and `sha256 mismatch for the ${label} from ${url}: expected …, got …; nothing was kept`. Log line: `downloading the ${label} (${Math.round(bytes / 1e6)} MB, once) from ${url}`. `ensureModel` becomes a single call: `ensurePinnedFile({ url, sha256, bytes, file: path.join(dir, MODEL_FILE), label: 'MODNet weights', fetchImpl, log: (l) => log(`cutout: ${l}`) })`. Every cutout.mjs import keeps a use (`createHash` in `cacheKey`, `randomBytes` in `cutoutVideo`).
- [ ] From `M`, run `node --test test/pinned-file.test.mjs test/cutout.test.mjs`. Expected: PASS. The existing `ensureModel` tests are the regression check.
- [ ] `git add M/scripts/lib/pinned-file.mjs M/scripts/lib/cutout.mjs M/test/pinned-file.test.mjs` and commit `refactor: share the pinned, hash-checked download between cutout and voice`.

### Task 3: Locked optional packages for voice and cutout

**Files:** Create `M/optional/voice/{package.json,package-lock.json,index.mjs}` and `M/optional/cutout/{package.json,package-lock.json,index.mjs}`. Modify `M/package.json:29-33` (overrides keep only `fast-uri`) and `M/test/dependencies.test.mjs` (append). Delete `M/test/doctor.test.mjs:206-213`, which this task supersedes.
**Interfaces:** Consumes the npm registry, for lockfile generation only. Produces `optional/voice/index.mjs`, which exports `KokoroTTS` and `TextSplitterStream` (from kokoro-js) and `env` and `RawAudio` (from @huggingface/transformers). Produces `optional/cutout/index.mjs`, which exports `default` (onnxruntime-node's module object).

- [ ] Append the failing tests to `M/test/dependencies.test.mjs`:
```js
const OPTIONAL = { voice: { deps: ['@huggingface/transformers', 'kokoro-js'], overrides: { sharp: '0.35.5', 'global-agent': '4.1.3' } },
  cutout: { deps: ['onnxruntime-node'], overrides: { 'global-agent': '4.1.3' } } };
for (const [name, want] of Object.entries(OPTIONAL)) {
  test(`optional/${name}: exact dependencies, its overrides, and a lockfile in step with them`, () => {
    const pkg = json(`optional/${name}/package.json`); const lock = json(`optional/${name}/package-lock.json`);
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), want.deps);
    assert.deepEqual(pkg.overrides, want.overrides);
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
    for (const [dep, v] of Object.entries(pkg.dependencies)) assert.equal(lock.packages[`node_modules/${dep}`].version, v);
  });
}
test('optional/voice locks one copy of @huggingface/transformers, shared by kokoro-js and index.mjs', () => {
  const keys = Object.keys(json('optional/voice/package-lock.json').packages).filter((k) => k.endsWith('node_modules/@huggingface/transformers'));
  assert.deepEqual(keys, ['node_modules/@huggingface/transformers']);
});
test('the entry files re-export from their own folder', () => {
  const read = (f) => fs.readFileSync(path.join(SKILL, f), 'utf8');
  assert.match(read('optional/voice/index.mjs'), /export \{ KokoroTTS, TextSplitterStream \} from 'kokoro-js';\nexport \{ env, RawAudio \} from '@huggingface\/transformers';/);
  assert.match(read('optional/cutout/index.mjs'), /export \{ default \} from 'onnxruntime-node';/);
});
test('the skill manifest keeps only its own override', () => assert.deepEqual(json('package.json').overrides, { 'fast-uri': '3.1.9' }));
```
- [ ] From `M`, run `node --test test/dependencies.test.mjs`. Expected: FAIL, `ENOENT … optional/voice/package.json`.
- [ ] Write `optional/voice/package.json` as `{"name":"make-motion-voice","version":"1.0.0","private":true,"type":"module","license":"MIT","description":"make-motion voiceover stack, installed on demand with npm ci","overrides":{"sharp":"0.35.5","global-agent":"4.1.3"}}`. Write `optional/cutout/package.json` the same way, with name `make-motion-cutout`, description `make-motion cutout stack, installed on demand with npm ci`, and overrides `{"global-agent":"4.1.3"}`. Write the two `index.mjs` files exactly as the regexes above show, each with a one-line comment saying why it exists: bare imports resolve inside this folder, so kokoro-js and our `env` are one module instance.
- [ ] **(network)** Run `npm --prefix <repo>/M/optional/voice install --package-lock-only --save-exact --ignore-scripts kokoro-js@1.2.1 @huggingface/transformers@3`. `--save-exact` writes the 3.x version the lock resolves; do not type one by hand. Then run `npm --prefix <repo>/M/optional/cutout install --package-lock-only --save-exact --ignore-scripts onnxruntime-node@1.31.1`. Open `optional/cutout/package-lock.json`. If it has no `node_modules/global-agent` entry, delete `overrides` from `optional/cutout/package.json` and set the cutout row's `overrides` to `undefined` in the test.
- [ ] **(network)** Run `npm --prefix <repo>/M/optional/voice audit --package-lock-only --audit-level=moderate`, then the same command for `optional/cutout`. Expected: `found 0 vulnerabilities`. On any advisory, stop and report; the fix is an exact override, decided by the owner.
- [ ] Remove `sharp` and `global-agent` from `M/package.json` overrides. Then run `npm --prefix <repo>/M install --package-lock-only --ignore-scripts` and `git -C <repo> diff --stat -- M/package-lock.json`. Expected: no change, because neither package is in the skill's lock. If the lock does change, stop and report. Delete `M/test/doctor.test.mjs:206-213`.
- [ ] From `M`, run `node --test test/dependencies.test.mjs test/doctor.test.mjs`. Expected: PASS.
- [ ] `git add M/optional/voice/package.json M/optional/voice/package-lock.json M/optional/voice/index.mjs M/optional/cutout/package.json M/optional/cutout/package-lock.json M/optional/cutout/index.mjs M/package.json M/test/dependencies.test.mjs M/test/doctor.test.mjs` and commit `feat: add locked optional packages for make-motion voice and cutout`.

### Task 4: Install with npm ci into the optional folders and load from them

One task: the doctor, the hints and the loaders switch together, so no commit installs into one folder while loading from another.

**Files:** Create `M/scripts/lib/optional.mjs` and `M/test/optional.test.mjs`. Modify:
- `P/shared/doctor.mjs:12-15` (drop `KOKORO_PIN` and `CUTOUT_PIN`), `:106-118` (`reinstallNote` drops the kokoro and cutout lines), `:356-379` (move `read` out as `readJson(ctx, p)`; fix the comment), `:381-436` (replaced).
- `M/scripts/lib/doctor-hint.mjs:4,11-13`, `M/scripts/lib/voice.mjs:1-2,7,23-25,95-109,152`, `M/scripts/lib/cutout.mjs` (header comment, the `doctor-hint` import, `INSTALL_HINT`, `loadOnnx`; Task 2 shifted its lines), `M/scripts/lib/requirements.mjs:70,73` (`nodeModules({ omitDev: false })`).
- `<repo>/scripts/audit-on-demand-deps.sh`, `<repo>/.github/workflows/audit-on-demand-deps.yml:7-12,26`.
- Tests: `P/shared/test/doctor.test.mjs:63-74,81-103,127-143,153-154,491,728-732,867-965`, `M/test/doctor.test.mjs:78,106,111,115-121`, `M/test/cutout.test.mjs:30,161-172,268-273`.

**Interfaces:** Consumes the Task 3 folders and entry files, and the existing `render`, `manualAll`, `pp` and `diagnose` in `shared/doctor.mjs`. Produces:
- `shared/doctor.mjs` exports `OPTIONAL = { kokoro: { dir: 'voice', pkg: 'kokoro-js' }, cutout: { dir: 'cutout', pkg: 'onnxruntime-node' } }` and `optionalInstallArgv(ctx, id) -> ['npm', 'ci', '--prefix', <pp(ctx).join(ctx.skillDir, 'optional', OPTIONAL[id].dir)>]`. Internal: `staleLocked(ctx, dir) -> string[]`, the names in `{ ...dependencies, ...overrides }` of `<dir>/package.json` whose installed version is present and differs from an exact pin. Internal: `optionalPackage({ id, why, size, notes })`, the requirement factory behind `kokoro()` and `cutout()`; it keeps `needsNodeModules: true` and the existing ranks.
- `doctor-hint.mjs` exports `optionalInstall(id) -> string`: `render([optionalInstallArgv({ platform: process.platform, skillDir: SKILL_DIR }, id)], process.platform)`. `npmInstallKokoro` and `npmInstallCutout` are removed.
- `optional.mjs` exports `OPTIONAL_ROOT` (`<skill>/optional`), `optionalEntryUrl(name, root = OPTIONAL_ROOT) -> string` (`pathToFileURL(<root>/<name>/index.mjs).href`), and `importOptional({ name, pkg, hint, root = OPTIONAL_ROOT, importer = (u) => import(u), exists = fs.existsSync }) -> Promise<module>`. It throws `UsageError(hint)` when `<root>/<name>/node_modules/<pkg>/package.json` is absent, or when the import fails with `ERR_MODULE_NOT_FOUND` naming `pkg`.
- `voice.loadKokoro(opts = {})` and `cutout.loadOnnx(opts = {})` take `{ root, importer, exists }`. `loadModel(kokoro)` uses `kokoro.env` and `kokoro.KokoroTTS`. `synthesize` uses `deps.RawAudio ?? kokoro.RawAudio`.

- [ ] Write the failing doctor tests. Replace `P/shared/test/doctor.test.mjs:867-965` with the following, where `VOICE = '/s/make-motion/optional/voice'` and `CUT = '/s/make-motion/optional/cutout'`:
  - `kokoro and cutout install with npm ci from their own locked folder`: `diagnose([kokoro(), cutout()], ctx({ platform: 'linux' }))`. The fix commands deep-equal ``[`npm ci --prefix ${VOICE}`, `npm ci --prefix ${CUT}`]``, and `ok` is true.
  - `an old in-skill install does not count`: with `exists: (p) => p === '/s/make-motion/node_modules/kokoro-js'`, `missing[0].id === 'kokoro'`, and `why` matches `/the old kokoro-js install in \/s\/make-motion\/node_modules is no longer used; --fix node_modules removes it/`.
  - `installed in its folder is present; an old in-skill copy beside it is an info note`: `exists` returns true for `${VOICE}/node_modules/kokoro-js` and for the old path, and `readFile` throws. Then `missing` is `[]`, and `info[0].note` matches `/no longer used; --fix node_modules removes it/`.
  - `an optional install that predates a pin counts as missing until npm ci reruns`: the files are `${VOICE}/package.json` = `{ dependencies: { 'kokoro-js': '1.2.1' }, overrides: { sharp: '0.35.5' } }`, the installed kokoro-js at `1.2.1` and the installed sharp at `0.34.5`. `why` matches `/reinstall to get sharp as pinned in optional\/voice\/package\.json/`. Set sharp to `0.35.5` and `missing` becomes `[]`.
  - `offline: a failed npm ci reports that command and runs nothing else`: `runFixes(['kokoro'], [kokoro()], ctx({ platform: 'linux' }), recorder returning { status: 1 })`. `ran` deep-equals ``[`npm ci --prefix ${VOICE}`]``, `res[0].ok` is false, and `res[0].manual === `npm ci --prefix ${VOICE}``.
  - `win32: one npm ci with the backslash folder quoted`: with `skillDir: 'C:\\Users\\a b\\make-motion'`, `fix.auto === 'npm ci --prefix "C:\\Users\\a b\\make-motion\\optional\\voice"'`. With `exists` true only for `'C:\\Users\\a b\\make-motion\\optional\\voice\\node_modules\\kokoro-js'`, `missing` is `[]`.
  - `--fix kokoro,cutout runs one npm ci per folder, after node_modules`: the recorder sees ``['npm ci --omit=dev --prefix /s/make-motion', `npm ci --prefix ${VOICE}`, `npm ci --prefix ${CUT}`]``.
  - `the make-motion node_modules reinstall names no optional install`: `nodeModules({ omitDev: false })` on a stale existing install has `notes === undefined`.
- [ ] Edit the older doctor tests:
  - `:69-70`: expect ``[`npm ci --prefix /s/make-motion/optional/voice`]`` and cwd `[undefined]`.
  - `:491`: expect `['npm ci --prefix /s/make-motion/optional/voice']`.
  - Delete `:81-103`, `:127-143`, `:153-154` and `:728-732`; the new block covers them. Drop `KOKORO_PIN` from every import.
- [ ] Write the failing loader tests in `M/test/optional.test.mjs`. `stubPkg(dir, name, src)` writes `node_modules/<name>/package.json` = `{"name":…,"type":"module","exports":"./index.mjs"}` and its `index.mjs`.
  - `loads through a file URL when the path has a space and a #`: the root is `<tmp>/a b#c/optional`. Copy the real `optional/voice/index.mjs` there, then stub kokoro-js (`export class KokoroTTS {} export class TextSplitterStream {}`) and @huggingface/transformers (`export const env = {}; export class RawAudio {}`). `await loadKokoro({ root })` has function-typed `KokoroTTS` and `RawAudio`, and `optionalEntryUrl('voice', root)` equals `pathToFileURL(path.join(root, 'voice', 'index.mjs')).href`.
  - `the loader never falls back to the skill's own node_modules`: the skill is `<tmp>/make-motion`. Copy the real entry to `optional/voice/index.mjs` with no `node_modules` beside it, and stub kokoro-js in `<tmp>/make-motion/node_modules`. `loadKokoro({ root })` rejects with a `UsageError` whose message equals the voice `INSTALL_HINT`.
  - `the voice install hint is npm ci into optional/voice and names doctor id kokoro`: `INSTALL_HINT` includes `` `npm ci --prefix ${quoteArg(path.join(SKILL, 'optional', 'voice'))}` ``, does not match `/npm install/`, and matches `/--for voiceover, id kokoro\)/`.
- [ ] Edit the make-motion tests:
  - `M/test/doctor.test.mjs:78,106`: probe `optional/voice/node_modules/kokoro-js` and `optional/cutout/node_modules/onnxruntime-node`.
  - `:111`: `assert.match(fresh.fix.auto, /npm ci --prefix \S+optional\/cutout$/)`.
  - `:120-121`: assert the hint includes `` `npm ci --prefix ${quoteArg(path.join(SKILL, 'optional', 'voice'))}` ``.
  - `M/test/cutout.test.mjs:30`: `hasOrt` probes `optional/cutout/node_modules/onnxruntime-node`.
  - `:161-172`: call `loadOnnx({ importer, exists })`, with `exists: () => true` for the missing, boom and ok cases, plus one case `exists: () => false` that gives `INSTALL_HINT`. Replace `:164-165` with `assert.match(INSTALL_HINT, /npm ci --prefix \S*optional[\\/]cutout/)` and `assert.doesNotMatch(INSTALL_HINT, /npm install/)`.
  - `:268-273`: assert the script matches `/optional\/\*\//` and `/audit --package-lock-only/`.
- [ ] Run and see the tests fail. From `P`, run `node --test shared/test/doctor.test.mjs`. Expected: FAIL, fix commands are still `npm install kokoro-js@1.2.1 --no-save`. From `M`, run `node --test test/optional.test.mjs`. Expected: FAIL, no `optional.mjs`.
- [ ] Implement `shared/doctor.mjs`.
  - Delete the pins, `ON_DEMAND_PINS` and `onDemandInstall`. Add `OPTIONAL`, `optionalInstallArgv`, `staleLocked` (it reads through `readJson`, so an unreadable file counts as not stale) and `optionalPackage`.
  - `why(ctx)` is the base text, then `; reinstall to get ${stale.join(', ')} as pinned in optional/${dir}/package.json` when stale, then `; the old ${pkg} install in ${pp(ctx).join(ctx.skillDir, 'node_modules')} is no longer used; --fix node_modules removes it` when `<skill>/node_modules/<pkg>` exists.
  - `check` is: `optional/<dir>/node_modules/<pkg>` exists and `staleLocked` is empty. `presentInfo` returns that same old-install note, or `null`. `fix` returns `{ auto: [argv], manual: manualAll(render([argv], ctx.platform)), notes }`.
  - kokoro: base `local text-to-speech for voiceover`, size `≈250 MB, plus a 90 MB model on first use`, notes `installs from optional/voice/package-lock.json; the 90 MB voice model downloads on first use, pinned to one commit and checked against SHA-256; npm ci in the skill folder leaves it alone`.
  - cutout: base `cuts a person out of a photo or clip (text-behind-subject) with MODNet, locally`, size `≈300 MB, plus a 25 MB model on first use`, notes in the same form with `optional/cutout` and `25 MB MODNet model`.
  - Then run the sync from `P`.
- [ ] Implement the hints and loaders.
  - `doctor-hint.mjs`: replace the two `npmInstall*` exports with `optionalInstall`.
  - `voice.mjs`: `INSTALL_HINT` = `` `kokoro-js is not installed. Run: ${optionalInstall('kokoro')}` `` plus the unchanged size and doctor tail. `loadKokoro(opts = {})` is `importOptional({ name: 'voice', pkg: 'kokoro-js', hint: INSTALL_HINT, ...opts })`. `loadModel` sets `kokoro.env.cacheDir = MODEL_CACHE_DIR` (Task 5 replaces this) and calls `kokoro.KokoroTTS.from_pretrained`. `synthesize`'s RawAudio becomes `deps.RawAudio ?? kokoro.RawAudio`. Update the header comment on lines 1-2.
  - `cutout.mjs`: `INSTALL_HINT` uses `optionalInstall('cutout')`. `loadOnnx(opts = {})` is `importOptional({ name: 'cutout', pkg: 'onnxruntime-node', hint: INSTALL_HINT, ...opts })`, then the existing `default` unwrap. Update the header comment on lines 1-3.
  - `requirements.mjs`: drop `restore`.
- [ ] Rewrite `scripts/audit-on-demand-deps.sh`.
  - Usage needs `$skill/optional`. It loops `for dir in "$skill"/optional/*/`, skips folders without `package-lock.json`, and runs `npm --prefix "$dir" audit --package-lock-only --audit-level=moderate || status=1`.
  - It exits 2 when no lockfile was found, else with `$status`. Update the header comment; the old `npm install <pin>` resolution is gone.
  - In the workflow, add `'plugins/portable-artifacts/skills/make-motion/optional/**'` to `paths` and rename the step `audit the optional voice and cutout lockfiles`.
- [ ] Run and see the tests pass.
  - From `P`: `node --test shared/test/doctor.test.mjs`, then `node bin/sync-shared.mjs --check`.
  - From `M`: `node --test test/optional.test.mjs test/doctor.test.mjs test/cutout.test.mjs test/voice.test.mjs test/dependencies.test.mjs`.
  - From `<repo>`: `shellcheck scripts/audit-on-demand-deps.sh`, and `bash scripts/audit-on-demand-deps.sh /nonexistent`, which must exit 2.
  - Expected: all PASS.
- [ ] **(network)** Real pre-pin proof, as AGENTS.md "A pin that fixes a vulnerability must also reach existing installs" requires:
  1. `npm --prefix <repo>/M install kokoro-js@1.2.1 --no-save` (an old-style install).
  2. `node <repo>/M/scripts/doctor.mjs --json --for voiceover`. Expected: kokoro missing, and `why` names the old install.
  3. `node <repo>/M/scripts/doctor.mjs --fix node_modules,kokoro`. Expected: both `fixed:`.
  4. Run the doctor again. Expected: kokoro is not missing, and `<repo>/M/node_modules/kokoro-js` is gone.
  5. `npm --prefix <repo>/M/optional/voice install sharp@0.34.5 --no-save`. Expected: the doctor shows kokoro stale.
     Use the AGENTS.md:93-95 recipe for this step:
     a. Delete `"sharp": "0.35.5"` from `M/optional/voice/package.json`; the override would otherwise refuse 0.34.5.
     b. Run the install.
     c. `node -p "require('<repo>/M/optional/voice/node_modules/sharp/package.json').version"` must print `0.34.5`.
     d. Restore with `git -C <repo> checkout -- M/optional/voice/package.json`.
     e. Only then run the doctor, which must show kokoro stale.
  6. `--fix kokoro`, then the same `node -p` prints `0.35.5`.
  7. `bash <repo>/scripts/audit-on-demand-deps.sh` exits 0.
- [ ] `git add P/shared/doctor.mjs P/shared/test/doctor.test.mjs P/skills/make-dashboard/shared/doctor.mjs P/skills/make-diagram/shared/doctor.mjs P/skills/make-explainer/shared/doctor.mjs P/skills/make-motion/shared/doctor.mjs P/skills/make-scene/shared/doctor.mjs M/scripts/lib/optional.mjs M/scripts/lib/doctor-hint.mjs M/scripts/lib/voice.mjs M/scripts/lib/cutout.mjs M/scripts/lib/requirements.mjs M/test/optional.test.mjs M/test/doctor.test.mjs M/test/cutout.test.mjs scripts/audit-on-demand-deps.sh .github/workflows/audit-on-demand-deps.yml`. Commit `fix: install voice and cutout with npm ci from their lockfiles and load them from there`.

### Task 5: Pin the Kokoro model to a commit and SHA-256

**Files:** Modify `M/scripts/lib/voice.mjs`: the constants block that starts at `MODEL_CACHE_DIR`, and `loadModel`, as Task 4 left it. Add `ensureKokoroModel` there. Modify `M/scripts/voice.mjs:13,37-46`. Modify `M/test/voice.test.mjs:8-10` (imports) and `:182` (`haveModel`), and append tests.
**Interfaces:** Consumes `ensurePinnedFile` (Task 2) and `loadKokoro`'s `{ KokoroTTS, env }` module (Task 4). Produces:
- `KOKORO_BASE_URL`: a string literal `'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/<40-hex>/'`.
- `KOKORO_FILES`: a frozen array of `{ file, sha256, bytes }` for `config.json`, `tokenizer.json`, `tokenizer_config.json` and `onnx/model_quantized.onnx`. These are the four files transformers.js reads for this model with `dtype: 'q8'`; the old caches in the 1.0.0 and 1.1.0 plugin copies hold exactly these.
- `KOKORO_DIR = path.join(MODEL_CACHE_DIR, MODEL_ID)`.
- `ensureKokoroModel({ dir = KOKORO_DIR, base = KOKORO_BASE_URL, files = KOKORO_FILES, fetchImpl = fetch, log = () => {} } = {}) -> Promise<string>` returns `dir`. For each file it calls `ensurePinnedFile` with label `Kokoro voice model file ${file}`.
- `loadModel(kokoro, { root = MODEL_CACHE_DIR } = {})` sets `env.localModelPath = root`, `env.allowLocalModels = true`, `env.allowRemoteModels = false` and `env.useFSCache = false`, then returns `kokoro.KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' })`. In transformers 3.8.1's `getModelFile` the order is FS cache, then `localModelPath`, then remote, so only the hash-checked folder can supply bytes.

- [ ] **(network)** Obtain the pin once. Do not invent values. From `<repo>`, run:
```
node --input-type=module -e "const repo='onnx-community/Kokoro-82M-v1.0-ONNX';const get=async(u)=>{const r=await fetch(u);if(!r.ok)throw new Error(r.status+' '+u);return r};const info=await (await get('https://huggingface.co/api/models/'+repo+'/revision/main')).json();const {createHash}=await import('node:crypto');const files=[];for(const file of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx']){const b=Buffer.from(await (await get('https://huggingface.co/'+repo+'/resolve/'+info.sha+'/'+file)).arrayBuffer());files.push({file,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length})}console.log(JSON.stringify({sha:info.sha,license:info.cardData?.license,files},null,2))"
```
  Cross-check with `curl -s "https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX/revision/<sha>?blobs=true"`: the `onnx/model_quantized.onnx` sibling's `lfs.sha256` and `lfs.size` must equal the printed values. Record `license` (expected `apache-2.0`; anything else, stop and report). Paste the values into the constants, with a comment giving the date and "obtained with the command in docs/superpowers/plans/2026-11-15-pa2-security-pins.md Task 5". If the four sizes sum outside 85–95 MB, use the rounded sum instead of "90 MB" in Task 4's notes and in Task 7.
- [ ] Write the failing tests in `M/test/voice.test.mjs`. `FILES = [{ file: 'config.json', body: Buffer.from('{}') }, { file: 'onnx/model_quantized.onnx', body: Buffer.from('onnx') }]` and `pinned` maps them to `{ file, sha256, bytes }`. `serve(calls, override)` records each URL and answers the file's body, or `override[file]`.
  - `the Kokoro pin: a commit-pinned base URL and four files, each with a sha256 and a size`: `KOKORO_BASE_URL` matches `/^https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[0-9a-f]{40}\/$/`. The file names deep-equal the four above. Each `sha256` matches `/^[0-9a-f]{64}$/` and each `bytes` is a positive integer. `path.relative(root, KOKORO_DIR)` equals `path.join('.cache','models','onnx-community','Kokoro-82M-v1.0-ONNX')`.
  - `ensureKokoroModel reuses a cached file only when its hash matches`: pre-write `config.json` = `'{}'`. Run with `base: 'https://example.invalid/r/'`. `calls` deep-equals `['https://example.invalid/r/onnx/model_quantized.onnx']`. Then overwrite `config.json` with `'{"old":true}'` and run again: `config.json` is `'{}'`.
  - `one bad file fails the load, names it, and keeps no copy of it`: override `onnx/model_quantized.onnx` with `'evil'`. It rejects `/sha256 mismatch for the Kokoro voice model file onnx\/model_quantized\.onnx/`, and that file does not exist.
  - `offline first use names the URL and keeps nothing`: `fetchImpl` throws `TypeError('fetch failed')`. It rejects `/Kokoro voice model file config\.json download failed: fetch failed \(https:\/\/example\.invalid\/r\/config\.json\)/`.
  - `loadModel points transformers at the verified folder and turns remote loading and its file cache off`: the stub is `env = { allowRemoteModels: true, useFSCache: true }` with a `KokoroTTS.from_pretrained` that records its arguments. After `loadModel(stub, { root: '/r' })`, `env` deep-equals `{ allowRemoteModels: false, useFSCache: false, allowLocalModels: true, localModelPath: '/r' }` and the arguments deep-equal `[MODEL_ID, { dtype: 'q8', device: 'cpu' }]`.
  - Gated: `synthesises with fetch disabled once the pinned files are cached (needs optional/voice + VOICE_TEST=1)`. Write `no-fetch.mjs` = `globalThis.fetch = () => { throw new Error('network used'); };`, then spawn `process.execPath, ['--import', pathToFileURL(noFetch).href, CLI, 'Hello.', '--out', out]` (Node 20.6+). Status is 0 and stderr does not match `/network used/`. Set `haveModel = () => existsSync(path.join(KOKORO_DIR, 'onnx/model_quantized.onnx')) && existsSync(path.join(root, 'optional/voice/node_modules/kokoro-js')) && process.env.VOICE_TEST === '1'`.
- [ ] From `M`, run `node --test test/voice.test.mjs`. Expected: FAIL, `KOKORO_BASE_URL` is not exported.
- [ ] Implement the constants, `ensureKokoroModel` and `loadModel`, and delete the `env.cacheDir` line. In `scripts/voice.mjs`, `main` runs `parseVoiceArgs`, then `loadKokoro()`, then `ensureKokoroModel({ log: (l) => process.stderr.write(`voice: ${l}\n`) })`, then `loadModel(kokoro)`. Import `ensureKokoroModel` on line 13.
- [ ] From `M`, run `node --test test/voice.test.mjs test/sketch-voice.test.mjs`. Expected: PASS, with the gated tests skipped.
- [ ] **(network, browser-free)** Run these three commands:
  1. `node <repo>/M/scripts/doctor.mjs --fix kokoro`.
  2. `node <repo>/M/scripts/voice.mjs "Pin check." --out <repo>/.scratch/pin.wav`. This downloads the four pinned files into `M/.cache/models` and prints the three contract lines.
  3. From `M`, `VOICE_TEST=1 node --test test/voice.test.mjs`.

  Expected: the gated tests run, with 0 skipped and all passing, including the fetch-disabled one. If any test is skipped, the proof did not run. That run proves `env` is the instance kokoro-js uses and that no unpinned file is read.
- [ ] `git add M/scripts/lib/voice.mjs M/scripts/voice.mjs M/test/voice.test.mjs` and commit `fix: pin the Kokoro voice model to one commit and check SHA-256 of each file`.

### Task 6: Drop the unpinned ffmpeg-static fallback

**Decision:** remove ffmpeg-static rather than pin it. A version pin still leaves its postinstall binary download unhashed and outside any lockfile, and `--no-save` is pruned by `npm ci`. The doctor never offered it as a fix: the fixes are brew, winget, apt or `FFMPEG_PATH`. The cost is that Linux loses a no-sudo path and existing ffmpeg-static installs stop being found. `FFMPEG_PATH` is the way out, and the CHANGELOG (Task 7) says so.

**Files:** Modify:
- `M/scripts/lib/ffmpeg.mjs:4,6-8,14-32`, `M/scripts/lib/doctor-hint.mjs` (`npmInstallFfmpegStatic`), `M/scripts/lib/cutout.mjs` (the libvpx hint in `run()`, which becomes `(Homebrew builds do)`).
- `P/shared/doctor.mjs` `ffmpeg()` (takes no options and drops `staticBinary`), `P/skills/make-explainer/scripts/lib/requirements.mjs:8-10,13` (use `ffmpeg()`).
- Tests:
  - `P/shared/test/doctor.test.mjs`: the tests titled `ffmpeg: FFMPEG_PATH must be executable; ffmpeg-static binary counts only if executable` and `ffmpeg staticDir: a static binary in another skill counts`.
  - `P/skills/make-explainer/test/doctor.test.mjs:120-127`.
  - `M/test/ffmpeg.test.mjs:29,43`.
  - `M/test/doctor.test.mjs`: the ffmpeg-static skip inside `ffmpeg is reported required-missing…`, the `findFfmpeg({ skipStatic: true })` call in `install hints name the doctor…`, and the test `the ffmpeg hint installs into make-motion`.
  - `M/test/helpers/render.mjs:26,38,45`, `M/test/helpers/render.test.mjs:32-33`.

**Interfaces:** Consumes the existing `findFfmpeg` callers. Produces `findFfmpeg() -> Promise<string>` takes no options and looks at `$FFMPEG_PATH`, then `PATH`. `ffmpeg() -> requirement`. `requireRender(t, { need, probes })` loses `skipStatic`.

- [ ] Write the failing tests.
  - Shared: rename the `ffmpeg: FFMPEG_PATH must be executable…` test to `ffmpeg: an ffmpeg-static binary in node_modules no longer counts; FFMPEG_PATH pointing at it does`. Keep its two FFMPEG_PATH lines. Its `staticOk` case now expects `ok` false, and it turns true once `env: { FFMPEG_PATH: '/s/make-motion/node_modules/ffmpeg-static/ffmpeg' }`. Delete the `ffmpeg staticDir…` test.
  - make-explainer, replacing `:120-127`: `a motion section needs a required browser and system ffmpeg`. `ff.check` returns false with only the make-motion static binary executable, and true with `which: (c) => c === 'ffmpeg'`.
  - `M/test/ffmpeg.test.mjs`, new: `the not-found hint offers system installs and FFMPEG_PATH, never an npm install`. With an empty PATH, it rejects with a message matching `/FFMPEG_PATH/` and not matching `/npm/`, and `readFileSync('scripts/lib/ffmpeg.mjs')` does not match `/ffmpeg-static/`.
- [ ] Run and see them fail. From `P`, run `node --test shared/test/doctor.test.mjs`. From `M`, run `node --test test/ffmpeg.test.mjs`. From `P/skills/make-explainer`, run `node --test test/doctor.test.mjs`. Expected: FAIL; the static binary still counts and the hint still says `npm i ffmpeg-static`.
- [ ] Implement.
  - `HINT` = `ffmpeg not found. Install it (macOS: brew install ffmpeg; Windows: winget install Gyan.FFmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg), or set FFMPEG_PATH to an ffmpeg you trust (doctor: …, id ffmpeg)`.
  - Remove the dynamic import and `npmInstallFfmpegStatic`, and update the comments that mention ffmpeg-static.
  - Drop `{ skipStatic: true }` from the test call sites. `render.mjs:26` becomes `ffmpeg: () => findFfmpeg()`, and `NO_FFMPEG = '{}'` gets the comment "PATH holds no ffmpeg and FFMPEG_PATH is unset". In `M/test/doctor.test.mjs`, delete the ffmpeg-static skip and its comment. Also delete the test `the ffmpeg hint installs into make-motion`; the new ffmpeg.test test supersedes it.
  - Sync shared.
- [ ] Run the same three commands, plus `node --test test/helpers/render.test.mjs test/cutout.test.mjs` from `M`. Expected: PASS.
- [ ] `git add M/scripts/lib/ffmpeg.mjs M/scripts/lib/doctor-hint.mjs M/scripts/lib/cutout.mjs P/shared/doctor.mjs P/shared/test/doctor.test.mjs P/skills/make-dashboard/shared/doctor.mjs P/skills/make-diagram/shared/doctor.mjs P/skills/make-explainer/shared/doctor.mjs P/skills/make-motion/shared/doctor.mjs P/skills/make-scene/shared/doctor.mjs P/skills/make-explainer/scripts/lib/requirements.mjs P/skills/make-explainer/test/doctor.test.mjs M/test/ffmpeg.test.mjs M/test/doctor.test.mjs M/test/helpers/render.mjs M/test/helpers/render.test.mjs`. Commit `fix: drop the unpinned ffmpeg-static fallback in favour of system ffmpeg or FFMPEG_PATH`.

### Task 7: Docs and CHANGELOG

**Files:** Modify:
- `P/README.md:227-228,322,324`, plus a new licence row after `:323`.
- `P/USAGE.md:676-677,850-851`.
- `M/SKILL.md:162`, `M/README.md:217,235`, `M/references/schema.md:307,308,314`.
- `P/CHANGELOG.md` (a new section above `## [1.2.0]`) and `<repo>/AGENTS.md:82,88-89`.

**Interfaces:** Consumes the commands and sizes fixed by Tasks 3–6. Produces nothing.

- [ ] Rewrite each line so the command it names is the one the doctor runs:
  - README 227: `` `npm ci --prefix <skill-dir>/optional/cutout` (≈300 MB, from that folder's lockfile) plus a one-time 25 MB MODNet model download (pinned commit, SHA-256 checked); the agent asks first; `npm ci` in the skill folder leaves it alone ``.
  - README 228: the same for `optional/voice`, `≈250 MB`, and `a one-time 90 MB Kokoro model download (one pinned commit, each file SHA-256 checked)`.
  - README 322: `` (`kokoro-js` 1.2.1, installed on demand into `optional/voice` from its lockfile) ``. Add the row `| Kokoro-82M ONNX weights (about 90 MB, downloaded on first voiceover from Hugging Face onnx-community/Kokoro-82M-v1.0-ONNX, pinned to one commit and a SHA-256 per file) | Apache-2.0 |`. README 324: `` installed on demand into `optional/cutout` from its lockfile ``.
  - USAGE 676-677: `after asking once to install the voice package (doctor --fix kokoro: about 250 MB from optional/voice's lockfile, plus a 90 MB model downloaded once, pinned and SHA-256 checked)`. USAGE 850-851: `npm ci --prefix <skill-dir>/optional/voice`, and `npm ci --prefix <skill-dir>/optional/cutout`, each with `(or doctor --fix kokoro / --fix cutout; npm ci in the skill folder leaves it alone)`.
  - SKILL.md 162: replace "The install keeps an installed voiceover; only `npm ci` removes either (rerun the `--fix`)." with "The voiceover and cutout installs live in their own folders (`optional/voice`, `optional/cutout`); neither removes the other, and `npm ci` in the skill folder leaves both alone."
  - make-motion README 217: `(kokoro-js installed on demand into optional/voice, ~250 MB, plus a 90 MB pinned model once)`. README 235: "**ffmpeg**: found via `$FFMPEG_PATH`, then `PATH`. It is never bundled; point `FFMPEG_PATH` at any build you trust."
  - schema.md 307: `` Needs `npm ci --prefix <skill-dir>/optional/voice` (on demand, `doctor --fix kokoro`, from that folder's lockfile) and a one-time ~90 MB download of four files at one pinned Hugging Face commit, each checked against a SHA-256 before every use, into `<skill-dir>/.cache/models/onnx-community/Kokoro-82M-v1.0-ONNX` ``.
  - schema.md 308: the `npm ci --prefix <skill-dir>/optional/cutout` form, and replace the "names an installed kokoro-js too" sentence with "The voiceover and cutout installs are separate folders; neither removes the other." schema.md 314: "ffmpeg is looked up as `$FFMPEG_PATH`, then `ffmpeg` on PATH."
- [ ] CHANGELOG: add `## [Unreleased]` with `### Behaviour changes to know about`, one bullet each:
  1. The voiceover and cutout installs move to `optional/voice` and `optional/cutout` and are installed by `npm ci` from committed lockfiles. An old install in the skill's `node_modules` is ignored: run `doctor --fix kokoro` or `--fix cutout` once, and `--fix node_modules` removes the old copy.
  2. The Kokoro model is pinned to commit `<first 7 hex>` with a SHA-256 per file. A cached file that differs is downloaded again once.
  3. ffmpeg-static is no longer looked for. Use a system ffmpeg or set `FFMPEG_PATH`.
  4. The unused `@fontsource/inter` and `@fontsource/jetbrains-mono` are removed.
  5. New standing tests: exact pins, locked installs, hashed downloads.
- [ ] AGENTS.md: after line 82, add "Since 2026-11 make-motion's on-demand installs are `npm ci --prefix <skill>/optional/<name>` from committed lockfiles, with their overrides in that package, so `npm audit --package-lock-only` sees them." On line 88-89, replace `` `bin/test/install-commands.test.mjs` now guards the docs `` with `` `bin/test/dependency-pins.test.mjs` now guards docs and code ``.
- [ ] Verify with `grep -rn -e "npm install kokoro" -e "npm install onnxruntime" -e "ffmpeg-static" -e "fontsource/inter" <repo>/P --exclude-dir=node_modules --exclude-dir=eval --exclude=CHANGELOG.md --exclude=package-lock.json`. Expected: no hits outside test fixtures. Out of scope: the generated gallery pages under `docs/features/showcase/portable-artifacts/gallery/motion-1-4/guide/` still show the old commands; design step 9 replaces them.
- [ ] `git add P/README.md P/USAGE.md M/SKILL.md M/README.md M/references/schema.md P/CHANGELOG.md AGENTS.md` and commit `docs: name the locked voice and cutout installs, the pinned model and system ffmpeg`.

### Task 8: Standing-rule tests

**Files:** Create `P/bin/test/dependency-pins.test.mjs`. Delete `P/bin/test/install-commands.test.mjs`; the new install rule supersedes it. Modify `P/skills/make-diagram/scripts/dev/font-metrics.mjs:3` (`after \`npm install\`` becomes `after \`npm ci\``).
**Interfaces:** Consumes the tree as Tasks 1–7 leave it. Produces three pure checkers that live in the test file. Each returns a list of `"<where>: <what>"` strings.
- `rangeViolations(manifest, where)`: every string value under `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`, and every string at any depth under `overrides`, must match `EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/`.
- `installViolations(text, where)`: prose matches of ``/\bnpm\s+(?:install|i)(?=\s|$|`)([^\n`|;&)]*)/g``. Each match must name at least one package, every package arg must match `/^(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/`, and `--no-save` is refused. Any argv form `/'npm',\s*'(?:install|i)'/` is a violation.
- `downloadViolations(source, where)`: a URL literal is a download when it is `huggingface.co` with `/resolve/`, `github.com` with `/releases/download/`, `objects.githubusercontent.com`, `registry.npmjs.org`, `cdn.jsdelivr.net` or `unpkg.com`, or when it ends in `.onnx|.bin|.safetensors|.gz|.tgz|.zip|.exe|.dmg|.wasm`. A download must hold a 40-hex commit segment, `@x.y.z` or `/vx.y.z/`, and the same file must contain `sha256` and a quoted 64-hex literal.

The scans cover:
- manifests: `skills/*/package.json` and `skills/*/optional/*/package.json`;
- lockfiles: one beside each of those manifests;
- prose: `README.md`, `USAGE.md`, `skills/*/{SKILL.md,README.md}` and `skills/*/references/*.md`;
- code: `skills/*/scripts/**/*.mjs`, `skills/*/optional/*/index.mjs`, `shared/**/*.mjs` without `shared/test/`, and `bin/*.mjs` (downloads only).

- [ ] Write the tests:
  - `the scans find what they should`: at least 7 manifests, and the code list includes `skills/make-motion/scripts/lib/voice.mjs` and `cutout.mjs`.
  - `every manifest pins exact versions`, `every manifest has a lockfile beside it`, `every npm install in prose and code names exact versions and none is --no-save`, and `every model or binary download is pinned and has a sha256 beside it`. Each asserts `deepEqual(violations, [])`.
  - Guardrail proofs:
    - `rangeViolations({ dependencies: { a: '^1.0.0', b: '~1.0.0', c: '>=1', d: 'latest', e: 'github:x/y', f: 'https://x/y.tgz', g: '1.x', h: '1.2.3' }, overrides: { i: { j: '^2.0.0' }, k: '3.1.9' } }, 'm').length === 8`.
    - `installViolations` gives 1 each for ``'`npm install kokoro-js --no-save`'``, ``'`npm i ffmpeg-static`'``, ``'`npm install kokoro-js@1.2.1 --no-save`'``, ``'after `npm install`:'`` and `"['npm', 'install', PIN]"`, and 0 for ``'`npm ci --prefix <dir>` or `npm install shiki@4.5.0`'``.
    - `downloadViolations` gives 1 for a `/resolve/main/` URL with `sha256` present, 1 for a 40-hex `/resolve/` URL with no 64-hex literal, 0 for that URL plus `MODEL_SHA256 = '<64 b>'`, and 0 for `'https://nodejs.org'`.
- [ ] From `P/bin`, run `node --test test/dependency-pins.test.mjs`. Expected: FAIL on exactly `skills/make-diagram/scripts/dev/font-metrics.mjs`, an `npm install` with no package. That is the real-tree RED.
- [ ] Fix `font-metrics.mjs:3`, delete `install-commands.test.mjs`, and rerun. Expected: PASS.
- [ ] Prove each rule fires on the real tree, not only on fixtures. First, `git -C <repo> status` must show these three files clean. Then make one temporary edit at a time, rerun, see the named failure, and revert with `git -C <repo> checkout -- <file>`:
  1. `M/package.json` `"ajv": "^8.20.0"` gives `skills/make-motion/package.json: dependencies.ajv = ^8.20.0`.
  2. Append ``Run `npm i ffmpeg-static`.`` to `M/SKILL.md`, which gives a `skills/make-motion/SKILL.md` violation.
  3. Change the 40-hex in `KOKORO_BASE_URL` to `main` in `M/scripts/lib/voice.mjs`, which gives a `voice.mjs` download violation.
- [ ] Run the whole plugin suite serially, one browser-heavy run at a time. From `P`: `node --test "shared/test/*.test.mjs"`. From `P/bin`: `node --test "test/*.test.mjs"`. From each skill folder: `node --test "test/**/*.test.mjs"`. Expected: PASS, skips allowed.
- [ ] `git add P/bin/test/dependency-pins.test.mjs P/bin/test/install-commands.test.mjs P/skills/make-diagram/scripts/dev/font-metrics.mjs` and commit `test: standing rules for exact pins, locked installs and hashed downloads`.

## Known gaps (report, do not fix here)

- onnxruntime-node has a `postinstall` (`node ./script/install`) that can fetch extra binaries on Linux, and it is in both optional trees: cutout directly, and voice through transformers. `npm ci` runs it unhashed. The security review in design section 11 must decide on `--ignore-scripts` or an explicit opt-out once it has been verified on all three platforms.
- Windows: the loader and the doctor's quoting are covered by unit tests only. A real Windows `doctor --fix kokoro`, followed by a voiceover, goes on the branch's manual-test checklist.
