// The `media` kind: a still photo full bleed or as a cut-out, treated in the look's duotone or halftone, with a caption
// that arrives with the narration and a small credit. Clips are refused until the engine can seek video frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { coverCrop } from '../../engine/kinds/media-layout.mjs';
import { driftReach } from '../../engine/kinds/camera.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { expandShot, expandSecond, all, filmOf, canvasOf } from './helpers/kinds.mjs';
import { assertBar, drawnLeaves } from './helpers/bar.mjs';

const media = registries.kinds.get('media');
const SAY = 'This is the harbour at dawn, before the boats go out.';
const LOOKS = ['desk', 'pop'];
const FORMATS = ['16:9', '9:16'];
const treatmentOf = (look) => (look === 'pop' ? 'halftone' : 'duotone');
const example = () => ({ ...media.example, src: 'shot.png' });
const full = (look, fit) => ({ id: 'm', show: 'media', src: 'shot.png', say: SAY, fit, treatment: treatmentOf(look), focus: [0.4, 0.6], caption: 'The harbour at dawn', credit: 'Photo: the author' });
const errorsOf = (shot, extra = {}, dir = '.') => validateFilm({ version: 2, shots: [shot], ...extra }, { specDir: dir }).errors;

// ---- validation ----

test('a clip validates (its file is probed later, by the clips stage: clips.test.mjs); an unknown extension names stills and clips', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-media-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'clip.mp4'), 'not a picture');
  writeFileSync(path.join(dir, 'clip.avi'), 'not a picture');
  assert.deepEqual(errorsOf({ id: 'm', show: 'media', src: 'clip.mp4', hold: 2 }, {}, dir), []);
  assert.deepEqual(errorsOf({ id: 'm', show: 'media', src: 'clip.avi', hold: 2 }, {}, dir), [
    { path: 'shots[0].src', message: 'must be a still (png, jpg, jpeg, webp, gif) or a clip (mp4, mov, m4v, webm, mkv), got "clip.avi"' },
  ]);
});

