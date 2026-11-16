// The end kind as a real end card (look.kinds.end.wordmark, cosmos): the closing line centred across the grid, the ask
// under it clear of the line's descenders at no less than the look's secondary floor (kinds/secondary.mjs), and the
// shot's mark set as a wordmark in the display weight: no outline round it (a pill read as a button), frame furniture
// (the brand's running mark: the review's sizes and hero rules leave it out). The look's sun
// stands on its anchored place for the format (sun.mjs), lighting as the mark arrives. The block sits on the
// composition band's optical centre. When the line cannot be set large enough to keep the hero ratio over an ask at the
// floor, the ask is left out and the title says so (props.dropped). Pure and DOM-free.
//
// wordmark data: { titleHeight (share of the band), markShare (of the title size), askGap and gap (em of the title:
// the ask's room under the line's descenders, the mark's under the ask), sun: { strength }, centre (share of the band) }.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { sunNodes, sunAnchor } from '../devices/sun.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, fitDisplay, enterTracks, runInk, unionBox, wordBoxes, heroId } from './shared.mjs';
import { secondarySize, heroFloor } from './secondary.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;
const ASK_MARGIN = 1.03; // the ask a hair under a third of the title, so rounding never takes it over the hero ratio
const DESCENDER = 0.25; // em: how far the display face's descenders reach under the baseline

// The title fitted between `min` and the kind's max across the span.
function fitTitle(shot, ctx, data, title, span, min) {
  const { look, unit, measure } = ctx;
  const max = data.max * unit;
  const opts = { text: setCase(look, 'display', title), font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: 'center', measure, optical: true };
  return fitDisplay(opts, { min: Math.min(min, max), max, maxHeight: editorialBounds(ctx).height(data.wordmark.titleHeight), maxLines: look.maxLines.display }, look, unit);
}

// The block's three texts laid out (title, ask or null, mark), centred on the span, and what was left out.
function layouts(shot, ctx, data, title, span) {
  const { look, unit, measure } = ctx;
  const plain = sizeAt(look, data.fromStep, unit);
  // with an ask, the title at least the hero floor so the ask can stand at the secondary floor; else the ask goes
  const held = shot.ask === undefined ? null : fitTitle(shot, ctx, data, title, span, Math.max(plain, heroFloor(look, unit)));
  const keepsAsk = held !== null && !held.layout.overflow;
  const fit = keepsAsk ? held : fitTitle(shot, ctx, data, title, span, plain);
  const askFont = fontFor(look, 'label', secondarySize(look, unit, fit.font.size / (MIN_HERO_RATIO * ASK_MARGIN)), unit);
  const ask = keepsAsk ? { font: askFont, layout: layoutText({ text: setCase(look, 'label', shot.ask), font: askFont, maxWidth: span.w, align: 'center', measure }) } : null;
  const markFont = fontFor(look, 'display', secondarySize(look, unit, fit.font.size * data.wordmark.markShare), unit);
  const mark = { font: markFont, layout: layoutText({ text: shot.mark, font: markFont, maxWidth: span.w, align: 'center', measure }) };
  return { title: fit, ask, mark, dropped: shot.ask !== undefined && !keepsAsk ? ['ask'] : [] };
}

// Each text's baseline offset from the title's first cap line, stacked down: the ask under the descenders.
function stack(set, data, ctx) {
  const wm = data.wordmark;
  const size = set.title.font.size, t = set.title.layout;
  const titleY = CAP_HEIGHT * size - t.lines[0].y;
  let bottom = titleY + t.lines.at(-1).y + DESCENDER * size;
  const askY = set.ask === null ? null : bottom + wm.askGap * size + CAP_HEIGHT * set.ask.font.size - set.ask.layout.lines[0].y;
  if (askY !== null) bottom = askY + set.ask.layout.lines.at(-1).y + WORD_DESCENT * set.ask.font.size;
  const m = set.mark, ink = runInk(m.layout.lines[0], m.font, ctx.measure);
  const markTop = bottom + wm.gap * size;
  const markY = markTop + ink.up - m.layout.lines[0].y;
  return { titleY, askY, markY, height: markTop + ink.up + ink.down, ink };
}

/** The wordmark end card: { nodes, boxes, hero }. */
export function expandWordmark(shot, ctx, data, times, title) {
  const { look, unit } = ctx;
  const wm = data.wordmark;
  const span = editorialSpan(ctx, 1, look.grid.columns);
  const bounds = editorialBounds(ctx);
  const set = layouts(shot, ctx, data, title, span);
  const at = stack(set, data, ctx);
  const top = Math.max(bounds.top, bounds.at(wm.centre) - at.height / HALF);
  const x = span.x, hero = heroId(shot, 'title');
  const titleNode = node('text', hero, {
    x, y: top + at.titleY, layout: set.title.layout, font: set.title.font, fill: look.palette.ink, role: 'hero', ...(set.dropped.length ? { dropped: set.dropped } : {}),
  }, { wordTracks: times.title.map((w) => enterTracks(look, unit, w.at)) });
  const markAt = (set.ask === null ? undefined : times.ask) ?? times.title.at(-1)?.at ?? 0;
  const nodes = [titleNode];
  const words = wordBoxes(set.title.layout, x, top + at.titleY);
  const boxes = { title: unionBox(words), ...Object.fromEntries(words.map((box, i) => [`word:${i}`, box])) };
  if (set.ask !== null) {
    const y = top + at.askY;
    nodes.push(node('text', `${shot.id}.ask`, { x, y, layout: set.ask.layout, font: set.ask.font, fill: look.palette.ink2, role: 'ask' }, { tracks: enterTracks(look, unit, times.ask, { y }) }));
    boxes.ask = unionBox(wordBoxes(set.ask.layout, x, y));
  }
  const markY = top + at.markY;
  nodes.push(node('text', `${shot.id}.mark.text`, { x, y: markY, layout: set.mark.layout, font: set.mark.font, fill: look.palette.ink, role: 'mark', furniture: true }, { tracks: enterTracks(look, unit, markAt, { y: markY }) }));
  boxes.mark = [x + at.ink.left, markY + set.mark.layout.lines[0].y - at.ink.up, at.ink.right - at.ink.left, at.ink.up + at.ink.down];
  const sun = sunNodes(`${shot.id}.sun`, look, { ...sunAnchor(look, ctx), strength: wm.sun.strength, at: markAt });
  return { nodes: [...sun, ...nodes], boxes, hero };
}
