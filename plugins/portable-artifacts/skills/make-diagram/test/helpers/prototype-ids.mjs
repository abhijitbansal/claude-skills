// Specs whose ids are named like Object.prototype members; shared by ids.test.mjs and the browser suite.
export const PROTOTYPE_NAMED_SPECS = {
  'a node named constructor': {
    title: 'N', type: 'flow',
    nodes: [{ id: 'constructor', label: 'Ctor' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'constructor', to: 'b', label: 'go' }],
    steps: [{ title: 'one', show: ['constructor'], highlight: ['constructor'] }],
  },
  'a group named constructor': {
    title: 'G', type: 'architecture',
    groups: [{ id: 'constructor', label: 'Group' }],
    nodes: [{ id: 'a', label: 'A', group: 'constructor' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
    steps: [{ title: 'group', focus: ['constructor'], highlight: ['constructor'] }],
  },
  'a group named constructor at a two-headed edge end': {
    title: 'GE', type: 'architecture',
    groups: [{ id: 'constructor', label: 'Group' }],
    nodes: [{ id: 'a', label: 'A', group: 'constructor' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'constructor', both: true }],
  },
  'an edge named constructor': {
    title: 'E', type: 'state',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ id: 'constructor', from: 'a', to: 'b' }],
  },
  'a participant and a message named constructor': {
    title: 'S', type: 'sequence',
    participants: [{ id: 'constructor', label: 'Ctor' }, { id: 'b', label: 'B' }],
    messages: [{ id: 'm1', from: 'constructor', to: 'b', label: 'hi' }],
  },
  'a message named constructor': {
    title: 'M', type: 'sequence',
    participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    messages: [{ id: 'constructor', from: 'a', to: 'b', label: 'hi' }],
  },
  'a story named constructor hopping from a node named constructor': {
    title: 'St', type: 'flow',
    nodes: [{ id: 'constructor', label: 'Ctor' }, { id: 'b', label: 'B' }],
    edges: [{ id: 'hop', from: 'constructor', to: 'b' }],
    stories: [{ id: 'constructor', title: 'Ctor', beats: [{ title: 'go', from: 'constructor', to: 'b' }, { title: 'look', focus: ['constructor'] }] }],
  },
};
