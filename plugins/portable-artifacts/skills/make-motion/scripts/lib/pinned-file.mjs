// One pinned, hash-checked download, shared by the cutout weights and the Kokoro model files. A leaf module: node built-ins only.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DOWNLOAD_SLACK = 2; // a download this many times the expected size is refused
const BYTES_PER_MB = 1e6;
const BYTES_PER_KB = 1e3;

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');
// "500 KB" under 1 MB, "26 MB" from there up: a 44-byte config file is not "0 MB".
const sizeText = (bytes) => (bytes >= BYTES_PER_MB ? `${Math.round(bytes / BYTES_PER_MB)} MB` : `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`);

// The response body, refused as soon as it passes `limit` bytes.
async function readLimited(res, limit, { url, bytes, label }) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`${label} download failed: the response from ${url} is larger than the expected ${bytes} bytes; nothing was kept`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function download({ url, bytes, label, fetchImpl }) {
  let res;
  try { res = await fetchImpl(url); } catch (e) { throw new Error(`${label} download failed: ${firstLine(e)} (${url}); check the connection and rerun`); }
  if (!res.ok) throw new Error(`${label} download failed: HTTP ${res.status} from ${url}; rerun later`);
  if (!res.body) throw new Error(`${label} download failed: the response from ${url} has no body; rerun later`);
  return readLimited(res, bytes * DOWNLOAD_SLACK, { url, bytes, label });
}

/**
 * The path `file`, downloading `url` into it first when it is absent or its bytes do not hash to `sha256`: written to a
 * partial file, checked, and only then moved into place, so a half download or a tampered one is never used.
 * `log` receives one line before a download. -> file (absolute).
 */
export async function ensurePinnedFile({ url, sha256, bytes, file, label, fetchImpl = fetch, log = () => {} }) {
  if (existsSync(file) && sha256Of(readFileSync(file)) === sha256) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  log(`downloading the ${label} (${sizeText(bytes)}, once) from ${url}`);
  const partial = `${file}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    const body = await download({ url, bytes, label, fetchImpl });
    const got = sha256Of(body);
    if (got !== sha256) throw new Error(`sha256 mismatch for the ${label} from ${url}: expected ${sha256}, got ${got}; nothing was kept`);
    writeFileSync(partial, body, { flag: 'wx' }); // exclusive: never written through a file or link someone planted at that name
    renameSync(partial, file);
    return file;
  } finally {
    rmSync(partial, { force: true }); // gone already once moved into place
  }
}
