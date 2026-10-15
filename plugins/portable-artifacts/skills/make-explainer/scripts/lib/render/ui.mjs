// Small building blocks shared by the section renderers. Every piece of spec
// text goes through renderInline / escapeHtml; enum-like values (tone,
// severity, ...) never reach the markup directly, only through the closed
// tables below, so an unexpected value falls back to neutral.
import { escapeHtml, renderInline, renderHeadingInline } from '../markdown.mjs';

export const esc = escapeHtml;
export const inline = renderInline;
/** Like inline(), but a link becomes its label: for section titles, which are headings. */
export const headingInline = renderHeadingInline;

/**
 * Markdown-lite -> HTML-escaped text with every tag removed. Safe to place in
 * element text and in quoted attributes (aria-labels, the TOC, <title>);
 * do not escape it again.
 */
export function plain(text) {
  return renderInline(String(text)).replace(/<[^>]*>/g, '');
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
/** The same text unescaped, for places that want raw characters (slugs). */
export function rawText(text) {
  return plain(text).replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e]);
}

// 16x16 line glyphs, drawn with currentColor. Status is always a shape plus a
// word; colour only reinforces it.
const GLYPHS = {
  check: '<path d="M3 8.5l3.2 3.2L13 4.8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  edit: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/>',
  circle: '<circle cx="8" cy="8" r="5.5"/>',
  half: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  square: '<rect x="3" y="3" width="10" height="10" rx="1.5"/>',
  triangle: '<path d="M8 2.5l6 10.5H2z"/>',
  diamond: '<path d="M8 1.8l6.2 6.2L8 14.2 1.8 8z" fill="currentColor"/>',
  info: '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.3v3.7M8 5v.1"/>',
  warn: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.8v3M8 11.4v.1"/>',
  good: '<circle cx="8" cy="8" r="5.8"/><path d="M5.4 8.2l1.9 1.9 3.4-3.7"/>',
  bad: '<circle cx="8" cy="8" r="5.8"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
  folder: '<path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/>',
};

export function glyph(name) {
  const body = GLYPHS[name] ?? GLYPHS.circle;
  return `<svg class="gl" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : null);

/** A status chip: glyph + word. `entry` is [label, glyph, toneClass]. */
export function chip([label, glyphName, tone]) {
  return `<span class="chip tone-${tone}">${glyph(glyphName)}<span>${esc(label)}</span></span>`;
}

const TONE_CHIPS = { good: ['Good', 'good', 'good'], warn: ['Caution', 'warn', 'warn'], bad: ['Problem', 'bad', 'bad'] };
/** A chip for good / warn / bad; nothing for neutral, accent or unknown. */
export const toneChip = (tone) => {
  const entry = own(TONE_CHIPS, tone);
  return entry ? chip(entry) : '';
};
/** The CSS tone class for any tone value. */
export const toneClass = (tone) => (['accent', 'good', 'warn', 'bad'].includes(tone) ? `tone-${tone}` : 'tone-neutral');

export const SEVERITY = {
  low: ['Low', 'circle', 'low'],
  medium: ['Medium', 'square', 'medium'],
  high: ['High', 'triangle', 'high'],
  critical: ['Critical', 'diamond', 'critical'],
};
export const CHANGE = {
  added: ['Added', 'plus', 'good'],
  modified: ['Modified', 'edit', 'neutral'],
  deleted: ['Deleted', 'minus', 'bad'],
  renamed: ['Renamed', 'arrow', 'accent'],
};
export const STATUS = {
  done: ['Done', 'check', 'good'],
  doing: ['In progress', 'half', 'accent'],
  todo: ['To do', 'circle', 'neutral'],
};
export const CALLOUT = {
  info: ['Note', 'info', 'accent'],
  warn: ['Warning', 'warn', 'warn'],
  good: ['Good news', 'good', 'good'],
  bad: ['Problem', 'bad', 'bad'],
};
export const lookup = (table, key, fallback) => own(table, key) ?? table[fallback];
