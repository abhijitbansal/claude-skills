// What code-typing, code-diff and terminal-run share: an optional title over an elevated panel holding one `code`
// element, laid out to fit the block's room (the band above the caption zone when the spec has captions). The code is
// 32 px at 1080 when it fits, else 28 (the text floor), else smaller still so the box never leaves the room; check.mjs
// then reports the code under the text floor, naming the param to shorten.
import { unit, contentWidth, fitHeight, fitCode, sizeLadder, stack, freeBand, roomAt, textPart, rectPart, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';

const TITLE_SIZES = [64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const CODE_SIZES = [32, 28]; // px at 1080: the code's sizes before it drops under the text floor
const PANEL_PAD = 32; // px at 1080 between the panel edge and the code
const TITLE_GAP = 32; // px at 1080 between the title and the panel
const PANEL_RADIUS = 24;

/**
 * The layout of a code panel for block element `el`: `lines` the code's lines, `title` an optional heading, `cap` the
 * widest the panel may be (px at 1080). -> { u, codeWidth, fontSize, title?: { fontSize, y, width }, panel: { y, width,
 * height } }, every y relative to the block's centre.
 */
export function codePanelLayout(el, ctx, { lines, title, cap }) {
  const { size } = ctx;
  const u = unit(size);
  const width = contentWidth(size, cap * u, 0, ctx.insets);
  const pad = PANEL_PAD * u;
  const codeWidth = Math.max(1, width - 2 * pad);
  const room = roomAt(freeBand(ctx), el.y);
  const heading = title === undefined ? null : fitHeight(title, { sizes: sizeLadder(TITLE_SIZES, u), maxWidth: width, maxHeight: Infinity, lineHeight: LINE_HEIGHT.title });
  const above = heading ? heading.height + TITLE_GAP * u : 0;
  const code = fitCode(lines, { sizes: sizeLadder(CODE_SIZES, u), width: codeWidth, maxHeight: Math.max(0, room - above - 2 * pad) });
  const panelHeight = code.height + 2 * pad;
  const ys = heading ? stack([heading.height, panelHeight], [TITLE_GAP * u]) : [0];
  return {
    u, codeWidth, fontSize: code.fontSize,
    title: heading && { fontSize: heading.fontSize, y: ys[0], width },
    panel: { y: ys.at(-1), width, height: panelHeight },
  };
}

// The panel's rect and the title's text (when there is one), not yet animated: [panel, title?].
export function panelParts(id, layout, title) {
  const { u, panel } = layout;
  const rect = rectPart(id('panel'), 0, panel.y, panel.width, panel.height, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(PANEL_RADIUS * u), elevated: true });
  if (!layout.title) return [rect];
  return [rect, textPart(id('title'), title, 0, layout.title.y, { fontSize: layout.title.fontSize, maxWidth: layout.title.width, fontWeight: 700, color: 'text' })];
}
