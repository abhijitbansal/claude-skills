// Scene runtime entry. Bundled by scripts/dev/bundle.mjs into one classic inline script.
import {
  AmbientLight, BoxGeometry, DirectionalLight, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Placeholder renderer: one lit cube from the graph's first batch (replaced in Tasks 7-8).
function mount(host, graph, opts = {}) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  const [cx, cy, cz] = graph.camera?.position ?? [4, 3, 4];
  camera.position.set(cx, cy, cz);
  const renderer = new WebGLRenderer({ antialias: true });
  host.appendChild(renderer.domElement);
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 2);
  scene.add(new AmbientLight(0xffffff, 0.6), light);
  const batch = graph.batches?.[0];
  const instance = batch?.instances?.[0] ?? [0, 0, 0, 1, 1, 1, 0];
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x88aaff }), 1);
  mesh.setMatrixAt(0, new Matrix4().makeScale(instance[3], instance[4], instance[5]).setPosition(instance[0], instance[1], instance[2]));
  scene.add(mesh);
  const controls = new OrbitControls(camera, renderer.domElement);
  let frame = 0;
  const draw = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (w && h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    controls.update();
    renderer.render(scene, camera);
    if (!opts.reducedMotion) frame = requestAnimationFrame(draw);
  };
  draw();
  return {
    destroy() {
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

window.PAScene = { mount };
