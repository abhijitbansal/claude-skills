// Text and markup helpers for the page and the embeddable fragment. Every string from a spec goes
// through esc() (HTML) or jsonForScript() (the data block); nothing is ever concatenated raw.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** JSON that is safe inside <script type="application/json">: no "<", ">", "&" or line separators survive. */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Inline script text must not close its tag or open an HTML comment. */
export const inlineCode = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');

/** Inline style text must not close its tag. */
export const inlineCss = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

function table(columns, rows, caption) {
  const head = `<tr>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="sc-table"><table><caption>${esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// The sibling's own SVG (make-diagram / make-dashboard output): trusted markup, so it is not escaped.
function svgBlock({ svg, svgDark }) {
  if (!svg) return '';
  if (!svgDark) return `<div class="sc-fb-svg">${svg}</div>`;
  return `<div class="sc-fb-svg sc-fb-light">${svg}</div><div class="sc-fb-svg sc-fb-dark">${svgDark}</div>`;
}

/**
 * The semantic no-WebGL view, also the screen-reader view: the 2D svg when a lift supplies one (both
 * themes when it has a dark twin), the data table, and the links table when the graph has links.
 */
export function fallbackHtml(graph) {
  const fb = graph.fallback;
  const parts = [svgBlock(fb)];
  if (fb.rows.length > 0 || !fb.svg) parts.push(table(fb.columns, fb.rows, `${graph.title} as a table`));
  if (fb.links && fb.links.rows.length > 0) parts.push(table(fb.links.columns, fb.links.rows, 'Links'));
  return parts.join('');
}
