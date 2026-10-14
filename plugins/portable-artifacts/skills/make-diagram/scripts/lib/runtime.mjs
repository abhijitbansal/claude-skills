// The viewer runtime: the template/ modules inlined in one fixed order. Each
// module registers a factory on window.PADiagram; viewer.js, last, composes
// them into PADiagram.mount. Shared by the page builder (viewer.mjs) and the
// embedding API (api.mjs viewerRuntime), so embedders get the same bundle.
import fs from 'node:fs';

export const RUNTIME_FILES = ['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'fullscreen.js', 'viewer.js'];
const TEMPLATE = new URL('../../template/', import.meta.url);

/** The concatenated runtime source. */
export function runtimeSource() {
  return RUNTIME_FILES.map((f) => fs.readFileSync(new URL(f, TEMPLATE), 'utf8')).join('\n');
}
