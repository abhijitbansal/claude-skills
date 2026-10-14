// The story player: the Play story / Explore tabs, the transport, chapter and
// beat chips, the caption line, lighting and dimming, and the keyboard map.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle, viewBox, boxOf, holds, stageCentre } from './helpers/page.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name }));
const N = 9; // beats in the story example

const count = (page) => page.textContent('[data-pa-count]');
const line = (page) => page.textContent('[data-pa-line]');
const pressed = (page, sel) => page.getAttribute(sel, 'aria-pressed');
const dimmedNodes = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-node.pa-dim')].map((n) => n.dataset.id).sort());
const activeEdges = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-edge.pa-active')].map((e) => e.dataset.id));
const hasClass = (page, sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
const current = (page, attr) => page.evaluate((a) => document.querySelector(`[${a}][aria-current="true"]`)?.getAttribute(a) ?? null, attr);
const LINE_1 = '01 / 09 · PLACE THE ORDER · The shopper taps Buy — The app builds the order from the basket.';

test('the Play story tab enters the player on beat 1: count, caption line, chapter and beat chips, scrubber', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await page.isVisible('[data-pa-chapters]'), false);
  assert.equal(await pressed(page, '[data-pa-mode="explore"]'), 'true');
  await page.click('[data-pa-mode="play"]');
  assert.equal(await page.isVisible('[data-pa-caption]'), true);
  assert.equal(await pressed(page, '[data-pa-mode="play"]'), 'true');
  assert.equal(await pressed(page, '[data-pa-mode="explore"]'), 'false');
  assert.equal(await count(page), `1 / ${N}`);
  assert.equal(await line(page), LINE_1);
  assert.equal(await page.getAttribute('[data-pa-line]', 'aria-live'), 'polite');
  assert.deepEqual(await page.locator('[data-pa-chapter]').allTextContents(), ['Place the order', 'Fulfil it']);
  assert.equal(await current(page, 'data-pa-chapter'), '0');
  assert.equal(await page.locator('[data-pa-beat]').count(), N);
  assert.equal(await page.textContent('[data-pa-beat="1"]'), '02 The app calls the API');
  assert.equal(await current(page, 'data-pa-beat'), '0');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'max'), String(N - 1));
  assert.equal(await page.inputValue('[data-pa-scrub]'), '0');
  assert.equal(await page.locator('[data-pa-ticks] option').count(), N);
  await page.click('[data-pa-mode="explore"]');
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await pressed(page, '[data-pa-mode="play"]'), 'false');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a hop beat lights its edge and both ends, dims the rest, and the camera holds both ends with 48 px around', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await settle(page);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  assert.deepEqual(await dimmedNodes(page), ['bus', 'db', 'gateway', 'orders', 'warehouse']);
  assert.equal(await page.locator('.pa-edge.pa-dim').count(), 6, 'every other edge dims');
  assert.equal(await page.locator('.pa-edge-label.pa-dim').count(), 6, 'and its label with it');
  assert.equal(await page.locator('.pa-node.pa-hl').count(), 0, 'a hop does not outline its ends');
  assert.ok(holds(await viewBox(page), await boxOf(page, ['shopper', 'app'])), 'the camera fits both ends');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  assert.deepEqual(await activeEdges(page), ['place']);
  assert.deepEqual(await dimmedNodes(page), ['bus', 'db', 'orders', 'shopper', 'warehouse']);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['app', 'gateway'])));
  // db sits outside the camera's view for this beat, so a real mouse cannot reach it: send the pointer event the page listens for
  await page.dispatchEvent('.pa-node[data-id="db"]', 'pointerover');
  assert.deepEqual(await activeEdges(page), ['place'], 'hovering in Play changes nothing');
  assert.deepEqual(await dimmedNodes(page), ['bus', 'db', 'orders', 'shopper', 'warehouse'], 'and the trace stays off');
  assert.equal(await page.locator('.pa-on').count(), 0);
  await page.dispatchEvent('.pa-node[data-id="db"]', 'pointerleave'); // so no hover trace repaints once Play ends
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pa-dim, .pa-active, .pa-hl').count(), 0, 'leaving clears the lighting');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a focus beat on a group lights the group, its members and the edges between them', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.keyboard.press('End');
  await settle(page);
  assert.equal(await count(page), `${N} / ${N}`);
  assert.equal(await line(page), '09 / 09 · FULFIL IT · The whole core — Three services, one database, one bus.');
  assert.ok(await hasClass(page, '.pa-group[data-id="core"]', 'pa-hl'));
  assert.deepEqual(await dimmedNodes(page), ['app', 'gateway', 'shopper', 'warehouse']);
  assert.equal(await page.locator('.pa-node.pa-hl').count(), 3, 'orders, db and bus are lit');
  const lit = await page.evaluate(() => [...document.querySelectorAll('.pa-edge:not(.pa-dim)')].map((e) => e.dataset.id).sort());
  assert.deepEqual(lit, ['edge-3', 'edge-4'], 'orders -> db and orders -> bus sit inside the core');
  assert.deepEqual(await activeEdges(page), [], 'no travelling edge on a focus shot');
  assert.ok(holds(await viewBox(page), await boxOf(page, ['core'])));
  assert.deepEqual(problems, []);
  await context.close();
});

