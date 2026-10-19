// Scene graph v1 -> three.js objects. Reads the graph exactly as references/scene-graph.md
// ("Conventions the worlds follow") pins it down; draws nothing the graph does not list.
import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog, Group, HemisphereLight, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, PointsMaterial, Quaternion,
  RingGeometry, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { resolveColour } from './colour.js';
import { createTravel } from './travel.js';

const UPSAMPLE = 5; // terrain: data cells sit every 5th vertex (Task 5 convention)
const STAR_COUNT = 700;
const SPACE_BASE = '#04050c';
const SPACE_PAGE_SHARE = 0.06; // a whisper of the theme so space is not a flat void
const STAR_COLOUR = '#f4f1ff';
const MOON_COLOUR = '#8fa6e8';
const WATER_BASE = { base: '#2f6fb0', tint: 'cat5', share: 0.3 };
const SUN_COLOUR = { base: '#fff4e0', tint: 'page', share: 0.12 };
const EMISSIVE_STRENGTH = 1.6;
const SELF_LIT_STRENGTH = 0.9;
const SWAY_AMPLITUDE = 0.06; // fraction of a leaf cluster's width
const WINDOW_CELL = 0.36; // world units per window cell, before fitting to the wall
const NO_ROTATION = new Quaternion();
const SKY_SPACE = 'space';
const PICK_TUBE_FACTOR = 4; // hover radius of a thin link, in link radii...
const PICK_TUBE_MARGIN_CAP = 0.25; // ...but never more than this far (world units) beyond the drawn tube: a 0.55 donut segment must not swallow its hole
const PICK_TUBE_MIN_SHARE = 0.004; // ...and at least this share of the scene's diagonal
const PICK_MATERIAL = new MeshBasicMaterial(); // never drawn (the pick meshes are invisible); raycasting needs a material
const LIGHT_MIN_RADIUS = 0.16; // the travelling light: a sphere this big (or a share of the scene's diagonal)...
const LIGHT_DIAG_SHARE = 0.005;
const LIGHT_HALO = 2.4; // ...inside a soft halo this many times wider
const LIGHT_HALO_OPACITY = 0.3;
const FOG_NEAR_FACTOR = 1.4; // fog starts and ends this many fitted camera distances away
const FOG_FAR_FACTOR = 4.5;
const GROUND_REACH = 1.5; // the ground disc reaches this far past the scene's half-diagonal (plus GROUND_EXTRA)...
const GROUND_EXTRA = 2;
const GROUND_FADE_START = 0.5; // ...and is fully solid out to this share of its radius, fading to nothing at the rim
const WATER_REACH = 1.7; // the sea reaches this many half-diagonals of the surface
const WATER_FADE_START = 0.78; // past the surface's own corners (0.59 of the radius), so the seabed never shows through
const RING_OPACITY = 0.32; // orbit rings are drawn faint
const RING_INNER = 0.4965; // of a unit ring (diameter 1): a hairline, so it grows with the orbit
const ARROW_LENGTH = 7; // arrowhead, in tube radii
const ARROW_WIDTH = 4.5;
const ARROW_SEGMENTS = 14;

// FNV-1a + mulberry32, copied from shared/art.mjs (the runtime cannot import Node shared files).
function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = {
  box: () => new BoxGeometry(1, 1, 1),
  cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 24),
  disc: () => new CylinderGeometry(0.5, 0.5, 1, 40),
  sphere: () => new SphereGeometry(0.5, 20, 14),
  icosa: () => new IcosahedronGeometry(0.5, 1),
  cone: () => new ConeGeometry(0.5, 1, 20),
  ring: () => new RingGeometry(RING_INNER, 0.5, 96).rotateX(-Math.PI / 2), // flat in xz: scale [2r, ., 2r]
};
const Y_AXIS = new Vector3(0, 1, 0);

// A cone whose tip sits on `tip` and which points away from `from` (the route's neighbouring point), sharing the tube's material.
function addArrowhead(root, track, material, tip, from, radius) {
  const dir = new Vector3(tip[0] - from[0], tip[1] - from[1], tip[2] - from[2]);
  if (dir.lengthSq() === 0) return;
  dir.normalize();
  const length = radius * ARROW_LENGTH;
  const cone = new Mesh(track(new ConeGeometry(0.5, 1, ARROW_SEGMENTS)), material);
  cone.scale.set(radius * ARROW_WIDTH, length, radius * ARROW_WIDTH);
  cone.quaternion.setFromUnitVectors(Y_AXIS, dir);
  cone.position.set(tip[0], tip[1], tip[2]).addScaledVector(dir, -length / 2);
  root.add(cone);
}

