// The ported shader cuts and their licences (transitions plan Task 5): every module under engine/cuts/shaders with a
// licence has a row in THIRD_PARTY_NOTICES.md with the same author, licence and commit, and the reverse; one commit; the
// upstream header sits above the port line; every licence is one the owner's ruling allows (OSI: MIT, BSD-3-Clause),
// with its text in the notices; the plugin README names the notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { SHADER_MODULES } from '../../engine/cuts/shaders/index.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOTICES = readFileSync(path.join(SKILL, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const README = readFileSync(path.join(SKILL, '../../README.md'), 'utf8');
const ALLOWED = Object.freeze({ MIT: 'Permission is hereby granted, free of charge', 'BSD-3-Clause': 'Redistribution and use in source and binary forms' });
const SPDX_OF = Object.freeze({ MIT: 'MIT', 'BSD 3 Clause': 'BSD-3-Clause' });

const ported = Object.values(SHADER_MODULES).filter((m) => m.license !== null);
const fileOf = (m) => readFileSync(path.join(SKILL, 'engine/cuts/shaders', `${m.name}.mjs`), 'utf8');

// The notices' table rows: | cut | upstream file | author | licence | commit | sha256 |
const rows = NOTICES.split('\n').filter((line) => /^\| `[a-z-]+` \|/.test(line)).map((line) => {
  const [cut, origin, author, spdx, commit, sha] = line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ''));
  return { cut, origin, author, spdx, commit, sha };
});

test('ten shader cuts are ported from gl-transitions, each registered as a shader cut', () => {
  assert.equal(ported.length, 10);
  for (const m of ported) assert.equal(registries.cuts.get(m.name).family, 'shader', m.name);
});

test('every ported module has a notices row with its author, licence, upstream file and commit, and every row a module', () => {
  assert.deepEqual(rows.map((r) => r.cut).sort(), ported.map((m) => m.name).sort());
  for (const m of ported) {
    const row = rows.find((r) => r.cut === m.name);
    assert.deepEqual([row.origin, row.author, row.spdx, row.commit], [m.license.origin, m.license.author, m.license.spdx, m.license.commit], m.name);
    assert.match(row.sha, /^[0-9a-f]{64}$/, `${m.name}: the SHA-256 of the file as fetched`);
  }
});

test('every row names one commit, and the notices say which', () => {
  const commits = new Set(rows.map((r) => r.commit));
  assert.equal(commits.size, 1);
  const [commit] = commits;
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.ok(NOTICES.includes(`gl-transitions/gl-transitions@${commit}`), 'the notices name the pinned commit');
});

test('each ported file keeps the upstream header above its port line, and the header agrees with the module\'s licence', () => {
  for (const m of ported) {
    const lines = fileOf(m).split('\n');
    const port = lines.findIndex((line) => line.startsWith('// Ported for make-motion from '));
    assert.ok(port > 0, `${m.name}: a port line under the header`);
    const header = lines.slice(0, port);
    assert.ok(header.every((line) => line.startsWith('//')), `${m.name}: only the upstream comment lines above the port line`);
    assert.ok(lines[port].includes(`gl-transitions/gl-transitions@${m.license.commit}, ${m.license.origin}; changes: `), `${m.name}: the port line names the commit, the file and the changes`);
    const licence = header.map((line) => /^\/\/ License: (.*)$/i.exec(line)?.[1]).find(Boolean);
    const author = header.map((line) => /^\/\/ Author: (.*)$/i.exec(line)?.[1]).find(Boolean);
    assert.equal(SPDX_OF[licence], m.license.spdx, `${m.name}: the header's licence`);
    assert.equal(author, m.license.author, `${m.name}: the header's author`);
  }
});

test('every licence is one the ruling allows, and its text is in the notices', () => {
  for (const m of ported) assert.ok(m.license.spdx in ALLOWED, `${m.name}: ${m.license.spdx}`);
  for (const spdx of new Set(ported.map((m) => m.license.spdx))) assert.ok(NOTICES.includes(ALLOWED[spdx]), `the ${spdx} text`);
  assert.ok(NOTICES.includes('When no license is specified,'), 'the repository LICENSE sentence on files without their own licence');
});

test('the plugin README names make-motion\'s notices and gl-transitions in its licence table', () => {
  const row = README.split('\n').find((line) => line.includes('gl-transitions'));
  assert.ok(row, 'a row for gl-transitions');
  assert.ok(row.includes('skills/make-motion/THIRD_PARTY_NOTICES.md'), row);
  assert.match(row, /\| MIT, BSD-3-Clause \|$/);
});