test('keys: arrows and PageDown step, Home and End jump, P enters Play and is idle inside it, E and Escape leave', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '2 / 9');
  await page.keyboard.press('PageDown');
  assert.equal(await count(page), '3 / 9');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '2 / 9');
  await page.keyboard.press('End');
  assert.equal(await count(page), '9 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '9 / 9', 'clamped at the last beat');
  await page.keyboard.press('Home');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '1 / 9', 'clamped at the first beat');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('p');
  assert.equal(await count(page), '2 / 9', 'P inside Play does nothing');
  await page.keyboard.press('e');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'E leaves to Explore');
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 9', 'P starts over at beat 1');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'Escape leaves too');
  assert.equal(await page.locator('.pa-dim').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('chapter chips and the chapter buttons jump between stories; beat chips jump to a beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.click('[data-pa-chapter="1"]');
  assert.equal(await count(page), '7 / 9');
  assert.ok((await line(page)).startsWith('07 / 09 · FULFIL IT · '));
  assert.equal(await current(page, 'data-pa-chapter'), '1');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '1 / 9', "from a chapter's first beat, the chapter before");
  await page.click('[data-pa-next-chapter]');
  assert.equal(await count(page), '7 / 9');
  await page.click('[data-pa-next]');
  assert.equal(await count(page), '8 / 9');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '7 / 9', 'from inside a chapter, its first beat');
  await page.click('[data-pa-next-chapter]');
  assert.equal(await count(page), '9 / 9', 'past the last chapter, the last beat');
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  await page.click('[data-pa-beat="3"]');
  assert.equal(await count(page), '4 / 9');
  assert.equal(await current(page, 'data-pa-beat'), '3');
  assert.equal(await page.isDisabled('[data-pa-prev]'), false);
  await page.click('[data-pa-prev]');
  assert.equal(await count(page), '3 / 9');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the scrubber jumps to a beat and follows the beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.locator('[data-pa-scrub]').evaluate((el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await count(page), '5 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.inputValue('[data-pa-scrub]'), '5');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-label'), 'Beat');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the older steps form plays as one Walkthrough chapter: reveal as before, no dimming, "Beat n / N"', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.keyboard.press('p');
  assert.deepEqual(await page.locator('[data-pa-chapter]').allTextContents(), ['Walkthrough']);
  assert.equal(await line(page), '01 / 03 · WALKTHROUGH · The browser calls the API — TLS ends at the load balancer.');
  assert.equal(await page.textContent('.cap-count'), 'Beat 1 / 3');
  assert.equal(await page.locator('.pa-dim').count(), 0, 'step beats hide, they do not dim');
  assert.ok((await page.locator('.pa-hidden').count()) > 0);
  await page.keyboard.press('ArrowRight');
  assert.equal(await line(page), '02 / 03 · WALKTHROUGH · The API writes the order', 'no caption, no dash');
  assert.ok(await hasClass(page, '.pa-node[data-id="db"]', 'pa-hl'));
  assert.deepEqual(problems, []);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`the story example plays at ${width} px with no console problems and no overflow`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { width, height: width === 390 ? 780 : 800 });
    await page.keyboard.press('p');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth <= window.innerWidth, h: document.documentElement.scrollHeight <= window.innerHeight }));
    assert.ok(fit.w, 'no horizontal overflow');
    assert.ok(fit.h, 'no vertical overflow');
    assert.ok((await viewBox(page)).every(Number.isFinite));
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('hostile text in story and beat titles and captions renders as text in the chips and the caption line', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const evil = '<b>&"x"';
  const spec = {
    title: 'Evil story', type: 'flow',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
    stories: [{ id: 's', title: evil, beats: [{ title: evil, caption: evil, from: 'a', to: 'b' }] }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'evil-story' }).url);
  await page.keyboard.press('p');
  assert.equal(await page.locator('b').count(), 0);
  assert.equal(await line(page), `01 / 01 · ${evil.toUpperCase()} · ${evil} — ${evil}`);
  assert.equal(await page.textContent('[data-pa-beat="0"]'), `01 ${evil}`);
  assert.equal(await page.textContent('[data-pa-chapter="0"]'), evil);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a one-beat story: prev and next clamp, the scrubber has max 0, the chapter buttons stay put', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'One beat', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: 'go' }], stories: [{ id: 's', title: 'S', beats: [{ title: 'Only', edge: 'edge-0' }] }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'one-beat' }).url);
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 1');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'max'), '0');
  for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
    await page.keyboard.press(key);
    assert.equal(await count(page), '1 / 1', key);
  }
  await page.click('[data-pa-next-chapter]');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '1 / 1');
  assert.equal(await page.isDisabled('[data-pa-prev]'), true);
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('exports carry no story state: no pa-active, no pa-dim, no pa-hl', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowRight');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  // the embedded stylesheet names these classes; no element may carry them
  assert.ok(!/class="[^"]*\bpa-(active|dim|hl|dot)\b/.test(text), 'no viewer state on any element');
  assert.ok(!/<circle[^>]*pa-dot/.test(text), 'no dot element');
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- play -------------------------------------------------------------------------------------

