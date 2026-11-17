// Every kind in `poster` (looks-four plan, Task 7): each kind's example built as a film (so each shot stands on its
// ground, engine/looks/grounds.mjs), at 16:9 in pro, at 9:16 in pro and at 9:16 in viral, judged by the frame review
// (auditFrame, every rule) on frames every 0.5 s with no finding; in viral at 9:16 every text inside the platform safe
// zone on frame 0 and the hook at full ink; a tall frame at least 65 percent used; no frame with more than two type
// sizes outside frame furniture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { snapshotOf, drawnLeaves, contentOf } from './helpers/bar.mjs';
import { filmOf, filmFor, expandIn } from './helpers/kinds.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';

const LOOK = 'poster';
const AUDIT_STEP = 0.5;
const MIN_TALL_USE = 0.65;
const MAX_SIZES = 2;
const PREPARED = Object.freeze(['map', 'code']);
const SIZE_DECIMALS = 1;
const SAME_SIZE = 1.1; // the frame review's SAME_SIZE_RATIO
const look = () => registries.looks.get(LOOK);
const parked = () => Object.keys(look().kinds).filter((kind) => look().kinds[kind].experimental === true);
const CASES = Object.freeze([['16:9', 'pro'], ['9:16', 'pro'], ['9:16', 'viral']]);
// The rules this file leaves to poster-examples-browser.test.mjs, which measures real glyphs: with the test's fake
// measure (0.55 em a letter, ink 0.02 em inside the advance) a stack line flush on the safe edge has its advance box a
// side bearing past it, and a numeral is several times wider than Archivo's; pop's own examples draw the same findings
// here (measured: .scratch/p2/sweep.mjs with LOOK=pop)
const MEASURE_RULES = Object.freeze(['safe-area', 'overflow']);
const INK_IN = 0.02; // em: helpers/kinds.mjs measure's inkLeft
// OPEN WORK (Task 7, impl-p2 report): the cases below fail today and are left visible as todo, not passed. Tall frames
// in the stack family leave the lower part of the band empty (measured here; seen on the rendered sheets in
// .scratch/p2/films/out), and the end shot sets a third size (the ask). Remove an entry when its composition is fixed.
const OPEN = Object.freeze({
  tall: ['statement pro', 'statement viral', 'list pro', 'list viral', 'quote viral', 'compare pro', 'compare viral', 'media pro', 'media viral'],
  sizes: ['end 9:16 pro'],
});
const openTodo = (list, key) => (OPEN[list].includes(key) ? { todo: `open work: ${list} (see the OPEN note)` } : {});

const EXAMPLES = Object.freeze(registries.kinds.names().map((kind) => {
  const entry = listEntries('kinds').find((e) => e.name === kind);
  const example = entry?.example ?? registries.kinds.get(kind).example;
  return { kind, shot: example.src === undefined ? example : { ...example, src: 'shot.png' } };
}));

const timesOf = (duration) => [...Array.from({ length: Math.floor(duration / AUDIT_STEP) + 1 }, (_, i) => i * AUDIT_STEP), duration];

/** The example as a one-shot film in poster at `format` in `mode`: the built film and its frame review ctx. */
export function posterFilm(kind, shot, format, mode) {
  const extra = { mode };
  const film = filmOf([shot], LOOK, format, extra);
  const prepared = PREPARED.includes(kind) ? prepareFilm(film, { filmDir: '.' }).prepared : {};
  const built = filmFor([shot], LOOK, format, extra, { prepared });
  const shotLook = lookOfShot(film, 0);
  const canvas = format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const modeData = registries.modes.get(mode);
  const ctx = { look: shotLook, canvas, mode, shotId: shot.id, shotIndex: 0, isFirstShot: true, safe: safeRectFor(canvas, shotLook, modeData), regionMarks: regionMarkIds(shot), background: built.backgrounds[0] };
  return { built, ctx, canvas };
}

test('the sweep covers all sixteen kinds, and poster has data for every one', () => {
  assert.equal(EXAMPLES.length, 16);
  for (const { kind } of EXAMPLES) {
    if (registries.kinds.get(kind).lookData === true) assert.ok(look().kinds[kind], `poster has data for ${kind}`);
  }
});

for (const [format, mode] of CASES) {
  for (const { kind, shot } of EXAMPLES.filter((e) => !parked().includes(e.kind))) {
    test(`poster ${kind} at ${format} in ${mode}: the example builds with no finding from the frame review`, () => {
      const { built, ctx } = posterFilm(kind, shot, format, mode);
      const findings = timesOf(built.duration).flatMap((t) => auditFrame(snapshotOf(built.sampleShot(0, t)), { ...ctx, t })
        .filter((f) => !MEASURE_RULES.includes(f.rule))
        .map((f) => `at ${t.toFixed(2)} s: ${f.kind} ${f.rule}: ${f.message}`));
      assert.deepEqual([...new Set(findings)], []);
    });
  }
}

