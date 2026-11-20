// The page's own stylesheet: labels use the shared type tokens, panels sit on a surface step with elevation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTheme } from '../shared/theme.mjs';
import { buildScene } from '../scripts/lib/api.mjs';
import { renderPage } from '../scripts/lib/page.mjs';
import { PINNED_ENV, citySpec } from './helpers/scene-fixtures.mjs';

const theme = loadTheme('dusk');

async function html() {
  const spec = citySpec();
  return renderPage(spec, await buildScene(spec, { dir: process.cwd(), theme }), { theme, env: PINNED_ENV });
}

// The declarations of every rule whose selector list contains `selector` exactly.
const rule = (text, selector) => {
  const bodies = [];
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) bodies.push(m[2]);
  }
  return bodies.join(';');
};

test('the page ships the shared type rules and the labels use them', async () => {
  const page = await html();
  assert.match(page, /\.pa-caps/, 'the shared caps style is on the page');
  assert.match(page, /\.pa-num/, 'the shared numeral style is on the page');
  const label = rule(page, '.sc-label');
  assert.match(label, /font-weight:\s*var\(--strong-weight\)/);
  assert.doesNotMatch(label, /font-weight:\s*\d/, 'no literal weight');
  assert.match(rule(page, '.sc-label.pa-caps'), /color:\s*var\(--text\)/, 'caps labels stay at full text contrast over the canvas');
});

test('the legend and the toolbar buttons keep a hairline edge that reads over the canvas and on a grey fill', async () => {
  const page = await html();
  const host = page.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.pa-scene\s*\{([^{}]*)\}/)?.[1] ?? ''; // the first rule follows a <style> tag, which rule() would take for part of its selector
  const edge = host.match(/--sc-edge:\s*([^;]+);/)?.[1] ?? '';
  assert.match(edge, /color-mix\([^)]*var\(--text-3\)[^)]*var\(--line\)/, 'the edge is the line colour pulled towards the text, so it is stronger than --line');
  for (const control of ['.sc-legend', '.sc-btn']) assert.match(rule(page, control), /border:\s*1px solid var\(--sc-edge\)/, `${control} has its border back`);
});

test('panels sit on the surface with elevation, their controls one surface step up', async () => {
  const page = await html();
  for (const panel of ['.sc-legend', '.sc-tour']) {
    const body = rule(page, panel);
    assert.match(body, /background:\s*var\(--surface\)/, `${panel} is on the surface`);
    assert.match(body, /box-shadow:\s*var\(--elev-1\)/, `${panel} is lifted one step`);
  }
  for (const panel of ['.sc-explore', '.sc-tip']) assert.match(rule(page, panel), /box-shadow:\s*var\(--elev-2\)/, `${panel} floats higher`);
  assert.match(rule(page, '.sc-btn'), /background(?:-color)?:\s*var\(--surface-2\)/, 'a control is a step above its panel');
  assert.match(page, /@media print\s*\{[^@]*\.sc-bottom[^@]*\.sc-explore[^@]*\.sc-tip/s, 'the print rules hide the panels (legend and tour live in .sc-bottom), so no shadow prints');
});