const playing = (page) => page.evaluate(() => document.getElementById('pa-stage').classList.contains('pa-playing'));
const dotAt = (page) => page.evaluate(() => { const d = document.querySelector('.pa-dot.pa-dot-on'); return d ? { x: Number(d.getAttribute('cx')), y: Number(d.getAttribute('cy')) } : null; });
const centreOf = (page, id) => page.evaluate((i) => { const b = JSON.parse(document.getElementById('pa-data').textContent).boxes[i]; return { x: b[0] + b[2] / 2, y: b[1] + b[3] / 2 }; }, id);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const waitCount = (page, text) => page.waitForFunction((want) => document.querySelector('[data-pa-count]').textContent === want, text, { timeout: 10000 });
const waitPlaying = (page, want) => page.waitForFunction((w) => document.getElementById('pa-stage').classList.contains('pa-playing') === w, want, { timeout: 10000 });
const waitDotOn = (page) => page.waitForFunction(() => !!document.querySelector('.pa-dot.pa-dot-on'), null, { timeout: 5000 });
const waitDotMoved = (page, from) => page.waitForFunction(([x, y]) => { const d = document.querySelector('.pa-dot'); return Math.hypot(Number(d.getAttribute('cx')) - x, Number(d.getAttribute('cy')) - y) > 15; }, [from.x, from.y], { timeout: 5000 });

test('Space plays and pauses, the Play button mirrors it, speed cycles 1×, 1.5×, 2×, 0.5×, loop toggles', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await playing(page), false);
  assert.equal(await page.getAttribute('[data-pa-play]', 'aria-pressed'), null, 'a button whose label says Play or Pause carries no aria-pressed');
  assert.equal(await page.textContent('[data-pa-play]'), 'Play');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  assert.equal(await page.textContent('[data-pa-play]'), 'Pause');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.equal(await page.textContent('[data-pa-play]'), 'Play');
  await page.click('[data-pa-play]');
  assert.equal(await playing(page), true);
  await page.click('[data-pa-play]');
  assert.equal(await playing(page), false);
  assert.equal(await page.textContent('[data-pa-speed]'), '1×');
  for (const next of ['1.5×', '2×', '0.5×', '1×']) {
    await page.click('[data-pa-speed]');
    assert.equal(await page.textContent('[data-pa-speed]'), next);
  }
  await page.evaluate(() => document.activeElement.blur()); // later Space presses must reach the stage, not the button
  assert.equal(await pressed(page, '[data-pa-loop]'), 'false');
  await page.click('[data-pa-loop]');
  assert.equal(await pressed(page, '[data-pa-loop]'), 'true');
  assert.deepEqual(problems, []);
  await context.close();
});

