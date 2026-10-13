// What a motion section points at: an MP4 and an optional poster picture, or a
// motion.json for make-motion to render. All are files in the spec folder (the
// same path rules as every other file reference). Shared by the validation
// check and the renderer.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRef } from './paths.mjs';
import { readImage, dataUri } from './image.mjs';
import { repath } from './diagram-source.mjs';

export const VIDEO_EXTS = ['.mp4'];
export const POSTER_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
export const SPEC_EXTS = ['.json'];
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const MOTION_SPEC_MAX_BYTES = 1024 * 1024;

const MB = 1024 * 1024;
const FTYP_AT = 4;
const SNIFF_BYTES = 12;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// An ISO base media file starts with a box size, then "ftyp".
function looksLikeMp4(abs) {
  const fd = fs.openSync(abs, 'r');
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, head, 0, SNIFF_BYTES, 0);
    return read >= FTYP_AT + 4 && head.toString('latin1', FTYP_AT, FTYP_AT + 4) === 'ftyp';
  } finally {
    fs.closeSync(fd);
  }
}

/** video: -> { abs } for a usable MP4 in the spec folder, else { error } naming the fix. */
export function readVideo(ref, dir) {
  const r = resolveRef(dir, ref, { exts: VIDEO_EXTS });
  if (r.error) return { error: r.error };
  const size = fs.statSync(r.abs).size;
  if (size > VIDEO_MAX_BYTES) {
    return { error: `video is ${(size / MB).toFixed(1)} MB; the limit is ${VIDEO_MAX_BYTES / MB} MB — shorten or compress it` };
  }
  if (!looksLikeMp4(r.abs)) return { error: 'file content is not an MP4 video; check the extension' };
  return { abs: r.abs };
}

/** poster: -> { uri } (the picture as a data: URI) for a usable picture in the spec folder, else { error }. */
export function readPoster(ref, dir) {
  const r = resolveRef(dir, ref, { exts: POSTER_EXTS });
  if (r.error) return { error: r.error };
  const img = readImage(r.abs);
  if (img.error) return { error: img.error };
  return { uri: dataUri(img) };
}

/** spec: -> { abs, dir, spec, file } for a motion.json holding one JSON object, else { error }. `dir` is the folder the motion spec's own files resolve against. */
export function readMotionSpec(ref, dir) {
  const r = resolveRef(dir, ref, { exts: SPEC_EXTS });
  if (r.error) return { error: r.error };
  const size = fs.statSync(r.abs).size;
  if (size > MOTION_SPEC_MAX_BYTES) {
    return { error: `${JSON.stringify(ref)} is ${Math.ceil(size / 1024)} KB; the limit is ${MOTION_SPEC_MAX_BYTES / 1024} KB — split the video` };
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(r.abs, 'utf8'));
  } catch (e) {
    return { error: `${JSON.stringify(ref)} is not valid JSON: ${e.message}` };
  }
  if (!isObject(spec)) return { error: `${JSON.stringify(ref)} must hold one JSON object (a make-motion spec)` };
  return { abs: r.abs, dir: path.dirname(r.abs), spec, file: ref };
}

/** make-motion errors as errors under `base`, each naming the file. */
export const reportMotionErrors = (errors, base, file) => errors.map((e) => ({ path: repath(base, e.path), message: `${e.message} (in ${file})` }));
