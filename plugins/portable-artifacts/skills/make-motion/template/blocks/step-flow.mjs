// step-flow: 2 to 6 numbered steps in boxes joined by arrows, as a row or a column, each box then its arrow in turn.
import { unit, contentWidth, fitText, lineCount, squeeze, slot, textPart, rectPart, linePart, enter, drawIn, blockGroup, LINE_HEIGHT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 24 } },
    direction: { enum: ['row', 'column'] },
  },
};

const MIN_ROW_BOX = 200; // px at 1080: a row whose boxes would be narrower is laid out as a column

// The boxes' centres, size and label room, and the arrows' centres and angle, for `n` steps laid out `direction`.
function rowLayout(n, size, u) {
  const gap = 64 * u;
  const box = Math.min(360 * u, (contentWidth(size, 1720 * u, 40 * u) - (n - 1) * gap) / n);
  const step = box + gap;
  const x = (i) => (i - (n - 1) / 2) * step;
  return { box, gap, labelWidth: box - 40 * u, maxLines: 3, centre: (i) => [x(i), 0], arrow: (i) => [x(i) + step / 2, 0], rotate: 0 };
}

function columnLayout(n, size, u, boxH) {
  const gap = 44 * u;
  const step = boxH + gap;
  const y = (i) => (i - (n - 1) / 2) * step;
  const box = contentWidth(size, 760 * u, 40 * u);
  return { box, gap, labelWidth: box - 96 * u, maxLines: 2, centre: (i) => [0, y(i)], arrow: (i) => [0, y(i) + step / 2], rotate: 90 };
}

function expand(el, { size, sceneDuration }) {
  const u = unit(size);
  const { steps } = el.params;
  const n = steps.length;
  const id = (part) => `${el.id}/${part}`;
  const wantRow = (el.params.direction ?? (size[0] >= size[1] ? 'row' : 'column')) === 'row';
  const isRow = wantRow && rowLayout(n, size, u).box >= MIN_ROW_BOX * u;
  // One label size for every step: the largest at which each fits its box; the boxes are as tall as the tallest label.
  const fits = (labelWidth, maxLines) => {
    const fontSize = Math.min(...steps.map((s) => fitText(s, { size: 34 * u, min: 24 * u, maxWidth: labelWidth, maxLines }).fontSize));
    return { fontSize, height: Math.max(...steps.map((s) => lineCount(s, fontSize, labelWidth))) * fontSize * LINE_HEIGHT.sans };
  };
  const numSize = Math.max(1, Math.round(28 * u));
  const numH = numSize * LINE_HEIGHT.sans;
  let layout;
  let labels;
  let boxH;
  if (isRow) {
    layout = rowLayout(n, size, u);
    labels = fits(layout.labelWidth, layout.maxLines);
    boxH = 20 * u + numH + 8 * u + labels.height + 24 * u;
  } else {
    const probe = columnLayout(n, size, u, 0);
    labels = fits(probe.labelWidth, probe.maxLines);
    boxH = Math.max(72 * u, labels.height + 36 * u);
    layout = columnLayout(n, size, u, boxH);
  }
  // Box i, then arrow i, each STAGGER after the one before.
  const at = squeeze(sceneDuration, slot(2 * n - 2)[1]);
  const span = (k) => slot(k).map(at);
  const stroke = Math.max(1, Math.round(4 * u));
  const arrowW = layout.gap - (isRow ? 24 : 16) * u; // linePart keeps it longer than its head and caps
  const parts = [];
  steps.forEach((text, i) => {
    const k = i + 1;
    const [x, y] = layout.centre(i);
    const box = rectPart(id(`box-${k}`), x, y, layout.box, boxH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(16 * u), elevated: true });
    const numAt = isRow ? [x, y - boxH / 2 + 20 * u + numH / 2] : [x - layout.box / 2 + 40 * u, y];
    const labelAt = isRow ? [x, y - boxH / 2 + 20 * u + numH + 8 * u + (boxH - 20 * u - numH - 8 * u - 24 * u) / 2] : [x + 24 * u, y];
    const num = textPart(id(`num-${k}`), String(k), ...numAt, { fontSize: numSize, maxWidth: 80 * u, fontWeight: 700, color: 'accent' });
    const label = textPart(id(`label-${k}`), text, ...labelAt, { fontSize: labels.fontSize, maxWidth: layout.labelWidth, fontWeight: 600, color: 'text' });
    for (const part of [box, num, label]) parts.push(enter(part, span(2 * i), { dy: 24 * u }));
    if (i < n - 1) {
      const [ax, ay] = layout.arrow(i);
      const arrow = linePart(id(`arrow-${k}`), ax, ay, arrowW, { stroke: 'accent', strokeWidth: stroke, cap: 'round', arrow: 'end', ...(layout.rotate ? { rotate: layout.rotate } : {}) });
      parts.push(drawIn(arrow, span(2 * i + 1)));
    }
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a short process: 2 to 6 numbered steps joined by arrows, revealed one at a time',
  params,
  describe: {
    steps: '2 to 6 step labels, each up to 24 characters, in order',
    direction: 'row or column; default row on a wide canvas, column on a tall one. A row too narrow for its boxes (under 200 px each) is laid out as a column',
  },
  example: { steps: ['Write the spec', 'Validate', 'Preview', 'Render'] },
  place: (size) => ({ x: size[0] / 2, y: size[1] / 2 }),
  expand,
});
