import { resolveRef } from '../paths.mjs';
import { readImage, dataUri } from '../image.mjs';
import { esc, inline } from './ui.mjs';

// The file was checked at validation time; read it again here and fail loudly
// if a spec skipped validation.
export function render(section, ctx) {
  const ref = resolveRef(ctx.dir, section.src);
  if (ref.error) throw new Error(`image.src: ${ref.error}`);
  const img = readImage(ref.abs);
  if (img.error) throw new Error(`image.src: ${img.error}`);
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  return `<figure class="img">
<img src="${dataUri(img)}" alt="${esc(section.alt)}">${caption}
</figure>`;
}
