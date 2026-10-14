import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { linksOf, resolveEnds, beatsOf } from '../scripts/lib/stories.mjs';

const errorsOf = async (spec) => (await validateSpec(spec, { layout: false })).errors;

// a -> b (named "ab"), b -> c, c -> b (a reply pair), a -> group g; d stands alone.
const graph = (stories, extra = {}) => ({
  title: 'T',
  type: 'architecture',
  groups: [{ id: 'g', label: 'G' }],
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'g' }, { id: 'c', label: 'C', group: 'g' }, { id: 'd', label: 'D' }],
  edges: [{ id: 'ab', from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }, { from: 'a', to: 'g' }],
  stories,
  ...extra,
});
const story = (beats, id = 's1') => ({ id, title: 'Story', beats });
const beat = (target, title = 'Beat') => ({ title, ...target });

test('linksOf names unnamed edges edge-<i>, as the layout does, and carries both', () => {
  assert.deepEqual(linksOf(graph([])), [
    { id: 'ab', from: 'a', to: 'b', both: false },
    { id: 'edge-1', from: 'b', to: 'c', both: false },
    { id: 'edge-2', from: 'c', to: 'b', both: false },
    { id: 'edge-3', from: 'a', to: 'g', both: false },
  ]);
  const spec = graph([]);
  spec.edges[0].both = true;
  assert.equal(linksOf(spec)[0].both, true);
  assert.deepEqual(linksOf({ type: 'sequence', messages: [{ id: 'm1', from: 'x', to: 'y' }] }), [{ id: 'm1', from: 'x', to: 'y', both: false }]);
});

test('resolveEnds: the direction given wins; the other way plays in reverse; none or several ask for edge', () => {
  const links = linksOf(graph([]));
  assert.deepEqual(resolveEnds('b', 'c', links), { link: links[1], reverse: false });
  assert.deepEqual(resolveEnds('c', 'b', links), { link: links[2], reverse: false }, 'a reply pair is never ambiguous');
  assert.deepEqual(resolveEnds('b', 'a', links), { link: links[0], reverse: true });
  assert.deepEqual(resolveEnds('g', 'a', links), { link: links[3], reverse: true }, 'a group end works like a node');
  assert.deepEqual(resolveEnds('a', 'd', links), { error: 'no edge between "a" and "d"; add one, or name an edge with "edge"' });
  const twice = [...links, { id: 'again', from: 'a', to: 'b', both: false }];
  assert.deepEqual(resolveEnds('a', 'b', twice), { error: '2 edges connect "a" and "b" (ab, again); name one with "edge"' });
  assert.deepEqual(resolveEnds('b', 'a', twice), { error: '2 edges connect "b" and "a" (ab, again); name one with "edge"' }, 'reverse candidates can be ambiguous too');
  const m1 = { id: 'm1', from: 'y', to: 'x', both: false };
  assert.deepEqual(resolveEnds('x', 'y', [m1], 'message'), { link: m1, reverse: true });
  assert.equal(resolveEnds('x', 'x', [], 'message').error, 'no message between "x" and "x"; add one, or name a message with "edge"');
});

test('a two-headed edge named against its authored order plays backwards; exact direction wins; ties ask for edge', () => {
  const ba = { id: 'ba', from: 'b', to: 'a', both: true };
  assert.deepEqual(resolveEnds('b', 'a', [ba]), { link: ba, reverse: false }, 'named as authored: forward');
  assert.deepEqual(resolveEnds('a', 'b', [ba]), { link: ba, reverse: true }, 'named against the authored order: the dot travels to -> from');
  const ab = { id: 'ab', from: 'a', to: 'b', both: false };
  assert.deepEqual(resolveEnds('a', 'b', [ab, ba]), { link: ab, reverse: false }, 'the exact direction beats a two-headed edge named the other way');
  const plain = { id: 'plain', from: 'b', to: 'a', both: false };
  const both = { id: 'both', from: 'a', to: 'b', both: true };
  assert.deepEqual(resolveEnds('b', 'a', [plain, both]), { link: plain, reverse: false }, 'plain b->a beats both a->b for b -> a');
  assert.deepEqual(resolveEnds('a', 'b', [plain, both]), { link: both, reverse: false });
  assert.deepEqual(resolveEnds('a', 'b', [ba, { ...ba, id: 'ba2' }]), { error: '2 edges connect "a" and "b" (ba, ba2); name one with "edge"' }, 'two two-headed edges the other way tie');
  assert.deepEqual(resolveEnds('a', 'b', [{ ...ab, id: 'x' }, { ...both, id: 'y' }]), { error: '2 edges connect "a" and "b" (x, y); name one with "edge"' }, 'two exact matches tie');
  assert.deepEqual(resolveEnds('a', 'b', [ba, plain]), { link: ba, reverse: true }, 'a two-headed edge reversed beats a plain reverse edge');
});

