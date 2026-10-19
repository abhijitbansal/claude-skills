import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const rows = [
  { group: 'api', t: '2026-W30', value: 12 }, { group: 'web', t: '2026-W30', value: 5 },
  { group: 'api', t: '2026-W31', value: 7 }, { group: 'web', t: '2026-W31', value: 9 },
];
const doc = () => ({
  title: 'Doc',
  sections: [{ type: 'text', title: 'Before', text: 'Intro.' }, { type: 'scene', title: 'The city', scene: { title: 'Commits', world: 'city', data: { rows } } }],
});

// make-scene's full-screen fallback (requestFullscreen unavailable: iPhone Safari, sandboxed iframes) adds .sc-fill to the host.
// The card's own rule for the host must not outrank it, or the fill never leaves the 16:9 frame.
test('a scene host in fill mode is position: fixed inside the explainer card', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser (bundled Chromium or system Chrome)');
  const built = buildSpec(doc());
  const { page, context } = await openPage(built.url);
  try {
    const positions = await page.evaluate(() => {
      const host = document.querySelector('.sc-frame .pa-scene');
      const before = getComputedStyle(host).position;
      host.classList.add('sc-fill');
      return { before, after: getComputedStyle(host).position };
    });
    assert.equal(positions.before, 'absolute', 'in the card the host fills the frame');
    assert.equal(positions.after, 'fixed', 'in fill mode the host leaves the frame');
  } finally {
    await context.close();
  }
});

// A flavored theme gives every .sec its own stacking context (isolation: isolate), which traps the fixed full-screen
// host inside its section: a later section, painted after it, would cover the "full screen" scene. In fill mode the
// section must rejoin the page's stacking order on top.
const FLAVORED = ['dusk', 'press', 'poster'];
const filler = (n) => ({ type: 'text', title: `Later section ${n}`, text: 'Words that fill the viewport. '.repeat(40) });
const fillDoc = (theme) => ({
  title: 'Doc',
  theme,
  sections: [
    { type: 'text', title: 'Before', text: 'Intro. '.repeat(40) },
    doc().sections[1],
    filler(1),
    filler(2),
  ],
});

for (const theme of FLAVORED) {
  test(`${theme}: a scene host in fill mode is the topmost thing at the centre, the bottom centre and the four inner corners, over later sections`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser (bundled Chromium or system Chrome)');
    const built = buildSpec(fillDoc(theme), { name: `fill-${theme}` });
    const { page, context } = await openPage(built.url, { width: 1000, height: 700 });
    try {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.flavor), theme, 'the flavored theme is on');
      const hits = await page.evaluate(() => {
        const host = document.querySelector('.sc-frame .pa-scene');
        // Scrolled so the next section starts at 40% of the viewport: the later sections paint across its lower part.
        const next = [...document.querySelectorAll('.sec')].find((s) => s.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_PRECEDING);
        window.scrollBy(0, next.getBoundingClientRect().top - window.innerHeight * 0.4);
        host.classList.add('sc-fill');
        const w = window.innerWidth;
        const h = window.innerHeight;
        const inset = 12;
        const points = { centre: [w / 2, h / 2], bottomCentre: [w / 2, h - inset], topLeft: [inset, inset], topRight: [w - inset, inset], bottomLeft: [inset, h - inset], bottomRight: [w - inset, h - inset] };
        const laterTop = next.getBoundingClientRect().top;
        return {
          laterTop,
          viewport: h,
          at: Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
            const el = document.elementFromPoint(x, y);
            return [name, el === host || host.contains(el) ? 'host' : `${el?.tagName}.${el?.className}`];
          })),
        };
      });
      assert.ok(hits.laterTop < hits.viewport, `a later section paints inside the viewport (top ${Math.round(hits.laterTop)}px of ${hits.viewport}px)`);
      assert.deepEqual(hits.at, { centre: 'host', bottomCentre: 'host', topLeft: 'host', topRight: 'host', bottomLeft: 'host', bottomRight: 'host' });
    } finally {
      await context.close();
    }
  });
}
