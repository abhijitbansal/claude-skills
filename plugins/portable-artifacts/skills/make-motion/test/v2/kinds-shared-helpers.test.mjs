// Helpers more than one kind uses live once, in engine/kinds/shared.mjs: the desk highlighter behind emphasised runs
// (statement, quote) and the plain tag at a chosen scale step (number, quote). Each kind imports them; none keeps a copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as shared from '../../engine/kinds/shared.mjs';
import '../../engine/kinds/index.mjs';
import { expandShot, textNode } from './helpers/kinds.mjs';

const kindsDir = fileURLToPath(new URL('../../engine/kinds/', import.meta.url));
const source = (name) => readFileSync(`${kindsDir}${name}`, 'utf8');

test('shared.mjs exports the highlight helpers and the plain tag', () => {
  for (const name of ['highlightBands', 'highlightLines', 'plainTag']) assert.equal(typeof shared[name], 'function', name);
});

test('no kind keeps its own copy: statement, number and quote import the shared helpers', () => {
  assert.ok(!/function (emphasisRuns|bandBox|highlightLines|highlights)\b/.test(source('statement.mjs')), 'statement');
  assert.ok(!/function plainTag\b/.test(source('number.mjs')), 'number');
  assert.ok(!/function attributionTag\b/.test(source('quote-pop.mjs')), 'quote-pop');
  assert.ok(!existsSync(`${kindsDir}quote-emphasis.mjs`), 'quote-emphasis.mjs is gone');
});

test('the shared plain tag is the one number draws: a label tag at step 3 with its plate behind label caps', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', say: 'Revenue grew to 1,200.', value: 1200, label: 'Revenue' }, 'pop', '9:16');
  const label = textNode(nodes, 'n.label.text');
  assert.equal(label.props.role, 'tag');
  assert.ok(nodes.some((n) => n.id === 'n.label'), 'the tag group');
});

test('a snapped plain tag (the pop quote attribution) takes a scale step, never a size between two; the number label tag scales to fit', () => {
  const quote = expandShot({ id: 'q', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk', role: 'House rule' }, 'pop', '9:16');
  const tag = textNode(quote.nodes, 'q.by.text');
  const steps = quote.ctx.look.scale.map((s) => s * quote.ctx.unit);
  assert.ok(steps.includes(tag.props.font.size), `the attribution at ${tag.props.font.size}, a step of ${steps}`);
});
