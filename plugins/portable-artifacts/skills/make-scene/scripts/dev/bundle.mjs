// Rebuilds template/vendor/scene-runtime.min.js from template/runtime/index.js.
// Dev-only (esbuild is a devDependency): run `npm run bundle` after any runtime edit and commit the result.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { BUNDLE_FILE, SKILL_DIR, bundleHeader } from '../lib/bundle.mjs';

// MIT asks for the copyright AND the permission notice in all copies; esbuild's @license comment holds only the
// first, so three's whole LICENSE file goes in a preserved /*! */ comment at the end of the bundle.
function threeNotice() {
  const text = fs.readFileSync(path.join(SKILL_DIR, 'node_modules', 'three', 'LICENSE'), 'utf8').trim();
  if (text.includes('*/')) throw new Error('three/LICENSE contains "*/": it cannot go in a block comment');
  return `/*! three.js licence (MIT), from three/LICENSE\n\n${text}\n*/`;
}

try {
  const header = bundleHeader();
  const result = await build({
    absWorkingDir: SKILL_DIR,
    entryPoints: ['template/runtime/index.js'],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    legalComments: 'eof', // three is MIT: its @license / SPDX notice must travel with every inlined copy
    write: false,
  });
  const body = result.outputFiles[0].text;
  fs.writeFileSync(BUNDLE_FILE, `${header}\n${body}${threeNotice()}\n`);
  console.log(`wrote ${BUNDLE_FILE} (${Buffer.byteLength(body)} bytes + header)`);
} catch (err) {
  console.error(`bundle failed: ${err.message}`);
  process.exitCode = 1;
}
