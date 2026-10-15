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

export function mergeGeneratedBy(fromSpec, flags = {}) {
  const merged = {};
  for (const k of FIELDS) {
    const v = flags[k] ?? fromSpec?.[k];
    if (v !== undefined) merged[k] = v;
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function buildDate(env = process.env) {
  const epoch = env.SOURCE_DATE_EPOCH;
  return /^\d+$/.test(epoch ?? '') ? new Date(Number(epoch) * 1000) : new Date();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DATE_FMT = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };

export function provenanceText(skill, gen = {}, date = buildDate()) {
  return [
    skill,
    gen?.model ?? 'model not reported',
    gen?.effort ? `${gen.effort} effort` : 'effort not reported',
    gen?.agent ?? 'agent not reported',
    date.toLocaleDateString('en-GB', DATE_FMT),
  ].join(' · ');
}

export const provenanceHtml = (skill, gen, date) => `<p class="pa-provenance">${esc(provenanceText(skill, gen, date))}</p>`;

export function generatorMeta(skill, gen = {}) {
  const parts = FIELDS.map((k) => `${k}=${gen?.[k] ?? 'not reported'}`).join('; ');
  return `<meta name="generator" content="${esc(`portable-artifacts ${skill}; ${parts}`)}">`;
}
