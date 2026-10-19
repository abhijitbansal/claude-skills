// scene.json: the closed ajv schema (additionalProperties false everywhere)
// and the numeric limits the semantic checks enforce.
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
import { WORLDS } from './eligibility.mjs';

export const LIMITS = {
  rows: 2000, groups: 24, beats: 12, group: 48,
  beatTitle: 48, caption: 160, title: 120, subtitle: 160,
};

const str = { type: 'string' };
const word = { type: 'string', minLength: 1 };

export const ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['group', 'value'],
  properties: {
    group: word,
    t: { type: ['string', 'number'] },
    value: { type: 'number' },
    label: str,
    parent: word,
  },
};

export const LINK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: { from: word, to: word, value: { type: 'number' } },
};

export const ROWS_SCHEMA = { type: 'array', items: ROW_SCHEMA };
export const LINKS_SCHEMA = { type: 'array', items: LINK_SCHEMA };

const COLUMN_FIELDS = ['group', 't', 'value', 'label', 'parent'];
export { COLUMN_FIELDS };

const BEAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'focus'],
  properties: {
    title: word,
    caption: str,
    focus: { type: 'array', minItems: 1, items: word },
  },
};

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: word,
    subtitle: str,
    world: { enum: WORLDS },
    theme: word,
    data: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rows: ROWS_SCHEMA,
        file: word,
        csv: word,
        columns: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(COLUMN_FIELDS.map((f) => [f, word])),
        },
      },
    },
    links: LINKS_SCHEMA,
    lift: {
      type: 'object',
      additionalProperties: false,
      properties: {
        diagram: { type: ['string', 'object'] },
        dashboard: word,
        chart: word,
      },
    },
    units: str,
    tour: { type: 'array', items: BEAT_SCHEMA },
    autoplay: { type: 'boolean' },
    generatedBy: GENERATED_BY_SCHEMA,
  },
};
