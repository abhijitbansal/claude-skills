// Writing <slug>.assets/ and tidying an earlier build's files in it.
// The folder is shared with the user, who may keep an image, a video or a poster there and name
// it in the spec, or may have made a folder of that name for their own files. So a build only
// ever deletes what a build wrote: every build records the files it wrote in <folder>/.pa-assets.json
// and the next one prunes only files named there that it did not write itself. No manifest means
// nothing is pruned. A file this build reads is never pruned, nothing outside the folder is touched,
// and a symlink is neither followed nor removed nor written through.
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST = '.pa-assets.json';
const MANIFEST_VERSION = 1;

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

// A manifest entry is a relative path of plain names, with "/" as the separator.
function entryParts(entry) {
  if (typeof entry !== 'string' || entry === '' || entry.includes('\\') || entry.includes('\0')) return null;
  const parts = entry.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return entry === MANIFEST ? null : parts;
}

// -> the previous build's recorded files (valid entries only), or null when there is no usable manifest.
function readManifest(root) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.files)) return null;
  return data.files.filter((e) => entryParts(e) !== null);
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

function removeEmptyDirs(root, from) {
  for (let dir = from; dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return; // not empty (a kept file or a symlink is in it)
    }
  }
}

// Atomic, so an interrupted build leaves the old manifest or the new one.
function writeManifest(root, files) {
  const file = path.join(root, MANIFEST);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: MANIFEST_VERSION, files: [...files].sort() }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const relInside = (root, abs) => {
  const rel = path.relative(root, abs);
  return rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : rel.split(path.sep);
};

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

// What to do with each asset: 'write' it, 'keep' the identical file that is already there (it was there first,
// so it is neither rewritten nor claimed by the manifest), or report a conflict. A build overwrites only what the
// previous manifest lists; a symlink (or a symlink or file on the way) is never written through.
function plan(root, assets, previous, tracked) {
  const listed = new Set(previous ?? []);
  return assets.map((asset) => {
    const parts = tracked ? relInside(root, asset.to) : null;
    if (!parts) return { asset, parts, action: 'write' };
    const hit = walk(root, parts);
    const rel = parts.join('/');
    if (hit === null || hit.stat?.isSymbolicLink()) return { asset, parts, action: 'conflict', problem: `${rel}: a symlink or a file is in the way` };
    if (hit.stat === null || (hit.stat.isFile() && listed.has(rel))) return { asset, parts, action: 'write' };
    if (hit.stat.isFile() && sameBytes(asset)) return { asset, parts, action: 'keep' };
    return { asset, parts, action: 'conflict', problem: `${rel} already exists and no build wrote it` };
  });
}

const stateOf = (assetsDir) => {
  const root = path.resolve(assetsDir);
  const rootStat = lstatOrNull(root);
  const tracked = rootStat === null || rootStat.isDirectory(); // a symlink or a plain file is not ours to manage
  return { root, tracked, previous: tracked && rootStat !== null ? readManifest(root) : null };
};

/**
 * The assets that would overwrite or write through something no build wrote, as [{ path, message }] keyed by the
 * asset's `at` (the section path). Run before anything is written: a failed build leaves the folder as it was.
 */
export function assetConflicts(assetsDir, assets) {
  const { root, tracked, previous } = stateOf(assetsDir);
  const folder = path.basename(root);
  return plan(root, assets, previous, tracked)
    .filter((p) => p.action === 'conflict')
    .map((p) => ({ path: p.asset.at ?? '', message: `${folder}/${p.problem}; move it, or rename the section or its asset` }));
}

/**
 * Every string in the spec that could name a file, resolved against the spec's folder. The caller passes
 * these to syncAssets as `protect`: a file this build reads is never pruned.
 */
export function specInputs(spec, dir) {
  const out = new Set();
  const visit = (v) => {
    if (typeof v === 'string') {
      if (v.length > 0 && v.length < 1024 && !v.includes('\n') && !v.includes('\0')) out.add(path.resolve(dir, v));
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v !== null && typeof v === 'object') {
      Object.values(v).forEach(visit);
    }
  };
  visit(spec);
  return [...out];
}

/**
 * Write a build's assets ([{ from, to } | { content, to }], absolute paths) and tidy the folder.
 *  - Nothing is overwritten unless the previous manifest lists it. A file already there with the bytes the build
 *    would write (a source that is its own destination included) is left alone and not listed; any other is a
 *    conflict, which throws here (the build calls assetConflicts first, so it fails before writing anything).
 *  - Files the previous build listed in the manifest and this one did not write are removed, unless a `protect`
 *    path or an asset source is that file. Then folders that became empty.
 *  - The manifest is rewritten with exactly the files this build wrote. A build that writes none removes the
 *    manifest, and the folder if the user has nothing else in it; with no previous manifest it touches nothing.
 *  - A folder that is itself a symlink is written into as before but never pruned or given a manifest.
 * -> the asset destinations (absolute paths).
 */
export function syncAssets(assetsDir, assets, { protect = [] } = {}) {
  const { root, tracked, previous } = stateOf(assetsDir);
  const steps = plan(root, assets, previous, tracked);
  const clash = steps.find((x) => x.action === 'conflict');
  if (clash) throw new Error(`refusing to overwrite ${clash.problem}`);

  const written = [];
  for (const { asset, parts, action } of steps) {
    if (action === 'keep') continue;
    fs.mkdirSync(path.dirname(asset.to), { recursive: true });
    if (asset.content !== undefined) fs.writeFileSync(asset.to, asset.content);
    else fs.copyFileSync(asset.from, asset.to);
    if (parts) written.push(parts.join('/'));
  }
  if (!tracked) return assets.map((a) => a.to);

  if (previous !== null) {
    const keep = new Set(written);
    let inputs = null; // real paths of everything this build reads, computed when something could be removed
    const isInput = (abs) => {
      inputs ??= new Set([...protect, ...assets.map((a) => a.from)].filter(Boolean).map(realOrNull).filter(Boolean));
      return inputs.has(realOrNull(abs));
    };
    for (const entry of previous) {
      if (keep.has(entry)) continue;
      const abs = recordedFile(root, entry);
      if (abs === null || isInput(abs)) continue;
      fs.unlinkSync(abs);
      removeEmptyDirs(root, path.dirname(abs));
    }
  }

  if (written.length > 0) {
    writeManifest(root, written);
  } else if (previous !== null) {
    fs.rmSync(path.join(root, MANIFEST), { force: true });
    try {
      fs.rmdirSync(root);
    } catch {
      // the user's own files are in it: leave the folder
    }
  }
  return assets.map((a) => a.to);
}
