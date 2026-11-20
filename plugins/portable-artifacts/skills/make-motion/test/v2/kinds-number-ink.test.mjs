// The number kind's count keeps every digit it shows on the figure's edge (k6 ruling b): the figure is aligned by the
// ink of all the steps the count shows, not only by the final value's, so a digit whose ink reaches further left (a 3's
// flared terminal in pop's display face, at 15.27 s of kinds-pop.json) never pokes past the safe edge mid-count.
// A per-glyph ink stub stands in for the page's canvas measure (the shared fake gives every digit the same ink).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { all, measure as fake, IMAGES, canvasOf, viralOf, filmOf, FPS } from './helpers/kinds.mjs';

const OVERHANG = -0.06; // the 3's ink starts this many em left of its advance box
const measure = (text, font) => (text === '3' ? { ...fake(text, font), inkLeft: OVERHANG * font.size } : fake(text, font));

function expandWith(shot, look, format) {
  const film = filmOf([shot], look, format);
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas), prepared: {} });
  return registries.kinds.get('number').expand(shot, ctx);
}

// The leftmost ink of each step the count shows, in frame units at rest (the group's scale at 1).
function stepInkLefts(out, hero) {
  const group = all(out.nodes).find((n) => n.id === hero);
  const digits = all(out.nodes).find((n) => n.id === `${hero}.digits`);
  const words = digits.props.layout.lines[0].words;
  return digits.props.steps.map((step) => Math.min(...step.words.map((i) => {
    const w = words[i];
    return group.props.x + digits.props.x + w.x + measure(w.text, digits.props.font).inkLeft;
  })));
}

const SHOT = { id: 'count', show: 'number', say: 'Nine kinds of shot. One script.', value: 9, label: 'kinds of shot' };
for (const [look, format] of [['pop', '9:16'], ['pop', '16:9'], ['desk', '16:9'], ['desk', '9:16']]) {
  test(`${look} ${format}: no step of the count reaches left of the figure's edge (a 3 with a flared terminal included)`, () => {
    const out = expandWith(SHOT, look, format);
    const edge = out.boxes.value[0];
    const lefts = stepInkLefts(out, 'count.value');
    assert.ok(lefts.length > 3, 'the count shows its steps');
    lefts.forEach((x, k) => assert.ok(x >= edge - 1e-6, `step ${k} ink at ${x.toFixed(2)} is left of the edge ${edge.toFixed(2)}`));
  });
}
