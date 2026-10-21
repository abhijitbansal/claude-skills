// P1 polish: theme colour tokens, elevated rects, round-cap and arrow lines, mono beating the title role,
// and the sharper chart defaults. Validation tests are pure; render tests need a browser and skip without one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { loadTheme } from '../shared/theme.mjs';

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}

const spec = (elements, extra = {}) => ({ size: [480, 270], scenes: [{ id: 's', duration: 2, elements }], ...extra });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const rect = (extra = {}) => ({ id: 'r', type: 'shape', shape: 'rect', x: 100, y: 100, width: 120, height: 60, ...extra });
const line = (extra = {}) => ({ id: 'l', type: 'shape', shape: 'line', x: 240, y: 135, width: 200, strokeWidth: 10, ...extra });

// Draw `motion` on the render page and return what `probe` (run in the page) found.
async function probed(motion, probe) {
  const dir = mkdtempSync(path.join(tmpdir(), 'polish-'));
  made.push(dir);
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const found = await page.evaluate(probe);
    assert.deepEqual(problems, []);
    return found;
  } finally { await browser.close(); await srv.close(); }
}

// ---- colour tokens: validation -----------------------------------------------------------------

test('colour tokens are accepted in fill, stroke and color; hex still is', () => {
  const m = spec([rect({ fill: 'surface', stroke: 'line' }), { id: 't', type: 'text', text: 'x', x: 1, y: 1, color: 'accentSoft' }, line({ id: 'l2', stroke: '#fff' })]);
  assert.deepEqual(errs(m), []);
  for (const token of ['surface', 'line', 'accent', 'accentSoft', 'good', 'bad', 'warn', 'text', 'text2', 'text3', 'cat1', 'cat6']) {
    assert.deepEqual(errs(spec([rect({ fill: token })])), [], token);
  }
});

test('an unknown token is rejected and the error names the token list', () => {
  const e = errs(spec([rect({ fill: 'accnt' })]));
  assert.equal(e.length, 1, e.join('\n'));
  assert.match(e[0], /^scenes\[0\]\.elements\[0\]\.fill: must be a CSS colour/);
  assert.match(e[0], /or a theme token: surface, line, accent, accentSoft, good, bad, warn, text, text2, text3, cat1, cat2, cat3, cat4, cat5, cat6$/);
});

test('background fields do not take tokens', () => {
  const m = spec([rect()], { background: 'surface' });
  m.scenes[0].background = 'accent';
  const e = errs(m);
  assert.ok(e.some((x) => x.startsWith('background: must be a CSS colour') && !x.includes('theme token')), e.join('\n'));
  assert.ok(e.some((x) => x.startsWith('scenes[0].background: must be a CSS colour')), e.join('\n'));
});

// ---- elevated, cap, arrow: validation ----------------------------------------------------------

test('elevated is for rects, cap and arrow for lines', () => {
  assert.deepEqual(errs(spec([rect({ elevated: true }), line({ cap: 'round', arrow: 'end' })])), []);
  const e = errs(spec([{ ...rect({ shape: 'ellipse' }), elevated: true }, rect({ id: 'r2', cap: 'round', arrow: 'end' })]));
  assert.ok(e.includes('scenes[0].elements[0].elevated: only valid on a rect shape'), e.join('\n'));
  assert.ok(e.includes('scenes[0].elements[1].cap: only valid on a line shape'), e.join('\n'));
  assert.ok(e.includes('scenes[0].elements[1].arrow: only valid on a line shape'), e.join('\n'));
  assert.deepEqual(errs(spec([line({ arrow: 'start' })])), ['scenes[0].elements[0].arrow: must be one of "end"']);
});

test('elevated, cap and arrow are not valid on text', () => {
  const e = errs(spec([{ id: 't', type: 'text', text: 'x', x: 1, y: 1, elevated: true, cap: 'round', arrow: 'end' }]));
  for (const key of ['elevated', 'cap', 'arrow']) assert.ok(e.some((x) => x.startsWith(`scenes[0].elements[0].${key}: not valid on text`)), e.join('\n'));
});

// ---- colour tokens: drawn ----------------------------------------------------------------------

test('tokens resolve from the active theme in shape fill, stroke and text colour', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const els = [rect({ fill: 'surface', stroke: 'cat3', strokeWidth: 2 }), { id: 't', type: 'text', text: 'x', x: 1, y: 1, color: 'good' }, line({ stroke: 'bad' })];
  for (const name of ['dusk', 'poster']) {
    const dark = loadTheme(name).dark;
    const found = await probed(spec(els, { theme: name }), () => ({
      fill: document.querySelector('.el.shape rect').getAttribute('fill'),
      stroke: document.querySelector('.el.shape rect').getAttribute('stroke'),
      color: getComputedStyle(document.querySelector('.el.text')).color,
      lineStroke: document.querySelector('.el.shape line').getAttribute('stroke'),
    }));
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    assert.equal(found.fill.toLowerCase(), dark.surface.toLowerCase(), name);
    assert.equal(found.stroke.toLowerCase(), dark.cat3.toLowerCase(), name);
    assert.equal(found.color, rgb(dark.good), name);
    assert.equal(found.lineStroke.toLowerCase(), dark.bad.toLowerCase(), name);
  }
  return undefined;
});

