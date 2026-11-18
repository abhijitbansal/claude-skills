// The deck's colophon: who made the deck and with what, as ONE quiet line on the closing slide. The page footer keeps
// its two lines (provenance, theme). Same words as shared/provenance.mjs, so the truth rule holds: a field the agent
// did not report still says "not reported". Unreported fields are grouped ("model, effort, agent not reported") so
// the line fits a phone; reported ones print their value.
import { FIELDS, buildDate } from '../../shared/provenance.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const has = (v) => typeof v === 'string' && v.length > 0;

function describe(gen = {}) {
  const parts = [];
  if (has(gen.model)) parts.push(gen.model);
  if (has(gen.effort)) parts.push(`${gen.effort} effort`);
  if (has(gen.agent)) parts.push(gen.agent);
  const missing = FIELDS.filter((k) => !has(gen[k]));
  if (missing.length > 0) parts.push(`${missing.join(', ')} not reported`);
  return parts;
}

const SEP = ' · ';

// The line in three parts: the skill, the provenance (reported values, what is not reported, the date), the theme.
function parts(skill, gen, date, themeName) {
  const d = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return { skill, provenance: [...describe(gen), d].join(SEP), theme: themeName ? `Theme: ${themeName}` : '' };
}

/** The colophon text: skill · reported values · what is not reported · date · theme. */
export function colophonText(skill, gen, date = buildDate(), themeName = '') {
  const p = parts(skill, gen, date, themeName);
  return [p.skill, p.provenance, p.theme].filter(Boolean).join(SEP);
}

/**
 * The closing slide's footer: one <p class="pa-colophon">, the full line also in its title. The skill name and the
 * theme name are spans the stylesheet hides on a phone, where the provenance itself only just fits one line.
 */
export function colophonHtml(skill, gen, date = buildDate(), themeName = '') {
  const p = parts(skill, gen, date, themeName);
  const theme = p.theme ? `<span class="pa-colophon-theme">${SEP}${esc(p.theme)}</span>` : '';
  return `<footer class="pa-footer"><p class="pa-colophon" title="${esc(colophonText(skill, gen, date, themeName))}"><span class="pa-colophon-skill">${esc(p.skill)}${SEP}</span>${esc(p.provenance)}${theme}</p></footer>`;
}
