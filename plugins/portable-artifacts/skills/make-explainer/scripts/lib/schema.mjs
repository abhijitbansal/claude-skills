// explainer.json: JSON Schema (structure and closed sets) plus the limits that
// spec.mjs enforces. Lengths and counts are checked there instead, so their
// messages can state the value and the limit. Each section type has its own
// closed schema; validateSpec picks it by `type`.
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';

export const NON_SPACE = '\\S';
export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const PRESETS = ['recap', 'checklist', 'concept', 'slides', 'plan', 'none'];
export const MODES = ['page', 'slides'];
export const META_KEYS = ['date', 'branch', 'repo', 'author', 'version', 'status'];
export const TONES = ['neutral', 'accent', 'good', 'warn', 'bad'];
export const CALLOUT_TONES = ['info', 'warn', 'good', 'bad'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const CHANGES = ['added', 'modified', 'deleted', 'renamed'];
export const STEP_STATUSES = ['done', 'doing', 'todo'];
export const CHECK_TAGS = ['regression', 'device', 'manual', 'visual'];
export const ALIGNS = ['left', 'center', 'right'];

export const LIMITS = Object.freeze({
  title: 90,
  subtitle: 140,
  meta: 60,
  sections: [1, 40],
  tldrText: 400,
  tldrPoints: 6,
  point: 160,
  text: 4000,
  kpis: [1, 6],
  cards: [1, 12],
  tableColumns: [1, 8],
  tableRows: [1, 60],
  files: [1, 200],
  compareColumns: [2, 3],
  codeLines: 120,
  chartRows: 500,
  checklistKey: 80,
  planOptions: [2, 5],
  reviewItems: [1, 5],
});

// Slide content budget (each section is one slide in slides mode).
export const SLIDE_LIMITS = Object.freeze({ points: 6, tableRows: 8, codeLines: 12, words: 80 });

// \S: at least one non-space character (also rejects ""). spec.mjs words the error.
const text = { type: 'string', pattern: NON_SPACE };
const list = (items) => ({ type: 'array', items });
const items = (props, required) => list(object(required, props));

function object(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

const tone = { enum: TONES };
const cell = { type: ['string', 'number'] };
// A number or non-blank text (the pattern applies to strings only).
const metric = { type: ['string', 'number'], pattern: NON_SPACE };

// A section schema: every section has a type and may have an id, a title and a label (a short name for the contents list).
function section(type, required, props) {
  return object(['type', ...required], { type: { const: type }, id: text, title: text, label: text, ...props });
}

export const SECTION_SCHEMAS = {
  tldr: section('tldr', ['text'], { text, points: list(text), tone }),
  text: section('text', ['text'], { text }),
  kpis: section('kpis', ['items'], {
    items: items({ label: text, value: metric, delta: text, tone, note: text }, ['label', 'value']),
  }),
  cards: section('cards', ['items'], {
    items: items({ title: text, text, icon: text, tone, tag: text }, ['title', 'text']),
    columns: { enum: [2, 3, 4] },
  }),
  table: section('table', ['columns', 'rows'], {
    columns: list(text),
    rows: list(list(cell)),
    caption: text,
    align: list({ enum: ALIGNS }),
  }),
  risks: section('risks', ['items'], {
    items: items({ risk: text, severity: { enum: SEVERITIES }, mitigation: text, owner: text }, ['risk', 'severity', 'mitigation']),
  }),
  files: section('files', ['items'], {
    items: items(
      { path: text, change: { enum: CHANGES }, note: text, add: { type: 'integer', minimum: 0 }, del: { type: 'integer', minimum: 0 } },
      ['path', 'change'],
    ),
  }),
  steps: section('steps', ['items'], {
    items: items({ title: text, text, status: { enum: STEP_STATUSES } }, ['title']),
  }),
  timeline: section('timeline', ['items'], {
    items: items({ date: text, title: text, text }, ['date', 'title']),
  }),
  compare: section('compare', ['columns'], {
    columns: items({ title: text, points: list(text), tone }, ['title', 'points']),
    verdict: text,
  }),
  callout: section('callout', ['tone', 'title', 'text'], { tone: { enum: CALLOUT_TONES }, text }),
  code: section('code', ['code'], { code: text, language: text, caption: text }),
  details: section('details', ['summary', 'text'], { summary: text, text }),
  checklist: section('checklist', ['key', 'groups'], {
    key: text,
    groups: items(
      { title: text, items: items({ text, tag: { enum: CHECK_TAGS }, note: text }, ['text']) },
      ['title', 'items'],
    ),
    intro: text,
    onFail: text,
  }),
  diagram: section('diagram', ['diagram'], { diagram: { type: ['string', 'object'] }, caption: text }),
  chart: section('chart', [], {
    dashboard: text,
    chart: text,
    data: list({ type: 'object' }),
    kind: text,
    x: text,
    y: text,
    color: text,
    size: text,
    value: text,
    format: text,
    caption: text,
    interactive: { type: 'boolean' },
  }),
  scene: section('scene', ['scene'], { scene: { type: ['string', 'object'] }, caption: text }),
  motion: section('motion', [], { video: text, spec: text, poster: text, caption: text }),
  image: section('image', ['src', 'alt'], { src: text, alt: text, caption: text }),
  // Plan mode. decision, approval and question require an id: answers key on it (unique across the page, checkIds).
  decision: section('decision', ['id', 'question', 'options', 'recommended', 'why'], {
    question: text,
    options: items({ label: text, pros: list(text), cons: list(text) }, ['label']),
    recommended: text,
    why: text,
    default: text,
  }),
  approval: section('approval', ['id', 'item', 'why'], { item: text, why: text, impact: text, owner: text }),
  question: section('question', ['id', 'text'], { text, default: text }),
  review: section('review', ['items'], {
    items: items({ point: text, why: text, target: text }, ['point', 'why']),
  }),
  verdict: section('verdict', [], { text }),
};

export const TYPES = Object.keys(SECTION_SCHEMAS);

// Section `type` is checked on its own first so a typo gets did-you-mean.
export const TYPE_SCHEMA = object(['type'], { type: { enum: TYPES } });
TYPE_SCHEMA.additionalProperties = true;

// The top level. `sections` entries are checked per type (see above).
export const ROOT_SCHEMA = object(['title', 'sections'], {
  title: text,
  subtitle: text,
  preset: { enum: PRESETS },
  key: text,
  mode: { enum: MODES },
  theme: text,
  generatedBy: GENERATED_BY_SCHEMA,
  meta: object([], Object.fromEntries(META_KEYS.map((k) => [k, text]))),
  sections: list({ type: 'object' }),
});
