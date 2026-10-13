// Normalises a built page for the golden tests: the body markup only (the head and the runtime
// scripts have their own tests), embedded images shortened, and every <svg> that a sibling skill
// drew (make-diagram figures and icons, make-dashboard charts) emptied to a placeholder. A palette,
// font or geometry change in a sibling then cannot fail make-explainer's goldens; its wrappers stay.
// The explainer's own glyphs (<svg class="gl">) are kept: they are this skill's markup.
import assert from 'node:assert/strict';

const OWN_GLYPH = /^<svg class="gl"[\s>]/;
const SVG_TAG = /<(\/?)svg\b[^>]*>/g;

/** Replaces each outermost non-glyph <svg ...>...</svg> (nested svgs included) with <svg data-sibling-svg></svg>. */
export function emptySiblingSvgs(html) {
  let out = '';
  let last = 0;
  let depth = 0;
  let start = -1;
  let skipping = false;
  for (const m of html.matchAll(SVG_TAG)) {
    const closing = m[1] === '/';
    if (depth === 0 && !closing) {
      skipping = !OWN_GLYPH.test(m[0]);
      start = m.index;
    }
    depth += closing ? -1 : 1;
    if (depth === 0 && skipping) {
      out += `${html.slice(last, start)}<svg data-sibling-svg></svg>`;
      last = m.index + m[0].length;
      skipping = false;
    }
  }
  return out + html.slice(last);
}

export function normalisedBody(html) {
  const start = html.indexOf('<body');
  const main = html.indexOf('</main>');
  assert.ok(start > 0 && main > start, 'page has a <body> and a closing </main>');
  const body = html.slice(start, main + '</main>'.length);
  const shortImages = body.replace(/data:image\/([a-z+]+);base64,[A-Za-z0-9+/=]+/g, 'data:image/$1;base64,…');
  return `${emptySiblingSvgs(shortImages)}\n`;
}