test('focus must be fractions from 0 to 1, and a treatment the look lacks names the ones it has', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-media-'));
  try {
    writeFileSync(path.join(dir, 'p.png'), 'x');
    const shot = { id: 'm', show: 'media', src: 'p.png', hold: 2 };
    assert.deepEqual(errorsOf({ ...shot, focus: [1.2, 0.5] }, {}, dir), [{ path: 'shots[0].focus[0]', message: 'must be from 0 to 1' }]);
    assert.deepEqual(errorsOf({ ...shot, treatment: 'duotone' }, { mode: 'viral', look: 'pop' }, dir), [{ path: 'shots[0].treatment', message: 'the pop look has no "duotone"; it has: none, halftone' }]);
    assert.ok(errorsOf({ ...shot, caption: 'x'.repeat(61) }, {}, dir).some((e) => e.path === 'shots[0].caption'), 'a caption is at most 60 characters');
    assert.ok(errorsOf({ ...shot, credit: 'x'.repeat(41) }, {}, dir).some((e) => e.path === 'shots[0].credit'), 'a credit is at most 40 characters');
    assert.deepEqual(errorsOf({ ...shot, fit: 'cutout', treatment: 'none', caption: 'The harbour', credit: 'Photo: me', focus: [0, 1] }, {}, dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the cover crop ----

test('the cover crop fills the frame and keeps the focus inside it (hand-computed)', () => {
  const wide = { width: 1600, height: 1000 }, tall = { width: 1000, height: 1600 };
  const W = { w: 1920, h: 1080 }, T = { w: 1080, h: 1920 };
  assert.deepEqual(coverCrop(wide, W, [0.5, 0.5]), [0, 50, 1600, 900]); // 1600 / (16/9) = 900 tall, centred
  assert.deepEqual(coverCrop(wide, W, [0.5, 0.95]), [0, 100, 1600, 900]); // clamped at the bottom
  assert.deepEqual(coverCrop(wide, T, [0.5, 0.5]), [518.75, 0, 562.5, 1000]); // 1000 * 9/16 = 562.5 wide
  assert.deepEqual(coverCrop(wide, T, [0.1, 0.5]), [0, 0, 562.5, 1000]); // clamped at the left
  assert.deepEqual(coverCrop(tall, W, [0.5, 0.2]), [0, 38.75, 1000, 562.5]); // 0.2 * 1600 - 281.25
  for (const [picture, canvas, focus] of [[wide, T, [0.9, 0.1]], [tall, W, [0.3, 0.9]]]) {
    const [x, y, w, h] = coverCrop(picture, canvas, focus);
    const [fx, fy] = [focus[0] * picture.width, focus[1] * picture.height];
    assert.ok(fx >= x && fx <= x + w && fy >= y && fy <= y + h, `${focus} inside ${[x, y, w, h]}`);
  }
});

// ---- composition ----

const picture = (out) => all(out.nodes).find((n) => n.type === 'image');
const group = (out) => out.nodes.find((n) => n.id === `${out.hero}`);

test('bleed: the picture covers the frame through the cover crop, treated in the look palette', () => {
  for (const look of LOOKS) {
    // no caption: no card to lift the subject clear of (that case: "clears the marked subject")
    const out = expandShot({ id: 'm', show: 'media', src: 'shot.png', hold: 3, fit: 'bleed' }, look, '9:16');
    const image = picture(out);
    const lookDef = registries.looks.get(look);
    const reach = driftReach(lookDef, 1); // the camera's drift: desk drifts 12 units, so the picture is 6 larger on each side
    assert.deepEqual([image.props.w, image.props.h], [1080 + 2 * reach, 1920 + 2 * reach]);
    assert.deepEqual(image.props.clip, coverCrop({ width: 1600, height: 1000 }, { w: 1080 + 2 * reach, h: 1920 + 2 * reach }, [0.5, 0.5]));
    assert.equal(image.props.treatment.type, treatmentOf(look));
    assert.ok([lookDef.palette.ink, lookDef.palette.paper].includes(image.props.treatment.dark));
  }
});

test('the picture moves on its own track: a slow push from the look push to 1 over the shot, never under 1', () => {
  for (const look of LOOKS) {
    for (const fit of ['bleed', 'cutout']) {
      const out = expandShot({ id: 'm', show: 'media', src: 'shot.png', fit, hold: 3 }, look, '16:9');
      const g = group(out);
      const push = registries.looks.get(look).kinds.media.push;
      assert.ok(Math.abs(sample(g.tracks.scale, 0) - push) < 1e-9, `${look} ${fit} starts at the push`);
      assert.equal(sample(g.tracks.scale, out.timing.duration), 1);
      for (let t = 0; t <= out.timing.duration; t += 0.1) assert.ok(sample(g.tracks.scale, t) >= 1 - 1e-9, `${look} ${fit} at ${t}`);
    }
  }
});

test('the caption arrives word by word with the narration, its first word on frame 0', () => {
  const out = expandSecond({ ...example(), say: 'The harbour wakes at dawn.', caption: 'The harbour at dawn' }, 'desk', '16:9');
  const caption = all(out.nodes).find((n) => n.id === 'm.caption' || n.id.endsWith('.caption'));
  const shown = caption.wordTracks.map((w) => w.opacity.points.find((p) => p.v === 1).t);
  assert.equal(shown[0], 0);
  const spoken = out.timing.words;
  assert.ok(Math.abs(shown[1] - spoken.find((w) => /harbour/i.test(w.text)).start) < 1e-9, 'harbour on its word');
  assert.ok(shown.every((t, i) => i === 0 || t >= shown[i - 1]), 'in order');
});

test('the credit shows where the caption is three times it, else it is left out and said', () => {
  const textNodes = (out) => all(out.nodes).filter((n) => n.type === 'text');
  const withCredit = expandShot({ ...example(), fit: 'bleed', caption: 'Dawn', credit: 'Photo: me' }, 'desk', '16:9');
  const credit = textNodes(withCredit).find((n) => n.id.endsWith('.credit'));
  const caption = textNodes(withCredit).find((n) => n.id.endsWith('.caption'));
  assert.ok(credit && caption.props.layout.size >= 3 * credit.props.layout.size - 1e-6, 'drawn, three times under the caption');
  const long = expandShot({ ...example(), fit: 'bleed', caption: 'A long caption that has to wrap onto three full lines here', credit: 'Photo: me' }, 'desk', '9:16');
  // desk 9:16: the credit would be 44 units (the floor), so the caption must be 132; this one wraps only at 72
  const left = textNodes(long);
  assert.equal(left.some((n) => n.id.endsWith('.credit')), false, 'not drawn');
  assert.ok(left.some((n) => (n.props.dropped ?? []).includes('credit')), 'the caption says it left the credit out');
});

test('media shows its words only with a caption, sends no events, and targets the picture and the caption', () => {
  assert.equal(media.showsWords({ caption: 'x' }), true);
  assert.equal(media.showsWords({}), false);
  assert.deepEqual(media.targets({ caption: 'x' }), ['picture', 'caption']);
  assert.deepEqual(media.targets({}), ['picture']);
  assert.deepEqual(media.srcFields, ['src']);
  assert.equal(media.numbered, false);
  assert.deepEqual(media.steeringFields, ['fit', 'treatment', 'focus', 'in', 'out', 'muted']); // a clip's fields steer, never draw
});

test('the caption is never wider than its room and the credit stays inside the safe area', () => {
  for (const look of LOOKS) {
    for (const format of FORMATS) {
      for (const fit of ['bleed', 'cutout']) {
        // one long word: at the largest step it is wider than any room, so the fit must step down
        const out = expandShot({ ...full(look, fit), caption: 'An extraordinarily early catch' }, look, format);
        const lookDef = registries.looks.get(look);
        const safe = safeRectFor(canvasOf(format), lookDef);
        const texts = drawnLeaves(sampleGraph(out.nodes, out.timing.duration)).filter((l) => l.node.type === 'text');
        for (const { node: n, box } of texts) {
          assert.ok(box[0] >= safe.left - 1 && box[0] + box[2] <= safe.right + 1 && box[1] >= safe.top - 1 && box[1] + box[3] <= safe.bottom + 1,
            `${look} ${format} ${fit}: ${n.id} ${box.map(Math.round)} outside ${JSON.stringify(safe)}`);
        }
      }
    }
  }
});

test('bleed: the caption card clears the marked subject (focus, and a quarter of the picture height either side)', () => {
  for (const look of LOOKS) {
    for (const format of FORMATS) {
      const out = expandShot({ id: 'm', show: 'media', src: 'shot.png', say: SAY, focus: [0.5, 0.4], caption: 'The harbour at dawn' }, look, format);
      const g = group(out);
      const image = picture(out);
      // the picture at rest (the push ends at 1): its top and height on the canvas
      const top = g.props.y + image.props.y, height = image.props.h;
      const [, sy, , sh] = image.props.clip;
      const toCanvas = (fy) => top + ((fy * 1000 - sy) / sh) * height; // shot.png is 1000 tall
      const subjectBottom = toCanvas(0.4 + 0.25);
      const card = out.boxes.caption;
      assert.ok(subjectBottom <= card[1] + 1e-6, `${look} ${format}: the subject ends at ${subjectBottom.toFixed(0)}, the card starts at ${card[1].toFixed(0)}`);
      assert.ok(top <= 0 + 1e-6 && top + height >= canvasOf(format).h - 1e-6, `${look} ${format}: the picture still covers the frame`);
    }
  }
});

// ---- the bar ----

for (const look of LOOKS) {
  for (const format of FORMATS) {
    test(`media bar: the example in ${look} at ${format}`, () => assertBar('media', example(), { look, format }));
    for (const fit of ['bleed', 'cutout']) {
      test(`media bar: the full ${fit} fixture in ${look} at ${format}`, () => assertBar('media', full(look, fit), { look, format }));
      test(`media bar: a ${fit} with no caption and no say in ${look} at ${format}`, () => assertBar('media', { id: 'm', show: 'media', src: 'shot.png', fit, hold: 3 }, { look, format }));
    }
  }
}

test('a look with no media data does not support it', () => {
  // every listed look has media data now (cosmos got it in the looks phase): cosmos's own data without its media entry
  const cosmos = registries.looks.get('cosmos');
  const without = { ...cosmos, kinds: Object.fromEntries(Object.entries(cosmos.kinds).filter(([kind]) => kind !== 'media')) };
  assert.deepEqual(media.validate({ id: 'm', show: 'media', src: 'shot.png' }, { look: without }).map((p) => p.path), ['show']);
  assert.ok(filmOf([example()]));
});
