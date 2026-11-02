// Browser-safe (no Node imports): two helpers for blocks that layout.mjs does not cover: a part that leaves again
// (the ticker, a chat's typing dots) and a stack taller than the band it sits in (chat-thread, timeline).
import { freeBand } from './layout.mjs';

/** `part` (already given its entrance keyframes) held until `from`, then faded to nothing by `to` (scene seconds, squeezed). */
export const fadeOut = (part, [from, to]) => ({ ...part, keyframes: [...(part.keyframes ?? []), { t: from, opacity: 1 }, { t: to, opacity: 0, ease: 'exit' }] });

/**
 * How far (canvas px, 0 or negative) a stack `height` tall, centred on canvas `y`, moves up so its bottom stays inside
 * the band the block may fill: a stack that fits is not moved; one that does not grows upward from the band's floor, so
 * what overflows is the top, which check.mjs reports, and never the captions below.
 */
export const bottomShift = (ctx, y, height) => Math.min(0, freeBand(ctx).bottom - y - height / 2);
