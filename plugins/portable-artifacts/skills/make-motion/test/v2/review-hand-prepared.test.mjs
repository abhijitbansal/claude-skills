// The hand review runs in the render page and needs the film's prepared data (a map's outlines) to rebuild each shot as the
// stage did. It takes it from what the stage itself loaded (window.__prepared), not from a request of its own: the plugin's
// dependency-pins test allows no network call site in scripts/v2 (a page's request to its own server is still one).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { handReviewFindings } from '../../scripts/v2/review-hand.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'v2', 'review-hand.mjs');
const mapFilm = () => ({ look: 'marker', shots: [structuredClone(registries.kinds.get('map').example)] });

test('review-hand.mjs holds no request of its own (the stage already loaded the film)', () => {
  assert.doesNotMatch(fs.readFileSync(SOURCE, 'utf8'), /\bfetch\(/);
});

test('the page exposes the prepared data it built the film from, and the hand review judges a map film with it', async (t) => {
  const film = mapFilm();
  const session = await sessionOrNull(film);
  if (!session) return t.skip('no browser here');
  try {
    const { prepared } = prepareFilm(film, { filmDir: HERE });
    assert.ok(Object.keys(prepared).length > 0, 'a map shot has prepared data');
    const inPage = await session.page.evaluate(() => window.__prepared);
    assert.deepEqual(inPage, JSON.parse(JSON.stringify(prepared)));
    const findings = await handReviewFindings(session);
    assert.ok(Array.isArray(findings));
  } finally {
    await session.close();
  }
});
