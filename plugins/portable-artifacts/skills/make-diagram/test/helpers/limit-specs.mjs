// Specs that sit at the validation limits, to prove "a spec that passes is buildable":
// the page budget (viewer.mjs MAX_PAGE_BYTES) must cover the worst page they make.
import { LIMITS } from '../../scripts/lib/schema.mjs';

const BRANDS = ['postgresql', 'redis', 'docker', 'ansible', 'anthropic', 'apple', 'argo', 'auth0', 'babel', 'bitbucket'];
const LAYERS = 6;
const PER_LAYER = LIMITS.nodes / LAYERS;
// ZWJ family and a skin-toned couple: the longest emoji the validator allows.
const EMOJI = ['👨‍👩‍👧‍👦', '🧑🏽‍💻', '👩🏻‍❤️‍💋‍👨🏿', '🏳️‍🌈'];

const fill = (seed, length) => seed.repeat(Math.ceil(length / seed.length)).slice(0, length).trimEnd();
const word = (i) => `w${String(i).padStart(2, '0')}`;

/** 60 nodes (48-char labels, brand icons, 60-char notes), 120 labelled edges, 25 steps with 200-char notes. */
export function nearLimitGraph() {
  const nodes = [];
  for (let l = 0; l < LAYERS; l++) {
    for (let i = 0; i < PER_LAYER; i++) {
      const n = l * PER_LAYER + i;
      nodes.push({ id: `n${n}`, label: fill(`Service ${word(n)} handles requests `, LIMITS.label), icon: `brand:${BRANDS[n % BRANDS.length]}`, note: fill(`note ${word(n)} `, LIMITS.note) });
    }
  }
  const edges = [];
  for (let l = 0; l < LAYERS - 1; l++) {
    for (let i = 0; i < PER_LAYER; i++) {
      for (const d of [0, 1]) edges.push({ from: `n${l * PER_LAYER + i}`, to: `n${(l + 1) * PER_LAYER + ((i + d) % PER_LAYER)}`, label: fill(`call ${word(edges.length)} `, LIMITS.edgeLabel) });
    }
  }
  for (let i = 0; edges.length < LIMITS.edges; i++) edges.push({ from: `n${i}`, to: `n${PER_LAYER + ((i + 3) % PER_LAYER)}`, label: fill(`extra ${word(i)} `, LIMITS.edgeLabel) });
  const steps = [];
  for (let s = 0; s < LIMITS.steps; s++) steps.push({ title: fill(`Step ${word(s)} `, LIMITS.stepTitle), note: fill(`Step ${word(s)} note. `, LIMITS.stepNote), show: [`n${s * 2}`, `n${s * 2 + 1}`] });
  return { title: fill('Near-limit graph ', LIMITS.title), subtitle: fill('Everything at its cap ', LIMITS.subtitle), type: 'architecture', nodes, edges, steps };
}

/** The same graph with an emoji and a 400-char detail on every node, and 8 stories of 60 beats in all at their caps (steps swap for stories). */
export function nearLimitStories() {
  const { steps: _steps, ...graph } = nearLimitGraph();
  const nodes = graph.nodes.map((n, i) => {
    const { icon: _icon, ...rest } = n;
    return { ...rest, emoji: EMOJI[i % EMOJI.length], detail: fill(`Detail for ${word(i)} explains what it does. `, LIMITS.detail) };
  });
  const stories = [];
  let beat = 0;
  for (let s = 0; s < LIMITS.stories; s++) {
    const count = s < LIMITS.beats % LIMITS.stories ? Math.ceil(LIMITS.beats / LIMITS.stories) : Math.floor(LIMITS.beats / LIMITS.stories);
    const beats = [];
    for (let b = 0; b < count; b++, beat++) {
      const e = graph.edges[beat % graph.edges.length];
      beats.push({ title: fill(`Beat ${word(beat)} `, LIMITS.beatTitle), from: e.from, to: e.to, caption: fill(`Caption ${word(beat)} says what happens here. `, LIMITS.caption) });
    }
    stories.push({ id: `story${s}`, title: fill(`Story ${s} `, LIMITS.storyTitle), beats });
  }
  return { ...graph, nodes, stories };
}