// A flat disc that dissolves at its rim: alpha falls from 1 to 0 between `start` (a share of `radius`) and the rim.
// The disc is never rotated, so its local xz is its distance from the centre.
function patchEdgeFade(material, radius, start) {
  material.transparent = true;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeRadius = { value: radius };
    shader.uniforms.uFadeStart = { value: start };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFadeRadius;\nuniform float uFadeStart;\nvarying vec2 vFadeXZ;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(uFadeStart, 1.0, length(vFadeXZ) / uFadeRadius);');
  };
}

// Lit windows: a procedural mask on the walls of a unit box, sized in world units from the
// instance scale and hashed from the cell and the instance position (deterministic, no texture).
function patchWindows(material, density) {
  material.userData.windowDensity = { value: density };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowDensity = material.userData.windowDensity;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinQ;\nvarying vec3 vWinN;\nvarying vec3 vWinS;\nvarying float vWinSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 winScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vWinS = winScale;
        vWinQ = position * winScale;
        vWinN = normal;
        vWinSeed = dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWindowDensity;
        varying vec3 vWinQ;
        varying vec3 vWinN;
        varying vec3 vWinS;
        varying float vWinSeed;
        float winHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 an = abs(vWinN);
          float onWall = step(an.y, 0.5);
          bool alongZ = an.x > an.z;
          float across = alongZ ? vWinS.z : vWinS.x;
          float along = alongZ ? vWinQ.z : vWinQ.x;
          float cols = max(1.0, floor(across / ${WINDOW_CELL.toFixed(2)}));
          float rows = max(1.0, floor(vWinS.y / ${WINDOW_CELL.toFixed(2)}));
          vec2 st = vec2((along / across + 0.5) * cols, (vWinQ.y / vWinS.y + 0.5) * rows);
          vec2 cell = floor(st);
          vec2 f = fract(st);
          float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          float lit = step(winHash(cell + vWinSeed + dot(sign(vWinN), vec3(7.0, 3.0, 11.0))), uWindowDensity);
          totalEmissiveRadiance *= onWall * pane * lit;
        }`);
  };
}

function lightingFor(env, isDark) {
  if (env.sky === SKY_SPACE) return { sun: 2.4, hemi: 0.75, moon: false };
  if (isDark && env.nightLights) return { sun: 0.5, hemi: 0.6, moon: true };
  if (isDark) return { sun: 1.4, hemi: 0.8, moon: false };
  return { sun: 2.6, hemi: 1.3, moon: false };
}

function boundsInfo(bounds) {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const size = new Vector3(x1 - x0, y1 - y0, z1 - z0);
  return { size, center: new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), diag: Math.max(size.length(), 1) };
}

/** Cell index into surfaces[].cells for a world-space point on that surface, or -1. */
export function surfaceCellAt(surface, point) {
  const [sx, sz] = surface.size;
  const { nx, nz } = surface;
  const cols = nx === 2 ? 1 : (nx - 1) / UPSAMPLE + 1;
  const rows = nz === 2 ? 1 : (nz - 1) / UPSAMPLE + 1;
  const ix = Math.round((point.x / sx + 0.5) * (nx - 1));
  const iz = Math.round((point.z / sz + 0.5) * (nz - 1));
  const ti = Math.min(cols - 1, Math.max(0, Math.round(ix / UPSAMPLE)));
  const gi = Math.min(rows - 1, Math.max(0, Math.round(iz / UPSAMPLE)));
  const cell = gi * cols + ti;
  return Number.isInteger(surface.cells[cell]) ? surface.cells[cell] : -1;
}

/**
 * buildObjects(graph, palette) -> { root, background, fog, pickables, retint, animate, animated, itemAt, tubeAt, extent, setFit, dispose }
 * palette = { dark: boolean, readVar(cssVar) -> colour string } (see theme.js).
 * `background` and `fog` are mutated in place by retint, so the caller assigns them to its Scene once.
 */
export function buildObjects(graph, palette) {
  const env = graph.env ?? {};
  const root = new Group();
  const pickables = [];
  const tints = []; // (palette) => void; every retintable thing registers one
  const disposables = [];
  const animators = [];
  const tubeCurves = new Map(); // tube id -> the curve the tube is drawn along (the travelling light rides it)
  const shapeGeometries = new Map();
  const batchMeshes = new Map(); // batch id -> { batch, mesh }
  const extent = boundsInfo(graph.bounds);
  let current = palette;

  const colourOf = (ref) => new Color(resolveColour(ref, (name) => current.readVar(name)));
  const track = (...things) => {
    disposables.push(...things);
    return things[0];
  };
  const geometryFor = (shape) => {
    if (!shapeGeometries.has(shape)) shapeGeometries.set(shape, track(SHAPES[shape]()));
    return shapeGeometries.get(shape);
  };
  const sceneBackground = new Color();
  const fog = env.fog && env.sky !== SKY_SPACE ? new Fog(0xffffff, 1, 2) : null;
  function setFit(distance) {
    if (!fog) return;
    fog.near = distance * FOG_NEAR_FACTOR;
    fog.far = distance * FOG_FAR_FACTOR;
  }
  // Until the caller reports the camera it really fits, follow the camera the graph asks for.
  setFit(Math.max(1, Math.hypot(...graph.camera.position.map((c, i) => c - graph.camera.target[i]))));

  // Lights
  const hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.copy(extent.center).add(new Vector3(0.55, 1, 0.4).multiplyScalar(extent.diag));
  sun.target.position.copy(extent.center);
  root.add(hemi, sun, sun.target, new AmbientLight(0xffffff, 0.12));
  tints.push((p) => {
    const light = lightingFor(env, p.dark);
    const page = colourOf('page');
    const surface = colourOf('surface');
    sceneBackground.copy(env.sky === SKY_SPACE ? colourOf({ base: SPACE_BASE, tint: 'page', share: SPACE_PAGE_SHARE }) : page);
    hemi.color.copy(page).lerp(new Color(0xffffff), env.sky === SKY_SPACE ? 0.7 : 0.55);
    hemi.groundColor.copy(surface).multiplyScalar(0.55);
    hemi.intensity = light.hemi;
    sun.color.copy(light.moon ? new Color(MOON_COLOUR) : colourOf(SUN_COLOUR));
    sun.intensity = light.sun;
    if (fog) fog.color.copy(sceneBackground);
  });

  // Ground: a disc well past the scene, solid under it and dissolving into the page at its rim, so no edge is ever framed.
  if (env.ground) {
    const radius = (Math.hypot(extent.size.x, extent.size.z) / 2) * GROUND_REACH + GROUND_EXTRA;
    const material = track(new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    patchEdgeFade(material, radius, GROUND_FADE_START);
    const ground = new Mesh(track(new CircleGeometry(radius, 72).rotateX(-Math.PI / 2)), material);
    ground.position.set(extent.center.x, Math.min(0, graph.bounds.min[1]) - 0.01, extent.center.z);
    ground.renderOrder = -1;
    root.add(ground);
    tints.push(() => ground.material.color.copy(colourOf(env.ground)));
  }

  // Instanced batches
  for (const batch of graph.batches ?? []) {
    const count = batch.instances.length;
    if (count === 0) continue;
    const isRing = batch.shape === 'ring';
    const material = track(isRing
      ? new MeshBasicMaterial({ transparent: true, opacity: RING_OPACITY, side: DoubleSide, depthWrite: false, fog: false })
      : new MeshStandardMaterial({ roughness: 0.82, metalness: 0.04, flatShading: Boolean(batch.flat) }));
    const windows = Boolean(batch.emissive) && Boolean(env.nightLights) && batch.shape === 'box';
    if (windows) patchWindows(material, batch.emissive.density);
    const mesh = new InstancedMesh(geometryFor(batch.shape), material, count);
    mesh.frustumCulled = false; // animated and cheap: one batch is one draw call
    const matrix = new Matrix4();
    const items = new Int32Array(count);
    batch.instances.forEach((inst, k) => {
      matrix.compose(new Vector3(inst[0], inst[1], inst[2]), NO_ROTATION, new Vector3(inst[3], inst[4], inst[5]));
      mesh.setMatrixAt(k, matrix);
      items[k] = inst[6];
    });
    mesh.userData = { kind: 'batch', items };
    batchMeshes.set(batch.id, { batch, mesh });
    root.add(mesh);
    if (!isRing) pickables.push(mesh); // a hairline ring is scenery: it neither hides nor shows data
    tints.push((p) => {
      material.color.copy(colourOf(batch.colour));
      if (!batch.emissive || isRing) return;
      material.emissive.copy(colourOf(batch.emissive.colour));
      const on = env.nightLights ? p.dark : true;
      const strength = windows ? EMISSIVE_STRENGTH : SELF_LIT_STRENGTH * batch.emissive.density;
      material.emissiveIntensity = on ? strength : 0;
    });
  }

  // Motion. Reduced motion simply never calls animate(), so everything stays at its time-0 pose.
  const pos = new Vector3();
  const scale = new Vector3();
  const m4 = new Matrix4();
  const writeInstance = (mesh, k, x, y, z, inst) => {
    pos.set(x, y, z);
    scale.set(inst[3], inst[4], inst[5]);
    m4.compose(pos, NO_ROTATION, scale);
    mesh.setMatrixAt(k, m4);
  };
  for (const id of graph.anim?.sway ?? []) {
    const entry = batchMeshes.get(id);
    if (!entry) continue;
    const { batch, mesh } = entry;
    animators.push((t) => {
      batch.instances.forEach((inst, k) => {
        const amp = inst[3] * SWAY_AMPLITUDE;
        writeInstance(mesh, k, inst[0] + Math.sin(t * 1.1 + k * 0.9) * amp, inst[1], inst[2] + Math.cos(t * 0.8 + k * 1.3) * amp, inst);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null;
    });
  }
  for (const orbit of graph.anim?.orbits ?? []) {
    const entry = batchMeshes.get(orbit.batch);
    if (!entry) continue;
    const { batch, mesh } = entry;
    const [cx, , cz] = orbit.center;
    animators.push((t) => {
      batch.instances.forEach((inst, k) => {
        const phi = orbit.phase[k] + orbit.speed[k] * t;
        writeInstance(mesh, k, cx + orbit.r[k] * Math.cos(phi), inst[1], cz + orbit.r[k] * Math.sin(phi), inst);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null;
    });
  }

  // Tubes (galaxy links). A tube is hoverable when it carries an item or its own label/display (the tooltip
  // shows them); a hidden, fatter twin takes the hits, since a 0.06 radius is a few pixels wide on screen.
  (graph.tubes ?? []).forEach((tube, ti) => {
    const curve = new CatmullRomCurve3(tube.points.map((p) => new Vector3(p[0], p[1], p[2])));
    tubeCurves.set(tube.id, curve);
    const segments = Math.max(12, tube.points.length * 12);
    const geometry = new TubeGeometry(curve, segments, tube.radius, 8, false);
    const material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    const mesh = new Mesh(track(geometry, material), material);
    root.add(mesh);
    tints.push(() => material.color.copy(colourOf(tube.colour)));
    if (tube.arrow === 'end' || tube.arrow === 'both') {
      const last = tube.points.length - 1;
      addArrowhead(root, track, material, tube.points[last], tube.points[last - 1], tube.radius);
      if (tube.arrow === 'both') addArrowhead(root, track, material, tube.points[0], tube.points[1], tube.radius);
    }
    const item = Number.isInteger(tube.item) ? tube.item : -1;
    if (item < 0 && tube.label === undefined && tube.display === undefined) return;
    const margin = Math.min(tube.radius * (PICK_TUBE_FACTOR - 1), PICK_TUBE_MARGIN_CAP);
    const reach = Math.max(tube.radius + margin, extent.diag * PICK_TUBE_MIN_SHARE);
    const pick = new Mesh(track(new TubeGeometry(curve, segments, reach, 4, false)), PICK_MATERIAL);
    pick.visible = false;
    pick.userData = { kind: 'tube', item, tube: ti };
    root.add(pick);
    pickables.push(pick);
  });

  // The travelling light: a glowing sphere that rides one tube per tour beat (graph.tour[].path is a tube id).
  const travel = createTravel();
  const light = new Group();
  light.visible = false;
  const lightRadius = Math.max(LIGHT_MIN_RADIUS, extent.diag * LIGHT_DIAG_SHARE);
  const lightMesh = (radius, opacity) => {
    const material = new MeshBasicMaterial({ transparent: opacity < 1, opacity, depthWrite: opacity === 1, toneMapped: false });
    return new Mesh(track(new SphereGeometry(radius, 20, 14), material), material);
  };
  const lightParts = [lightMesh(lightRadius * LIGHT_HALO, LIGHT_HALO_OPACITY), lightMesh(lightRadius, 1)];
  light.add(...lightParts);
  root.add(light);
  tints.push(() => {
    for (const part of lightParts) part.material.color.copy(colourOf('glow'));
  });
  const placeLight = (frame) => {
    const curve = frame === null ? undefined : tubeCurves.get(frame.id);
    light.visible = curve !== undefined;
    if (curve) light.position.copy(curve.getPointAt(frame.at));
  };

  // Surfaces (terrain) and water
  for (const surface of graph.surfaces ?? []) {
    const { nx, nz, size, heights, bands } = surface;
    const [sx, sz, sy] = size;
    const positions = new Float32Array(nx * nz * 3);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const v = (iz * nx + ix) * 3;
        positions[v] = (ix / (nx - 1) - 0.5) * sx;
        positions[v + 1] = heights[iz * nx + ix] * sy;
        positions[v + 2] = (iz / (nz - 1) - 0.5) * sz;
      }
    }
    const index = [];
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const c = a + nx;
        index.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(nx * nz * 3), 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const mesh = new Mesh(track(geometry, material), material);
    mesh.userData = { kind: 'surface', surface };
    root.add(mesh);
    pickables.push(mesh);
    tints.push(() => {
      const colours = geometry.getAttribute('color');
      const resolved = bands.map((b) => ({ below: b.below, colour: colourOf(b.colour) }));
      const scratch = new Color();
      for (let i = 0; i < nx * nz; i++) {
        const band = resolved.find((b) => heights[i] < b.below) ?? resolved[resolved.length - 1];
        scratch.copy(band.colour);
        colours.setXYZ(i, scratch.r, scratch.g, scratch.b);
      }
      colours.needsUpdate = true;
    });
  }
  const lead = graph.surfaces?.[0];
  if (env.water && lead) {
    const radius = (Math.hypot(lead.size[0], lead.size[1]) / 2) * WATER_REACH;
    // Solid over the seabed (so the terrain's flat margin never shows through), dissolving at its rim.
    const material = track(new MeshStandardMaterial({ roughness: 0.2, metalness: 0.1 }));
    patchEdgeFade(material, radius, WATER_FADE_START);
    const water = new Mesh(track(new CircleGeometry(radius, 96).rotateX(-Math.PI / 2)), material);
    water.position.y = env.water.y * lead.size[2];
    water.renderOrder = -1;
    root.add(water);
    tints.push(() => water.material.color.copy(colourOf(WATER_BASE)));
  }

  // Stars: a seeded shell, so one graph always gives the same sky
  if (env.stars) {
    const random = mulberry32(seedFrom(`${graph.title ?? ''}|stars`));
    const shell = Math.max(90, extent.diag * 6);
    const coords = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = random() * 2 - 1;
      const phi = random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = shell * (0.9 + random() * 0.1);
      coords.set([radius * r * Math.cos(phi), radius * u, radius * r * Math.sin(phi)], i * 3);
    }
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(coords, 3));
    const material = new PointsMaterial({ color: STAR_COLOUR, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false });
    root.add(new Points(track(geometry, material), material));
  }
  extent.far = Math.max(1000, Math.max(90, extent.diag * 6) * 1.6);

  const retint = (next) => {
    current = next;
    for (const apply of tints) apply(next);
  };
  retint(palette);

  return {
    root,
    background: sceneBackground,
    fog,
    pickables,
    retint,
    get animated() {
      return animators.length > 0 || travel.active;
    },
    animate(t) {
      for (const step of animators) step(t);
      if (travel.active) placeLight(travel.tick(t));
    },
    /** Send the light along tube `id` (forwards, or against its direction when `reverse`); `instant` puts it at its destination. null or an unknown id hides it. */
    travel(id, { reverse = false, instant = false } = {}) {
      placeLight(travel.start(tubeCurves.has(id) ? id : null, { reverse, instant }));
    },
    /** Put a running light at its destination now (reduced motion switched on). */
    settle() {
      placeLight(travel.finish());
    },
    /** { id, at, done, position } while the light is shown, else null. */
    traveller() {
      const frame = travel.frame();
      return frame !== null && light.visible ? { ...frame, position: light.position.toArray() } : null;
    },
    /** graph.tubes index for a raycast hit on a link, else -1. */
    tubeAt(hit) {
      const data = hit.object.userData;
      return data.kind === 'tube' ? data.tube : -1;
    },
    /** Item index for a raycast hit, or -1 (decoration, or a cell with no row). */
    itemAt(hit) {
      const data = hit.object.userData;
      if (data.kind === 'batch') return data.items[hit.instanceId] ?? -1;
      if (data.kind === 'tube') return data.item;
      if (data.kind === 'surface') return surfaceCellAt(data.surface, hit.point);
      return -1;
    },
    extent,
    /** The fitted camera distance: fog starts and ends relative to it. */
    setFit,
    dispose() {
      for (const thing of disposables) thing.dispose();
      for (const mesh of pickables) if (mesh.isInstancedMesh) mesh.dispose();
    },
  };
}
