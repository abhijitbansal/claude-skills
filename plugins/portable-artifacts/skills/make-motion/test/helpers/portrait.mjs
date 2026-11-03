// Shared by tests that need a person to cut out (not a test file): a portrait drawn on a page canvas (no photo is
// bundled for tests, and no image library is used), and a reader for the alpha of a PNG at given points.
import { launchBrowser } from '../../scripts/lib/browser.mjs';

/**
 * PNG bytes of a drawn portrait on a flat-ish dark backdrop: shoulders in a jacket, neck, a skin-toned head with hair and a face,
 * centred, standing on the bottom edge, about 55 % of the height. `width` x `height` in px.
 */
export async function drawPortrait({ width = 960, height = 540 } = {}) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const url = await page.evaluate(({ w, h }) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const c = canvas.getContext('2d');
      const cx = w / 2;
      const u = h / 540; // one px at 540 high
      const back = c.createLinearGradient(0, 0, w, h);
      back.addColorStop(0, '#12303f');
      back.addColorStop(1, '#1f5666');
      c.fillStyle = back;
      c.fillRect(0, 0, w, h);
      // The person, shrunk toward the bottom edge so there is room above the head for text.
      c.save();
      c.translate(cx, h);
      c.scale(0.8, 0.8);
      c.translate(-cx, -h);
      // Neck, then sloping shoulders in a jacket with a shirt and lapels over it.
      const neck = c.createLinearGradient(cx - 40 * u, 0, cx + 40 * u, 0);
      neck.addColorStop(0, '#c58f70');
      neck.addColorStop(0.5, '#e0aa88');
      neck.addColorStop(1, '#c58f70');
      c.fillStyle = neck;
      c.fillRect(cx - 38 * u, 290 * u, 76 * u, 90 * u);
      const cloth = c.createLinearGradient(cx - 300 * u, 0, cx + 300 * u, 0);
      cloth.addColorStop(0, '#2c3a5c');
      cloth.addColorStop(0.5, '#3a4a72');
      cloth.addColorStop(1, '#242f4c');
      c.fillStyle = cloth;
      c.beginPath();
      c.moveTo(cx - 310 * u, h + 10 * u);
      c.bezierCurveTo(cx - 310 * u, 410 * u, cx - 240 * u, 368 * u, cx - 90 * u, 352 * u);
      c.lineTo(cx + 90 * u, 352 * u);
      c.bezierCurveTo(cx + 240 * u, 368 * u, cx + 310 * u, 410 * u, cx + 310 * u, h + 10 * u);
      c.closePath();
      c.fill();
      c.fillStyle = '#eef1f5';
      c.beginPath(); c.moveTo(cx - 60 * u, 352 * u); c.lineTo(cx + 60 * u, 352 * u); c.lineTo(cx, 450 * u); c.closePath(); c.fill();
      c.fillStyle = '#d99f7b';
      c.beginPath(); c.moveTo(cx - 40 * u, 352 * u); c.lineTo(cx + 40 * u, 352 * u); c.lineTo(cx, 404 * u); c.closePath(); c.fill();
      c.strokeStyle = '#1b2440';
      c.lineWidth = 5 * u;
      c.beginPath(); c.moveTo(cx - 60 * u, 352 * u); c.lineTo(cx - 6 * u, 470 * u); c.moveTo(cx + 60 * u, 352 * u); c.lineTo(cx + 6 * u, 470 * u); c.stroke();
      // Hair behind the head, then the head with a soft highlight.
      c.fillStyle = '#2b1d16';
      c.beginPath();
      c.ellipse(cx, 190 * u, 112 * u, 128 * u, 0, 0, 2 * Math.PI);
      c.fill();
      const skin = c.createRadialGradient(cx - 30 * u, 190 * u, 20 * u, cx, 200 * u, 120 * u);
      skin.addColorStop(0, '#f1c4a3');
      skin.addColorStop(1, '#d99f7b');
      c.fillStyle = skin;
      c.beginPath();
      c.ellipse(cx, 212 * u, 92 * u, 112 * u, 0, 0, 2 * Math.PI);
      c.fill();
      // Fringe, eyes, brows, nose, mouth.
      c.fillStyle = '#2b1d16';
      c.beginPath();
      c.ellipse(cx, 118 * u, 96 * u, 40 * u, 0, Math.PI, 2 * Math.PI);
      c.fill();
      c.fillStyle = '#ffffff';
      for (const dx of [-36, 36]) { c.beginPath(); c.ellipse(cx + dx * u, 200 * u, 15 * u, 9 * u, 0, 0, 2 * Math.PI); c.fill(); }
      c.fillStyle = '#3a2a22';
      for (const dx of [-36, 36]) { c.beginPath(); c.arc(cx + dx * u, 200 * u, 6 * u, 0, 2 * Math.PI); c.fill(); }
      c.strokeStyle = '#2b1d16';
      c.lineWidth = 5 * u;
      c.beginPath(); c.moveTo(cx - 54 * u, 177 * u); c.lineTo(cx - 20 * u, 172 * u); c.moveTo(cx + 20 * u, 172 * u); c.lineTo(cx + 54 * u, 177 * u); c.stroke();
      c.strokeStyle = '#b97e5f';
      c.lineWidth = 4 * u;
      c.beginPath(); c.moveTo(cx, 205 * u); c.lineTo(cx - 8 * u, 240 * u); c.lineTo(cx + 6 * u, 242 * u); c.stroke();
      c.strokeStyle = '#a4574a';
      c.lineWidth = 6 * u;
      c.beginPath(); c.moveTo(cx - 28 * u, 272 * u); c.quadraticCurveTo(cx, 288 * u, cx + 28 * u, 272 * u); c.stroke();
      c.restore();
      return canvas.toDataURL('image/png');
    }, { w: width, h: height });
    return Buffer.from(url.split(',')[1], 'base64');
  } finally {
    await browser.close();
  }
}

/** The alpha (0..1) of PNG bytes `png` at each `[x, y]` of `points`, read back through a page canvas. */
export async function alphaAt(png, points) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ src, pts }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
      const c = canvas.getContext('2d');
      c.drawImage(img, 0, 0);
      return pts.map(([x, y]) => c.getImageData(x, y, 1, 1).data[3] / 255);
    }, { src: `data:image/png;base64,${png.toString('base64')}`, pts: points });
  } finally {
    await browser.close();
  }
}
