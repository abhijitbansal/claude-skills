// Markup for the Simple English view (the second version of a section's text, see simple.mjs): the body held twice,
// the heading text when it differs, the toggle button, and the stylesheet and script a page ships only when it has
// simple text.
import fs from 'node:fs';
import { headingInline } from './render/ui.mjs';
import { inlineCode } from './inline-code.mjs';

const CSS = new URL('../../template/simple.css', import.meta.url);
const JS = new URL('../../template/simple.js', import.meta.url);

/** The toggle's visible name. */
export const SIMPLE_LABEL = 'Simple English';

/** Both versions of a section's body: the normal text first and showing, the simple text hidden until the toggle asks. */
export const dualText = (normal, simple) => `<div data-text="normal">${normal}</div>\n<div data-text="simple" hidden>${simple}</div>`;

/**
 * A section's heading text. `view` is the section as the simple view shows it (withSimple) or null. When the simple
 * view has a different title, the heading holds both as spans and the heading element, its id and its anchor stay one.
 */
export function titleHtml(section, view) {
  const normal = headingInline(section.title);
  if (view === null || view.title === undefined || view.title === section.title) return normal;
  return `<span data-text="normal">${normal}</span><span data-text="simple" hidden>${headingInline(view.title)}</span>`;
}

/** The toggle button. It wears the theme toggle's classes so it takes the same surface, line and flavor treatment. */
export const simpleToggle = () => `<button type="button" class="theme-toggle simple-toggle" data-simple-toggle aria-pressed="false"><span class="simple-dot" aria-hidden="true"></span>${SIMPLE_LABEL}</button>`;

/** The head part of a page with simple text: its stylesheet, then the script that applies the saved choice before first paint. */
export function simpleHead() {
  const css = fs.readFileSync(CSS, 'utf8').replace(/\n$/, '');
  const js = fs.readFileSync(JS, 'utf8').replace(/\n$/, '');
  return `\n<style>\n${css}\n</style>\n<script>\n${inlineCode(js)}\n</script>`;
}
