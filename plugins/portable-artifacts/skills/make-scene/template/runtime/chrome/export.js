// PNG of the current frame. The renderer keeps no drawing buffer, so the frame is drawn and read back in
// the same tick: renderNow() synchronously, then toBlob() before returning to the event loop.

const REVOKE_MS = 10000;
const STEM_MAX = 60;

/** Title -> a file stem: lowercase [a-z0-9-], at most 60 characters, "scene" when nothing is left. */
export function fileStem(title) {
  const stem = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, STEM_MAX).replace(/-+$/, '');
  return stem || 'scene';
}

/**
 * savePng({ api, title, labels, onError }) -> void. `labels` (optional) has drawTo(ctx, ratio) to paint the
 * text labels, which are HTML over the canvas and so not part of its pixels.
 */
export function savePng({ api, title, labels, onError }) {
  const { canvas } = api;
  api.renderNow();
  let target = canvas;
  if (labels) {
    target = canvas.ownerDocument.createElement('canvas');
    target.width = canvas.width;
    target.height = canvas.height;
    const ctx = target.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    labels.drawTo(ctx, canvas.width / Math.max(1, canvas.clientWidth));
  }
  try {
    target.toBlob((blob) => {
      if (!blob) return onError('the browser could not encode a PNG of this view');
      const url = URL.createObjectURL(blob);
      const link = canvas.ownerDocument.createElement('a');
      link.href = url;
      link.download = `${fileStem(title)}.png`;
      link.rel = 'noopener';
      link.style.display = 'none';
      canvas.ownerDocument.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
    }, 'image/png');
  } catch (err) {
    onError(`could not save the image (${err?.message ?? err})`);
  }
}