test('a two-headed edge named both ways gets reverse in beatsOf', () => {
  const spec = { title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'b', to: 'a', both: true }], stories: [story([beat({ from: 'b', to: 'a' }), beat({ from: 'a', to: 'b' })])] };
  const { beats } = beatsOf(spec, []);
  assert.deepEqual(beats.map((b) => [b.edge, b.reverse]), [['edge-0', false], ['edge-0', true]]);
});

test('focus names nodes and groups (participants in a sequence), not edges or messages', async () => {
  const e = await errorsOf(graph([story([beat({ focus: ['ab'] })])]));
  assert.equal(e.length, 1);
  assert.equal(e[0].path, 'stories[0].beats[0].focus[0]');
  assert.equal(e[0].message, '"ab" is an edge; focus names nodes and groups — target it with "edge"');
  const seq = { title: 'S', type: 'sequence', participants: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], messages: [{ id: 'm1', from: 'x', to: 'y' }], stories: [story([beat({ focus: ['m1'] })])] };
  const s = await errorsOf(seq);
  assert.equal(s.length, 1);
  assert.equal(s[0].path, 'stories[0].beats[0].focus[0]');
  assert.equal(s[0].message, '"m1" is a message; focus names participants — target it with "edge"');
  assert.deepEqual(await errorsOf({ ...seq, stories: [story([beat({ focus: ['x', 'y'] })])] }), []);
});

test('unknown properties on a story and on a beat name the allowed ones', async () => {
  const s = await errorsOf(graph([{ id: 's1', title: 'S', beats: [beat({ edge: 'ab' })], bogus: 1 }]));
  assert.deepEqual(s, [{ path: 'stories[0].bogus', message: 'unknown property; allowed: id, title, beats' }]);
  const b = await errorsOf(graph([story([{ ...beat({ edge: 'ab' }), note: 'x' }])]));
  assert.deepEqual(b, [{ path: 'stories[0].beats[0].note', message: 'unknown property; allowed: title, caption, edge, from, to, focus' }]);
});

test('a valid story: hops by edge, by from/to forwards and backwards, and a focus shot', async () => {
  const spec = graph([story([beat({ edge: 'ab' }), beat({ from: 'b', to: 'c' }), beat({ from: 'b', to: 'a' }), beat({ focus: ['g', 'd'] })])]);
  assert.deepEqual(await errorsOf(spec), []);
});

test('a beat needs exactly one target', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({})])])), [{ path: 'stories[0].beats[0]', message: 'a beat needs one target: "edge", "from" and "to", or "focus"' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab', focus: ['a'] })])])), [{ path: 'stories[0].beats[0]', message: 'a beat takes one target; this one has "edge" and "focus" — keep one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab', from: 'a', to: 'b', focus: ['a'] })])])), [{ path: 'stories[0].beats[0]', message: 'a beat takes one target; this one has "edge", "from and to" and "focus" — keep one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a' })])])), [{ path: 'stories[0].beats[0].to', message: 'required with from — name the other end, or target the edge with "edge"' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ to: 'a' })])])), [{ path: 'stories[0].beats[0].from', message: 'required with to — name the other end, or target the edge with "edge"' }]);
});

