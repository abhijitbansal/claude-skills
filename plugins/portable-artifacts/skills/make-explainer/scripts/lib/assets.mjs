// Stale-asset cleanup for <slug>.assets/. A build writes the files it needs there and
// nothing tidies an earlier build's files, so a renamed video or a section that stopped
// being interactive left orphans (up to 50 MB each) in the folder the user ships.
// Narrow on purpose: only regular files inside that one folder, found with lstat-style
// reads (a symlink is never followed and never removed), and a folder only when this
// call emptied it.
import fs from 'node:fs';
import path from 'node:path';

function prune(dir, keep, removed) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const before = removed.length;
      prune(abs, keep, removed);
      if (removed.length > before) tryRemoveEmpty(abs);
    } else if (entry.isFile() && !keep.has(abs)) {
      fs.unlinkSync(abs);
      removed.push(abs);
    }
  }
}

function tryRemoveEmpty(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty (a kept file or a symlink is in it): leave it
  }
}

/**
 * Remove the regular files under `assetsDir` that are not in `written` (absolute paths this build wrote),
 * then the folders that became empty. -> the removed file paths. A missing folder, or one that is itself a
 * symlink, is left alone.
 */
export function pruneAssets(assetsDir, written) {
  const root = path.resolve(assetsDir);
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const removed = [];
  prune(root, new Set(written.map((p) => path.resolve(p))), removed);
  if (removed.length > 0) tryRemoveEmpty(root);
  return removed;
}
