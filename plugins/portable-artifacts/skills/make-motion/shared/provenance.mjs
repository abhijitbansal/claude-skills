// plugins/portable-artifacts/shared/provenance.mjs
// Who generated an artifact: the model, its effort level and the agent host.
// The agent self-reports; anything it cannot know renders as "not reported".

export const FIELDS = ['model', 'effort', 'agent'];
export const MAX_FIELD = 60;
const PATTERN = '^[A-Za-z0-9 ._:/()+-]+$';
const field = { type: 'string', minLength: 1, maxLength: MAX_FIELD, pattern: PATTERN };

export const GENERATED_BY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { model: field, effort: field, agent: field },
};

export const PROVENANCE_OPTIONS = { model: { type: 'string' }, effort: { type: 'string' }, agent: { type: 'string' } };

// Unknown spec keys are kept so the closed schema can reject typos like "modle".
export function mergeGeneratedBy(fromSpec, flags = {}) {
  const merged = { ...fromSpec };
  for (const k of FIELDS) {
    if (flags[k] !== undefined) merged[k] = flags[k];
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function buildDate(env = process.env) {
  const epoch = env.SOURCE_DATE_EPOCH;
  if (!/^\d+$/.test(epoch ?? '')) return new Date();
  const date = new Date(Number(epoch) * 1000);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const has = (v) => typeof v === 'string' && v.length > 0;

export function provenanceText(skill, gen = {}, date = buildDate()) {
  return [
    skill,
    has(gen?.model) ? gen.model : 'model not reported',
    has(gen?.effort) ? `${gen.effort} effort` : 'effort not reported',
    has(gen?.agent) ? gen.agent : 'agent not reported',
    formatDate(date),
  ].join(' · ');
}

export const provenanceHtml = (skill, gen, date) => `<p class="pa-provenance">${esc(provenanceText(skill, gen, date))}</p>`;

export function generatorMeta(skill, gen = {}) {
  const parts = FIELDS.map((k) => `${k}=${has(gen?.[k]) ? gen[k] : 'not reported'}`).join('; ');
  return `<meta name="generator" content="${esc(`portable-artifacts ${skill}; ${parts}`)}">`;
}