test('play advances beats at 2× and stops on the last beat; with loop on it starts over', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.click('[data-pa-speed]');
  await page.click('[data-pa-speed]');
  assert.equal(await page.textContent('[data-pa-speed]'), '2×');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '8 / 9');
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take Space itself
  await page.keyboard.press('Space');
  await waitCount(page, '9 / 9');
  await waitPlaying(page, false);
  assert.equal(await count(page), '9 / 9', 'the timeline stops on the last beat');
  await page.click('[data-pa-loop]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await waitCount(page, '1 / 9');
  assert.equal(await playing(page), true, 'loop keeps going');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the dot travels along the hop edge from its start, and backwards for a reverse hop', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×: glide 1200 ms, dot 2400 ms
  assert.equal(await page.textContent('[data-pa-speed]'), '0.5×');
  const shopper = await centreOf(page, 'shopper');
  const app = await centreOf(page, 'app');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft'); // beat 1 again, now at 0.5×
  await waitDotOn(page);
  const p1 = await dotAt(page);
  await waitDotMoved(page, p1);
  const p2 = await dotAt(page);
  assert.ok(dist(p1, shopper) < dist(p2, shopper) && dist(p2, app) < dist(p1, app), `forward, shopper -> app: ${JSON.stringify([p1, p2])}`);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '6 / 9');
  await waitDotOn(page);
  const r1 = await dotAt(page);
  await waitDotMoved(page, r1);
  const r2 = await dotAt(page);
  assert.ok(dist(r1, app) < dist(r2, app) && dist(r2, shopper) < dist(r1, shopper), `reverse, app -> shopper: ${JSON.stringify([r1, r2])}`);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  await page.keyboard.press('End');
  await settle(page);
  assert.equal(await dotAt(page), null, 'a focus beat has no dot');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a pointer on the canvas pauses: click, wheel and drag; the beat stays', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  const c = await stageCentre(page);
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  await page.mouse.click(c.x, c.y + 60);
  assert.equal(await playing(page), false, 'a click pauses');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Space');
  await page.mouse.move(c.x, c.y + 60);
  await page.mouse.wheel(0, 120);
  assert.equal(await playing(page), false, 'the wheel pauses');
  await page.keyboard.press('Space');
  await page.mouse.move(c.x, c.y + 200);
  await page.mouse.down();
  await page.mouse.move(c.x + 80, c.y + 200, { steps: 4 });
  await page.mouse.up();
  assert.equal(await playing(page), false, 'a drag pauses');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Space');
  for (const k of ['Tab', 'Shift', 'CapsLock']) {
    await page.keyboard.press(k);
    assert.equal(await playing(page), true, `${k} moves focus or modifies; it does not pause`);
  }
  await page.keyboard.press('f');
  assert.equal(await playing(page), false, 'any other key but Space pauses');
  assert.equal(await page.locator('.pa-dot.pa-dot-on').count(), 0, 'pausing hides the dot');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Space on a focused transport control is play/pause, not the control; Enter still activates it; a toolbar button keeps Space', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.focus('[data-pa-next]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on Next plays');
  assert.equal(await count(page), '1 / 9', 'and does not step');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.equal(await count(page), '1 / 9');
  await page.focus('[data-pa-play]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on Play toggles once, not twice');
  assert.equal(await page.textContent('[data-pa-play]'), 'Pause');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  await page.keyboard.press('Enter');
  assert.equal(await playing(page), true, 'Enter on Play plays');
  await page.keyboard.press('Enter');
  assert.equal(await playing(page), false, 'and Enter on Pause pauses, not pause-then-play');
  assert.equal(await page.textContent('[data-pa-play]'), 'Play');
  await page.focus('[data-pa-beat="2"]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on a beat chip plays');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Enter');
  assert.equal(await count(page), '3 / 9', 'Enter activates the chip');
  assert.equal(await playing(page), false, 'and, as any key but Space, pauses');
  await page.focus('[data-pa-mode="explore"]');
  await page.keyboard.press('Space');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'outside the transport the button wins: the Explore tab leaves Play');
  assert.deepEqual(problems, []);
  await context.close();
});

