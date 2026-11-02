// map-highlight: a world or US map with some countries or states lit in the accent colour, wiped in, and a caption under it.
import { MAP_NAMES } from '../map-names.mjs';
import { MAP_KINDS, PROJECTIONS, MAPS, kindOf, projectionOf, mapBox, mapSpec, landLayer, highlightLayer, chartPart } from './map-layout.mjs';
import { unit, contentWidth, fitText, squeeze, textPart, enter, blockGroup, stack, MIN_TEXT, ENTER_SECONDS, centrePlace } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['highlight'],
  properties: {
    map: { enum: [...MAP_KINDS], default: 'world' },
    highlight: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { enum: [...MAP_NAMES] } },
    label: { type: 'string', minLength: 1, maxLength: 80 },
    projection: { enum: [...PROJECTIONS] },
  },
};

const WIPE_END = 1.8; // the map has wiped in by this second (the fade takes the first ENTER_SECONDS)
const LABEL_START = 1; // the caption enters from here, while the wipe finishes

function validate(p) {
  const errors = [];
  const kind = kindOf(p);
  p.highlight.forEach((name, i) => {
    if (MAPS[kind].names.includes(name)) return;
    const other = MAPS[kind === 'world' ? 'us' : 'world'].names.includes(name);
    const fix = kind === 'world' ? 'set "map": "us" to highlight a US state' : 'set "map": "world" to highlight a country, or name a US state';
    errors.push({ path: `highlight[${i}]`, message: `${JSON.stringify(name)} is not on the ${MAPS[kind].label} map${other ? `; ${fix}` : ''}` });
  });
  if (p.projection === 'albersUsa' && kind !== 'us') {
    errors.push({ path: 'projection', message: 'albersUsa draws only the United States; use "map": "us", or projection equalEarth or mercator' });
  }
  return errors;
}

function expand(el, ctx) {
  const p = el.params;
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const projection = projectionOf(p);
  const labelFit = p.label && fitText(p.label, { size: 48 * u, min: MIN_TEXT * u, maxWidth: contentWidth(size, 1500 * u, 0, ctx.insets), maxLines: 2 });
  const box = mapBox(ctx, el.y, projection, labelFit ? labelFit.height : 0);
  const [mapY, labelY] = stack(labelFit ? [box.height, labelFit.height] : [box.height], [box.gap]);
  const at = squeeze(sceneDuration, Math.max(WIPE_END, labelFit ? LABEL_START + ENTER_SECONDS : 0));
  const chart = chartPart(`${el.id}/map`, 0, mapY, box, mapSpec(p, [landLayer(u), highlightLayer(u, p.highlight)]));
  const parts = [{
    ...chart,
    keyframes: [
      { t: at(0), opacity: 0, reveal: 0 },
      { t: at(ENTER_SECONDS), opacity: 1, ease: 'enter' },
      { t: at(WIPE_END), reveal: 1, ease: 'inOutCubic' },
    ],
  }];
  if (labelFit) {
    const label = textPart(`${el.id}/label`, p.label, 0, labelY, { fontSize: labelFit.fontSize, maxWidth: contentWidth(ctx.size, 1500 * u, 0, ctx.insets), fontWeight: 600, color: 'text' });
    parts.push(enter(label, [at(LABEL_START), at(LABEL_START + ENTER_SECONDS)], { dy: 24 * u }));
  }
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a world or US map with the named countries or states lit in the accent colour, and an optional caption under it',
  params,
  describe: {
    map: '"world" (default) or "us"',
    highlight: '1 to 20 countries (map world) or US states (map us) to light, by the atlas\'s own name: "France", "United States of America", "Dem. Rep. Congo", "California"; a name the map does not have is an error that lists them',
    label: 'a caption under the map (up to 80 characters)',
    projection: '"equalEarth" (default for world), "albersUsa" (default for us; the US only) or "mercator"',
  },
  example: { map: 'world', highlight: ['United States of America', 'Brazil', 'India', 'Germany'], label: 'Where the pilot runs' },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  paramOf: (part) => (part === 'label' ? 'label' : null),
  validate,
  expand,
});
