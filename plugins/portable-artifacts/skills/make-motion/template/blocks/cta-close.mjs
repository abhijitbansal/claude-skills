// cta-close: a closing headline, an accent button with the action, and an optional address shown as text.
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, LINE_HEIGHT, MIN_TEXT, centrePlace } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'action'],
  properties: {
    headline: { type: 'string', minLength: 1, maxLength: 80 },
    action: { type: 'string', minLength: 1, maxLength: 24 },
    url: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

function expand(el, { size, sceneDuration, insets }) {
  const u = unit(size);
  const { headline, action, url } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 1500 * u, 48 * u, insets);
  const headFit = fitText(headline, { size: 96 * u, min: 48 * u, maxWidth: width, maxLines: 3, lineHeight: LINE_HEIGHT.title });
  const padX = 44 * u;
  const actionFit = fitText(action, { size: 44 * u, min: MIN_TEXT * u, maxWidth: width - 2 * padX, maxLines: 1 });
  const buttonH = Math.max(88 * u, actionFit.height + 2 * 20 * u);
  const buttonW = Math.min(width, Math.max(280 * u, textWidth(action, actionFit.fontSize) + 2 * padX));
  const urlFit = url && fitText(url, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: width, maxLines: 2 });
  const ys = stack([headFit.height, buttonH, ...(urlFit ? [urlFit.height] : [])], [56 * u, 28 * u]);
  const at = squeeze(sceneDuration, slot(urlFit ? 2 : 1)[1]);
  const span = (i) => slot(i).map(at);
  const parts = [
    enter(textPart(id('headline'), headline, 0, ys[0], { fontSize: headFit.fontSize, maxWidth: width, fontWeight: 700, role: 'title', color: 'text' }), span(0), { dy: 24 * u }),
    enter(rectPart(id('button'), 0, ys[1], buttonW, buttonH, { fill: 'accent', radius: Math.round(buttonH / 2) }), span(1), { scale: 0.9 }),
    enter(textPart(id('action'), action, 0, ys[1], { fontSize: actionFit.fontSize, maxWidth: width - 2 * padX, fontWeight: 700, color: 'surface' }), span(1), { scale: 0.9 }),
  ];
  if (urlFit) parts.push(enter(textPart(id('url'), url, 0, ys[2], { fontSize: urlFit.fontSize, maxWidth: width, fontWeight: 500, font: 'mono', color: 'text2' }), span(2), { dy: 16 * u }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'the closing ask: a headline, a button with what to do, and where to go',
  params,
  describe: {
    headline: 'the closing line, up to 80 characters',
    action: 'the button text, up to 24 characters, such as "Start free"',
    url: 'an address under the button, shown as text (nothing is linked or fetched)',
  },
  example: { headline: 'Make your first video today', action: 'Start free', url: 'example.com/start' },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  hook: ['headline'],
  expand,
});
