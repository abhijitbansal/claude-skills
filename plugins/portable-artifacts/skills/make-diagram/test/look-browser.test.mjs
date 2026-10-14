// The look in a real browser: the dark glow against the light thickness, the
// tinted cards, the tile and emoji, a tone over a hue, the canvas, the lanes and
// the legend. Screenshots land in the scratch dir: look at them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildPage, example, scratchDir } from './helpers/browser.mjs';
import { contrastRatio } from '../shared/contrast.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `look-${name}` }));
const styleOf = (page, sel, props) => page.evaluate(([s, ps]) => { const c = getComputedStyle(document.querySelector(s)); return Object.fromEntries(ps.map((p) => [p, c[p]])); }, [sel, props]);
// A theme variable as the browser serialises a colour (rgb(...)), to compare with computed styles.
const varColour = (page, name) => page.evaluate((n) => { const s = document.createElement('span'); s.style.color = `var(${n})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name);
const waitDotOn = (page) => page.waitForFunction(() => !!document.querySelector('.pa-dot.pa-dot-on'), null, { timeout: 5000 });

for (const colorScheme of ['light', 'dark']) {
  test(`${colorScheme}: the active edge is thicker than a plain one; dark glows it and the dot, light does not (screenshot look-${colorScheme}.png)`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { colorScheme });
    const plain = await styleOf(page, '.pa-edge[data-id="place"] .pa-wire', ['strokeWidth', 'filter', 'stroke']);
    assert.equal(plain.filter, 'none');
    assert.equal(plain.stroke, await varColour(page, '--k-service'), 'app (client) -> gateway takes the service hue');
    await page.screenshot({ path: path.join(scratchDir(), `look-${colorScheme}.png`) });
    await page.keyboard.press('p');
    for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×: the dot shows for 2.4 s
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft'); // beat 1 again, now at 0.5×
    const active = await styleOf(page, '.pa-edge.pa-active .pa-wire', ['strokeWidth', 'filter', 'stroke']);
    const accent = await varColour(page, '--accent');
    assert.equal(active.stroke, accent, 'the active edge takes the accent');
    assert.ok(parseFloat(active.strokeWidth) > parseFloat(plain.strokeWidth), 'thicker, not only recoloured');
    await waitDotOn(page);
    const dot = await styleOf(page, '.pa-dot.pa-dot-on', ['filter', 'fill']);
    if (colorScheme === 'dark') {
      assert.equal(active.strokeWidth, '2.5px');
      assert.match(active.filter, /drop-shadow/);
      assert.match(dot.filter, /drop-shadow/);
      assert.equal(dot.fill, await varColour(page, '--glow'));
    } else {
      assert.equal(active.strokeWidth, '3px');
      assert.equal(active.filter, 'none');
      assert.equal(dot.filter, 'none');
      assert.equal(dot.fill, accent);
    }
    await page.screenshot({ path: path.join(scratchDir(), `look-${colorScheme}-beat.png`) });
    await page.keyboard.press('Escape');
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('cards: tinted by family, the tile inside the card and the emoji inside the tile, the type line in the hue, a tone over it, a mono note', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  const fill = async (id) => (await styleOf(page, `.pa-node[data-id="${id}"] .pa-shape`, ['fill'])).fill;
  assert.notEqual(await fill('orders'), await fill('db'), 'service and data differ');
  assert.notEqual(await fill('orders'), await varColour(page, '--surface'), 'a tint, not the bare surface');
  assert.equal(await fill('orders'), await fill('gateway'), 'one family, one tint');
  assert.notEqual((await styleOf(page, '.pa-node[data-id="orders"] .pa-tile', ['fill'])).fill, await fill('orders'), 'the tile is a stronger tint');
  const inside = await page.evaluate(() => {
    const n = document.querySelector('.pa-node[data-id="orders"]');
    const box = (sel) => n.querySelector(sel).getBBox();
    const within = (a, b, tol) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.width <= b.x + b.width + tol && a.y + a.height <= b.y + b.height + tol;
    const shape = box('.pa-shape');
    const tile = box('.pa-tile');
    // An emoji font's line box (ascent + descent) is taller than the glyph, so the emoji is checked by its centre, not its box.
    const emoji = box('.pa-emoji');
    const centred = Math.abs(emoji.x + emoji.width / 2 - (tile.x + tile.width / 2)) <= 3 && Math.abs(emoji.y + emoji.height / 2 - (tile.y + tile.height / 2)) <= 3;
    return { tileInShape: within(tile, shape, 0.5), emojiInTile: centred, typeInShape: within(box('.pa-type'), shape, 0.5), typeText: n.querySelector('.pa-type').textContent };
  });
  assert.deepEqual(inside, { tileInShape: true, emojiInTile: true, typeInShape: true, typeText: 'SERVICE' });
  assert.equal((await styleOf(page, '.pa-node[data-id="orders"] .pa-type', ['fill'])).fill, await varColour(page, '--k-service'));
  const warn = await varColour(page, '--warn');
  assert.deepEqual(await styleOf(page, '.pa-node[data-id="warehouse"] .pa-shape', ['stroke', 'strokeWidth']), { stroke: warn, strokeWidth: '2px' }, 'the tone border wins over the external hue');
  assert.equal((await styleOf(page, '.pa-node[data-id="warehouse"] .pa-type', ['fill'])).fill, await varColour(page, '--k-external'), 'a tone leaves the type line in the kind hue');
  assert.equal((await styleOf(page, '.pa-edge[data-id="edge-5"] .pa-wire', ['stroke'])).stroke, await varColour(page, '--k-queue'), 'bus -> warehouse takes the queue hue');
  assert.match((await styleOf(page, '.pa-node[data-id="gateway"] .pa-note', ['fontFamily'])).fontFamily, /Mono/);
  assert.deepEqual(problems, []);
  await context.close();
});

// A computed colour (rgb(r, g, b) or color(srgb r g b)) as #rrggbb.
const toHex = (c) => {
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  const [r, g, b] = m ? m[1].split(/[ ,/]+/).slice(0, 3).map(Number) : c.match(/^color\(srgb ([^)]+)\)$/)[1].split(' ').slice(0, 3).map((v) => Math.round(Number(v) * 255));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

for (const colorScheme of ['light', 'dark']) {
  test(`${colorScheme}: a tone leaves the kind label as readable as an untoned card's (paper, >= 4.5:1 on the card)`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const spec = example('architecture');
    const withTwin = { ...spec, nodes: [...spec.nodes, { id: 'twin', label: 'Untoned twin', kind: 'external' }] };
    const { page, problems, context } = await openPage(buildPage(withTwin, { name: `tone-${colorScheme}` }).url, { colorScheme });
    const fillOf = async (id, part) => (await styleOf(page, `.pa-node[data-id="${id}"] .${part}`, ['fill'])).fill;
    assert.equal(await fillOf('pay', 'pa-type'), await fillOf('twin', 'pa-type'), 'the toned node keeps the kind label colour of an untoned one');
    const ratio = contrastRatio(toHex(await fillOf('pay', 'pa-type')), toHex(await fillOf('pay', 'pa-shape')));
    assert.ok(ratio >= 4.5, `kind label on the toned card is ${ratio.toFixed(2)}:1`);
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('the canvas is a dotted grid in light and a glow with faint lines in dark; lanes and the legend are drawn; nothing overflows at 390 px', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const light = await openPage(built('architecture').url, { colorScheme: 'light' });
  const dark = await openPage(built('architecture').url, { colorScheme: 'dark' });
  const bg = (p) => p.evaluate(() => getComputedStyle(document.getElementById('pa-stage')).backgroundImage);
  const lightBg = await bg(light.page);
  const darkBg = await bg(dark.page);
  assert.match(lightBg, /radial-gradient/);
  assert.ok(!/linear-gradient/.test(lightBg), 'light: dots only');
  assert.match(darkBg, /radial-gradient[\s\S]*linear-gradient/, 'dark: the glow wash and the grid lines');
  assert.equal(await light.page.locator('.pa-legend .pa-swatch').count(), 4);
  assert.equal(await light.page.locator('.pa-legend .pa-legend-sample').count(), 3);
  assert.equal(await light.page.locator('.pa-group[data-lane="0"] .pa-lane').count(), 1);
  assert.equal((await styleOf(light.page, '.pa-lane', ['fill'])).fill, await varColour(light.page, '--s1'));
  assert.deepEqual([light.problems, dark.problems], [[], []]);
  await light.context.close();
  await dark.context.close();
  const phone = await openPage(built('story').url, { width: 390, height: 780 });
  const fit = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(fit.sw <= fit.iw, `no horizontal overflow: ${fit.sw} <= ${fit.iw}`);
  assert.deepEqual(phone.problems, []);
  await phone.context.close();
});
