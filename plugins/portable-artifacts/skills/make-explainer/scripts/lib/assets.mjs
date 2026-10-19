// Writing <slug>.assets/ and tidying an earlier build's files in it.
// The folder is shared with the user, who may keep an image, a video or a poster there and name
// it in the spec, or may have made a folder of that name for their own files. So a build only
// ever deletes what a build wrote: every build records the files it wrote (and the subfolders it
// made) in <folder>/.pa-assets.json and the next one prunes only files named there that it did not
// write itself, and removes only the folders it made. No manifest means nothing is pruned. A file this
// build reads is never pruned, nothing outside the folder is touched, and a symlink is neither followed
// nor removed nor written through. A <slug>.assets that is itself a symlink or a plain file is refused.
// The order is: check every target, write the assets, write the manifest, let the caller write the page,
// and only then prune; so a failure anywhere leaves the previous page pointing at files that still exist.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';

export const MANIFEST = '.pa-assets.json';
const MANIFEST_TMP = `${MANIFEST}.tmp`;
const MANIFEST_VERSION = 1;
const FIX = 'move it, or rename the section or its asset';

/** An I/O failure, naming the path that failed. */
export class WriteError extends UsageError {
  constructor(file, cause) {
    super(`cannot write ${file}: ${cause?.code ?? cause?.message ?? cause}`);
    this.path = file;
  }
}
const io = (file, fn) => {
  try {
    return fn();
  } catch (e) {
    throw new WriteError(file, e);
  }
};

const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

const realOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

const isOwnName = (name) => [MANIFEST, MANIFEST_TMP].includes(name.toLowerCase()); // a case-insensitive disk folds them together

// A manifest entry is a relative path of plain names, with "/" as the separator. The manifest's own name
// (and its temp file's), in any case, is never an entry.
function entryParts(entry) {
  if (typeof entry !== 'string' || entry === '' || entry.includes('\\') || entry.includes('\0')) return null;
  const parts = entry.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return parts.length === 1 && isOwnName(parts[0]) ? null : parts;
}

// -> { files, dirs } (valid entries only) recorded by the previous build, or null when there is no usable manifest.
function readManifest(root) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.files)) return null;
  const valid = (list) => (Array.isArray(list) ? list.filter((e) => entryParts(e) !== null) : []);
  return { files: valid(data.files), dirs: valid(data.dirs) };
}

// Walk `parts` below `root` one name at a time. -> { abs, stat } for the last name (stat null when it does
// not exist), or null when any directory on the way is missing or is not a real directory (a symlink).
function walk(root, parts) {
  let abs = root;
  for (const [i, name] of parts.entries()) {
    abs = path.join(abs, name);
    const stat = lstatOrNull(abs);
    if (i === parts.length - 1) return { abs, stat };
    if (stat === null) return { abs: path.join(abs, ...parts.slice(i + 1)), stat: null };
    if (!stat.isDirectory()) return null;
  }
  return null;
}

// -> the absolute path of a regular file (not a symlink) recorded by an earlier build, else null.
function recordedFile(root, entry) {
  const parts = entryParts(entry);
  const hit = parts && walk(root, parts);
  return hit?.stat?.isFile() ? hit.abs : null;
}

const relInside = (root, abs) => {
  const rel = path.relative(root, abs);
  return rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : rel.split(path.sep);
};

// Remove `from` and its parents up to (not including) the root, but only folders a build made (`owned`).
function removeEmptyDirs(root, from, owned) {
  for (let dir = from; dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    if (!owned.has(path.relative(root, dir).split(path.sep).join('/'))) return;
    try {
      fs.rmdirSync(dir);
    } catch {
      return; // not empty (a kept file, a user's file or a symlink is in it)
    }
  }
}

// Create `dir` (inside `root`), noting in `made` each folder this call had to create, as "a/b" entries.
function makeDirs(root, dir, made) {
  const names = relInside(root, dir);
  if (names === null) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  if (lstatOrNull(root) === null) fs.mkdirSync(root, { recursive: true });
  let current = root;
  for (const [i, name] of names.entries()) {
    current = path.join(current, name);
    if (lstatOrNull(current) !== null) continue;
    fs.mkdirSync(current);
    made.add(names.slice(0, i + 1).join('/'));
  }
}