test('edge must name an edge: did-you-mean over authored and generated ids', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'abb' })])])), [{ path: 'stories[0].beats[0].edge', message: '"abb" not found; did you mean "ab"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'edge-1' })])])), [], 'an unnamed edge is addressable as edge-<i>');
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'nope_nope' })])])), [{ path: 'stories[0].beats[0].edge', message: '"nope_nope" not found; available: ab, edge-1, edge-2, edge-3' }]);
});

test('from and to name nodes (groups too in architecture); no edge or several between them names both ends', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a', to: 'bb' })])])), [{ path: 'stories[0].beats[0].to', message: '"bb" not found; did you mean "b"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a', to: 'd' })])])), [{ path: 'stories[0].beats[0]', message: 'no edge between "a" and "d"; add one, or name an edge with "edge"' }]);
  const spec = graph([story([beat({ from: 'a', to: 'b' })])]);
  spec.edges.push({ from: 'a', to: 'b', label: 'again' });
  assert.deepEqual(await errorsOf(spec), [{ path: 'stories[0].beats[0]', message: '2 edges connect "a" and "b" (ab, edge-4); name one with "edge"' }]);
  const flow = { title: 'T', type: 'flow', groups: [{ id: 'grp', label: 'G' }], nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'grp' }], edges: [{ from: 'a', to: 'b' }], stories: [story([beat({ from: 'a', to: 'grp' })])] };
  const e = await errorsOf(flow);
  assert.equal(e.length, 1);
  assert.equal(e[0].path, 'stories[0].beats[0].to');
  assert.match(e[0].message, /^"grp" not found; /, 'outside architecture a group is not an end');
});

test('focus names known ids and is not empty', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ focus: ['a', 'dd'] })])])), [{ path: 'stories[0].beats[0].focus[1]', message: '"dd" not found; did you mean "d"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ focus: [] })])])), [{ path: 'stories[0].beats[0].focus', message: 'at least one id is required' }]);
});

test('limits: 8 stories, 60 beats in all, titles 40 and 48, caption 160', async () => {
  const one = (id) => story([beat({ edge: 'ab' })], id);
  assert.deepEqual(await errorsOf(graph(Array.from({ length: 9 }, (_, i) => one(`s${i}`)))), [{ path: 'stories', message: 'stories has 9 entries; the limit is 8 — merge chapters' }]);
  assert.deepEqual(await errorsOf(graph(Array.from({ length: 8 }, (_, i) => one(`s${i}`)))), []);
  const many = (n, id) => story(Array.from({ length: n }, () => beat({ edge: 'ab' })), id);
  assert.deepEqual(await errorsOf(graph([many(31, 's1'), many(30, 's2')])), [{ path: 'stories', message: 'the stories hold 61 beats in all; the limit is 60 — drop or merge beats' }]);
  assert.deepEqual(await errorsOf(graph([many(30, 's1'), many(30, 's2')])), []);
  const long = graph([{ id: 's1', title: 't'.repeat(41), beats: [{ title: 'b'.repeat(49), caption: 'c'.repeat(161), edge: 'ab' }] }]);
  assert.deepEqual(await errorsOf(long), [
    { path: 'stories[0].title', message: 'title is 41 characters; the limit is 40 — shorten it' },
    { path: 'stories[0].beats[0].title', message: 'title is 49 characters; the limit is 48 — shorten it' },
    { path: 'stories[0].beats[0].caption', message: 'caption is 161 characters; the limit is 160 — shorten it' },
  ]);
});

test('story ids: spelled like other ids, unique among stories, free to match a node id', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 'Bad Id')])), [{ path: 'stories[0].id', message: 'id "Bad Id" is invalid; use lowercase letters, digits, - and _, starting with a letter' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 's1'), story([beat({ edge: 'ab' })], 's1')])), [{ path: 'stories[1].id', message: 'duplicate id "s1"; first used at stories[0].id; rename one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 'a')])), []);
});

test('stories and steps together: use stories', async () => {
  const e = await errorsOf(graph([story([beat({ edge: 'ab' })])], { steps: [{ title: 'S', show: ['a'] }] }));
  assert.deepEqual(e, [{ path: 'steps', message: 'use stories; steps is the older form' }]);
});

