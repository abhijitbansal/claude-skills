// One minimum size for a look's secondary text (look.secondary.min, units: labels, units, source, attribution, ask), so
// it reads on a phone tile; the hero keeps MIN_HERO_RATIO over it (with a margin, so rounding never takes it under).
// A kind whose frame cannot hold its hero at that ratio drops its least important secondary line and records it on its
// hero node (props.dropped: the review's 'dropped' rule says so). Pure; a look without the field keeps its own sizes.
import { MIN_HERO_RATIO } from '../review/frame.mjs';

/** A hero kept this much over MIN_HERO_RATIO, so the page's measured sizes never round it under. */
export const HERO_MARGIN = 1.03;

/** The secondary floor in px (0 when the look sets none). */
export const secondaryFloor = (look, unit) => (look.secondary?.min ?? 0) * unit;

/** A secondary size raised to the floor. */
export const secondarySize = (look, unit, size) => Math.max(size, secondaryFloor(look, unit));

/** What a source line is set after, as written (chart-desk.mjs; map-draw.mjs where a look asks, look data sourcePrefix). */
export const SOURCE_PREFIX = 'Source: ';

/** The smallest hero that keeps the hero ratio over secondary text at the floor (0 without a floor). */
export const heroFloor = (look, unit) => HERO_MARGIN * MIN_HERO_RATIO * secondaryFloor(look, unit);
