// Camera for the v2 engine: camera({ tracks, canvas }) gives (t) => { x, y, zoom, rotate }, and
// applyCamera(sampled, cam, canvas) moves the top-level nodes of a sampled graph with depth parallax.
// A node at depth d has k = 1 + d: it pans by -pan / k and zooms by 1 + (zoom - 1) / k about the canvas
// centre. Camera rotate (degrees) turns top-level positions about the centre and adds to their rotate.
// Children follow their parent; nodes with props.fixed are untouched. Pure and DOM-free.
import { sample } from '../time/track.mjs';

const CAMERA_TRACK_NAMES = Object.freeze(['x', 'y', 'zoom', 'rotate']);
const CAMERA_DEFAULTS = Object.freeze({ x: 0, y: 0, zoom: 1, rotate: 0 });
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function checkCanvas(canvas) {
  if (!canvas || !isFiniteNumber(canvas.w) || !isFiniteNumber(canvas.h) || canvas.w <= 0 || canvas.h <= 0) {
    throw new Error('canvas must be { w, h } with finite w and h > 0');
  }
}

function checkCam(cam) {
  for (const name of CAMERA_TRACK_NAMES) {
    if (!isFiniteNumber(cam?.[name])) throw new Error(`camera ${name} must be a finite number, got ${cam?.[name]}`);
  }
  if (cam.zoom <= 0) throw new Error(`camera zoom must be > 0, got ${cam.zoom}`);
}

export function camera({ tracks = {}, canvas } = {}) {
  if (canvas !== undefined) checkCanvas(canvas);
  for (const [name, tr] of Object.entries(tracks)) {
    if (!CAMERA_TRACK_NAMES.includes(name)) throw new Error(`unknown camera track '${name}'; accepted: ${CAMERA_TRACK_NAMES.join(', ')}`);
    if (tr?.kind !== 'number') throw new Error(`camera track '${name}' must be a number track (see track())`);
  }
  return (t) => Object.fromEntries(CAMERA_TRACK_NAMES.map((name) => [name, tracks[name] ? sample(tracks[name], t) : CAMERA_DEFAULTS[name]]));
}

const clean = (n) => n + 0; // turns -0 into 0

function moveNode(n, cam, centre) {
  const k = 1 + n.depth;
  const zoom = 1 + (cam.zoom - 1) / k;
  const angle = cam.rotate * DEGREES_TO_RADIANS;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = (n.x - centre.x) * zoom, dy = (n.y - centre.y) * zoom;
  return Object.freeze({
    ...n,
    x: clean(centre.x + dx * cos - dy * sin - cam.x / k),
    y: clean(centre.y + dx * sin + dy * cos - cam.y / k),
    scale: n.scale * zoom,
    rotate: n.rotate + cam.rotate,
  });
}

export function applyCamera(sampled, cam, canvas) {
  checkCam(cam);
  checkCanvas(canvas);
  const centre = { x: canvas.w / HALF, y: canvas.h / HALF };
  return Object.freeze(sampled.map((n) => (n.props.fixed === true ? n : moveNode(n, cam, centre))));
}