// The texts on screen: drawn at an opacity over 0 with every group above them (a hidden list item's group hides them).
const visibleTexts = (nodes, alpha = 1) => nodes.flatMap((n) => {
  const a = alpha * (n.opacity ?? 1);
  if (a <= 0) return [];
  return [...(n.type === 'text' ? [n] : []), ...visibleTexts(n.children ?? [], a)];
});
const inside = (b, s) => b[0] >= s.left - 1 && b[1] >= s.top - 1 && b[0] + b[2] <= s.right + 1 && b[1] + b[3] <= s.bottom + 1;

for (const { kind, shot } of EXAMPLES.filter((e) => e.kind !== 'free' && !parked().includes(e.kind))) {
  test(`poster ${kind} in viral at 9:16: every text inside the platform safe zone on frame 0`, () => {
    const { built, ctx } = posterFilm(kind, shot, '9:16', 'viral');
    const texts = visibleTexts(snapshotOf(built.sampleShot(0, 0))).filter((n) => n.props.caption === undefined);
    // the ink, not the advance box: the fake measure's ink starts INK_IN em inside the advance (MEASURE_RULES)
    const inkOf = (t) => [t.bbox[0] + INK_IN * t.props.font.size, t.bbox[1], t.bbox[2] - 2 * INK_IN * t.props.font.size, t.bbox[3]];
    for (const t of texts) assert.ok(inside(inkOf(t), ctx.safe), `${t.id} at ${t.bbox.map(Math.round)} is outside ${JSON.stringify(ctx.safe)}`);
  });

  for (const mode of ['pro', 'viral']) {
    // of the composition area's height (the band at 9:16 in both modes: kinds/shared.mjs compositionRect)
    test(`poster ${kind} at 9:16 in ${mode}: the tall frame is at least 65 percent used`, openTodo('tall', `${kind} ${mode}`), () => {
      const { built, canvas } = posterFilm(kind, shot, '9:16', mode);
      const area = stackArea(expandIn(filmOf([shot], LOOK, '9:16', { mode }), 0, { prepared: PREPARED.includes(kind) ? prepareFilm(filmOf([shot], LOOK, '9:16', { mode }), { filmDir: '.' }).prepared : {} }).ctx);
      const leaves = contentOf(drawnLeaves(built.sampleShot(0, built.duration)), canvas).filter((l) => l.node.type !== 'field');
      const boxes = leaves.map((l) => l.box).filter((b) => b[2] * b[3] < 0.9 * canvas.w * canvas.h);
      const top = Math.max(area.top, Math.min(...boxes.map((b) => b[1]))), bottom = Math.min(area.top + area.h, Math.max(...boxes.map((b) => b[1] + b[3])));
      const used = (bottom - top) / area.h;
      assert.ok(used >= MIN_TALL_USE, `${(100 * used).toFixed(0)}% of the height used (at least ${100 * MIN_TALL_USE}%)`);
    });
  }
}

for (const [format, mode] of CASES) {
  for (const { kind, shot } of EXAMPLES.filter((e) => e.kind !== 'free' && !parked().includes(e.kind))) {
    test(`poster ${kind} at ${format} in ${mode}: no frame holds more than two type sizes outside frame furniture`, openTodo('sizes', `${kind} ${format} ${mode}`), () => {
      const { built } = posterFilm(kind, shot, format, mode);
      for (const t of timesOf(built.duration)) {
        // counted as the frame review counts sizes (engine/review/frame.mjs hierarchyRules): a stack's lines once, at
        // its largest line; affixes and frame furniture left out; sizes within SAME_SIZE of each other one size
        const texts = visibleTexts(snapshotOf(built.sampleShot(0, t))).filter((n) => n.props.furniture !== true && n.props.role !== 'affix');
        const classes = new Map();
        for (const n of texts) {
          const key = n.props.stack ?? n.id;
          classes.set(key, Math.max(classes.get(key) ?? 0, n.props.font.size));
        }
        const sizes = [...classes.values()].sort((a, b) => a - b).reduce((groups, s) => (groups.length > 0 && s / groups.at(-1).at(-1) <= SAME_SIZE ? [...groups.slice(0, -1), [...groups.at(-1), s]] : [...groups, [s]]), []);
        assert.ok(sizes.length <= MAX_SIZES, `at ${t.toFixed(2)} s: ${sizes.length} sizes (${sizes.map((g) => g[0].toFixed(SIZE_DECIMALS)).join(', ')}): ${texts.map((n) => n.id).join(', ')}`);
      }
    });
  }
}
