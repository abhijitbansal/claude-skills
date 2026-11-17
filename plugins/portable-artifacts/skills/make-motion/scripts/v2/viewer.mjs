// The preview's server mode: the render page's loopback server (server.mjs, same Host check, path rules and policy) with
// three more fixed routes. /preview is the page (engine/page/viewer.html: the stage plus its controls), /preview/state is
// `{ version, errors, provenance, audio, notice }` (version rises with every new film or failed edit, which is what the
// page polls for), /preview/audio is the run's mastered sound with range support. No route builds a path from the
// request: the audio file is the one the run made. Nothing here starts a browser or opens anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startV2Server, sendRanged } from './server.mjs';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/page/viewer.html');
const JSON_TYPE = 'application/json; charset=utf-8';

function sendJson(res, value) {
  res.writeHead(200, { 'content-type': JSON_TYPE, 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('not found');
}

/**
 * @param {{ loaded: { film, timeline, specDir, prepared? }, clips?: object[], audio?: string | null, provenance?: string | null,
 *   notice?: string | null, onError?: (err: Error) => void }} opts audio: the mastered sound's path (render.mjs
 *   masterSoundFile) or null; provenance: the stamp's line (empty footer when null); notice: a line the page shows (a
 *   silent preview of a voiced film says why)
 * @returns {Promise<{ url: string, server, update(next): void, fail(errors: string[]): void, close(): Promise<void> }>}
 */
export async function startViewer({ loaded, clips = [], audio = null, provenance = null, notice = null, onError }) {
  const state = { version: 1, errors: [], provenance, audio, notice };
  const routes = {
    '/preview': (req, res) => sendRanged(req, res, PAGE, 'text/html; charset=utf-8'),
    '/preview/state': (req, res) => sendJson(res, { version: state.version, errors: state.errors, provenance: state.provenance, audio: state.audio !== null, notice: state.notice }),
    '/preview/audio': (req, res) => (state.audio === null ? notFound(res) : sendRanged(req, res, state.audio, 'audio/mp4')),
  };
  const server = await startV2Server({ ...loaded, clips, routes, onError });
  return {
    url: `${server.url}preview`,
    server: server.server,
    // a new valid film: what the page draws, its clips and its sound change together
    update: (next) => {
      server.update({ ...next.loaded, clips: next.clips ?? [] });
      Object.assign(state, { version: state.version + 1, errors: [], audio: next.audio ?? null, notice: next.notice ?? null, provenance: next.provenance ?? state.provenance });
    },
    // an edit that does not validate: the page shows these lines in place of the film, which the server keeps
    fail: (errors) => Object.assign(state, { version: state.version + 1, errors: [...errors] }),
    close: () => server.close(),
  };
}