// Atomic, so an interrupted build leaves the old manifest or the new one (and at worst a stale .tmp, which the next build removes).
function writeManifest(root, { files, dirs }) {
  const file = path.join(root, MANIFEST);
  const tmp = path.join(root, MANIFEST_TMP);
  const body = { version: MANIFEST_VERSION, files: [...files].sort(), dirs: [...dirs].sort() };
  io(tmp, () => {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  });
  io(file, () => fs.renameSync(tmp, file));
}

// A leftover manifest temp file is ours, never a user's: remove it (a regular file or a symlink only).
function removeStaleTmp(root) {
  const tmp = path.join(root, MANIFEST_TMP);
  const stat = lstatOrNull(tmp);
  if (stat !== null && (stat.isFile() || stat.isSymbolicLink())) io(tmp, () => fs.unlinkSync(tmp));
}

const sameFile = (a, b) => {
  const real = realOrNull(a);
  return real !== null && real === realOrNull(b);
};

// Do the bytes at asset.to already match what the build would write there?
function sameBytes(asset) {
  try {
    const size = fs.statSync(asset.to).size;
    if (asset.content !== undefined) {
      const want = Buffer.from(asset.content);
      return want.length === size && want.equals(fs.readFileSync(asset.to));
    }
    if (sameFile(asset.from, asset.to)) return true;
    return fs.statSync(asset.from).size === size && fs.readFileSync(asset.from).equals(fs.readFileSync(asset.to));
  } catch {
    return false;
  }
}

const stateOf = (assetsDir) => {
  const root = path.resolve(assetsDir);
  const stat = lstatOrNull(root);
  const kind = stat === null ? 'none' : stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
  return { root, kind, folder: path.basename(root), previous: kind === 'dir' ? readManifest(root) : null };
};

const conflict = (asset, problem, fix = FIX) => ({ asset, action: 'conflict', problem, fix });

// What to do with each asset: 'write' it, 'keep' the identical file that is already there (it was there first,
// so it is neither rewritten nor claimed by the manifest), or report a conflict. A build overwrites only what the
// previous manifest lists; a symlink (or a symlink or file on the way, the folder itself included) is never written through.
function plan({ root, kind, folder, previous }, assets) {
  if (kind === 'symlink' || kind === 'file') {
    const what = kind === 'symlink' ? 'a symlink' : 'a file, not a folder';
    return assets.map((asset) => conflict(asset, `${folder} is ${what}`, 'move it, or build to another path'));
  }
  const listed = new Set(previous?.files ?? []);
  return assets.map((asset) => {
    const parts = relInside(root, asset.to);
    if (!parts) return { asset, parts, action: 'write' };
    const hit = walk(root, parts);
    const rel = parts.join('/');
    if (hit === null || hit.stat?.isSymbolicLink()) return conflict(asset, `${folder}/${rel}: a symlink or a file is in the way`);
    if (hit.stat === null || (hit.stat.isFile() && listed.has(rel))) return { asset, parts, action: 'write' };
    if (hit.stat.isFile() && sameBytes(asset)) return { asset, parts, action: 'keep' };
    return conflict(asset, `${folder}/${rel} already exists and no build wrote it`);
  });
}

/**
 * The assets that would overwrite or write through something no build wrote, as [{ path, message }] keyed by the
 * asset's `at` (the section path). Run before anything is written: a failed build leaves the folder as it was.
 */
export function assetConflicts(assetsDir, assets) {
  return plan(stateOf(assetsDir), assets)
    .filter((p) => p.action === 'conflict')
    .map((p) => ({ path: p.asset.at ?? '', message: `${p.problem}; ${p.fix}` }));
}

// The reference fields of a section: the only strings in a spec that name a file the build reads.
const PATH_FIELDS = { image: ['src'], motion: ['video', 'poster', 'spec'], diagram: ['diagram'], chart: ['dashboard'], scene: ['scene'] };

