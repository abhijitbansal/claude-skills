// dusk: soft modern. Grainy blobs, duotone orbs and wave bands (ported from the dusk specimen sheet).
import { TAU, f, fi, op, mix, pick, radial } from './pieces.mjs';

function haze(ctx, count, strength) {
  const { r, c, W, H, S } = ctx;
  const cols = [c.cat1, ctx.tone(6), c.cat2, c.cat6, ctx.tone(5), c.cat3];
  const cx0 = W * (0.3 + r() * 0.4);
  const cy0 = H * (0.35 + r() * 0.3);
  let defs = '';
  let body = '';
  const offset = Math.floor(r() * cols.length);
  for (let i = 0; i < count; i++) {
    const key = `h${i}`;
    defs += radial(ctx, key, cols[(i + offset) % cols.length], strength * (0.75 + r() * 0.25));
    const rad = S * (0.35 + r() * 0.4);
    const cx = cx0 + (r() - 0.5) * W * 0.7;
    const cy = cy0 + (r() - 0.5) * H * 0.6;
    body += `<ellipse cx="${fi(cx)}" cy="${fi(cy)}" rx="${fi(rad * (1 + r() * 0.5))}" ry="${fi(rad)}" fill="url(#${ctx.id(key)})"/>`;
  }
  return { defs, body };
}

function duskSky(ctx, top, bottom) {
  return {
    defs: `<linearGradient id="${ctx.id('sky')}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    body: `<rect width="${f(ctx.W)}" height="${f(ctx.H)}" fill="url(#${ctx.id('sky')})"/>`,
  };
}

function duskBlobs(ctx) {
  const { c } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, c.seq2, 0.6));
  const h = haze(ctx, 6, ctx.mode === 'light' ? 0.75 : 0.9);
  return { defs: sky.defs + h.defs, body: sky.body + h.body, grain: 0.55 };
}

function duskOrbs(ctx) {
  const { r, c, W, H, S, mode } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, c.seq2, 0.45));
  const h = haze(ctx, 3, 0.45);
  const pairs = [[c.cat1, ctx.tone(6)], [c.cat6, c.cat3], [c.cat2, c.cat5], [ctx.tone(5), c.cat4]];
  const n = 3 + Math.floor(r() * 2);
  let defs = sky.defs + h.defs;
  let body = sky.body + h.body;
  const anchor = [W * (0.55 + r() * 0.25), H * (0.3 + r() * 0.3)];
  for (let i = 0; i < n; i++) {
    // the anchor orb stays warm (coral or pink); satellites take any pair
    const [c1, c2] = i === 0 ? pairs[Math.floor(r() * 2)] : pairs[(i + Math.floor(r() * 4)) % pairs.length];
    const key = `o${i}`;
    defs += `<linearGradient id="${ctx.id(key)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    const rad = i === 0 ? S * (0.3 + r() * 0.12) : S * (0.06 + r() * 0.12);
    const ang = r() * TAU;
    const dist = i === 0 ? 0 : S * (0.25 + r() * 0.35);
    const cx = anchor[0] + Math.cos(ang) * dist * 1.4;
    const cy = anchor[1] + Math.sin(ang) * dist;
    const blend = i === 0 ? '' : ` style="mix-blend-mode:${mode === 'light' ? 'multiply' : 'screen'}"`;
    body += `<circle cx="${fi(cx)}" cy="${fi(cy)}" r="${fi(rad)}" fill="url(#${ctx.id(key)})" opacity="${i ? '.85' : '1'}"${blend}/>`;
  }
  for (let k = 0; k < 2; k++) {
    body += `<circle cx="${fi(anchor[0] + (r() - 0.5) * S * 0.8)}" cy="${fi(anchor[1] + (r() - 0.5) * S * 0.6)}" r="${fi(S * (0.32 + r() * 0.2))}" fill="none" stroke="${c.text}" stroke-width="${f(Math.max(1, S / 480))}" opacity=".35"/>`;
  }
  return { defs, body, grain: 0.5 };
}

function duskWaves(ctx) {
  const { r, c, W, H, S } = ctx;
  const sky = duskSky(ctx, c.page, mix(c.page, ctx.tone(4), 0.5));
  const sunX = W * (0.25 + r() * 0.5);
  const sunY = H * (0.32 + r() * 0.12);
  const defs = sky.defs + radial(ctx, 'sun', ctx.mode === 'dark' ? c.seq6 : c.cat3, 0.95);
  let body = sky.body + `<circle cx="${fi(sunX)}" cy="${fi(sunY)}" r="${fi(S * 0.55)}" fill="url(#${ctx.id('sun')})"/>`;
  const bands = [ctx.tone(5), ctx.tone(4), ctx.tone(3), c.cat6, ctx.tone(2), c.page];
  const stepX = Math.max(6, W / 120);
  bands.forEach((fill, i) => {
    const y = H * (0.42 + i * 0.1);
    const a1 = S * (0.02 + r() * 0.05);
    const f1 = (TAU / W) * (1 + r() * 1.6);
    const a2 = S * (0.008 + r() * 0.02);
    const f2 = (TAU / W) * (3 + r() * 4);
    const ph = r() * TAU;
    let d = `M0 ${f(H)}`;
    for (let x = 0; x <= W + stepX; x += stepX) {
      d += `L${fi(Math.min(x, W))} ${fi(y + Math.sin(x * f1 + ph) * a1 + Math.sin(x * f2 + ph * 2) * a2)}`;
    }
    body += `<path d="${d}L${f(W)} ${f(H)}Z" fill="${fill}" opacity="${op(0.7 + i * 0.06)}"/>`;
  });
  return { defs, body, grain: 0.5 };
}

export const dusk = (ctx) => pick(ctx.r, [duskBlobs, duskOrbs, duskWaves])(ctx);
