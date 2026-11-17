// The two pictures of a layer or shader cut (engine/cuts/layers.mjs), composed in canvas 2D before the post pass, so a
// layer cut is the same picture with or without WebGL. The outgoing picture is a function of the film alone (the
// outgoing shot frozen at its end, its fields painted at that second), so it is drawn once per shot index and kept; the
// incoming one is drawn each frame. The canvases are made on the first frame that needs them: a film with no layer or
// shader cut makes none (`made` counts them, for tests).
const HALF = 2;

/**
 * @param {{ w: number, h: number, drawShot: (ctx: OffscreenCanvasRenderingContext2D, picture: { background: string,
 *   sampled: object[], t: number }) => void }} options drawShot paints a whole frame of one shot (background first)
 */
export function createCutPictures({ w, h, drawShot }) {
  let made = 0;
  let incoming = null;
  let outgoing = null; // { shot, canvas }: the outgoing picture of the last window drawn
  const canvas = () => {
    made += 1;
    return new OffscreenCanvas(w, h);
  };

  /** The outgoing picture of the window `state` is in (frameAt's `from`), drawn once per shot index. */
  function outgoingOf(state) {
    if (outgoing?.shot === state.from.shot) return outgoing.canvas;
    const target = outgoing?.canvas ?? canvas();
    drawShot(target.getContext('2d'), { background: state.from.background, sampled: state.from.sampled, t: state.from.t });
    outgoing = { shot: state.from.shot, canvas: target };
    return target;
  }

  /** The incoming picture of frame `state` at film second `t`, drawn now. */
  function incomingOf(state, t) {
    incoming ??= canvas();
    drawShot(incoming.getContext('2d'), { background: state.background, sampled: state.sampled, t });
    return incoming;
  }

  // One picture onto ctx in its pose: alpha, then the clip, then the scale about the centre and the blur.
  function place(ctx, picture, pose) {
    if (pose.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = pose.opacity;
    if (pose.clip?.rect) {
      ctx.beginPath();
      ctx.rect(...pose.clip.rect);
      ctx.clip();
    } else if (pose.clip?.circle) {
      const [cx, cy, r] = pose.clip.circle;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * HALF);
      ctx.clip();
    }
    if (pose.blur > 0) ctx.filter = `blur(${pose.blur}px)`;
    ctx.translate(w / HALF, h / HALF);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-w / HALF, -h / HALF);
    ctx.drawImage(picture, 0, 0);
    if (pose.dim > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // the clip stays; the dim covers the whole canvas inside it
      ctx.filter = 'none';
      ctx.globalAlpha = pose.opacity * pose.dim;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /**
   * Composes frame `state` (inside a window: frameAt's { background, sampled, cut, from }) at film second `t` onto ctx
   * as `recipe` poses it (a layer cut's layers()). ctx must be at the identity with nothing left in its state.
   */
  function compose(ctx, state, recipe, t) {
    const pictures = { from: outgoingOf(state), to: incomingOf(state, t) };
    const backdrop = recipe.backdrop === null ? null : (recipe.backdrop === 'to' ? state.background : state.from.background);
    ctx.fillStyle = backdrop ?? state.background;
    ctx.fillRect(0, 0, w, h);
    const over = recipe.under === 'from' ? 'to' : 'from';
    place(ctx, pictures[recipe.under], recipe[recipe.under]);
    place(ctx, pictures[over], recipe[over]);
  }

  return { compose, outgoing: outgoingOf, incoming: incomingOf, made: () => made };
}
