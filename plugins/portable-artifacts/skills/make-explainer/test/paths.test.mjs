import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRef } from '../scripts/lib/paths.mjs';

function folder() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-paths-')));
  const dir = path.join(root, 'spec');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  fs.writeFileSync(path.join(dir, 'sub', 'b.svg'), 'x');
  fs.writeFileSync(path.join(root, 'secret.png'), 'x');
  return { root, dir, done: () => fs.rmSync(root, { recursive: true }) };
}

test('a file inside the folder resolves to its real path', () => {
  const { dir, done } = folder();
  try {
    assert.deepEqual(resolveRef(dir, 'a.png'), { abs: path.join(dir, 'a.png') });
    assert.deepEqual(resolveRef(dir, './sub/b.svg', { exts: ['.png', '.svg'] }), { abs: path.join(dir, 'sub', 'b.svg') });
    assert.deepEqual(resolveRef(dir, 'sub/../a.png'), { abs: path.join(dir, 'a.png') });
    assert.deepEqual(resolveRef(path.join(dir, 'sub', '..'), 'A.PNG'.toLowerCase()), { abs: path.join(dir, 'a.png') });
  } finally { done(); }
});

test('a missing file is an error that names the path', () => {
  const { dir, done } = folder();
  try {
    assert.deepEqual(resolveRef(dir, 'nope.png'), { error: `file not found: "nope.png" (relative to ${dir})` });
  } finally { done(); }
});

test('paths that leave the folder are refused, existing or not', () => {
  const { root, dir, done } = folder();
  try {
    const msg = (p) => `${JSON.stringify(p)} is outside the spec folder; move the file under ${dir} and use a relative path`;
    assert.deepEqual(resolveRef(dir, '../secret.png'), { error: msg('../secret.png') });
    assert.deepEqual(resolveRef(dir, 'sub/../../secret.png'), { error: msg('sub/../../secret.png') });
    assert.deepEqual(resolveRef(dir, '../nope.png'), { error: msg('../nope.png') });
    assert.deepEqual(resolveRef(dir, '.'), { error: msg('.') });
  } finally { done(); }
});

test('absolute paths are refused, inside the folder or not', () => {
  const { root, dir, done } = folder();
  try {
    const msg = (p) => ({ error: `${JSON.stringify(p)} is absolute; use a path relative to the spec folder` });
    const inside = path.join(dir, 'a.png');
    assert.deepEqual(resolveRef(dir, inside), msg(inside));
    assert.deepEqual(resolveRef(dir, inside, { exts: ['.png'] }), msg(inside));
    const outside = path.join(root, 'secret.png');
    assert.deepEqual(resolveRef(dir, outside), msg(outside));
    assert.deepEqual(resolveRef(dir, '/etc/passwd'), msg('/etc/passwd'));
  } finally { done(); }
});

test('symlinks are refused: file, directory, and one that points outside', () => {
  const { root, dir, done } = folder();
  try {
    fs.symlinkSync(path.join(dir, 'a.png'), path.join(dir, 'link.png'));
    fs.symlinkSync(path.join(root, 'secret.png'), path.join(dir, 'out.png'));
    fs.symlinkSync(path.join(dir, 'sub'), path.join(dir, 'subdir'));
    const msg = (p) => `${JSON.stringify(p)} goes through a symlink; symlinks are not followed — copy the file into ${dir}`;
    assert.deepEqual(resolveRef(dir, 'link.png'), { error: msg('link.png') });
    assert.deepEqual(resolveRef(dir, 'out.png'), { error: msg('out.png') });
    assert.deepEqual(resolveRef(dir, 'subdir/b.svg'), { error: msg('subdir/b.svg') });
  } finally { done(); }
});

test('a spec folder reached through a symlinked parent still works', () => {
  const { root, dir, done } = folder();
  try {
    fs.symlinkSync(root, path.join(os.tmpdir(), path.basename(root) + '-alias'));
    const alias = path.join(os.tmpdir(), path.basename(root) + '-alias', 'spec');
    assert.deepEqual(resolveRef(alias, 'a.png'), { abs: path.join(dir, 'a.png') });
  } finally {
    fs.unlinkSync(path.join(os.tmpdir(), path.basename(root) + '-alias'));
    done();
  }
});

test('extensions are checked case-insensitively and named in the error', () => {
  const { dir, done } = folder();
  try {
    fs.writeFileSync(path.join(dir, 'c.PNG'), 'x');
    assert.deepEqual(resolveRef(dir, 'c.PNG', { exts: ['.png'] }), { abs: path.join(dir, 'c.PNG') });
    assert.deepEqual(resolveRef(dir, 'a.gif', { exts: ['.png', '.svg'] }), { error: 'must be a .png, .svg file; got ".gif"' });
    assert.deepEqual(resolveRef(dir, 'noext', { exts: ['.png'] }), { error: 'must be a .png file; got "noext"' });
  } finally { done(); }
});

test('directories, blanks and non-strings are refused', () => {
  const { dir, done } = folder();
  try {
    assert.deepEqual(resolveRef(dir, 'sub'), { error: '"sub" is not a regular file' });
    const blank = { error: 'must be a path to a file in the spec folder' };
    assert.deepEqual(resolveRef(dir, ''), blank);
    assert.deepEqual(resolveRef(dir, '   '), blank);
    assert.deepEqual(resolveRef(dir, 42), blank);
    assert.deepEqual(resolveRef(dir, undefined), blank);
    assert.equal(typeof resolveRef(dir, 'a\0.png').error, 'string');
  } finally { done(); }
});
