// check.mjs's checklist probe (PA-03): tick an item, reload, see it still ticked, reset, see the saved ticks gone.
// It runs over a loopback http server, never file://: Chromium's file:// localStorage does not reliably survive a
// reload (test/helpers/browser.mjs documents the flake), so a file:// probe would fail for reasons that say nothing
// about the page. What it proves is the page's own key and reset logic: the entry the runtime writes must be named
// `pa-checklist:<data-key>`, hold the ticked item's id, come back after a reload and be emptied by Reset.
// The judging functions are pure (a stored string in, a message or null out) and tested without a browser; `probe`
// is the browser half.
import path from 'node:path';

export const KEY_PREFIX = 'pa-checklist:';
const SETTLE_MS = 2000;

const parse = (raw) => {
  try {
    const data = JSON.parse(raw);
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
};

/** After a tick: null when the entry holds the ticked id, else what is wrong. */
export function judgeTick(raw, id, key) {
  const name = `${KEY_PREFIX}${key}`;
  if (raw === null || raw === undefined) return `ticking an item saved nothing under ${JSON.stringify(name)} (the page's data-key and its script disagree, or storage is blocked)`;
  const data = parse(raw);
  if (data === null) return `the entry ${JSON.stringify(name)} is not a JSON object of ticked ids`;
  if (data[id] !== true) return `the entry ${JSON.stringify(name)} does not hold the item that was ticked`;
  return null;
}

/** After Reset: null when no tick is left in the entry (a removed entry counts), else what is wrong. */
export function judgeReset(raw, key) {
  if (raw === null || raw === undefined) return null;
  const data = parse(raw);
  if (data === null || Object.values(data).some((v) => v === true)) return `Reset left ticks in ${JSON.stringify(`${KEY_PREFIX}${key}`)}`;
  return null;
}

const entryOf = (page, key) => page.evaluate((k) => window.localStorage.getItem(k), `${KEY_PREFIX}${key}`);
const ready = (page) => page.waitForFunction(() => window.paReady === true, null, { timeout: SETTLE_MS });

/**
 * Probe every checklist on the page at `url` (served over http). `page` is a fresh page whose context holds no
 * storage yet. Pushes one message per problem onto `problems`, each starting with `label`.
 */
export async function probe(page, url, problems, label) {
  await page.goto(url);
  await ready(page);
  if (await page.locator('[data-deck]').count() > 0) return; // a deck's other slides are inert: nothing to click
  const boxes = page.locator('[data-checklist]');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const at = `${label}: checklist ${i + 1}`;
    const box = boxes.nth(i);
    const key = await box.getAttribute('data-key');
    const first = box.locator('input[data-id]').first();
    const id = await first.getAttribute('data-id');
    await first.click();
    const ticked = judgeTick(await entryOf(page, key), id, key);
    if (ticked) {
      problems.push(`${at}: ${ticked}`);
      continue;
    }
    await page.reload();
    await ready(page);
    if (!await page.locator('[data-checklist]').nth(i).locator('input[data-id]').first().isChecked()) {
      problems.push(`${at}: the ticked item was not ticked after a reload`);
      continue;
    }
    const reset = page.locator('[data-checklist]').nth(i);
    await reset.locator('[data-reset]').click();
    await reset.locator('[data-reset-yes]').click();
    const cleared = judgeReset(await entryOf(page, key), key);
    if (cleared) problems.push(`${at}: ${cleared}`);
  }
}

/** The folder to serve and the URL path of a built page: the page's own folder, so relative files load. */
export const servedPage = (file) => ({ root: path.dirname(file), name: path.basename(file) });