test('hex colours draw unchanged', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([rect({ fill: '#123456', stroke: 'tomato' })]), () => {
    const node = document.querySelector('.el.shape rect');
    return [node.getAttribute('fill'), node.getAttribute('stroke')];
  });
  assert.deepEqual(found, ['#123456', 'tomato']);
  return undefined;
});

// ---- elevated ----------------------------------------------------------------------------------

test('elevated adds one inset highlight rect after the main rect and lifts the fill toward the text colour', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([rect({ id: 'flat', fill: '#202020' }), rect({ id: 'up', x: 300, fill: '#202020', radius: 12, elevated: true })]), () => {
    const kids = (id) => [...document.querySelector(`[data-id="${id}"] svg`).children].map((n) => ({
      tag: n.tagName, fill: n.getAttribute('fill'), stroke: n.getAttribute('stroke'), sw: n.getAttribute('stroke-width'),
      x: n.getAttribute('x'), width: n.getAttribute('width'), rx: n.getAttribute('rx'),
    }));
    return { flat: kids('flat'), up: kids('up') };
  });
  assert.equal(found.flat.length, 1, 'a flat rect is still one node');
  assert.equal(found.up.length, 2, 'elevated adds exactly one node');
  const [main, glow] = found.up;
  assert.equal(main.tag, 'rect');
  assert.notEqual(main.fill, '#202020', 'the fill moved toward the text colour');
  assert.match(main.fill, /^color-mix\(in srgb, #202020, .+ \d+%\)$/);
  assert.equal(glow.stroke, 'rgba(255,255,255,.06)');
  assert.equal(glow.fill, 'none');
  assert.equal(glow.sw, '1');
  assert.ok(Number(glow.x) > Number(main.x), 'the highlight sits inside the rect');
  assert.ok(Number(glow.width) < Number(main.width));
  assert.ok(Number(glow.rx) < Number(main.rx), 'the inset corner radius shrinks with it');
  return undefined;
});

// ---- line cap and arrow ------------------------------------------------------------------------

test('a round cap insets both endpoints by half the stroke width; the default line is unchanged', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([line({ id: 'plain' }), line({ id: 'round', y: 200, cap: 'round' })]), () => {
    const read = (id) => {
      const n = document.querySelector(`[data-id="${id}"] line`);
      return { x1: n.getAttribute('x1'), x2: n.getAttribute('x2'), cap: n.getAttribute('stroke-linecap') };
    };
    return { plain: read('plain'), round: read('round') };
  });
  assert.deepEqual(found.plain, { x1: '0', x2: '200', cap: null });
  assert.deepEqual(found.round, { x1: '5', x2: '195', cap: 'round' });
  return undefined;
});

test('an arrow is a filled triangle at the line end, shown only once draw reaches 0.98', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const motion = spec([line({ arrow: 'end', keyframes: [{ t: 0, draw: 0 }, { t: 1, draw: 1 }] })]);
  const found = await probed(motion, () => {
    const head = () => document.querySelector('.el.shape path');
    const at = (sec) => { window.__motion.seek(sec); return head().getAttribute('opacity'); };
    const shape = head().getAttribute('d');
    return { count: document.querySelectorAll('.el.shape path').length, shape, fill: head().getAttribute('fill'), line: document.querySelector('.el.shape line').getAttribute('stroke'), start: at(0), mid: at(0.5), near: at(0.97), done: at(0.99), end: at(1.5) };
  });
  assert.equal(found.count, 1);
  assert.match(found.shape, /^M[\d.]+ [\d.-]+L200 [\d.-]+L[\d.]+ [\d.-]+Z$/, 'a closed triangle whose tip is at the line length');
  assert.equal(found.fill, found.line, 'the head takes the line colour');
  assert.deepEqual([found.start, found.mid, found.near], ['0', '0', '0']);
  assert.deepEqual([found.done, found.end], ['1', '1']);
  return undefined;
});

test('a line without arrow draws no path node', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const count = await probed(spec([line()]), () => document.querySelectorAll('.el.shape path').length);
  assert.equal(count, 0);
  return undefined;
});

// ---- mono precedence ---------------------------------------------------------------------------