/**
 * The files the spec points at (image src, motion video/poster/spec, diagram, scene and chart files), resolved against the
 * spec's folder. The caller passes these to syncAssets as `protect`: a file this build reads is never pruned.
 * Prose that happens to spell a path is not one.
 */
export function specInputs(spec, dir) {
  const out = new Set();
  for (const section of Array.isArray(spec?.sections) ? spec.sections : []) {
    for (const field of PATH_FIELDS[section?.type] ?? []) {
      const v = section[field];
      if (typeof v === 'string' && v !== '' && !v.includes('\0')) out.add(path.resolve(dir, v));
    }
  }
  return [...out];
}

/**
 * Write a build's assets ([{ from, to } | { content, to }], absolute paths), then `publish()`, then tidy the folder.
 *  - Nothing is overwritten unless the previous manifest lists it. A file already there with the bytes the build
 *    would write (a source that is its own destination included) is left alone and not listed; any other is a
 *    conflict, which throws here (the build calls assetConflicts first, so it fails before writing anything).
 *  - The assets are written first, and a manifest listing them and everything the previous build listed. Then
 *    `publish()` runs: the caller writes the page there, so a failure leaves the previous page and files that
 *    still exist. An I/O failure throws WriteError naming the failing path.
 *  - Only then are files the previous build listed and this one did not write removed, unless a `protect` path or
 *    an asset source is that file, and then the folders a build made that became empty. The manifest is rewritten
 *    with exactly the files this build wrote. A build that writes none removes the manifest, and the folder if the
 *    user has nothing else in it; with no previous manifest it touches nothing.
 * -> the asset destinations (absolute paths).
 */
export function syncAssets(assetsDir, assets, { protect = [], publish = () => {} } = {}) {
  const state = stateOf(assetsDir);
  const { root, kind, previous } = state;
  const steps = plan(state, assets);
  const clash = steps.find((x) => x.action === 'conflict');
  if (clash) throw new UsageError(`${clash.problem}; ${clash.fix}`);
  const destinations = assets.map((a) => a.to);
  if (kind === 'symlink' || kind === 'file') {
    publish();
    return destinations;
  }
  if (kind === 'dir') removeStaleTmp(root);

  const written = [];
  const made = new Set();
  for (const { asset, parts, action } of steps) {
    if (action === 'keep') continue;
    io(path.dirname(asset.to), () => makeDirs(root, path.dirname(asset.to), made));
    io(asset.to, () => (asset.content !== undefined ? fs.writeFileSync(asset.to, asset.content) : fs.copyFileSync(asset.from, asset.to)));
    if (parts) written.push(parts.join('/'));
  }

  // What the previous build wrote that this one no longer does, and may remove once the page is out.
  const stale = [];
  if (previous !== null) {
    const keep = new Set(written);
    let inputs = null; // real paths of everything this build reads, computed when something could be removed
    const isInput = (abs) => {
      inputs ??= new Set([...protect, ...assets.map((a) => a.from)].filter(Boolean).map(realOrNull).filter(Boolean));
      return inputs.has(realOrNull(abs));
    };
    for (const entry of previous.files) {
      if (keep.has(entry)) continue;
      const abs = recordedFile(root, entry);
      if (abs !== null && !isInput(abs)) stale.push({ entry, abs });
    }
  }
  const owned = new Set([...(previous?.dirs ?? []), ...made]);
  const existingDirs = () => [...owned].filter((d) => lstatOrNull(path.join(root, ...d.split('/')))?.isDirectory());

  if (written.length > 0) writeManifest(root, { files: [...written, ...stale.map((x) => x.entry)], dirs: existingDirs() });
  publish();

  for (const { abs } of stale) {
    io(abs, () => fs.unlinkSync(abs));
    removeEmptyDirs(root, path.dirname(abs), owned);
  }
  if (written.length > 0) {
    if (stale.length > 0) writeManifest(root, { files: written, dirs: existingDirs() });
  } else if (previous !== null) {
    io(path.join(root, MANIFEST), () => fs.rmSync(path.join(root, MANIFEST), { force: true }));
    try {
      fs.rmdirSync(root);
    } catch {
      // the user's own files are in it: leave the folder
    }
  }
  return destinations;
}
