// lower-third-social: a social handle on a card, led by the platform's name as a text chip (no logos). Its `x`, `y` is
// the bottom-left corner of the card's outer edge, as lower-third's: the card grows up and right from there.
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, MIN_TEXT, LINE_HEIGHT } from './layout.mjs';
import lowerThird from './lower-third.mjs';

const PLATFORMS = Object.freeze({ x: 'X', github: 'GitHub', linkedin: 'LinkedIn', youtube: 'YouTube', instagram: 'Instagram' });

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['handle', 'platform'],
  properties: {
    handle: { type: 'string', minLength: 1, maxLength: 80 },
    platform: { enum: Object.keys(PLATFORMS) },
  },
};

const EDGE_INSET = 40; // px at 1080 from the safe area to the card's outer edge

function expand(el, { size, sceneDuration, insets }) {
  const u = unit(size);
  const { handle, platform } = el.params;
  const label = PLATFORMS[platform] ?? platform;
  const id = (part) => `${el.id}/${part}`;
  const pad = 20 * u;
  const gap = 24 * u;
  const chipPadX = 20 * u;
  const chipPadY = 10 * u;
  const labelFs = Math.max(1, Math.round(MIN_TEXT * u));
  const labelH = labelFs * LINE_HEIGHT.sans;
  const chipH = labelH + 2 * chipPadY;
  const chipW = Math.max(chipH, textWidth(label, labelFs) + 2 * chipPadX);
  const maxCard = contentWidth(size, Math.max(900 * u, 0.55 * size[0]), EDGE_INSET * u, insets);
  const area = maxCard - 2 * pad - chipW - gap;
  const handleFit = fitText(handle, { size: 52 * u, min: 44 * u, maxWidth: area, maxLines: 2 });
  const inner = Math.min(area, Math.max(200 * u, textWidth(handle, handleFit.fontSize)));
  const cardW = 2 * pad + chipW + gap + inner;
  const cardH = 2 * pad + Math.max(chipH, handleFit.height);
  const parts = [
    rectPart(id('card'), cardW / 2, -cardH / 2, cardW, cardH, { fill: 'surface', radius: Math.round(12 * u), elevated: true }),
    rectPart(id('chip'), pad + chipW / 2, -cardH / 2, chipW, chipH, { fill: 'accent', radius: Math.round(8 * u) }),
    textPart(id('platform'), label, pad + chipW / 2, -cardH / 2, { fontSize: labelFs, maxWidth: chipW, fontWeight: 700, color: 'surface' }),
    textPart(id('handle'), handle, pad + chipW + gap + inner / 2, -cardH / 2, { fontSize: handleFit.fontSize, maxWidth: inner, fontWeight: 600, color: 'text' }),
  ];
  const order = [0, 1, 1, 2];
  const at = squeeze(sceneDuration, slot(2)[1]);
  return blockGroup(el, parts.map((part, i) => enter(part, slot(order[i]).map(at), { dx: -40 * u })));
}

export default Object.freeze({
  summary: 'a social handle on a card near the bottom-left corner, led by the platform\'s name (text only, no logos)',
  params,
  describe: {
    handle: 'the account name as it should read, including any @ (it is drawn as written)',
    platform: 'x, github, linkedin, youtube or instagram: its name is shown as a text label beside the handle; no logo is drawn',
  },
  example: { handle: '@adalovelace', platform: 'github' },
  // x, y is the card's bottom-left corner: where lower-third puts it, 24 px above the caption zone, so captions never cover it.
  place: (size, format, _side, insets = null) => lowerThird.place(size, format, 'left', insets),
  expand,
});
