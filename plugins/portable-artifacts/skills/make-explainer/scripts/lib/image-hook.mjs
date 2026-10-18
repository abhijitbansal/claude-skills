// Optional hero image from the user's own image API (build.mjs --image-api). Off by default; the only
// network code in this skill. The endpoint gets the prompt and a bearer key, and must answer with a
// png, jpeg or webp. Errors name the fix and never echo the key, the response body or the endpoint's query.
import { sniffsAs } from './image.mjs';

export const KEY_ENV = 'PA_IMAGE_API_KEY';
export const PROMPT_MAX = 400;
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SIZE = { width: 1280, height: 720 };

export class ImageHookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageHookError';
  }
}

/** The https endpoint as a URL, else an ImageHookError. */
export function parseEndpoint(endpoint) {
  const fix = '--image-api needs an https URL without credentials, for example https://images.example.com/v1/generate';
  if (typeof endpoint !== 'string' || endpoint.trim() === '') throw new ImageHookError(`image endpoint is empty; ${fix}`);
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ImageHookError(`image endpoint is not a valid URL; ${fix}`);
  }
  if (url.protocol !== 'https:') throw new ImageHookError(`image endpoint must use https, got ${url.protocol.replace(':', '')}; ${fix}`);
  if (url.username !== '' || url.password !== '') throw new ImageHookError(`image endpoint must not contain credentials; pass the key in ${KEY_ENV} instead`);
  return url;
}

/** The key itself, else an ImageHookError naming the environment variable. */
export function requireKey(key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (trimmed === '') throw new ImageHookError(`${KEY_ENV} is not set or empty; export your image API key in ${KEY_ENV} and rerun`);
  return trimmed;
}

const scrub = (text, key) => (key ? String(text).split(key).join('[redacted]') : String(text));

// Read at most maxBytes; cancel the stream the moment it is exceeded so nothing unbounded is buffered.
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ImageHookError(`image response is larger than the ${maxBytes}-byte limit; ask the API for a smaller image`);
  }
  if (!response.body) throw new ImageHookError('image response had no body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ImageHookError(`image response is larger than the ${maxBytes}-byte limit; ask the API for a smaller image`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * POST the prompt to the endpoint -> { bytes: Buffer, mime }.
 * Throws ImageHookError for every failure.
 */
export async function fetchHeroImage({ prompt, endpoint, key, fetchImpl = fetch, timeoutMs = 60000, maxBytes = 8 * 1024 * 1024 }) {
  const url = parseEndpoint(endpoint);
  key = requireKey(key);
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new ImageHookError('image prompt is empty; give the spec a title');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ prompt, ...SIZE }),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new ImageHookError(`image API at ${url.host} did not answer within ${timeoutMs} ms; check the endpoint or retry`);
      if (/redirect/i.test(`${e?.cause?.message ?? ''} ${e?.message ?? ''}`)) throw new ImageHookError(`image API at ${url.host} redirected; redirects are not followed, so give the final https endpoint`);
      const why = scrub(e?.cause?.code ?? e?.name ?? 'error', key);
      throw new ImageHookError(`image API request to ${url.host} failed (${why}); check the endpoint and your network`);
    }
    if (!response.ok) throw new ImageHookError(`image API at ${url.host} answered HTTP ${response.status}; check the endpoint and ${KEY_ENV}`);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ACCEPTED.has(mime)) {
      await response.body?.cancel().catch(() => {});
      throw new ImageHookError(`image API returned content-type ${JSON.stringify(mime.slice(0, 40))}; it must return image/png, image/jpeg or image/webp`);
    }
    let bytes;
    try {
      bytes = await readCapped(response, maxBytes);
    } catch (e) {
      if (e instanceof ImageHookError) throw e;
      if (controller.signal.aborted) throw new ImageHookError(`image API at ${url.host} stalled while sending the image (limit ${timeoutMs} ms)`);
      throw new ImageHookError(`reading the image from ${url.host} failed; retry`);
    }
    if (!sniffsAs(mime, bytes)) throw new ImageHookError(`image bytes are not a valid ${mime}; the API must send the real file`);
    return { bytes, mime };
  } finally {
    clearTimeout(timer);
  }
}

/** The prompt for a spec: title and subtitle, trimmed to PROMPT_MAX characters. */
export function heroPrompt(spec) {
  const plain = (v) => (typeof v === 'string' ? v : '');
  const joined = [plain(spec.title), plain(spec.subtitle)].filter(Boolean).join('. ');
  return [...joined].slice(0, PROMPT_MAX).join('').toWellFormed();
}
