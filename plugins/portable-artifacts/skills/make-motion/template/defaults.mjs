// Browser-safe (no Node imports): shared by spec validation, timeline and renderer.
const DEFAULTS = Object.freeze({ size: [1920, 1080], fps: 30, background: '#0b0d12' });
export const FADE_SECONDS = 0.4;

// Pure copy with every optional root and element base value filled in.
export function withDefaults(spec) {
  const out = structuredClone(spec);
  out.size ??= [...DEFAULTS.size];
  out.fps ??= DEFAULTS.fps;
  out.background ??= DEFAULTS.background;
  out.audio = (out.audio ?? []).map((track) => ({ at: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...track }));
  for (const scene of out.scenes) {
    scene.transition ??= 'none';
    for (const el of scene.elements) {
      el.opacity ??= 1;
      el.scale ??= 1;
      el.rotate ??= 0;
      el.draw = 1;
      el.reveal = 1;
      el.value = el.type === 'counter' ? (el.from ?? 0) : 0;
      el.keyframes ??= [];
    }
  }
  return out;
}
