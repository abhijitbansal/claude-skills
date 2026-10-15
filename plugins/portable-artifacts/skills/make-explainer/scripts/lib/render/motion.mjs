// motion section: a <video> with controls, never autoplaying, whose file sits next to the page in
// <slug>.assets/. The video is either a user's MP4 (copied) or rendered by make-motion from a
// motion.json (held in memory until the build writes it). The poster is the user's picture or, for a
// rendered video, a frame of it, and is inlined as a data: URI: the page's CSP lets a page load
// images from data: only, and a small picture is not worth widening it. prepare() settles the files;
// render() reads the result. The css ships once (page()).
import fs from 'node:fs';
import path from 'node:path';
import { SectionErrors } from '../section-errors.mjs';
import { readVideo, readPoster, readMotionSpec } from '../motion-source.mjs';
import { dataUri } from '../image.mjs';
import { renderMotion } from '../motion-render.mjs';
import { esc, inline, plain } from './ui.mjs';

const CSS = new URL('../../../template/motion.css', import.meta.url);

// Per-page state: the files each motion section ships, by section.
const state = (ctx) => (ctx.motion ??= new Map());

const valid = (field, result) => {
  if (result.error) throw new SectionErrors([{ path: field, message: result.error }]);
  return result;
};

export async function prepare(section, ctx, i) {
  const name = ctx.idFor(section, i);
  const file = `${name}.mp4`;
  let rendered;
  let source;
  if (section.video !== undefined) {
    source = { from: valid('video', readVideo(section.video, ctx.dir)).abs };
  } else {
    const motion = valid('spec', readMotionSpec(section.spec, ctx.dir));
    rendered = await renderMotion(motion.abs, motion.spec, ctx.env, { pageTheme: ctx.theme.name });
    source = { content: rendered.video };
  }
  let poster;
  if (section.poster !== undefined) poster = valid('poster', readPoster(section.poster, ctx.dir)).uri;
  else if (rendered?.poster !== undefined) poster = dataUri({ mime: 'image/png', bytes: rendered.poster });
  state(ctx).set(section, { file, poster, source });
}

/** The motion stylesheet; the page includes it once. */
export function page() {
  return { css: fs.readFileSync(CSS, 'utf8').replace(/\n$/, ''), js: [] };
}

/** The video goes to <slug>.assets/. */
export async function assets(section, ctx) {
  const entry = state(ctx).get(section);
  if (!entry) return [];
  return [{ ...entry.source, to: path.join(ctx.assetsDir, entry.file) }];
}

export function render(section, ctx) {
  const entry = state(ctx).get(section);
  if (!entry) throw new Error('motion was not prepared; build the page with buildPage');
  const url = (file) => `${esc(encodeURIComponent(ctx.slug))}.assets/${esc(file)}`;
  // A titled video is named by its title and a captioned one by its caption; otherwise just "Video".
  const name = section.title !== undefined ? plain(section.title) : section.caption !== undefined ? plain(section.caption) : 'Video';
  const poster = entry.poster === undefined ? '' : ` poster="${entry.poster}"`;
  // Print has no player: the poster stands in for the video there (see motion.css).
  const still = entry.poster === undefined ? '' : `\n<img class="mo-still" src="${entry.poster}" alt="">`;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  return `<figure class="mo">
<video controls preload="metadata" playsinline${poster} src="${url(entry.file)}" aria-label="${name}">
<p>Your browser cannot play this video. <a href="${url(entry.file)}">Download the video</a>.</p>
</video>${still}${caption}
</figure>`;
}