test('font mono wins over role title: the mono face, mono weight and no title class', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([{ id: 'm', type: 'text', text: 'SELECT 1', x: 100, y: 100, role: 'title', font: 'mono', fontWeight: 800 }, { id: 'p', type: 'text', text: 'Plain title', x: 100, y: 200, role: 'title' }]), () => {
    const read = (id) => { const n = document.querySelector(`[data-id="${id}"]`); return { family: getComputedStyle(n).fontFamily, weight: n.style.fontWeight, classes: n.className }; };
    return { mono: read('m'), plain: read('p') };
  });
  assert.match(found.mono.family, /^"Commit Mono", /);
  assert.equal(found.mono.weight, '400', 'the one weight dusk ships for mono');
  assert.match(found.mono.classes, /\bmono\b/);
  assert.doesNotMatch(found.mono.classes, /\btitle\b/);
  assert.match(found.plain.family, /^"Funnel Display", /, 'a plain title keeps the display font');
  return undefined;
});

// ---- chart defaults ----------------------------------------------------------------------------

const BARS = { data: { values: ['a', 'b', 'c', 'd'].map((k, i) => ({ k, v: (i + 1) * 25 })) }, mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } };
const LINE = { data: { values: [1, 2, 3, 4, 5].map((k) => ({ k, v: k * k })) }, mark: { type: 'line', point: true }, encoding: { x: { field: 'k', type: 'quantitative' }, y: { field: 'v', type: 'quantitative' } } };
const chart = (id, vegaLite, extra = {}) => ({ id, type: 'chart', x: 240, y: 135, width: 440, height: 240, vegaLite, ...extra });

test('chart defaults: five-ish y ticks and gridlines, no tick marks, no y domain line', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([chart('c', BARS)]), () => {
    const n = (sel) => document.querySelectorAll(`.el.chart svg ${sel}`).length;
    const axis = (name) => `g.role-axis[aria-label^="${name}"]`;
    return { ticks: n('.role-axis-tick line'), grid: n('.role-axis-grid line'), xDomain: n(`${axis('X-axis')} .role-axis-domain line`), yDomain: n(`${axis('Y-axis')} .role-axis-domain line`) };
  });
  assert.equal(found.ticks, 0, 'no tick marks on either axis');
  assert.ok(found.grid >= 3 && found.grid <= 6, `gridlines: ${found.grid}`);
  assert.equal(found.yDomain, 0, 'no y domain line');
  assert.equal(found.xDomain, 1, 'the x baseline stays');
  return undefined;
});

test('chart defaults: wider band gap, rounder bars; line 4 px round; points ringed in the page colour', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([chart('bars', BARS), chart('lines', LINE, { y: 200 })]), () => {
    const bars = [...document.querySelectorAll('[data-id="bars"] svg .role-mark.marks path')].map((p) => p.getBoundingClientRect());
    const lineMark = document.querySelector('[data-id="lines"] svg .mark-line path');
    const symbol = document.querySelector('[data-id="lines"] svg .mark-symbol path');
    return {
      corner: document.querySelector('[data-id="bars"] svg clipPath path').getAttribute('d').split(',')[0],
      fill: bars[0].width / (bars[1].left - bars[0].left),
      stroke: lineMark.getAttribute('stroke-width'), cap: lineMark.getAttribute('stroke-linecap'), join: lineMark.getAttribute('stroke-linejoin'),
      ring: symbol.getAttribute('stroke'), ringWidth: symbol.getAttribute('stroke-width'),
    };
  });
  assert.equal(found.corner, 'M10', 'bar corner radius 10');
  assert.ok(Math.abs(found.fill - 0.7) < 0.01, `bandPaddingInner 0.3 leaves bars 70% of their step, got ${found.fill}`);
  assert.equal(found.stroke, '4');
  assert.equal(found.cap, 'round');
  assert.equal(found.join, 'round');
  assert.equal(found.ring.toLowerCase(), loadTheme('dusk').dark.page.toLowerCase(), 'the ring is the page colour');
  assert.equal(found.ringWidth, '3');
  return undefined;
});

test('chart reveal is a soft mask edge, not a hard clip, and is off once fully revealed', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const found = await probed(spec([chart('c', BARS, { keyframes: [{ t: 0, reveal: 0 }, { t: 1, reveal: 1 }] })]), () => {
    const node = document.querySelector('.el.chart');
    const at = (sec) => { window.__motion.seek(sec); return { mask: node.style.maskImage, clip: node.style.clipPath }; };
    return { start: at(0), mid: at(0.5), end: at(1.5) };
  });
  assert.match(found.mid.mask, /linear-gradient\(to right/);
  assert.equal(found.mid.clip, '');
  assert.match(found.start.mask, /linear-gradient/, 'a hidden chart stays fully masked');
  assert.ok(['none', ''].includes(found.end.mask), `fully revealed: ${found.end.mask}`);
  return undefined;
});
