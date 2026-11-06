// Browser-safe (no imports): the hand-drawn style's names, ranges and palette. A scene is hand-drawn when its own `style`
// says so, else when the root `style` does; the page loads the rest of template/sketch/ only when a spec has such a scene.

export const STYLES = Object.freeze(['standard', 'sketch']);
const SKETCH = 'sketch';

// Board, ink and accent of a sketch scene: scoped to it, so a mixed film keeps its theme for the standard scenes.
export const PALETTE = Object.freeze({ board: '#fdfcf8', ink: '#1d2330', accent: '#e8590c' });

// A shape's `fill` that hatches it with the accent colour instead of naming a colour; only a rect or an ellipse in a sketch scene.
export const SCRIBBLE_FILL = 'scribble';

export const HAND_TONES = Object.freeze(['light', 'medium', 'tan', 'brown', 'dark']);
export const HAND_SCALE_RANGE = Object.freeze([0.5, 1.2]);
export const PACE_RANGE = Object.freeze([0.5, 2]);

/** True when `scene` of `spec` is drawn by hand: the scene's `style`, else the root's, else standard. */
export const isSketchScene = (spec, scene) => (scene?.style ?? spec?.style) === SKETCH;

/** True when any scene of `spec` is drawn by hand. */
export const specHasSketch = (spec) => Array.isArray(spec?.scenes) && spec.scenes.some((scene) => isSketchScene(spec, scene));