test('an empty stories list and a story with no beats are errors', async () => {
  assert.deepEqual(await errorsOf(graph([])), [{ path: 'stories', message: 'at least one story is required — or remove stories' }]);
  assert.deepEqual(await errorsOf(graph([story([])])), [{ path: 'stories[0].beats', message: 'at least one beat is required' }]);
});

test('unknown properties in a story or a beat are rejected with the allowed list', async () => {
  const e = await errorsOf(graph([{ id: 's1', title: 'S', color: 'red', beats: [{ title: 'B', edge: 'ab', delay: 2 }] }]));
  assert.deepEqual(e.map((x) => x.path).sort(), ['stories[0].beats[0].delay', 'stories[0].color']);
  assert.match(e.find((x) => x.path.endsWith('delay')).message, /^unknown property; allowed: title, caption, edge, from, to, focus$/);
});

test('a sequence resolves from/to among messages the same way', async () => {
  const seq = {
    title: 'S', type: 'sequence',
    participants: [{ id: 'u', label: 'User' }, { id: 'app', label: 'App' }, { id: 'auth', label: 'Auth' }],
    messages: [{ id: 'm1', from: 'u', to: 'app' }, { id: 'm2', from: 'app', to: 'auth' }, { id: 'm3', from: 'auth', to: 'app', kind: 'reply' }, { id: 'm4', from: 'app', to: 'app', kind: 'self' }, { id: 'm5', from: 'app', to: 'auth' }],
  };
  const withStory = (beats) => ({ ...seq, stories: [story(beats)] });
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'u', to: 'app' }), beat({ from: 'app', to: 'u' }), beat({ from: 'app', to: 'app' }), beat({ edge: 'm3' })])), []);
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'app', to: 'auth' })])), [{ path: 'stories[0].beats[0]', message: '2 messages connect "app" and "auth" (m2, m5); name one with "edge"' }]);
  assert.deepEqual(await errorsOf(withStory([beat({ edge: 'm9' })])), [{ path: 'stories[0].beats[0].edge', message: '"m9" not found; did you mean "m1"?' }]);
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'u', to: 'auth' })])), [{ path: 'stories[0].beats[0]', message: 'no message between "u" and "auth"; add one, or name a message with "edge"' }]);
});

const example = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url)), 'utf8'));

test('the story example validates, layout included', async () => {
  assert.deepEqual((await validateSpec(example('story'))).errors, []);
});

test('beatsOf: stories become hop and focus beats in array order, one chapter per story', () => {
  const spec = graph([
    story([beat({ edge: 'ab' }, 'By edge'), { title: 'Back', caption: 'A reply.', from: 'b', to: 'a' }, beat({ from: 'a', to: 'g' }, 'To a group')], 'one'),
    story([beat({ focus: ['g', 'd'] }, 'Shot')], 'two'),
  ]);
  const { beats, chapters } = beatsOf(spec, []);
  assert.deepEqual(chapters, [{ id: 'one', title: 'Story', start: 0, end: 3 }, { id: 'two', title: 'Story', start: 3, end: 4 }]);
  assert.deepEqual(beats, [
    { kind: 'hop', chapter: 0, title: 'By edge', edge: 'ab', reverse: false, ids: ['a', 'b'], reveal: [], highlight: [] },
    { kind: 'hop', chapter: 0, title: 'Back', caption: 'A reply.', edge: 'ab', reverse: true, ids: ['a', 'b'], reveal: [], highlight: [] },
    { kind: 'hop', chapter: 0, title: 'To a group', edge: 'edge-3', reverse: false, ids: ['a', 'g'], reveal: [], highlight: [] },
    { kind: 'focus', chapter: 1, title: 'Shot', edge: null, reverse: false, ids: ['g', 'd'], reveal: [], highlight: [] },
  ]);
  assert.notEqual(beats[3].ids, spec.stories[1].beats[0].focus, 'copied, not shared');
});

test('beatsOf: a self-edge hop fits one id', () => {
  const spec = graph([story([beat({ from: 'a', to: 'a' })])]);
  spec.edges.push({ id: 'loop', from: 'a', to: 'a' });
  assert.deepEqual(beatsOf(spec, []).beats[0].ids, ['a']);
});

