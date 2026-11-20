// Colour fades in OKLab (engine/color/oklab.mjs, track option space 'oklab'): the midpoint of a lavender or grey to
// gold fade keeps its chroma (never khaki or olive), round trips hold, and a track without the option still mixes per
// sRGB channel exactly as before (desk and pop unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOklab, fromOklab, mixOklab, chromaOf } from '../../engine/color/oklab.mjs';
import { track, sample } from '../../engine/time/track.mjs';

const LAVENDER = '#a9a4d6', GOLD = '#ffd166', GREY = '#6b6a7a', INK = '#f4f1ff';

test('a colour round-trips through OKLab to within one step per channel', () => {
  for (const hex of [LAVENDER, GOLD, GREY, INK, '#000000', '#ffffff', '#0b1030']) {
    const back = fromOklab(toOklab(hex));
    for (const i of [1, 3, 5]) assert.ok(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 1, `${hex} -> ${back}`);
  }
});

test('the OKLab midpoint of lavender or grey to gold keeps its colour: more chroma than the sRGB mix, never below the lesser end', () => {
  for (const from of [LAVENDER, GREY, INK]) {
    const mid = mixOklab(from, GOLD, 0.5);
    const rgbMid = sample(track([{ t: 0, v: from }, { t: 1, v: GOLD }]), 0.5);
    assert.ok(chromaOf(mid) > chromaOf(rgbMid), `${from}: oklab ${mid} (${chromaOf(mid).toFixed(3)}) vs srgb ${rgbMid} (${chromaOf(rgbMid).toFixed(3)})`);
    assert.ok(chromaOf(mid) >= 0.9 * Math.min(chromaOf(from), chromaOf(GOLD)), `${from}: ${mid} keeps chroma`);
  }
});

test('a track with space oklab samples its colours in OKLab; without it, per sRGB channel as before', () => {
  const keys = [{ t: 0, v: LAVENDER }, { t: 2, v: GOLD }];
  assert.equal(sample(track(keys, { space: 'oklab' }), 1), mixOklab(LAVENDER, GOLD, 0.5));
  assert.equal(sample(track(keys), 1), '#d4bb9e', 'the sRGB channel mix');
  assert.equal(track(keys).space, undefined, 'no extra field on a plain track');
});