test('arrow keys on the scrubber move the beat and pause; the scrubber announces the beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-valuetext'), 'Beat 1 of 9');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  await page.focus('[data-pa-scrub]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '2 / 9', 'the arrow moved the beat');
  assert.equal(await playing(page), false, 'and paused');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-valuetext'), 'Beat 2 of 9');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on the focused scrubber plays: a range has no Space action of its own');
  await page.evaluate(() => { const r = document.querySelector('[data-pa-scrub]'); r.value = '4'; r.dispatchEvent(new Event('input', { bubbles: true })); }); // a pointer drag fires input with no key
  assert.equal(await count(page), '5 / 9', 'a scrub by pointer jumps');
  assert.equal(await playing(page), false, 'and pauses');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a hop beat dims the groups it does not touch and keeps the group around a lit end', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await settle(page);
  const dimmedGroups = await page.evaluate(() => [...document.querySelectorAll('.pa-group.pa-dim')].map((g) => g.dataset.id).sort());
  assert.deepEqual(dimmedGroups, ['core'], 'shopper -> app: "edge" holds app, "core" holds neither end');
  await page.keyboard.press('e');
  assert.equal(await page.locator('.pa-group.pa-dim').count(), 0, 'leaving Play undims every group');
  assert.deepEqual(problems, []);
  await context.close();
});

test('autoplay starts the story playing with loop on; a #step-N link wins; reduced motion leaves it off and drops the dot', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ ...example('story'), autoplay: true }, { name: 'story-autoplay' });
  const auto = await openPage(url);
  assert.equal(await playing(auto.page), true);
  assert.equal(await pressed(auto.page, '[data-pa-loop]'), 'true');
  assert.match(await count(auto.page), /^\d \/ 9$/);
  await auto.page.keyboard.press('Space');
  assert.equal(await playing(auto.page), false);
  assert.deepEqual(auto.problems, []);
  await auto.context.close();

  const linked = await openPage(url, { hash: '#step-3' });
  assert.equal(await count(linked.page), '3 / 9');
  assert.equal(await playing(linked.page), false, 'a deep link opens paused on its beat');
  await linked.context.close();

  const reduced = await openPage(url, { reducedMotion: 'reduce' });
  assert.equal(await reduced.page.isVisible('[data-pa-caption]'), false, 'autoplay is ignored');
  await reduced.page.keyboard.press('p');
  assert.ok(holds(await viewBox(reduced.page), await boxOf(reduced.page, ['shopper', 'app'])), 'the camera jumped at once');
  await reduced.page.keyboard.press('Space');
  await waitCount(reduced.page, '2 / 9');
  assert.equal(await reduced.page.locator('.pa-dot.pa-dot-on').count(), 0, 'no dot under reduced motion');
  await reduced.page.keyboard.press('Space');
  assert.deepEqual(reduced.problems, []);
  await reduced.context.close();
});

test('a one-beat story plays to its end at once and loops when asked', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'One beat', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }], stories: [{ id: 's', title: 'S', beats: [{ title: 'Only', edge: 'edge-0' }] }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'one-beat-play' }).url);
  await page.keyboard.press('p');
  await page.click('[data-pa-speed]');
  await page.click('[data-pa-speed]'); // 2×: glide 300, dot 600, hold 1250
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take Space itself
  await page.keyboard.press('Space');
  await waitPlaying(page, false);
  assert.equal(await count(page), '1 / 1');
  await page.click('[data-pa-loop]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForTimeout(5000); // two full cycles at 2×: still looping (the one fixed wait in this suite; it asserts persistence, not arrival)
  assert.equal(await playing(page), true);
  await page.keyboard.press('Space');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a sequence hop low in the diagram frames its message, not just the participant headers', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const messages = Array.from({ length: 14 }, (_, i) => ({ id: `m${i + 1}`, from: i % 2 ? 'b' : 'a', to: i % 2 ? 'a' : 'b', label: `step ${i + 1}` }));
  const spec = {
    title: 'Long sequence', type: 'sequence',
    participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    messages,
    stories: [{ id: 's', title: 'S', beats: [{ title: 'Late', edge: 'm13' }] }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'sequence-story' }).url, { width: 1280, height: 600 });
  await page.keyboard.press('p');
  await settle(page);
  assert.deepEqual(await activeEdges(page), ['m13']);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['m13'])), 'the camera holds the lit message');
  assert.deepEqual(problems, []);
  await context.close();
});