test('beatsOf: without stories, steps become step beats in one Walkthrough chapter', () => {
  const steps = [{ title: 'One', note: 'First.', show: ['a', 'b'] }, { title: 'Two', show: ['c'], focus: ['b', 'c'], highlight: ['c'] }, { title: 'Everything', show: ['d'], focus: ['g', 'a', 'b', 'c', 'd'] }];
  const { beats, chapters } = beatsOf(graph(undefined), steps);
  assert.deepEqual(chapters, [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: 3 }]);
  assert.deepEqual(beats[0], { kind: 'step', chapter: 0, title: 'One', caption: 'First.', edge: null, reverse: false, ids: [], reveal: ['a', 'b'], highlight: [] });
  assert.deepEqual(beats[1], { kind: 'step', chapter: 0, title: 'Two', edge: null, reverse: false, ids: ['b', 'c'], reveal: ['c'], highlight: ['c'] });
  assert.notEqual(beats[1].ids, steps[1].focus, 'copied');
});

test('buildDiagram data: autoplay, beats, chapters, info and directed for the story example', async () => {
  const { data, steps } = await buildDiagram(example('story'));
  assert.equal(data.autoplay, false);
  assert.equal(data.beats.length, 9);
  assert.deepEqual(data.chapters, [{ id: 'placing', title: 'Place the order', start: 0, end: 6 }, { id: 'fulfilling', title: 'Fulfil it', start: 6, end: 9 }]);
  assert.deepEqual(data.beats[1], { kind: 'hop', chapter: 0, title: 'The app calls the API', caption: 'One POST with an idempotency key.', edge: 'place', reverse: false, ids: ['app', 'gateway'], reveal: [], highlight: [] });
  assert.deepEqual([data.beats[4].edge, data.beats[4].reverse], ['edge-6', false], 'orders -> gateway: the direction given, not the gateway -> orders edge');
  assert.deepEqual([data.beats[5].edge, data.beats[5].reverse], ['edge-0', true], 'app -> shopper runs the shopper -> app edge backwards');
  assert.deepEqual(data.beats[8], { kind: 'focus', chapter: 1, title: 'The whole core', caption: 'Three services, one database, one bus.', edge: null, reverse: false, ids: ['core'], reveal: [], highlight: [] });
  assert.ok(steps.length > 0 && data.steps === steps, 'steps stay in the data');
  assert.deepEqual(data.info.orders, { label: 'Orders service', kind: 'service', emoji: '📦', detail: 'Owns the order lifecycle. Writes every state change to the orders table and emits an event per transition.' });
  assert.deepEqual(data.info.gateway, { label: 'API gateway', kind: 'gateway', note: 'auth, rate limits' });
  assert.deepEqual(data.info.place, { style: 'solid', label: 'POST /orders' });
  assert.deepEqual(data.info['edge-4'], { style: 'async', label: 'order.placed' });
  assert.deepEqual(data.directed.orders, ['edge-3', 'edge-4', 'edge-6']);
  assert.deepEqual(data.directed.app, ['place']);
  assert.equal(data.directed.warehouse, undefined, 'nothing leaves the warehouse');
});

test('without stories the data holds step beats matching steps; a sequence carries message styles', async () => {
  const arch = await buildDiagram(example('architecture'));
  assert.equal(arch.data.beats.length, arch.steps.length);
  assert.deepEqual(arch.data.beats.map((b) => b.title), arch.steps.map((s) => s.title));
  assert.ok(arch.data.beats.every((b) => b.kind === 'step'));
  assert.deepEqual(arch.data.chapters, [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: arch.steps.length }]);
  assert.deepEqual(arch.data.directed.web, ['edge-0', 'edge-3']);
  assert.deepEqual(arch.data.directed.vpc, ['edge-3'], 'a both edge leaves the group end too');
  const seq = await buildDiagram(example('sequence'));
  assert.deepEqual(seq.data.info.m5, { style: 'reply', label: 'declined' });
  assert.deepEqual(seq.data.info.shopper, { label: 'Shopper', kind: 'actor' });
  assert.deepEqual(seq.data.directed.psp, ['m5', 'm8']);
});
